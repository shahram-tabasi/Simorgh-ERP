#!/bin/sh
# Runs once, on the first start of the postgres container.
# Same roles as packages/db/sql/roles.sql, with their development passwords.
set -e
psql -v ON_ERROR_STOP=1 -U postgres -d "$POSTGRES_DB" <<SQL
CREATE ROLE simorgh_app LOGIN NOBYPASSRLS PASSWORD '${APP_DB_PASSWORD}';
CREATE ROLE simorgh_worker LOGIN BYPASSRLS PASSWORD '${WORKER_DB_PASSWORD}';
SQL
