// Tests for the long cache of the font files (web-build rule W-PERF-02): the files carry a hash of their bytes in their names, fonts.css names exactly those files, web/_headers
// serves them `public, max-age=31536000, immutable` and nothing unhashed that way, and post-deploy-check asserts the header on a font url it reads from the live fonts.css.
// Node builtins only. A test that needs a changed copy of the site works on a copy in a temp folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, cpSync, renameSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fontNameProblems, facesOf, hashOf, FONT_URL } from './lib/font-coverage.mjs';
import { reEscape } from './lib/re-escape.mjs';
import { parseHeadersFile, patternMatches, FONT_CACHE_CONTROL, fontCacheMiss, firstFontUrl, fontCacheMisses, declarations } from './lib/headers-file.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const manifestUrls = () => [...new Set(facesOf(readFileSync(join(WEB, 'fonts/fonts.css'), 'utf8')).flatMap(f => f.urls))];
const withCopy = (edit, fn) => { const dir = mkdtempSync(join(tmpdir(), 'font-versions-')); try { cpSync(WEB, join(dir, 'web'), { recursive: true }); edit(join(dir, 'web')); return fn(join(dir, 'web')); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('every font url in the manifest is a versioned name, resolves to a file, and names the first ten hex digits of the sha256 of that file', () => {
  assert.deepEqual(fontNameProblems(WEB), []);
  const urls = manifestUrls();
  assert.equal(urls.length, 6);
  for (const url of urls) {
    assert.match(url, /^\/fonts\/(?:thai|mono)\/kw-[a-z0-9-]+-\d{3}\.[0-9a-f]{10}\.woff2$/, url + ': lowercase base, weight, ten hex digits');
    assert.equal(FONT_URL.exec(url)[3], hashOf(readFileSync(join(WEB, url))), url);
  }
});

test('a stale name fails: changed bytes under the old name, a name that resolves to no file, and an unversioned name each fail and are named', () => {
  const urls = manifestUrls();
  const flipped = withCopy(web => { const f = join(web, urls[0]); const b = readFileSync(f); b[b.length - 1] ^= 1; writeFileSync(f, b); }, fontNameProblems);
  assert.equal(flipped.length, 1, flipped.join(' | '));
  assert.match(flipped[0], new RegExp('^' + reEscape(urls[0]) + ': the name says [0-9a-f]{10} but the bytes hash to [0-9a-f]{10}'));
  const gone = withCopy(web => renameSync(join(web, urls[1]), join(web, urls[1].replace(/\.[0-9a-f]{10}\.woff2$/, '.0000000000.woff2'))), fontNameProblems);
  assert.deepEqual(gone, [`${urls[1]}: named by fonts.css but the file does not exist`]);
  const plain = withCopy(web => {
    const css = join(web, 'fonts/fonts.css');
    writeFileSync(css, readFileSync(css, 'utf8').split(urls[2]).join(urls[2].replace(/\.[0-9a-f]{10}\.woff2$/, '.woff2')));
  }, fontNameProblems);
  assert.equal(plain.length, 1);
  assert.match(plain[0], /not a versioned name/);
});

test('no font file on disk is left out of fonts.css, and a rename never leaves a file under an old hash', () => {
  const named = new Set(manifestUrls().map(u => u.replace(/^\//, '')));
  const onDisk = readdirSync(join(WEB, 'fonts'), { recursive: true }).map(p => 'fonts/' + String(p).split('\\').join('/')).filter(p => p.endsWith('.woff2'));
  assert.deepEqual(onDisk.sort(), [...named].sort());
});

test('patternMatches: a splat spans any characters, a placeholder one segment, a literal only itself', () => {
  assert.ok(patternMatches('/fonts/thai/*.woff2', '/fonts/thai/kw-sans-thai-400.0123456789.woff2'));
  assert.ok(!patternMatches('/fonts/thai/*.woff2', '/fonts/thai/OFL.txt'));
  assert.ok(!patternMatches('/fonts/thai/*.woff2', '/fonts/mono/kw-mono-400.0123456789.woff2'));
  assert.ok(patternMatches('/*', '/fonts/fonts.css') && patternMatches('/*.svg', '/favicon.svg'));
  assert.ok(patternMatches('/blog/:slug', '/blog/x') && !patternMatches('/blog/:slug', '/blog/x/y'));
  assert.ok(!patternMatches('/index.html', '/indexxhtml'), 'the dot is a literal dot');
});

test('web/_headers: every versioned font url gets exactly one Cache-Control rule and it is the long immutable one; fonts.css and the licence texts get none, so they stay revalidated', () => {
  const rules = parseHeadersFile(readFileSync(join(WEB, '_headers'), 'utf8'));
  const cache = declarations(rules, 'Cache-Control');
  for (const url of manifestUrls()) {
    const hits = cache.filter(d => patternMatches(d.pattern, url));
    assert.equal(hits.length, 1, `${url}: one Cache-Control rule (two would be joined by the edge): ${hits.map(h => h.pattern).join(' + ')}`);
    assert.equal(hits[0].value, FONT_CACHE_CONTROL, url);
  }
  for (const path of ['/fonts/fonts.css', '/fonts/thai/OFL.txt', '/fonts/mono/OFL.txt']) assert.deepEqual(cache.filter(d => patternMatches(d.pattern, path)), [], path + ' keeps the platform default');
  for (const r of rules.filter(r => r.headers.some(h => /immutable/i.test(h.value)))) assert.match(r.pattern, /^\/fonts\/[a-z]+\/\*\.woff2$/, 'immutable only on the hashed font files');
});

test('fontCacheMiss accepts the long immutable value and names what is wrong with any other', () => {
  assert.equal(fontCacheMiss('public, max-age=31536000, immutable'), null);
  assert.equal(fontCacheMiss('Public,Max-Age=63072000,Immutable'), null);
  assert.match(fontCacheMiss(null), /no Cache-Control/);
  assert.match(fontCacheMiss('public, max-age=0, must-revalidate'), /max-age of at least 31536000/);
  assert.match(fontCacheMiss('public, max-age=86400'), /max-age of at least 31536000/);
  assert.match(fontCacheMiss('public, max-age=31536000'), /without immutable/);
  assert.match(fontCacheMiss('max-age=31536000, immutable'), /without public/);
});

test('firstFontUrl reads the first woff2 url from the manifest text and nothing else', () => {
  assert.equal(firstFontUrl("@font-face{src:url('/fonts/thai/a.1234567890.woff2') format('woff2')}@font-face{src:url('/fonts/mono/b.1234567890.woff2')}"), '/fonts/thai/a.1234567890.woff2');
  assert.equal(firstFontUrl('body{background:url(/x.png)}'), null);
  assert.equal(firstFontUrl(readFileSync(join(WEB, 'fonts/fonts.css'), 'utf8')), manifestUrls()[0]);
});

// A fake origin: fonts.css names one font url; the font answers with the header the test chooses.
const fakeGet = (cacheControl, { css = "@font-face{src:url('/fonts/thai/kw-sans-thai-400.0123456789.woff2')}", fontStatus = 200, cssStatus = 200 } = {}) => async url => {
  if (url.endsWith('fonts/fonts.css')) return new Response(css, { status: cssStatus });
  return new Response('x', { status: fontStatus, headers: cacheControl == null ? {} : { 'Cache-Control': cacheControl } });
};

test('the live probe: it reads the font url from the served fonts.css and fails on the revalidated default, on a missing header, on a missing font and on a manifest with no url', async () => {
  const seen = [];
  const get = fakeGet(FONT_CACHE_CONTROL);
  assert.deepEqual(await fontCacheMisses('https://x.test/', async u => { seen.push(u); return get(u); }), []);
  assert.deepEqual(seen, ['https://x.test/fonts/fonts.css', 'https://x.test/fonts/thai/kw-sans-thai-400.0123456789.woff2'], 'the font url comes from the served manifest');
  const stale = await fontCacheMisses('https://x.test/', fakeGet('public, max-age=0, must-revalidate'));
  assert.equal(stale.length, 1);
  assert.match(stale[0], /^\/fonts\/thai\/kw-sans-thai-400\.0123456789\.woff2: is served Cache-Control "public, max-age=0, must-revalidate"/);
  assert.match((await fontCacheMisses('https://x.test/', fakeGet(null)))[0], /no Cache-Control/);
  assert.match((await fontCacheMisses('https://x.test/', fakeGet(FONT_CACHE_CONTROL, { fontStatus: 404 })))[0], /served HTTP 404, expected 200/);
  assert.match((await fontCacheMisses('https://x.test/', fakeGet(FONT_CACHE_CONTROL, { css: 'body{}' })))[0], /names no font url/);
  assert.match((await fontCacheMisses('https://x.test/', fakeGet(FONT_CACHE_CONTROL, { cssStatus: 500 })))[0], /served HTTP 500/);
});

test('post-deploy-check runs that probe and carries no font file name of its own', () => {
  const src = readFileSync(join(ROOT, 'scripts/post-deploy-check.mjs'), 'utf8');
  assert.match(src, /fontCacheMisses\(origin,/, 'the probe is called with the origin under test');
  assert.ok(!/kw-(?:sans-thai|mono)-\d{3}/.test(src), 'no hard-coded font name');
});
