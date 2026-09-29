-- =============================================================================
-- SIMORGH ERP — Appendix B: Core database schema (v1.0)
-- Target: PostgreSQL 16+
--
-- Scope of this file: the Platform Kernel (tenancy, identity, RBAC, org,
-- party, catalog, documents, workflow, audit, events) and Finance/GL — the
-- parts every other module builds on. Module schemas (crm, sales, scm, inv,
-- prj, eng, elec, mfg, mrp, qms, eam, hcm, ai) are catalogued in section 7.2
-- of the architecture document and get their DDL in their own phase.
--
-- Conventions (section 7.1):
--   * every business table has tenant_id + RLS policy `tenant_isolation`
--   * ids are UUIDv7 (core.uuid_v7()); human numbers come from core.number_series
--   * money numeric(20,4), quantity numeric(20,6), rate numeric(20,10)
--   * posted financial documents are immutable (triggers below)
--
-- The application connects as role simorgh_app (no BYPASSRLS, not owner) and
-- sets `app.tenant_id` / `app.user_id` with set_config(..., true) per transaction.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS fin;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- UUIDv7: 48-bit unix-ms timestamp + random. (Native uuidv7() arrives in PG18.)
CREATE OR REPLACE FUNCTION core.uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  b     bytea  := decode(lpad(to_hex(ts_ms), 12, '0'), 'hex') || gen_random_bytes(10);
BEGIN
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);   -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);   -- RFC 4122 variant
  RETURN encode(b, 'hex')::uuid;
END $$;

CREATE OR REPLACE FUNCTION core.current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION core.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION core.touch_updated() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  NEW.updated_by := coalesce(core.current_user_id(), NEW.updated_by);
  NEW.version    := OLD.version + 1;
  RETURN NEW;
END $$;

-- -----------------------------------------------------------------------------
-- Platform: tenants, plans, modules, settings, feature flags
-- -----------------------------------------------------------------------------

CREATE TABLE core.plans (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  limits      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.tenants (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  code             citext NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9][a-z0-9-]{1,49}$'),
  name             text NOT NULL,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('trial','active','suspended','closed')),
  plan_id          uuid REFERENCES core.plans(id),
  deployment_mode  text NOT NULL DEFAULT 'pooled'
                     CHECK (deployment_mode IN ('pooled','dedicated','on_prem')),
  default_locale   text NOT NULL DEFAULT 'fa-IR',
  default_timezone text NOT NULL DEFAULT 'Asia/Tehran',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.tenant_modules (
  tenant_id    uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  module_code  text NOT NULL,                -- 'crm','sales','fin','elec',…
  enabled      boolean NOT NULL DEFAULT true,
  config       jsonb NOT NULL DEFAULT '{}',
  enabled_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, module_code)
);

CREATE TABLE core.settings (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid REFERENCES core.tenants(id) ON DELETE CASCADE,  -- NULL = platform
  scope_type  text NOT NULL DEFAULT 'tenant'
                CHECK (scope_type IN ('platform','tenant','legal_entity')),
  scope_id    uuid,
  key         text NOT NULL,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, scope_type, scope_id, key)
);

CREATE TABLE core.feature_flags (
  key          text PRIMARY KEY,
  description  text,
  default_on   boolean NOT NULL DEFAULT false
);

CREATE TABLE core.tenant_feature_overrides (
  tenant_id  uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  flag_key   text NOT NULL REFERENCES core.feature_flags(key) ON DELETE CASCADE,
  enabled    boolean NOT NULL,
  PRIMARY KEY (tenant_id, flag_key)
);

-- -----------------------------------------------------------------------------
-- Identity (global users; membership per tenant)
-- -----------------------------------------------------------------------------

CREATE TABLE core.users (
  id                    uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  email                 citext UNIQUE,
  mobile                text UNIQUE,
  password_hash         text,                       -- argon2id; NULL for SSO-only
  display_name          text NOT NULL,
  locale                text,
  mfa_totp_secret       text,                       -- encrypted at app layer
  is_platform_admin     boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  failed_login_attempts int NOT NULL DEFAULT 0,
  locked_until          timestamptz,
  last_login_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR mobile IS NOT NULL)
);

CREATE TABLE core.oauth_accounts (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  user_id           uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  provider          text NOT NULL,                  -- oidc issuer / 'ldap' / 'google'
  provider_subject  text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);

