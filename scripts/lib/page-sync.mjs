// The build-time sync of the shared blocks into the hand-kept pages (web/index.html, web/pricing.html, web/404.html), and of the style-src hashes of
// web/_headers. scripts/legal-pages.mjs is the only caller: `--write` replaces what sits between each block's markers, `--check` compares it.
//
// A BLOCK is { name, begin, end, label, shared, render }, the shape of SYNC_BLOCKS in scripts/lib/legal-render.mjs (the one place the marker
// names are written). A block's text is the begin marker, a line break, the render and a line break, the end marker: inner(render) is what sits
// between the two markers, so the markers stay where the page keeps them and nothing else about the page is the sync's business.
//
// All text here is LF. The caller splits a page's line endings off with eolOf and puts them back, so a CRLF checkout stays CRLF.
//
// Stated limits: a marker is found by its exact text, so a marker copied inside another block's contents would be read as that block's own;
// the sync does not parse HTML or CSS, and it refuses (never guesses) a page whose markers are missing, doubled or out of order.
import { inlineStyles, cspHash } from './csp-hashes.mjs';
import { parseHeadersFile, declarations } from './headers-file.mjs';

const count = (text, s) => text.split(s).length - 1;

// What sits between a block's markers for a given render: an empty render leaves one line break.
export const inner = rendered => '\n' + (rendered ? rendered + '\n' : '');

// The line endings of a page: its text as LF, and whether to put CRLF back. A page with both kinds is refused by the caller (mixed).
export function eolOf(raw) {
  const text = raw.replace(/\r\n/g, '\n');
  const crlf = raw.includes('\r\n');
  const mixed = crlf && /(^|[^\r])\n/.test(raw);
  return { text, crlf, mixed };
}
export const withEol = (text, crlf) => (crlf ? text.replace(/\n/g, '\r\n') : text);

// Where a block sits in a page's text: { from, to } (the text between the markers), or { problem }.
export function locate(text, block) {
  const b = count(text, block.begin), e = count(text, block.end);
  if (b === 0 && e === 0) return { problem: `both markers are missing (${block.begin} and ${block.end})` };
  if (b === 0) return { problem: `the begin marker ${block.begin} is missing` };
  if (e === 0) return { problem: `the end marker ${block.end} is missing` };
  if (b > 1 || e > 1) return { problem: `a marker is doubled (${b} begin, ${e} end: ${block.begin} ... ${block.end})` };
  const i = text.indexOf(block.begin), j = text.indexOf(block.end);
  if (j < i + block.begin.length) return { problem: `the end marker comes before the begin marker (${block.end} ... ${block.begin})` };
  return { from: i + block.begin.length, to: j };
}

// What each block of a page holds against its render: [{ block, problem } | { block, have, want, same }].
export function inspect(text, blocks) {
  return blocks.map(block => {
    const at = locate(text, block);
    if (at.problem) return { block, problem: at.problem };
    const have = text.slice(at.from, at.to), want = inner(block.render());
    return { block, have, want, same: have === want };
  });
}

// The page with every block's contents replaced by its render. Writes nothing, and returns the problems instead of a page when any marker is
// wrong: { text, problems: [{ block, problem }], changed: [label of each block whose contents moved] }.
export function sync(text, blocks) {
  const problems = [], changed = [];
  let out = text;
  for (const block of blocks) {
    const at = locate(out, block);
    if (at.problem) { problems.push({ block, problem: at.problem }); continue; }
    const want = inner(block.render());
    if (out.slice(at.from, at.to) !== want) { changed.push(block.label); out = out.slice(0, at.from) + want + out.slice(at.to); }
  }
  return { text: problems.length ? text : out, problems, changed };
}

// ── the style-src hashes of web/_headers ────────────────────────────────────────────────────────────
// The hash of every inline <style> block of a page, in document order (a page with a <noscript><style> has two).
export const styleHashes = html => inlineStyles(html).map(cspHash);

// The whole directive name: style-src-elem and style-src-attr are other directives that begin with the same letters.
const STYLE_SRC = /(?<![\w-])style-src(?![\w-])((?:[ \t]+[^;\s]+)*)/;

// The line of the one Content-Security-Policy declaration, or { problem }.
function cspLineOf(headersText) {
  const d = declarations(parseHeadersFile(headersText), 'Content-Security-Policy');
  if (d.length !== 1) return { problem: `declares ${d.length} Content-Security-Policy headers, expected 1` };
  const line = headersText.split('\n')[d[0].line - 1];
  const m = STYLE_SRC.exec(line);
  if (!m) return { problem: 'its Content-Security-Policy has no style-src directive' };
  return { no: d[0].line, line, tokens: m[1].split(/\s+/).filter(Boolean) };
}

// Problems between the pages and the style-src of _headers, as named lines. pages: { 'web/x.html': html } with every page the site serves.
export function hashProblems(pages, headersText) {
  const at = cspLineOf(headersText);
  if (at.problem) return ['web/_headers ' + at.problem];
  const want = new Map();
  for (const [file, html] of Object.entries(pages)) styleHashes(html).forEach((h, i) => { if (!want.has(h)) want.set(h, `the <style> block of ${file}${i ? ` (block ${i + 1})` : ''}`); });
  const have = new Set(at.tokens.filter(t => t.startsWith("'sha256-")));
  const out = [];
  for (const [h, from] of want) if (!have.has(h)) out.push(`web/_headers style-src does not admit ${h.slice(1, -1)} (${from}), so the browser would refuse that block`);
  for (const h of have) if (!want.has(h)) out.push(`web/_headers style-src admits ${h.slice(1, -1)}, which no <style> block of the pages matches (a stale hash)`);
  return out;
}

// The new text of _headers once the pages have moved from `pre` to `post` (both { file: [hash per style block] }): a hash no page carries any
// more is replaced, in its place, by the hash its block moved to, or dropped when none did; a hash a page now needs is appended. The rest of
// the file, the rest of the line and every other directive are kept byte for byte. Returns { text, replaced, removed, added } or { problem }.
export function planStyleSrc(headersText, pre, post) {
  const at = cspLineOf(headersText);
  if (at.problem) return { problem: 'web/_headers ' + at.problem };
  const want = new Set(Object.values(post).flat());
  const moved = new Map();
  for (const [file, hashes] of Object.entries(post)) (pre[file] || []).forEach((h, i) => { if (hashes[i] && hashes[i] !== h) moved.set(h, [...(moved.get(h) || []), hashes[i]]); });
  const out = [], seen = new Set();
  const push = t => { if (!seen.has(t)) { seen.add(t); out.push(t); } };
  let replaced = 0, removed = 0, added = 0;
  for (const t of at.tokens) {
    if (!t.startsWith("'sha256-") || want.has(t)) { push(t); continue; }
    const to = (moved.get(t) || []).filter(n => want.has(n));
    if (to.length) { replaced++; to.forEach(push); } else removed++;
  }
  for (const h of want) if (!seen.has(h)) { push(h); added++; }
  const lines = headersText.split('\n');
  lines[at.no - 1] = at.line.replace(STYLE_SRC, () => 'style-src ' + out.join(' '));
  return { text: lines.join('\n'), replaced, removed, added };
}
