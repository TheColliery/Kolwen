// Tests for the font subset (web-build rule W-PERF-06): the characters the pages render are derived, every font file carries every character it must (read from the
// file's own cmap), the cut files carry the new family name and not the reserved one, and the pages ask for no layout feature the cut dropped.
// Node builtins only. A test that needs a changed copy of the site works on a copy in a temp folder; the real tree is never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEntities, textOf, cssContentOf, scriptStringsOf, renderedChars } from './lib/rendered-text.mjs';
import { woff2Cmap, woff2Names } from './lib/woff2-cmap.mjs';
import { glyphSets, coverageGaps, facesOf, asksForLayoutFeature, THAI_SHAPING } from './lib/font-coverage.mjs';
import { cutSet, BASELINE } from './font-subset.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const manifest = () => facesOf(readFileSync(join(WEB, 'fonts/fonts.css'), 'utf8').replace(/\r\n/g, '\n'));
const fontFiles = () => [...new Set(manifest().map(f => f.urls[0]))];
const cp = s => s.codePointAt(0);

test('the rendered text of a page: text nodes, character references, CSS content strings and script strings, and nothing from tags, comments or attributes', () => {
  const html = '<html lang="th"><head><title>A &amp; B</title><style>a::after{content:"\\2192 x"}b{content:attr(x)}</style></head><body title="Z"><!-- Q --><p>\u0e01&#39;&#x2014;</p><script>var s = "\\u00e9\\n"; var t = \'q\';</script></body></html>';
  const text = textOf(html);
  assert.ok(text.includes('A & B') && text.includes(String.fromCodePoint(0x0e01) + "'" + String.fromCodePoint(0x2014)));
  assert.ok(!text.includes('Q') && !text.includes('Z') && !text.includes('2192') && !text.includes('var'), 'no comment, attribute, style or script text in the text nodes: ' + JSON.stringify(text));
  assert.equal(cssContentOf(html).trim(), String.fromCodePoint(0x2192) + 'x', 'the one space after a hex escape ends it');
  assert.equal(scriptStringsOf(html).trim(), String.fromCodePoint(0xe9) + '\n q');
  assert.throws(() => decodeEntities('&bogus;'), /unknown character reference &bogus;/);
});

test('the derived set: the pages render these characters, the Thai block among them, and every one is a code point at or above U+0020', () => {
  const seen = renderedChars(WEB);
  assert.ok(seen.size > 100 && seen.size < 400, 'rendered code points: ' + seen.size);
  assert.ok(seen.has(0x20) && seen.has(cp('K')) && seen.has(0x0e01), 'space, a Latin letter and a Thai letter');
  assert.ok([...seen.keys()].every(c => c >= 0x20));
  for (const pages of seen.values()) assert.ok([...pages].every(p => /^web\/[a-z0-9-]+\.html$/.test(p)));
});

test('the WOFF2 reader: a font file names glyphs for the characters it carries and for no other, and a file that is not WOFF2 is refused', () => {
  const thai = fontFiles().find(u => u.includes('/thai/'));
  const map = woff2Cmap(readFileSync(join(WEB, thai)));
  assert.ok(map.has(0x0e01) && map.has(cp('K')) && map.has(0x20), 'a Thai letter, a Latin letter, space');
  assert.ok(!map.has(0x00ff) && !map.has(0x0416), 'neither y-diaeresis nor a Cyrillic letter is in the cut');
  assert.throws(() => woff2Cmap(Buffer.from('not a font at all, not a font at all, not a font at all, ok')), /not a WOFF2 file/);
});

test('every font file carries every character the pages render inside its unicode-range, and the Thai shaping set when it serves Thai', () => {
  assert.deepEqual(coverageGaps(WEB), []);
  const sets = glyphSets(WEB);
  assert.equal(sets.size, 6, 'six font files');
  for (const file of sets.values()) {
    const isThai = file.url.includes('/thai/');
    for (const c of THAI_SHAPING) assert.equal(file.need.has(c), isThai, `${file.url}: shaping set ${c.toString(16)}`);
    assert.ok(file.cps.length > 50, file.url + ': a derived set, not an empty one');
  }
});

// A copy of web/ in a temp folder, with a function to edit it. The copy shares no file with the real tree.
function webCopy(edit) {
  const dir = mkdtempSync(join(tmpdir(), 'font-coverage-'));
  cpSync(WEB, join(dir, 'web'), { recursive: true });
  edit(join(dir, 'web'));
  return dir;
}