CREATE TABLE core.refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  user_id      uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  tenant_id    uuid REFERENCES core.tenants(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,                       -- rotation family; reuse => revoke family
  token_hash   text NOT NULL UNIQUE,
  device_info  jsonb,
  ip_address   inet,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON core.refresh_tokens (user_id) WHERE revoked_at IS NULL;

CREATE TABLE core.login_attempts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identifier  text NOT NULL,
  ip_address  inet,
  success     boolean NOT NULL,
  reason      text,
  at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON core.login_attempts (identifier, at DESC);

-- -----------------------------------------------------------------------------
-- Organization: legal entities, org units, sites
-- -----------------------------------------------------------------------------

CREATE TABLE core.legal_entities (
  id                 uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id          uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  code               text NOT NULL,
  name               text NOT NULL,
  national_id        text,              -- شناسه ملی
  economic_code      text,              -- کد اقتصادی
  registration_no    text,
  base_currency      char(3) NOT NULL DEFAULT 'IRR',
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE core.org_units (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  legal_entity_id  uuid NOT NULL,
  parent_id        uuid REFERENCES core.org_units(id),
  code             text NOT NULL,
  name             text NOT NULL,
  path             ltree NOT NULL,
  manager_user_id  uuid REFERENCES core.users(id),
  is_active        boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES core.legal_entities(tenant_id, id)
);
CREATE INDEX ON core.org_units USING gist (path);

CREATE TABLE core.sites (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  legal_entity_id  uuid NOT NULL,
  code             text NOT NULL,
  name             text NOT NULL,
  kind             text NOT NULL DEFAULT 'plant' CHECK (kind IN ('plant','office','warehouse','project_site')),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES core.legal_entities(tenant_id, id)
);

-- -----------------------------------------------------------------------------
-- Party (customers, suppliers, employees, contacts are all parties)
-- -----------------------------------------------------------------------------

CREATE TABLE core.parties (
  id             uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  kind           text NOT NULL CHECK (kind IN ('person','organization')),
  code           text NOT NULL,
  display_name   text NOT NULL,
  first_name     text,
  last_name      text,
  national_id    text,            -- کد ملی / شناسه ملی
  economic_code  text,
  custom         jsonb NOT NULL DEFAULT '{}',
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid,
  version        int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);
CREATE INDEX ON core.parties USING gin (display_name gin_trgm_ops);

CREATE TABLE core.party_roles (
  tenant_id  uuid NOT NULL,
  party_id   uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('customer','supplier','employee','contact','carrier','bank','subcontractor')),
  data       jsonb NOT NULL DEFAULT '{}',   -- credit limit, payment terms, supplier category…
  PRIMARY KEY (tenant_id, party_id, role),
  FOREIGN KEY (tenant_id, party_id) REFERENCES core.parties(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE core.party_addresses (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL,
  party_id    uuid NOT NULL,
  kind        text NOT NULL DEFAULT 'main',
  country     char(2) NOT NULL DEFAULT 'IR',
  province    text,
  city        text,
  line1       text NOT NULL,
  postal_code text,
  phone       text,
  FOREIGN KEY (tenant_id, party_id) REFERENCES core.parties(tenant_id, id) ON DELETE CASCADE
);

-- -----------------------------------------------------------------------------
-- Membership & RBAC
-- -----------------------------------------------------------------------------

CREATE TABLE core.tenant_memberships (
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  party_id    uuid,                                 -- the employee party, if any
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('invited','active','disabled')),
  is_owner    boolean NOT NULL DEFAULT false,
  perm_ver    int NOT NULL DEFAULT 1,               -- bumped on any role change (cache key)
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, party_id) REFERENCES core.parties(tenant_id, id)
);

-- Catalog synced from code at boot (packages/contracts permissions).
CREATE TABLE core.permissions (
  key       text PRIMARY KEY CHECK (key ~ '^[a-z_]+\.[a-z_]+\.[a-z_]+(\.[a-z_]+)?$'),
  module    text NOT NULL,
  label_fa  text NOT NULL,
  label_en  text NOT NULL,
  scopes    text[] NOT NULL DEFAULT '{tenant}'
);

CREATE TABLE core.roles (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE core.role_permissions (
  tenant_id       uuid NOT NULL,
  role_id         uuid NOT NULL,
  permission_key  text NOT NULL REFERENCES core.permissions(key) ON DELETE CASCADE,
  scope           text NOT NULL DEFAULT 'tenant'
                    CHECK (scope IN ('own','org_unit','project','legal_entity','tenant')),
  PRIMARY KEY (tenant_id, role_id, permission_key),
  FOREIGN KEY (tenant_id, role_id) REFERENCES core.roles(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE core.user_roles (
  id            uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id     uuid NOT NULL,
  user_id       uuid NOT NULL,
  role_id       uuid NOT NULL,
  context_type  text NOT NULL DEFAULT 'tenant'
                  CHECK (context_type IN ('tenant','legal_entity','org_unit','project')),
  context_id    uuid,
  valid_until   date,
  UNIQUE NULLS NOT DISTINCT (tenant_id, user_id, role_id, context_type, context_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES core.tenant_memberships(tenant_id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES core.roles(tenant_id, id) ON DELETE CASCADE,
  CHECK ((context_type = 'tenant') = (context_id IS NULL))
);

CREATE TABLE core.api_clients (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('service','device','integration')),
  name        text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  scopes      text[] NOT NULL,
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Master data: currency, UOM, tax, items
-- -----------------------------------------------------------------------------

CREATE TABLE core.currencies (          -- global (ISO 4217), not tenant-scoped
  code        char(3) PRIMARY KEY,
  name        text NOT NULL,
  minor_unit  smallint NOT NULL DEFAULT 2
);

CREATE TABLE core.exchange_rates (
  id             uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  from_currency  char(3) NOT NULL REFERENCES core.currencies(code),
  to_currency    char(3) NOT NULL REFERENCES core.currencies(code),
  rate_type      text NOT NULL DEFAULT 'official' CHECK (rate_type IN ('official','market','budget')),
  valid_on       date NOT NULL,
  rate           numeric(20,10) NOT NULL CHECK (rate > 0),
  UNIQUE (tenant_id, from_currency, to_currency, rate_type, valid_on)
);

CREATE TABLE core.uom_classes (
  id         uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  code       text NOT NULL,             -- count, length, mass, time…
  name       text NOT NULL,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE core.uoms (
  id              uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id       uuid NOT NULL,
  class_id        uuid NOT NULL,
  code            text NOT NULL,        -- pcs, m, kg, set, h
  name            text NOT NULL,
  factor_to_base  numeric(20,10) NOT NULL DEFAULT 1 CHECK (factor_to_base > 0),
  decimals        smallint NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, class_id) REFERENCES core.uom_classes(tenant_id, id)
);

CREATE TABLE core.tax_codes (
  id         uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  code       text NOT NULL,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('vat','duty','withholding','other')),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);

CREATE TABLE core.tax_rates (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL,
  tax_code_id uuid NOT NULL,
  rate        numeric(9,6) NOT NULL CHECK (rate >= 0),
  valid_from  date NOT NULL,
  valid_to    date,
  UNIQUE (tenant_id, tax_code_id, valid_from),
  FOREIGN KEY (tenant_id, tax_code_id) REFERENCES core.tax_codes(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE core.attribute_sets (       -- e.g. 'elec.breaker': rated current, Icu, poles…
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  key         text NOT NULL,
  name        text NOT NULL,
  definition  jsonb NOT NULL,          -- [{key,type,unit,required,enum}]
  owner_pack  text,                    -- 'elec' when seeded by an industry pack
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE core.item_categories (
  id         uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES core.item_categories(id),
  code       text NOT NULL,
  name       text NOT NULL,
  path       ltree NOT NULL,
  defaults   jsonb NOT NULL DEFAULT '{}',   -- default accounts, valuation, attribute set
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id)
);
CREATE INDEX ON core.item_categories USING gist (path);

CREATE TABLE core.items (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id         uuid NOT NULL,
  code              text NOT NULL,
  name              text NOT NULL,
  name_en           text,
  type              text NOT NULL CHECK (type IN ('stock','non_stock','service','asset','kit','phantom')),
  category_id       uuid NOT NULL,
  base_uom_id       uuid NOT NULL,
  tracking          text NOT NULL DEFAULT 'none' CHECK (tracking IN ('none','lot','serial')),
  valuation_method  text NOT NULL DEFAULT 'moving_average' CHECK (valuation_method IN ('moving_average','fifo','standard')),
  attribute_set_id  uuid,
  attributes        jsonb NOT NULL DEFAULT '{}',
  manufacturer      text,
  manufacturer_part_no text,          -- EPLAN order number
  tax_code_id       uuid,
  is_purchasable    boolean NOT NULL DEFAULT true,
  is_sellable       boolean NOT NULL DEFAULT true,
  is_manufactured   boolean NOT NULL DEFAULT false,
  is_active         boolean NOT NULL DEFAULT true,
  custom            jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  version           int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, category_id)      REFERENCES core.item_categories(tenant_id, id),
  FOREIGN KEY (tenant_id, base_uom_id)      REFERENCES core.uoms(tenant_id, id),
  FOREIGN KEY (tenant_id, attribute_set_id) REFERENCES core.attribute_sets(tenant_id, id),
  FOREIGN KEY (tenant_id, tax_code_id)      REFERENCES core.tax_codes(tenant_id, id)
);
CREATE INDEX ON core.items USING gin (name gin_trgm_ops);
CREATE INDEX ON core.items (tenant_id, manufacturer, manufacturer_part_no);
CREATE INDEX ON core.items USING gin (attributes jsonb_path_ops);

CREATE TABLE core.item_uoms (
  tenant_id  uuid NOT NULL,
  item_id    uuid NOT NULL,
  uom_id     uuid NOT NULL,
  factor     numeric(20,10) NOT NULL CHECK (factor > 0),   -- 1 uom = factor × base uom
  PRIMARY KEY (tenant_id, item_id, uom_id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES core.items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, uom_id)  REFERENCES core.uoms(tenant_id, id)
);

CREATE TABLE core.item_suppliers (
  tenant_id         uuid NOT NULL,
  item_id           uuid NOT NULL,
  supplier_party_id uuid NOT NULL,
  supplier_item_code text,
  lead_time_days    int,
  min_order_qty     numeric(20,6),
  last_price        numeric(20,4),
  last_currency     char(3) REFERENCES core.currencies(code),
  is_preferred      boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, item_id, supplier_party_id),
  FOREIGN KEY (tenant_id, item_id)           REFERENCES core.items(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, supplier_party_id) REFERENCES core.parties(tenant_id, id)
);

-- -----------------------------------------------------------------------------
-- Document engine: numbering, links, revisions, attachments, locks, custom fields
-- -----------------------------------------------------------------------------

CREATE TABLE core.number_series (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  doc_type         text NOT NULL,              -- 'sales.order'
  legal_entity_id  uuid,
  period_key       text NOT NULL DEFAULT '',   -- e.g. fiscal year '1405'
  prefix           text NOT NULL,              -- 'SO-1405-'
  padding          smallint NOT NULL DEFAULT 6,
  next_value       bigint NOT NULL DEFAULT 1,
  gapless          boolean NOT NULL DEFAULT false,
  UNIQUE NULLS NOT DISTINCT (tenant_id, doc_type, legal_entity_id, period_key)
);

-- Allocates the next number inside the caller's transaction (row lock => gapless
-- for series marked gapless, because a rollback also rolls back the increment).
CREATE OR REPLACE FUNCTION core.next_number(p_doc_type text, p_legal_entity uuid, p_period text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE s core.number_series;
BEGIN
  UPDATE core.number_series
     SET next_value = next_value + 1
   WHERE tenant_id = core.current_tenant()
     AND doc_type = p_doc_type
     AND legal_entity_id IS NOT DISTINCT FROM p_legal_entity
     AND period_key = coalesce(p_period, '')
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'number series not configured for % / % / %', p_doc_type, p_legal_entity, p_period;
  END IF;
  RETURN s.prefix || lpad((s.next_value - 1)::text, s.padding, '0');
END $$;

CREATE TABLE core.document_links (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  source_type  text NOT NULL,
  source_id    uuid NOT NULL,
  target_type  text NOT NULL,
  target_id    uuid NOT NULL,
  link_kind    text NOT NULL DEFAULT 'derived',   -- derived / fulfils / reverses / references
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_type, source_id, target_type, target_id, link_kind)
);
CREATE INDEX ON core.document_links (tenant_id, target_type, target_id);

CREATE TABLE core.document_revisions (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  doc_type     text NOT NULL,
  doc_id       uuid NOT NULL,
  rev_no       int NOT NULL,
  label        text,
  reason       text,
  snapshot     jsonb,                 -- small docs inline
  snapshot_key text,                  -- large docs (engineering) in object storage
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  UNIQUE (tenant_id, doc_type, doc_id, rev_no),
  CHECK (snapshot IS NOT NULL OR snapshot_key IS NOT NULL)
);

CREATE TABLE core.attachments (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  owner_type   text NOT NULL,
  owner_id     uuid NOT NULL,
  category     text,
  file_name    text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   bigint NOT NULL,
  sha256       char(64) NOT NULL,
  storage_key  text NOT NULL,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid
);
CREATE INDEX ON core.attachments (tenant_id, owner_type, owner_id);

CREATE TABLE core.edit_locks (
  tenant_id       uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  resource        text NOT NULL,           -- 'eng.design:<id>'
  holder_user_id  uuid NOT NULL,
  acquired_at     timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,    -- extended by heartbeat
  PRIMARY KEY (tenant_id, resource)
);

CREATE TABLE core.custom_field_defs (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  entity      text NOT NULL,               -- 'sales.order'
  key         text NOT NULL,
  label_fa    text NOT NULL,
  label_en    text,
  type        text NOT NULL CHECK (type IN ('text','number','date','bool','enum','party','item','json')),
  validation  jsonb NOT NULL DEFAULT '{}',
  ui          jsonb NOT NULL DEFAULT '{}',
  owner_pack  text,
  UNIQUE (tenant_id, entity, key)
);

-- -----------------------------------------------------------------------------
-- Workflow engine + kartabl (inbox)
-- -----------------------------------------------------------------------------

CREATE TABLE core.wf_definitions (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid REFERENCES core.tenants(id) ON DELETE CASCADE,  -- NULL = shipped default
  key         text NOT NULL,
  version     int NOT NULL,
  doc_type    text NOT NULL,
  definition  jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (tenant_id, key, version)
);

CREATE TABLE core.wf_instances (
  id             uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id      uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  definition_id  uuid NOT NULL REFERENCES core.wf_definitions(id),
  doc_type       text NOT NULL,
  doc_id         uuid NOT NULL,
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running','approved','rejected','cancelled')),
  current_step   text,
  context        jsonb NOT NULL DEFAULT '{}',
  started_at     timestamptz NOT NULL DEFAULT now(),
  started_by     uuid,
  finished_at    timestamptz,
  UNIQUE (tenant_id, id)
);
CREATE INDEX ON core.wf_instances (tenant_id, doc_type, doc_id);

CREATE TABLE core.wf_tasks (                   -- one row = one item in someone's kartabl
  id              uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id       uuid NOT NULL,
  instance_id     uuid NOT NULL,
  step_id         text NOT NULL,
  assignee_user_id uuid,
  assignee_role_id uuid,
  delegated_from  uuid,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','rejected','returned','delegated','cancelled','expired')),
  due_at          timestamptz,
  decided_at      timestamptz,
  decided_by      uuid,
  comment         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, instance_id) REFERENCES core.wf_instances(tenant_id, id) ON DELETE CASCADE,
  CHECK (assignee_user_id IS NOT NULL OR assignee_role_id IS NOT NULL)
);
CREATE INDEX ON core.wf_tasks (tenant_id, assignee_user_id) WHERE status = 'open';

CREATE TABLE core.notifications (
  id          uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  kind        text NOT NULL,
  title       text NOT NULL,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON core.notifications (tenant_id, user_id, created_at DESC) WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- Audit (append-only, monthly partitions) and events (outbox / inbox)
-- -----------------------------------------------------------------------------

CREATE TABLE core.audit_log (
  id           uuid NOT NULL DEFAULT core.uuid_v7(),
  tenant_id    uuid,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_via    text NOT NULL DEFAULT 'web' CHECK (actor_via IN ('web','api','agent','system','integration')),
  action       text NOT NULL,        -- 'sales.order.confirm'
  entity_type  text NOT NULL,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip_address   inet,
  correlation_id uuid,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE TABLE core.audit_log_default PARTITION OF core.audit_log DEFAULT;
CREATE INDEX ON core.audit_log (tenant_id, entity_type, entity_id, at DESC);

CREATE OR REPLACE FUNCTION core.forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME;
END $$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON core.audit_log
  FOR EACH ROW EXECUTE FUNCTION core.forbid_mutation();

CREATE TABLE core.outbox_events (
  id              uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id       uuid NOT NULL,
  type            text NOT NULL,         -- 'sales.order.confirmed'
  version         smallint NOT NULL DEFAULT 1,
  subject_type    text NOT NULL,
  subject_id      uuid NOT NULL,
  payload         jsonb NOT NULL,
  correlation_id  uuid,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  published_at    timestamptz,
  attempts        int NOT NULL DEFAULT 0
);
CREATE INDEX outbox_unpublished ON core.outbox_events (occurred_at) WHERE published_at IS NULL;

CREATE OR REPLACE FUNCTION core.notify_outbox() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('outbox', NEW.id::text);
  RETURN NEW;
END $$;
CREATE TRIGGER outbox_notify AFTER INSERT ON core.outbox_events
  FOR EACH ROW EXECUTE FUNCTION core.notify_outbox();

CREATE TABLE core.inbox_events (
  consumer     text NOT NULL,
  event_id     uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer, event_id)
);

CREATE TABLE core.idempotency_keys (
  tenant_id     uuid NOT NULL,
  key           text NOT NULL,
  request_hash  text NOT NULL,
  response      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);

-- =============================================================================
-- FINANCE / GENERAL LEDGER
-- =============================================================================

CREATE TABLE fin.fiscal_years (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  legal_entity_id  uuid NOT NULL,
  code             text NOT NULL,                -- '1405'
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closing','closed')),
  UNIQUE (tenant_id, legal_entity_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES core.legal_entities(tenant_id, id),
  CHECK (end_date > start_date)
);

CREATE TABLE fin.fiscal_periods (
  id              uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id       uuid NOT NULL,
  fiscal_year_id  uuid NOT NULL,
  seq             smallint NOT NULL,             -- 1..12 (+13 for closing)
  name            text NOT NULL,                 -- 'فروردین ۱۴۰۵'
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','soft_closed','closed')),
  UNIQUE (tenant_id, fiscal_year_id, seq),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, fiscal_year_id) REFERENCES fin.fiscal_years(tenant_id, id) ON DELETE CASCADE
);

-- Chart of accounts: گروه → کل → معین (levels configurable). Only leaves post.
CREATE TABLE fin.accounts (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  legal_entity_id  uuid NOT NULL,
  parent_id        uuid,
  code             text NOT NULL,
  name             text NOT NULL,
  name_en          text,
  level            smallint NOT NULL,
  path             ltree NOT NULL,
  nature           text NOT NULL CHECK (nature IN ('asset','liability','equity','income','expense','memo')),
  normal_balance   char(1) NOT NULL CHECK (normal_balance IN ('D','C')),
  is_postable      boolean NOT NULL DEFAULT false,
  currency_code    char(3) REFERENCES core.currencies(code),   -- NULL = any
  is_active        boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, legal_entity_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES core.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES fin.accounts(tenant_id, id)
);
CREATE INDEX ON fin.accounts USING gist (path);

-- Dimensions: تفصیلی شناور, cost center, project, WBS, … one generic mechanism.
CREATE TABLE fin.dimension_types (
  id         uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  key        text NOT NULL,            -- 'party','cost_center','project','wbs','bank'
  name       text NOT NULL,
  source     text,                     -- 'core.parties' when values mirror another entity
  UNIQUE (tenant_id, key),
  UNIQUE (tenant_id, id)
);

CREATE TABLE fin.dimension_values (
  id                uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id         uuid NOT NULL,
  dimension_type_id uuid NOT NULL,
  code              text NOT NULL,
  name              text NOT NULL,
  ref_id            uuid,              -- party/project id when sourced
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, dimension_type_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, dimension_type_id) REFERENCES fin.dimension_types(tenant_id, id)
);

CREATE TABLE fin.account_dimension_rules (
  tenant_id          uuid NOT NULL,
  account_id         uuid NOT NULL,
  dimension_type_id  uuid NOT NULL,
  requirement        text NOT NULL DEFAULT 'required' CHECK (requirement IN ('required','optional','forbidden')),
  PRIMARY KEY (tenant_id, account_id, dimension_type_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES fin.accounts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, dimension_type_id) REFERENCES fin.dimension_types(tenant_id, id)
);

CREATE TABLE fin.journals (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  legal_entity_id  uuid NOT NULL,
  code             text NOT NULL,      -- 'GEN','SAL','PUR','INV','BNK','CLS'
  name             text NOT NULL,
  UNIQUE (tenant_id, legal_entity_id, code),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES core.legal_entities(tenant_id, id)
);

CREATE TABLE fin.journal_entries (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  legal_entity_id  uuid NOT NULL,
  journal_id       uuid NOT NULL,
  period_id        uuid NOT NULL,
  doc_no           text,                            -- assigned at post (gapless series)
  entry_date       date NOT NULL,
  description      text,
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','reversed')),
  source_type      text,                            -- 'fin.ar_invoice', 'inv.goods_receipt', 'manual'
  source_id        uuid,
  reversal_of      uuid,
  posted_at        timestamptz,
  posted_by        uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  version          int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, legal_entity_id, doc_no),
  FOREIGN KEY (tenant_id, journal_id) REFERENCES fin.journals(tenant_id, id),
  FOREIGN KEY (tenant_id, period_id)  REFERENCES fin.fiscal_periods(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of) REFERENCES fin.journal_entries(tenant_id, id),
  CHECK (status = 'draft' OR (doc_no IS NOT NULL AND posted_at IS NOT NULL))
);
CREATE INDEX ON fin.journal_entries (tenant_id, source_type, source_id);
CREATE INDEX ON fin.journal_entries (tenant_id, legal_entity_id, entry_date);

CREATE TABLE fin.journal_lines (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  entry_id         uuid NOT NULL,
  line_no          int NOT NULL,
  account_id       uuid NOT NULL,
  description      text,
  debit            numeric(20,4) NOT NULL DEFAULT 0 CHECK (debit  >= 0),
  credit           numeric(20,4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  currency_code    char(3) NOT NULL REFERENCES core.currencies(code),
  amount_currency  numeric(20,4) NOT NULL DEFAULT 0,   -- signed, in currency_code
  exchange_rate    numeric(20,10) NOT NULL DEFAULT 1,
  dimensions       jsonb NOT NULL DEFAULT '{}',        -- {"party": "<dim value id>", "project": "…"}
  quantity         numeric(20,6),
  uom_id           uuid,
  UNIQUE (tenant_id, entry_id, line_no),
  FOREIGN KEY (tenant_id, entry_id)   REFERENCES fin.journal_entries(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, account_id) REFERENCES fin.accounts(tenant_id, id),
  CHECK ((debit = 0) <> (credit = 0))                  -- exactly one side per line
);
CREATE INDEX ON fin.journal_lines (tenant_id, account_id);
CREATE INDEX ON fin.journal_lines USING gin (dimensions jsonb_path_ops);

-- Posting guard: balanced, open period, postable accounts, immutable once posted.
CREATE OR REPLACE FUNCTION fin.guard_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_period_status text;
  v_dr numeric; v_cr numeric; v_n int; v_bad int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'posted journal entry % cannot be deleted; reverse it', OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'posted' THEN
    -- the only allowed change to a posted entry: marking it reversed
    IF NEW.status = 'reversed'
       AND (to_jsonb(NEW) - 'status' - 'version') = (to_jsonb(OLD) - 'status' - 'version') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'posted journal entry % is immutable', OLD.id;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'reversed' THEN
    RAISE EXCEPTION 'reversed journal entry % is immutable', OLD.id;
  END IF;

  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status = 'draft') THEN
    SELECT status INTO v_period_status FROM fin.fiscal_periods
     WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id;
    IF v_period_status <> 'open' THEN
      RAISE EXCEPTION 'fiscal period is %, cannot post', v_period_status;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM fin.fiscal_periods
                    WHERE tenant_id = NEW.tenant_id AND id = NEW.period_id
                      AND NEW.entry_date BETWEEN start_date AND end_date) THEN
      RAISE EXCEPTION 'entry date % is outside its fiscal period', NEW.entry_date;
    END IF;
    SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*)
      INTO v_dr, v_cr, v_n
      FROM fin.journal_lines WHERE tenant_id = NEW.tenant_id AND entry_id = NEW.id;
    IF v_n < 2 OR v_dr <> v_cr THEN
      RAISE EXCEPTION 'journal entry % is not balanced (Dr % / Cr %, % lines)', NEW.id, v_dr, v_cr, v_n;
    END IF;
    SELECT count(*) INTO v_bad
      FROM fin.journal_lines l JOIN fin.accounts a ON a.tenant_id = l.tenant_id AND a.id = l.account_id
     WHERE l.tenant_id = NEW.tenant_id AND l.entry_id = NEW.id AND NOT a.is_postable;
    IF v_bad > 0 THEN
      RAISE EXCEPTION 'journal entry % posts to % non-postable account(s)', NEW.id, v_bad;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER journal_entry_guard BEFORE INSERT OR UPDATE OR DELETE ON fin.journal_entries
  FOR EACH ROW EXECUTE FUNCTION fin.guard_entry();

