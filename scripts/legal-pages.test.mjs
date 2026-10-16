// Tests for the legal-page renderer (scripts/lib/legal-render.mjs) and its CLI (scripts/legal-pages.mjs --check).
// The CLI tests run it against a throwaway copy of the tree, so no tracked file is touched. Every child has a heap cap and a kill timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lib = await import(new URL('./lib/legal-render.mjs', import.meta.url));
const { REFUND_ROWS } = await import(new URL('./lib/legal-page-text.mjs', import.meta.url));
const { splitSource, classify, renderPages, renderSource, inline, plain, textOf, anchorOf, holdProblems, SOURCES } = lib;
const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const holds = JSON.parse(read('scripts/lib/legal-holds.json'));
const state = JSON.parse(read('legal/legal-state.json'));
const inputs = () => ({ terms: read('TERMS.md'), privacy: read('PRIVACY.md'), clause: read('legal/thai-7day-clause.md'), state, holds });
const count = (s, needle) => s.split(needle).length - 1;
// The English document of a page: the text between the two document containers.
const docEn = html => html.slice(html.indexOf('id="doc-en"'), html.indexOf('id="doc-th"'));
const docTh = html => html.slice(html.indexOf('id="doc-th"'), html.indexOf('</main>'));
const ACTIVE = { ...state, sellerType: 'company', incorporated: { on: '2026-12-01' } };

test('a passage carrying a marker is held, one without is shown as written', () => {
  const c = classify('X.md', 'Plain sentence.\n\nA claim [pending legal review] here.\n\nA Thai [รอ ที่ปรึกษา กฎหมาย] one.\n', {});
  assert.deepEqual(c.items.map(i => i.held), [false, true, true]);
});

test('a marker on the head of a block quote holds every passage of the quote, an unmarked quote is not held', () => {
  const md = '> [pending legal review] head\n>\n> second paragraph\n> 1. a list item\n\n> unmarked head\n>\n> second\n';
  const c = classify('X.md', md, {});
  assert.deepEqual(c.items.map(i => i.held), [true, true, true, false, false]);
});

test('an unset placeholder holds its passage, and so does a {{token}}', () => {
  const c = classify('X.md', 'Kept for **[N days]** then deleted.\n\nThanks from {{since}} on.\n\nPlain.\n', {});
  assert.deepEqual(c.items.map(i => i.held), [true, true, false]);
});

test('list items are separate passages, headings and comments are not passages', () => {
  const md = '# Title\n\n## H\n\n<!-- a comment -->\n\n- one\n- two\n  wrapped\n\n1. first\n2. second\n\nA paragraph\nover two lines.\n';
  const c = classify('X.md', md, {});
  assert.equal(c.stats.passages, 5);
  assert.deepEqual(c.items.filter(i => i.kind === 'passage').map(i => i.text), ['one', 'two wrapped', 'first', 'second', 'A paragraph over two lines.']);
});

test('the hold list holds a passage by its first eight words, in its own file only', () => {
  const md = 'Alpha beta gamma delta epsilon zeta eta theta iota.\n\nOther text.\n';
  const list = [{ file: 'X.md', anchor: 'Alpha beta gamma delta epsilon zeta eta theta', reason: 'awaits counsel' }];
  assert.deepEqual(classify('X.md', md, { holds: list }).items.map(i => i.held), [true, false]);
  assert.deepEqual(classify('Y.md', md, { holds: list }).items.map(i => i.held), [false, false]);
  assert.equal(anchorOf('a  b\nc d e f g h i j'), 'a b c d e f g h');
});

test('the shipped hold list is sound over the shipped sources: every entry matches, none is redundant, each reason is the generic one', () => {
  const i = inputs();
  const perFile = { [SOURCES.terms]: classify(SOURCES.terms, i.terms, { holds: holds.holds }), [SOURCES.privacy]: classify(SOURCES.privacy, i.privacy, { holds: holds.holds }), [SOURCES.clause]: classify(SOURCES.clause, i.clause, { holds: holds.holds }) };
  assert.deepEqual(holdProblems(holds.holds, perFile), []);
  for (const h of holds.holds) assert.equal(h.reason, 'awaits counsel');
});

