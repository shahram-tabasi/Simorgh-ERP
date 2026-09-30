-- =============================================================================
-- 0004 — M2 kernel: organisation tree, work calendar, workflow engine,
-- kartabl (inbox) and work tasks. Ported from Simorgh Kara (groups,
-- kartabl_items, work_tasks, holidays, work_schedules, schedule_overrides,
-- leave_approvals) onto the shared-schema kernel of 0001.
-- =============================================================================

-- Tables created from here on get the same tenant policy 0001 gave its tables.
CREATE OR REPLACE FUNCTION core.enable_tenant_rls(tbl regclass) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', tbl);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', tbl);
  EXECUTE format($p$CREATE POLICY tenant_isolation ON %s
                    USING (tenant_id = core.current_tenant())
                    WITH CHECK (tenant_id = core.current_tenant())$p$, tbl);
END $$;
REVOKE EXECUTE ON FUNCTION core.enable_tenant_rls(regclass) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_app') THEN
    REVOKE EXECUTE ON FUNCTION core.enable_tenant_rls(regclass) FROM simorgh_app;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- Organisation tree (Kara `groups`)
-- -----------------------------------------------------------------------------

-- Tenant-safe references: a parent, a manager and a member must belong to the
-- same tenant as the unit (the single-column FKs of 0001 did not say so).
ALTER TABLE core.org_units ADD CONSTRAINT org_units_tenant_id_id_key UNIQUE (tenant_id, id);
ALTER TABLE core.org_units DROP CONSTRAINT org_units_parent_id_fkey;
ALTER TABLE core.org_units ADD CONSTRAINT org_units_parent_fkey
  FOREIGN KEY (tenant_id, parent_id) REFERENCES core.org_units(tenant_id, id);
ALTER TABLE core.org_units DROP CONSTRAINT org_units_manager_user_id_fkey;
ALTER TABLE core.org_units ADD CONSTRAINT org_units_manager_fkey
  FOREIGN KEY (tenant_id, manager_user_id) REFERENCES core.tenant_memberships(tenant_id, user_id)
  ON DELETE SET NULL (manager_user_id);
ALTER TABLE core.org_units ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON core.org_units (tenant_id, parent_id);

-- path = ancestors' ids down to this unit, so "this unit and everything under
-- it" is `path <@ unit.path` (the org_unit scope, architecture §6.4). The
-- database maintains it; the application never writes it.
CREATE OR REPLACE FUNCTION core.org_unit_set_path() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE parent_path ltree;
BEGIN
  IF NEW.parent_id IS NULL THEN
    NEW.path := text2ltree(replace(NEW.id::text, '-', ''));
  ELSE
    SELECT path INTO parent_path FROM core.org_units WHERE id = NEW.parent_id AND tenant_id = NEW.tenant_id;
    IF parent_path IS NULL THEN
      RAISE EXCEPTION 'parent org unit % not found', NEW.parent_id USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF TG_OP = 'UPDATE' AND parent_path <@ OLD.path THEN
      RAISE EXCEPTION 'an org unit cannot be moved under itself' USING ERRCODE = 'check_violation',
        CONSTRAINT = 'org_units_no_cycle';
    END IF;
    NEW.path := parent_path || text2ltree(replace(NEW.id::text, '-', ''));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION core.org_unit_move_subtree() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE core.org_units
     SET path = NEW.path || subpath(path, nlevel(OLD.path))
   WHERE path <@ OLD.path AND id <> NEW.id;
  RETURN NULL;
END $$;

CREATE TRIGGER org_unit_path BEFORE INSERT OR UPDATE OF parent_id ON core.org_units
  FOR EACH ROW EXECUTE FUNCTION core.org_unit_set_path();
CREATE TRIGGER org_unit_subtree AFTER UPDATE OF parent_id ON core.org_units
  FOR EACH ROW WHEN (OLD.path IS DISTINCT FROM NEW.path) EXECUTE FUNCTION core.org_unit_move_subtree();

CREATE TABLE core.org_unit_members (
  tenant_id    uuid NOT NULL,
  org_unit_id  uuid NOT NULL,
  user_id      uuid NOT NULL,
  is_primary   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, org_unit_id, user_id),
  FOREIGN KEY (tenant_id, org_unit_id) REFERENCES core.org_units(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX ON core.org_unit_members (tenant_id, user_id);
-- at most one primary unit per person
CREATE UNIQUE INDEX org_unit_members_one_primary ON core.org_unit_members (tenant_id, user_id) WHERE is_primary;
SELECT core.enable_tenant_rls('core.org_unit_members');

-- -----------------------------------------------------------------------------
-- Work calendar (Kara holidays, work_schedules, schedule_overrides). In the
-- kernel, not in HCM: production planning and delivery dates use it too.
-- -----------------------------------------------------------------------------

CREATE TABLE core.holidays (
  id            uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  holiday_date  date NOT NULL,
  title         text NOT NULL,
  is_official   boolean NOT NULL DEFAULT true,
  is_off        boolean NOT NULL DEFAULT true,   -- false = an occasion, not a day off
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, holiday_date, title)
);
SELECT core.enable_tenant_rls('core.holidays');

CREATE TABLE core.work_schedules (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  work_days    smallint[] NOT NULL DEFAULT '{0,1,2,3,4}',   -- 0 = Saturday … 6 = Friday
  start_time   time NOT NULL DEFAULT '08:00',
  end_time     time NOT NULL DEFAULT '17:00',
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name),
  UNIQUE (tenant_id, id),
  CHECK (work_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  CHECK (end_time > start_time)
);
CREATE UNIQUE INDEX work_schedules_one_default ON core.work_schedules (tenant_id) WHERE is_default;
SELECT core.enable_tenant_rls('core.work_schedules');

