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
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 30000, env: childEnv(ROOT) }).stdout.split('\0').filter(Boolean);
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
    for (const f of pages.filter(f => f !== 'web/404.html' && f !== 'web/subprocessors.html' && f !== 'web/legal.html')) { const after = edit(dir, f, s => s.replace('</head>', META_I1 + '\n</head>')); planted[f] = lineOf(after, after.indexOf(META_I1)); }
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    for (const [f, line] of Object.entries(planted)) assert.ok(r.out.includes(`${f}: line ${line}: carries a robots noindex meta tag`), f + '\n' + r.out);
    assert.ok(!r.out.includes('web/404.html: line'), 'the 404 page is not named');
    assert.ok(!r.out.includes('web/subprocessors.html: line'), 'the subprocessor page is exempt by name, so it is not named');
    assert.ok(!r.out.includes('web/legal.html: line'), 'the legal hub is exempt by name, so it is not named');
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

test('rule 16 reads web/_headers: an X-Robots-Tag noindex or none on a production path fails, and the absolute previews.kolwen.com preview rule does not', () => {
  const dir = surfaceCopy();
  try {
    const before = readFileSync(join(dir, 'web/_headers'), 'utf8');
    assert.match(before, /https:\/\/:preview\.previews\.kolwen\.com\/\*\n {2}X-Robots-Tag: noindex/, 'the real preview rule is in the tree, so a pass means the exemption works');
    const after = edit(dir, 'web/_headers', s => s.replace(/\s*$/, '\n') + '\n/probe-a\n  X-Robots-Tag: noindex\n\n/probe-b\n  x-robots-tag: none, nofollow\n\nhttps://other.previews.kolwen.com/*\n  X-Robots-Tag: noindex\n\nhttps://a.b.previews.kolwen.com/*\n  X-Robots-Tag: noindex\n\nhttps://*.previews.kolwen.com/*\n  X-Robots-Tag: noindex\n');
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    const a = lineOf(after, after.indexOf('  X-Robots-Tag: noindex\n\n/probe-b')), b = lineOf(after, after.indexOf('  x-robots-tag: none'));
    assert.ok(r.out.includes(`web/_headers: line ${a}: sets X-Robots-Tag "noindex" on "/probe-a"`), r.out);
    assert.ok(r.out.includes(`web/_headers: line ${b}: sets X-Robots-Tag "none, nofollow" on "/probe-b"`), r.out);
    // K-191: a host with two labels, or a splat, is not one preview label, so each is named (the exemption admits one label or one placeholder only).
    for (const p of ['https://a.b.previews.kolwen.com/*', 'https://*.previews.kolwen.com/*']) assert.ok(r.out.includes(`sets X-Robots-Tag "noindex" on "${p}"`), `${p} is not a preview host and is named`);
    // The hostname of every https URL the output names, parsed. A substring test would also match a lookalike that carries the host in its query.
    const hostsNamed = [...r.out.matchAll(/https?:\/\/[^\s"]+/g)].map(m => { try { return new URL(m[0]).hostname; } catch { return null; } });
    assert.ok(!hostsNamed.some(h => h === 'other.previews.kolwen.com'), 'an absolute previews.kolwen.com pattern is a preview host and is not named');
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
    for (const f of [...pagesOf(dir), ...readdirSync(join(dir, 'web', 'th')).map(x => 'web/th/' + x)].filter(f => f !== 'web/changelog.html' && f !== 'web/th/changelog.html')) rmSync(join(dir, f));
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
    assert.match(r.out, /web\/changelog\.html: pinned passage [0-9a-f]{16} .* appears 2 time\(s\) on the page/);
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
const finishedNamed = (r, label, msgs) => {
  assert.equal(r.error, undefined, label + ': surface-check was killed by the 60 s timer, so it did not finish: ' + (r.error && r.error.code));
  assert.equal(r.signal, null, label + ': killed by ' + r.signal);
  assert.equal(r.status, 1, label + ': finished, and it must name the page: ' + (r.stdout + r.stderr).slice(0, 400));
  for (const m of msgs) assert.match(r.stdout + r.stderr, m, label + ': the finding of its own rule is missing');
};
// K-178: the growth row counts scan work as the characters the string primitives charCodeAt, indexOf and slice read or copy inside the planted region (a count, never a
// clock), counted in the child, which keeps the production reader unchanged. A quadratic reader grows that count 16 times for 4 times the openers, a linear one 4 times.
// The sizes are 5,000 and 20,000, so a quadratic mutant finishes inside the 60 s clock and is refused by its count; the timer stays a kill ceiling.
// Not counted: includes, lastIndexOf, startsWith, endsWith, substring, and split with a string; a search made with them is unseen.
// K-180: RegExp exec is counted only when its caller's frame chain holds scanStartTag, the reader's start-tag search (the child reads the chain to its depth), and then by the
// characters the search scans. A sticky (y) search is charged only the characters its one attempt examines (K-186). A failed sticky (y) search is charged the one position it attempts, which holds for the rules' fixed-prefix patterns (`<(name)\b`), not for a sticky pattern whose start can walk (`[^>]*…`). The page-wide rules' short attempts (at most SPAN_STACK characters) are charged without the chain check (K-187) and grow linearly; their longer searches are not charged, because no chain holds scanStartTag, and their whole span is K-186's row.
const GROWTH_SMALL = 5000, GROWTH_LARGE = 20000;
const bulkWork = (dir, unit, n) => {
  const after = edit(dir, 'web/index.html', s => s.replace('</body>', unit.repeat(n) + '</body>'));
  const start = after.indexOf(unit.repeat(n)), end = start + unit.length * n, len = after.length;
  const child = `
    const orig = { charCodeAt: String.prototype.charCodeAt, indexOf: String.prototype.indexOf, slice: String.prototype.slice };
    const START = ${start}, END = ${end}, LEN = ${len};
    const kinds = { charCodeAt: 0, indexOf: 0, slice: 0, exec: 0 };
    const SPAN_STACK = 64;
    const execOrig = RegExp.prototype.exec;
    Error.stackTraceLimit = 10; // the frame chain of the call, read to its depth: a search by exec, test, search, match, matchAll, replace, replaceAll or split with a RegExp (each calls exec; replace, replaceAll and split with a string do not), on the page or a derived string, directly or through a helper, has scanStartTag in its chain
    RegExp.prototype.exec = function (s) {
      const from = (this.global || this.sticky) ? this.lastIndex : 0;
      const m = execOrig.call(this, s);
      if (typeof s === 'string') {
        const to = m ? m.index + m[0].length : (this.sticky ? from + 1 : s.length);
        // A search scanning at most SPAN_STACK characters costs a constant per start tag, so it is charged without the chain check (the stack capture is the slow part).
        // A search on a derived string is charged in full by the characters it scans, with no chain check: the stack capture on those calls is what
        // timed the matchAll mutant out of the clock (K-190, measured 2026-11-21: over 120 s with the capture, 6.5 s without the wrapper).
        // This charges every regex search on any string other than the page, in every rule and file (about 72 M on the real reader, nearly constant in n), so a growth check must read increments, not one ratio (C183-3).
        // A search on the page that scans more than SPAN_STACK characters is charged when its chain holds scanStartTag, by the page's characters.
        // Many short searches per start tag are charged one unit each (a failed sticky attempt), so their number, not their length, carries a quadratic; this count may not refuse it at 5,000 and 20,000 (K-189).
        if (s.length !== LEN) kinds.exec += Math.max(0, to - from);
        else if (to - from <= SPAN_STACK || new Error().stack.includes('scanStartTag')) charge('exec', from, to);
      }
      return m;
    };
    const charge = (kind, lo, hi) => { const a = Math.max(lo, START), b = Math.min(hi, END); if (b > a) kinds[kind] += b - a; };
    String.prototype.charCodeAt = function (i) { if (this.length === LEN) charge('charCodeAt', i, i + 1); return orig.charCodeAt.call(this, i); };
    String.prototype.indexOf = function (search, from) { const r = orig.indexOf.call(this, search, from); if (this.length === LEN) charge('indexOf', Number(from) || 0,r < 0 ? LEN : r + String(search).length); return r; };
    String.prototype.slice = function (a, b) { const s = orig.slice.call(this, a, b); if (this.length === LEN) { const a0 = a === undefined ? 0 : a < 0 ? Math.max(LEN + a, 0) : a; charge('slice', a0, a0 + s.length); } return s; };
    process.on('exit', () => process.stderr.write('LINK_SCAN_WORK ' + JSON.stringify(kinds) + '\\n'));
    await import('./scripts/surface-check.mjs');
  `;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
  const measured = /^LINK_SCAN_WORK (\{.*\})$/m.exec(r.stderr || '');
  const kinds = measured ? JSON.parse(measured[1]) : null;
  return { r, kinds, work: kinds ? Object.values(kinds).reduce((x, y) => x + y, 0) : NaN, ms: Date.now() - t0 };
};
// Four times the openers must do less than eight times the work.
const growthOk = (small, large) => Number.isSafeInteger(small) && small > 0 && Number.isSafeInteger(large) && large >= small && large < 8 * small;
// C183-1: a single ratio at 5,000 and 20,000 is diluted by a charge that does not grow with the openers (the mutant's own work on unplanted tags, and the
// derived base the count charges on the whole pipeline), so the increments over three sizes decide: linear work gives an increment ratio near 2, a quadratic
// one near 4, and the threshold 3 sits between them.
// Its floor: the increments include the real reader's own linear work (about 103.5 M per 5,000 openers), so a quadratic is refused only when its own charge at 5,000 openers exceeds about 35 M (one third of that increment); a sparser quadratic (measured: an unbounded search from about 1 tag in 21, 17 M at 5,000) passes. A mutant row can subtract the real reader measured in the same run and test the difference, which has no floor of this kind.
const growthLinear = (w1, w2, w4) => [w1, w2, w4].every(x => Number.isSafeInteger(x) && x > 0) && w2 >= w1 && w4 >= w2 && (w4 - w2) < 3 * Math.max(1, w2 - w1);
const GROWTH_MID = 10000;
// The three sizes of one unit, each child in its own copy. `mutate`, when given, edits the copies' reader first (the K-178 mutants).
const growthRun = (unit, mutate) => {
  const out = {};
  for (const [key, n] of [['a', GROWTH_SMALL], ['m', GROWTH_MID], ['b', GROWTH_LARGE]]) {
    const dir = surfaceCopy();
    try { if (mutate) mutate(dir); out[key] = bulkWork(dir, unit, n); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  return out;
};
const incrementsOf = m => `work ${m.a.work} → ${m.m.work} → ${m.b.work}: increments ${m.m.work - m.a.work} then ${m.b.work - m.m.work} (increment ratio ${((m.b.work - m.m.work) / Math.max(1, m.m.work - m.a.work)).toFixed(2)})`;
const sizesFinished = (m, label, finding) => {
  finishedNamed(m.a.r, `${label}, ${GROWTH_SMALL} openers`, finding);
  finishedNamed(m.m.r, `${label}, ${GROWTH_MID} openers`, finding);
  finishedNamed(m.b.r, `${label}, ${GROWTH_LARGE} openers`, finding);
};
const growthRow = (t, unit, finding, label) => {
  const m = growthRun(unit);
  sizesFinished(m, label, finding);
  t.diagnostic(`GROWTH ${label}: ${incrementsOf(m)}; largest child ${Math.max(m.a.ms, m.m.ms, m.b.ms)} ms`);
  assert.ok(growthLinear(m.a.work, m.m.work, m.b.work), `${label}: scan work is not linear (${incrementsOf(m)})`);
};
// K-183: a refusal by count counts only when all three children finished normally and named the finding, and each printed a positive safe-integer count; then the
// increments decide (C183-1: the three-size check, not the single ratio).
const refusedByCount = (t, m, label, finding) => {
  sizesFinished(m, label, finding);
  t.diagnostic(`GROWTH ${label}: ${incrementsOf(m)}; largest child ${Math.max(m.a.ms, m.m.ms, m.b.ms)} ms`);
  assert.ok(measuredSpan(m.a.work) && measuredSpan(m.m.work) && measuredSpan(m.b.work), `${label}: a child did not print its scan count, so nothing is refused`);
  assert.equal(growthLinear(m.a.work, m.m.work, m.b.work), false, `${label}: the count must refuse the growth (${incrementsOf(m)})`);
};
// K-178 mutants: one unbounded search per start tag (indexOf), and one copy and search of the rest of the page per start tag (slice). Both must fail by their count.
const mutateIndexOf = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('export function scanStartTag(s, nameEnd, max = META_MAX, collect = false) {', m => m + '\n  s.indexOf(String.fromCharCode(62), nameEnd); // mutant'));
const mutateSlice = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('export function scanStartTag(s, nameEnd, max = META_MAX, collect = false) {', m => m + '\n  s.slice(nameEnd).search(/>/); // mutant'));
test('CLASS B gate row, rules 13 and 16: <meta " openers finish at three sizes, and their scan work grows linearly (K-176)', t => {
  growthRow(t, '<meta "', [/web\/index\.html: has \d+ <meta> tag\(s\) the reader cannot read to its end/], '<meta "');
});
test('K-172: <link openers finish at three sizes, and their scan work grows linearly', t => {
  growthRow(t, '<link ', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/], '<link ');
});
test('CLASS B gate row, rules 13 and 17: <a openers finish at three sizes, and their scan work grows linearly (K-176)', t => {
  growthRow(t, '<a ', [
    /web\/index\.html: has \d+ start tag\(s\) the reader cannot read to its end \(first at line \d+\), so rule 13 cannot check it/,
    /web\/index\.html: has \d+ start tag\(s\) the reader cannot read to their end \(first at line \d+\), so the buy-control and payment checks cannot read them/,
  ], '<a ');
});
test('CLASS B gate row, rule 17: <a> elements finish at three sizes, and their scan work grows linearly (K-176)', t => {
  growthRow(t, '<a>', [/web\/index\.html: has \d+ <a> element\(s\) with no closer/], '<a>');
});
test('K-178: the growth check refuses an indexOf mutant and a slice mutant by their own count, with all three sizes finishing inside the clock', t => {
  for (const [name, mutate] of [['indexOf', mutateIndexOf], ['slice', mutateSlice]]) {
    const m = growthRun('<link ', mutate);
    t.diagnostic(`${name} mutant: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
    refusedByCount(t, m, `${name} mutant`, [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  }
});
// K-180: a regex mutant, one unbounded exec per start tag from its name to the next '>' (the planted openers hold no '>', so each search runs to the page's end).
const mutateRegexExec = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + "\n  { const re = new RegExp('>', 'g'); re.lastIndex = nameEnd; re.exec(s); } // mutant"));
test('K-180: the growth check refuses a regex-exec mutant of the start-tag scan by its own count, with all three sizes finishing', t => {
  const m = growthRun('<link ', mutateRegexExec);
  t.diagnostic(`regex-exec mutant: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
  refusedByCount(t, m, 'regex-exec mutant', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
});
// K-188: the same search on a derived subject (a suffix copy from nameEnd), which the page-subject charge never sees.
const mutateSuffix = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + "\n  />/.exec(s.substring(nameEnd)); // mutant"));
test('K-188: the count refuses a regex search on a derived subject (s.substring) inside scanStartTag, by its own count', t => {
  const m = growthRun('<link ', mutateSuffix);
  t.diagnostic(`suffix mutant: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
  refusedByCount(t, m, 'suffix mutant', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
});
// K-189, the stated limit: a sticky attempt is charged one unit however far it walks, so one sticky walk per start tag (`/[^>]*x/y`) grows superlinearly in
// time (4.3 s and 23 s at 5,000 and 20,000 openers, 5.3 times for 4 times) while its count stays the real reader's (each attempt one unit; a probe counted
// 51,831 and 231,831 such attempts). This row records that fact; a count that later charges the walk flips it, by design.
const mutateStickyWalk = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + "\n  { const re = /[^>]*x/y; re.lastIndex = nameEnd; re.exec(s); } // mutant"));
test('K-189: the count passes a single sticky walk per start tag, the stated limit: linear in count, so the clock is its only guard', t => {
  const m = growthRun('<link ', mutateStickyWalk);
  sizesFinished(m, 'sticky walk', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  t.diagnostic(`sticky walk: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
  assert.ok(measuredSpan(m.a.work) && measuredSpan(m.m.work) && measuredSpan(m.b.work), 'sticky walk: no count printed');
  assert.equal(growthLinear(m.a.work, m.m.work, m.b.work), true, 'sticky walk: the count passes it today (the stated limit)');
});
// K-189, the reviewer's shape: a sticky attempt every 256 characters from nameEnd to the end, each a page-subject search, each one unit. The count PASSES it
// today: the mutant's charge grows 4.7 times for 4 times the openers (6.07 M and 28.6 M, the reviewer's own figures), and its time 2.1 times on this run, so
// the count and the clock both see a linear shape here. This row is the stated limit with its witness; a count that later charges these attempts flips it.
const mutateStickyShort = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + "\n  { const re = /x/y; for (let i = nameEnd; i < s.length; i += 256) { re.lastIndex = i; re.exec(s); } } // mutant"));
test('K-189: the reviewer\'s sticky-attempt shape passes the count today, the stated limit (the total count grows under 8 times for 4 times the openers)', t => {
  const m = growthRun('<link ', mutateStickyShort);
  sizesFinished(m, 'sticky attempts', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  t.diagnostic(`sticky attempts: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms; the old single ratio ${(m.b.work / m.a.work).toFixed(2)}`);
  assert.ok(measuredSpan(m.a.work) && measuredSpan(m.m.work) && measuredSpan(m.b.work), 'sticky attempts: no count printed');
  assert.equal(growthLinear(m.a.work, m.m.work, m.b.work), true, 'sticky attempts: the count passes it today (the stated limit)');
});
// K-190: a matchAll over a derived subject inside scanStartTag. Its stack capture (10 frames on each derived call) timed it out at 60 s on this box, so a derived
// call is charged in full with no chain check and the shape finishes inside the clock. Its work is quadratic: the single ratio at 5,000 and 20,000 read 4.53 and
// passed the old check, because a constant base dilutes it; over three sizes the increments grow about 3.8 times, so the count refuses it (C183-1).
const mutateMatchAll = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + "\n  { [...s.substring(nameEnd).matchAll(/>/g)]; } // mutant"));
test('K-190: the count refuses a matchAll over a derived subject inside scanStartTag by its increments over three sizes', t => {
  const m = growthRun('<link ', mutateMatchAll);
  sizesFinished(m, 'matchAll mutant', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  t.diagnostic(`matchAll mutant: the old single ratio ${(m.b.work / m.a.work).toFixed(2)} (the old check ${growthOk(m.a.work, m.b.work) ? 'passes' : 'refuses'}); the three sizes: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
  assert.ok(measuredSpan(m.a.work) && measuredSpan(m.m.work) && measuredSpan(m.b.work), 'matchAll mutant: no count printed');
  assert.equal(growthLinear(m.a.work, m.m.work, m.b.work), false, `matchAll mutant: the count must refuse the growth (${incrementsOf(m)})`);
});
// C180-1: the same search made by a method other than exec (test), and by exec moved into a helper that scanStartTag calls. Both must be charged.
const mutateRegexTest = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + "\n  { const re = new RegExp('>', 'g'); re.lastIndex = nameEnd; re.test(s); } // mutant"));
const mutateRegexHelper = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('export function scanStartTag(s, nameEnd, max = META_MAX, collect = false) {', m => "function findGt(s, from) { const re = new RegExp('>', 'g'); re.lastIndex = from; return re.exec(s); }\n" + m).replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + '\n  findGt(s, nameEnd); // mutant'));
test('C180-1: the count refuses a regex test() mutant of the start-tag scan by its own count, with all three sizes finishing', t => {
  const m = growthRun('<link ', mutateRegexTest);
  t.diagnostic(`test mutant: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
  refusedByCount(t, m, 'test mutant', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
});
test('C180-1: the count refuses a regex exec-in-helper mutant (findGt, called by scanStartTag) by its own count, with all three sizes finishing', t => {
  const m = growthRun('<link ', mutateRegexHelper);
  t.diagnostic(`helper mutant: ${incrementsOf(m)}; ${m.a.ms}, ${m.m.ms} and ${m.b.ms} ms`);
  refusedByCount(t, m, 'helper mutant', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
});
test('C180-1: the real reader stays linear under the deeper frame chain, and its ratio is shown', t => {
  const m = growthRun('<link ');
  sizesFinished(m, 'real reader', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  t.diagnostic(`real reader: ${incrementsOf(m)}`);
  assert.ok(growthLinear(m.a.work, m.m.work, m.b.work), 'real reader: scan work must grow linearly');
});
// K-186: the exec span of every regex the page's rules run over the page (the ticket's measure), counted on the real reader. MODE 'ticket' charges a failed search to the
// end of the string; MODE 'sticky' charges a sticky (y) search only the characters its one attempt examines. `mutate`, when given, edits the copy first.
const ruleSpanWork = (dir, unit, n, mode, mutate) => {
  const after = edit(dir, 'web/index.html', s => s.replace('</body>', unit.repeat(n) + '</body>'));
  if (mutate) mutate(dir);
  const child = `
    const execOrig = RegExp.prototype.exec;
    const LEN = ${after.length};
    const MODE = ${JSON.stringify(mode)};
    let span = 0;
    RegExp.prototype.exec = function (s) {
      const from = (this.global || this.sticky) ? this.lastIndex : 0;
      const m = execOrig.call(this, s);
      if (typeof s === 'string' && s.length === LEN) span += Math.max(0, (m ? m.index + m[0].length : (MODE === 'sticky' && this.sticky ? from + 1 : LEN)) - from);
      return m;
    };
    process.on('exit', () => process.stderr.write('K186_SPAN ' + JSON.stringify({ exec: span }) + '\\n'));
    await import('./scripts/surface-check.mjs');
  `;
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['--max-old-space-size=1024', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
  const measured = /^K186_SPAN (\{.*\})$/m.exec(r.stderr || '');
  return { r, work: measured ? JSON.parse(measured[1]).exec : NaN, ms: Date.now() - t0 };
};
// A span the child printed: a positive safe integer. A child that ends without its line gives NaN, and NaN must never pass for a measured count (CodeRabbit #203).
const measuredSpan = x => Number.isSafeInteger(x) && x > 0;
const ruleSpanRun = (n, mode, mutate) => { const dir = surfaceCopy(); try { return ruleSpanWork(dir, '<link ', n, mode, mutate); } finally { rmSync(dir, { recursive: true, force: true }); } };
// K-186: the sticky rules' span, counted as the engine walks it, grows linearly; the ticket's measure (a failed sticky search charged to the string's end) read 15 times for
// 4 times the openers, and that was the instrument: a sticky search attempts one position (0.5 ms at both sizes, probe 2026-11-21), so the rules never walked the page.
// The mutant below drops the sticky flag (each opener searches the page to its end) and must be refused by the same count.
const mutateStickyDropped = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace("re.flags.replace(/[gy]/g, '') + 'y');", "re.flags.replace(/[gy]/g, '') + 'g');"));
test('K-186: the page-wide element rules\' exec span grows linearly on the real reader (5,000 vs 20,000 unrelated openers)', t => {
  const a = ruleSpanRun(GROWTH_SMALL, 'sticky'), b = ruleSpanRun(GROWTH_LARGE, 'sticky');
  finishedNamed(a.r, `rule span, ${GROWTH_SMALL} openers`, [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  finishedNamed(b.r, `rule span, ${GROWTH_LARGE} openers`, [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  const ta = ruleSpanRun(GROWTH_SMALL, 'ticket'), tb = ruleSpanRun(GROWTH_LARGE, 'ticket');
  t.diagnostic(`sticky span: ${a.work} at ${GROWTH_SMALL} openers, ${b.work} at ${GROWTH_LARGE} (ratio ${(b.work / a.work).toFixed(2)}); ${a.ms} ms and ${b.ms} ms. Ticket measure, for the record: ${ta.work} and ${tb.work} (ratio ${(tb.work / ta.work).toFixed(2)})`);
  // A child that ends without printing its span gives NaN, which growthOk already refuses; say so by the measurement, not by the comparison.
  assert.ok(measuredSpan(a.work), `K-186 rule span: no span printed at ${GROWTH_SMALL} openers, so nothing is measured`);
  assert.ok(measuredSpan(b.work), `K-186 rule span: no span printed at ${GROWTH_LARGE} openers, so nothing is measured`);
  assert.ok(growthOk(a.work, b.work), `rule span grew from ${a.work} to ${b.work} for 4 times the openers`);
});
test('K-186: the span count refuses a page-wide rule that drops the sticky flag and searches from each opener, by its own count', t => {
  const a = ruleSpanRun(GROWTH_SMALL, 'sticky', mutateStickyDropped), b = ruleSpanRun(GROWTH_LARGE, 'sticky', mutateStickyDropped);
  t.diagnostic(`no-sticky mutant: span ${a.work} at ${GROWTH_SMALL} openers, ${b.work} at ${GROWTH_LARGE} (ratio ${(b.work / a.work).toFixed(2)}); ${a.ms} ms and ${b.ms} ms`);
  finishedNamed(a.r, `no-sticky mutant, ${GROWTH_SMALL} openers`, [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  finishedNamed(b.r, `no-sticky mutant, ${GROWTH_LARGE} openers`, [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  assert.ok(measuredSpan(a.work), `no-sticky mutant: no span printed at ${GROWTH_SMALL} openers, so nothing is refused by count`);
  assert.ok(measuredSpan(b.work), `no-sticky mutant: no span printed at ${GROWTH_LARGE} openers, so nothing is refused by count`);
  assert.equal(growthOk(a.work, b.work), false, 'no-sticky mutant: the count must refuse the growth');
});

// K-183: a mutant child that exits before the reader finishes prints no count (or a zero one), so growthOk is false and the refusal assertion would pass vacuously.
const mutateEarlyExit = dir => edit(dir, 'scripts/lib/page-claims.mjs', t => t.replace('  const stop = Math.min(s.length, nameEnd + max);', m => m + '\n  process.exit(0); // mutant'));
test('K-183: an early-exit mutant is not a refusal: all three children must finish and name the finding, so the old count assertion cannot pass on it', t => {
  const m = growthRun('<link ', mutateEarlyExit);
  assert.throws(() => refusedByCount(t, m, 'early exit', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]), /finished, and it must name the page/);
});
// C178-1: one 200,000-opener finish row is the clock ceiling for the work the count does not see; the real reader finishes it inside the clock.
const BULK_N = 200000;
const bulkGate = (dir, unit) => {
  edit(dir, 'web/index.html', s => s.replace('</body>', unit.repeat(BULK_N) + '</body>'));
  return spawnSync(process.execPath, ['--max-old-space-size=512', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
};
test('K-178: the 200,000-opener <link finish row finishes on the real reader, inside its clock', t => {
  const dir = surfaceCopy();
  try {
    const t0 = Date.now();
    const r = bulkGate(dir, '<link ');
    t.diagnostic(`real reader at 200,000 <link openers: ${Date.now() - t0} ms, error ${r.error ? r.error.code : 'none'}`);
    finishedNamed(r, '<link , 200,000 openers', [/web\/index\.html: has \d+ <link> tag\(s\) the reader cannot read to its end/]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('K-172: the growth check accepts linear work and refuses quadratic or missing measurements', () => {
  assert.equal(growthLinear(1000, 2000, 4000), true);
  assert.equal(growthLinear(1000, 4000, 16000), false);
  assert.equal(growthOk(1000, 4000), true);
  assert.equal(growthOk(1000, 16000), false);
  for (const [small, large] of [[0, 0], [NaN, 4000], [1000, NaN], [1000, 0]]) assert.equal(growthOk(small, large), false);
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

test('the floor check refuses a _headers rule that removes any floor header with the detach form, in any letter case', () => {
  const FLOOR = ['Content-Security-Policy', 'Referrer-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'Permissions-Policy'];
  const misses = [];
  for (const header of FLOOR) for (const probe of [header.toLowerCase(), header]) {
    const dir = surfaceCopy();
    try {
      const name = probe;
      edit(dir, 'web/_headers', s => s.replace(/\n*$/, '\n') + '\n/headers-removal-probe\n  ! ' + name + '\n');
      restage(dir);
      const r = surface(dir);
      if (r.status !== 1 || !new RegExp('web/_headers: line \\d+: removes .*' + name + ' on /headers-removal-probe', 'i').test(r.out)) misses.push(probe);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  assert.deepEqual(misses, [], 'floor headers whose detach line the floor check did not refuse');
});

