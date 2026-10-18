// The characters the built pages render, derived from the pages and never guessed (web-build rule W-PERF-06: the fonts are subset to what the site shows).
// Three sources per page: the text nodes of the HTML (comments, tags, <style> and <script> blocks removed, character references decoded), the `content:` strings of its
// inline CSS, and the string literals of its inline scripts (an over-approximation: a literal that is never written to the page only adds characters). Not drawn in the
// page's typefaces, so left out: attribute text (alt, title, aria-label: the browser or the screen reader draws or speaks it), and the page's own URLs.
// Zero dependencies, node builtins only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { htmlPages } from './web-files.mjs';
import { htmlTokens } from './html-tokens.mjs';

// The WHATWG named character reference table, all 2125 terminated names (and the 106 legacy names a browser also decodes without their `;`), generated into html-entities.json from the Python standard library:
//   python -I -c "import json,sys,html.entities as e;h=e.html5;n={k[:-1]:v for k,v in h.items() if k.endswith(';')};l=sorted(k for k in h if not k.endswith(';'));assert all(h[k]==h[k+';'] for k in l);print(json.dumps({'python':sys.version.split()[0],'named':n,'legacy':l},ensure_ascii=True,sort_keys=True,indent=0),file=open('scripts/lib/html-entities.json','w',encoding='utf-8',newline='\n'))"
// (`python` = a Python 3 interpreter; the file records which one wrote it. Its standard library's html.entities.html5 is the WHATWG list of https://html.spec.whatwg.org/multipage/named-characters.html, nothing is downloaded.)
const TABLE = JSON.parse(readFileSync(new URL('./html-entities.json', import.meta.url), 'utf8'));
const NAMED = new Map(Object.entries(TABLE.named));
const LEGACY = new Set(TABLE.legacy);
const LONGEST_LEGACY = Math.max(...TABLE.legacy.map(n => n.length));
const SHORTEST_NAME = Math.min(...NAMED.keys().map(n => n.length)); // a run shorter than every name cannot be an attempt at a reference

// The numeric character reference end state (WHATWG HTML, "Numeric character reference end state"): 0, a surrogate and a value above U+10FFFF are U+FFFD; 0x80 to 0x9F draw the windows-1252 character
// (the spec's replacement table; 0x81, 0x8D, 0x8F, 0x90 and 0x9D have none and stay themselves); every other value is itself.
const C1 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
function numeric(n) {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(n >= 0x80 && n <= 0x9f ? C1[n - 0x80] : n);
}

// Decodes as a browser does in text, in ONE pass (a decoded `&` never starts a second reference): a numeric reference with or without its `;` (numeric() above); `&name;` for any name of the table; a legacy name without its
// `;`, the longest that is a prefix of the run of letters and digits (`&notice` is the not sign and "ice"). A terminated name that is not in the table throws, even when a legacy name is its prefix (`&notin;` is one character):
// the tokenizer would draw it as plain text, but a page that writes one has a typo, and the check says so instead of deriving from it. A run too short to be any name (`a&b;c`), and every other `&`, is plain text.
export function decodeEntities(s) {
  return s.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]*))(;?)/gi, (m, hex, dec, name, semi) => {
    if (hex || dec) return numeric(hex ? parseInt(hex, 16) : Number(dec));
    if (semi) {
      if (NAMED.has(name)) return NAMED.get(name);
      if (name.length < SHORTEST_NAME) return m;
      throw new Error('rendered-text: unknown character reference ' + m);
    }
    for (let n = Math.min(name.length, LONGEST_LEGACY); n > 0; n--) if (LEGACY.has(name.slice(0, n))) return NAMED.get(name.slice(0, n)) + name.slice(n);
    return m;
  });
}

// CSS string escapes, decoded in ONE pass (two passes read the backslash of `\\00ff`, an escaped backslash, as the start of a hex escape): a backslash and 1 to 6 hex digits (and one space that ends them), where 0, a surrogate
// and a value above U+10FFFF are U+FFFD; a backslash and a line break, which continues the string and draws nothing; or a backslash and any other character, which is that character.
const cssUnescape = s => s.replace(/\\(?:([0-9a-f]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\s\S]))/gi, (m, h, c) => {
  if (h === undefined) return /^[\r\n\f]/.test(c) ? '' : c;
  const n = parseInt(h, 16);
  return n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) ? String.fromCharCode(0xfffd) : String.fromCodePoint(n);
});
// JS string escapes: \n \t \r \b \f \v \0, \xHH, \uHHHH, \u{H+}, and a backslash before any other character.
const JS_SIMPLE = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
const jsUnescape = s => s.replace(/\\(?:u\{([0-9a-f]+)\}|u([0-9a-f]{4})|x([0-9a-f]{2})|(.))/gis, (m, a, b, c, d) => (a || b || c ? String.fromCodePoint(parseInt(a || b || c, 16)) : (d in JS_SIMPLE ? JS_SIMPLE[d] : d)));

