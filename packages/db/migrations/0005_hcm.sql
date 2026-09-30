-- =============================================================================
-- 0005 — HCM, first slice: employment profile, leave policy, leave types,
-- leave requests and the entitlement ledger (Kara member_employment,
-- attendance_policy, leave_types, leave_requests, leave_ledger).
--
-- Approvals are not stored here: a leave request starts a workflow instance
-- (core.wf_*), which replaces Kara's leave_approvals table.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS hcm;

CREATE TABLE hcm.employments (
  tenant_id           uuid NOT NULL,
  user_id             uuid NOT NULL,
  hire_date           date NOT NULL,
  site                text NOT NULL DEFAULT 'hq' CHECK (site IN ('hq','factory','guard')),
  daily_work_minutes  int NOT NULL DEFAULT 510 CHECK (daily_work_minutes BETWEEN 60 AND 1440),
  work_schedule_id    uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_schedule_id) REFERENCES core.work_schedules(tenant_id, id)
    ON DELETE SET NULL (work_schedule_id)
);

CREATE TABLE hcm.leave_policies (
  tenant_id           uuid PRIMARY KEY REFERENCES core.tenants(id) ON DELETE CASCADE,
  -- working days a year (Labour Law art. 64: one month including 4 Fridays = 26)
  annual_leave_days   numeric(5,1) NOT NULL DEFAULT 26 CHECK (annual_leave_days >= 0),
  -- how far below zero the entitlement balance may go (مرخصی منفی)
  max_negative_days   numeric(5,1) NOT NULL DEFAULT 3 CHECK (max_negative_days >= 0),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE hcm.leave_types (
  id                     uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id              uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  code                   text NOT NULL,
  name                   text NOT NULL,
  unit                   text NOT NULL CHECK (unit IN ('day','hour')),
  paid                   boolean NOT NULL DEFAULT true,
  deducts_entitlement    boolean NOT NULL DEFAULT false,
  counts_inner_holidays  boolean NOT NULL DEFAULT false,
  requires_attachment    boolean NOT NULL DEFAULT false,
  max_minutes_per_day    int CHECK (max_minutes_per_day > 0),
  max_count_per_month    int CHECK (max_count_per_month > 0),
  max_count_per_week     int CHECK (max_count_per_week > 0),
  max_days_per_year      numeric(6,1) CHECK (max_days_per_year > 0),
  approval_levels        int NOT NULL DEFAULT 2 CHECK (approval_levels BETWEEN 1 AND 3),
  is_active              boolean NOT NULL DEFAULT true,
  is_system              boolean NOT NULL DEFAULT false,
  sort_order             int NOT NULL DEFAULT 100,
  description            text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE hcm.leave_requests (
  id                    uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id             uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL,
  type_id               uuid NOT NULL,
  kind                  text NOT NULL CHECK (kind IN ('leave','mission','hourly')),
  from_date             date NOT NULL,
  to_date               date NOT NULL,
  from_time             time,
  to_time               time,
  jalali_year           int NOT NULL,             -- of from_date; balances are per Jalali year
  effective_days        numeric(6,2) NOT NULL,    -- billable days after holidays / hours → days
  reason                text,
  attachment_id         uuid REFERENCES core.attachments(id),
  details               jsonb,                    -- mission fields (origin, destination, …)
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','cancelled')),
  workflow_instance_id  uuid,
  decided_by            uuid,
  decided_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (to_date >= from_date),
  CHECK ((from_time IS NULL) = (to_time IS NULL)),
  CHECK (from_time IS NULL OR (to_time > from_time AND to_date = from_date)),
  FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, type_id) REFERENCES hcm.leave_types(tenant_id, id),
  FOREIGN KEY (tenant_id, workflow_instance_id) REFERENCES core.wf_instances(tenant_id, id)
);
CREATE INDEX ON hcm.leave_requests (tenant_id, user_id, from_date);
CREATE INDEX ON hcm.leave_requests (tenant_id, status) WHERE status = 'pending';

-- Manual movements of the entitlement balance. Accrual and use are computed
-- live; this holds carry-over, forfeits, buy-backs and corrections. Rows are
-- never changed: a correction is another row.
CREATE TABLE hcm.leave_ledger (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id    uuid NOT NULL,
  user_id      uuid NOT NULL,
  jalali_year  int NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('carry_in','forfeit','buyback','adjust')),
  days         numeric(6,2) NOT NULL CHECK (days <> 0),
  note         text,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX ON hcm.leave_ledger (tenant_id, user_id, jalali_year);
CREATE TRIGGER leave_ledger_append_only BEFORE UPDATE ON hcm.leave_ledger
  FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

SELECT core.enable_tenant_rls('hcm.employments');
SELECT core.enable_tenant_rls('hcm.leave_policies');
SELECT core.enable_tenant_rls('hcm.leave_types');
SELECT core.enable_tenant_rls('hcm.leave_requests');
SELECT core.enable_tenant_rls('hcm.leave_ledger');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_app') THEN
    GRANT USAGE ON SCHEMA hcm TO simorgh_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA hcm TO simorgh_app;
    REVOKE UPDATE, DELETE ON hcm.leave_ledger FROM simorgh_app;
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA hcm
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simorgh_app', current_user);
  END IF;
END $$;

SELECT core.assert_rls();
