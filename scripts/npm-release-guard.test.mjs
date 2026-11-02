// Tests for scripts/npm-release-guard.mjs, the version and tag check that publish-npm.yml runs before it publishes: the tag must be npm-vX.Y.Z
// (digits only), and it must name the version npm/package.json declares. Fail closed on every other shape, and on a version that cannot be read.
// Run: node --test scripts/npm-release-guard.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkRelease } from './npm-release-guard.mjs';

const pkg = version => JSON.stringify({ name: 'kolwen', version });

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