// The text a page draws, from the one HTML scan (html-tokens.mjs): the text nodes and RCDATA bodies (a textarea, a title), character references decoded. Tags, comments and the bodies of scripts and styles are
// not text; each is a space, so that two text nodes never fuse. `scripting` is the scan's own option: with it off (a visitor without script) a <noscript> body is ordinary markup and its text is drawn.
export function textOf(html, opts) {
  return decodeEntities(htmlTokens(html, opts).map(t => (t.type === 'text' ? t.text : ' ')).join(''));
}

// The CSS readers below are single passes with no regular expression whose repetition can be split in more than one way, and none restarts inside text it has already read, so no input makes one slower than linear
// (a hex escape that a pattern could read whole or as a shorter escape and a name character took 2^n steps, and a failed match retried from every position inside itself took n^2: both measured, see font-coverage.test.mjs).
//
// The end of the string that starts at `q` (its quote): the index after the closing quote, or, when the string never closes, -(i + 1) where i is the index to read on from. A backslash takes the next character, a line
// break too (a continuation); a raw line break ends a bad string at the line break, and the end of the text ends one at the end.
function stringEnd(s, q) {
  const quote = s.charCodeAt(q);
  for (let j = q + 1; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === quote) return j + 1;
    if (c === 92) { if (j + 1 >= s.length) break; j++; } else if (c === 10 || c === 13 || c === 12) return -(j + 1);
  }
  return -(s.length + 1);
}

// CSS comments removed outside strings (the `/*` inside a string is text, also inside a bad string, which ends at its line break; a comment never closed runs to the end). The one comment stripper of the font checks
// and of the budget check's @import and url() scans.
export function stripCssComments(css) {
  const n = css.length;
  let out = '';
  let from = 0;
  let i = 0;
  while (i < n) {
    const c = css.charCodeAt(i);
    if (c === 34 || c === 39) {
      const end = stringEnd(css, i);
      i = end > 0 ? end : -end - 1;
    } else if (c === 47 && css.charCodeAt(i + 1) === 42) {
      const close = css.indexOf('*/', i + 2);
      out += css.slice(from, i) + ' ';
      i = from = close < 0 ? n : close + 2;
    } else i++;
  }
  return out + css.slice(from);
}

// The bodies of the live <style> blocks of an HTML text (none inside a comment, a script, an attribute value or a textarea: the one scan decides). The one style-block reader of the font checks and of the budget check.
// With scripting on (the default) a <style> inside a <noscript> is not live; with `{ scripting: false }` it is.
export const styleBlocksOf = (html, opts) => htmlTokens(html, opts).filter(t => t.type === 'raw' && t.name === 'style').map(t => t.body);

const STRING_LITERAL = /"((?:[^"\\\n\r\f]|\\[\s\S])*)"|'((?:[^'\\\n\r\f]|\\[\s\S])*)'/g;
const literalsOf = text => [...text.matchAll(STRING_LITERAL)].map(lit => cssUnescape(lit[1] ?? lit[2]));

// The `content:` strings of the <style> blocks. Read as a browser reads them: the property name in any case and as a whole name (not `x-content:`, not a selector such as `.content:hover`), nothing from a CSS comment, a commented-out
// <style> block or a <style> inside a script, and a string broken by a raw line break is a bad string that draws nothing (a backslash before the break continues it).
// A `var(--name)` in the value is resolved ONE level: --name is a custom property the style blocks of the page define as plain string literals (`--arrow: "x"`), and its strings are read as if written in the value.
// A fallback string (`var(--name, "x")`) is a string literal of the value and is read like any other, whether or not --name is defined (an over-approximation).
// The cascade is not modelled and a font cut errs only by keeping too much, so a property defined more than once keeps the strings of EVERY definition in the blocks, whichever selector holds it (a later definition never
// replaces an earlier one). A definition that ends in `!important` holds its value without it; `var(` is ASCII case-insensitive; a property name is case-sensitive and may hold a non-ASCII character or a CSS escape
// (--a\62 is --ab), decoded on both sides. Not followed, named limits: a custom property defined through another var(), through calc() or any non-string value (a definition of that kind adds nothing, and takes
// nothing away from another definition of the same name), and one set in a style attribute or by script.
const WHITESPACE = /\s/;
const isNameCode = c => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c >= 0x80;
const isHexCode = c => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

// The end of the custom property name whose two dashes stand at `i`, or -1 when no name character follows them. A name character is an ASCII letter or digit, `_`, `-`, any non-ASCII character, or a CSS escape: a backslash
// and 1 to 6 hex digits with one ending whitespace (CRLF counts as one), or a backslash and any other character but a line break. A backslash before a line break, or at the end, is no escape and ends the name.
function customNameEnd(s, i) {
  const n = s.length;
  let j = i + 2;
  while (j < n) {
    const c = s.charCodeAt(j);
    if (isNameCode(c)) { j++; continue; }
    if (c !== 92 || j + 1 >= n) break;
    const d = s.charCodeAt(j + 1);
    if (d === 10 || d === 13 || d === 12) break;
    if (!isHexCode(d)) { j += 2; continue; }
    let k = j + 1;
    while (k < n && k < j + 7 && isHexCode(s.charCodeAt(k))) k++;
    const w = s.charCodeAt(k);
    if (w === 13 && s.charCodeAt(k + 1) === 10) k += 2;
    else if (w === 32 || w === 9 || w === 10 || w === 13 || w === 12) k++;
    j = k;
  }
  return j > i + 2 ? j : -1;
}

