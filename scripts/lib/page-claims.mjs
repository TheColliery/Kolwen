// The page readers behind surface-check rules 13 (the CSP), 15 (the dropped "no trackers" claim), 16 (no robots noindex on a production page) and 17 (the production claims), and the
// bounded readers they share. Node builtins only.
//
// Why a library: the rules lived inline in scripts/surface-check.mjs as regular expressions that were super-linear on a page a stranger could write or a tool could break: a `<meta` with an
// unterminated quote, repeated n times, took 30 s at n = 40,000 (every start re-scanned to the end of the file), and the pin check re-read every passage of the page for every hit (11 s at 2,000
// passages with a hit each). Here both are single passes, and scripts/page-claims.test.mjs runs them on bulk input in a child under a kill timeout.
//
// The shared walk. The page is read once, at markup level, the way the HTML tokenizer reads it: a comment, the raw-text body of script, style, xmp, iframe, noembed and
// noframes, the RCDATA body of title and textarea, and the body of plaintext are DATA, so the walk skips each of them to its real end and reads no tag out of it. A start tag
// is read to the first `>` outside a quoted value, within a bound; a tag the bound does not end is UNREAD, and a caller reports it. A data body that never ends is HIDDEN, and a
// caller reports it: the browser reads the rest of the input as that body, so the rules cannot see past it. Every caller reads the same token list (a page is walked once per
// string), so a rule that asks for start tags, elements or tag counts gets the same answer as the others.
//
// An element's body runs from its start tag to the first end tag of its name at markup level, and the scan goes on after that end tag, so a body is never read as tags. The
// closer of a name is found once per name and reused by each later opener whose body starts before it; an opener with no closer ends the search for that name.
import { createHash } from 'node:crypto';

// The bound of one start-tag read: a tag longer than this is unread, and one opener costs at most this many steps.
export const META_MAX = 4096;
const DQ = 34, SQ = 39, GT = 62, SLASH = 47, EQ = 61; // " ' > / =
// The states of the HTML tokenizer (WHATWG HTML §13.2.5.8 and §13.2.5.32 to §13.2.5.40), as far as they decide where a start tag ends and which attribute names it has.
const TAG_NAME = 0, BEFORE_NAME = 1, NAME = 2, AFTER_NAME = 3, BEFORE_VALUE = 4, DQ_VALUE = 5, SQ_VALUE = 6, UNQUOTED = 7, AFTER_VALUE = 8;
const lower = c => String.fromCharCode(c).toLowerCase();

// Scan the start tag whose regex NAME ends at `nameEnd`. `end` is the index after the `>` that ends the tag, or -1 when no such `>` comes within `max` characters (the tag is UNREAD).
// `attrs` lists its attribute names as the tokenizer reads them (lower-cased), each with `valued`: whether the name is followed by `=`. A quote opens a value only in the before-value
// state, right after the `=` of an attribute; a quote inside a name, or inside an unquoted value, is a plain character, as the tokenizer reads it.
export function scanStartTag(s, nameEnd, max = META_MAX, collect = false) {
  const stop = Math.min(s.length, nameEnd + max);
  const attrs = [];
  const sink = { name: '', valued: false }; // the attribute of a scan that does not collect: its name is not built, so an unread tag costs no allocation
  let state = TAG_NAME, attr = null;
  const start = c => { if (collect) { attr = { name: lower(c), valued: false }; attrs.push(attr); } else attr = sink; return NAME; };
  for (let i = nameEnd; i < stop; i++) {
    const c = s.charCodeAt(i), space = c === 32 || c === 9 || c === 10 || c === 12 || c === 13; // the HTML white space: space, tab, LF, form feed, CR
    switch (state) {
      case TAG_NAME: if (c === GT) return { end: i + 1, attrs }; if (space || c === SLASH) state = BEFORE_NAME; break;
      case BEFORE_NAME: if (c === GT) return { end: i + 1, attrs }; if (!space && c !== SLASH) state = start(c); break;
      case NAME:
        if (c === GT) return { end: i + 1, attrs };
        if (c === EQ) { attr.valued = true; state = BEFORE_VALUE; }
        else if (space) state = AFTER_NAME;
        else if (c === SLASH) state = BEFORE_NAME;
        else if (collect) attr.name += lower(c);
        break;
      case AFTER_NAME:
        if (c === GT) return { end: i + 1, attrs };
        if (c === EQ) { attr.valued = true; state = BEFORE_VALUE; }
        else if (c === SLASH) state = BEFORE_NAME;
        else if (!space) state = start(c);
        break;
      case BEFORE_VALUE:
        if (c === GT) return { end: i + 1, attrs };
        if (c === DQ) state = DQ_VALUE;
        else if (c === SQ) state = SQ_VALUE;
        else if (!space) state = UNQUOTED;
        break;
      case DQ_VALUE: if (c === DQ) state = AFTER_VALUE; break;
      case SQ_VALUE: if (c === SQ) state = AFTER_VALUE; break;
      case UNQUOTED:
        if (c === GT) return { end: i + 1, attrs };
        if (space) state = BEFORE_NAME;
        break;
      case AFTER_VALUE:
        if (c === GT) return { end: i + 1, attrs };
        if (space || c === SLASH) state = BEFORE_NAME;
        else state = start(c);
        break;
    }
  }
  return { end: -1, attrs };
}
// The index after the `>` that ends the start tag whose regex name ends at `nameEnd`, or -1 (UNREAD). scanStartTag gives the attribute names too.
export const startTagEnd = (s, nameEnd, max = META_MAX) => scanStartTag(s, nameEnd, max).end;