-- A unit's schedule applies to its members (and sub-units) unless a person has their own.
ALTER TABLE core.org_units ADD COLUMN work_schedule_id uuid;
ALTER TABLE core.org_units ADD CONSTRAINT org_units_work_schedule_fkey
  FOREIGN KEY (tenant_id, work_schedule_id) REFERENCES core.work_schedules(tenant_id, id)
  ON DELETE SET NULL (work_schedule_id);

CREATE TABLE core.schedule_overrides (
  id             uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  override_date  date NOT NULL,
  is_working     boolean NOT NULL,     -- true: a working day; false: a day off (e.g. a bridge day)
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, override_date)
);
SELECT core.enable_tenant_rls('core.schedule_overrides');

-- -----------------------------------------------------------------------------
-- Workflow engine (architecture §11) — generalises Kara's leave approvals
-- -----------------------------------------------------------------------------

-- 'shipped': the tenant's copy of a definition that ships in code;
-- 'tenant': the tenant's own edited version, which takes precedence.
ALTER TABLE core.wf_definitions ADD COLUMN source text NOT NULL DEFAULT 'shipped'
  CHECK (source IN ('shipped','tenant'));

ALTER TABLE core.wf_instances
  ADD COLUMN subject_user_id uuid,    -- whom the document is about (the requester, the employee)
  ADD COLUMN title text,
  ADD COLUMN outcome_comment text;
CREATE INDEX ON core.wf_instances (tenant_id, status) WHERE status = 'running';

-- Every open step is fanned out as one task per eligible person; the first
-- decision closes the step and cancels the others. The rule that made the
-- person eligible is kept for the record and re-checked when they decide.
ALTER TABLE core.wf_tasks ADD COLUMN assignee_permission text;
ALTER TABLE core.wf_tasks ADD COLUMN assignee_rule text;   -- 'permission' | 'org_unit_manager' | 'user' | 'role'
ALTER TABLE core.wf_tasks ADD COLUMN step_no int NOT NULL DEFAULT 1;
CREATE INDEX ON core.wf_tasks (tenant_id, instance_id, step_id);

CREATE TABLE core.wf_history (
  id             uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id      uuid NOT NULL,
  instance_id    uuid NOT NULL,
  step_id        text,
  action         text NOT NULL CHECK (action IN ('start','activate','approve','reject','cancel','complete')),
  actor_user_id  uuid,
  comment        text,
  data           jsonb,
  at             timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES core.wf_instances(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX ON core.wf_history (tenant_id, instance_id, at);
CREATE TRIGGER wf_history_append_only BEFORE UPDATE ON core.wf_history
  FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();
SELECT core.enable_tenant_rls('core.wf_history');

-- -----------------------------------------------------------------------------
-- Kartabl (Kara kartabl_items): notes, assigned items and messages in a
-- person's inbox. Approvals are not stored here — they are wf_tasks, and the
-- kartabl API shows both.
--
-- Accountability rule kept from Kara: an item assigned to you by someone else
-- can only have its status changed by you; only its author (or someone who
-- manages your kartabl) may edit or delete it.
-- -----------------------------------------------------------------------------

CREATE TABLE core.inbox_items (
  id             uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id      uuid NOT NULL,
  owner_user_id  uuid NOT NULL,
  folder         text,                 -- Kara's named kartabls; NULL = the main one
  kind           text NOT NULL DEFAULT 'task' CHECK (kind IN ('task','note','message','document')),
  title          text NOT NULL,
  body           text,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','archived')),
  ref_type       text,
  ref_id         uuid,
  created_by     uuid,
  remind_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, owner_user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE SET NULL (created_by)
);
CREATE INDEX ON core.inbox_items (tenant_id, owner_user_id, status, created_at DESC);
CREATE INDEX ON core.inbox_items (tenant_id, remind_at) WHERE remind_at IS NOT NULL AND status IN ('open','in_progress');
SELECT core.enable_tenant_rls('core.inbox_items');

-- -----------------------------------------------------------------------------
-- Work tasks — «میز کار» (Kara work_tasks / work_task_assignees)
-- -----------------------------------------------------------------------------

CREATE TABLE core.tasks (
  id            uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  body          text,
  code          text,                  -- optional work-order code
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent','forced')),
  from_date     date,
  due_date      date,
  created_by    uuid,
  org_unit_id   uuid,                  -- set when sent to a whole unit
  parent_id     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (due_date IS NULL OR from_date IS NULL OR due_date >= from_date),
  FOREIGN KEY (tenant_id, created_by) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE SET NULL (created_by),
  FOREIGN KEY (tenant_id, org_unit_id) REFERENCES core.org_units(tenant_id, id) ON DELETE SET NULL (org_unit_id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES core.tasks(tenant_id, id) ON DELETE SET NULL (parent_id)
);
CREATE INDEX ON core.tasks (tenant_id, created_by);
SELECT core.enable_tenant_rls('core.tasks');

CREATE TABLE core.task_assignees (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  task_id          uuid NOT NULL,
  user_id          uuid NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done')),
  delegated_from   uuid,               -- who handed it on (واگذاری)
  acknowledged_at  timestamptz,        -- read receipt (تأیید دریافت)
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, task_id, user_id),
  FOREIGN KEY (tenant_id, task_id) REFERENCES core.tasks(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, delegated_from) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE SET NULL (delegated_from)
);
CREATE INDEX ON core.task_assignees (tenant_id, user_id);
SELECT core.enable_tenant_rls('core.task_assignees');

-- History is append-only for the application.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_app') THEN
    REVOKE UPDATE, DELETE ON core.wf_history FROM simorgh_app;
  END IF;
END $$;

SELECT core.assert_rls();
