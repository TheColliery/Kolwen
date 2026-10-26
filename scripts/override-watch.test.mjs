// The removal watch on package.json's `overrides` (scripts/lib/override-watch.mjs). The real files must hold: no override at or past the version its dependent
// already declares, and no pin the watch cannot read. The planted rows copy the real lockfile in memory, change one declared pin, and expect the watch to name
// the override it now meets; they are the witness that the watch fires, and they need no file on disk.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { staleOverrides, DEPENDENT } = await import(pathToFileURL(join(ROOT, 'scripts/lib/override-watch.mjs')).href);
const pkgText = readFileSync(join(ROOT, 'package.json'), 'utf8');
const lockText = readFileSync(join(ROOT, 'package-lock.json'), 'utf8');

// The lockfile with the dependent's declared pin of one package changed.
function plantPin(name, version) {
  const lock = JSON.parse(lockText);
  lock.packages[DEPENDENT].dependencies[name] = version;
  return JSON.stringify(lock);
}

test('the real overrides are not met by the versions their dependent declares, and every pin is read', () => {
  const { stale, unread } = staleOverrides(pkgText, lockText);
  for (const s of stale) assert.fail(`remove the ${s.name} override: ${DEPENDENT} already declares ${s.name} ${s.pin}, which meets the override ${s.override}`);
  assert.deepEqual(unread, [], 'a pin the watch cannot read as an exact version: ' + JSON.stringify(unread));
});

// The rows below plant one undici pin; the real sharp override is named in every result, so each row reads the entries of the name it plants.
const named = (list, name) => list.filter(x => x.name === name);

test('an undici override the dependent now meets is named: "remove the undici override"', () => {
  const { stale } = staleOverrides(pkgText, plantPin('undici', '7.30.1'));
  assert.ok(named(stale, 'undici').length === 1, 'undici is named: ' + JSON.stringify(stale));
});

test('an undici pin ABOVE the override is named too (the override would hold it back)', () => {
  const { stale } = staleOverrides(pkgText, plantPin('undici', '7.31.0'));
  assert.equal(named(stale, 'undici').length, 1, JSON.stringify(stale));
});

test('an undici pin still BELOW the override is clear: the override is still needed', () => {
  const { stale, unread } = staleOverrides(pkgText, plantPin('undici', '7.29.9'));
  assert.deepEqual(named(stale, 'undici'), []);
  assert.deepEqual(named(unread, 'undici'), []);
});

// The sharp override was dropped when its dependent came to declare the same version: the planted package.json carries it back, and the watch must name it.
test('a sharp override whose dependent already declares the same version is named: "remove the sharp override"', () => {
  const planted = JSON.stringify({ ...JSON.parse(pkgText), overrides: { sharp: '0.35.5', undici: '7.30.1' } });
  const { stale } = staleOverrides(planted, lockText);
  assert.equal(named(stale, 'sharp').length, 1, JSON.stringify(stale));
});

test('a range pin is unread, never clear', () => {
  const { stale, unread } = staleOverrides(pkgText, plantPin('undici', '^7.30.1'));
  assert.deepEqual(named(stale, 'undici'), []);
  assert.equal(named(unread, 'undici').length, 1, JSON.stringify(unread));
});

// A watch that reads nothing must not read as clear. Each row takes the real lockfile and removes what the watch reads from.
test('a dependent gone from the lockfile leaves its override unread, never clear', () => {
  const lock = JSON.parse(lockText);
  delete lock.packages[DEPENDENT];
  const { stale, unread } = staleOverrides(pkgText, JSON.stringify(lock));
  assert.deepEqual(stale, []);
  assert.equal(named(unread, 'undici').length, 1, JSON.stringify(unread));
  assert.match(named(unread, 'undici')[0].reason, /no entry/, JSON.stringify(unread));
});

test('a pin the dependent no longer declares leaves its override unread, never clear', () => {
  const lock = JSON.parse(lockText);
  delete lock.packages[DEPENDENT].dependencies.undici;
  const { stale, unread } = staleOverrides(pkgText, JSON.stringify(lock));
  assert.deepEqual(named(stale, 'undici'), []);
  assert.equal(named(unread, 'undici').length, 1, JSON.stringify(unread));
  assert.match(named(unread, 'undici')[0].reason, /does not name/, JSON.stringify(unread));
});

test('a pin the dependent declares under optionalDependencies is read as a pin', () => {
  const lock = JSON.parse(lockText);
  const dep = lock.packages[DEPENDENT];
  delete dep.dependencies.undici;
  dep.optionalDependencies = { undici: '7.30.1' };
  const { stale } = staleOverrides(pkgText, JSON.stringify(lock));
  assert.equal(named(stale, 'undici').length, 1, JSON.stringify(stale));
});

test('a pin the dependent declares under peerDependencies is read as a pin', () => {
  const lock = JSON.parse(lockText);
  const dep = lock.packages[DEPENDENT];
  delete dep.dependencies.undici;
  dep.peerDependencies = { undici: '7.30.1' };
  const { stale } = staleOverrides(pkgText, JSON.stringify(lock));
  assert.equal(named(stale, 'undici').length, 1, JSON.stringify(stale));
});
