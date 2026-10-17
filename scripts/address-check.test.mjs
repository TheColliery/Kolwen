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
const { addressesIn, judge, catchAllNote, publishedAddresses, fetchAllRules, MAX_PAGES } = await import(new URL('./address-check.mjs', import.meta.url));

const rule = (to, enabled = true, actions = [{ type: 'forward', value: [at('x', 'example.test')] }], priority = 0) => ({ enabled, priority, matchers: [{ type: 'literal', field: 'to', value: to }], actions });
const DROP = [{ type: 'drop' }];
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

test('the catch-all never counts: an address with no enabled rule of its own fails whatever the catch-all does', () => {
  const forward = { enabled: true, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] };
  const drop = { enabled: true, actions: [{ type: 'drop' }] };
  const off = { enabled: false, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] };
  for (const [what, catchAll] of [['forwarding', forward], ['dropping', drop], ['disabled', off], ['absent', null]]) {
    assert.equal(verdictOf([at('x')], [], catchAll)[at('x')], 'NO RULE', what + ' catch-all');
    assert.deepEqual(judge([at('x')], [], catchAll).map(v => v.ok), [false], what + ' catch-all fails the address');
  }
  // the reviewer's fixture: a forwarding rule, a disabled one, a drop, and an address with none, under a FORWARDING catch-all
  const rules = [rule(at('a')), rule(at('b'), false), rule(at('c'), true, [{ type: 'drop' }])];
  assert.deepEqual(verdictOf([at('a'), at('b'), at('c'), at('d')], rules, forward), { [at('a')]: 'ROUTES', [at('b')]: 'DISABLED', [at('c')]: 'DROPS', [at('d')]: 'NO RULE' });
});

test('catchAllNote only describes the catch-all (information, never a pass): forwards, drops, disabled or absent, and no destination', () => {
  assert.equal(catchAllNote({ enabled: true, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] }), 'forwards');
  assert.equal(catchAllNote({ enabled: true, actions: [{ type: 'drop' }] }), 'drops');
  assert.equal(catchAllNote({ enabled: false, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] }), 'disabled');
  assert.equal(catchAllNote(null), 'absent');
  assert.ok(!String(catchAllNote({ enabled: true, actions: [{ type: 'forward', value: [at('y', 'example.test')] }] })).includes('@'));
});

// The order Cloudflare applies: for rules with the same pattern only the one shown first processes the mail (developers.cloudflare.com/email-routing/setup/email-routing-addresses/,
// read 2026-10-17). The zone's own data (read the same day) shows the direction of `priority`: every literal rule 0, the catch-all 2147483647 and listed last, so a LOWER number runs first;
// rules with the same priority keep the order the API lists them.
test('the first enabled rule for an address in Cloudflare order decides: a drop before a forward drops, and a forward with a shadowed drop is a conflict', () => {
  const x = at('x'), y = at('y'), z = at('z'), w = at('w');
  const rules = [
    rule(x, true, DROP), rule(x),                          // x: drop listed first, forward after, same priority -> the drop processes the mail
    rule(y, true, undefined, 5), rule(y, true, DROP, 1),   // y: the forward is listed first but the drop has the lower priority number -> the drop runs first
    rule(z, true, undefined, 1), rule(z, true, DROP, 5),   // z: the forward runs first, a drop behind it is shadowed -> a conflict, not a pass
    rule(w), rule(w, true, [{ type: 'worker', value: ['w'] }]), // w: two rules that both deliver agree -> ROUTES
  ];
  assert.deepEqual(verdictOf([x, y, z, w], rules), { [x]: 'DROPS', [y]: 'DROPS', [z]: 'CONFLICT', [w]: 'ROUTES' });
  assert.deepEqual(judge([x, y, z, w], rules).map(v => v.ok), [false, false, false, true]);
});

