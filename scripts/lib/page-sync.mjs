// The check of the shared blocks in the site pages (web/index.html, web/pricing.html, web/404.html, which are rendered from their templates), and the style-src and script-src hashes of
// web/_headers. scripts/legal-pages.mjs is the only caller: `--check` reads each block of a page against its render, to name the block that drifted (the whole page is compared there too), and
// `--write` plans the hashes of the pages it writes.
//
// A BLOCK is { name, begin, end, label, shared, render }, the shape of SYNC_BLOCKS in scripts/lib/legal-render.mjs (the one place the marker
// names are written). A block's text is the begin marker, a line break, the render and a line break, the end marker: inner(render) is what sits
// between the two markers.
//
// All text here is LF.
//
// Stated limits: a marker is found by its exact text, so a marker copied inside another block's contents would be read as that block's own;
// the reader does not parse HTML or CSS, and it names (never guesses) a page whose markers are missing, doubled, out of the order SYNC_BLOCKS gives, or in pairs that overlap or nest.
import { inlineStyles, inlineScripts, cspHash } from './csp-hashes.mjs';
import { parseHeadersFile, declarations } from './headers-file.mjs';

const count = (text, s) => text.split(s).length - 1;

// What sits between a block's markers for a given render: an empty render leaves one line break.
export const inner = rendered => '\n' + (rendered ? rendered + '\n' : '');

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

// ── the style-src hashes of web/_headers ────────────────────────────────────────────────────────────
// The hash of every inline <style> block of a page, in document order (a page with a <noscript><style> has two).
export const styleHashes = html => inlineStyles(html).map(cspHash);

// The hash of every inline executable <script> block of a page, in document order (a JSON data block such as ld+json is not code and has none).
export const scriptHashes = html => inlineScripts(html).map(cspHash);

// The two directives the sync keeps in step with the pages: <style> blocks are admitted by style-src, <script> blocks by script-src.
const KINDS = [
  { dir: 'style-src', noun: '<style> block', hashes: styleHashes },
  { dir: 'script-src', noun: '<script> block', hashes: scriptHashes },
];

// The one Content-Security-Policy declaration of _headers, read by DIRECTIVE: the value is split at ";" and a directive is found by its NAME at the
// start of a part (after trimming), never by searching the line, so "style-src" inside a source URL of another directive, or as the start of
// style-src-elem, is not the style-src directive. Returns { no, line, head, parts, at, tokens, elem, cr } or { problem }.
//   at = index of the part of directive `dir`, tokens = its sources, elem = the sources of `dir`-elem (null when there is none).
function cspLineOf(headersText, dir = 'style-src') {
  const d = declarations(parseHeadersFile(headersText), 'Content-Security-Policy');
  if (d.length !== 1) return { problem: `declares ${d.length} Content-Security-Policy headers, expected 1` };
  const line = headersText.split('\n')[d[0].line - 1];
  const m = /^(\s*Content-Security-Policy:)([^\r]*)(\r?)$/i.exec(line);
  if (!m) return { problem: 'has a Content-Security-Policy line this sync cannot read' };
  const parts = m[2].split(';');
  const nameOf = part => part.trim().split(/\s+/)[0].toLowerCase();
  const sourcesOf = part => part.trim().split(/\s+/).slice(1);
  const at = parts.findIndex(p => nameOf(p) === dir);
  if (at < 0) return { problem: `its Content-Security-Policy has no ${dir} directive` };
  const e = parts.findIndex(p => nameOf(p) === dir + '-elem');
  return { no: d[0].line, line, head: m[1], parts, at, tokens: sourcesOf(parts[at]), elem: e < 0 ? null : sourcesOf(parts[e]), cr: m[3] };
}

// Problems between the pages and the policy of _headers, as named lines. pages: { 'web/x.html': html } with every page the site serves.
// style-src and script-src are the directives the sync owns (--write keeps their hashes exact, so a missing and a stale hash are both problems). A browser
// applies style-src-elem to <style> blocks and script-src-elem to <script> blocks when the policy has one (CSP3: it falls back to the base directive, then
// default-src, only when absent), so when it is present it must admit every hash too; --write never edits it, so a hash it lacks is a problem named here
// and fixed by hand.
export function hashProblems(pages, headersText) {
  const out = [];
  for (const { dir, noun, hashes } of KINDS) {
    const at = cspLineOf(headersText, dir);
    if (at.problem) { out.push('web/_headers ' + at.problem); continue; }
    const want = new Map();
    for (const [file, html] of Object.entries(pages)) hashes(html).forEach((h, i) => { if (!want.has(h)) want.set(h, `the ${noun} of ${file}${i ? ` (block ${i + 1})` : ''}`); });
    const have = new Set(at.tokens.filter(t => t.startsWith("'sha256-")));
    for (const [h, from] of want) if (!have.has(h)) out.push(`web/_headers ${dir} does not admit ${h.slice(1, -1)} (${from}), so the browser would refuse that block`);
    for (const h of have) if (!want.has(h)) out.push(`web/_headers ${dir} admits ${h.slice(1, -1)}, which no ${noun} of the pages matches (a stale hash)`);
    if (at.elem) for (const [h, from] of want) if (!at.elem.includes(h)) out.push(`web/_headers ${dir}-elem does not admit ${h.slice(1, -1)} (${from}); the browser applies ${dir}-elem, not ${dir}, to ${noun}s, and --write never edits it, so add the hash to it by hand`);
  }
  return out;
}

// The new text of _headers once the pages have moved from `pre` to `post` (both { file: [hash per block] }) for directive `dir`: a hash no page carries any
// more is replaced, in its place, by the hash its block moved to, or dropped when none did; a hash a page now needs is appended. Only the `dir` part of the
// policy changes: the rest of the file, the rest of the line and every other directive (the -elem one included) are kept byte for byte.
// Returns { text, replaced, removed, added } or { problem }.
function planDirective(headersText, dir, pre, post) {
  const at = cspLineOf(headersText, dir);
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
  parts[at.at] = lead + dir + ' ' + out.join(' ') + trail;
  const lines = headersText.split('\n');
  lines[at.no - 1] = at.head + parts.join(';') + at.cr;
  return { text: lines.join('\n'), replaced, removed, added };
}
export const planStyleSrc = (headersText, pre, post) => planDirective(headersText, 'style-src', pre, post);
export const planScriptSrc = (headersText, pre, post) => planDirective(headersText, 'script-src', pre, post);
