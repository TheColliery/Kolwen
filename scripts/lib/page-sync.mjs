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

// Where a block sits in a page's text: { from, to } (the text between the markers) and { start, stop } (the whole fenced block, markers
// included), or { problem }.
export function locate(text, block) {
  const b = count(text, block.begin), e = count(text, block.end);
  if (b === 0 && e === 0) return { problem: `both markers are missing (${block.begin} and ${block.end})` };
  if (b === 0) return { problem: `the begin marker ${block.begin} is missing` };
  if (e === 0) return { problem: `the end marker ${block.end} is missing` };
  if (b > 1 || e > 1) return { problem: `a marker is doubled (${b} begin, ${e} end: ${block.begin} ... ${block.end})` };
  const i = text.indexOf(block.begin), j = text.indexOf(block.end);
  if (j < i + block.begin.length) return { problem: `the end marker comes before the begin marker (${block.end} ... ${block.begin})` };
  return { from: i + block.begin.length, to: j, start: i, stop: j + block.end.length };
}

// EVERY block located on the ORIGINAL text, before anything is replaced, and the blocks checked against each other. `blocks` is in the one expected
// document order (SYNC_BLOCKS in scripts/lib/legal-render.mjs). Two pairs that overlap or nest across each other, or that do not stand in that
// order, are problems, never guessed at: a replacement made while another pair's markers sit inside its range would delete them.
// Returns [{ block, problem } | { block, at }] in the order of `blocks`.
export function locateAll(text, blocks) {
  const found = blocks.map(block => ({ block, at: locate(text, block) }));
  const bad = new Set(found.filter(f => f.at.problem).map(f => f.block));
  const good = found.filter(f => !f.at.problem);
  const problem = new Map(found.filter(f => f.at.problem).map(f => [f.block, f.at.problem]));
  const names = blocks.map(b => b.label).join(', ');
  for (let i = 0; i < good.length; i++) {
    for (let j = i + 1; j < good.length; j++) {
      const a = good[i], b = good[j];
      const cross = a.at.start < b.at.stop && b.at.start < a.at.stop;
      if (cross) {
        const how = (a.at.start < b.at.start && b.at.stop < a.at.stop) || (b.at.start < a.at.start && a.at.stop < b.at.stop) ? 'nest' : 'overlap';
        for (const [x, y] of [[a, b], [b, a]]) { bad.add(x.block); if (!problem.has(x.block)) problem.set(x.block, `its markers and the ${y.block.label} markers ${how} across each other (${x.block.begin} ... ${x.block.end} against ${y.block.begin} ... ${y.block.end})`); }
      }
    }
  }
  // Order, among the pairs that are whole and do not cross: each must stand after the one before it in the expected order.
  const clean = good.filter(f => !bad.has(f.block));
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].at.start < clean[i - 1].at.start) {
      bad.add(clean[i].block);
      problem.set(clean[i].block, `the ${clean[i].block.label} block stands before the ${clean[i - 1].block.label} block, out of the expected document order (${names})`);
    }
  }
  return found.map(f => (bad.has(f.block) ? { block: f.block, problem: problem.get(f.block) } : f));
}

// What each block of a page holds against its render: [{ block, problem } | { block, have, want, same }].
export function inspect(text, blocks) {
  return locateAll(text, blocks).map(r => {
    if (r.problem) return r;
    const have = text.slice(r.at.from, r.at.to), want = inner(r.block.render());
    return { block: r.block, have, want, same: have === want };
  });
}

// The page with every block's contents replaced by its render. Every pair is located on the original text first; the replacements then run from
// the end of the page backward, so none of them moves a position another one still needs. Writes nothing, and returns the problems instead of a
// page when any marker is wrong: { text, problems: [{ block, problem }], changed: [label of each block whose contents moved, in page order] }.
export function sync(text, blocks) {
  const all = locateAll(text, blocks);
  const problems = all.filter(r => r.problem).map(r => ({ block: r.block, problem: r.problem }));
  if (problems.length) return { text, problems, changed: [] };
  const changed = [];
  let out = text;
  for (const r of [...all].sort((a, b) => b.at.from - a.at.from)) {
    const want = inner(r.block.render());
    if (text.slice(r.at.from, r.at.to) !== want) { changed.unshift(r.block.label); out = out.slice(0, r.at.from) + want + out.slice(r.at.to); }
  }
  return { text: out, problems, changed };
}

