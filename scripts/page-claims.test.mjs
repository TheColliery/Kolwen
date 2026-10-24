// Tests for surface-check rules 15 (the dropped "no trackers" claim, LWK-273) and 16 (no robots noindex on a production page, LWK-271), and for the readers behind them (scripts/lib/page-claims.mjs).
//
// Each rule owes three things, and this file is where they are held:
//   1. RED-FIRST: the rule FIRES on the dirty input (the reviewer's mutant I1, a noindex meta on the home page; the page set at the parent of 94b9415, which says "no trackers"). The gate tests run
//      the real scripts/surface-check.mjs in a throwaway repository of the tracked files and look for the rule's own finding, by page and by line.
//   2. ITS DATA CANNOT EMPTY IT, per input: the claim is planted in EVERY tracked page, in both languages and in a wrapped spelling, and each page is named; the meta is planted in every production page; a
//      repository whose only tracked page is the pinned changelog is a finding, not a pass; a meta tag the reader cannot read is a finding, not a pass.
//   3. ITS STATED LIMIT is in the code (the rule blocks of scripts/surface-check.mjs and the header of scripts/lib/page-claims.mjs), and the limits that are cheap to keep true are asserted here.
// And both readers are linear: they run on bulk input in a child under a heap cap, a kill timeout and a HOME and TEMP of their own, and the test asserts that the child FINISHED.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = pathToFileURL(join(ROOT, 'scripts/lib/page-claims.mjs')).href;
const lib = () => import(LIB); // dynamic, so a missing library fails the unit tests and not the gate tests
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

// The tracked files of this tree in a throwaway repository (surface-check reads the tracked files with git).
function surfaceCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'page-claims-'));
  const env = childEnv(dir);
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).stdout.split('\0').filter(Boolean);
  for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: dir, env, timeout: 60000 }).status, 0, 'git ' + args[0]);
  return dir;
}
const restage = dir => assert.equal(spawnSync('git', ['add', '-A'], { cwd: dir, env: childEnv(dir), timeout: 60000 }).status, 0);
const surface = (dir, timeout = 120000) => { const r = spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir) }); return { ...r, out: (r.stdout || '') + (r.stderr || '') }; };
const pagesOf = dir => readdirSync(join(dir, 'web')).filter(f => f.endsWith('.html')).sort().map(f => 'web/' + f);
const edit = (dir, f, fn) => { const p = join(dir, f); const before = readFileSync(p, 'utf8'); const after = fn(before); assert.notEqual(after, before, f + ' was not changed'); writeFileSync(p, after); return after; };

const META_I1 = '<meta name="robots" content="noindex">';
const NO_TRACKERS_EN = 'We have no trackers.', NO_TRACKERS_TH = 'ไม่มีตัวติดตาม';

