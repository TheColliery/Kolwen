// The font manifest (web/fonts/fonts.css), the glyph set each font file must carry, and the check that every file carries it (web-build rule W-PERF-06).
// The glyph set of a file is DERIVED: every character the built pages render (rendered-text.mjs) that falls inside a unicode-range declared for that file, plus the
// characters Thai shaping needs when the file serves Thai. The check reads each file's cmap itself (woff2-cmap.mjs), so it needs no font tool.
// It over-approximates on purpose: a rendered character inside a face's range must be in that face's file whatever family actually draws it, because the page cascade
// is not evaluated here. A character outside every declared range is another check's business (fonts.test.mjs: every character is inside a declared Sans range).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { renderedChars } from './rendered-text.mjs';
import { woff2Cmap } from './woff2-cmap.mjs';

// One object per @font-face.
export const facesOf = css => [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => {
  const b = m[1];
  return { family: (/font-family:\s*'([^']+)'/.exec(b) || [])[1], weight: Number((/font-weight:\s*(\d+)/.exec(b) || [])[1]), display: (/font-display:\s*(\w+)/.exec(b) || [])[1],
    urls: [...b.matchAll(/url\(\s*'?([^')\s]+)'?\s*\)/g)].map(x => x[1]), range: (/unicode-range:\s*([^;]+);/.exec(b) || [])[1] };
});
export const inRange = (cp, range) => range.split(',').some(part => { const [a, b] = part.trim().replace(/^U\+/i, '').split('-'); return cp >= parseInt(a, 16) && cp <= parseInt(b || a, 16); });

// What Thai shaping needs beyond the text: the dotted circle (a base for a lone mark) and the zero-width space, non-joiner and joiner.
export const THAI_SHAPING = [0x25cc, 0x200b, 0x200c, 0x200d];
const THAI_FIRST = 0x0e01;

// url -> { family, weights, ranges, cps }: the sorted code points the file at that url must carry, with the page that renders each.
export function glyphSets(webDir, rendered = renderedChars(webDir)) {
  const faces = facesOf(readFileSync(join(webDir, 'fonts/fonts.css'), 'utf8').replace(/\r\n/g, '\n'));
  const files = new Map();
  for (const f of faces) {
    const url = f.urls[0];
    const file = files.get(url) || files.set(url, { url, families: new Set(), weights: new Set(), ranges: [], need: new Map() }).get(url);
    file.families.add(f.family); file.weights.add(f.weight); file.ranges.push(f.range);
  }
  for (const file of files.values()) {
    for (const [cp, pages] of rendered) if (file.ranges.some(r => inRange(cp, r))) file.need.set(cp, [...pages].sort());
    if (file.ranges.some(r => inRange(THAI_FIRST, r))) for (const cp of THAI_SHAPING) if (!file.need.has(cp)) file.need.set(cp, ['Thai shaping']);
    file.cps = [...file.need.keys()].sort((a, b) => a - b);
  }
  return files;
}

export const charName = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0') + (cp > 0x20 ? ' "' + String.fromCodePoint(cp) + '"' : ' (space)');

// Every gap as a line naming the character, the face and the page that renders it. An empty array means every file carries every character it must.
export function coverageGaps(webDir) {
  const gaps = [];
  for (const file of glyphSets(webDir).values()) {
    const cmap = woff2Cmap(readFileSync(join(webDir, file.url)));
    const face = [...file.families].join('/') + ' ' + [...file.weights].join('/');
    for (const cp of file.cps) if (!cmap.has(cp)) gaps.push(`${charName(cp)} is not in ${face} (${file.url}); rendered by ${file.need.get(cp).join(', ')}`);
  }
  return gaps;
}

// True when a page's CSS (a <style> block or a style attribute) switches an OpenType layout feature on or off, which the cut files may have dropped.
export const asksForLayoutFeature = html => /font-feature-settings|font-variant|font-variation-settings|font-language-override/.test((html.match(/<style\b[\s\S]*?<\/style>/g) || []).join('\n') + (html.match(/style="[^"]*"/g) || []).join('\n'));

// ── versioned names: /fonts/<folder>/<base>.<first 10 hex of the sha256 of the bytes>.woff2 ────────────────────────────────────
// A font file's name carries a hash of its bytes, so the long immutable cache (web/_headers) can never serve a stale font: changed bytes are a new url.
// fonts.css, the one unhashed file a page links, stays revalidated and always names the current urls.
export const HASH_LEN = 10;
export const hashOf = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, HASH_LEN);
// Group 1 the folder, 2 the base, 3 the hash when present (font-subset.mjs reads an unhashed url too, to stamp it).
export const FONT_URL = /^\/fonts\/([a-z]+)\/([a-z0-9]+(?:-[a-z0-9]+)*?)(?:\.([0-9a-f]{10}))?\.woff2$/;

// One line per problem; empty when every font url in the manifest is a hashed name, resolves to a file, and names the hash of that file's bytes.
export function fontNameProblems(webDir) {
  const out = [];
  const urls = [...new Set(facesOf(readFileSync(join(webDir, 'fonts/fonts.css'), 'utf8').replace(/\r\n/g, '\n')).flatMap(f => f.urls))];
  for (const url of urls) {
    const m = FONT_URL.exec(url);
    if (!m || !m[3]) { out.push(`${url}: not a versioned name, expected /fonts/<folder>/<base>.<${HASH_LEN} hex of the sha256>.woff2`); continue; }
    let bytes;
    try { bytes = readFileSync(join(webDir, url)); } catch { out.push(`${url}: named by fonts.css but the file does not exist`); continue; }
    const real = hashOf(bytes);
    if (real !== m[3]) out.push(`${url}: the name says ${m[3]} but the bytes hash to ${real}; run scripts/font-subset.mjs, or rename the file`);
  }
  return out;
}
