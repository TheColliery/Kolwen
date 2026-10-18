// Tests for the font subset (web-build rule W-PERF-06): the characters the pages render are derived, every font file carries every character it must (read from the
// file's own cmap), the cut files carry the new family name and not the reserved one, and the pages ask for no layout feature the cut dropped.
// Node builtins only. A test that needs a changed copy of the site works on a copy in a temp folder; the real tree is never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, cpSync } from 'node:fs';
import { brotliCompressSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEntities, textOf, cssContentOf, scriptStringsOf, renderedChars } from './lib/rendered-text.mjs';
import { woff2Cmap, woff2Names } from './lib/woff2-cmap.mjs';
import { htmlPages } from './lib/web-files.mjs';
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

test('CSS string escapes are decoded in ONE pass: an escaped backslash is a backslash and what follows it is plain text, a hex escape ends at one space, a bad code point is U+FFFD, a backslash-newline is nothing', () => {
  const content = css => cssContentOf(`<style>a::after{content:${css}}</style>`);
  const BS = String.fromCharCode(92);
  assert.equal(content('"' + BS + BS + '00ff"'), BS + '00ff', 'CSS \\\\00ff draws a backslash and 00ff, not U+00FF');
  assert.equal(content('"' + BS + BS + BS + '00ff"'), BS + String.fromCodePoint(0xff), 'an escaped backslash, then a real hex escape');
  assert.equal(content('"a' + BS + BS + 'b"'), 'a' + BS + 'b');
  assert.equal(content('"' + BS + BS + ' ' + BS + '2192 x"'), BS + ' ' + String.fromCodePoint(0x2192) + 'x');
  assert.equal(content('"' + BS + '2192"'), String.fromCodePoint(0x2192));
  assert.equal(content('"' + BS + '22 x"'), '"x', 'an escaped quote, the one space after the hex ends it');
  assert.equal(content('"' + BS + 'A' + BS + 'a"'), '\n\n', 'A and a are hex digits: two escapes of U+000A');
  for (const bad of ['0', 'd800', 'dfff', 'ffffff', '110000']) assert.equal(content('"' + BS + bad + '"'), String.fromCharCode(0xfffd), bad);
  assert.equal(content('"a' + BS + '\nb"'), 'ab', 'a backslash before a line break continues the string');
  assert.equal(content('"' + BS + 'z' + BS + '-"'), 'z-', 'a backslash before a character that is not a hex digit is that character');
});

test('CSS content is read as the browser reads it: the property name in any case, as a whole name, outside comments (HTML and CSS) and outside a script, and a string that is broken by a raw line break draws nothing', () => {
  const ARROW = String.fromCodePoint(0x2192), BS = String.fromCharCode(92);
  const arrow = BS + '2192';
  const style = css => cssContentOf(`<style>${css}</style>`);
  // CodeRabbit and Copilot, PR 48: property names are ASCII case-insensitive
  assert.equal(style(`a::after{CONTENT:"${arrow}"}`), ARROW);
  assert.equal(style(`a::after{Content : '${arrow}'}`), ARROW);
  assert.equal(style(`a::after{cOnTeNt:"${arrow}"}`), ARROW);
  // T1: text that draws nothing is not read
  assert.equal(cssContentOf(`<!-- <style>a::after{content:"${arrow}"}</style> -->`), '', 'a commented-out <style> block');
  assert.equal(cssContentOf(`<!-- x --><style>a::after{content:"q"}</style><!-- <style>b::after{content:"z"}</style> -->`), 'q', 'the live block beside a commented one');
  assert.equal(cssContentOf(`<script>var s = "<style>a::after{content:'q'}</style>";</script>`), '', 'a <style> inside a script string is script text');
  assert.equal(style(`/* a::after{content:"${arrow}"} */ b::after{content:"q"}`), 'q', 'content: inside a CSS comment');
  assert.equal(style(`a::after{content:"q" /* ; content:"${arrow}" */}`), 'q');
  assert.equal(style(`/* never closed a::after{content:"${arrow}"}`), '', 'a comment that runs to the end of the stylesheet');
  assert.equal(style('a::after{content:"/* kept */"}'), '/* kept */', 'comment marks inside a string are text');
  for (const prefixed of ['x-content', '-webkit-content', 'mycontent', 'a_content']) assert.equal(style(`a::after{${prefixed}:"${arrow}"}`), '', prefixed + ' is not content');
  assert.equal(style(`.content:hover{color:red} #content:focus{color:red}`), '', 'a selector with the word is not a declaration');
  assert.equal(style('a::after{color:red;content:"q"}'), 'q', 'after a semicolon');
  assert.equal(style('a::after{content:"a\nb"}'), '', 'a raw line break ends a string as a bad string, and the declaration is dropped');
  assert.equal(style('a::after{content:"q"; content:\'a\nb\'}'), 'q');
});

