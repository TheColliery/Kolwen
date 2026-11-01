#!/usr/bin/env node
// The transfer-size budget (web-build rule W-PERF-08): for each built page, the bytes of a cold load (the HTML plus every same-origin asset it loads, each counted as it is
// served, compressed) and the number of requests, against a ceiling derived from the CURRENT HTTP Archive Web Almanac median home page.
//
//   node scripts/page-weight.mjs                 measure every page of web/ (subfolders too) and print one row per page; exit 1 when a page fails
//   node scripts/page-weight.mjs --web <dir>     measure another built tree (the tests use fixtures)
//   node scripts/page-weight.mjs --help          this text
//
// Verdicts, per metric (bytes, requests), the rule's own: at or below the median = PASS. Above the median is allowed = PASS with a note. Above TWICE the median = FAIL, unless the
// page is listed in DIVERGENCES below. The rule's exception, word for word: "above TWICE the median (2×) ships only when the page is already at its floor, the way a zip archive
// can shrink no further: every asset compressed, fonts subset, images in modern formats at the size shown, no unused code, and the change records what was tried and why nothing
// more can be cut without losing a function the page needs. A stated wish is not a floor." A listed page prints its divergence on every run, so it is never silent.
// Zero dependencies, node builtins only. Report problems at https://github.com/TheColliery/Kolwen/issues
import { locate, readContained } from './lib/contained-read.mjs';
import { brotliCompressSync, constants } from 'node:zlib';
import { join, dirname, resolve, extname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { facesOf, inRange } from './lib/font-coverage.mjs';
import { renderedChars, stripCssComments, styleBlocksOf } from './lib/rendered-text.mjs';
import { htmlTokens } from './lib/html-tokens.mjs';
import { htmlPages } from './lib/web-files.mjs';
import { isMainModule } from './lib/entry-guard.mjs';

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
  for (const m of stripCssComments(text).matchAll(/url\(\s*(["']?)([^"')\s]+)\1\s*\)/gi)) if (sameOrigin(m[2])) out.push(resolveUrl(strip(m[2]), from));
  return out;
}

// The stylesheets an @import names (the string form or url(), with or without a space before it, and an optional media query), as url paths, and the text without its comments and its @import statements,
// so that a commented-out import loads nothing and an imported file is not also counted as an image by cssUrls.
const IMPORT = /@import\s*(?:url\(\s*(["']?)([^"')\s]+)\1\s*\)|(["'])([^"']+)\3)[^;{}]*;?/gi;
function importsOf(text, from) {
  const clean = stripCssComments(text);
  const urls = [];
  for (const m of clean.matchAll(IMPORT)) { const u = m[2] ?? m[4]; if (sameOrigin(u)) urls.push(resolveUrl(strip(u), from)); }
  return { urls, rest: clean.replace(IMPORT, ' ') };
}

// A file's read, once per real path, within one page's measure: a file under two urls, or read by the walk and again by the measure, is one read.
function bytesOf(webDir, url, cache) {
  const at = locate(webDir, url);
  if (at.file === undefined) return at;
  if (!cache.has(at.file)) cache.set(at.file, readContained(webDir, url));
  return cache.get(at.file);
}

// The assets one page loads, as a Map url -> kind ('css' | 'font' | 'image' | 'script' | 'icon' | 'other'). Fonts are the faces of the linked stylesheets whose unicode-range covers a
// character the page renders (an over-approximation: every such face, whatever the cascade would pick). `cps` are the code points the page renders.
export function assetsOf(webDir, page, cps, cache = new Map()) {
  const pageRead = bytesOf(webDir, page, cache);
  if (pageRead.file === undefined) throw new Error(page + ': ' + (pageRead.refused || 'is missing'));
  const html = pageRead.bytes.toString('utf8').replace(/\r\n/g, '\n');
  const pageUrl = '/' + page;
  const found = new Map();
  // A url named as a stylesheet by any link is a stylesheet, whatever kind it was first met as (a preload hint ahead of the link must not hide it).
  const add = (url, kind) => { if (!found.has(url) || (kind === 'css' && found.get(url) !== 'css')) found.set(url, kind); };
  const styleAttrs = [];
  for (const { name, attrs } of htmlTokens(html).filter(t => t.type === 'tag' && !t.closing)) { // the one scan: no tag from a script body, a comment or an attribute value
    if (attrs.has('style')) styleAttrs.push(attrs.get('style'));
    if (name === 'link') {
      const rel = (attrs.get('rel') || '').toLowerCase().split(/\s+/), href = attrs.get('href');
      const hint = rel.includes('preload') || rel.includes('modulepreload');
      if (!sameOrigin(href) || !(rel.includes('stylesheet') || hint || rel.some(t => t.includes('icon')))) continue;
      add(resolveUrl(strip(href), pageUrl), rel.includes('stylesheet') || (hint && (attrs.get('as') || '').toLowerCase() === 'style') ? 'css' : rel.some(t => t.includes('icon')) ? 'icon' : 'other');
    } else if (['img', 'script', 'source', 'video', 'audio', 'iframe', 'embed'].includes(name)) {
      const src = attrs.get('src');
      if (sameOrigin(src)) add(resolveUrl(strip(src), pageUrl), name === 'script' ? 'script' : 'image');
      if (name === 'img' || name === 'source') for (const part of (attrs.get('srcset') || '').split(',')) { const u = part.trim().split(/\s+/)[0]; if (sameOrigin(u)) add(resolveUrl(strip(u), pageUrl), 'image'); }
    }
  }
  // Stylesheets still to be read: the linked ones, then every @import found, in a list that grows (an import is walked like a linked sheet, and a cycle ends at the first repeat).
  const todo = [...found].filter(([, kind]) => kind === 'css').map(([url]) => url);
  const queue = url => { add(url, 'css'); if (!todo.includes(url)) todo.push(url); };
  const inline = importsOf(styleBlocksOf(html).join('\n'), pageUrl);
  inline.urls.forEach(queue);
  for (const u of cssUrls(inline.rest + '\n' + styleAttrs.join('\n'), pageUrl)) add(u, 'image');
  // Each stylesheet, walked from each url the page names. A walk keeps its own visited real paths: a file reached under a second url (a
  // directory alias) keeps its own imports, and a cycle inside one walk still ends at the first repeat of a real file.
  for (const start of todo.slice()) {
    const walk = [start], seen = new Set();
    for (let i = 0; i < walk.length; i++) {
      const url = walk[i];
      const got = bytesOf(webDir, url, cache);
      if (got.missing) continue; // reported by measurePage as a missing asset
      if (got.refused) throw new Error(`${page}: loads ${url}, ${got.refused}`);
      if (seen.has(got.file)) continue;
      seen.add(got.file);
      const sheet = importsOf(got.bytes.toString('utf8').replace(/\r\n/g, '\n'), url);
      sheet.urls.forEach(u => { add(u, 'css'); if (!walk.includes(u)) walk.push(u); });
      for (const f of facesOf(sheet.rest)) {
        if (f.range && ![...cps].some(cp => inRange(cp, f.range))) continue;
        for (const u of f.urls) if (sameOrigin(u)) add(resolveUrl(strip(u), url), 'font');
      }
      for (const u of cssUrls(sheet.rest.replace(/@font-face\s*\{[^}]*\}/g, ' '), url)) add(u, 'image');
    }
  }
  return found;
}

// One page: its parts, total transfer bytes and request count (the HTML is one request).
export function measurePage(webDir, page, cps) {
  const cache = new Map(); // real path -> the read: a file named by two urls, or read by the walk and by the measure, is read once
  const pageRead = bytesOf(webDir, page, cache);
  if (pageRead.file === undefined) throw new Error(page + ': ' + (pageRead.refused || 'is missing'));
  const parts = [{ url: '/' + page, kind: 'html', bytes: servedBytes(page, pageRead.bytes) }];
  for (const [url, kind] of assetsOf(webDir, page, cps, cache)) {
    const got = bytesOf(webDir, url, cache);
    if (got.missing) { const err = new Error(`${page}: loads ${url}, which is not in the built tree`); err.missing = true; throw err; }
    if (got.refused) throw new Error(`${page}: loads ${url}, ${got.refused}`);
    parts.push({ url, kind, bytes: servedBytes(url, got.bytes) });
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
  // a page whose rendered read is refused is skipped here; the loop below fails that page's own row
  const refusedRendered = new Map();
  const rendered = renderedChars(webDir, refusedRendered);
  const rows = [];
  const pages = htmlPages(webDir);
  for (const page of pages) {
    const cps = [...rendered].filter(([, pageSet]) => pageSet.has('web/' + page)).map(([cp]) => cp);
    let m;
    try { m = measurePage(webDir, page, cps); }
    catch (e) { rows.push({ page, bytes: null, requests: null, parts: [], ratioBytes: null, ratioRequests: null, level: 'fail', notes: [e.message] }); continue; }
    if (refusedRendered.has(page)) { rows.push({ page, bytes: null, requests: null, parts: [], ratioBytes: null, ratioRequests: null, level: 'fail', notes: [`${page}: ${refusedRendered.get(page)}`] }); continue; }
    const d = Object.hasOwn(divergences, page) ? divergences[page] : {};
    const b = metricVerdict(m.bytes, almanac.medianBytes, d.bytes, 'transfer bytes'), r = metricVerdict(m.requests, almanac.medianRequests, d.requests, 'requests');
    // An exception lives only while it is used: an entry for a metric that is not over the ceiling, a key that is neither metric, or an entry naming no metric is a FAIL.
    const stale = [];
    for (const [key, label, value, median] of [['bytes', 'transfer bytes', m.bytes, almanac.medianBytes], ['requests', 'requests', m.requests, almanac.medianRequests]]) {
      if (d[key] && value <= median * CEILING_FACTOR) stale.push(`${page}: the named divergence for ${label} is stale: the page is at ${value}, not above twice the median (${median * CEILING_FACTOR}); remove the entry (an exception lives only while it is used)`);
    }
    for (const k of Object.keys(d)) if (k !== 'bytes' && k !== 'requests') stale.push(`${page}: a named divergence has the key "${k}", which is not bytes or requests`);
    if (Object.hasOwn(divergences, page) && Object.keys(d).length === 0) stale.push(`${page}: a named divergence names no metric (bytes or requests)`);
    const levels = [b.level, r.level];
    const level = stale.length || levels.includes('fail') ? 'fail' : levels.includes('diverged') ? 'diverged' : levels.includes('note') ? 'note' : 'pass';
    rows.push({ ...m, ratioBytes: m.bytes / almanac.medianBytes, ratioRequests: m.requests / almanac.medianRequests, level, notes: [b.text, r.text, ...stale].filter(Boolean) });
  }
  for (const key of Object.keys(divergences)) {
    if (!pages.includes(key)) rows.push({ page: key, bytes: null, requests: null, parts: [], ratioBytes: null, ratioRequests: null, level: 'fail', notes: [`${key}: a named divergence names a page that is not in the built tree; remove the entry (an exception lives only while it is used)`] });
  }
  return rows;
}

// A WARNING (never a failure) once the Almanac median was read more than 13 months ago: the row wants the median re-read from each new edition, and a new edition comes out about once a year.
// Compared by calendar day, so exactly 13 months later is not yet over. `today` is a parameter so a test can freeze it.
export function staleWarning(almanac = ALMANAC, today = new Date()) {
  const how = 're-read the latest edition at https://almanac.httparchive.org/en/<year>/page-weight and update ALMANAC';
  const read = new Date(almanac.readOn + 'T00:00:00Z');
  // a read date is a real calendar date: it must survive the round trip (2026-02-30 would otherwise roll into March)
  if (Number.isNaN(read.getTime()) || read.toISOString().slice(0, 10) !== almanac.readOn) return `WARNING: the Web Almanac read date "${almanac.readOn}" is not a date; ${how}`;
  // 13 months later is the same day of the month, or the last day of that month when it is shorter (Jan 31 + 13 months is Feb 28, not Mar 3)
  const [y, m, d] = [read.getUTCFullYear(), read.getUTCMonth(), read.getUTCDate()];
  const due = new Date(Date.UTC(y, m + 13, Math.min(d, new Date(Date.UTC(y, m + 14, 0)).getUTCDate())));
  return today.toISOString().slice(0, 10) > due.toISOString().slice(0, 10) ? `WARNING: the Web Almanac median was read on ${almanac.readOn}, more than 13 months ago; ${how}` : '';
}

const WORD = { pass: 'PASS', note: 'PASS (above the median)', diverged: 'PASS (named divergence)', fail: 'FAIL' };
export function report(rows, almanac = ALMANAC, today = new Date()) {
  const out = [];
  out.push(`Median home page (mobile), ${almanac.edition}, read ${almanac.readOn}: ${almanac.medianBytes} bytes, ${almanac.medianRequests} requests; ceiling ${CEILING_FACTOR}x = ${almanac.medianBytes * CEILING_FACTOR} bytes, ${almanac.medianRequests * CEILING_FACTOR} requests. Source: ${almanac.url}`);
  const stale = staleWarning(almanac, today);
  if (stale) out.push(stale);
  out.push(`Bytes are cold-load transfer bytes: text brotli-compressed at quality ${BROTLI_QUALITY}, fonts and images as their bytes.`);
  out.push('page | bytes | requests | x median bytes | x median requests | verdict');
  // a divergence naming a page that is not in the tree has nothing measured: its cells read "-"
  const cell = (v, f = x => x) => (v === null ? '-' : f(v));
  for (const r of rows) out.push(`${r.page} | ${cell(r.bytes)} | ${cell(r.requests)} | ${cell(r.ratioBytes, x => x.toFixed(4))} | ${cell(r.ratioRequests, x => x.toFixed(4))} | ${WORD[r.level]}`);
  for (const r of rows) for (const n of r.notes) out.push(`${r.page}: ${n}`);
  out.push(NOT_COUNTED);
  return out.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log('usage: node scripts/page-weight.mjs [--web <dir>]   (measures every page of the built tree, subfolders too against the Web Almanac median; exit 1 on a FAIL)'); return; }
  const unknown = args.filter((a, i) => a !== '--web' && args[i - 1] !== '--web');
  if (unknown.length) { console.error('unknown argument: ' + unknown.join(' ')); process.exitCode = 2; return; }
  const web = args.includes('--web') ? resolve(args[args.indexOf('--web') + 1] || '') : join(ROOT, 'web');
  let rows;
  try { rows = checkTree(web); } catch (e) { console.error('FAIL ' + e.message); process.exitCode = 1; return; }
  if (rows.length === 0) { console.error('FAIL no page found in ' + web + ': an empty check is not a pass'); process.exitCode = 1; return; }
  console.log(report(rows));
  if (rows.some(r => r.level === 'fail')) process.exitCode = 1;
}
if (isMainModule(import.meta.url)) main();
