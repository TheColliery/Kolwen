// The layout tokens: the house layout formula (AnchorPin + BaseDimension x AdaptiveScale + SafeAreaInsets) as CSS custom properties, defined in this ONE place and emitted into the style block
// of every page as the synced block `site-tokens-css` (scripts/lib/legal-render.mjs), the way the header and footer rules are. Nothing else on the site writes a size twice.
//
// WHAT THIS IS NOT: it is not the DTCG token file and not its Resolver (build-qc.md C-FMT-01), which are held for a ruling and are assumed by nothing here. The names follow one rule, so a
// later DTCG file can generate the same ones: a token at the path `font.size.1` is the custom property `--kw-font-size-1` (the path joined by dashes, prefixed `--kw-`). Until then this table
// IS the source, and a hand-kept second stylesheet is not allowed to appear beside it.
//
// EVERY NUMBER IS THE HOUSE'S OWN. No standard sets a type scale, a container width, a gutter or a breakpoint (the library rows PM-24 to PM-26 find none); the numbers below are the sizes the
// pages already used, written in rem at the browser default of 16px (so a visitor's own text size scales them, SC 1.4.4), and WCAG sets only the two bones the formula must not break:
//  - text never scales by viewport units alone (SC 1.4.4, failure F94): every fluid size below is a clamp() whose bounds are rem and whose preferred term carries a rem term as well;
//  - the page reflows at 320 CSS px with no scrolling in two directions (SC 1.4.10): the containers are maximums, never widths.
//
// THE ADAPTIVE SCALE is one band: a fluid token is its small value at and below FLUID_FROM and its large value at and above FLUID_TO, and moves linearly between. The band sits just above the
// 420px step the pages used before (their `@media (max-width:420px)` rules), so at any width but the 20px of that band a page renders exactly as it did.
// THE SAFE AREA: a gutter is `max(<our minimum token>, env(safe-area-inset-*))`, so the insets win only on a notched screen; `viewport-fit=cover` (VIEWPORT_META) is what asks the browser for them.
// The pair written for `padding-inline` is (start, end) = (left, right), which is right for left-to-right text, the only direction the site ships; env() insets are physical, so a right-to-left
// language swaps the pair (a rule to write with that language).

export const PX_PER_REM = 16; // the browser default; used only to WRITE rem values from px numbers
export const FLUID_FROM = 420; // CSS px of viewport width
export const FLUID_TO = 440;
export const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">';

const trim = n => String(+n.toFixed(5));
const rem = px => `${trim(px / PX_PER_REM)}rem`;
// clamp(min, preferred, max): rem bounds, and a preferred term that is a rem offset plus a vw slope (so zoom and a larger root size still move it).
function fluid(minPx, maxPx) {
  const slope = (maxPx - minPx) / (FLUID_TO - FLUID_FROM); // px of size per px of viewport width
  const offset = minPx - slope * FLUID_FROM; // px, at width 0
  return `clamp(${rem(minPx)}, ${rem(offset)} + ${trim(slope * 100)}vw, ${rem(maxPx)})`;
}

// path -> value. Order is the order in the emitted block.
export const TOKENS = {
  // Type scale: eleven fixed steps, the sizes the pages used.
  'font.size.1': rem(12),
  'font.size.2': rem(12.5),
  'font.size.3': rem(13),
  'font.size.4': rem(13.5),
  'font.size.5': rem(14),
  'font.size.6': rem(14.5),
  'font.size.7': rem(15),
  'font.size.8': rem(15.5),
  'font.size.9': rem(18),
  'font.size.10': rem(20),
  'font.size.11': rem(26),
  // Type that adapts: the mark's name, the page title (legal pages and the home page), and the plan table's cells.
  'font.size.display': fluid(28, 34),
  'font.size.title': fluid(20, 24),
  'font.size.title-home': fluid(18, 21),
  'font.size.cell': fluid(13, 14),
  // Spacing: the page frame (gutters, the rhythm between blocks, the header and footer).
  'space.inset-inline': rem(20),
  'space.inset-roomy': rem(32),
  'space.inset-block-start': rem(36),
  'space.section': rem(28),
  'space.header-block': rem(6),
  'space.footer-top': rem(44),
  'space.footer-bottom': rem(32),
  'space.footer-offset': rem(72),
  // The gutters: our minimum, and the device's safe-area inset when that is larger (env() is 0 on a screen without a notch).
  'space.gutter-inline': 'max(var(--kw-space-inset-inline), env(safe-area-inset-left, 0px)) max(var(--kw-space-inset-inline), env(safe-area-inset-right, 0px))',
  'space.gutter-inline-roomy': 'max(var(--kw-space-inset-roomy), env(safe-area-inset-left, 0px)) max(var(--kw-space-inset-roomy), env(safe-area-inset-right, 0px))',
  'space.header-top': 'max(var(--kw-space-header-block), env(safe-area-inset-top, 0px))',
  'space.footer-end': 'max(var(--kw-space-footer-bottom), env(safe-area-inset-bottom, 0px))',
  // Spacing that adapts: the plan table's cell gutter and its buttons.
  'space.cell': fluid(6, 10),
  'space.button': fluid(8, 12),
  // Containers (BaseDimension): maximums in rem, never widths.
  'size.container.narrow': rem(600),
  'size.container.reading': rem(760),
  'size.container.wide': rem(1100),
  'size.container.compact': '38rem',
};

export const tokenName = path => '--kw-' + path.replace(/\./g, '-');

// The block as a page carries it: one :root rule, one declaration per line.
export function tokensCss() {
  return ['  :root{', ...Object.entries(TOKENS).map(([path, value]) => `    ${tokenName(path)}:${value};`), '  }'].join('\n');
}
