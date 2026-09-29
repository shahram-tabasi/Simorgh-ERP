-- Cluster-level roles, created once per PostgreSQL cluster by infrastructure
-- (docker-compose init, Helm job, or a DBA) BEFORE migrations run.
-- Passwords are set separately: ALTER ROLE simorgh_app PASSWORD '…';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_app') THEN
    CREATE ROLE simorgh_app LOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'simorgh_worker') THEN
    CREATE ROLE simorgh_worker LOGIN BYPASSRLS;
  END IF;
END $$;