test('an HTML comment ends where the parser ends it: <!--> and <!---> are whole empty comments and --!> closes a comment, so what follows is live in cssContentOf and in textOf', () => {
  const ARROW = String.fromCodePoint(0x2192), arrow = String.fromCharCode(92) + '2192';
  const live = `<style>a::after{content:"${arrow}"}</style>`;
  for (const [what, open] of [['<!-->', '<!-->'], ['<!--->', '<!--->'], ['--!>', '<!-- x --!>'], ['-->', '<!-- x -->'], ['an empty -->', '<!---->']]) {
    assert.equal(cssContentOf(open + live), ARROW, 'a <style> after ' + what);
    assert.match(textOf(open + '<p>after</p>'), /after/, 'text after ' + what);
  }
  assert.equal(cssContentOf(`<!-- ${live} --!>`), '', 'a <style> inside a comment that --!> closes is still skipped');
  assert.equal(cssContentOf(`<!-- ${live} -->`), '');
  assert.doesNotMatch(textOf('<!-- hidden --><p>shown</p>'), /hidden/);
  assert.doesNotMatch(textOf('<!-- hidden --!><p>shown</p>'), /hidden/);
  assert.equal(cssContentOf(`<!-- never closed ${live}`), '', 'a comment that is never closed runs to the end');
});

test('the derived set: the pages render these characters, the Thai block among them, and every one is a code point at or above U+0020', () => {
  const seen = renderedChars(WEB);
  assert.ok(seen.size > 100 && seen.size < 400, 'rendered code points: ' + seen.size);
  assert.ok(seen.has(0x20) && seen.has(cp('K')) && seen.has(0x0e01), 'space, a Latin letter and a Thai letter');
  assert.ok([...seen.keys()].every(c => c >= 0x20));
  for (const pages of seen.values()) assert.ok([...pages].every(p => /^web\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.html$/.test(p)));
});

const ch = String.fromCodePoint;
test('character references are decoded as a browser decodes them: a numeric one without its semicolon too, a legacy named one without it (longest name first), and a reference once only', () => {
  assert.equal(decodeEntities('&#255'), ch(0xff));
  assert.equal(decodeEntities('&#xFF'), ch(0xff));
  assert.equal(decodeEntities('&#XfF!'), ch(0xff) + '!');
  assert.equal(decodeEntities('&#8240 x'), ch(0x2030) + ' x', 'the digits end at the first non-digit');
  assert.equal(decodeEntities('&copy 2026'), ch(0xa9) + ' 2026');
  assert.equal(decodeEntities('&copy;'), ch(0xa9));
  assert.equal(decodeEntities('&notice'), ch(0xac) + 'ice', 'a legacy name is decoded inside a longer run of letters, as a browser does in text');
  assert.equal(decodeEntities('&notin'), ch(0xac) + 'in', 'the longest legacy prefix wins, the rest stays');
  assert.equal(decodeEntities('&notin;'), ch(0x2209), 'a terminated name is the whole name, not its legacy prefix');
  assert.throws(() => decodeEntities('&notit;'), /unknown character reference &notit;/);
  assert.equal(decodeEntities('&amp'), '&');
  assert.equal(decodeEntities('&ampx'), '&x');
  assert.equal(decodeEntities('R&D and AT&T and &#x and &# and &'), 'R&D and AT&T and &#x and &# and &', 'an ampersand that starts no reference is plain text');
  assert.equal(decodeEntities('&#38;copy; &amp;#65;'), '&copy; &#65;', 'a decoded ampersand never starts a second decoding');
  assert.throws(() => decodeEntities('&bogus;'), /unknown character reference &bogus;/);
});