CREATE OR REPLACE FUNCTION fin.guard_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text; v_tenant uuid; v_entry uuid;
BEGIN
  v_tenant := CASE WHEN TG_OP = 'DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  v_entry  := CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_id  ELSE NEW.entry_id  END;
  SELECT status INTO v_status FROM fin.journal_entries WHERE tenant_id = v_tenant AND id = v_entry;
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'lines of a % journal entry cannot change', v_status;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER journal_line_guard BEFORE INSERT OR UPDATE OR DELETE ON fin.journal_lines
  FOR EACH ROW EXECUTE FUNCTION fin.guard_line();

-- Event → journal templates (section 12.1). Evaluated by the Finance module.
CREATE TABLE fin.posting_rules (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL REFERENCES core.tenants(id) ON DELETE CASCADE,
  legal_entity_id  uuid,
  event_type       text NOT NULL,        -- 'inv.goods.received'
  priority         int NOT NULL DEFAULT 100,
  condition        jsonb NOT NULL DEFAULT '{}',   -- e.g. item category, warehouse
  template         jsonb NOT NULL,        -- [{side:'D', account:'…', amount:'$.value', dims:{…}}]
  journal_code     text NOT NULL,
  is_active        boolean NOT NULL DEFAULT true
);

-- Cheques (چک) — received and issued, with lifecycle events.
CREATE TABLE fin.cheques (
  id               uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id        uuid NOT NULL,
  legal_entity_id  uuid NOT NULL,
  direction        text NOT NULL CHECK (direction IN ('received','issued')),
  sayad_id         text,                  -- شناسه صیاد
  serial_no        text NOT NULL,
  bank_name        text,
  party_id         uuid NOT NULL,
  amount           numeric(20,4) NOT NULL CHECK (amount > 0),
  currency_code    char(3) NOT NULL DEFAULT 'IRR' REFERENCES core.currencies(code),
  due_date         date NOT NULL,
  status           text NOT NULL DEFAULT 'in_hand'
                     CHECK (status IN ('in_hand','deposited','cleared','bounced','endorsed','returned','cancelled','issued','paid')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES core.legal_entities(tenant_id, id),
  FOREIGN KEY (tenant_id, party_id)        REFERENCES core.parties(tenant_id, id)
);

CREATE TABLE fin.cheque_events (
  id           uuid PRIMARY KEY DEFAULT core.uuid_v7(),
  tenant_id    uuid NOT NULL,
  cheque_id    uuid NOT NULL,
  from_status  text,
  to_status    text NOT NULL,
  event_date   date NOT NULL,
  entry_id     uuid,                 -- journal posted for this event
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, cheque_id) REFERENCES fin.cheques(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, entry_id)  REFERENCES fin.journal_entries(tenant_id, id)
);

