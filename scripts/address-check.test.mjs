// Tests for scripts/address-check.mjs: the verdict logic against a fake rules list (no network, no token) and the scan of the built pages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// An address built from its parts: the fixtures are made up, and no literal address sits in this file.
const at = (local, domain = 'kolwen.com') => local + String.fromCharCode(64) + domain;
const { addressesIn, judge, publishedAddresses } = await import(new URL('./address-check.mjs', import.meta.url));

const rule = (to, enabled = true, actions = [{ type: 'forward', value: [at('x', 'example.test')] }]) => ({ enabled, matchers: [{ type: 'literal', field: 'to', value: to }], actions });
const verdictOf = (list, rules, catchAll) => Object.fromEntries(judge(list, rules, catchAll).map(v => [v.address, v.verdict]));

test('an address with an enabled forwarding rule routes, one without a rule fails', () => {
  const v = verdictOf([at('info'), at('ghost')], [rule(at('info'))], { enabled: true, actions: [{ type: 'drop' }] });
  assert.deepEqual(v, { [at('info')]: 'ROUTES', [at('ghost')]: 'NO RULE' });
  assert.deepEqual(judge([at('info')], [rule(at('info'))], null).map(x => x.ok), [true]);
  assert.deepEqual(judge([at('ghost')], [], null).map(x => x.ok), [false]);
});

test('a disabled rule and a rule that only drops are not routes, and say which', () => {
  const rules = [rule(at('a'), false), rule(at('b'), true, [{ type: 'drop' }]), rule(at('c'), false, [{ type: 'drop' }])];
  assert.deepEqual(verdictOf([at('a'), at('b'), at('c')], rules, null), { [at('a')]: 'DISABLED', [at('b')]: 'DROPS', [at('c')]: 'DISABLED' });
});

test('the catch-all rescues an address only when it is enabled and forwards; a dropping or disabled catch-all rescues none', () => {
  assert.equal(verdictOf([at('x')], [], { enabled: true, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] })[at('x')], 'CATCH-ALL');
  assert.equal(verdictOf([at('x')], [], { enabled: true, actions: [{ type: 'drop' }] })[at('x')], 'NO RULE');
  assert.equal(verdictOf([at('x')], [], { enabled: false, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] })[at('x')], 'NO RULE');
});

test('a rule counts for its own address only: matcher type, field and case are read exactly', () => {
  const regexish = { enabled: true, matchers: [{ type: 'all' }], actions: [{ type: 'forward', value: [at('y', 'example.test')] }] };
  const other = { enabled: true, matchers: [{ type: 'literal', field: 'from', value: at('a') }], actions: [{ type: 'forward', value: [at('y', 'example.test')] }] };
  assert.equal(verdictOf([at('a')], [regexish, other], null)[at('a')], 'NO RULE');
  assert.equal(verdictOf([at('a')], [rule(at('A', 'Kolwen.com'))], null)[at('a')], 'ROUTES', 'addresses compare in lower case');
  assert.equal(verdictOf([at('a')], [{ enabled: true, actions: [{ type: 'worker', value: ['w'] }], matchers: [{ type: 'literal', field: 'to', value: at('a') }] }], null)[at('a')], 'ROUTES', 'a worker action delivers');
});

test('addressesIn finds every @kolwen.com address, mailto links included, once, sorted, lower case, and no other domain', () => {
  const text = `<a href="mailto:${at('Info')}">x</a> ${at('support')} ${at('info')} <a href="mailto:${at('me', 'example.com')}">${at('me', 'example.com')}</a> ${at('not-an-address', 'kolwen.community')} ${at('appeals')}.`;
  assert.deepEqual(addressesIn(text), [at('appeals'), at('info'), at('support')]);
  assert.deepEqual(addressesIn('no address here'), []);
});

test('publishedAddresses reads web/*.html and web/llms.txt of a root and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'address-check-'));
  try {
    mkdirSync(join(dir, 'web/sub'), { recursive: true });
    writeFileSync(join(dir, 'web/a.html'), `<a href="mailto:${at('b')}">b</a>`);
    writeFileSync(join(dir, 'web/llms.txt'), 'write to ' + at('a'));
    writeFileSync(join(dir, 'web/notes.md'), at('hidden'));
    writeFileSync(join(dir, 'web/sub/deep.html'), at('deep'));
    assert.deepEqual(publishedAddresses(dir), [at('a'), at('b')]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the real tree publishes at least one @kolwen.com address, so the check is never empty', () => {
  assert.ok(publishedAddresses(resolve(HERE, '..')).length >= 1);
});

// Only the two flags that never reach the network are run here: a run with no flag would read a real token and ask Cloudflare.
test('an unknown flag exits 2 and --help prints usage and exits 0, both before any credential is read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'address-check-env-'));
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir, XDG_CONFIG_HOME: dir };
    const run = (...a) => spawnSync(process.execPath, ['--max-old-space-size=2048', join(HERE, 'address-check.mjs'), ...a], { encoding: 'utf8', timeout: 60000, env });
    assert.equal(run('--nope').status, 2);
    const h = run('--help');
    assert.equal(h.status, 0);
    assert.match(h.stdout, /usage: node scripts\/address-check\.mjs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
