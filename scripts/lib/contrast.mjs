// WCAG 2.2 contrast (SC 1.4.3, 1.4.11): the relative luminance and the ratio, as the standard defines them (www.w3.org/TR/WCAG22/#dfn-relative-luminance and #dfn-contrast-ratio), and the
// compositing of a translucent colour over what lies beneath it. This is the implementation surface-check rule 22 and the Node-side tests use. The rendered check measures the colours a browser
// computes with its own copy of the same formula (measureContrast in scripts/rendered-check.mjs, a function sent to the page, which cannot import this file), so a change to the formula is made
// in both. Node builtins only.
//   relative luminance L = 0.2126 R + 0.7152 G + 0.0722 B, each channel c/255 linearised: c <= 0.04045 ? c/12.92 : ((c + 0.055)/1.055)^2.4
//   contrast ratio     (L1 + 0.05) / (L2 + 0.05), L1 the lighter.
// WCAG 2.2 prints 0.04045 in the definition (www.w3.org/TR/WCAG22/#dfn-relative-luminance, read 2026-10-18); its Note 2 records that before May 2021 it printed 0.03928, a change with no practical
// effect on the calculations in the context of the guidelines. The two thresholds give the same luminance for every 8-bit channel value (no 8-bit value falls between them; the test in
// scripts/reading-theme.test.mjs walks all 256), and 0.04045 is the one used.
// A colour is { r, g, b, a } with r, g and b in 0 to 255 and a in 0 to 1.

// "#rgb", "#rrggbb", "rgb(r, g, b)", "rgba(r, g, b, a)" (also the space-separated "rgb(r g b / a)" a browser reports). Returns null for anything else.
export function parseColor(text) {
  const s = String(text).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  return null;
}

const lin = c => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

// `top` painted over `under` (an opaque colour): the opaque colour the eye sees.
export function over(top, under) {
  const a = top.a;
  return { r: top.r * a + under.r * (1 - a), g: top.g * a + under.g * (1 - a), b: top.b * a + under.b * (1 - a), a: 1 };
}

// The contrast ratio of two colours; `fg` may be translucent and is composited over `bg`, which must be opaque.
export function ratio(fg, bg) {
  if (bg.a !== 1) throw new Error('contrast: the ground must be opaque, composite it first');
  const a = luminance(over(fg, bg)), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// SC 1.4.3 large text: at least 18 pt (24 CSS px), or 14 pt (18.66 CSS px) and bold.
export const isLargeText = (fontSizePx, fontWeight) => fontSizePx >= 24 || (fontSizePx >= 18.66 && Number(fontWeight) >= 700);

// Every pair of the reading theme (layout-tokens.mjs READING_PAIRS) in both colour schemes, measured: [{ scheme, fg, bg, floor, ratio, ok, what }]. A palette that lacks a colour of a pair is a row
// with ok false, never a skipped one. The two schemes are named here, not read from the palette's own keys: a palette that loses or renames one is a set of failing rows, never a rule that
// quietly measures the other scheme alone.
import { READING, READING_PAIRS } from './layout-tokens.mjs';
export const SCHEMES = ['light', 'dark'];
export function readingContrast() {
  const rows = [];
  for (const scheme of SCHEMES) {
    for (const [fg, bg, floor, what] of READING_PAIRS) {
      const f = parseColor(READING[scheme]?.[fg] ?? ''), g = parseColor(READING[scheme]?.[bg] ?? '');
      const value = f && g && g.a === 1 ? ratio(f, g) : null;
      rows.push({ scheme, fg, bg, floor, what, ratio: value, ok: value !== null && value >= floor });
    }
  }
  return rows;
}
