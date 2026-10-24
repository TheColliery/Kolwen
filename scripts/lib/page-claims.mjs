// The page readers behind surface-check rules 15 (the dropped "no trackers" claim, LWK-273) and 16 (no robots noindex on a production page, LWK-271). Node builtins only.
//
// Why a library: the two rules lived inline in scripts/surface-check.mjs as regular expressions that were super-linear on a page a stranger could write or a tool could break: a `<meta` with an
// unterminated quote, repeated n times, took 30 s at n = 40,000 (every start re-scanned to the end of the file), and the pin check re-read every passage of the page for every hit (11 s at 2,000
// passages with a hit each). Here both are single passes, and scripts/page-claims.test.mjs runs them on bulk input in a child under a kill timeout.
import { createHash } from 'node:crypto';

// A meta tag is read from its `<meta` to the first `>` that the HTML tokenizer reads as the end of the start tag, at most META_MAX characters: a `>` inside a quoted attribute value does not end it. A tag that
// does not end inside the cap (an unclosed quote, a missing `>`, or plain length) is reported as UNREAD, and the caller fails on it: a page whose meta tags cannot be read is not proven free of a noindex.
// Each start costs at most META_MAX, so the whole page is linear.
export const META_MAX = 4096;
const META_START = /<meta\b/gi;
const DQ = 34, SQ = 39, GT = 62, SLASH = 47, EQ = 61; // " ' > / =
// The attribute states of the HTML tokenizer (WHATWG HTML §13.2.5.32 to §13.2.5.39), as far as they decide where a start tag ends. Only the two quoted-value states read a > as text.
const BEFORE_NAME = 0, NAME = 1, AFTER_NAME = 2, BEFORE_VALUE = 3, DQ_VALUE = 4, SQ_VALUE = 5, UNQUOTED = 6, AFTER_VALUE = 7;
// The index after the `>` that ends the tag starting at `at`, or -1 when no such `>` comes within META_MAX characters. One character at a time, so a start costs at most META_MAX steps.
// A quote opens a value only in the before-value state, right after the `=` of an attribute: a quote inside a name, or inside an unquoted value, is a plain character, as the tokenizer reads it.
function tagEnd(s, at) {
  const stop = Math.min(s.length, at + META_MAX);
  let state = BEFORE_NAME;
  for (let i = at + 5; i < stop; i++) {
    const c = s.charCodeAt(i), space = c === 32 || c === 9 || c === 10 || c === 12 || c === 13; // the HTML white space: space, tab, LF, form feed, CR
    switch (state) {
      case BEFORE_NAME: if (c === GT) return i + 1; if (!space && c !== SLASH) state = NAME; break;
      case NAME:
        if (c === GT) return i + 1;
        if (c === EQ) state = BEFORE_VALUE;
        else if (space) state = AFTER_NAME;
        else if (c === SLASH) state = BEFORE_NAME;
        break;
      case AFTER_NAME:
        if (c === GT) return i + 1;
        if (c === EQ) state = BEFORE_VALUE;
        else if (c === SLASH) state = BEFORE_NAME;
        else if (!space) state = NAME;
        break;
      case BEFORE_VALUE:
        if (c === GT) return i + 1;
        if (c === DQ) state = DQ_VALUE;
        else if (c === SQ) state = SQ_VALUE;
        else if (!space) state = UNQUOTED;
        break;
      case DQ_VALUE: if (c === DQ) state = AFTER_VALUE; break;
      case SQ_VALUE: if (c === SQ) state = AFTER_VALUE; break;
      case UNQUOTED:
        if (c === GT) return i + 1;
        if (space) state = BEFORE_NAME;
        break;
      case AFTER_VALUE:
        if (c === GT) return i + 1;
        if (space || c === SLASH) state = BEFORE_NAME;
        else state = NAME;
        break;
    }
  }
  return -1;
}
// Every meta tag of the page in order, with its start; a tag that does not end within META_MAX characters goes to `unread` (its start), so a caller can fail on it.
export function metaTagsOf(s) {
  const tags = [], unread = [];
  META_START.lastIndex = 0;
  for (let m; (m = META_START.exec(s)); ) {
    const end = tagEnd(s, m.index);
    if (end === -1) { unread.push(m.index); continue; }
    tags.push({ text: s.slice(m.index, end), index: m.index });
    META_START.lastIndex = end;
  }
  return { tags, unread };
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
