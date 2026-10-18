// The characters the built pages render, derived from the pages and never guessed (web-build rule W-PERF-06: the fonts are subset to what the site shows).
// Three sources per page: the text nodes of the HTML (comments, tags, <style> and <script> blocks removed, character references decoded), the `content:` strings of its
// inline CSS, and the string literals of its inline scripts (an over-approximation: a literal that is never written to the page only adds characters). Not drawn in the
// page's typefaces, so left out: attribute text (alt, title, aria-label: the browser or the screen reader draws or speaks it), and the page's own URLs.
// Zero dependencies, node builtins only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { htmlPages } from './web-files.mjs';

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

export function textOf(html) {
  const stripped = html.replace(/<(style|script)\b[\s\S]*?<\/\1\b[^>]*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ');
  return decodeEntities(stripped);
}

export function cssContentOf(html) {
  const out = [];
  for (const block of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\b[^>]*>/gi)) {
    for (const m of block[1].matchAll(/\bcontent\s*:\s*((?:"(?:[^"\\]|\\[\s\S])*"|'(?:[^'\\]|\\[\s\S])*'|[^;}"'])*)/g)) {
      for (const lit of m[1].matchAll(/"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'/g)) out.push(cssUnescape(lit[1] ?? lit[2]));
    }
  }
  return out.join(' ');
}

export function scriptStringsOf(html) {
  const out = [];
  for (const block of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\b[^>]*>/gi)) {
    for (const lit of block[1].matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/gs)) out.push(jsUnescape(lit[1] ?? lit[2] ?? lit[3]));
  }
  return out.join(' ');
}

// code point -> the pages that render it. Characters at or below U+0020 are layout, not glyphs, except the space itself, which every face must carry.
export function renderedChars(webDir) {
  const seen = new Map();
  const note = (text, page) => { for (const ch of text) { const cp = ch.codePointAt(0); if (cp < 0x20) continue; (seen.get(cp) || seen.set(cp, new Set()).get(cp)).add(page); } };
  const pages = htmlPages(webDir);
  for (const page of pages) {
    const html = readFileSync(join(webDir, page), 'utf8').replace(/\r\n/g, '\n');
    note(textOf(html) + ' ' + cssContentOf(html) + ' ' + scriptStringsOf(html), 'web/' + page);
  }
  return seen;
}
