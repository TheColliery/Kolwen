// Tests for scripts/legal-state.mjs: the Thai 7-day clause is in TERMS.md only while legal/legal-state.json says a trigger is met.
// Every fixture tree is built in a fresh temp folder and removed after. LEGAL_STATE_SCRIPT points the suite at another copy of the
// script (a stub that reports nothing, or a mutant): that is how the red-first run and the mutant table are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = process.env.LEGAL_STATE_SCRIPT ? resolve(process.env.LEGAL_STATE_SCRIPT) : join(HERE, 'legal-state.mjs');
const REAL = f => readFileSync(join(HERE, '..', f), 'utf8');

const BEGIN = '<!-- legal-state:thai-7day:begin -->', END = '<!-- legal-state:thai-7day:end -->';
const CLAUSE = '## Thai consumer cancellation right\n\nA consumer in Thailand may cancel within **7 days** and gets the full price back. Binds from {{since}}.\n\n> สิทธิยกเลิกภายใน 7 วัน ผูกพันตั้งแต่ {{since}}\n\n**GAP 10 — [pending legal review]: counsel confirms.**\n';
const rec = o => JSON.stringify({ schema: 1, sellerType: 'natural-person', incorporated: { on: null }, directMarketingRegistered: { on: null }, revenueThreshold: { crossedOn: null, vetoedOn: null }, ...o }, null, 2) + '\n';
const termsWith = block => `# Terms\n\nBefore.\n\n${block}\n\nAfter.\n`;
const EMPTY = BEGIN + '\n' + END;
const FULL = since => BEGIN + '\n\n' + CLAUSE.trim().split('{{since}}').join(since) + '\n\n' + END;

function fixture(t, { record = rec({}), terms = termsWith(EMPTY), clause = CLAUSE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'legal-state-test-'));
  t.after(() => { rmSync(dir, { recursive: true, force: true }); });
  mkdirSync(join(dir, 'legal'), { recursive: true });
  writeFileSync(join(dir, 'legal/legal-state.json'), record);
  writeFileSync(join(dir, 'legal/thai-7day-clause.md'), clause);
  writeFileSync(join(dir, 'TERMS.md'), terms);
  return dir;
}
const run = (dir, args = []) => spawnSync(process.execPath, ['--max-old-space-size=2048', SCRIPT, ...args], { cwd: dir, encoding: 'utf8', timeout: 30000 });
const termsOf = dir => readFileSync(join(dir, 'TERMS.md'), 'utf8');

test('record inactive and the block empty: --check passes, and the clause is in neither language', t => {
  const d = fixture(t);
  const r = run(d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /legal-state: the record says the clause is not in force and TERMS\.md agrees/, 'a pass must say what it checked');
  assert.doesNotMatch(termsOf(d), /7 days|7 วัน/);
});

test('record inactive but the clause is in TERMS.md: --check refuses (exit 1), naming the disagreement', t => {
  const d = fixture(t, { terms: termsWith(FULL('2026-01-01')) });
  const r = run(d);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /record says the clause is not in force/);
});

test('record active (incorporated): --write puts the clause in BOTH languages, dated; --check then passes; a second --write changes nothing', t => {
  const d = fixture(t, { record: rec({ sellerType: 'company', incorporated: { on: '2026-12-01' } }) });
  const before = run(d);
  assert.equal(before.status, 1, 'an empty block while the record is active must be refused: ' + before.stdout + before.stderr);
  assert.match(before.stdout, /record says the clause is in force/);
  const w = run(d, ['--write']);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  const t1 = termsOf(d);
  assert.match(t1, /\*\*7 days\*\*/, 'English clause');
  assert.match(t1, /7 วัน/, 'Thai clause');
  assert.match(t1, /Binds from 2026-12-01\./);
  assert.match(t1, /ตั้งแต่ 2026-12-01/);
  assert.equal(run(d).status, 0);
  run(d, ['--write']);
  assert.equal(termsOf(d), t1, '--write is idempotent');
});

test('each trigger arms the clause on its own: direct-marketing registration, and a revenue crossing not vetoed; the earliest date is the one shown', t => {
  const dm = fixture(t, { record: rec({ directMarketingRegistered: { on: '2027-03-02' } }) });
  assert.equal(run(dm, ['--write']).status, 0);
  assert.match(termsOf(dm), /Binds from 2027-03-02\./);
  const rev = fixture(t, { record: rec({ revenueThreshold: { crossedOn: '2027-05-10', vetoedOn: null } }) });
  assert.equal(run(rev, ['--write']).status, 0);
  assert.match(termsOf(rev), /Binds from 2027-05-10\./);
  const both = fixture(t, { record: rec({ sellerType: 'company', incorporated: { on: '2027-06-01' }, revenueThreshold: { crossedOn: '2027-05-10', vetoedOn: null } }) });
  assert.equal(run(both, ['--write']).status, 0);
  assert.match(termsOf(both), /Binds from 2027-05-10\./);
});