test('a disabled rule does not take part in the order: a disabled drop before a forward leaves the address routed', () => {
  const x = at('x');
  assert.equal(verdictOf([x], [rule(x, false, DROP), rule(x)])[x], 'ROUTES');
  assert.equal(verdictOf([x], [rule(x, false, DROP), rule(x, false)])[x], 'DISABLED');
  assert.equal(verdictOf([x], [rule(x, true, undefined, 3), rule(x, false, DROP, 0)])[x], 'ROUTES', 'a disabled drop with the lower number is not a conflict');
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

// ── paging: the rules past page one are read (the response may carry no total_pages) ───────────────────────────────────────────────────────
// A fake zone of `rules`, served 50 to a page. `info(page, total)` builds result_info, so a test chooses which fields the response carries.
const fakeZone = (rules, info) => async (page, perPage) => ({ result: rules.slice((page - 1) * perPage, page * perPage), result_info: info(page, rules.length, perPage) });
const noTotalPages = (page, total, perPage) => ({ page, per_page: perPage, count: Math.min(perPage, total - (page - 1) * perPage), total_count: total });
const filler = n => Array.from({ length: n }, (_, i) => rule(at('filler' + i)));

test('a rule on page two is read when the response carries no total_pages: a drop there is not hidden', async () => {
  const rules = [...filler(50), rule(at('info'), true, DROP)];
  const read = await fetchAllRules(fakeZone(rules, noTotalPages));
  assert.equal(read.length, 51, 'all 51 rules read, not the first 50');
  assert.deepEqual(verdictOf([at('info')], read, null), { [at('info')]: 'DROPS' });
  assert.equal(verdictOf([at('info')], [rule(at('info')), ...rules.slice(50)], null)[at('info')], 'CONFLICT', 'a delivering rule with a drop behind it on a later page conflicts');
});

test('total_pages, when the response has it, is used; a short last page stops the loop with no extra request', async () => {
  let calls = 0;
  const zone = fakeZone([...filler(50), ...filler(3)], (page, total, perPage) => ({ page, per_page: perPage, total_count: total, total_pages: 2 }));
  assert.equal((await fetchAllRules(async (p, n) => { calls++; return zone(p, n); })).length, 53);
  assert.equal(calls, 2);
  calls = 0;
  const noCounts = fakeZone(filler(7), (page, total, perPage) => ({ page, per_page: perPage }));
  assert.equal((await fetchAllRules(async (p, n) => { calls++; return noCounts(p, n); })).length, 7, 'no counts at all: a short page ends it');
  assert.equal(calls, 1);
  const exact = fakeZone(filler(50), noTotalPages);
  calls = 0;
  assert.equal((await fetchAllRules(async (p, n) => { calls++; return exact(p, n); })).length, 50, 'exactly one full page, total_count says 50: no second request');
  assert.equal(calls, 1);
});

test('a response that never ends hits the page bound and fails loudly; pages that disagree with total_count fail by name', async () => {
  let calls = 0;
  const endless = async (page, perPage) => { calls++; return { result: filler(perPage), result_info: { page, per_page: perPage } }; };
  await assert.rejects(fetchAllRules(endless), /did not end within \d+ pages/);
  assert.equal(calls, MAX_PAGES, 'it asked for exactly the bounded number of pages and no more');
  const lying = fakeZone(filler(53), (page, total, perPage) => ({ page, per_page: perPage, total_count: 60 }));
  await assert.rejects(fetchAllRules(lying), /disagree with the zone: 53 rules read, the zone says 60/);
});

test('a page that answers success false, or whose result is not a list, fails by name instead of reading as an empty page', async () => {
  const first = { result: filler(50), result_info: {} };
  const failed = { success: false, errors: [{ code: 10000, message: 'Authentication error' }], result: null };
  await assert.rejects(fetchAllRules(async page => (page === 1 ? first : failed)), /answered with an error|did not return a list/);
  await assert.rejects(fetchAllRules(async () => ({ success: true, result: null })), /did not return a list/);
  await assert.rejects(fetchAllRules(async () => ({})), /did not return a list/);
});
