#!/usr/bin/env node
// The transfer-size budget (web-build rule W-PERF-08): for each built page, the bytes of a cold load (the HTML plus every same-origin asset it loads, each counted as it is
// served, compressed) and the number of requests, against a ceiling derived from the CURRENT HTTP Archive Web Almanac median home page.
//
//   node scripts/page-weight.mjs                 measure every web/*.html and print one row per page; exit 1 when a page fails
//   node scripts/page-weight.mjs --web <dir>     measure another built tree (the tests use fixtures)
//   node scripts/page-weight.mjs --help          this text
//
// Verdicts, per metric (bytes, requests), the rule's own: at or below the median = PASS. Above the median is allowed = PASS with a note. Above TWICE the median = FAIL, unless the
// page is listed in DIVERGENCES below. The rule's exception, word for word: "above TWICE the median (2×) ships only when the page is already at its floor, the way a zip archive
// can shrink no further: every asset compressed, fonts subset, images in modern formats at the size shown, no unused code, and the change records what was tried and why nothing
// more can be cut without losing a function the page needs. A stated wish is not a floor." A listed page prints its divergence on every run, so it is never silent.
// Zero dependencies, node builtins only. Report problems at https://github.com/TheColliery/Kolwen/issues
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { join, dirname, resolve, extname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { facesOf, inRange } from './lib/font-coverage.mjs';
import { renderedChars } from './lib/rendered-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── THE MEDIAN. A measurement of other people's sites, not a number of ours: it is re-read from each new Almanac edition (the chapter page names the latest), never pinned
// as ours, and the edition, URL, quote and read date sit beside the values so the next reader can re-check them.
// Edition: HTTP Archive Web Almanac 2025, chapter "Page Weight", https://almanac.httparchive.org/en/2025/page-weight, published 2026-01-15 (updated 2026-01-16), the latest edition
// on the read date 2026-10-18. Read at the source by the Kolwen head; this file cites it and does not re-fetch it.
// Verbatim: "The median home page in 2025 was 2.86 MB on desktop and 2.56 MB on mobile." and "The median desktop home page makes 80 requests while its mobile counterpart makes 75."
// The ceiling uses the MOBILE figures, the tighter of the two. "MB" is read as 1,000,000 bytes because the sentence does not state the unit; the binary reading (1,048,576) would
// make the median 4.9% higher, so the decimal reading is also the tighter one. The sentence does not say whether its bytes are transfer (compressed) sizes: that is NOT claimed here;
// this check counts transfer bytes (see below) and compares them with that figure as read.
// Disagreement noted, not resolved: the chapter's own trend text gives 2,362 KB for July 2025, which disagrees with the headline sentence. The headline sentence is used.
export const ALMANAC = {
  edition: 'HTTP Archive Web Almanac 2025, Page Weight chapter',
  url: 'https://almanac.httparchive.org/en/2025/page-weight',
  published: '2026-01-15', readOn: '2026-10-18',
  quote: 'The median home page in 2025 was 2.86 MB on desktop and 2.56 MB on mobile.',
  requestsQuote: 'The median desktop home page makes 80 requests while its mobile counterpart makes 75.',
  medianBytes: 2_560_000,   // mobile, MB read as 1,000,000 bytes
  medianRequests: 75,       // mobile
};
export const CEILING_FACTOR = 2; // "above TWICE the median (2×)"

// ── HOW BYTES ARE COUNTED. Text files (html, css, js, svg, json, txt, xml) are brotli-compressed with node's zlib at BROTLI_QUALITY; woff2 and images are counted as their bytes (they are
// already compressed). Quality 5 is a stand-in for what Cloudflare serves: its dynamic Brotli level is not documented here, so the choice is unverified (check Cloudflare's
// compression documentation). Quality 5 compresses less than the highest quality, so it errs high; the sizes of this site sit far below the ceiling either way.
export const BROTLI_QUALITY = 5;
const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.json', '.txt', '.xml', '.md', '.webmanifest']);
export const NOT_COUNTED = 'Not counted: the Cloudflare Web Analytics beacon (a third-party script the edge injects, outside this repository), and anything else the edge adds.';

// ── NAMED DIVERGENCES. A page above TWICE the median ships only when it is at its floor, and then it is listed here with the row's own words and what was tried. Shape:
//   'index.html': {
//     bytes:    { floor: 'what is at its floor: every asset compressed, fonts subset, images modern at the size shown, no unused code', tried: 'what was tried and why nothing more can be cut without losing a function the page needs' },
//     requests: { floor: '...', tried: '...' },     // either key, or both
//   }
// An entry whose floor or tried is empty is a FAIL of its own (a stated wish is not a floor). No page of ours needs one today, so the table is empty.
export const DIVERGENCES = {};

const compress = bytes => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } }).length;
const servedBytes = (file, bytes) => (TEXT.has(extname(file).toLowerCase()) ? compress(bytes) : bytes.length);
const sameOrigin = u => Boolean(u) && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(u);
const strip = u => u.replace(/[?#].*$/, '');
const resolveUrl = (u, from) => (u.startsWith('/') ? posix.normalize(u) : posix.normalize(posix.join(posix.dirname(from), u)));

// The same-origin urls a stylesheet text names through url(), skipping data: and absolute urls. `from` is the url path of the file that names them.
function cssUrls(text, from) {
  const out = [];
  for (const m of text.matchAll(/url\(\s*(["']?)([^"')\s]+)\1\s*\)/gi)) if (sameOrigin(m[2])) out.push(resolveUrl(strip(m[2]), from));
  return out;
}

// The assets one page loads, as a Map url -> kind ('css' | 'font' | 'image' | 'script' | 'icon' | 'other'). Fonts are the faces of the linked stylesheets whose unicode-range covers a
// character the page renders (an over-approximation: every such face, whatever the cascade would pick). `cps` are the code points the page renders.
export function assetsOf(webDir, page, cps) {
  const html = readFileSync(join(webDir, page), 'utf8').replace(/\r\n/g, '\n');
  const pageUrl = '/' + page;
  const found = new Map();
  const add = (url, kind) => { if (!found.has(url)) found.set(url, kind); };
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (/\brel\s*=\s*"([^"]*)"/i.exec(m[0]) || [])[1] || '', href = (/\bhref\s*=\s*"([^"]*)"/i.exec(m[0]) || [])[1];
    if (!sameOrigin(href) || !/\b(?:stylesheet|icon|apple-touch-icon|preload|modulepreload)\b/i.test(rel)) continue;
    add(resolveUrl(strip(href), pageUrl), /stylesheet/i.test(rel) ? 'css' : /icon/i.test(rel) ? 'icon' : 'other');
  }
  for (const m of html.matchAll(/<(img|script|source|video|audio|iframe|embed)\b[^>]*\bsrc\s*=\s*"([^"]*)"[^>]*>/gi)) {
    if (sameOrigin(m[2])) add(resolveUrl(strip(m[2]), pageUrl), m[1].toLowerCase() === 'script' ? 'script' : 'image');
  }
  for (const m of html.matchAll(/<(?:img|source)\b[^>]*\bsrcset\s*=\s*"([^"]*)"[^>]*>/gi)) {
    for (const part of m[1].split(',')) { const u = part.trim().split(/\s+/)[0]; if (sameOrigin(u)) add(resolveUrl(strip(u), pageUrl), 'image'); }
  }
  const inline = (html.match(/<style\b[\s\S]*?<\/style>/gi) || []).join('\n') + '\n' + (html.match(/style="[^"]*"/gi) || []).join('\n');
  for (const u of cssUrls(inline, pageUrl)) add(u, 'image');
  // Linked stylesheets: their @font-face faces by unicode-range, and any other url() they load.
  for (const [url, kind] of [...found]) {
    if (kind !== 'css') continue;
    const file = join(webDir, url);
    if (!existsSync(file)) continue; // reported by measurePage as a missing asset
    const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const faceUrls = new Set();
    for (const f of facesOf(text)) {
      if (f.range && ![...cps].some(cp => inRange(cp, f.range))) continue;
      for (const u of f.urls) if (sameOrigin(u)) { const r = resolveUrl(strip(u), url); faceUrls.add(r); add(r, 'font'); }
    }
    for (const u of cssUrls(text.replace(/@font-face\s*\{[^}]*\}/g, ' '), url)) add(u, 'image');
  }
  return found;
}

// One page: its parts, total transfer bytes and request count (the HTML is one request).
export function measurePage(webDir, page, cps) {
  const parts = [{ url: '/' + page, kind: 'html', bytes: servedBytes(page, readFileSync(join(webDir, page))) }];
  for (const [url, kind] of assetsOf(webDir, page, cps)) {
    const file = join(webDir, url);
    if (!existsSync(file)) throw new Error(`${page}: loads ${url}, which is not in the built tree`);
    parts.push({ url, kind, bytes: servedBytes(url, readFileSync(file)) });
  }
  return { page, bytes: parts.reduce((n, p) => n + p.bytes, 0), requests: parts.length, parts };
}

// The verdict of one metric. `entry` is the page's divergence for that metric, if any. Returns { level: 'pass' | 'note' | 'diverged' | 'fail', text }.
export function metricVerdict(value, median, entry, label) {
  const ceiling = median * CEILING_FACTOR;
  if (value <= median) return { level: 'pass', text: '' };
  if (value <= ceiling) return { level: 'note', text: `${label} ${value} is above the median ${median}, allowed up to ${ceiling}` };
  if (!entry) return { level: 'fail', text: `${label} ${value} is above twice the median (${ceiling}) and the page is not a named divergence` };
  const bad = ['floor', 'tried'].filter(k => typeof entry[k] !== 'string' || entry[k].trim().length < 20);
  if (bad.length) return { level: 'fail', text: `${label} ${value} is above twice the median (${ceiling}) and its named divergence has no real ${bad.join(' and ')} text (a stated wish is not a floor)` };
  return { level: 'diverged', text: `${label} ${value} is above twice the median (${ceiling}): NAMED DIVERGENCE. At its floor: ${entry.floor.trim()} Tried: ${entry.tried.trim()}` };
}

// Every page of a built tree. `opts.divergences` replaces the table (tests), `opts.almanac` the median (tests).
export function checkTree(webDir, opts = {}) {
  const divergences = opts.divergences ?? DIVERGENCES, almanac = opts.almanac ?? ALMANAC;
  const rendered = renderedChars(webDir);
  const rows = [];
  for (const page of readdirSync(webDir).filter(f => f.endsWith('.html')).sort()) {
    const cps = [...rendered].filter(([, pages]) => pages.has('web/' + page)).map(([cp]) => cp);
    const m = measurePage(webDir, page, cps);
    const d = divergences[page] || {};
    const b = metricVerdict(m.bytes, almanac.medianBytes, d.bytes, 'transfer bytes'), r = metricVerdict(m.requests, almanac.medianRequests, d.requests, 'requests');
    const level = [b.level, r.level].includes('fail') ? 'fail' : [b.level, r.level].includes('diverged') ? 'diverged' : [b.level, r.level].includes('note') ? 'note' : 'pass';
    rows.push({ ...m, ratioBytes: m.bytes / almanac.medianBytes, ratioRequests: m.requests / almanac.medianRequests, level, notes: [b.text, r.text].filter(Boolean) });
  }
  return rows;
}

const WORD = { pass: 'PASS', note: 'PASS (above the median)', diverged: 'PASS (named divergence)', fail: 'FAIL' };
export function report(rows, almanac = ALMANAC) {
  const out = [];
  out.push(`Median home page (mobile), ${almanac.edition}, read ${almanac.readOn}: ${almanac.medianBytes} bytes, ${almanac.medianRequests} requests; ceiling ${CEILING_FACTOR}x = ${almanac.medianBytes * CEILING_FACTOR} bytes, ${almanac.medianRequests * CEILING_FACTOR} requests. Source: ${almanac.url}`);
  out.push(`Bytes are cold-load transfer bytes: text brotli-compressed at quality ${BROTLI_QUALITY}, fonts and images as their bytes.`);
  out.push('page | bytes | requests | x median bytes | x median requests | verdict');
  for (const r of rows) out.push(`${r.page} | ${r.bytes} | ${r.requests} | ${r.ratioBytes.toFixed(4)} | ${r.ratioRequests.toFixed(4)} | ${WORD[r.level]}`);
  for (const r of rows) for (const n of r.notes) out.push(`${r.page}: ${n}`);
  out.push(NOT_COUNTED);
  return out.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log('usage: node scripts/page-weight.mjs [--web <dir>]   (measures every *.html of the built tree against the Web Almanac median; exit 1 on a FAIL)'); return; }
  const unknown = args.filter((a, i) => a !== '--web' && args[i - 1] !== '--web');
  if (unknown.length) { console.error('unknown argument: ' + unknown.join(' ')); process.exitCode = 2; return; }
  const web = args.includes('--web') ? resolve(args[args.indexOf('--web') + 1] || '') : join(ROOT, 'web');
  let rows;
  try { rows = checkTree(web); } catch (e) { console.error('FAIL ' + e.message); process.exitCode = 1; return; }
  if (rows.length === 0) { console.error('FAIL no *.html page found in ' + web + ': an empty check is not a pass'); process.exitCode = 1; return; }
  console.log(report(rows));
  if (rows.some(r => r.level === 'fail')) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