// The WHATWG named character reference table, generated by `python -I -c "..."` over html.entities.html5 into scripts/lib/html-entities.json (the command is in rendered-text.mjs).
test('the named references are the whole WHATWG table: names a page may use render as the browser draws them, including two code points, and the table file is what the generator wrote', () => {
  assert.equal(decodeEntities('&mdash;'), ch(0x2014));
  assert.equal(decodeEntities('&hellip; &rarr; &Aacute; &eacute;'), ch(0x2026) + ' ' + ch(0x2192) + ' ' + ch(0xc1) + ' ' + ch(0xe9));
  assert.equal(decodeEntities('&nbsp;'), ch(0xa0));
  assert.equal(decodeEntities('&NotEqual;'), ch(0x2260), 'NotEqual is one character, U+2260');
  assert.equal(decodeEntities('&NotEqualTilde;'), ch(0x2242, 0x338), 'a reference that stands for two code points: U+2242 and the combining long solidus U+0338');
  assert.equal(decodeEntities('&fjlig;'), 'fj');
  assert.equal(decodeEntities('&apos;'), "'");
  assert.equal(decodeEntities('&apos'), '&apos', 'apos has no semicolon-less form');
  const table = JSON.parse(readFileSync(join(ROOT, 'scripts/lib/html-entities.json'), 'utf8'));
  const names = Object.keys(table.named);
  assert.ok(names.length > 2100 && table.legacy.length === 106, `the whole table: ${names.length} names, ${table.legacy.length} legacy`);
  assert.ok(table.legacy.every(n => n in table.named), 'every legacy name is also a terminated name');
  assert.ok(names.every(n => n.length >= 2), 'no reference is one character long');
  for (const n of ['AMP', 'GT', 'amp', 'copy', 'eacute']) assert.ok(table.legacy.includes(n), n + ' is legacy');
  for (const n of ['mdash', 'notin', 'apos']) assert.ok(!table.legacy.includes(n), n + ' needs its semicolon');
  assert.ok(names.every(n => decodeEntities('&' + n + ';') === table.named[n]), 'every name decodes to its table value');
  assert.ok(table.legacy.every(n => decodeEntities('&' + n) === table.named[n]), 'every legacy name decodes without its semicolon');
});

test('an ampersand that starts no reference is plain text (the WHATWG tokenizer: an ambiguous ampersand), and a terminated name no reference has throws', () => {
  assert.equal(decodeEntities('a&b;c'), 'a&b;c', 'one letter is too short to be any reference');
  assert.equal(decodeEntities('R&D; AT&T; &9;'), 'R&D; AT&T; &9;');
  assert.equal(decodeEntities('x &zzzz y'), 'x &zzzz y', 'no semicolon, no legacy prefix');
  assert.throws(() => decodeEntities('&bogus;'), /unknown character reference &bogus;/);
  assert.throws(() => decodeEntities('a &xyz; b'), /unknown character reference &xyz;/);
});

test('numeric references follow the WHATWG replacement table: 0x80 to 0x9F draw the windows-1252 character, 0, a surrogate and a value above U+10FFFF become U+FFFD, decimal and hex, with and without the semicolon', () => {
  const same = (src, expected, what) => assert.equal(decodeEntities(src), expected, what || src);
  for (const [n, to] of [[0x80, 0x20ac], [0x82, 0x201a], [0x89, 0x2030], [0x8a, 0x160], [0x91, 0x2018], [0x96, 0x2013], [0x99, 0x2122], [0x9f, 0x178]]) {
    same(`&#${n};`, ch(to)); same(`&#${n}`, ch(to)); same(`&#x${n.toString(16)};`, ch(to)); same(`&#x${n.toString(16)}`, ch(to)); same(`&#X${n.toString(16).toUpperCase()} x`, ch(to) + ' x');
  }
  for (const n of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) same(`&#${n};`, ch(n), 'U+' + n.toString(16) + ' has no replacement and stays itself');
  same('&#127;', ch(0x7f)); same('&#160;', ch(0xa0)); same('&#255;', ch(0xff)); same('&#x1F600;', ch(0x1f600));
  for (const bad of ['&#0;', '&#0', '&#x0;', '&#xD800;', '&#xDFFF', '&#55296;', '&#1114112;', '&#x110000', '&#99999999999999999999999;', '&#xFFFFFFFFFFFFFFFFFFFFFFFF;']) same(bad, ch(0xfffd));
  same('&#x10FFFF;', ch(0x10ffff), 'the last valid code point');
});