test('a revenue crossing vetoed inside the 14-day window does not arm the clause; --write on an active-then-vetoed record empties the block', t => {
  const d = fixture(t, { record: rec({ revenueThreshold: { crossedOn: '2027-05-10', vetoedOn: '2027-05-20' } }), terms: termsWith(FULL('2027-05-10')) });
  assert.equal(run(d).status, 1);
  assert.equal(run(d, ['--write']).status, 0);
  assert.doesNotMatch(termsOf(d), /7 days/);
  assert.equal(run(d).status, 0);
});

test('the record carries STATE ONLY: an unknown key, a registration-number-shaped value or a revenue figure is refused (exit 1)', t => {
  const bad = [
    ['an unknown key', { registrationNumber: 'x' }],
    ['a 13-digit value in a date field', { incorporated: { on: '9'.repeat(13) } }],
    ['a revenue figure as a key', { revenueThreshold: { crossedOn: null, vetoedOn: null, amountThb: 1 } }],
    ['a taxpayer-id key under a trigger', { directMarketingRegistered: { on: null, taxId: '8'.repeat(13) } }],
    ['a non-date string', { incorporated: { on: 'soon' } }],
    ['an impossible calendar date', { directMarketingRegistered: { on: '2027-02-30' } }],
    ['an unknown seller type', { sellerType: 'partnership' }],
  ];
  for (const [label, o] of bad) {
    const d = fixture(t, { record: rec(o) });
    const r = run(d);
    assert.equal(r.status, 1, label + ': ' + r.stdout + r.stderr);
    assert.match(r.stdout, /legal-state\.json/, label);
  }
});

test('the record must agree with itself: a company trigger needs sellerType company; a veto needs a crossing and a window of 14 calendar days', t => {
  const bad = [
    ['incorporation entered while the seller is a natural person', { incorporated: { on: '2026-12-01' } }, /sellerType is not company/],
    ['a company seller with no incorporation date (the trigger would never arm)', { sellerType: 'company' }, /sellerType is company but incorporated[.]on is not set/],
    ['a veto with no crossing', { revenueThreshold: { crossedOn: null, vetoedOn: '2027-05-20' } }, /vetoedOn is set with no crossedOn/],
    ['a veto after 14 calendar days', { revenueThreshold: { crossedOn: '2027-05-10', vetoedOn: '2027-05-25' } }, /within 14 calendar days/],
    ['a veto before the crossing', { revenueThreshold: { crossedOn: '2027-05-10', vetoedOn: '2027-05-09' } }, /within 14 calendar days/],
  ];
  for (const [label, o, why] of bad) {
    const r = run(fixture(t, { record: rec(o) }));
    assert.equal(r.status, 1, label + ': ' + r.stdout + r.stderr);
    assert.match(r.stdout, why, label + ': refused for the right reason');
  }
  const ok = run(fixture(t, { record: rec({ revenueThreshold: { crossedOn: '2027-05-10', vetoedOn: '2027-05-24' } }) }));
  assert.equal(ok.status, 0, 'a veto on day 14 is inside the window: ' + ok.stdout + ok.stderr);
});

test('a record that starts with a byte-order mark is read like any other: --write exits 0 and renders, --check passes after', t => {
  const bom = String.fromCharCode(0xfeff);
  const d = fixture(t, { record: bom + rec({ sellerType: 'company', incorporated: { on: '2026-12-01' } }) });
  const w = run(d, ['--write']);
  assert.equal(w.status, 0, w.stdout + w.stderr);
  assert.match(termsOf(d), /Binds from 2026-12-01\./);
  assert.doesNotMatch(w.stderr, /SyntaxError/);
  assert.equal(run(d).status, 0);
});

test('TERMS.md without the marker pair, or with two pairs, is refused (the check is not vacuous)', t => {
  const none = run(fixture(t, { terms: '# Terms\n\nNo block.\n' }));
  assert.equal(none.status, 1, none.stdout + none.stderr);
  assert.match(none.stdout, /marker/);
  const twice = run(fixture(t, { terms: termsWith(EMPTY) + '\n' + EMPTY + '\n' }));
  assert.equal(twice.status, 1, twice.stdout + twice.stderr);
});

test('a missing record, clause file or TERMS.md is bad input (exit 2), named; an unknown flag exits 2; --help exits 0', t => {
  const d = fixture(t);
  rmSync(join(d, 'legal/legal-state.json'));
  const r = run(d);
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /legal-state\.json/);
  assert.equal(run(fixture(t), ['--frobnicate']).status, 2);
  assert.equal(run(fixture(t), ['--help']).status, 0);
});

test('the committed tree is consistent: the real record is inactive, the real TERMS.md block is empty, and the real clause file carries both languages', () => {
  const state = JSON.parse(REAL('legal/legal-state.json'));
  assert.equal(state.incorporated.on, null);
  const terms = REAL('TERMS.md').replace(/\r\n/g, '\n');
  assert.ok(terms.includes(EMPTY), 'TERMS.md holds the empty block while the record is inactive');
  const clause = REAL('legal/thai-7day-clause.md');
  assert.match(clause, /\*\*7 days\*\*/);
  assert.match(clause, /7 วัน/);
  assert.match(clause, /\{\{since\}\}/);
});