test('baseline: the tracked tree passes surface-check (the tests below plant one defect each)', () => {
  const dir = surfaceCopy();
  try { const r = surface(dir); assert.equal(r.status, 0, r.out); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── rule 16: the reviewer's mutant I1, and the pages, tag spellings and headers around it ─────────────────────────────────────────────────────────────────────
test('rule 16 fires on the reviewer mutant I1: a robots noindex meta on the home page fails surface-check, naming the page and the line', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</head>', META_I1 + '\n</head>'));
    const line = lineOf(after, after.indexOf(META_I1));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: carries a robots noindex meta tag`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 16 reads EVERY production page: the meta planted in each page but the 404 is named by that page, and the 404 page keeps its one named exemption', () => {
  const dir = surfaceCopy();
  try {
    const pages = pagesOf(dir);
    assert.ok(pages.length >= 7, 'the tracked pages: ' + pages.join(', '));
    assert.match(readFileSync(join(dir, 'web/404.html'), 'utf8'), /name="robots"[^>]*noindex|noindex[^>]*name="robots"/i, 'the 404 page carries its own noindex, so the exemption is exercised');
    const planted = {};
    for (const f of pages.filter(f => f !== 'web/404.html')) { const after = edit(dir, f, s => s.replace('</head>', META_I1 + '\n</head>')); planted[f] = lineOf(after, after.indexOf(META_I1)); }
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    for (const [f, line] of Object.entries(planted)) assert.ok(r.out.includes(`${f}: line ${line}: carries a robots noindex meta tag`), f + '\n' + r.out);
    assert.ok(!r.out.includes('web/404.html: line'), 'the 404 page is not named');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 16 reads the tag as a parser does: case, order, quotes, none, and a > inside a quoted value fire; data-content, a longer name and an unrelated content do not', () => {
  const dir = surfaceCopy();
  try {
    const fires = ['<META NAME="ROBOTS" CONTENT="NOINDEX, NOFOLLOW">', '<meta content="noindex" name="robots">', "<meta name='robots' content='noindex'>", '<meta name=robots content=noindex>',
      '<meta name="robots" content="none">', '<meta name="robots" data-note="a > b" content="index, noindex">'];
    const quiet = ['<meta name="robots" data-content="noindex">', '<meta name="description" content="noindex is a word">', '<meta name="robots-extra" content="noindex">', '<meta name="robots" content="index, follow">',
      '<meta name="robots" content="nonexistent">'];
    const block = [...fires.map(t => ({ t, fire: true })), ...quiet.map(t => ({ t, fire: false }))];
    const after = edit(dir, 'web/index.html', s => s.replace('</head>', block.map(b => b.t).join('\n') + '\n</head>'));
    const first = lineOf(after, after.indexOf(block[0].t));
    const want = block.map((b, i) => (b.fire ? first + i : null)).filter(Boolean);
    const r = surface(dir);
    const got = [...r.out.matchAll(/web\/index\.html: line (\d+): carries a robots noindex meta tag/g)].map(m => Number(m[1]));
    assert.deepEqual(got, want, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 16 reads web/_headers: an X-Robots-Tag noindex or none on a production path fails, and the absolute workers.dev preview rule does not', () => {
  const dir = surfaceCopy();
  try {
    const before = readFileSync(join(dir, 'web/_headers'), 'utf8');
    assert.match(before, /https:\/\/:version\.:subdomain\.workers\.dev\/\*\n {2}X-Robots-Tag: noindex/, 'the real preview rule is in the tree, so a pass means the exemption works');
    const after = edit(dir, 'web/_headers', s => s.replace(/\s*$/, '\n') + '\n/probe-a\n  X-Robots-Tag: noindex\n\n/probe-b\n  x-robots-tag: none, nofollow\n\nhttps://other.workers.dev/*\n  X-Robots-Tag: noindex\n');
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    const a = lineOf(after, after.indexOf('  X-Robots-Tag: noindex\n\n/probe-b')), b = lineOf(after, after.indexOf('  x-robots-tag: none'));
    assert.ok(r.out.includes(`web/_headers: line ${a}: sets X-Robots-Tag "noindex" on "/probe-a"`), r.out);
    assert.ok(r.out.includes(`web/_headers: line ${b}: sets X-Robots-Tag "none, nofollow" on "/probe-b"`), r.out);
    assert.ok(!r.out.includes('other.workers.dev'), 'an absolute workers.dev pattern is a preview host and is not named');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 16 is not emptied by a tag it cannot read: an unterminated meta, or one that does not end within the cap, is a finding, never a pass', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</head>', '<meta name="robots" content="noindex\n</head>'));
    const line = lineOf(after, after.indexOf('<meta name="robots" content="noindex\n'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: a <meta tag`) && /was not read/.test(r.out), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── rule 15: the dropped "no trackers" claim ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('rule 15 reads EVERY tracked page: the claim planted in each page, in English, wrapped over a line break, in any case, and in Thai, is named by that page and line', () => {
  const dir = surfaceCopy();
  try {
    const pages = pagesOf(dir);
    const planted = {};
    for (const f of pages) {
      const block = `<p>${NO_TRACKERS_EN}</p>\n<p>No\n   Trackers here</p>\n<p>${NO_TRACKERS_TH}</p>\n`;
      const after = edit(dir, f, s => s.replace('</body>', block + '</body>'));
      const at = after.indexOf(NO_TRACKERS_EN) + 'We have '.length;
      planted[f] = { en: lineOf(after, at), wrapped: lineOf(after, after.indexOf('No\n   Trackers')), th: lineOf(after, after.indexOf(NO_TRACKERS_TH)) };
    }
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    for (const [f, l] of Object.entries(planted)) {
      assert.ok(r.out.includes(`${f}: line ${l.en}: says "no trackers"`), f + ' English\n' + r.out);
      assert.ok(r.out.includes(`${f}: line ${l.wrapped}: says "No Trackers"`), f + ' wrapped\n' + r.out);
      assert.ok(r.out.includes(`${f}: line ${l.th}: says "${NO_TRACKERS_TH}"`), f + ' Thai\n' + r.out);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 15 against its dirty fixture: the page set at the parent of 94b9415, which says "no trackers" in both languages, fails the rule on each of its lines', t => {
  const parent = spawnSync('git', ['show', '94b9415^:web/index.html'], { cwd: ROOT, encoding: 'utf8', timeout: 30000, maxBuffer: 16 << 20 });
  if (parent.status !== 0 || !parent.stdout) { t.skip('commit 94b9415 is not in this clone (a shallow checkout); the planted-claim test above holds the same rule on every page'); return; }
  const dir = surfaceCopy();
  try {
    const dirty = parent.stdout.replace(/\r\n/g, '\n');
    writeFileSync(join(dir, 'web/index.html'), dirty);
    const want = [...dirty.matchAll(/\bno\s+trackers\b/gi), ...dirty.matchAll(/ไม่มีตัวติดตาม/g)].map(m => lineOf(dirty, m.index));
    assert.ok(want.length >= 2, 'the fixture holds the claim in both languages');
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    const got = [...r.out.matchAll(/web\/index\.html: line (\d+): says "(?:no\s+trackers|ไม่มีตัวติดตาม)"/gi)].map(m => Number(m[1]));
    assert.deepEqual(got.sort((a, b) => a - b), want.sort((a, b) => a - b), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 15 is not emptied by its own scope: a tree whose only tracked page is the pinned changelog is a finding, never a pass', () => {
  const dir = surfaceCopy();
  try {
    for (const f of pagesOf(dir).filter(f => f !== 'web/changelog.html')) rmSync(join(dir, f));
    restage(dir);
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes('web/: has no tracked HTML page outside the pinned changelog, so rule 15 read only pinned text'), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 15 pins: the quoted withdrawn claim on the changelog page passes, and a pasted copy of a pinned passage fires', () => {
  const dir = surfaceCopy();
  try {
    const html = readFileSync(join(dir, 'web/changelog.html'), 'utf8');
    const m = /<(p|li) class="t"[^>]*>(?:(?!<\/\1>)[\s\S])*The home page footer no longer says(?:(?!<\/\1>)[\s\S])*<\/\1>/.exec(html);
    assert.ok(m, 'the pinned passage is on the page');
    assert.ok(/no trackers/i.test(m[0]), 'and it quotes the claim, so the pin is exercised by the baseline');
    edit(dir, 'web/changelog.html', s => s.replace(m[0], m[0] + '\n' + m[0]));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /web\/changelog\.html: line \d+: says "no trackers"/);
    assert.match(r.out, /web\/changelog\.html: pinned passage [0-9a-f]{16} .* appears 3 time\(s\) on the page/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the readers, as units ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('metaTagsOf: a tag ends at the first > outside a quote, a nested <meta inside a quoted value is part of the outer tag, and a tag it cannot end is UNREAD (and the next one is still read)', async () => {
  const { metaTagsOf, META_MAX } = await lib();
  const a = metaTagsOf('<p><meta name="a" data-x="<meta name=robots content=noindex>" content="y"> <META name=b>');
  assert.deepEqual(a.tags.map(t => t.text), ['<meta name="a" data-x="<meta name=robots content=noindex>" content="y">', '<META name=b>']);
  assert.deepEqual(a.unread, []);
  const b = metaTagsOf('<meta name="robots" content="noindex\n<meta name=ok>');
  assert.equal(b.unread.length >= 1, true, 'the unterminated quote is unread');
  assert.ok(b.tags.every(t => t.index > 0), 'and what it hid is not read as the first tag');
  const long = '<meta name="robots" content="' + 'a'.repeat(META_MAX) + 'noindex">';
  const c = metaTagsOf(long + '<meta name=after>');
  assert.deepEqual(c.unread, [0], 'a tag longer than the cap is unread, not silently skipped');
  assert.deepEqual(c.tags.map(t => t.text), ['<meta name=after>'], 'the tag after it is read');
  assert.deepEqual(metaTagsOf('<metadata><meta2>'), { tags: [], unread: [] }, 'only a meta element');
});

test('isRobotsNoindex: the whole attribute name, the exact name value, noindex or none as a word', async () => {
  const { isRobotsNoindex } = await lib();
  for (const t of ['<meta name="robots" content="noindex">', '<meta content=none name=robots>', "<meta name='ROBOTS' content='index,NOINDEX'>"]) assert.equal(isRobotsNoindex(t), true, t);
  for (const t of ['<meta name="robots" data-content="noindex">', '<meta data-name="robots" content="noindex">', '<meta name="robots2" content="noindex">', '<meta name="robots" content="nonexistent">', '<meta name="viewport" content="none">']) assert.equal(isRobotsNoindex(t), false, t);
});

test('passagesOf and pinnedHitter: passages in order with a text fingerprint, an unclosed passage ends the scan for its tag, and a pin excuses a hit only while the page holds exactly its count of copies', async () => {
  const { passagesOf, passageFp, pinnedHitter } = await lib();
  const page = '<p class="t">one <b>two</b></p><li class="t">three</li><p class="t">one two</p><p class="t">never closed';
  const ps = passagesOf(page);
  assert.deepEqual(ps.map(p => page.slice(p.start, p.end)), ['<p class="t">one <b>two</b></p>', '<li class="t">three</li>', '<p class="t">one two</p>']);
  assert.equal(ps[0].fp, ps[2].fp, 'tags are removed and white space is collapsed before the fingerprint');
  assert.equal(ps[1].fp, passageFp('three'));
  const pin = (fp, count) => [{ file: 'web/x.html', fp, count }];
  const at = page.indexOf('three');
  assert.equal(pinnedHitter('web/x.html', page, pin(ps[1].fp, 1))(at), true, 'one copy, pinned for one');
  assert.equal(pinnedHitter('web/x.html', page, pin(ps[1].fp, 2))(at), false, 'the count must match');
  assert.equal(pinnedHitter('web/y.html', page, pin(ps[1].fp, 1))(at), false, 'another file');
  assert.equal(pinnedHitter('web/x.html', page, pin(ps[0].fp, 2))(page.indexOf('two')), true, 'two copies, pinned for two');
  assert.equal(pinnedHitter('web/x.html', page, pin(ps[0].fp, 1))(page.indexOf('two')), false, 'a pasted copy excuses none');
  assert.equal(pinnedHitter('web/x.html', page, pin(ps[1].fp, 1))(0), false, 'a hit outside the passage');
  assert.equal(pinnedHitter('web/x.html', page, [])(at), false, 'no pins');
});

// ── linear, under a kill timeout ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the readers finish on bulk input that gives them nothing to match: unterminated and unclosed tags, passages without a closer, hits with no passage, and many passages with a hit each', () => {
  const dir = mkdtempSync(join(tmpdir(), 'page-claims-linear-'));
  const child = `
    const { metaTagsOf, isRobotsNoindex, passagesOf, pinnedHitter } = await import(${JSON.stringify(LIB)});
    const N = 50000, Q = String.fromCharCode(34), A = String.fromCharCode(39);
    const metas = [
      '<meta ' + Q, '<meta ' + A, '<meta a', '<meta ' + 'a '.repeat(N), '<meta name=' + Q + 'robots' + Q + ' ' + ('content=' + Q + 'a ').repeat(N), ('<meta name = ').repeat(N), '<meta '.repeat(N),
    ].map(s => s.length < 1000 ? s.repeat(N) : s);
    const pages = [
      '<p class=' + Q + 't' + Q + '>'.repeat(1) , '<p class=' + Q + 't' + Q, '<li class=' + Q + 't' + Q + '>no trackers',
    ].map(s => s.repeat(N)).concat([
      ('<p class=' + Q + 't' + Q + '>no trackers</p>').repeat(N), 'no trackers '.repeat(N), ('no' + ' '.repeat(50)).repeat(N), '<p class=' + Q + 't' + Q + ' '.repeat(N) + '>x</p>',
    ]);
    let seen = 0;
    for (const s of metas) { for (const t of metaTagsOf(s).tags) isRobotsNoindex(t.text); seen++; }
    const claims = [/\\bno\\s+trackers\\b/gi];
    for (const s of pages) {
      passagesOf(s);
      const pinned = pinnedHitter('web/x.html', s, [{ file: 'web/x.html', fp: '0000000000000000', count: 1 }]);
      for (const re of claims) for (const m of s.matchAll(re)) pinned(m.index);
      seen++;
    }
    console.log('FINISHED ' + seen);
  `;
  try {
    const r = spawnSync(process.execPath, ['--max-old-space-size=512', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir) });
    assert.equal(r.error, undefined, 'the child was not killed by the timeout: ' + (r.error && r.error.message));
    assert.equal(r.signal, null);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^FINISHED 14\n?$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The gate size is 4,000 unterminated tags, not 40,000: at 40,000 the page took 76 s (measured 2026-10-24), and the cost is NOT in rules 15 and 16. Rule 13's `<meta ... http-equiv` test and rule 17's TAG
// pattern (`<([a-zA-Z][\w-]*)\b((?:"[^"]*"|...)*)>`) each scan from every `<meta` to the end of the page when no `>` closes it: quadratic, pre-existing, out of this unit (see the return). The library reader itself
// is timed at 40,000 in the child test below (0.8 s).
test('RED PROOF at the gate: surface-check finishes on a page of 4,000 unterminated meta tags and on a page of 3,000 passages that each say the withdrawn claim (the inline readers took 30 s and 28 s)', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/index.html', s => s.replace('</body>', '<meta "'.repeat(4000) + '</body>'));
    const a = surface(dir, 40000);
    assert.equal(a.error, undefined, 'unterminated metas: surface-check was killed by the timeout');
    assert.equal(a.status, 1, 'and it names them: ' + a.out.slice(0, 600));
    assert.match(a.out, /web\/index\.html: line \d+: a <meta tag/);
    assert.ok(a.out.split('\n').filter(l => l.includes('a <meta tag')).length <= 2, 'one finding for the page, not one per tag');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  const dir2 = surfaceCopy();
  try {
    edit(dir2, 'web/changelog.html', s => s.replace('</body>', '<p class="t">no trackers</p>'.repeat(3000) + '</body>'));
    const b = surface(dir2, 40000);
    assert.equal(b.error, undefined, 'passages with a hit each: surface-check was killed by the timeout');
    assert.equal(b.status, 1);
    assert.equal((b.out.match(/web\/changelog\.html: line \d+: says "no trackers"/g) || []).length >= 3000, true, 'every hit is named');
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});