test('RED PROOF: a numeric character reference without its semicolon, rendered by a page, is judged like the character it draws', () => {
  const dir = webCopy(web => {
    const f = join(web, 'terms.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', '<p>&#8240 x</p></body>'));
  });
  try {
    const gaps = coverageGaps(join(dir, 'web'));
    assert.ok(gaps.some(g => g.startsWith('U+2030 ') && g.includes('web/terms.html')), gaps.join(' | '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RED PROOF: a page that writes a C1 numeric reference and a named reference is judged by the characters a browser draws (the per mille sign and the em dash), and does not stop the check', () => {
  const dir = webCopy(web => {
    const f = join(web, 'refund.html');
    writeFileSync(f, readFileSync(f, 'utf8').replace('</body>', '<p>&#137; &#x89 &mdash; &hellip;</p></body>'));
  });
  try {
    const seen = renderedChars(join(dir, 'web'));
    for (const c of [0x2030, 0x2014, 0x2026]) assert.ok(seen.get(c).has('web/refund.html'), 'U+' + c.toString(16));
    assert.ok(coverageGaps(join(dir, 'web')).some(g => g.startsWith('U+2030 ') && g.includes('web/refund.html')), 'the per mille sign is not in the cut');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('RED PROOF: a page in a subfolder of web/ is read too, and a character only it renders that the cut lacks fails the check naming that page', () => {
  const dir = webCopy(web => {
    mkdirSync(join(web, 'th'));
    writeFileSync(join(web, 'th', 'index.html'), '<!doctype html><html lang="th"><head><title>x</title></head><body><p>' + ch(0x2030) + '</p></body></html>');
  });
  try {
    const gaps = coverageGaps(join(dir, 'web'));
    assert.ok(gaps.some(g => g.startsWith('U+2030 ') && g.includes('rendered by web/th/index.html')), gaps.join(' | '));
    assert.ok(renderedChars(join(dir, 'web')).get(0x2030).has('web/th/index.html'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A one-table WOFF2 file holding a cmap with one format-12 subtable (Windows, Unicode full repertoire), built by hand so a test can set the start glyph of a group, which the real fonts never put at 0.
const base128 = n => { const out = [n & 0x7f]; for (n = Math.floor(n / 128); n > 0; n = Math.floor(n / 128)) out.unshift((n & 0x7f) | 0x80); return Buffer.from(out); };
function cmap12Font(groups) {
  const sub = Buffer.alloc(16 + groups.length * 12);
  sub.writeUInt16BE(12, 0); sub.writeUInt32BE(sub.length, 4); sub.writeUInt32BE(groups.length, 12);
  groups.forEach(([b, e, g], i) => { sub.writeUInt32BE(b, 16 + i * 12); sub.writeUInt32BE(e, 20 + i * 12); sub.writeUInt32BE(g, 24 + i * 12); });
  const table = Buffer.concat([Buffer.from([0, 0, 0, 1, 0, 3, 0, 10, 0, 0, 0, 12]), sub]);
  const body = brotliCompressSync(table);
  const head = Buffer.alloc(48);
  head.write('wOF2', 0, 'latin1'); head.writeUInt16BE(1, 12); head.writeUInt32BE(body.length, 20);
  return Buffer.concat([head, Buffer.from([0]), base128(table.length), body]);
}
const mapped = (...groups) => [...woff2Cmap(cmap12Font(groups))].sort((a, b) => a - b);

test('cmap format 12: a group maps each character to its start glyph plus its offset in the group, so a start glyph of 0 leaves only the first character on .notdef (OpenType cmap, format 12)', () => {
  assert.deepEqual(mapped([0x41, 0x42, 5]), [0x41, 0x42], 'control: a group at glyph 5 maps both characters');
  assert.deepEqual(mapped([0x4b, 0x4c, 0]), [0x4c], 'K lands on glyph 0, L on glyph 1');
  assert.deepEqual(mapped([0, 1, 0]), [1], 'U+0000 lands on glyph 0, U+0001 on glyph 1');
  assert.deepEqual(mapped([0x4b, 0x4b, 0], [0x50, 0x52, 7]), [0x50, 0x51, 0x52], 'a group that is all .notdef adds nothing');
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
    // U+0416 is outside every declared range (the manifest already covers U+00FF), so only the edit below brings it under a face's duty
    const before = readFileSync(f, 'utf8');
    const after = before.replace(/(font-family: 'KW Mono';[^}]*unicode-range: )/, '$1U+0416, ');
    assert.notEqual(after, before, 'the KW Mono range was widened');
    writeFileSync(f, after);
    const idx = join(web, 'index.html');
    writeFileSync(idx, readFileSync(idx, 'utf8').replace('</body>', '<p>\u0416</p></body>'));
  });
  try {
    const gaps = coverageGaps(join(dir, 'web'));
    assert.ok(gaps.length > 0 && gaps.every(g => g.startsWith('U+0416 ') && /KW Mono/.test(g)), gaps.join(' | '));
    assert.ok(!gaps.some(g => /KW Sans Thai/.test(g)), 'only the widened face is judged');
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
  for (const page of htmlPages(WEB)) assert.ok(!asksForLayoutFeature(readFileSync(join(WEB, page), 'utf8')), page + ' asks for a layout feature');
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
