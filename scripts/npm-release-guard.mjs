// The checks of the npm publish gate (.github/workflows/publish-npm.yml). Four refusals, each with a stated reason, all fail closed:
//   checkRelease  a release tag must be exactly npm-vX.Y.Z, digits only, and npm/package.json must declare that same version;
//   checkTagName  the annotated tag object the API returned must carry the TAG the gate read in its own `tag` name;
//   checkRun      the run must be a workflow_dispatch or a tag push, its ref must be refs/tags/<TAG>, and its commit must be the verified tag commit.
// npm takes the run's ref and commit for provenance, so a run that is not on the released tag and commit is refused before anything is published.
// Zero dependencies, Node builtins only (Phoenix #2). Values reach this script through its arguments and the workflow's environment, never
// interpolated into a shell string.
//
//   node scripts/npm-release-guard.mjs <tag> <path to package.json>     the version check; exit 0 OK, 1 refused, 2 usage
//   node scripts/npm-release-guard.mjs run                              the run and tag-name checks, read from the environment
//                                                                       (EVENT_NAME, GITHUB_REF, GITHUB_SHA, TAG, COMMIT, TAG_OBJECT_NAME)
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

// The name the tag object carries (`tag` in the API's git/tags answer) must be the TAG the gate read: absent, empty or non-text is refused.
export function checkTagName(tag, objectName) {
  if (typeof objectName !== 'string' || objectName === '' || objectName === 'null') {
    return { ok: false, reason: `the tag object for ${tag} carries no readable name` };
  }
  if (objectName !== tag) return { ok: false, reason: `the tag object reads ${objectName}, not ${tag}: the gate read a different tag's object` };
  return { ok: true };
}

// The run is bound to the tag: a dispatch or a tag push, on refs/tags/<TAG>, at the verified tag commit. A dispatch from a branch is refused
// with the way to start it from the tag.
export function checkRun({ tag, eventName, ref, sha, commit }) {
  if (eventName !== 'workflow_dispatch' && eventName !== 'push') {
    return { ok: false, reason: `this run's event is '${eventName}': only a workflow_dispatch or a tag push may publish` };
  }
  if (ref !== `refs/tags/${tag}`) {
    return { ok: false, reason: `this run started on ${ref || '<no ref>'}, not on the tag ${tag}; start the run from the tag ${tag} (the Run workflow form's "Use workflow from" set to the tag), or push the tag` };
  }
  if (!commit || sha !== commit) {
    return { ok: false, reason: `this run's commit ${sha} is not the verified commit of ${tag} (${commit || '<none>'})` };
  }
  return { ok: true };
}

function runMain() {
  const env = process.env;
  const bad = [checkTagName(env.TAG, env.TAG_OBJECT_NAME), checkRun({
    tag: env.TAG, eventName: env.EVENT_NAME, ref: env.GITHUB_REF, sha: env.GITHUB_SHA, commit: env.COMMIT,
  })].find(r => !r.ok);
  if (bad) { console.error('refusing to publish: ' + bad.reason); process.exitCode = 1; return; }
  console.log(`${env.TAG} is bound to this run: event ${env.EVENT_NAME}, ref ${env.GITHUB_REF}, commit ${env.GITHUB_SHA}.`);
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'run') { runMain(); return; }
  const [tag, path] = args;
  if (tag === undefined || path === undefined) {
    console.error('usage: node scripts/npm-release-guard.mjs <tag> <path to package.json>   |   node scripts/npm-release-guard.mjs run');
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
