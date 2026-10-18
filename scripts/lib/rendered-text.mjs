// The characters the built pages render, derived from the pages and never guessed (web-build rule W-PERF-06: the fonts are subset to what the site shows).
// Three sources per page: the text nodes of the HTML (comments, tags, <style> and <script> blocks removed, character references decoded), the `content:` strings of its
// inline CSS, and the string literals of its inline scripts (an over-approximation: a literal that is never written to the page only adds characters). Not drawn in the
// page's typefaces, so left out: attribute text (alt, title, aria-label: the browser or the screen reader draws or speaks it), and the page's own URLs.
// Zero dependencies, node builtins only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { servedFiles } from './web-files.mjs';

// The named references a browser decodes even without their semicolon (WHATWG HTML, "Named character references": the 106 names listed without a trailing `;`): the 96 Latin-1 names in code point order from U+00A0, then the ten upper-case and ASCII ones.
const LATIN1 = 'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(' ');
const LEGACY = new Map([...LATIN1.map((n, i) => [n, String.fromCharCode(0xa0 + i)]), ['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['AMP', '&'], ['LT', '<'], ['GT', '>'], ['QUOT', '"'], ['COPY', String.fromCharCode(0xa9)], ['REG', String.fromCharCode(0xae)]]);
const LONGEST_LEGACY = Math.max(...[...LEGACY.keys()].map(n => n.length));

// Decodes as a browser does in text, in ONE pass (a decoded `&` never starts a second reference): a numeric reference with or without its `;`; `&name;` for the legacy names and `apos`; a legacy name without its `;`, the longest
// that is a prefix of the run of letters (`&notice` is the not sign and "ice"). An `&name;` we do not know throws, even when a legacy name is its prefix (`&notin;` is one character, not the not sign and "in;"):
// a silent miss would leave a rendered character out of the derived set. Any other `&` is plain text.
export function decodeEntities(s) {
  return s.replace(/&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]*))(;?)/gi, (m, hex, dec, name, semi) => {
    if (hex || dec) return String.fromCodePoint(hex ? parseInt(hex, 16) : Number(dec));
    if (semi) {
      if (name === 'apos') return "'";
      if (LEGACY.has(name)) return LEGACY.get(name);
      throw new Error('rendered-text: unknown character reference ' + m);
    }
    for (let n = Math.min(name.length, LONGEST_LEGACY); n > 0; n--) if (LEGACY.has(name.slice(0, n))) return LEGACY.get(name.slice(0, n)) + name.slice(n);
    return m;
  });
}

// CSS string escapes: a backslash and 1 to 6 hex digits (and one space that ends them), or a backslash and any other character.
const cssUnescape = s => s.replace(/\\([0-9a-f]{1,6})[ \t\n]?/gi, (m, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/gs, '$1');
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
    for (const m of block[1].matchAll(/\bcontent\s*:\s*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^;}"'])*)/g)) {
      for (const lit of m[1].matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) out.push(cssUnescape(lit[1] ?? lit[2]));
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
  const pages = servedFiles(webDir).filter(f => f.endsWith('.html'));
  for (const page of pages) {
    const html = readFileSync(join(webDir, page), 'utf8').replace(/\r\n/g, '\n');
    note(textOf(html) + ' ' + cssContentOf(html) + ' ' + scriptStringsOf(html), 'web/' + page);
  }
  return seen;
}