// ── the style-src hashes of web/_headers ────────────────────────────────────────────────────────────
// The hash of every inline <style> block of a page, in document order (a page with a <noscript><style> has two).
export const styleHashes = html => inlineStyles(html).map(cspHash);

// The one Content-Security-Policy declaration of _headers, read by DIRECTIVE: the value is split at ";" and a directive is found by its NAME at the
// start of a part (after trimming), never by searching the line, so "style-src" inside a source URL of another directive, or as the start of
// style-src-elem, is not the style-src directive. Returns { no, line, head, parts, at, tokens, elem, cr } or { problem }.
//   at = index of the style-src part, tokens = its sources, elem = the sources of style-src-elem (null when there is none).
function cspLineOf(headersText) {
  const d = declarations(parseHeadersFile(headersText), 'Content-Security-Policy');
  if (d.length !== 1) return { problem: `declares ${d.length} Content-Security-Policy headers, expected 1` };
  const line = headersText.split('\n')[d[0].line - 1];
  const m = /^(\s*Content-Security-Policy:)([^\r]*)(\r?)$/i.exec(line);
  if (!m) return { problem: 'has a Content-Security-Policy line this sync cannot read' };
  const parts = m[2].split(';');
  const nameOf = part => part.trim().split(/\s+/)[0].toLowerCase();
  const sourcesOf = part => part.trim().split(/\s+/).slice(1);
  const at = parts.findIndex(p => nameOf(p) === 'style-src');
  if (at < 0) return { problem: 'its Content-Security-Policy has no style-src directive' };
  const e = parts.findIndex(p => nameOf(p) === 'style-src-elem');
  return { no: d[0].line, line, head: m[1], parts, at, tokens: sourcesOf(parts[at]), elem: e < 0 ? null : sourcesOf(parts[e]), cr: m[3] };
}

// Problems between the pages and the policy of _headers, as named lines. pages: { 'web/x.html': html } with every page the site serves.
// style-src is the directive the sync owns (--write keeps its hashes exact, so a missing and a stale hash are both problems). A browser applies
// style-src-elem to <style> blocks when the policy has one (CSP3: it falls back to style-src, then default-src, only when absent), so when it is
// present it must admit every hash too; --write never edits it, so a hash it lacks is a problem named here and fixed by hand.
export function hashProblems(pages, headersText) {
  const at = cspLineOf(headersText);
  if (at.problem) return ['web/_headers ' + at.problem];
  const want = new Map();
  for (const [file, html] of Object.entries(pages)) styleHashes(html).forEach((h, i) => { if (!want.has(h)) want.set(h, `the <style> block of ${file}${i ? ` (block ${i + 1})` : ''}`); });
  const have = new Set(at.tokens.filter(t => t.startsWith("'sha256-")));
  const out = [];
  for (const [h, from] of want) if (!have.has(h)) out.push(`web/_headers style-src does not admit ${h.slice(1, -1)} (${from}), so the browser would refuse that block`);
  for (const h of have) if (!want.has(h)) out.push(`web/_headers style-src admits ${h.slice(1, -1)}, which no <style> block of the pages matches (a stale hash)`);
  if (at.elem) for (const [h, from] of want) if (!at.elem.includes(h)) out.push(`web/_headers style-src-elem does not admit ${h.slice(1, -1)} (${from}); the browser applies style-src-elem, not style-src, to <style> blocks, and --write never edits it, so add the hash to it by hand`);
  return out;
}

// The new text of _headers once the pages have moved from `pre` to `post` (both { file: [hash per style block] }): a hash no page carries any
// more is replaced, in its place, by the hash its block moved to, or dropped when none did; a hash a page now needs is appended. Only the
// style-src part of the policy changes: the rest of the file, the rest of the line and every other directive (style-src-elem included) are kept
// byte for byte. Returns { text, replaced, removed, added } or { problem }.
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
  const old = at.parts[at.at];
  const lead = /^\s*/.exec(old)[0], trail = /\s*$/.exec(old)[0];
  const parts = at.parts.slice();
  parts[at.at] = lead + 'style-src ' + out.join(' ') + trail;
  const lines = headersText.split('\n');
  lines[at.no - 1] = at.head + parts.join(';') + at.cr;
  return { text: lines.join('\n'), replaced, removed, added };
}
