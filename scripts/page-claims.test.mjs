// Tests for surface-check rules 15 (the dropped "no trackers" claim) and 16 (no robots noindex on a production page), and for the readers behind them (scripts/lib/page-claims.mjs).
//
// Each rule owes three things, and this file is where they are held:
//   1. RED-FIRST: the rule FIRES on the dirty input (a mutant with a noindex meta on the home page; the page set at the parent of 94b9415, which says "no trackers"). The gate tests run
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
const surface = (dir, timeout = 120000) => { const r = spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 }); return { ...r, out: (r.stdout || '') + (r.stderr || '') }; };
const pagesOf = dir => readdirSync(join(dir, 'web')).filter(f => f.endsWith('.html')).sort().map(f => 'web/' + f);
const edit = (dir, f, fn) => { const p = join(dir, f); const before = readFileSync(p, 'utf8'); const after = fn(before); assert.notEqual(after, before, f + ' was not changed'); writeFileSync(p, after); return after; };

const META_I1 = '<meta name="robots" content="noindex">';
const NO_TRACKERS_EN = 'We have no trackers.', NO_TRACKERS_TH = 'ไม่มีตัวติดตาม';

test('baseline: the tracked tree passes surface-check (the tests below plant one defect each)', () => {
  const dir = surfaceCopy();
  try { const r = surface(dir); assert.equal(r.status, 0, r.out); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── rule 16: a mutant with a noindex meta on the home page, and the pages, tag spellings and headers around it ─────────────────────────────────────────────────────────────────────
test('rule 16 fires on a robots noindex meta on the home page, and fails surface-check, naming the page and the line', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</head>', META_I1 + '\n</head>'));
    const line = lineOf(after, after.indexOf(META_I1));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: carries a robots noindex meta tag`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 16 reads EVERY production page: the meta planted in each page but the 404 is named by that page, and the 404 page and the subprocessor page keep their named exemptions', () => {
  const dir = surfaceCopy();
  try {
    const pages = pagesOf(dir);
    assert.ok(pages.length >= 7, 'the tracked pages: ' + pages.join(', '));
    assert.match(readFileSync(join(dir, 'web/404.html'), 'utf8'), /name="robots"[^>]*noindex|noindex[^>]*name="robots"/i, 'the 404 page carries its own noindex, so the exemption is exercised');
    const planted = {};
    for (const f of pages.filter(f => f !== 'web/404.html' && f !== 'web/subprocessors.html')) { const after = edit(dir, f, s => s.replace('</head>', META_I1 + '\n</head>')); planted[f] = lineOf(after, after.indexOf(META_I1)); }
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    for (const [f, line] of Object.entries(planted)) assert.ok(r.out.includes(`${f}: line ${line}: carries a robots noindex meta tag`), f + '\n' + r.out);
    assert.ok(!r.out.includes('web/404.html: line'), 'the 404 page is not named');
    assert.ok(!r.out.includes('web/subprocessors.html: line'), 'the subprocessor page is exempt by name, so it is not named');
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
    // At the end of the file, so that no later quote closes the value: the tokenizer then runs off the end and the tag is unread.
    const after = edit(dir, 'web/index.html', s => s + '<meta name="robots" content="noindex\n');
    const line = lineOf(after, after.indexOf('<meta name="robots" content="noindex\n'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: a <meta tag`) && /was not read/.test(r.out), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 16 reads a quote as the HTML tokenizer does: a quote opens a value only after the = of an attribute, so a quote in a name or in an unquoted value is a plain character and the tag ends at its real >', async () => {
  const { metaTagsOf, isRobotsNoindex } = await lib();
  for (const row of ['<meta data-x=a" data-y="b > c" name="robots" content="noindex">', "<meta name=robots x=it's content=noindex>", '<meta x"y="z > w" name="robots" content="noindex">']) {
    const r = metaTagsOf(row);
    assert.deepEqual(r.unread, [], row);
    assert.deepEqual(r.tags.map(t => t.text), [row], row);
    assert.equal(isRobotsNoindex(r.tags[0].text), true, row);
  }
});

test('rule 16 fails the tokenizer witness at the gate: a stray quote in an unquoted value does not hide a real noindex that follows it', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/index.html', s => s.replace('</head>', '<meta data-x=a" data-y="b > c" name="robots" content="noindex">\n</head>'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /web\/index\.html: line \d+: carries a robots noindex meta tag/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a page-claims library that will not load: surface-check names the import, and prints no "remove it" line for a pin it could not read', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'scripts/lib/page-claims.mjs', s => 'export const broken = ;\n' + s);
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /scripts\/lib\/page-claims\.mjs: could not be loaded/, r.out);
    assert.doesNotMatch(r.out, /matches no passage of the page, so the pin excuses nothing/, r.out);
    // Rule 17(a) reads the pins too: without the library it does not run, so the pinned Free-plan passage on the changelog is not named as a finding.
    assert.doesNotMatch(r.out, /web\/changelog\.html: line \d+: says "(?:Free|free plan|free tier)"/i, r.out);
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

test('rule 17(a) keeps the pinned Free-plan passage on the changelog quiet, and names an unpinned Free plan on another page', async () => {
  const { passagesOf } = await lib();
  const dir = surfaceCopy();
  try {
    const changelog = readFileSync(join(dir, 'web/changelog.html'), 'utf8');
    const hits = [...changelog.matchAll(/\bfree\b|ฟรี/gi)];
    assert.ok(hits.length > 0, 'the changelog quotes the Free-plan text, so the pin is exercised');
    const ps = passagesOf(changelog);
    assert.ok(hits.every(m => ps.some(p => m.index >= p.start && m.index < p.end)), 'every Free word on the changelog sits in a passage, which the pin covers');
    const after = edit(dir, 'web/index.html', s => s.replace('</body>', '<p>Free plan</p></body>'));
    const line = lineOf(after, after.indexOf('<p>Free plan</p>'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: says "Free"`), r.out);
    assert.doesNotMatch(r.out, /web\/changelog\.html: line \d+: says "(?:Free|free plan|free tier|ฟรี)"/i, r.out);
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
  assert.deepEqual(metaTagsOf('<metadata><meta2>'), { tags: [], unread: [], hidden: [] }, 'only a meta element');
});

test('startTagEnd: white space before a quoted value, an apostrophe inside a double-quoted value, and the next attribute after a closed value', async () => {
  const { startTagEnd, startTagsOf } = await lib();
  const spaced = '<a x= "a>b">z';
  assert.equal(startTagEnd(spaced, 2), spaced.indexOf('">') + 2, 'a space before the quote: the > inside the value does not end the tag');
  const apostrophe = '<a title="it\'x>y">z';
  assert.equal(startTagEnd(apostrophe, 2), apostrophe.indexOf('">') + 2, 'an apostrophe in a double-quoted value does not close the value');
  const after = '<a x="1" y="a>b">z';
  assert.equal(startTagEnd(after, 2), after.indexOf('">') + 2, 'a space after a closed value starts the next attribute; the > inside its value is not the end');
  assert.deepEqual(startTagsOf(after, /<(a)\b/gi).tags[0].attrs.map(a => a.name), ['x', 'y'], 'the names are read whole: a space after a closed value starts no name');
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

// The unterminated-tag half uses 4,000 tags, not 40,000: at 40,000 the whole gate took about 76 s on this box (measured 2026-10-24), and that cost is NOT in rules 15 and 16. Rule 13's `<meta ... http-equiv` test and
// rule 17's TAG pattern each scanned from every `<meta` to the end of the page when no `>` closed it, so the gate was quadratic in that input. Both now read their tags with the bounded reader of
// scripts/lib/page-claims.mjs, and the gate rows further down hold them. The readers themselves are checked for linear time by the child test above: it runs N = 50,000 of each shape under a 512 MB heap cap and a 60 s SIGKILL,
// and asserts that the child finished, with no timing assert.
// The passage half is a time criterion, chosen by its margin: 8,000 passages under a 60 s kill. Measured on the box of 2026-10-24, the fixed rule took about 8 s and the rule as it stood at 7aefb8b, quadratic
// in the passages, took about 238 s, so the kill sits about seven times above the first and about four times below the second, and either margin survives a runner that is several times slower or a little faster.
test('RED PROOF at the gate: surface-check finishes on a page of 4,000 unterminated meta tags and on a page of 8,000 passages that each say the withdrawn claim', () => {
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
    edit(dir2, 'web/changelog.html', s => s.replace('</body>', '<p class="t">no trackers</p>'.repeat(8000) + '</body>'));
    const b = surface(dir2, 60000);
    assert.equal(b.error, undefined, 'passages with a hit each: surface-check was killed by the timeout');
    assert.equal(b.status, 1);
    // The 8,000 hits are on one line, so they are counted, not located. On a short count the message carries what the gate printed: the count, the status, the size of the output, the
    // lines that are not claim lines (a load failure or another rule would show there), and the tail of the output, so a red run on another runner explains itself.
    const named = (b.out.match(/web\/changelog\.html: line \d+: says "no trackers"/g) || []).length;
    const others = b.out.split('\n').filter(l => l.trim() && !/says "no trackers"/.test(l)).slice(0, 5);
    assert.equal(named >= 8000, true, `every hit is named: ${named} of 8000 named; status ${b.status}; output ${b.out.length} characters; other lines ${JSON.stringify(others)}; the output's last 300 characters ${JSON.stringify(b.out.slice(-300))}`);
  } finally { rmSync(dir2, { recursive: true, force: true }); }
});

// ── CLASS B: an opener with no closer costs a bounded scan ─────────────────────────────────────────────
// Each gate row appends BULK_N openers with no closer to a page and runs surface-check in a child under a heap cap (512 MB) and a kill timer (60 s). The row asserts that the child
// FINISHED: not killed and no signal, and that it exits with a finding. No time is asserted, so the row cannot pass on a fast box and fail on a slow one, and a quadratic rule is killed.
// The rows that cannot be isolated are not here: rule 17's visible-text strip (rule 17a) and rule 5 read the same openers and are not changed here (a follow-up gives them the same reader).
const BULK_N = 200000;
const bulkGate = (dir, unit) => {
  edit(dir, 'web/index.html', s => s.replace('</body>', unit.repeat(BULK_N) + '</body>'));
  return spawnSync(process.execPath, ['--max-old-space-size=512', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
};
const finishedNamed = (r, label, msgs) => {
  assert.equal(r.error, undefined, label + ': surface-check was killed by the 60 s timer, so it did not finish: ' + (r.error && r.error.code));
  assert.equal(r.signal, null, label + ': killed by ' + r.signal);
  assert.equal(r.status, 1, label + ': finished, and it must name the page: ' + (r.stdout + r.stderr).slice(0, 400));
  for (const m of msgs) assert.match(r.stdout + r.stderr, m, label + ': the finding of its own rule is missing');
};
test('CLASS B gate row, rules 13 and 16: 200,000 unterminated <meta " openers finish, and rule 13 names its own unread tags', () => {
  const dir = surfaceCopy();
  try { finishedNamed(bulkGate(dir, '<meta "'), '<meta "', [/web\/index\.html: has \d+ <meta> tag\(s\) the reader cannot read to its end/]); } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLASS B gate row, rule 13: 200,000 unterminated <link openers finish, and rule 13 names its own unread tags', () => {
  const dir = surfaceCopy();
  try { finishedNamed(bulkGate(dir, '<link '), '<link ', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]); } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLASS B gate row, rules 13 and 17: 200,000 unterminated <a openers finish, and each rule names its own unread tags', () => {
  const dir = surfaceCopy();
  try {
    finishedNamed(bulkGate(dir, '<a '), '<a ', [
      /web\/index\.html: has \d+ start tag\(s\) the reader cannot read to its end \(first at line \d+\), so rule 13 cannot check it/,
      /web\/index\.html: has \d+ start tag\(s\) the reader cannot read to their end \(first at line \d+\), so the buy-control and payment checks cannot read them/,
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('CLASS B gate row, rule 17: 200,000 unclosed <a> elements finish, and rule 17 names its own unclosed anchors', () => {
  const dir = surfaceCopy();
  try { finishedNamed(bulkGate(dir, '<a>'), '<a>', [/web\/index\.html: has \d+ <a> element\(s\) with no closer/]); } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the tag name and the end tag are read as the tokenizer reads them ─────────────────────────────────────
test('rule 17 reads an end tag whose name runs on: </a.x> is not the end of <a>, so the buy link after it is still read', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</body>', '<a href="/x">Hi</a.x>Buy now</a>\n</body>'));
    const line = lineOf(after, after.indexOf('<a href="/x">Hi'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: has a link that reads as a buy control ("Hi Buy now")`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rule 17 reads a tag name the tokenizer reads: <i.x="><button>Buy</button>"> ends at its first >, so the live button after it is read', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</body>', '<i.x="><button>Buy</button>">t\n</body>'));
    const line = lineOf(after, after.indexOf('<button>Buy'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: has a button that is not disabled`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the handler and the style attribute are read from the attributes, not from the white space before them ─────────
// ── an element is the tokenizer's whole tag name: <script-x> is no <script>, <a-b> is no <a>, and the real element after it is read ─────────
// Admits, in web/_headers, each inline script hash that rule 13 names as missing (the first run lists them, the second run is the verdict), so rule 13 passes and only rule 17 can speak.
const admitScripts = dir => {
  const first = surface(dir);
  const hashes = [...new Set([...first.out.matchAll(/does not admit the inline script whose hash is ('sha256-[^']+')/g)].map(m => m[1]))];
  assert.ok(hashes.length > 0, 'the first run names no missing script hash: ' + first.out);
  edit(dir, 'web/_headers', h => h.replace(/script-src([^;\n]*)/g, (m, rest) => 'script-src' + rest + ' ' + hashes.join(' ')));
  return surface(dir);
};
test('rule 17 reads the real <script> after <script-x>: <script-x> is no script, so the payment script after it is named at its own line', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</body>', '<script-x></script-x><script>Paddle.Setup({})</script>\n</body>'));
    const line = lineOf(after, after.indexOf('<script>Paddle'));
    const r = admitScripts(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${line}: carries a payment script`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rule 13 wants no hash for <style-x>: its empty body is not an inline style, so the empty-body hash is not named, and the real <style> after it is read', async () => {
  const { cspHash } = await import(pathToFileURL(join(ROOT, 'scripts/lib/csp-hashes.mjs')).href);
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/index.html', s => s.replace('</body>', '<style-x></style-x><style>.k{color:red}</style>\n</body>'));
    const r = surface(dir);
    assert.ok(!r.out.includes(cspHash('')), 'the empty body of <style-x> was hashed as an inline style: ' + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rule 17 reads the real <a> after a longer name: <a-b>, <a:b> and <a.b> are other elements, and the role, the aria-label or the text of the real link is read', () => {
  for (const [plant, read] of [
    ['<a-b>x</a-b><a href="/x" role="button">Go</a>', '("Go")'],
    ['<a-b>x</a-b><a href="/x" aria-label="Buy now">Go</a>', '("Go Buy now")'],
    ['<a:b>x</a:b><a href="/x" role="button">Go</a>', '("Go")'],
    ['<a.b>x</a.b><a href="/x" role="button">Go</a>', '("Go")'],
    ['<a-b>x</a-b><a href="/x">Buy now</a>', '("Buy now")'],
  ]) {
    const dir = surfaceCopy();
    try {
      const after = edit(dir, 'web/index.html', s => s.replace('</body>', plant + '\n</body>'));
      const line = lineOf(after, after.indexOf('<a href="/x"'));
      const r = surface(dir);
      assert.equal(r.status, 1, plant + '\n' + r.out);
      assert.ok(r.out.includes(`web/index.html: line ${line}: has a link that reads as a buy control ${read}`), plant + '\n' + r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
test('the reader names an element by its whole tag name: <script-x> and <a.b> are not the fixed-name element, and the all-tags name is the whole name', async () => {
  const { elementsOf, startTagsOf } = await lib();
  const e = elementsOf('<script-x></script-x><script>p()</script>', /<(script)\b/gi);
  assert.deepEqual(e.elements.map(x => x.body), ['p()'], 'the real script, read to its own closer');
  assert.deepEqual(e.unclosed, [], 'the script-x opener is no element at all');
  assert.deepEqual(startTagsOf('<a.b><a>', /<(a)\b/gi).tags.map(t => t.text), ['<a>'], 'a.b is not an a');
  assert.equal(startTagsOf('<a:b c>', /<([a-zA-Z][^\s/>]*)/g).tags[0].name, 'a:b', 'the name the tokenizer reads');
});

test('rule 13 finds an event handler or a style attribute the browser reads with no white space before it, and an upper-case one, and does not find one inside a quoted value', () => {
  for (const plant of ['<a/onclick="x()">t</a>', '<a x="1"onclick="x()">t</a>', '<a ONCLICK="x()">t</a>', '<a/style="color:red">t</a>']) {
    const dir = surfaceCopy();
    try {
      edit(dir, 'web/index.html', s => s.replace('</body>', plant + '\n</body>'));
      const r = surface(dir);
      assert.equal(r.status, 1, plant + '\n' + r.out);
      assert.ok(r.out.includes('web/index.html: has an inline event handler or style="" attribute'), plant + '\n' + r.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/index.html', s => s.replace('</body>', '<a title="a onclick=x">t</a>\n</body>'));
    const r = surface(dir);
    assert.ok(!r.out.includes('has an inline event handler'), 'a handler-looking text inside a quoted value is not an attribute: ' + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rule 13 does not pass a <script> or a <style> it cannot close: each is a finding that names its page and line, and an unclosed <style> raises no stale-hash note for the page', () => {
  const dir = surfaceCopy();
  try {
    const after = edit(dir, 'web/index.html', s => s.replace('</body>', '<script>var probe = 1;\n<style>.probe{color:#000}\n</body>'));
    const line = lineOf(after, after.indexOf('<script>var probe'));
    const r = spawnSync(process.execPath, ['--max-old-space-size=512', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    assert.ok(out.includes(`web/index.html: has 1 <script> element(s) with no closer (first at line ${line})`), out);
    assert.ok(out.includes('web/index.html: has 1 <style> element(s) with no closer'), out);
    assert.ok(!/web\/_headers: line \d+: style-src admits .* \(a stale hash\)/.test(out), 'no stale-hash note for the styles of a page that could not be read: ' + out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── CLASS B: the shared reader, as unit tests ─────────────────────────────────────────────────────────────────────
test('startTagEnd takes the index where the tag NAME ends, and a bound: a tag the bound does not end is unread, and a tag it ends reads to its real >', async () => {
  const { startTagEnd, startTagsOf, META_MAX } = await lib();
  assert.equal(startTagEnd('<a href="x>y">z', 2), 14, 'the > inside the quoted value does not end the tag');
  assert.equal(startTagEnd('<a title="' + 'x'.repeat(50) + '">', 2, 20), -1, 'a bound shorter than the tag: unread');
  const tag = '<a title="' + 'x'.repeat(50) + '">';
  assert.equal(startTagEnd(tag, 2), tag.length, 'the default bound reads it, to the index after its >');
  const r = startTagsOf('<a x="1"><a title="' + 'y'.repeat(META_MAX) + '">', /<(a)\b/gi);
  assert.equal(r.tags.length, 1, 'the first tag is read');
  assert.deepEqual(r.unread, [9], 'the long one is unread, at its opener, and nothing is passed');
});

test('elementsOf: a body is read to its own closer and is not read as tags; a closer is boundary-checked; an element with no closer is unclosed, and the openers after it are too', async () => {
  const { elementsOf } = await lib();
  const e = elementsOf('<script>a<a>b</script><script>c</script>', /<(script)\b/gi);
  assert.deepEqual(e.elements.map(x => x.body), ['a<a>b', 'c'], 'the <a> inside the first body is not an element of its own');
  assert.deepEqual(e.unclosed, [], e.unread.join());
  // A body is not read as tags: an opener of the same name inside a body is part of that body, and the closer is the first one after it. A scan that resumes after the start tag reads the
  // inner <script> as an element of its own, so this input has to contain one (an <a> inside a <script> body is never matched by a <(script)\b> scan).
  const nested = elementsOf('<script>a<script>b</script>c</script>', /<(script)\b/gi);
  assert.deepEqual(nested.elements.map(x => x.body), ['a<script>b'], 'an opener inside a body is not an element of its own');
  const near = elementsOf('<a>one</abbr>', /<(a)\b/gi);
  assert.deepEqual(near.elements, [], '</abbr> does not close <a>');
  assert.deepEqual(near.unclosed, [0], 'the <a> has no closer');
});

// The reader is linear: each shape of unclosed openers finishes, alone, under a heap cap and a kill timer. One child per shape, so each has its own kill timer and a shape
// that is slow cannot hide behind a fast one. No time is asserted. The shapes are 200,000 openers each.
const READER_SHAPES = [
  ['<meta "', '/<(meta)\\b/gi'], ['<link ', '/<(link)\\b/gi'], ['<a ', '/<([a-zA-Z][\\w-]*)\\b/g'], ['<a>', '/<(a)\\b/gi'],
  ['<script>', '/<(script)\\b/gi'], ['<style>', '/<(style)\\b/gi'], ['<script "', '/<(script)\\b/gi'],
];
for (const [unit, re] of READER_SHAPES) {
  test(`the reader finishes on 200,000 unclosed ${unit} openers, in a child under a 256 MB heap cap and a 60 s kill timer`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'page-claims-reader-'));
    const unitText = unit.endsWith('"') ? unit.slice(0, -1) + String.fromCharCode(34) : unit;
    const child = `
      const { startTagsOf, elementsOf } = await import(${JSON.stringify(LIB)});
      const N = 200000;
      const re = ${re};
      const s = ${JSON.stringify(unitText)}.repeat(N);
      const t = startTagsOf(s, re), e = elementsOf(s, re);
      console.log('FINISHED ' + (t.tags.length + t.unread.length + e.elements.length + e.unclosed.length + e.unread.length > 0));
    `;
    try {
      const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir) });
      assert.equal(r.error, undefined, 'the child was not killed by the timeout: ' + (r.error && r.error.message));
      assert.equal(r.signal, null);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /^FINISHED true\n?$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

// ── linear in unclosed comment openers: a count of the comment-end searches, the kill timeout as the hang guard only ──────────────────────
// Each `<!--` that no comment end follows searched to the end of the input, so n unclosed openers cost n searches. The child counts the searches of the comment-end
// pattern (--!?>) and stops at the second one, so the verdict is the count and no clock: a walk that repeats the search fails on the count, whatever the host's speed.
// The 60 s kill guards against a hang only; it does not decide the verdict.
test('the walk searches for a comment end once on 200,000 unclosed comment openers, not once per opener', () => {
  const dir = mkdtempSync(join(tmpdir(), 'page-claims-comments-'));
  const child = `
    const exec = RegExp.prototype.exec;
    let searches = 0;
    RegExp.prototype.exec = function (s) {
      if (this.source === '--!?>' && ++searches > 1) throw new Error('SEARCHES ' + searches + ': the walk searched for a comment end more than once');
      return exec.call(this, s);
    };
    const { elementsOf } = await import(${JSON.stringify(LIB)});
    const r = elementsOf('<!--'.repeat(200000), /<(script)\\b/gi);
    console.log('FINISHED ' + r.hidden.length + ' SEARCHES ' + searches);
  `;
  try {
    const r = spawnSync(process.execPath, ['--max-old-space-size=512', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir) });
    assert.equal(r.error, undefined, 'the child did not finish within its kill timeout (a hang): ' + (r.error && r.error.message));
    assert.equal(r.signal, null);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^FINISHED 200000 SEARCHES 1\n?$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the floor check refuses a _headers rule that removes the Content-Security-Policy with the detach form', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/_headers', s => s.replace(/\n*$/, '\n') + '\n/headers-removal-probe\n  ! Content-Security-Policy\n');
    restage(dir);
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /web\/_headers: line \d+: removes the Content-Security-Policy on \/headers-removal-probe/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