// The end of a declaration value that starts at `k`: strings (complete ones) and every other character up to a `;`, a `}` or a quote that opens no complete string.
function valueEnd(s, k) {
  const n = s.length;
  while (k < n) {
    const c = s.charCodeAt(k);
    if (c === 59 || c === 125) break;
    if (c === 34 || c === 39) {
      const end = stringEnd(s, k);
      if (end < 0) break;
      k = end;
    } else k++;
  }
  return k;
}

const skipSpace = (s, k) => { while (k < s.length && WHITESPACE.test(s[k])) k++; return k; };

// A value without a trailing `!important` (an important flag is not part of a custom property's value; anywhere else in the value it is no flag and stays).
function withoutImportant(value) {
  let e = value.length;
  while (e > 0 && WHITESPACE.test(value[e - 1])) e--;
  if (e < 9 || value.slice(e - 9, e).toLowerCase() !== 'important') return value;
  let b = e - 9;
  while (b > 0 && WHITESPACE.test(value[b - 1])) b--;
  return b > 0 && value[b - 1] === '!' ? value.slice(0, b - 1) : value;
}

// Each custom property declaration of a block: [the name as written, the value as written]. A name starts after the start of the block, a `{`, a `;` or whitespace, and is followed by a colon. A name that is not followed by
// a colon is skipped whole: a name does not start again inside itself.
function* customDefinitions(block) {
  let i = 0;
  while ((i = block.indexOf('--', i)) !== -1) {
    if (i > 0 && block[i - 1] !== '{' && block[i - 1] !== ';' && !WHITESPACE.test(block[i - 1])) { i++; continue; }
    const e = customNameEnd(block, i);
    if (e < 0) { i += 2; continue; }
    let k = skipSpace(block, e);
    if (block[k] !== ':') { i = e; continue; }
    k = skipSpace(block, k + 1);
    const end = valueEnd(block, k);
    yield [block.slice(i, e), block.slice(k, end)];
    i = end;
  }
}

// The names a content value reads through `var(`: `var(` in any case, optional whitespace, then a custom property name.
function* customUses(value) {
  const open = /var\(\s*(?=--)/gi;
  for (let m; (m = open.exec(value));) {
    const start = m.index + m[0].length;
    const end = customNameEnd(value, start);
    if (end > 0) yield value.slice(start, end);
  }
}

export function cssContentOf(html, opts) {
  const out = [];
  const blocks = styleBlocksOf(html, opts).map(stripCssComments);
  const custom = new Map(); // --name (unescaped) -> the Set of strings of all its definitions whose whole value is string literals
  for (const block of blocks) {
    for (const [name, text] of customDefinitions(block)) {
      const value = withoutImportant(text).trim();
      if (!value || value.replace(STRING_LITERAL, '').trim() !== '') continue;
      const key = cssUnescape(name);
      let strings = custom.get(key);
      if (!strings) custom.set(key, strings = new Set());
      for (const s of literalsOf(value)) strings.add(s);
    }
  }
  const emitted = new Set(); // a property's strings are read once: only the SET of strings reaches the font coverage
  for (const block of blocks) {
    const head = /(?<=^|[{;\s])content\s*:\s*/gi;
    while (head.exec(block)) {
      const end = valueEnd(block, head.lastIndex);
      const value = block.slice(head.lastIndex, end);
      head.lastIndex = end;
      for (const s of literalsOf(value)) out.push(s);
      for (const name of customUses(value)) {
        const key = cssUnescape(name);
        if (emitted.has(key)) continue;
        emitted.add(key);
        for (const s of custom.get(key) ?? []) out.push(s);
      }
    }
  }
  return out.join(' ');
}

export function scriptStringsOf(html) {
  const out = [];
  for (const body of htmlTokens(html).filter(t => t.type === 'raw' && t.name === 'script').map(t => t.body)) {
    for (const lit of body.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/gs)) out.push(jsUnescape(lit[1] ?? lit[2] ?? lit[3]));
  }
  return out.join(' ');
}

// What the font files must cover is what a page DRAWS to anyone, a visitor without script included: the <noscript> body is read as markup (scripting off), so its text and its styles count.
const DRAWN = { scripting: false };

// code point -> the pages that render it. Characters at or below U+0020 are layout, not glyphs, except the space itself, which every face must carry.
export function renderedChars(webDir) {
  const seen = new Map();
  const note = (text, page) => { for (const ch of text) { const cp = ch.codePointAt(0); if (cp < 0x20) continue; (seen.get(cp) || seen.set(cp, new Set()).get(cp)).add(page); } };
  const pages = htmlPages(webDir);
  for (const page of pages) {
    const html = readFileSync(join(webDir, page), 'utf8').replace(/\r\n/g, '\n');
    note(textOf(html, DRAWN) + ' ' + cssContentOf(html, DRAWN) + ' ' + scriptStringsOf(html), 'web/' + page);
  }
  return seen;
}