test('RED PROOF: a page that renders a character the cut files dropped fails the check naming the character, the face and the page', () => {
  const dir = webCopy(web => {
    const f = join(web, 'index.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', '<p>\u00ff</p></body>'));
  });
  try {
    const gaps = coverageGaps(join(dir, 'web'));
    assert.ok(gaps.length >= 2, 'the Sans Thai files and the Mono files each lack it: ' + gaps.join(' | '));
    assert.ok(gaps.every(g => g.startsWith('U+00FF "\u00ff" is not in ')), gaps.join(' | '));
    assert.ok(gaps.some(g => /KW Sans Thai/.test(g)) && gaps.some(g => /KW Mono/.test(g)), 'both families named');
    assert.ok(gaps.every(g => g.includes('rendered by web/index.html')), 'the page is named');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RED PROOF: a Latin-range character the cut dropped (the per mille sign), a character from a CSS content string and one from a script string each fail the check', () => {
  const missingThai = 0x2030; // the per mille sign: inside the declared Sans Latin range, not in the baseline, and rendered by no page
  const dir = webCopy(web => {
    const f = join(web, 'pricing.html');
    let html = readFileSync(f, 'utf8');
    html = html.replace('</body>', '<p>' + String.fromCodePoint(missingThai) + '</p></body>').replace('</style>', 'p::before{content:"\\00ff"}</style>').replace('</body>', '<script>var x = "\\u0416";</script></body>');
    writeFileSync(f, html);
  });
  try {
    const gaps = coverageGaps(join(dir, 'web'));
    assert.ok(gaps.some(g => g.startsWith('U+2030 ') && /KW Sans Thai/.test(g)), 'the per mille sign: ' + gaps.join(' | '));
    assert.ok(gaps.some(g => g.startsWith('U+00FF ')), 'the CSS content character');
    assert.ok(!gaps.some(g => g.startsWith('U+0416')), 'a Cyrillic letter is outside every declared range, so another check (not this one) judges it');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the check judges the file, not the manifest: a manifest range widened over a character the file lacks fails', () => {
  const dir = webCopy(web => {
    const f = join(web, 'fonts/fonts.css');
    writeFileSync(f, readFileSync(f, 'utf8').replace(/(font-family: 'KW Mono';[^}]*unicode-range: )/, '$1U+00FF, '));
    const idx = join(web, 'index.html');
    writeFileSync(idx, readFileSync(idx, 'utf8').replace('</body>', '<p>\u00ff</p></body>'));
  });
  try {
    const gaps = coverageGaps(join(dir, 'web'));
    assert.ok(gaps.length > 0 && gaps.every(g => g.startsWith('U+00FF ')), gaps.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the cut files carry the new family name and no "Plex" in the name records that present a name to users; copyright, trademark and licence records are kept', () => {
  for (const url of fontFiles()) {
    const names = woff2Names(readFileSync(join(WEB, url)));
    const get = id => names.filter(n => n.id === id).map(n => n.text);
    const family = url.includes('/thai/') ? 'KW Sans Thai' : 'KW Mono';
    for (const id of [1, 3, 4, 6, 16, 17]) for (const t of get(id)) assert.ok(!/plex/i.test(t), `${url}: name ID ${id} has no reserved name: ${t}`);
    for (const t of get(1)) assert.ok(t.startsWith(family), `${url}: family ${t}`);
    for (const t of get(4)) assert.ok(t.startsWith(family), `${url}: full name ${t}`);
    for (const t of get(6)) assert.ok(/^KW(SansThai|Mono)/.test(t), `${url}: PostScript name ${t}`);
    assert.ok(get(0).length > 0 && get(0).every(t => /IBM Corp/.test(t)), url + ': the copyright record is IBM\'s, unchanged');
    assert.ok(get(7).every(t => /Plex/.test(t)) && get(7).length > 0, url + ': the trademark record is kept');
    assert.ok(get(13).length > 0 && get(13).every(t => /SIL Open Font License/.test(t)) && get(14).length > 0, url + ': the licence records are kept');
  }
});

test('the pages ask for no OpenType layout feature, so the features the cut dropped are unreachable; a page that asks for one is caught', () => {
  for (const page of readdirSync(WEB).filter(f => f.endsWith('.html'))) assert.ok(!asksForLayoutFeature(readFileSync(join(WEB, page), 'utf8')), page + ' asks for a layout feature');
  assert.ok(asksForLayoutFeature('<style>h1{font-variant-numeric:slashed-zero}</style>'));
  assert.ok(asksForLayoutFeature("<p style=\"font-feature-settings:'zero'\">x</p>"));
  assert.ok(!asksForLayoutFeature('<style>h1{font-weight:600}</style>'));
});

// ── the cut keeps a baseline beyond what the pages render today, so one new letter does not force a re-cut ────────────────────────────────────────────────
test('the cut set is the derived set plus the baseline: all printable ASCII and the house punctuation in both families, the whole declared Thai range in Sans Thai only', () => {
  const sets = [...glyphSets(WEB).values()];
  const sans = sets.find(f => f.url.includes('/thai/')), mono = sets.find(f => f.url.includes('/mono/'));
  const sansCut = new Set(cutSet(sans)), monoCut = new Set(cutSet(mono));
  for (const c of [...Array(0x7e - 0x20 + 1).keys()].map(i => i + 0x20)) assert.ok(sansCut.has(c) && monoCut.has(c), 'ASCII ' + c.toString(16));
  for (const c of [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0xa9, 0xb7, 0xd7, 0xa0]) assert.ok(sansCut.has(c) && monoCut.has(c), 'punctuation ' + c.toString(16));
  for (let c = 0x0e01; c <= 0x0e3a; c++) assert.ok(sansCut.has(c) && !monoCut.has(c), 'Thai ' + c.toString(16));
  for (let c = 0x0e3f; c <= 0x0e5b; c++) assert.ok(sansCut.has(c) && !monoCut.has(c), 'Thai ' + c.toString(16));
  for (const c of THAI_SHAPING) assert.ok(sansCut.has(c) && !monoCut.has(c), 'shaping ' + c.toString(16));
  for (const c of sans.cps) assert.ok(sansCut.has(c), 'derived ' + c.toString(16));
  assert.ok(!sansCut.has(0x00ff) && !monoCut.has(0x0416), 'nothing else: no y-diaeresis, no Cyrillic');
  assert.deepEqual(BASELINE.ascii, [0x20, 0x7e]);
});

test('the cut files carry every code point of the cut set (the baseline reached the files, not only the script)', () => {
  for (const f of glyphSets(WEB).values()) {
    const cmap = woff2Cmap(readFileSync(join(WEB, f.url)));
    assert.deepEqual(cutSet(f).filter(c => !cmap.has(c)), [], f.url + ' lacks a baseline or derived code point');
  }
});
