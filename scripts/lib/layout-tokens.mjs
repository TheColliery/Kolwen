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
  // The body text of a reading page (the paragraphs and list items of the legal pages and the changelog, in both languages): THE ONE KNOB. Its px value is the only number to change to make that text larger
  // or smaller; the column below is written in em, so it follows (the owner, 2026-10-19: 18 px, and the column grows with it, for less empty space left and right of the text).
  'font.size.body': rem(18),
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
  // The measure of a reading page: the width of its text column, in EM of the body text, so it follows the font (594 px at the 18 px of font.size.body). A reading page's main takes the body size as its own font size
  // (readingCss), so this em is the body's. 33em is the column the pages had when their body was 14.5 px (480 px = 33.1 em): the same number of characters on a line at any body size, which held at most 80 Latin
  // characters on a rendered line (SC 1.4.8, a TARGET, never claimed as met; the rendered check measures it on every prose page, in both languages, and fails a line over 80).
  'size.measure.reading': '33em',
  // Line heights: the Latin body text (the house's 1.6, at least the 1.5 of SC 1.4.8) and the Thai text of a reading page (1.65: at 1.5 the tallest marks of the bold face collide).
  'line-height.body': '1.6',
  'line-height.thai': '1.65',
  // The language switch's border, which the reading theme darkens on a light ground (SC 1.4.11).
  'color.switch-border': 'rgba(128, 128, 128, 0.7)',
};

export const tokenName = path => '--kw-' + path.replace(/\./g, '-');

// ── THE READING THEME ────────────────────────────────────────────────────────────────────────────────────────────
// A page declares its JOB with data-job on <html>: a page whose main content is prose read top to bottom (the legal pages, the changelog, and any later page that does the same job) is
// `prose` and takes the reading theme; a page of cards, buttons or figures to choose from is `default` and keeps its own. The scope is the job, never a list of files: a new page says
// what it is. The theme is a variant of the same colour names the pages already use (--bg, --txt ...), not a second stylesheet: a solid ground (no gradient), light or dark by the
// visitor's prefers-color-scheme (no manual toggle), the same header, footer, fonts and accent. Dark is the colours the pages already had; light is new, and darker where a colour sits on it
// (the accent #a65a19, the link colour #8a4510). Each scheme is measured on its own against SC 1.4.3 (4.5:1 for text, 3:1 for large text and, under SC 1.4.11, for the parts of a control and
// a graphic that identify it): READING_PAIRS lists every pair, scripts/lib/contrast.mjs computes them, surface-check rule 22 fails a pair under its floor, and the rendered check measures
// the real computed colours of every text element of a prose page in both schemes. The numbers are the house's own; the floors are WCAG's.
export const JOBS = ['prose', 'default'];
export const READING = {
  light: { bg: '#fbfaf8', bg2: '#f1eee9', card: '#f5f2ed', line: 'rgba(0, 0, 0, 0.12)', txt: '#1a1a1a', txt2: '#464646', quiet: '#585858', accent: '#a65a19', accent2: '#8a4510', switchBorder: '#767676' },
  dark: { bg: '#0f0d0b', bg2: '#15130f', card: '#1a1714', line: 'rgba(255, 255, 255, 0.08)', txt: '#ece4d9', txt2: '#a89a8c', quiet: '#a2968a', accent: '#e8833a', accent2: '#ffbb7a', switchBorder: '#8c8c8c' },
};
// [foreground, ground, floor, what it is]. The header and the footer take the page text colours: the header the body text (txt), the footer and its links the quiet one (the footer rule of
// the page style), so their pairs are txt/bg and quiet/bg; the accent is the mark's fill, a graphic (3:1).
export const READING_PAIRS = [
  ['txt', 'bg', 4.5, 'body text, and the header text and links, on the ground'],
  ['txt', 'card', 4.5, 'body text on a card'],
  ['txt', 'bg2', 4.5, 'text on a control or banner ground'],
  ['txt2', 'bg', 4.5, 'secondary text on the ground'],
  ['txt2', 'card', 4.5, 'secondary text on a card'],
  ['txt2', 'bg2', 4.5, 'secondary text on a control ground'],
  ['quiet', 'bg', 4.5, 'quiet text on the ground, and the footer text and links'],
  ['quiet', 'card', 4.5, 'quiet text on a card'],
  ['quiet', 'bg2', 4.5, 'quiet text on a control ground'],
  ['accent2', 'bg', 4.5, 'links and the focus ring on the ground'],
  ['accent2', 'card', 4.5, 'links on a card'],
  ['accent', 'bg', 3, 'the mark glyph on the ground (a graphic, SC 1.4.11)'],
  ['accent', 'card', 3, 'the mark glyph on a card'],
  ['switchBorder', 'bg', 3, 'the border of the language switch (SC 1.4.11)'],
];

const cssVars = p => `--bg:${p.bg};--bg2:${p.bg2};--card:${p.card};--line:${p.line};--txt:${p.txt};--txt2:${p.txt2};--quiet:${p.quiet};--accent:${p.accent};--accent2:${p.accent2};${tokenName('color.switch-border')}:${p.switchBorder}`;
export function readingCss() {
  const prose = 'html[data-job="prose"]';
  return [
    `  ${prose}{color-scheme:light dark;${cssVars(READING.light)}}`,
    `  @media (prefers-color-scheme:dark){${prose}{${cssVars(READING.dark)}}}`,
    `  ${prose} body{background:var(--bg)}`,
    `  ${prose} main{font-size:var(${tokenName('font.size.body')});max-width:calc(var(${tokenName('size.measure.reading')}) + 2 * var(${tokenName('space.inset-inline')}))}`,
    `  ${prose} #doc-th,${prose} #doc-th *{line-height:var(${tokenName('line-height.thai')})}`,
  ].join('\n');
}
// The <meta> lines a reading page carries for the browser chrome (W-DISC-10): the colour schemes it supports and a theme colour per scheme.
export const readingMeta = () => [
  '<meta name="color-scheme" content="light dark">',
  `<meta name="theme-color" content="${READING.light.bg}" media="(prefers-color-scheme: light)">`,
  `<meta name="theme-color" content="${READING.dark.bg}" media="(prefers-color-scheme: dark)">`,
].join('\n');

// The block as a page carries it: one :root rule, one declaration per line, then the reading theme's rules (they apply only under data-job="prose").
export function tokensCss() {
  return ['  :root{', ...Object.entries(TOKENS).map(([path, value]) => `    ${tokenName(path)}:${value};`), '  }', readingCss()].join('\n');
}