test('a stale entry, a redundant entry, a duplicate and a named-tool reason are each reported', () => {
  const i = inputs();
  const mk = list => ({ [SOURCES.terms]: classify(SOURCES.terms, i.terms, { holds: list }), [SOURCES.privacy]: classify(SOURCES.privacy, i.privacy, { holds: list }), [SOURCES.clause]: classify(SOURCES.clause, i.clause, { holds: list }) });
  const base = holds.holds[0];
  const stale = [...holds.holds, { file: 'TERMS.md', anchor: 'no such passage anywhere in this file', reason: 'awaits counsel' }];
  assert.match(holdProblems(stale, mk(stale)).join('\n'), /matches no passage/);
  const marked = [...holds.holds, { file: 'TERMS.md', anchor: anchorOf(classify('TERMS.md', i.terms, {}).items.find(p => p.kind === 'passage' && p.byMarker).text), reason: 'awaits counsel' }];
  assert.match(holdProblems(marked, mk(marked)).join('\n'), /redundant/);
  const dup = [...holds.holds, base];
  assert.match(holdProblems(dup, mk(dup)).join('\n'), /listed twice/);
  const why = [{ ...base, reason: 'Zorblax answer 12' }, ...holds.holds.slice(1)];
  assert.match(holdProblems(why, mk(why)).join('\n'), /reason must be exactly/);
});

test('no passage is dropped: for each source, passages = shown as written + held, and the page shows exactly those', () => {
  const { pages } = renderPages(inputs());
  for (const [file, src] of [['web/terms.html', SOURCES.terms], ['web/privacy.html', SOURCES.privacy]]) {
    const c = classify(src, src === SOURCES.terms ? inputs().terms : inputs().privacy, { holds: holds.holds });
    assert.equal(c.stats.passages, c.stats.text + c.stats.held);
    for (const doc of [docEn(pages[file]), docTh(pages[file])]) {
      assert.equal(count(doc, 'class="t"'), c.stats.text, file + ' shown as written');
      assert.equal(count(doc, 'class="pending"'), c.stats.held + 1, file + ' pending lines (the held passages and the one Thai-versions line)');
    }
  }
});

test('the counts of the three sources today', () => {
  const i = inputs();
  const s = file => classify(file, i[{ 'TERMS.md': 'terms', 'PRIVACY.md': 'privacy', 'legal/thai-7day-clause.md': 'clause' }[file]], { holds: holds.holds }).stats;
  assert.deepEqual(s('TERMS.md'), { passages: 61, text: 27, held: 34 });
  assert.deepEqual(s('PRIVACY.md'), { passages: 55, text: 15, held: 40 });
  assert.deepEqual(s('legal/thai-7day-clause.md'), { passages: 4, text: 0, held: 4 });
});

test('every passage shown as written is verbatim: its text on the page equals the source text with its marks removed', () => {
  for (const [file, key] of [[SOURCES.terms, 'terms'], [SOURCES.privacy, 'privacy']]) {
    const c = classify(file, inputs()[key], { holds: holds.holds });
    const html = renderSource(file, inputs()[key], 'en', { holds: holds.holds }).html;
    const shown = [...html.matchAll(/<(?:p|li) class="t"[^>]*>([\s\S]*?)<\/(?:p|li)>/g)].map(m => textOf(m[1]));
    const want = c.items.filter(i => i.kind === 'passage' && !i.held).map(i => plain(i.text));
    assert.deepEqual(shown, want, file);
  }
});