-- =============================================================================
-- Row-level security: every table with a tenant_id gets the same policy.
-- (core.tenants / plans / users / currencies / permissions / feature_flags /
-- inbox_events are platform-level and guarded by the API instead.)
-- Rows with tenant_id NULL (platform defaults, platform-level audit) are
-- written only by the platform role, never by simorgh_app.
-- =============================================================================

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name, (c.is_nullable = 'YES') AS nullable
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
     WHERE c.column_name = 'tenant_id'
       AND c.table_schema IN ('core','fin')
       AND t.table_type = 'BASE TABLE'   -- includes partitions: a partition queried
                                         -- directly must not bypass the policy
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.table_schema, r.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',  r.table_schema, r.table_name);
    IF r.nullable THEN
      -- rows with tenant_id NULL are platform defaults: readable by all, writable by none
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I.%I
                        USING (tenant_id IS NULL OR tenant_id = core.current_tenant())
                        WITH CHECK (tenant_id = core.current_tenant())$p$,
                     r.table_schema, r.table_name);
    ELSE
      EXECUTE format($p$CREATE POLICY tenant_isolation ON %I.%I
                        USING (tenant_id = core.current_tenant())
                        WITH CHECK (tenant_id = core.current_tenant())$p$,
                     r.table_schema, r.table_name);
    END IF;
  END LOOP;
END $$;

-- CI check: every tenant-scoped table must have RLS forced and a policy.
CREATE OR REPLACE FUNCTION core.assert_rls() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE missing text;
BEGIN
  SELECT string_agg(format('%I.%I', n.nspname, c.relname), ', ') INTO missing
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE c.relkind IN ('r','p')
     AND n.nspname NOT IN ('pg_catalog','information_schema')
     AND EXISTS (SELECT 1 FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
          OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid));
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'tables without tenant RLS: %', missing;
  END IF;
END $$;

-- Seed: currencies used from day one.
INSERT INTO core.currencies (code, name, minor_unit) VALUES
  ('IRR', 'ریال ایران', 0),
  ('USD', 'US Dollar', 2),
  ('EUR', 'Euro', 2),
  ('AED', 'UAE Dirham', 2),
  ('CNY', 'Chinese Yuan', 2),
  ('TRY', 'Turkish Lira', 2)
ON CONFLICT DO NOTHING;
