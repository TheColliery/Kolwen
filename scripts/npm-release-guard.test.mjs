// Tests for scripts/npm-release-guard.mjs, the version and tag check that publish-npm.yml runs before it publishes: the tag must be npm-vX.Y.Z
// (digits only), and it must name the version npm/package.json declares. Fail closed on every other shape, and on a version that cannot be read.
// Run: node --test scripts/npm-release-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease, checkRun, checkTagName } from './npm-release-guard.mjs';

const pkg = version => JSON.stringify({ name: 'kolwen', version });
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const runOf = over => ({ tag: 'npm-v0.0.2', eventName: 'workflow_dispatch', ref: 'refs/tags/npm-v0.0.2', sha: COMMIT, commit: COMMIT, ...over });

// Binding the run to its tag (review of PR #131): npm's provenance takes the run's ref and commit, so the run must be the released tag and the verified commit.
test('a run started on the tag, at the verified commit, passes, by dispatch and by a tag push', () => {
  assert.deepEqual(checkRun(runOf({})), { ok: true });
  assert.deepEqual(checkRun(runOf({ eventName: 'push' })), { ok: true });
});

test('a dispatch started on a branch is refused, and the message tells the operator to start the run from the tag', () => {
  const r = checkRun(runOf({ ref: 'refs/heads/main' }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /started on refs\/heads\/main, not on the tag npm-v0\.0\.2/);
  assert.match(r.reason, /start the run from the tag npm-v0\.0\.2/);
});

test('a run whose ref names another tag, or no tag, is refused', () => {
  assert.equal(checkRun(runOf({ ref: 'refs/tags/npm-v0.0.3' })).ok, false, 'a different tag');
  assert.equal(checkRun(runOf({ ref: '' })).ok, false, 'no ref');
  assert.equal(checkRun(runOf({ eventName: 'push', ref: 'refs/heads/npm-v0.0.2' })).ok, false, 'a branch named like the tag');
});

test('a run whose commit is not the verified tag commit is refused, by either event', () => {
  const other = 'fedcba9876543210fedcba9876543210fedcba98';
  assert.equal(checkRun(runOf({ sha: other })).ok, false, 'dispatch');
  assert.equal(checkRun(runOf({ eventName: 'push', sha: other })).ok, false, 'push');
});

test('an event other than dispatch or a tag push is refused', () => {
  assert.equal(checkRun(runOf({ eventName: 'schedule' })).ok, false);
  assert.equal(checkRun(runOf({ eventName: '' })).ok, false);
});

// The tag object's own name (review of PR #131): the API's tag object carries its name in `tag`; it must be the TAG the gate read, or the gate is not checking that tag.
test('a tag object whose embedded name is the tag passes', () => {
  assert.deepEqual(checkTagName('npm-v0.0.2', 'npm-v0.0.2'), { ok: true });
});

test('a tag object whose embedded name differs, or is missing, or is not text, is refused (fail closed)', () => {
  assert.equal(checkTagName('npm-v0.0.2', 'npm-v0.0.3').ok, false, 'a different name');
  // The REASON, not only the verdict: an empty, "null" or absent name is the unreadable-name branch, and only that branch says so.
  assert.match(checkTagName('npm-v0.0.2', '').reason, /carries no readable name/, 'empty: the field was absent');
  assert.match(checkTagName('npm-v0.0.2', 'null').reason, /carries no readable name/, 'jq printed null');
  assert.match(checkTagName('npm-v0.0.2', undefined).reason, /carries no readable name/, 'no value at all');
  assert.match(checkTagName('npm-v0.0.2', 'npm-v0.0.3').reason, /reads npm-v0\.0\.3, not npm-v0\.0\.2/, 'a different name gets the mismatch reason');
});

test('a clean npm-vX.Y.Z tag that names the declared version passes, and reports the version', () => {
  assert.deepEqual(checkRelease('npm-v0.0.2', pkg('0.0.2')), { ok: true, version: '0.0.2' });
});

test('a tag that names a different version than package.json declares is refused, and the reason names both', () => {
  const r = checkRelease('npm-v0.0.3', pkg('0.0.2'));
  assert.equal(r.ok, false);
  assert.match(r.reason, /npm-v0\.0\.3 names version 0\.0\.3 but package\.json declares 0\.0\.2/);
});

test('every tag that is not exactly npm-vX.Y.Z is refused, whatever it contains', () => {
  for (const tag of ['npm-v0.0.2-beta', 'npm-v0.0.2.dev1', 'npm-v1', 'npm-v0.0', 'py-v0.0.2', 'v0.0.2', 'npm-v0.0.2\n', 'npm-v0.0.2 ', 'npm-v0.0.2;rm', 'NPM-v0.0.2', '', undefined, null]) {
    const r = checkRelease(tag, pkg('0.0.2'));
    assert.equal(r.ok, false, JSON.stringify(tag));
  }
});

test('a package.json whose version cannot be read is refused: missing, not a string, not JSON, or not an object', () => {
  assert.equal(checkRelease('npm-v0.0.2', JSON.stringify({ name: 'kolwen' })).ok, false, 'no version');
  assert.equal(checkRelease('npm-v0.0.2', JSON.stringify({ version: 2 })).ok, false, 'a number');
  assert.equal(checkRelease('npm-v0.0.2', JSON.stringify({ version: null })).ok, false, 'null');
  assert.equal(checkRelease('npm-v0.0.2', '{ not json').ok, false, 'not JSON');
  assert.equal(checkRelease('npm-v0.0.2', 'null').ok, false, 'JSON null');
});
