// Architecture boundary check (architecture §3, §19), run in CI.
//
//  1. packages/* never import apps/* — libraries do not know their users.
//  2. the web app never imports server-side packages (db) — it talks to the API.
//  3. inside apps/api, a business module under src/modules/<m>/ may import
//     another module only through its public/ folder; the kernel may be used
//     by everyone but never imports a business module.
//  4. nothing imports industry-packs/* from the core (packs depend on core,
//     never the other way round).
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, dirname, sep } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);

async function* files(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) yield p;
  }
}

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const violations = [];

function check(file, spec) {
  const rel = relative(root, file).split(sep).join('/');
  const target = spec.startsWith('.') ? relative(root, resolve(dirname(file), spec)).split(sep).join('/') : spec;

  if (rel.startsWith('packages/') && (target.startsWith('apps/') || target.startsWith('@simorgh/api') || target.startsWith('@simorgh/web'))) {
    violations.push(`${rel}: a package must not import an app (${spec})`);
  }
  if (rel.startsWith('apps/web/') && (target === '@simorgh/db' || target.startsWith('@simorgh/db/'))) {
    violations.push(`${rel}: the web app must go through the API, not the database (${spec})`);
  }
  if (!rel.startsWith('industry-packs/') && (target.startsWith('industry-packs/') || target.startsWith('@simorgh/pack-'))) {
    violations.push(`${rel}: core code must not depend on an industry pack (${spec})`);
  }
  const mod = /^apps\/api\/src\/modules\/([^/]+)\//.exec(rel)?.[1];
  const targetMod = /^apps\/api\/src\/modules\/([^/]+)\/(.*)$/.exec(target);
  if (rel.startsWith('apps/api/src/kernel/') && targetMod) {
    violations.push(`${rel}: the kernel must not import a business module (${spec})`);
  }
  if (mod && targetMod && targetMod[1] !== mod && !targetMod[2].startsWith('public/')) {
    violations.push(`${rel}: module "${mod}" may use "${targetMod[1]}" only through its public/ API (${spec})`);
  }
}

for (const top of ['apps', 'packages', 'industry-packs']) {
  try {
    for await (const f of files(join(root, top))) {
      const src = await readFile(f, 'utf8');
      for (const m of src.matchAll(IMPORT_RE)) check(f, m[1] ?? m[2]);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

if (violations.length) {
  console.error(`architecture boundary violations (${violations.length}):\n  ${violations.join('\n  ')}`);
  process.exit(1);
}
console.log('architecture boundaries: ok');
