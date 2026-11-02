// The version and tag check of the npm publish gate (.github/workflows/publish-npm.yml). A release tag must be exactly npm-vX.Y.Z, digits only, and
// npm/package.json must declare that same version. Anything else fails closed: a tag of another shape, a package.json that is not JSON, or a version
// that is not a string. Zero dependencies, Node builtins only (Phoenix #2). The tag comes in as an argument, read from the workflow's environment,
// never interpolated into a shell string.
//
//   node scripts/npm-release-guard.mjs <tag> <path to package.json>     exit 0: release OK; exit 1: refused; exit 2: usage
//
// Tested by scripts/npm-release-guard.test.mjs.
import { readFileSync } from 'node:fs';
import { isMainModule } from './lib/entry-guard.mjs';

const TAG_SHAPE = /^npm-v([0-9]+\.[0-9]+\.[0-9]+)$/;

export function checkRelease(tag, packageJsonText) {
  const m = typeof tag === 'string' ? TAG_SHAPE.exec(tag) : null;
  if (!m) return { ok: false, reason: `'${tag}' is not an npm-vX.Y.Z tag (digits only, no suffix)` };
  let pkg;
  try { pkg = JSON.parse(packageJsonText); } catch { return { ok: false, reason: 'package.json is not valid JSON' }; }
  const have = pkg && typeof pkg === 'object' && typeof pkg.version === 'string' ? pkg.version : null;
  if (have === null) return { ok: false, reason: 'package.json has no readable version string' };
  if (have !== m[1]) return { ok: false, reason: `${tag} names version ${m[1]} but package.json declares ${have}` };
  return { ok: true, version: have };
}

function main() {
  const [tag, path] = process.argv.slice(2);
  if (tag === undefined || path === undefined) {
    console.error('usage: node scripts/npm-release-guard.mjs <tag> <path to package.json>');
    process.exitCode = 2;
    return;
  }
  let text;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    console.error(`refusing to publish: cannot read ${path} (${e.code ?? 'read failed'})`);
    process.exitCode = 1;
    return;
  }
  const r = checkRelease(tag, text);
  if (!r.ok) { console.error('refusing to publish: ' + r.reason); process.exitCode = 1; return; }
  console.log(`${tag} matches ${path} version ${r.version}.`);
}

if (isMainModule(import.meta.url)) main();
