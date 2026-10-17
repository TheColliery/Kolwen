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
const { classify, renderPages, renderSource, shell, inline, plain, escText, escAttr, anchorOf, holdProblems, siteFooterHtml, footersOf, FOOTER_CSS, STYLE, SOURCES } = lib;
// The text of rendered HTML with its tags removed, entities left as they are (so it compares with escText(plain(markdown))).
const textOf = html => html.split('<').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('>') + 1))).join('').replace(/\s+/g, ' ').trim();
const read = rel => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const holds = JSON.parse(read('scripts/lib/legal-holds.json'));
const state = JSON.parse(read('legal/legal-state.json'));
const inputs = () => ({ terms: read('TERMS.md'), privacy: read('PRIVACY.md'), clause: read('legal/thai-7day-clause.md'), changelog: read('CHANGELOG.md'), state, holds });
const count = (s, needle) => s.split(needle).length - 1;
// A literal string as a regex source: every metacharacter is escaped, the backslash included, in one pass.
const reEscape = text => text.replace(/[\\^$.*+?()[\]{}|\/-]/g, m => '\\' + m);
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
  assert.deepEqual(s('TERMS.md'), { passages: 71, text: 27, held: 44 });
  assert.deepEqual(s('PRIVACY.md'), { passages: 57, text: 16, held: 41 });
  assert.deepEqual(s('legal/thai-7day-clause.md'), { passages: 4, text: 0, held: 4 });
});

test('every passage shown as written is verbatim: its text on the page equals the source text with its marks removed', () => {
  for (const [file, key] of [[SOURCES.terms, 'terms'], [SOURCES.privacy, 'privacy']]) {
    const c = classify(file, inputs()[key], { holds: holds.holds });
    const html = renderSource(file, inputs()[key], 'en', { holds: holds.holds }).html;
    const shown = [...html.matchAll(/<(?:p|li) class="t"[^>]*>([\s\S]*?)<\/(?:p|li)>/g)].map(m => textOf(m[1]));
    const want = c.items.filter(i => i.kind === 'passage' && !i.held).map(i => escText(plain(i.text)));
    assert.deepEqual(shown, want, file);
  }
});

test('a held passage never shows its own text', () => {
  const i = inputs();
  const shown = textOf(renderSource(SOURCES.terms, i.terms, 'en', { holds: holds.holds }).html);
  const c = classify(SOURCES.terms, i.terms, { holds: holds.holds });
  const held = c.items.filter(x => x.kind === 'passage' && x.held);
  assert.ok(held.some(p => p.text.startsWith('**')), 'the sample must include held passages that open with Markdown marks');
  for (const p of held) assert.ok(!shown.includes(escText(plain(p.text)).slice(0, 40)), p.text.slice(0, 40));
});

