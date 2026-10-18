// Tests for the transfer-size budget (scripts/page-weight.mjs, web-build rule W-PERF-08). Fixtures are small built trees in a temp folder; the real tree is measured read-only.
// Node builtins only. Every child process has a heap cap and a kill timeout.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALMANAC, CEILING_FACTOR, DIVERGENCES, NOT_COUNTED, checkTree, measurePage, metricVerdict, report } from './page-weight.mjs';

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
    const cli = spawnSync(process.execPath, ['--max-old-space-size=2048', join(ROOT, 'scripts/page-weight.mjs'), '--web', dir], { encoding: 'utf8', timeout: 120000 });
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
    const cli = spawnSync(process.execPath, ['--max-old-space-size=2048', join(ROOT, 'scripts/page-weight.mjs'), '--web', at], { encoding: 'utf8', timeout: 120000 });
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
    const cli = spawnSync(process.execPath, ['--max-old-space-size=2048', join(ROOT, 'scripts/page-weight.mjs'), '--web', dir], { encoding: 'utf8', timeout: 120000 });
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
  const cli = spawnSync(process.execPath, ['--max-old-space-size=2048', join(ROOT, 'scripts/page-weight.mjs')], { encoding: 'utf8', timeout: 120000 });
  assert.equal(cli.status, 0, cli.stdout + cli.stderr);
  for (const r of rows) assert.ok(cli.stdout.includes(r.page + ' | ' + r.bytes + ' | ' + r.requests + ' | '), r.page + ' is in the printed table');
  assert.ok(cli.stdout.includes(NOT_COUNTED));
  assert.match(NOT_COUNTED, /Cloudflare Web Analytics beacon/);
});

test('an unknown flag exits 2, --help prints usage and exits 0, and a tree with no page fails rather than passes', () => {
  const run = (...a) => spawnSync(process.execPath, ['--max-old-space-size=2048', join(ROOT, 'scripts/page-weight.mjs'), ...a], { encoding: 'utf8', timeout: 120000 });
  assert.equal(run('--bogus').status, 2);
  const h = run('--help');
  assert.equal(h.status, 0);
  assert.match(h.stdout, /usage: node scripts\/page-weight\.mjs/);
  const empty = mkdtempSync(join(tmpdir(), 'page-weight-empty-'));
  try { const e = run('--web', empty); assert.equal(e.status, 1); assert.match(e.stderr, /empty check is not a pass/); } finally { gone(empty); }
});
