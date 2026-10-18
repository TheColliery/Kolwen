// Tests for the transfer-size budget (scripts/page-weight.mjs, web-build rule W-PERF-08). Fixtures are small built trees in a temp folder; the real tree is measured read-only.
// Node builtins only. Every child process has a heap cap and a kill timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { htmlPages } from './lib/web-files.mjs';
import { renderedChars } from './lib/rendered-text.mjs';
import { fileURLToPath } from 'node:url';
import { ALMANAC, CEILING_FACTOR, DIVERGENCES, NOT_COUNTED, checkTree, measurePage, metricVerdict, report, staleWarning } from './page-weight.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MEDIAN = ALMANAC.medianBytes, REQS = ALMANAC.medianRequests;

// A fixture tree: index.html linking an image of `imageBytes` random bytes (incompressible, so counted as itself) and `extraRequests` tiny images.
function fixture({ imageBytes = 0, extraRequests = 0, html = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'page-weight-'));
  mkdirSync(join(dir, 'img'));
  const imgs = [];
  if (imageBytes) { writeFileSync(join(dir, 'img/big.png'), randomBytes(imageBytes)); imgs.push('/img/big.png'); }
  for (let i = 0; i < extraRequests; i++) { writeFileSync(join(dir, `img/t${i}.png`), Buffer.from([i & 255, 1, 2, 3])); imgs.push(`/img/t${i}.png`); }
  writeFileSync(join(dir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>t</title></head><body><p>hello</p>${imgs.map(u => `<img src="${u}" alt="">`).join('')}${html}</body></html>`);
  return dir;
}
const gone = dir => rmSync(dir, { recursive: true, force: true });
const only = rows => { assert.equal(rows.length, 1); return rows[0]; };

// The one way this file starts a child: a node process with a heap cap and a kill timeout, and its own HOME, USERPROFILE, TEMP, TMP and TMPDIR under os.tmpdir(), removed after it, so nothing the child
// (or a later change to the CLI) writes reaches the real home. `used`, when given, collects the folder made.
function runNode(args, used = []) {
  const home = mkdtempSync(join(tmpdir(), 'page-weight-home-'));
  used.push(home);
  try { return spawnSync(process.execPath, ['--max-old-space-size=2048', ...args], { encoding: 'utf8', timeout: 120000, env: { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home } }); } finally { gone(home); }
}
const cliRun = (...args) => runNode([join(ROOT, 'scripts/page-weight.mjs'), ...args]);

test('the median is cited, not invented: edition, url, quote, read date, mobile figures, and a ceiling of twice the median', () => {
  assert.equal(ALMANAC.medianBytes, 2_560_000);
  assert.equal(ALMANAC.medianRequests, 75);
  assert.equal(CEILING_FACTOR, 2);
  assert.match(ALMANAC.url, /^https:\/\/almanac\.httparchive\.org\/en\/2025\/page-weight$/);
  assert.match(ALMANAC.quote, /2\.56 MB on mobile/);
  assert.match(ALMANAC.requestsQuote, /counterpart makes 75/);
  assert.equal(ALMANAC.readOn, '2026-10-18');
  assert.deepEqual(DIVERGENCES, {}, 'no page of ours is a named divergence today');
});

test('RED PROOF: a page plus an asset over twice the median FAILS, and the report says so', () => {
  const dir = fixture({ imageBytes: MEDIAN * 2 + 50_000 });
  try {
    const r = only(checkTree(dir));
    assert.ok(r.bytes > MEDIAN * 2, 'the fixture is over the ceiling: ' + r.bytes);
    assert.equal(r.level, 'fail');
    assert.match(r.notes.join(' '), /above twice the median \(5120000\) and the page is not a named divergence/);
    assert.match(report([r]), /index\.html \| \d+ \| 2 \| [\d.]+ \| [\d.]+ \| FAIL/);
    const cli = cliRun('--web', dir);
    assert.equal(cli.status, 1, cli.stdout + cli.stderr);
    assert.match(cli.stdout, /FAIL/);
  } finally { gone(dir); }
});

test('GREEN PROOF: a page at the median passes with no note, one just above it passes with a note, and the exit code is 0', () => {
  const at = fixture({ imageBytes: MEDIAN - 1000 });
  const above = fixture({ imageBytes: MEDIAN + 200_000 });
  try {
    const a = only(checkTree(at));
    assert.ok(a.bytes <= MEDIAN && a.bytes > MEDIAN - 2000, 'at the median: ' + a.bytes);
    assert.equal(a.level, 'pass');
    assert.deepEqual(a.notes, []);
    assert.match(report([a]), /index\.html \| \d+ \| 2 \| 0\.99\d+ \| 0\.0267 \| PASS$/m);
    const b = only(checkTree(above));
    assert.equal(b.level, 'note');
    assert.match(b.notes[0], /transfer bytes \d+ is above the median 2560000, allowed up to 5120000/);
    assert.match(report([b]), /PASS \(above the median\)/);
    const cli = cliRun('--web', at);
    assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  } finally { gone(at); gone(above); }
});

test('a page over the ceiling that is a NAMED DIVERGENCE passes and prints its floor and what was tried; an empty or thin entry is a FAIL of its own', () => {
  const dir = fixture({ imageBytes: MEDIAN * 2 + 50_000 });
  const floor = 'Every asset is compressed, the fonts are subset, the images are in modern formats at the size shown, and no code is unused.';
  const tried = 'Re-encoded the image at lower quality, which lost the detail the page exists to show; dropping it removes the page\'s one function.';
  try {
    const r = only(checkTree(dir, { divergences: { 'index.html': { bytes: { floor, tried } } } }));
    assert.equal(r.level, 'diverged');
    assert.ok(r.notes[0].includes('NAMED DIVERGENCE') && r.notes[0].includes(floor) && r.notes[0].includes(tried));
    assert.match(report([r]), /PASS \(named divergence\)/);
    assert.match(report([r]), /index\.html: transfer bytes \d+ is above twice the median.*NAMED DIVERGENCE/);
    for (const bad of [{ floor: '', tried }, { floor, tried: '' }, { floor: 'it is big', tried: 'no' }, {}]) {
      const f = only(checkTree(dir, { divergences: { 'index.html': { bytes: bad } } }));
      assert.equal(f.level, 'fail', JSON.stringify(bad));
      assert.match(f.notes[0], /no real .* text \(a stated wish is not a floor\)/);
    }
    // a divergence for the other metric does not excuse the bytes
    const other = only(checkTree(dir, { divergences: { 'index.html': { requests: { floor, tried } } } }));
    assert.equal(other.level, 'fail');
  } finally { gone(dir); }
});

test('requests: 75 passes, 76 to 150 passes with a note, 151 fails; the HTML counts as one request', () => {
  const at = fixture({ extraRequests: REQS - 1 });
  const note = fixture({ extraRequests: REQS });
  const fail = fixture({ extraRequests: REQS * 2 });
  try {
    const a = only(checkTree(at)), b = only(checkTree(note)), c = only(checkTree(fail));
    assert.equal(a.requests, REQS); assert.equal(a.level, 'pass');
    assert.equal(b.requests, REQS + 1); assert.equal(b.level, 'note'); assert.match(b.notes[0], /requests 76 is above the median 75, allowed up to 150/);
    assert.equal(c.requests, REQS * 2 + 1); assert.equal(c.level, 'fail'); assert.match(c.notes[0], /requests 151 is above twice the median \(150\)/);
  } finally { gone(at); gone(note); gone(fail); }
});

test('metricVerdict is exact at the edges: the median and twice the median pass, one more does not', () => {
  assert.equal(metricVerdict(100, 100, undefined, 'x').level, 'pass');
  assert.equal(metricVerdict(101, 100, undefined, 'x').level, 'note');
  assert.equal(metricVerdict(200, 100, undefined, 'x').level, 'note');
  assert.equal(metricVerdict(201, 100, undefined, 'x').level, 'fail');
});

test('what a page loads: linked stylesheets, icons, images, script files and CSS url() are counted once each; fonts only when the page renders a character in the face\'s unicode-range', () => {
  const dir = mkdtempSync(join(tmpdir(), 'page-weight-fonts-'));
  try {
    mkdirSync(join(dir, 'fonts'));
    writeFileSync(join(dir, 'fonts/fonts.css'), "@font-face{font-family:'A';font-weight:400;src:url('/fonts/a.woff2') format('woff2');unicode-range:U+0020-007E;}\n@font-face{font-family:'B';font-weight:400;src:url('/fonts/b.woff2') format('woff2');unicode-range:U+0E01-0E5B;}\nbody{background:url('/bg.png')}\n");
    writeFileSync(join(dir, 'fonts/a.woff2'), Buffer.alloc(1000, 1));
    writeFileSync(join(dir, 'fonts/b.woff2'), Buffer.alloc(5000, 2));
    writeFileSync(join(dir, 'bg.png'), Buffer.alloc(300, 3));
    writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(dir, 'app.js'), 'var a=1;');
    writeFileSync(join(dir, 'latin.html'), '<!doctype html><html><head><link rel="stylesheet" href="/fonts/fonts.css"><link rel="icon" href="/icon.svg"><link rel="canonical" href="https://x.test/"><link rel="stylesheet" href="https://other.test/x.css"></head><body>hello<script src="/app.js"></script><script src="https://cdn.test/y.js"></script><img src="/bg.png"></body></html>');
    writeFileSync(join(dir, 'thai.html'), '<!doctype html><html><head><link rel="stylesheet" href="/fonts/fonts.css"></head><body>hello ก</body></html>');
    const rows = Object.fromEntries(checkTree(dir).map(r => [r.page, r]));
    const urls = p => rows[p].parts.map(x => x.url).sort();
    assert.deepEqual(urls('latin.html'), ['/app.js', '/bg.png', '/fonts/a.woff2', '/fonts/fonts.css', '/icon.svg', '/latin.html'], 'Latin text loads only the Latin face; canonical and absolute urls are not requests');
    assert.deepEqual(urls('thai.html'), ['/bg.png', '/fonts/a.woff2', '/fonts/b.woff2', '/fonts/fonts.css', '/thai.html'], 'Thai text loads both faces, once each');
    assert.equal(rows['latin.html'].requests, 6);
    assert.equal(rows['thai.html'].parts.find(p => p.url === '/fonts/b.woff2').bytes, 5000, 'a woff2 is counted as its bytes');
    assert.ok(rows['thai.html'].parts.find(p => p.url === '/fonts/fonts.css').bytes < 300, 'a stylesheet is counted compressed');
  } finally { gone(dir); }
});

test('an asset a page loads that is not in the built tree is a named failure, never a silent zero', () => {
  const dir = fixture({ html: '<img src="/nope.png" alt="">' });
  try {
    assert.throws(() => measurePage(dir, 'index.html', []), /index\.html: loads \/nope\.png, which is not in the built tree/);
    const cli = cliRun('--web', dir);
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /FAIL index\.html: loads \/nope\.png/);
  } finally { gone(dir); }
});

test('text is counted as served, compressed: a 100,000-character page is a few hundred bytes, while an image of 100,000 bytes stays 100,000', () => {
  const dir = fixture({ imageBytes: 100_000, html: '<p>' + 'a'.repeat(100_000) + '</p>' });
  try {
    const m = measurePage(dir, 'index.html', []);
    const html = m.parts.find(p => p.kind === 'html'), img = m.parts.find(p => p.url === '/img/big.png');
    assert.ok(html.bytes < 1000, 'brotli of a repeated page: ' + html.bytes);
    assert.equal(img.bytes, 100_000);
  } finally { gone(dir); }
});

test('the real site: every page passes below the median, the table names every page, and the beacon is declared not counted', () => {
  const rows = checkTree(join(ROOT, 'web'));
  assert.ok(rows.length >= 7, 'every web/*.html: ' + rows.map(r => r.page).join(','));
  for (const r of rows) {
    assert.equal(r.level, 'pass', `${r.page}: ${r.bytes} bytes, ${r.requests} requests, ${r.notes.join(' ')}`);
    assert.ok(r.parts.some(p => p.kind === 'css' && p.url === '/fonts/fonts.css'), r.page + ' loads the font manifest');
    assert.ok(r.parts.some(p => p.kind === 'font'), r.page + ' loads a font');
  }
  const cli = cliRun();
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  for (const r of rows) assert.ok(cli.stdout.includes(r.page + ' | ' + r.bytes + ' | ' + r.requests + ' | '), r.page + ' is in the printed table');
  assert.ok(cli.stdout.includes(NOT_COUNTED));
  assert.match(NOT_COUNTED, /Cloudflare Web Analytics beacon/);
});

// A fixture tree from a map of path -> text or bytes (every folder is made).
function tree(files) {
  const dir = mkdtempSync(join(tmpdir(), 'page-weight-t-'));
  for (const [p, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), c); }
  return dir;
}
const urlsOf = row => row.parts.map(p => p.url).sort();

// F1: a link, an image, a srcset and an inline style are read in all three HTML attribute forms; one that is skipped would count as zero, not as missing.
const FORMS = { 'double-quoted': v => `"${v}"`, 'single-quoted': v => `'${v}'`, unquoted: v => v };
for (const [form, q] of Object.entries(FORMS)) {
  test(`RED PROOF: href, src, srcset and an inline style url() are counted when written ${form}`, () => {
    const dir = tree({
      's.css': 'p{color:red}', 'i.png': Buffer.alloc(900, 1), 'j.png': Buffer.alloc(700, 2), 'k.png': Buffer.alloc(500, 3),
      'index.html': `<!doctype html><html><head><link rel=${q('stylesheet')} href=${q('/s.css')}></head><body><img src=${q('/i.png')} alt=""><img srcset=${q('/j.png')} alt=""><p style=${q('background:url(/k.png)')}>x</p></body></html>`,
    });
    try {
      const r = only(checkTree(dir));
      assert.deepEqual(urlsOf(r), ['/i.png', '/index.html', '/j.png', '/k.png', '/s.css']);
      assert.equal(r.parts.find(p => p.url === '/i.png').bytes, 900);
    } finally { gone(dir); }
  });
}

test('an attribute name inside another name is not read: data-href, data-src and a srcset are not a href or a src', () => {
  const dir = tree({ 'x.png': Buffer.alloc(100, 1), 'index.html': '<!doctype html><html><body><a data-href="/x.png">a</a><img data-src="/x.png" alt=""></body></html>' });
  try { assert.deepEqual(urlsOf(only(checkTree(dir))), ['/index.html']); } finally { gone(dir); }
});

// G4: the attributes of a tag are tokenised in order, and an attribute is the one whose WHOLE name is href, src, srcset, rel, as or style.
test('RED PROOF: an attribute is found by its whole name: href= inside another attribute\'s value, xlink:href, data-src and a duplicate are not it, and a > inside a quoted value does not end the tag', () => {
  const dir = tree({
    's.css': "@font-face{font-family:'S';src:url('/f.woff2');unicode-range:U+0020-007E;}", 'f.woff2': Buffer.alloc(600, 1), 'favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    'i.png': Buffer.alloc(900, 2), 'j.png': Buffer.alloc(700, 3), 'nope.css': 'a{}',
    'index.html': '<!doctype html><html><head>'
      + '<link title="see href=/favicon.svg" rel="stylesheet" href="/s.css">'
      + '<link xlink:href="/nope.css" rel=stylesheet href=/s.css>'
      + '</head><body>hello'
      + '<img alt="a > b, src=/nope.css" src="/i.png">'
      + '<img src="/j.png" data-src="/nope.css" src="/nope.css" alt="">'
      + '</body></html>',
  });
  try {
    assert.deepEqual(urlsOf(only(checkTree(dir))), ['/f.woff2', '/i.png', '/index.html', '/j.png', '/s.css']);
  } finally { gone(dir); }
});

// G1: a url that any link names as a stylesheet is a stylesheet, whatever kind it was first met as.
test('RED PROOF: a stylesheet hinted by <link rel=preload as=style> before (or without) its stylesheet link is still walked', () => {
  const files = { 's.css': "@import 'imp.css'; @font-face{font-family:'S';src:url('/f.woff2');unicode-range:U+0020-007E;}", 'imp.css': 'p{margin:0}', 'f.woff2': Buffer.alloc(600, 1), 'x.woff2': Buffer.alloc(300, 2) };
  const page = links => `<!doctype html><html><head>${links}</head><body>hello</body></html>`;
  const want = ['/f.woff2', '/imp.css', '/index.html', '/s.css'];
  for (const [what, links] of [
    ['preload before the stylesheet link', '<link rel="preload" as="style" href="/s.css"><link rel="stylesheet" href="/s.css">'],
    ['preload alone, as=style', '<link rel="preload" as="style" href="/s.css">'],
    ['preload with no as, before the link', '<link rel="preload" href="/s.css"><link rel="stylesheet" href="/s.css">'],
    ['rel with two tokens', '<link rel="stylesheet preload" href="/s.css">'],
    ['preload after the link (control)', '<link rel="stylesheet" href="/s.css"><link rel="preload" as="style" href="/s.css">'],
  ]) {
    const dir = tree({ ...files, 'index.html': page(links) });
    try { assert.deepEqual(urlsOf(only(checkTree(dir))), want, what); } finally { gone(dir); }
  }
  const dir = tree({ ...files, 'index.html': page('<link rel="preload" as="font" href="/x.woff2" crossorigin>') });
  try { const r = only(checkTree(dir)); assert.deepEqual(urlsOf(r), ['/index.html', '/x.woff2']); assert.equal(r.parts.find(p => p.url === '/x.woff2').kind, 'other', 'a font hint is a file, not a stylesheet'); } finally { gone(dir); }
});

// G2 and G3: @import with no space before its string, and comments that hide an @import or a url().
test('RED PROOF: @import"x.css" with no space is followed, and an @import or url() inside a CSS (or HTML) comment is not', () => {
  const dir = tree({
    's.css': '/* @import "gone.css"; */\n@import"a.css";@import\'b.css\'  screen;\n/* body{background:url(gone.png)} */ p{background:url(c.png)}',
    'a.css': 'i{margin:0}', 'b.css': 'u{margin:0}', 'c.png': Buffer.alloc(300, 1), 'd.png': Buffer.alloc(200, 2),
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="/s.css"><style>/* @import "gone2.css"; */ q{background:url(/d.png)}</style></head><body>hello<!-- <img src="/gone3.png"> --></body></html>',
  });
  try { assert.deepEqual(urlsOf(only(checkTree(dir))), ['/a.css', '/b.css', '/c.png', '/d.png', '/index.html', '/s.css']); } finally { gone(dir); }
});

// G5: the 13 months end on the last day of the target month, and a read date is a real date.
test('RED PROOF: the stale warning starts the day after the 13th month ends, also from a month end, and a date that does not exist is not a date', () => {
  const day = s => new Date(s + 'T12:00:00Z');
  const on = (readOn, today) => staleWarning({ ...ALMANAC, readOn }, day(today));
  assert.equal(on('2026-01-31', '2027-02-28'), '', '13 months after Jan 31 ends on Feb 28');
  assert.match(on('2026-01-31', '2027-03-01'), /^WARNING: .* read on 2026-01-31, more than 13 months ago/);
  assert.equal(on('2026-08-31', '2027-09-30'), '');
  assert.match(on('2026-08-31', '2027-10-01'), /^WARNING: .* more than 13 months ago/);
  assert.equal(on('2026-10-18', '2027-11-18'), '');
  assert.match(on('2026-10-18', '2027-11-19'), /^WARNING: /);
  assert.equal(on('2024-02-29', '2025-03-29'), '', 'a leap day: 13 months later is Mar 29');
  assert.match(on('2024-02-29', '2025-03-30'), /^WARNING: /);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-5', 'soon', '']) assert.match(on(bad, '2026-10-18'), /^WARNING: .* is not a date/, JSON.stringify(bad));
});

// F2: an @import, in either form, is a stylesheet walked like a linked one: its own @font-face faces and url() count, and a cycle ends.
test('RED PROOF: an @import (string or url()), nested, in a linked or an inline stylesheet, is a css asset whose own fonts and urls are counted; a cycle ends', () => {
  const dir = tree({
    's.css': '@import "b.css";\n@import url(c.css) screen;\n@import url("/d.css");\np{color:red}',
    'b.css': "@font-face{font-family:'B';src:url('/fonts/b.woff2');unicode-range:U+0020-007E;}",
    'c.css': "@import 'e.css'; body{background:url(bg.png)}",
    'd.css': '@import "/s.css";',
    'e.css': 'i{margin:0}',
    'inl.css': 'u{margin:0}',
    'fonts/b.woff2': Buffer.alloc(1000, 4), 'bg.png': Buffer.alloc(300, 5),
    'index.html': '<!doctype html><html><head><link rel="stylesheet" href="/s.css"><style>@import "/inl.css";</style></head><body>hello</body></html>',
  });
  try {
    const r = only(checkTree(dir));
    assert.deepEqual(urlsOf(r), ['/b.css', '/bg.png', '/c.css', '/d.css', '/e.css', '/fonts/b.woff2', '/index.html', '/inl.css', '/s.css']);
    for (const u of ['/b.css', '/c.css', '/d.css', '/e.css', '/inl.css']) assert.equal(r.parts.find(p => p.url === u).kind, 'css', u + ' is a stylesheet, not an image');
    assert.equal(r.parts.find(p => p.url === '/fonts/b.woff2').kind, 'font');
  } finally { gone(dir); }
});

test('an @import of a file that is not in the built tree is a named failure', () => {
  const dir = tree({ 's.css': '@import "gone.css";', 'index.html': '<!doctype html><html><head><link rel="stylesheet" href="/s.css"></head><body>x</body></html>' });
  try { assert.throws(() => checkTree(dir), /index\.html: loads \/gone\.css, which is not in the built tree/); } finally { gone(dir); }
});

// F3: one page lister for the font coverage check and this one.
test('RED PROOF: a page in a subfolder is measured too, and the lister is the one the font coverage check uses', () => {
  const dir = tree({ 'index.html': '<!doctype html><html><body>hi</body></html>', 'th/index.html': '<!doctype html><html lang="th"><body>' + String.fromCodePoint(0x0e01) + '<img src="/img/big.png" alt=""></body></html>', 'img/big.png': randomBytes(MEDIAN * 2 + 50_000) });
  try {
    const rows = checkTree(dir);
    assert.deepEqual(rows.map(r => r.page), ['index.html', 'th/index.html']);
    assert.deepEqual(rows.map(r => r.page), htmlPages(dir));
    assert.ok(renderedChars(dir).get(0x0e01)?.has('web/th/index.html'), 'renderedChars reads the nested page too (CodeRabbit nitpick)');
    assert.equal(rows[1].level, 'fail');
    assert.match(report(rows), /th\/index\.html \| \d+ \| 2 \| [\d.]+ \| [\d.]+ \| FAIL/);
  } finally { gone(dir); }
  assert.deepEqual(checkTree(join(ROOT, 'web')).map(r => r.page), htmlPages(join(ROOT, 'web')));
});

// F4: an exception lives only while it is used.
const FLOOR = 'Every asset is compressed, the fonts are subset, the images are in modern formats at the size shown, and no code is unused.';
const TRIED = 'Re-encoded the image at lower quality, which lost the detail the page exists to show; dropping it removes the page\'s one function.';
test('RED PROOF: a named divergence whose page is under the ceiling, whose page is absent, whose metric is under the ceiling, or that names no metric is a FAIL with a message that names it', () => {
  const small = fixture({});
  const big = fixture({ imageBytes: MEDIAN * 2 + 50_000 });
  try {
    const stale = checkTree(small, { divergences: { 'index.html': { bytes: { floor: FLOOR, tried: TRIED } } } });
    assert.equal(only(stale).level, 'fail');
    assert.match(only(stale).notes.join(' '), /index\.html: the named divergence for transfer bytes is stale: the page is at \d+, not above twice the median \(5120000\); remove the entry/);
    const absent = checkTree(small, { divergences: { 'gone.html': { bytes: { floor: FLOOR, tried: TRIED } } } });
    assert.deepEqual(absent.map(r => [r.page, r.level]), [['index.html', 'pass'], ['gone.html', 'fail']]);
    assert.match(absent[1].notes.join(' '), /gone\.html: a named divergence names a page that is not in the built tree; remove the entry/);
    assert.match(report(absent), /gone\.html \| - \| - \| - \| - \| FAIL/);
    const half = only(checkTree(big, { divergences: { 'index.html': { bytes: { floor: FLOOR, tried: TRIED }, requests: { floor: FLOOR, tried: TRIED } } } }));
    assert.equal(half.level, 'fail', 'the bytes entry is used, the requests entry is not');
    assert.match(half.notes.join(' '), /named divergence for requests is stale: the page is at 2, not above twice the median \(150\)/);
    assert.ok(half.notes.join(' ').includes('NAMED DIVERGENCE'), 'the used entry still prints');
    const typo = only(checkTree(big, { divergences: { 'index.html': { bytes: { floor: FLOOR, tried: TRIED }, byte: { floor: FLOOR, tried: TRIED } } } }));
    assert.equal(typo.level, 'fail');
    assert.match(typo.notes.join(' '), /index\.html: a named divergence has the key "byte", which is not bytes or requests/);
    const none = only(checkTree(small, { divergences: { 'index.html': {} } }));
    assert.equal(none.level, 'fail', 'an entry that names no metric excuses nothing and is not used');
    assert.equal(only(checkTree(big, { divergences: { 'index.html': { bytes: { floor: FLOOR, tried: TRIED } } } })).level, 'diverged', 'control: a used entry still passes');
  } finally { gone(small); gone(big); }
});

// F6: the median is re-read from each new edition, and a reader is told when that is overdue. Frozen dates, never the clock.
test('RED PROOF: a WARNING (not a failure) names the URL pattern to re-read once the Almanac was read more than 13 months ago; a frozen date drives it', () => {
  const day = s => new Date(s + 'T12:00:00Z');
  assert.equal(staleWarning(ALMANAC, day('2026-10-18')), '');
  assert.equal(staleWarning(ALMANAC, day('2027-11-18')), '', 'exactly 13 months is not yet more than 13');
  const w = staleWarning(ALMANAC, day('2027-11-19'));
  assert.match(w, /^WARNING: the Web Almanac median was read on 2026-10-18, more than 13 months ago; re-read the latest edition at https:\/\/almanac\.httparchive\.org\/en\/<year>\/page-weight and update ALMANAC$/);
  assert.match(staleWarning({ ...ALMANAC, readOn: 'soon' }, day('2026-10-18')), /^WARNING: .* is not a date/);
  const dir = fixture({});
  try {
    const rows = checkTree(dir);
    assert.ok(!report(rows, ALMANAC, day('2026-10-18')).includes('WARNING'));
    assert.ok(report(rows, ALMANAC, day('2028-01-01')).split('\n').includes(staleWarning(ALMANAC, day('2028-01-01'))), 'the report prints the warning as a line of its own');
    assert.equal(only(rows).level, 'pass', 'a stale date changes no verdict');
  } finally { gone(dir); }
});

// CodeRabbit 4306008880: a test that spawns a CLI sandboxes HOME and TEMP.
test('RED PROOF: every child of this file runs with its own HOME, USERPROFILE, TEMP, TMP and TMPDIR under os.tmpdir(), removed after it, and no spawn bypasses the helper', () => {
  const used = [];
  const show = (...v) => `console.log(JSON.stringify([${v.map(n => 'process.env.' + n).join(',')}]))`;
  const a = runNode(['-e', show('HOME', 'USERPROFILE', 'TEMP', 'TMP', 'TMPDIR')], used);
  const b = runNode(['-e', show('HOME')], used);
  const [home, ...rest] = JSON.parse(a.stdout);
  assert.ok(rest.every(v => v === home), 'one sandbox for all five names');
  assert.ok(home.startsWith(tmpdir()) && home !== process.env.HOME && home !== process.env.USERPROFILE, 'under os.tmpdir(), not the real home: ' + home);
  assert.notEqual(JSON.parse(b.stdout)[0], home, 'each child gets a folder of its own');
  assert.ok(used.length === 2 && used.every(d => !existsSync(d)), 'the folders are removed after the child');
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const spawns = source.split('spawn' + 'Sync(').length - 1;
  assert.equal(spawns, 1, `a child is started in one place only, runNode (found ${spawns} call sites)`);
});

// CodeRabbit 4306008871 and reviewer U1: the inline <style> blocks are the live ones, read by the one reader rendered-text.mjs has (comments as the HTML parser ends them, scripts skipped).
test('RED PROOF: an @import in a <style> inside an HTML comment or a script is not followed, and a live <style> after <!-->, <!---> or --!> is', () => {
  const dir = tree({
    'a.css': 'i{margin:0}', 'b.css': 'i{margin:0}', 'c.css': 'i{margin:0}', 'd.css': 'i{margin:0}', 'img.png': Buffer.alloc(300, 1),
    'index.html': '<!doctype html><html><head>'
      + '<!-- <style>@import "/gone1.css";</style> -->'
      + '<script>var s = \'<style>@import "/gone2.css";</style>\';</script>'
      + '<!-- x --><style>@import "/a.css";</style>'
      + '<!--><style>@import "/b.css";</style>'
      + '<!---><style>@import "/c.css";</style>'
      + '<!-- y --!><style>@import "/d.css";</style>'
      + '<!--><img src="/img.png" alt="">'
      + '<!-- z -->' // a real comment after the live parts: a pattern that ends a comment only at --> runs from an opener to it and swallows them
      + '</head><body>hello</body></html>',
  });
  try { assert.deepEqual(urlsOf(only(checkTree(dir))), ['/a.css', '/b.css', '/c.css', '/d.css', '/img.png', '/index.html']); } finally { gone(dir); }
});

// CodeRabbit 4306039163 and reviewer P2: markup inside a script or a style body is text, not tags, and a "<!--" there or in an attribute value opens no comment.
test('RED PROOF: an <img> or a <link> written inside a script string is not an asset, and a "<!--" in a script, an attribute value or a textarea hides no later tag', () => {
  const dir = tree({
    's.css': "@font-face{font-family:'S';src:url('/f.woff2');unicode-range:U+0020-007E;}", 'f.woff2': Buffer.alloc(600, 1), 'i.png': Buffer.alloc(300, 2), 'j.png': Buffer.alloc(200, 3), 'k.png': Buffer.alloc(100, 4),
    'index.html': '<!doctype html><html><head>'
      + '<script>const markup = \'<img src="/missing.png">\'; const l = \'<link rel="stylesheet" href="/missing.css">\'; var c = "<!--";</script>'
      + '<style>/* <img src="/missing2.png"> <!-- */ p{margin:0}</style>'
      + '<link rel="stylesheet" href="/s.css">'
      + '</head><body hello>'
      + '<a title="<!--">x</a><img src="/i.png" alt="">'
      + '<textarea><!--</textarea><img src="/j.png" alt="">'
      + '<script src="/app.js"></script><img src="/k.png" alt="">'
      + '<!-- z -->'
      + '</body></html>',
    'app.js': 'var a = 1;',
  });
  try { assert.deepEqual(urlsOf(only(checkTree(dir))), ['/app.js', '/f.woff2', '/i.png', '/index.html', '/j.png', '/k.png', '/s.css']); } finally { gone(dir); }
});

test('an unknown flag exits 2, --help prints usage and exits 0, and a tree with no page fails rather than passes', () => {
  const run = (...a) => cliRun(...a);
  assert.equal(run('--bogus').status, 2);
  const h = run('--help');
  assert.equal(h.status, 0);
  assert.match(h.stdout, /usage: node scripts\/page-weight\.mjs/);
  const empty = mkdtempSync(join(tmpdir(), 'page-weight-empty-'));
  try { const e = run('--web', empty); assert.equal(e.status, 1); assert.match(e.stderr, /empty check is not a pass/); } finally { gone(empty); }
});