test('escaping covers & < > " and \' for text and for attribute values, and a description cannot leave its attribute', () => {
  for (const fn of [escText, escAttr]) assert.equal(fn('a&b<c>d"e\'f'), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
  const page = shell({ title: 'T <b>', description: 'x" onmouseover="alert(1)" <script>', path: '/p"q', en: '', th: '' });
  assert.match(page, /<meta name="description" content="x&quot; onmouseover=&quot;alert\(1\)&quot; &lt;script&gt;">/);
  assert.ok(page.includes('<title>T &lt;b&gt; — Kolwen</title>'));
  assert.ok(page.includes('href="https://kolwen.com/p&quot;q"'));
});

test('an HTML comment is structure: removed whole across lines, including one that ends with --!>', () => {
  const c = classify('X.md', 'A\n\n<!-- one\ntwo -->\n\nB\n\n<!-- three --!>\n\nC\n', {});
  assert.deepEqual(c.items.filter(i => i.kind === 'passage').map(i => i.text), ['A', 'B', 'C']);
});

test('refund rows R1 and R2 are the TERMS.md passages: a changed passage is reported, and a held passage becomes a pending line on the refund page', () => {
  const i = inputs();
  const changed = renderPages({ ...i, terms: i.terms.replace('refunded in full within 14 days', 'refunded in full within 30 days') });
  assert.match(changed.problems.join('\n'), /refund row R1: the TERMS\.md passage changed/);
  assert.match(docEn(changed.pages['web/refund.html']), /within 30 days/, 'the refund page follows the terms page');
  const gone = renderPages({ ...i, terms: i.terms.replace('**By Kolwen without cause.** Kolwen refunds', '**Without cause.** Kolwen refunds') });
  assert.match(gone.problems.join('\n'), /refund row R2 names a TERMS\.md passage that is not there/);
  const R1 = REFUND_ROWS[0].from;
  const held = renderPages({ ...i, holds: { ...holds, holds: [...holds.holds, { file: 'TERMS.md', anchor: R1, reason: 'awaits counsel' }] } });
  assert.deepEqual(held.problems, []);
  const doc = docEn(held.pages['web/refund.html']);
  assert.ok(!doc.includes('refunded in full within 14 days'), 'a held passage is not promised on the refund page');
  assert.equal(count(doc, 'class="t"'), 2);
  assert.equal(count(doc, 'class="pending"'), 8);
  assert.match(held.report.join('\n'), /refund rows 9 passages = 2 shown as written \+ 7 pending lines/);
});

test('the pages carry no raw {{token}}, no marker-less pending line, and nothing a production page must not have', () => {
  const { pages } = renderPages(inputs());
  assert.equal(Object.keys(pages).length, 4);
  for (const [file, html] of Object.entries(pages).filter(([name]) => name !== 'web/changelog.html')) {
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
const FILES = ['scripts/legal-pages.mjs', 'scripts/lib/legal-render.mjs', 'scripts/lib/legal-page-text.mjs', 'scripts/lib/legal-state.mjs', 'scripts/lib/legal-holds.json', 'TERMS.md', 'PRIVACY.md', 'legal/thai-7day-clause.md', 'legal/legal-state.json', 'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/pricing.html', 'CHANGELOG.md', 'web/changelog.html', 'web/index.html', 'web/404.html', 'web/_headers', 'scripts/lib/headers-file.mjs', 'scripts/lib/page-sync.mjs', 'scripts/lib/csp-hashes.mjs'];
function copyTree() {
  const dir = mkdtempSync(join(tmpdir(), 'legal-pages-'));
  for (const f of FILES) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  return dir;
}
// The house shape (scripts/secret-gate.test.mjs): a child of this test sees HOME, USERPROFILE and every temp variable pointing at the test's own folder,
// so nothing it does can touch the developer's real home or temp.
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };
const check = (dir, ...args) => spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/legal-pages.mjs'), ...(args.length ? args : ['--check'])], { encoding: 'utf8', timeout: 60000, cwd: dir, env: childEnv(dir) });
const edit = (dir, f, fn) => writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), 'utf8')));

