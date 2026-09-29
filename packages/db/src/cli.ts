import { ensureRoles, migrate } from './migrate.js';

const url = process.env.DATABASE_URL_OWNER;
if (!url) {
  console.error('DATABASE_URL_OWNER is not set (the schema owner connection, not the app role).');
  process.exit(1);
}
if (process.argv.includes('--roles')) {
  await ensureRoles(url);
  console.log('roles ensured');
}
const { applied, skipped } = await migrate(url);
console.log(`migrations applied: ${applied.length ? applied.join(', ') : 'none'} (already applied: ${skipped.length})`);