// The tokenizer's tag name runs to white space, `/` or `>` (or the end of the input). A name ends at the first such character from its start, within `max`; -1 when none does.
const NAME_ENDS = /[\t\n\f\r />]/;
const ASCII_LETTER = /[a-zA-Z]/;
function nameEndAt(s, from, max) {
  const stop = Math.min(s.length, from + max);
  for (let j = from; j < stop; j++) if (NAME_ENDS.test(s[j])) return j;
  return -1;
}

// The data the walk skips (WHATWG HTML §13.2.5.4 to §13.2.5.5, §13.2.5.6, §13.2.5.9 to §13.2.5.10 and §13.2.5.12 onward). A raw-text or RCDATA body ends at its first end tag of
// its own name; `plaintext` has no end, so its body is the rest of the input. `noscript` is NOT here: rule 13 hashes its <style>, which a browser with scripting off applies, so
// its body is read as markup (a stated limit: a browser with scripting on reads it as text).
const DATA_ELEMENT = new Set(['script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'title', 'textarea', 'plaintext']);

// The index after the comment that starts at `i` (a `<!--`), or -1 when it never ends. An abrupt `<!-->` and `<!--->` are empty comments, as the tokenizer reads them.
function commentEnd(s, i) {
  if (s.startsWith('<!-->', i)) return i + 5;
  if (s.startsWith('<!--->', i)) return i + 6;
  const re = /--!?>/g;
  re.lastIndex = i + 4;
  const m = re.exec(s);
  return m ? m.index + m[0].length : -1;
}
// The index after the bogus comment that starts at `i` (`<!` that is no comment, `<?`, or `</` before a non-letter): it ends at the next `>`, or at the end of the input.
function bogusEnd(s, i) { const g = s.indexOf('>', i + 2); return g < 0 ? s.length : g + 1; }

// The index of the first `</name` at or after `from` whose name ends there. The tokenizer's end tag name runs to white space, `/` or `>`, so `</a.x>` and `</a"x>` end another name
// and do not close `<a>`, and `</a` at the end of the input is not an end tag. The match is case-insensitive, as end tag names are.
function closerOf(s, name, from) {
  const re = new RegExp('</' + name + '(?=[\\t\\n\\f\\r />])', 'gi');
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? m.index : -1;
}

// The closer of a data body that starts at `from` (the end of its start tag): { close, closeEnd }, close -1 when no end tag of its name follows. Once a name has no end
// after some point, no later body of that name has one either, so the name is not searched again.
function bodyEnd(s, name, from, max, shut) {
  if (shut.has(name)) return { close: -1, closeEnd: -1 };
  const close = closerOf(s, name, from);
  if (close < 0) { shut.add(name); return { close: -1, closeEnd: -1 }; }
  return { close, closeEnd: scanStartTag(s, close + 2 + name.length, max).end };
}

// The walk. Returns { tokens, hidden, spans }: tokens are the start and end tags read at markup level, in order (kind, name, index, nameEnd, end, unread, and for a
// data element raw: { close, closeEnd }); hidden lists the data bodies that never end ({ kind, index }); spans lists every skipped region ({ kind, start, end }), so a caller
// can blank comments and script or style bodies. The walk continues after an unclosed body and after an unread tag, so a finding never hides the markup after it.
function walkPage(s, max) {
  const tokens = [], hidden = [], spans = [];
  const shut = new Set();
  let i = 0;
  for (;;) {
    i = s.indexOf('<', i);
    if (i < 0) break;
    if (s.startsWith('<!--', i)) {
      const e = commentEnd(s, i);
      if (e < 0) { hidden.push({ kind: 'comment', index: i }); spans.push({ kind: 'comment', start: i, end: s.length }); i += 4; }
      else { spans.push({ kind: 'comment', start: i, end: e }); i = e; }
      continue;
    }
    const c = s.charAt(i + 1);
    if (c === '/') {
      if (!ASCII_LETTER.test(s.charAt(i + 2))) { i = bogusEnd(s, i); continue; }
      const nameEnd = nameEndAt(s, i + 2, max);
      const end = nameEnd < 0 ? -1 : scanStartTag(s, nameEnd, max).end;
      tokens.push({ kind: 'end', name: nameEnd < 0 ? null : s.slice(i + 2, nameEnd).toLowerCase(), index: i, end, unread: end < 0 });
      i = end < 0 ? i + 2 : end;
      continue;
    }
    if (ASCII_LETTER.test(c)) {
      const nameEnd = nameEndAt(s, i + 1, max);
      if (nameEnd < 0) { tokens.push({ kind: 'start', name: null, index: i, nameEnd: -1, end: -1, unread: true, raw: null }); i += 1; continue; }
      const name = s.slice(i + 1, nameEnd).toLowerCase();
      const end = scanStartTag(s, nameEnd, max).end;
      const tok = { kind: 'start', name, index: i, nameEnd, end, unread: end < 0, raw: null };
      tokens.push(tok);
      if (end < 0) { i += 1; continue; }
      if (DATA_ELEMENT.has(name)) {
        const raw = name === 'plaintext' ? { close: -1, closeEnd: -1 } : bodyEnd(s, name, end, max, shut);
        tok.raw = raw;
        if (raw.close < 0) {
          // A script or a style with no end is reported by the element scans as an element with no closer; every other data body is reported here.
          if (name !== 'script' && name !== 'style') hidden.push({ kind: name, index: i });
          spans.push({ kind: name, start: i, end: s.length });
          i = end;
          continue;
        }
        spans.push({ kind: name, start: i, end: raw.closeEnd < 0 ? raw.close : raw.closeEnd });
        tokens.push({ kind: 'end', name, index: raw.close, end: raw.closeEnd, unread: raw.closeEnd < 0 });
        i = raw.closeEnd < 0 ? raw.close + 2 : raw.closeEnd;
        continue;
      }
      i = end;
      continue;
    }
    if (c === '!' || c === '?') { i = bogusEnd(s, i); continue; }
    i += 1;
  }
  return { tokens, hidden, spans };
}

// One walk per page string: the rules ask for start tags, elements and tag counts of the same page, and each answer reads the same walk.
let lastWalk = { s: null, max: 0, walk: null };
function walk(s, max) {
  if (lastWalk.s !== s || lastWalk.max !== max) lastWalk = { s, max, walk: walkPage(s, max) };
  return lastWalk.walk;
}

// A pattern for the walk: the same expression as the caller's, sticky, so it matches at one token's index only.
const stickyOf = re => new RegExp(re.source, re.flags.replace(/[gy]/g, '') + 'y');
// Whether the caller's pattern opens the start tag t: it matches at t's index, and its group 1, when present, is the tag's whole name, as the tokenizer reads it.
function matchesAt(sticky, s, t) {
  sticky.lastIndex = t.index;
  const m = sticky.exec(s);
  if (!m) return false;
  return m[1] === undefined || t.name === null || m[1].toLowerCase() === t.name;
}
// The index of the first token at or after position k whose index is at or after `pos`.
function skipPast(tokens, k, pos) { while (k < tokens.length && tokens[k].index < pos) k++; return k; }

// Every start tag that the pattern `re` opens at markup level, in order, each read to its end. `re` matches the opening `<name`; its group 1, when present, is the tag's name
// as written, and must be the tag's whole name. Returns { tags: [{ text, index, end, name, attrs }], unread: [index], hidden: [{ kind, index }] }. A tag the reader cannot end
// goes to `unread`, and the scan goes on after its opener.
export function startTagsOf(s, re, max = META_MAX) {
  const { tokens, hidden } = walk(s, max);
  const sticky = stickyOf(re);
  const tags = [], unread = [];
  for (const t of tokens) {
    if (t.kind !== 'start' || !matchesAt(sticky, s, t)) continue;
    if (t.unread) { unread.push(t.index); continue; }
    tags.push({ text: s.slice(t.index, t.end), index: t.index, end: t.end, name: s.slice(t.index + 1, t.nameEnd), attrs: scanStartTag(s, t.nameEnd, max, true).attrs });
  }
  return { tags, unread, hidden };
}

// The elements the pattern `re` opens (as startTagsOf, the name in group 1), each with its body: the body runs from the end of the start tag to the end tag `</name` of its own
// name at markup level, and the scan goes on after that end tag, so a body is never read as tags. A data element (script, style and the rest of DATA_ELEMENT) has its body from the walk.
// Returns { elements: [{ tag, body, close, closeEnd }], unclosed: [index], unread: [index], hidden: [{ kind, index }] }: `unclosed` holds the openers with no closer, and `unread`
// the tags the reader could not end (a start tag, or a closer whose end tag is unread).
export function elementsOf(s, re, max = META_MAX) {
  const { tokens, hidden } = walk(s, max);
  const sticky = stickyOf(re);
  const elements = [], unclosed = [], unread = [];
  const ends = new Map();
  for (const t of tokens) if (t.kind === 'end' && t.name !== null) { let l = ends.get(t.name); if (!l) ends.set(t.name, l = []); l.push(t); }
  const ptr = new Map();
  for (let k = 0; k < tokens.length;) {
    const t = tokens[k];
    if (t.kind !== 'start' || !matchesAt(sticky, s, t)) { k++; continue; }
    if (t.unread) { unread.push(t.index); k++; continue; }
    const tag = { text: s.slice(t.index, t.end), index: t.index, end: t.end, name: s.slice(t.index + 1, t.nameEnd), attrs: scanStartTag(s, t.nameEnd, max, true).attrs };
    if (t.raw) {
      if (t.raw.close < 0) { unclosed.push(t.index); k++; continue; }
      if (t.raw.closeEnd < 0) { unread.push(t.raw.close); unclosed.push(t.index); k++; continue; }
      elements.push({ tag, body: s.slice(t.end, t.raw.close), close: t.raw.close, closeEnd: t.raw.closeEnd });
      k = skipPast(tokens, k + 1, t.raw.closeEnd);
      continue;
    }
    const list = ends.get(t.name) || [];
    let p = ptr.get(t.name) || 0;
    while (p < list.length && list[p].index < t.end) p++;
    ptr.set(t.name, p);
    if (p === list.length) { unclosed.push(t.index); k++; continue; }
    const c = list[p];
    if (c.unread) { unread.push(c.index); unclosed.push(t.index); k++; continue; }
    elements.push({ tag, body: s.slice(t.end, c.index), close: c.index, closeEnd: c.end });
    k = skipPast(tokens, k + 1, c.end);
  }
  return { elements, unclosed, unread, hidden };
}

// The start and end tags of each named element, read at markup level: counts[name] = { opens, closes }. Text, comments and data bodies count for nothing.
// The balance rule of the rule 5 block reads this, so a `<a` in a script string is not an opener.
export function tagCountsOf(s, names, max = META_MAX) {
  const { tokens, hidden } = walk(s, max);
  const counts = new Map(names.map(n => [n, { opens: 0, closes: 0 }]));
  for (const t of tokens) {
    const c = t.name !== null && counts.get(t.name);
    if (c) c[t.kind === 'start' ? 'opens' : 'closes']++;
  }
  return { counts, hidden };
}

// Every region the walk skips: comments and data bodies, each with its kind and its whole range (the start tag through the end tag, or through the input's end when the body
// is unclosed). A caller that must not read text inside them (rule 19's visible-text check) blanks these ranges.
export function dataSpansOf(s, max = META_MAX) { return walk(s, max).spans; }

// Every meta tag of the page in order, with its start; a tag that does not end within META_MAX characters goes to `unread` (its start), so a caller can fail on it.
const META_START = /<(meta)\b/gi;
export function metaTagsOf(s) {
  const { tags, unread, hidden } = startTagsOf(s, META_START);
  return { tags: tags.map(t => ({ text: t.text, index: t.index })), unread, hidden };
}
// The attribute NAME must be the whole name (`data-content`, `data-name` and `x-content` are not it), and the `name` value exactly `robots`, not a longer token that starts with it.
const ROBOTS_NAME = /(?<![\w-])name\s*=\s*(?:"\s*robots\s*"|'\s*robots\s*'|robots(?![\w-]))/i;
const NOINDEX_CONTENT = /(?<![\w-])content\s*=\s*(?:"[^"]*\b(?:noindex|none)\b[^"]*"|'[^']*\b(?:noindex|none)\b[^']*'|[^\s"'>]*\b(?:noindex|none)\b)/i;
// The browser reads an attribute value with its numeric character references decoded, so `content="&#110;oindex"` is `noindex`. No named reference spells a letter
// of `robots`, `noindex` or `none`, so the numeric forms are the only ones decoded here. Any number of digits is read, leading zeros included, as the tokenizer reads them; zero,
// a surrogate and a value past U+10FFFF are U+FFFD, as the tokenizer maps them.
const REPLACEMENT = String.fromCharCode(0xFFFD);
const decodeNumeric = tag => tag.replace(/&#(?:[xX]([0-9a-fA-F]+)|([0-9]+));?/g, (m, hex, dec) => {
  const cp = hex !== undefined ? parseInt(hex, 16) : parseInt(dec, 10);
  return cp === 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF) ? REPLACEMENT : String.fromCodePoint(cp);
});
export const isRobotsNoindex = tag => { const t = decodeNumeric(tag); return ROBOTS_NAME.test(t) && NOINDEX_CONTENT.test(t); };

// ── the pins of rule 15 ──────────────────────────────────────────────────────────────────────────
export const normText = html => html.split('<').map((part, i) => (i === 0 ? part : part.slice(part.indexOf('>') + 1))).join('').replace(/\s+/g, ' ').trim();
export const passageFp = html => createHash('sha256').update(normText(html), 'utf8').digest('hex').slice(0, 16);
// The `<p class="t">` and `<li class="t">` passages of a rendered legal page, in order, each with the fingerprint of its text. One pass: an opening tag is read to its `>` within OPEN_MAX characters, and a
// passage with no closing tag after it ends the scan for that tag name (no later passage of that name can close either), so a page of unclosed passages costs one search each, not one per start.
const OPEN_MAX = 512;
const OPEN_TAG = /<(p|li) class="t"/g;
export function passagesOf(s) {
  const out = [], shut = new Set();
  const closeAt = {}; // the last closer found per tag name: a closer is searched for once, never again from a later opener
  OPEN_TAG.lastIndex = 0;
  for (let m; (m = OPEN_TAG.exec(s)); ) {
    const name = m[1];
    if (shut.has(name)) continue;
    const at = m.index + m[0].length; // the > is looked for in a window of OPEN_MAX characters, so an opener costs a bounded scan
    const g = s.slice(at, m.index + OPEN_MAX).indexOf('>');
    if (g === -1) continue;
    const gt = at + g;
    if (!(closeAt[name] >= gt + 1)) closeAt[name] = s.indexOf('</' + name + '>', gt + 1);
    const close = closeAt[name];
    if (close === -1) { shut.add(name); continue; }
    const end = close + name.length + 3;
    out.push({ start: m.index, end, fp: passageFp(s.slice(gt + 1, close)) });
    OPEN_TAG.lastIndex = end;
  }
  return out;
}
// A function from a character index of the page text s to whether a pin excuses a hit there. A pin is { file, fp, count }: it excuses a hit inside the passage with that fingerprint only while the page holds exactly
// count copies of the passage (a pinned passage pasted again excuses none of them). The passages are read once per page and each hit finds its passage by binary search.
export function pinnedHitter(file, s, pins) {
  const ps = passagesOf(s);
  const copies = new Map();
  for (const p of ps) copies.set(p.fp, (copies.get(p.fp) || 0) + 1);
  const excused = new Set(pins.filter(q => q.file === file && copies.get(q.fp) === q.count).map(q => q.fp));
  return index => {
    if (excused.size === 0) return false;
    let lo = 0, hi = ps.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (index < ps[mid].start) hi = mid - 1; else if (index >= ps[mid].end) lo = mid + 1; else return excused.has(ps[mid].fp); }
    return false;
  };
}