test('a held passage never shows its own text', () => {
  const i = inputs();
  const html = renderSource(SOURCES.terms, i.terms, 'en', { holds: holds.holds }).html;
  const c = classify(SOURCES.terms, i.terms, { holds: holds.holds });
  for (const p of c.items.filter(x => x.kind === 'passage' && x.held)) assert.ok(!html.includes(esc(p.text.slice(0, 40))), p.text.slice(0, 40));
});
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('the pages carry no raw {{token}}, no marker-less pending line, and nothing a production page must not have', () => {
  const { pages } = renderPages(inputs());
  assert.equal(Object.keys(pages).length, 3);
  for (const [file, html] of Object.entries(pages)) {
    assert.ok(!html.includes('{{'), file + ' has a raw token');
    assert.ok(!/noindex/i.test(html), file + ' asks search engines to skip it');
    assert.ok(!/PREVIEW/.test(html), file + ' is marked as a preview');
    assert.ok(!/<form\b|<input\b[^>]*type=["']?(?:submit|button)/i.test(html), file + ' has a form or a submit control');
    assert.equal(count(html, '<button'), 2, file + ' has more than the two language buttons');
    for (const m of html.matchAll(/class="pending"[^>]*>([^<]*)</g)) assert.ok(/^\[(?:pending legal review|รอที่ปรึกษากฎหมาย)\]/.test(m[1]), file + ': ' + m[1].slice(0, 50));
    assert.equal(count(docEn(html), 'class="pending"'), count(docTh(html), 'class="pending"'), file + ': both languages show the same number of pending lines');
    assert.equal(count(docEn(html), 'class="t"'), count(docTh(html), 'class="t"'), file + ': both languages show the same number of statements');
  }
});

test('the refund page shows R1 to R9: three statements and six pending lines, and the 7-day clause as one pending line while it is not in force', () => {
  const { pages, report } = renderPages(inputs());
  const doc = docEn(pages['web/refund.html']);
  assert.equal(count(doc, 'class="t"'), 3);
  assert.equal(count(doc, 'class="pending"'), 7);
  assert.match(doc, /Thai 7-day cancellation right is drafted/);
  assert.match(report.join('\n'), /legal\/thai-7day-clause\.md 4 passages = 0 shown as written \+ 4 held \(not in force/);
  assert.ok(!/deducts? the days you used/i.test(doc.replace('deducts the days you used is waiting for review', '')), 'the page promises neither a deduction nor no deduction');
});

test('when the legal-state record says the clause is in force, the refund page shows it dated, in place of R8, and nothing is dropped', () => {
  const { pages, problems, report } = renderPages({ ...inputs(), state: ACTIVE });
  assert.deepEqual(problems, []);
  const doc = docEn(pages['web/refund.html']);
  assert.match(doc, /binds Kolwen from 2026-12-01/);
  assert.ok(!doc.includes('{{') && !doc.includes('is drafted. It is not in force yet'));
  assert.match(report.join('\n'), /in force since 2026-12-01/);
  const c = classify(SOURCES.clause, inputs().clause.split('{{since}}').join('2026-12-01'), { holds: holds.holds, active: true });
  assert.equal(c.stats.passages, c.stats.text + c.stats.held);
  assert.equal(c.stats.text, 2);
});

test('a refund row that is pending without the marker, or shown as written with it, is refused', () => {
  const rows = REFUND_ROWS;
  const keepPending = rows[3].en, keepText = rows[0].en;
  try {
    rows[3].en = 'To ask for a refund, write to us.';
    assert.match(renderPages(inputs()).problems.join('\n'), /refund row R4 is pending and must begin with the marker/);
    rows[3].en = keepPending;
    rows[0].en = keepText + ' [pending legal review]';
    assert.match(renderPages(inputs()).problems.join('\n'), /refund row R1 is shown as written and must not carry a marker/);
  } finally { rows[3].en = keepPending; rows[0].en = keepText; }
  assert.deepEqual(renderPages(inputs()).problems, []);
});

test('the Thai twin of a statement is checked against the source, so an edit to the source cannot leave it behind', () => {
  const i = inputs();
  const out = renderPages({ ...i, terms: i.terms.replace('under\nPaddle\'s own buyer terms', 'under\nPaddle\'s own terms') });
  assert.match(out.problems.join('\n'), /Thai twin .* out of step/);
});

test('inline marks: bold, italic around code, code with a pipe, and escaping', () => {
  assert.equal(inline('a **b** c'), 'a <strong>b</strong> c');
  assert.equal(inline('*Measured: `x | y` ok.*'), '<em>Measured: <code>x | y</code> ok.</em>');
  assert.equal(inline('1 < 2 & 3'), '1 &lt; 2 &amp; 3');
  assert.equal(plain('*Measured: `x` ok.* **b**'), 'Measured: x ok. b');
});

test('the same inputs give the same pages', () => {
  assert.deepEqual(renderPages(inputs()).pages, renderPages(inputs()).pages);
});

// ── the CLI, against a throwaway copy of the tree ──────────────────────────────────────────────
const FILES = ['scripts/legal-pages.mjs', 'scripts/lib/legal-render.mjs', 'scripts/lib/legal-page-text.mjs', 'scripts/lib/legal-state.mjs', 'scripts/lib/legal-holds.json', 'TERMS.md', 'PRIVACY.md', 'legal/thai-7day-clause.md', 'legal/legal-state.json', 'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/pricing.html'];
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'legal-pages-'));
  for (const f of FILES) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  return dir;
}
const check = (dir, ...args) => spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/legal-pages.mjs'), ...(args.length ? args : ['--check'])], { encoding: 'utf8', timeout: 60000, cwd: dir });
const edit = (dir, f, fn) => writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), 'utf8')));