test('--check passes on the committed pages', () => {
  const dir = copyTree();
  try { const r = check(dir); assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /4 pages match/); } finally { rmSync(dir, { recursive: true, force: true }); }
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

// ── the shared footer and the changelog page ────────────────────────────────────────────────────
const LINKS = ['/', '/pricing', '/changelog', '/terms', '/privacy', '/refund', 'https://github.com/TheColliery/Kolwen', 'https://huggingface.co/kolwen', 'https://www.npmjs.com/package/kolwen', 'mailto:info@kolwen.com', 'https://kolwen.com/.well-known/security.txt'];
const hrefs = block => [...block.matchAll(/<a href="([^"]*)"/g)].map(m => m[1]);

test('the shared footer links the same eleven places in both languages, in one order, with no buy word and no payment address', () => {
  for (const lang of ['en', 'th']) {
    const b = siteFooterHtml(lang);
    assert.deepEqual(hrefs(b), [LINKS[0], LINKS[1], LINKS[2], LINKS[3], LINKS[4], LINKS[5], LINKS[6], LINKS[7], LINKS[8], LINKS[9], LINKS[10]].map(x => x), lang);
    assert.ok(!/^\s/m.test(b), 'no line of the block is indented, so it is byte-identical wherever it sits');
    assert.ok(!/paddle|checkout|_ptxn/i.test(b));
  }
  assert.deepEqual(hrefs(siteFooterHtml('en')), hrefs(siteFooterHtml('th')));
});

test('every generated page holds the shared footer, English then Thai, byte for byte', () => {
  const { pages } = renderPages(inputs());
  for (const [file, html] of Object.entries(pages)) assert.deepEqual(footersOf(html), [siteFooterHtml('en'), siteFooterHtml('th')], file);
});

test('the hand-kept pages hold the same two footer blocks and carry the footer rules in a style block', () => {
  for (const file of ['web/index.html', 'web/pricing.html', 'web/404.html']) {
    const html = read(file);
    assert.deepEqual(footersOf(html), [siteFooterHtml('en'), siteFooterHtml('th')], file);
    assert.ok((html.match(/<style>[\s\S]*?<\/style>/g) || []).some(b => b.includes(FOOTER_CSS)), file + ' has the footer rules');
    assert.equal(hrefs(footersOf(html)[0]).length, LINKS.length, file + ' footer link count');
  }
  assert.ok(STYLE.includes(FOOTER_CSS));
});

test('the changelog page shows every passage of CHANGELOG.md as written, with no hold, and every footer link', () => {
  const i = inputs();
  const { pages, report } = renderPages(i);
  const html = pages['web/changelog.html'];
  const c = classify(SOURCES.changelog, i.changelog, { holds: [], noHold: true });
  assert.equal(c.stats.held, 0);
  assert.equal(c.stats.text, c.stats.passages);
  for (const doc of [docEn(html), docTh(html)]) {
    assert.equal(count(doc, 'class="t"'), c.stats.passages, 'passages on the page = passages in CHANGELOG.md');
    assert.equal(count(doc, 'class="pending"'), 0);
  }
  assert.match(report.join('\n'), new RegExp('web/changelog\\.html: CHANGELOG\\.md ' + c.stats.passages + ' passages = ' + c.stats.passages + ' shown as written \\+ 0 pending lines'));
  assert.ok(!/class="banner"/.test(html), 'the changelog is not a draft legal page, so it carries no draft banner');
  const shown = [...docEn(html).matchAll(/<(?:p|li) class="t"[^>]*>([\s\S]*?)<\/(?:p|li)>/g)].map(m => textOf(m[1]));
  assert.deepEqual(shown, c.items.filter(x => x.kind === 'passage').map(p => escText(plain(p.text))));
});

test('the Thai view of the changelog says the log is kept in English; the English view and the legal pages carry no such line', () => {
  const { pages } = renderPages(inputs());
  const line = 'บันทึกการเปลี่ยนแปลงนี้เขียนเป็นภาษาอังกฤษ';
  assert.equal(count(docTh(pages['web/changelog.html']), line), 1);
  assert.equal(count(docEn(pages['web/changelog.html']), line), 0);
  for (const f of ['web/terms.html', 'web/privacy.html', 'web/refund.html']) assert.equal(count(pages[f], line), 0, f);
  assert.equal(count(docTh(pages['web/changelog.html']), 'class="pending"'), 0, 'a status line, not a pending line');
});

test('a [text](https://...) link is a link and anything else stays text', () => {
  assert.equal(inline('see [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); ok'), 'see <a href="https://keepachangelog.com/en/1.1.0/">Keep a Changelog</a>; ok');
  assert.equal(inline('[x](javascript:alert(1))'), '[x](javascript:alert(1))');
  assert.equal(plain('see [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)'), 'see Keep a Changelog');
});

test('--check fails, naming the page and the language, when the footer of a hand-kept page drifts', () => {
  for (const [file, from, to, re] of [
    ['web/index.html', '<a href="/terms">Terms</a>', '<a href="/terms">Terms </a>', /FAIL web\/index\.html en footer differs from the shared footer, line \d+/],
    ['web/pricing.html', '<a href="/privacy">ความเป็นส่วนตัว</a>', '<a href="/privacy">ความเป็นส่วนตัว </a>', /FAIL web\/pricing\.html th footer differs from the shared footer/],
    ['web/404.html', '<a href="/changelog">Changelog</a>', '<a href="/changelogs">Changelog</a>', /FAIL web\/404\.html en footer differs from the shared footer/],
  ]) {
    const dir = copyTree();
    try {
      edit(dir, file, x => { assert.ok(x.includes(from), file + ' holds the anchor'); return x.replace(from, to); });
      const r = check(dir);
      assert.equal(r.status, 1, file + '\n' + r.stdout + r.stderr);
      assert.match(r.stdout, re, file);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('--check fails when a hand-kept page loses its footer or its footer rules', () => {
  for (const [file, fn, re] of [
    ['web/index.html', x => x.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, ''), /FAIL web\/index\.html en footer differs from the shared footer, line \d+/],
    ['web/404.html', x => x.replace(FOOTER_CSS, ''), /FAIL web\/404\.html footer css differs from the shared footer rules, line \d+/],
  ]) {
    const dir = copyTree();
    try { edit(dir, file, fn); const r = check(dir); assert.equal(r.status, 1, file + '\n' + r.stdout + r.stderr); assert.match(r.stdout, re, file); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('--check fails, naming web/changelog.html, when CHANGELOG.md changes by one word; --write puts it right', () => {
  const dir = copyTree();
  try {
    edit(dir, 'CHANGELOG.md', x => { assert.ok(x.includes('Nothing has been released.'), 'anchor'); return x.replace('Nothing has been released.', 'Nothing was released.'); });
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL web\/changelog\.html differs from the render of its sources, line \d+/);
    assert.equal(check(dir, '--write').status, 0);
    assert.equal(check(dir).status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the CLI child runs with HOME, USERPROFILE and the temp variables inside the folder of the test', () => {
  const dir = copyTree();
  try {
    const probe = spawnSync(process.execPath, ['-e', 'const e = process.env; console.log(JSON.stringify([e.HOME, e.USERPROFILE, e.TEMP, e.TMP, e.TMPDIR, e.XDG_CONFIG_HOME]))'], { encoding: 'utf8', timeout: 30000, env: childEnv(dir) });
    const seen = JSON.parse(probe.stdout);
    for (const v of seen) assert.ok(v.startsWith(dir), v + ' is inside ' + dir);
    for (const [name, v] of Object.entries({ HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE })) if (v) assert.notEqual(seen[name === 'HOME' ? 0 : 1], v, name + ' is not the real one');
    assert.equal(check(dir).status, 0, 'the CLI still runs in the sandbox');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the build-time sync: --write puts the shared blocks into the hand-kept pages, between fixed markers ──────────
const HAND = ['web/index.html', 'web/pricing.html', 'web/404.html'];
const WATCHED = [...HAND, 'web/_headers', 'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/changelog.html'];
const mk = (name, css) => (css ? { name, begin: `/* ${name}:begin */`, end: `/* ${name}:end */` } : { name, begin: `<!-- ${name}:begin -->`, end: `<!-- ${name}:end -->` });
const MARK = { header: mk('site-header'), en: mk('site-footer:en'), th: mk('site-footer:th'), css: mk('site-footer-css', true) };
const LABEL = { header: 'header', en: 'en footer', th: 'th footer', css: 'footer css' };
const lf = s => s.replace(/\r\n/g, '\n');
const snap = (dir, files) => Object.fromEntries(files.map(f => [f, readFileSync(join(dir, f))]));
const sameBytes = (a, b) => Object.keys(a).every(f => Buffer.compare(a[f], b[f]) === 0);
// The page text with every fenced block's contents cut out: what --write must leave alone.
const outside = text => { let t = text; for (const m of Object.values(MARK)) { const i = t.indexOf(m.begin), j = t.indexOf(m.end); if (i >= 0 && j > i) t = t.slice(0, i + m.begin.length) + t.slice(j); } return t; };
// The comments of _headers talk about style-src too, so the directive is read from the one indented policy line.
const styleSrcLine = text => /^[ \t]+Content-Security-Policy:[^\r\n]*/m.exec(text)[0].match(/(?<![\w-])style-src(?![\w-])[^;]*/)[0];
const sortedStyleSrc = text => styleSrcLine(text).split(/\s+/).filter(t => t.startsWith("'sha256-")).sort();
const FOOTER_ANCHOR = { 'web/index.html': ['<a href="/terms">Terms</a>', '<a href="/terms">Terms </a>'], 'web/pricing.html': ['<a href="/privacy">ความเป็นส่วนตัว</a>', '<a href="/privacy">ความเป็นส่วนตัว </a>'], 'web/404.html': ['<a href="/changelog">Changelog</a>', '<a href="/changelogs">Changelog</a>'] };

test('reEscape turns any text into a regex that matches exactly that text, backslash included', () => {
  const every = '\\^$.*+?()[]{}|/-';
  for (const c of every) assert.ok(new RegExp('^' + reEscape(c) + '$').test(c), 'matches ' + c);
  const text = 'a\\b.c/d-e (f)[g]{h}|i+j*k?l^m$n';
  assert.ok(new RegExp('^' + reEscape(text) + '$').test(text));
  assert.ok(!new RegExp('^' + reEscape('a.c') + '$').test('abc'), 'a dot stays a dot');
  assert.ok(!new RegExp('^' + reEscape('a\\.c') + '$').test('a.c'), 'a backslash before a dot is two characters');
});

test('the sync markers are named once, in the lib, and are the ones the pages carry', () => {
  assert.deepEqual(lib.SYNC_BLOCKS.map(b => [b.name, b.begin, b.end]), [MARK.css, MARK.header, MARK.en, MARK.th].map(m => [m.name, m.begin, m.end]), 'the array order is the one expected document order');
  const cli = read('scripts/legal-pages.mjs');
  for (const m of Object.values(MARK)) assert.ok(!cli.includes(m.name), 'the CLI does not retype ' + m.name);
});

test('the header slot is empty today and every one of the seven pages carries it, one pair, nothing between', () => {
  assert.equal(lib.siteHeaderHtml(), '');
  const pages = { ...renderPages(inputs()).pages };
  for (const f of HAND) pages[f] = read(f);
  assert.equal(Object.keys(pages).length, 7);
  for (const [f, html] of Object.entries(pages)) {
    assert.equal(count(html, MARK.header.begin), 1, f + ' begin');
    assert.ok(html.includes(MARK.header.begin + '\n' + MARK.header.end), f + ' the slot is empty');
    for (const k of ['en', 'th', 'css']) assert.equal(count(html, MARK[k].begin) + count(html, MARK[k].end), 2, f + ' ' + k);
  }
});

test('an edited footer on a hand-kept page fails --check, naming page and block, and --write restores it to the bytes it had', () => {
  for (const f of HAND) {
    const dir = copyTree();
    try {
      const before = snap(dir, WATCHED);
      const [from, to] = FOOTER_ANCHOR[f];
      edit(dir, f, x => { assert.ok(x.includes(from), f + ' holds the anchor'); return x.replace(from, to); });
      const r = check(dir);
      assert.equal(r.status, 1, f + '\n' + r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('FAIL ' + reEscape(f) + ' (en|th) footer differs from the shared footer, line \\d+'));
      const w = check(dir, '--write');
      assert.equal(w.status, 0, w.stdout + w.stderr);
      for (const g of WATCHED) { const now = readFileSync(join(dir, g)); if (HAND.includes(g) || g === 'web/_headers') assert.equal(Buffer.compare(before[g], now), 0, g + ' is byte for byte what it was'); else assert.equal(lf(now.toString('utf8')), lf(before[g].toString('utf8')), g + ' is the same text'); }
      assert.equal(check(dir).status, 0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
test('a marker that is missing fails --check and --write loudly, and --write writes nothing', () => {
  for (const [f, k, edge] of [['web/index.html', 'header', 'begin'], ['web/404.html', 'en', 'end'], ['web/pricing.html', 'th', 'begin'], ['web/index.html', 'css', 'end'], ['web/404.html', 'css', 'begin']]) {
    const dir = copyTree();
    try {
      const marker = MARK[k][edge];
      edit(dir, f, x => { assert.ok(x.includes(marker), f + ' holds ' + marker); return x.replace(marker, ''); });
      const before = snap(dir, WATCHED);
      const r = check(dir);
      assert.equal(r.status, 1, f + k + edge + '\n' + r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('FAIL ' + reEscape(f) + ' ' + LABEL[k] + ': .*missing'), f + k + edge);
      const w = check(dir, '--write');
      assert.equal(w.status, 1, f + k + edge + '\n' + w.stdout + w.stderr);
      assert.match(w.stdout + w.stderr, /missing/);
      assert.match(w.stdout + w.stderr, /nothing was written/);
      assert.ok(sameBytes(before, snap(dir, WATCHED)), 'no page and not _headers changed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('a marker that is doubled, or out of order, fails --check and --write loudly, and --write writes nothing', () => {
  for (const [what, f, k, fn, re] of [
    ['doubled begin', 'web/index.html', 'en', (x, m) => x.replace(m.begin, m.begin + '\n' + m.begin), /doubled/],
    ['doubled end', 'web/404.html', 'header', (x, m) => x.replace(m.end, m.end + '\n' + m.end), /doubled/],
    ['doubled css', 'web/pricing.html', 'css', (x, m) => x.replace(m.begin, m.begin + '\n' + m.begin), /doubled/],
    ['end before begin', 'web/pricing.html', 'th', (x, m) => x.replace(m.begin, '@@B@@').replace(m.end, m.begin).replace('@@B@@', m.end), /before the begin marker/],
  ]) {
    const dir = copyTree();
    try {
      edit(dir, f, x => { assert.ok(x.includes(MARK[k].begin) && x.includes(MARK[k].end), f); return fn(x, MARK[k]); });
      const before = snap(dir, WATCHED);
      const r = check(dir);
      assert.equal(r.status, 1, what + '\n' + r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('FAIL ' + reEscape(f) + ' ' + LABEL[k] + ': .*'), what);
      assert.match(r.stdout, re, what);
      const w = check(dir, '--write');
      assert.equal(w.status, 1, what + '\n' + w.stdout + w.stderr);
      assert.match(w.stdout + w.stderr, re);
      assert.match(w.stdout + w.stderr, /nothing was written/);
      assert.ok(sameBytes(before, snap(dir, WATCHED)), what + ': nothing changed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('--write leaves every byte outside the markers as it found it, in a CRLF page and in an LF page', () => {
  for (const eol of ['crlf', 'lf']) {
    for (const f of HAND) {
      const dir = copyTree();
      try {
        const [from, to] = FOOTER_ANCHOR[f];
        edit(dir, f, x => { const y = lf(x).replace(from, to).replace('<main>', '<main><!-- keep-me-7f3a -->'); return eol === 'crlf' ? y.replace(/\n/g, '\r\n') : y; });
        const mid = readFileSync(join(dir, f), 'utf8');
        assert.ok(mid.includes('keep-me-7f3a'));
        const w = check(dir, '--write');
        assert.equal(w.status, 0, w.stdout + w.stderr);
        const after = readFileSync(join(dir, f), 'utf8');
        assert.equal(outside(after), outside(mid), f + ' ' + eol + ': the bytes outside the markers are equal');
        assert.ok(after.includes('keep-me-7f3a'));
        if (eol === 'crlf') assert.ok(!/[\r\n]/.test(after.replace(/\r\n/g, '')), f + ': every line break of a CRLF page is still CRLF'); else assert.ok(!after.includes('\r'), f + ': an LF page gains no carriage return');
        assert.ok(!after.includes(to), f + ': the edited footer was put right');
      } finally { rmSync(dir, { recursive: true, force: true }); }
    }
  }
});

test('--write on the committed tree changes no hand-kept page and not _headers', () => {
  const dir = copyTree();
  try {
    const before = snap(dir, [...HAND, 'web/_headers']);
    const w = check(dir, '--write');
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.ok(sameBytes(before, snap(dir, [...HAND, 'web/_headers'])));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a hand edit of a footer rule makes --check fail on the page and on the hash; --write puts the page right and the hash list needs no edit', async () => {
  const { inlineStyles, cspHash } = await import(new URL('./lib/csp-hashes.mjs', import.meta.url));
  const dir = copyTree();
  try {
    const before = snap(dir, [...HAND, 'web/_headers']);
    edit(dir, 'web/index.html', x => { assert.ok(x.includes('.site-footer{margin-top:28px'), 'anchor'); return x.replace('.site-footer{margin-top:28px', '.site-footer{margin-top:29px'); });
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL web\/index\.html footer css differs from the shared footer rules, line \d+/);
    assert.match(r.stdout, /FAIL web\/_headers style-src does not admit sha256-[A-Za-z0-9+/=]+ \(the <style> block of web\/index\.html\)/);
    assert.match(r.stdout, /FAIL web\/_headers style-src admits sha256-[A-Za-z0-9+/=]+, which no <style> block/);
    assert.equal(check(dir, '--write').status, 0);
    assert.ok(sameBytes(before, snap(dir, [...HAND, 'web/_headers'])), 'page and _headers are back to their bytes');
    assert.equal(check(dir).status, 0);
    assert.deepEqual(inlineStyles(lf(readFileSync(join(dir, 'web/index.html'), 'utf8'))).map(cspHash).every(h => readFileSync(join(dir, 'web/_headers'), 'utf8').includes(h)), true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an edited footer rule in the lib is carried to all seven pages by one --write, and to the style-src hashes of _headers', async () => {
  const { inlineStyles, cspHash } = await import(new URL('./lib/csp-hashes.mjs', import.meta.url));
  const dir = copyTree();
  try {
    const headersBefore = readFileSync(join(dir, 'web/_headers'), 'utf8');
    const rule = '.site-footer a:hover{text-decoration-thickness:2px}';
    edit(dir, 'scripts/lib/legal-render.mjs', x => { assert.ok(x.includes(rule), 'anchor'); return x.replace(rule, '.site-footer a:hover{text-decoration-thickness:3px}'); });
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    for (const f of HAND) assert.match(r.stdout, new RegExp('FAIL ' + reEscape(f) + ' footer css differs'), f);
    const w = check(dir, '--write');
    assert.equal(w.status, 0, w.stdout + w.stderr);
    assert.match(w.stdout, /wrote web\/_headers/);
    for (const f of [...HAND, 'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/changelog.html']) assert.ok(readFileSync(join(dir, f), 'utf8').includes('text-decoration-thickness:3px'), f);
    const headers = readFileSync(join(dir, 'web/_headers'), 'utf8');
    const want = new Set(['web/index.html', 'web/pricing.html', 'web/404.html', 'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/changelog.html'].flatMap(f => inlineStyles(readFileSync(join(dir, f), 'utf8')).map(cspHash)));
    assert.deepEqual(sortedStyleSrc(headers), [...want].sort(), 'style-src admits exactly the hashes of the seven pages');
    assert.equal(headers.split(/\r?\n/).filter((l, i) => l !== headersBefore.split(/\r?\n/)[i]).length, 1, 'one line of _headers changed: the CSP line');
    assert.equal(check(dir).status, 0);
    assert.equal(check(dir, '--write').status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--check fails when a style hash of _headers no longer matches any page, and --write drops the stale one', () => {
  const dir = copyTree();
  try {
    const before = readFileSync(join(dir, 'web/_headers'), 'utf8');
    const first = /'sha256-([A-Za-z0-9+/=]+)'/.exec(styleSrcLine(before))[1];
    const forged = (first[0] === 'A' ? 'B' : 'A') + first.slice(1);
    writeFileSync(join(dir, 'web/_headers'), before.replace(first, forged));
    const r = check(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /FAIL web\/_headers style-src does not admit sha256-/);
    assert.match(r.stdout, new RegExp('FAIL web/_headers style-src admits sha256-' + reEscape(forged)));
    assert.equal(check(dir, '--write').status, 0);
    assert.equal(check(dir).status, 0);
    assert.deepEqual(sortedStyleSrc(readFileSync(join(dir, 'web/_headers'), 'utf8')), sortedStyleSrc(before));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the pairs are located on the original text and checked against each other: overlap, nesting, order ──────────
// The text of a pair with its markers, and the page with that text cut out / put back.
const pairText = (x, m) => x.slice(x.indexOf(m.begin), x.indexOf(m.end) + m.end.length);
const CROSS = [
  ['overlap: the end marker of the English footer moved past the begin marker of the Thai one', 'web/index.html', 'en', (x, M) => x.replace(M.en.end, '').replace(M.th.begin, M.th.begin + '\n' + M.en.end), /overlap/],
  ['nesting: the Thai footer pair inside the English one', 'web/pricing.html', 'en', (x, M) => x.replace(M.en.end, '').replace(M.th.end, M.th.end + '\n' + M.en.end), /nest/],
  ['overlap: the header pair runs into the English footer pair', 'web/404.html', 'header', (x, M) => x.replace(M.header.end, '').replace(M.en.begin, M.en.begin + '\n' + M.header.end), /overlap/],
  ['order: the English and Thai footer blocks swapped whole', 'web/index.html', 'th', (x, M) => { const e = pairText(x, M.en), t = pairText(x, M.th); return x.replace(e, '@@E@@').replace(t, e).replace('@@E@@', t); }, /expected document order/],
  ['order: the header pair above the footer rules in the style block', 'web/404.html', 'header', (x, M) => { const c = pairText(x, M.css), h = pairText(x, M.header); return x.replace(c, '@@C@@').replace(h, c).replace('@@C@@', h); }, /expected document order/],
];
for (const [what, f, k, fn, re] of CROSS) {
  test(`${what} fails --check and --write loudly, and --write writes nothing`, () => {
    const dir = copyTree();
    try {
      edit(dir, f, x => { const y = fn(x, MARK); assert.notEqual(y, x, 'the edit changed the page'); return y; });
      const before = snap(dir, WATCHED);
      const r = check(dir);
      assert.equal(r.status, 1, what + '\n' + r.stdout + r.stderr);
      assert.match(r.stdout, new RegExp('FAIL ' + reEscape(f) + ' ' + reEscape(LABEL[k]) + ': .*'), what);
      assert.match(r.stdout, re, what);
      const w = check(dir, '--write');
      assert.equal(w.status, 1, what + '\n' + w.stdout + w.stderr);
      assert.match(w.stdout + w.stderr, re, what);
      assert.match(w.stdout + w.stderr, /nothing was written/);
      assert.ok(sameBytes(before, snap(dir, WATCHED)), what + ': nothing changed');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── the style-src directive is found by its whole name: style-src-elem and style-src-attr are other directives ──────────
const cspLine = text => /^[ \t]+Content-Security-Policy:[^\r\n]*/m.exec(text)[0];
const directive = (line, name) => line.split(';').map(d => d.trim()).find(d => d === name || d.startsWith(name + ' '));
for (const other of ['style-src-elem', 'style-src-attr']) {
  test(`a ${other} directive listed before style-src is left alone: the line is rewritten at style-src only, and the check reads style-src`, async () => {
    const { planStyleSrc, hashProblems, styleHashes } = await import(new URL('./lib/page-sync.mjs', import.meta.url));
    const real = read('web/_headers');
    const decoy = `${other} 'self' 'sha256-DECOYDECOYDECOYDECOYDECOYDECOYDECOYDECOY000=';`;
    const headers = real.replace(cspLine(real), line => line.replace('style-src ', () => decoy + ' style-src '));
    assert.ok(headers.includes(decoy + ' style-src '), 'the decoy sits before style-src');
    const pages = Object.fromEntries(['web/index.html', 'web/pricing.html', 'web/404.html', 'web/terms.html', 'web/privacy.html', 'web/refund.html', 'web/changelog.html'].map(f => [f, read(f)]));
    assert.deepEqual(hashProblems(pages, headers), [], 'a matching style-src reads as matching with the decoy directive first');
    const moved = { ...pages, 'web/404.html': pages['web/404.html'].replace('.fine{font-size:12px;margin:0}', '.fine{font-size:13px;margin:0}') };
    const pre = Object.fromEntries(Object.entries(pages).map(([f, h]) => [f, styleHashes(h)])), post = Object.fromEntries(Object.entries(moved).map(([f, h]) => [f, styleHashes(h)]));
    const plan = planStyleSrc(headers, pre, post);
    assert.ok(!plan.problem, plan.problem);
    assert.equal(plan.replaced, 1);
    const was = cspLine(headers), now = cspLine(plan.text);
    assert.equal(directive(now, other), directive(was, other), `the ${other} directive survives byte for byte`);
    assert.notEqual(directive(now, 'style-src'), directive(was, 'style-src'), 'style-src took the new hash');
    for (const d of was.split(';')) if (!d.trim().startsWith('style-src ')) assert.ok(now.includes(d), 'every other directive survives: ' + d.trim().slice(0, 30));
    assert.equal(plan.text.split('\n').filter((l, i) => l !== headers.split('\n')[i]).length, 1, 'one line of the file changed');
    assert.ok(now.indexOf(decoy) < now.indexOf('style-src '), 'the order of the directives is kept');
  });
}

// ── WCAG 2.2 SC 1.4.3: every footer text colour against the background it sits on, at least 4.5:1 ──────────
// The footer takes its page's colour at full strength (no opacity anywhere in FOOTER_CSS) and hover does not change the colour, so what is
// measured is the colour each page gives the footer. WCAG 2.x relative luminance and contrast ratio.
const lin = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const mix = (fg, a, bg) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const css = html => (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
const varIn = (text, name) => { const m = new RegExp('--' + name + ':(#[0-9a-fA-F]{6})').exec(text); assert.ok(m, 'var --' + name); return rgb(m[1]); };

test('the footer css has no opacity and no hover colour, so no footer text is dimmed below its page colour', () => {
  assert.ok(!/opacity/.test(FOOTER_CSS), 'no opacity in the footer rules');
  for (const m of FOOTER_CSS.matchAll(/[{;]\s*color:([^;}]*)/g)) assert.equal(m[1], 'inherit', 'the only colour a footer rule sets is inherit');
  assert.ok(!/:hover\{[^}]*color/.test(FOOTER_CSS), 'hover does not change the colour');
});

test('every footer text colour measures at least 4.5:1 on every page background (dark pages with the brightest gradient point, the 404 page in both colour schemes)', () => {
  const { pages } = renderPages(inputs());
  const dark = { ...pages, 'web/index.html': read('web/index.html'), 'web/pricing.html': read('web/pricing.html') };
  const rows = [];
  for (const [file, html] of Object.entries(dark)) {
    const c = css(html);
    assert.match(c, /footer\{[^}]*color:var\(--quiet\)/, file + ': the footer takes --quiet');
    const text = varIn(c, 'quiet'), bg = varIn(c, 'bg');
    const g = /radial-gradient\(circle at [^,]+,rgba\((\d+),(\d+),(\d+),([.\d]+)\)/.exec(c);
    assert.ok(g, file + ': the body gradient');
    const peak = mix([+g[1], +g[2], +g[3]], +g[4], bg);
    rows.push([file + ' (base)', ratio(text, bg)], [file + ' (gradient peak)', ratio(text, peak)]);
  }
  const nf = css(read('web/404.html'));
  const light = { ink: varIn(nf.split('@media')[0], 'ink'), bg: varIn(nf.split('@media')[0], 'bg') };
  const darkM = /@media \(prefers-color-scheme:dark\)\{:root\{([^}]*)\}/.exec(nf);
  assert.ok(darkM, '404 dark scheme');
  // On the 404 page a footer link inherits the body colour (--ink) and a footer paragraph (the group labels and the copyright) takes the page's own p rule (--dim).
  assert.match(nf, /color:var\(--ink\)/, '404: the body colour, which a footer link inherits, is --ink');
  assert.match(nf, /(^|\n)p\{[^}]*color:var\(--dim\)/, '404: a paragraph takes --dim');
  const dimLight = varIn(nf.split('@media')[0], 'dim'), dimDark = varIn(darkM[1], 'dim'), bgDark = varIn(darkM[1], 'bg');
  rows.push(['web/404.html link (light)', ratio(light.ink, light.bg)], ['web/404.html label and copyright (light)', ratio(dimLight, light.bg)],
    ['web/404.html link (dark)', ratio(varIn(darkM[1], 'ink'), bgDark)], ['web/404.html label and copyright (dark)', ratio(dimDark, bgDark)]);
  for (const [name, r] of rows) assert.ok(r >= 4.5, name + ' measures ' + r.toFixed(2) + ':1');
  assert.ok(rows.length >= 16, 'the sample covers seven pages, two backgrounds on the dark ones, and the 404 page in two schemes for its links and for its paragraphs');
});
