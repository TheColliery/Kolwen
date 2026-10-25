// The page readers behind surface-check rules 13 (the CSP), 15 (the dropped "no trackers" claim), 16 (no robots noindex on a production page) and 17 (the production claims), and the
// bounded readers they share. Node builtins only.
//
// Why a library: the rules lived inline in scripts/surface-check.mjs as regular expressions that were super-linear on a page a stranger could write or a tool could break: a `<meta` with an
// unterminated quote, repeated n times, took 30 s at n = 40,000 (every start re-scanned to the end of the file), and the pin check re-read every passage of the page for every hit (11 s at 2,000
// passages with a hit each). Here both are single passes, and scripts/page-claims.test.mjs runs them on bulk input in a child under a kill timeout.
//
// The shared start-tag reader: a start tag is read as the HTML tokenizer reads it, from its opener to the first `>` that ends it, within a bound. The tokenizer's tag NAME runs to white
// space, `/` or `>`, which can be longer than the name a caller's pattern matched, so the reader starts in that state (TAG_NAME) at the end of the caller's match. A tag the bound does not
// end is UNREAD, and a caller reports it: a page whose tags cannot be read is not proven, so a tag is never passed. An element's body is read with its closer searched ONCE per tag name, so an
// element with no closer costs one search, and the openers after it cost nothing more.
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

// Every start tag that the pattern `re` opens, in order, each read to its end. `re` matches the opening `<name`; its group 1, when present, is the tag's name as written.
// Returns { tags: [{ text, index, end, name, attrs }], unread: [index] }. A tag the reader cannot end goes to `unread`, and the scan goes on after its opener.
export function startTagsOf(s, re, max = META_MAX) {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const tags = [], unread = [];
  for (let m; (m = r.exec(s)); ) {
    const pos = m.index + m[0].length;
    const end = scanStartTag(s, pos, max).end;
    if (end === -1) { unread.push(m.index); continue; }
    tags.push({ text: s.slice(m.index, end), index: m.index, end, name: m[1], attrs: scanStartTag(s, pos, max, true).attrs });
    r.lastIndex = end;
  }
  return { tags, unread };
}

// The index of the first `</name` at or after `from` whose name ends there. The tokenizer's end tag name runs to white space, `/` or `>`, so `</a.x>` and `</a"x>` end another name
// and do not close `<a>`, and `</a` at the end of the input is not an end tag. The match is case-insensitive, as end tag names are.
function closerOf(s, name, from) {
  const re = new RegExp('</' + name + '(?=[\\t\\n\\f\\r />])', 'gi');
  re.lastIndex = from;
  const m = re.exec(s);
  return m ? m.index : -1;
}

// The elements the pattern `re` opens (as startTagsOf, the name in group 1), each with its body: the body runs from the end of the start tag to the closer `</name`, whose own end tag must be
// read within `max`, and the scan goes on after the closer, so a body is never read as tags. The closer of a name is searched ONCE and reused by each later opener whose body starts before it.
// An opener with no closer after it ends the search for that name (no later opener of the name can close either), so n unclosed openers cost one search per name, not n.
// Returns { elements: [{ tag, body, close, closeEnd }], unclosed: [index], unread: [index] }: `unclosed` holds the openers with no closer, and `unread` the tags the reader could not end (a start
// tag, or a closer whose end tag is unread).
export function elementsOf(s, re, max = META_MAX) {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const elements = [], unclosed = [], unread = [];
  const closeAt = new Map(), shut = new Set();
  for (let m; (m = r.exec(s)); ) {
    const name = (m[1] || '').toLowerCase();
    const pos = m.index + m[0].length;
    const end = scanStartTag(s, pos, max).end;
    if (end === -1) { unread.push(m.index); continue; }
    const tag = { text: s.slice(m.index, end), index: m.index, end, name: m[1], attrs: scanStartTag(s, pos, max, true).attrs };
    if (shut.has(name)) { unclosed.push(m.index); r.lastIndex = end; continue; }
    if (!(closeAt.get(name) >= end)) closeAt.set(name, closerOf(s, name, end));
    const c = closeAt.get(name);
    if (c === -1) { shut.add(name); unclosed.push(m.index); r.lastIndex = end; continue; }
    const ce = scanStartTag(s, c + 2 + name.length, max).end;
    if (ce === -1) { unread.push(c); unclosed.push(m.index); r.lastIndex = end; continue; }
    elements.push({ tag, body: s.slice(end, c), close: c, closeEnd: ce });
    r.lastIndex = ce;
  }
  return { elements, unclosed, unread };
}

// Every meta tag of the page in order, with its start; a tag that does not end within META_MAX characters goes to `unread` (its start), so a caller can fail on it.
const META_START = /<(meta)\b/gi;
export function metaTagsOf(s) {
  const { tags, unread } = startTagsOf(s, META_START);
  return { tags: tags.map(t => ({ text: t.text, index: t.index })), unread };
}
// The attribute NAME must be the whole name (`data-content`, `data-name` and `x-content` are not it), and the `name` value exactly `robots`, not a longer token that starts with it.
const ROBOTS_NAME = /(?<![\w-])name\s*=\s*(?:"\s*robots\s*"|'\s*robots\s*'|robots(?![\w-]))/i;
const NOINDEX_CONTENT = /(?<![\w-])content\s*=\s*(?:"[^"]*\b(?:noindex|none)\b[^"]*"|'[^']*\b(?:noindex|none)\b[^']*'|[^\s"'>]*\b(?:noindex|none)\b)/i;
export const isRobotsNoindex = tag => ROBOTS_NAME.test(tag) && NOINDEX_CONTENT.test(tag);

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