test('--check passes on the committed pages', () => {
  const dir = copyTree();
  try { const r = check(dir); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /3 pages match/); } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--check fails, naming the page, when one word of a statement in a source changes; --write puts it right', () => {
  const dir = copyTree();
  try {
    edit(dir, 'TERMS.md', s => s.replace('Thai law governs these Terms', 'Thai law rules these Terms'));
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL web\/terms\.html differs from the render of its sources, line \d+/);
    assert.equal(check(dir, '--write').status, 0);
    assert.equal(check(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--check fails when a hold entry is removed: the held passage would be shown', () => {
  const dir = copyTree();
  try {
    edit(dir, 'scripts/lib/legal-holds.json', s => { const j = JSON.parse(s); j.holds = j.holds.filter(h => !h.anchor.startsWith('Paddle\'s refund policy is the floor')); return JSON.stringify(j, null, 2) + '\n'; });
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL web\/terms\.html differs/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--check fails on a stale hold entry, on a hand-edited page and on a pricing page with another style block', () => {
  for (const [what, fn, re] of [
    ['stale entry', dir => edit(dir, 'scripts/lib/legal-holds.json', s => { const j = JSON.parse(s); j.holds.push({ file: 'TERMS.md', anchor: 'matches nothing at all in the file', reason: 'awaits counsel' }); return JSON.stringify(j, null, 2); }), /matches no passage/],
    ['hand edit', dir => edit(dir, 'web/refund.html', s => s.replace('Refunds', 'Refunds!')), /FAIL web\/refund\.html differs/],
    ['pricing style', dir => edit(dir, 'web/pricing.html', s => s.replace('--bg:#0f0d0b', '--bg:#0f0d0c')), /web\/pricing\.html does not carry the same <style> block/],
    ['missing page', dir => rmSync(join(dir, 'web/privacy.html')), /web\/privacy\.html is missing/],
  ]) {
    const dir = copyTree();
    try { fn(dir); const r = check(dir); assert.equal(r.status, 1, what + '\n' + r.stdout + r.stderr); assert.match(r.stdout, re, what); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('the CLI refuses an unknown flag with exit 2 and prints usage on --help', () => {
  const dir = copyTree();
  try {
    const bad = check(dir, '--nope');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /unknown argument/);
    const help = check(dir, '--help');
    assert.equal(help.status, 0);
    assert.match(help.stdout, /usage: node scripts\/legal-pages\.mjs/);
    assert.ok(existsSync(join(dir, 'web/terms.html')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
