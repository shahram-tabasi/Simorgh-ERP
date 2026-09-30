// Open-source policy check (ADR-16), run in CI.
//
//  1. every npm package in the workspace carries an approved license
//     (an SPDX expression: OR needs one approved choice, AND needs all);
//  2. every container image used by compose, CI or a Dockerfile is listed in
//     tools/approved-components.json.
//
// Anything else fails the build, so a non-open-source component cannot slip
// in unnoticed: it has to be added to approved-components.json with a reason,
// which is a decision somebody makes on purpose.
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const policy = JSON.parse(await readFile(join(root, 'tools/approved-components.json'), 'utf8'));
const L = policy.licenses;
const ok = new Set([...L.permissive, ...L.weakCopyleft, ...L.data]);
const problems = [];

// ── 1. npm packages ─────────────────────────────────────────────────────────
function approved(expr, pkg) {
  const e = expr.replace(/[()]/g, '').trim();
  if (e.includes(' OR ')) return e.split(' OR ').some((x) => approved(x, pkg));
  if (e.includes(' AND ')) return e.split(' AND ').every((x) => approved(x, pkg));
  if (ok.has(e)) return true;
  return Boolean(policy.npmExceptions[pkg]);
}

const raw = execFileSync('pnpm', ['licenses', 'list', '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const byLicense = JSON.parse(raw);
let packages = 0;
for (const [license, pkgs] of Object.entries(byLicense)) {
  for (const p of pkgs) {
    packages++;
    if (!approved(license, p.name)) {
      const kind = L.notOpenSource.includes(license)
        ? 'is not open source'
        : L.forbiddenInCode.includes(license)
          ? 'is strong copyleft and would bind Simorgh code'
          : L.needsException.includes(license)
            ? 'needs a recorded exception'
            : 'is not on the approved list';
      problems.push(`npm ${p.name}@${p.versions?.join(',') ?? '?'}: license "${license}" ${kind}`);
    }
  }
}

// ── 2. container images ─────────────────────────────────────────────────────
const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.turbo']);
async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ya?ml)$/.test(e.name) || e.name === 'Dockerfile' || e.name.endsWith('.Dockerfile')) yield p;
  }
}

const approvedImages = policy.images.map((i) => i.image);
const imageRe = /^\s*(?:-\s*)?image:\s*['"]?([^\s'"#]+)|^\s*FROM\s+(?:--platform=\S+\s+)?([^\s]+)/gim;
let images = 0;
for (const top of ['infra', '.github']) {
  for await (const f of walk(join(root, top))) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(imageRe)) {
      const ref = m[1] ?? m[2];
      if (!ref || ref.startsWith('$') || /^[a-z0-9_-]+$/.test(ref) && src.includes(` AS ${ref}`)) continue;
      images++;
      const name = ref.replace(/@sha256:.*$/, '').replace(/:[^/]*$/, '').replace(/^docker\.io\/(library\/)?/, '');
      if (!approvedImages.includes(name)) {
        problems.push(`${relative(root, f)}: image "${ref}" is not in tools/approved-components.json`);
      }
    }
  }
}

if (problems.length) {
  console.error(`open-source policy violations (${problems.length}):\n  ${problems.join('\n  ')}`);
  console.error('\nIf this is intended, add it to tools/approved-components.json with the reason (ADR-16).');
  process.exit(1);
}
console.log(`open-source policy: ok (${packages} npm packages, ${images} image references)`);
