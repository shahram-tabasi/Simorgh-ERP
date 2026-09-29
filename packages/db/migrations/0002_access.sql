-- =============================================================================
-- 0002 — database roles' access and the audit-log visibility rule.
--
-- Roles are cluster objects and are created by infrastructure before the first
-- migration (packages/db/sql/roles.sql). This migration only grants to them.
--
--   simorgh_app     the API. Not an owner, no BYPASSRLS: every tenant table is
--                   filtered by the tenant_isolation policies.
--   simorgh_worker  the outbox relay. BYPASSRLS (it publishes every tenant's
--                   events) but granted nothing except the outbox/inbox tables.
-- =============================================================================

-- Audit rows are visible only in their own context: a tenant sees its rows, the
-- platform context (no app.tenant_id) sees and writes only platform rows. The
-- generic nullable-tenant policy from 0001 would have let every tenant read the
-- platform's audit trail.
DROP POLICY tenant_isolation ON core.audit_log;
CREATE POLICY tenant_isolation ON core.audit_log
  USING      (tenant_id IS NOT DISTINCT FROM core.current_tenant())
  WITH CHECK (tenant_id IS NOT DISTINCT FROM core.current_tenant());
DROP POLICY tenant_isolation ON core.audit_log_default;
CREATE POLICY tenant_isolation ON core.audit_log_default
  USING      (tenant_id IS NOT DISTINCT FROM core.current_tenant())
  WITH CHECK (tenant_id IS NOT DISTINCT FROM core.current_tenant());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_app') THEN
    GRANT USAGE ON SCHEMA core, fin TO simorgh_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, fin TO simorgh_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, fin TO simorgh_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, fin TO simorgh_app;
    -- append-only is enforced by trigger too; the grant says it twice
    REVOKE UPDATE, DELETE ON core.audit_log, core.audit_log_default FROM simorgh_app;
    -- the relay owns publication state
    REVOKE UPDATE, DELETE ON core.outbox_events FROM simorgh_app;

    -- tables created by later migrations (run as this same owner) are granted automatically
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA core, fin
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO simorgh_app', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA core, fin
                    GRANT USAGE, SELECT ON SEQUENCES TO simorgh_app', current_user);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA core, fin
                    GRANT EXECUTE ON FUNCTIONS TO simorgh_app', current_user);
  ELSE
    RAISE WARNING 'role simorgh_app does not exist; run packages/db/sql/roles.sql and re-run grants';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_worker') THEN
    GRANT USAGE ON SCHEMA core TO simorgh_worker;
    GRANT SELECT, UPDATE ON core.outbox_events TO simorgh_worker;
    GRANT SELECT, INSERT ON core.inbox_events TO simorgh_worker;
  ELSE
    RAISE WARNING 'role simorgh_worker does not exist; run packages/db/sql/roles.sql and re-run grants';
  END IF;
END $$;
