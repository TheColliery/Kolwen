// Tests for the reading theme (scripts/lib/layout-tokens.mjs READING, scripts/lib/contrast.mjs, the job lint of scripts/lib/type-lint.mjs, surface-check rule 22), without a browser: the contrast
// arithmetic is the standard's, every pair of both schemes is measured and a weak palette is found, a page must declare its job, and the built pages declare the jobs they are meant to have.
// The rendered half (real computed colours and line heights in both schemes) is in scripts/rendered-check.test.mjs. Node builtins only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseColor, ratio, over, luminance, isLargeText, readingContrast } from './lib/contrast.mjs';
import { JOBS, PX_PER_REM, READING, READING_PAIRS, TOKENS, readingCss, readingMeta, tokensCss, tokenName } from './lib/layout-tokens.mjs';
import { pageJobProblems, pageTypeProblems } from './lib/type-lint.mjs';
import { htmlPages } from './lib/web-files.mjs';

const WEB = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'web');
const C = parseColor;

test('the contrast ratio is the standard\'s: black on white is 21, equal colours are 1, and the two well-known edge values land on the right side of 4.5', () => {
  assert.equal(ratio(C('#000'), C('#fff')).toFixed(2), '21.00');
  assert.equal(ratio(C('#fff'), C('#fff')), 1);
  assert.equal(ratio(C('#777777'), C('#ffffff')).toFixed(2), '4.48'); // #777 on white fails AA by a hair; #767676 is the lightest grey that passes
  assert.equal(ratio(C('#767676'), C('#ffffff')).toFixed(2), '4.54');
  assert.ok(ratio(C('#777777'), C('#ffffff')) < 4.5 && ratio(C('#767676'), C('#ffffff')) >= 4.5);
  assert.equal(ratio(C('#ffffff'), C('#000000')), ratio(C('#000000'), C('#ffffff')), 'the order of the two colours does not matter');
});

test('a colour is read from #rgb, #rrggbb, rgb(), rgba() and the space form a browser reports; anything else is null', () => {
  assert.deepEqual(C('#f0a'), { r: 255, g: 0, b: 170, a: 1 });
  assert.deepEqual(C('#0F0D0B'), { r: 15, g: 13, b: 11, a: 1 });
  assert.deepEqual(C('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.deepEqual(C('rgba(128, 128, 128, 0.7)'), { r: 128, g: 128, b: 128, a: 0.7 });
  assert.deepEqual(C('rgb(1 2 3 / 50%)'), { r: 1, g: 2, b: 3, a: 0.5 });
  for (const bad of ['red', '#12', '#12345', 'hsl(0 0% 0%)', '', 'rgb(1,2)']) assert.equal(C(bad), null, bad);
});

test('a translucent colour is composited over its ground before it is measured, and a translucent ground is refused', () => {
  const half = over({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(half, { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.equal(ratio({ r: 0, g: 0, b: 0, a: 0.5 }, C('#fff')), ratio(half, C('#fff')));
  assert.throws(() => ratio(C('#000'), { r: 255, g: 255, b: 255, a: 0.5 }), /ground must be opaque/);
  assert.ok(luminance(C('#fff')) > 0.999 && luminance(C('#000')) === 0);
});

test('large text is 24 CSS px, or 18.66 px and bold', () => {
  assert.equal(isLargeText(24, 400), true);
  assert.equal(isLargeText(23.9, 400), false);
  assert.equal(isLargeText(18.66, 700), true);
  assert.equal(isLargeText(18.66, 600), false);
  assert.equal(isLargeText(18, 700), false);
});

test('every pair of the reading theme is measured in BOTH schemes and each is at or over its floor (SC 1.4.3 for text, SC 1.4.11 for a graphic or a control border)', () => {
  const rows = readingContrast();
  assert.equal(rows.length, 2 * READING_PAIRS.length, 'both schemes, every pair');
  assert.deepEqual([...new Set(rows.map(r => r.scheme))].sort(), ['dark', 'light']);
  assert.deepEqual(rows.filter(r => !r.ok).map(r => `${r.scheme} ${r.fg}/${r.bg} ${r.ratio}`), []);
  for (const r of rows) assert.ok(r.floor === 4.5 || r.floor === 3, 'a floor is WCAG\'s own: ' + r.floor);
  // the header and footer colours are in the table, on the light ground too (the rule of the commit that re-measured them)
  for (const scheme of ['light', 'dark']) {
    assert.ok(rows.some(r => r.scheme === scheme && r.fg === 'txt' && r.bg === 'bg' && /header/.test(r.what)), scheme + ': header text');
    assert.ok(rows.some(r => r.scheme === scheme && r.fg === 'quiet' && r.bg === 'bg' && /footer/.test(r.what)), scheme + ': footer text');
  }
});

test('a weak colour is found: the same grey that passes on the dark ground fails on the light one, and the pairs rows say which', () => {
  const grey = C('#8d8d8d');
  assert.ok(ratio(grey, C(READING.dark.bg)) >= 4.5 && ratio(grey, C(READING.light.bg)) < 4.5);
  // a palette missing a colour is a failing row, never a skipped one
  const probe = READING.light.accent2;
  READING.light.accent2 = undefined;
  try {
    const rows = readingContrast().filter(r => r.scheme === 'light' && r.fg === 'accent2');
    assert.ok(rows.length > 0 && rows.every(r => !r.ok && r.ratio === null));
  } finally { READING.light.accent2 = probe; }
});

test('a scheme that is missing or renamed is failing rows, never a rule that measures the other scheme alone (rule 22 cannot be emptied by its data)', () => {
  const dark = READING.dark;
  try {
    delete READING.dark;
    READING.night = dark; // the palette renamed
    const rows = readingContrast();
    assert.equal(rows.length, 2 * READING_PAIRS.length, 'both schemes are still named: light and dark');
    const darkRows = rows.filter(r => r.scheme === 'dark');
    assert.equal(darkRows.length, READING_PAIRS.length);
    assert.ok(darkRows.every(r => !r.ok && r.ratio === null), 'every dark row fails');
    assert.ok(rows.filter(r => r.scheme === 'light').every(r => r.ok), 'the light rows are unchanged');
  } finally { delete READING.night; READING.dark = dark; }
  assert.equal(readingContrast().filter(r => r.scheme === 'dark').every(r => r.ok), true, 'restored');
});

test('the two linearisation thresholds, 0.04045 (WCAG 2.2) and the 0.03928 it replaced, give the same luminance for every 8-bit channel value', () => {
  const lin = (c, t) => { const v = c / 255; return v <= t ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  let max = 0;
  for (let c = 0; c <= 255; c++) max = Math.max(max, Math.abs(lin(c, 0.04045) - lin(c, 0.03928)));
  assert.equal(max, 0);
});

test('the reading theme is a variant of the colour names the pages already use, with a solid ground and the Thai line height set once', () => {
  const css = readingCss();
  assert.match(css, /html\[data-job="prose"\]\{color-scheme:light dark;--bg:#fbfaf8;/);
  assert.match(css, /@media \(prefers-color-scheme:dark\)\{html\[data-job="prose"\]\{--bg:#0f0d0b;/);
  assert.match(css, /html\[data-job="prose"\] body\{background:var\(--bg\)\}/);
  assert.match(css, /html\[data-job="prose"\] #doc-th,html\[data-job="prose"\] #doc-th \*\{line-height:var\(--kw-line-height-thai\)\}/);
  // The prose body is ONE knob, the px value of font.size.body, and the column follows it: main takes the body size as its own, so the column in em is the column in the body's em.
  assert.match(css, /html\[data-job="prose"\] main\{font-size:var\(--kw-font-size-body\);max-width:calc\(var\(--kw-size-measure-reading\) \+ 2 \* var\(--kw-space-inset-inline\)\)\}/);
  assert.equal(TOKENS['font.size.body'], '1.125rem', 'the body text of a reading page is 18 px (1.125rem at the browser default of 16 px)');
  assert.equal(parseFloat(TOKENS['font.size.body']) * PX_PER_REM, 18);
  assert.equal(TOKENS['size.measure.reading'], '33em', 'the column of a reading page is 33em of the body size (594 px at 18 px): the same characters per line at any body size, and the column grows with the font');
  const shared = readFileSync(join(WEB, '..', 'scripts/lib/legal-render.mjs'), 'utf8');
  assert.match(shared, /\.legal p,\.legal li\{font-size:var\(--kw-font-size-body\);/, 'the prose body text is the body token and no other size');
  // the page note of a reading page (the banner) is a paragraph in the same column: at a smaller size it would hold more than 80 characters a line (94 at 14.5 px in a 594 px column)
  assert.match(shared, /\n {2}\.banner\{[^}]*font-size:var\(--kw-font-size-body\)/, 'the banner follows the body size');
  assert.equal(TOKENS['line-height.thai'], '1.65');
  assert.equal(TOKENS['line-height.body'], '1.6');
  assert.ok(Number(TOKENS['line-height.body']) >= 1.5, 'the Latin line height is at least the 1.5 of SC 1.4.8');
  assert.ok(tokensCss().includes(css), 'it ships in the one tokens block');
  assert.ok(!/gradient/.test(css), 'no gradient');
  assert.ok(tokensCss().includes(tokenName('line-height.thai') + ':1.65'));
  for (const scheme of Object.values(READING)) for (const k of ['bg', 'bg2', 'card', 'line', 'txt', 'txt2', 'quiet', 'accent', 'accent2']) assert.ok(scheme[k], k);
});

test('the meta lines of a reading page: color-scheme, and a theme-color for each scheme that is its ground', () => {
  const m = readingMeta();
  assert.match(m, /<meta name="color-scheme" content="light dark">/);
  assert.match(m, /<meta name="theme-color" content="#fbfaf8" media="\(prefers-color-scheme: light\)">/);
  assert.match(m, /<meta name="theme-color" content="#0f0d0b" media="\(prefers-color-scheme: dark\)">/);
});

// ── the job a page declares ───────────────────────────────────────────────────────────────────────────────────────
const doc = (htmlAttrs, head = '') => `<!DOCTYPE html><html lang="en"${htmlAttrs}><head>${head}</head><body><p>x</p></body></html>`;
const PROSE_HEAD = readingMeta();

test('a page that declares no job, or one that is not a job, is found', () => {
  assert.ok(pageJobProblems(doc('')).some(m => /declares no job/.test(m)));
  assert.ok(pageJobProblems(doc(' data-job="article"')).some(m => /is not a job/.test(m)));
  assert.ok(pageJobProblems(doc(' data-job=""')).some(m => /is not a job/.test(m)));
  assert.deepEqual(pageJobProblems(doc(' data-job="default"')), []);
  assert.deepEqual(JOBS, ['prose', 'default']);
});

test('a prose page must carry the color-scheme meta and a theme-color for each scheme, with the ground of that scheme; a default page needs none', () => {
  assert.deepEqual(pageJobProblems(doc(' data-job="prose"', PROSE_HEAD)), []);
  assert.ok(pageJobProblems(doc(' data-job="prose"')).length >= 3, 'a prose page with no meta');
  assert.ok(pageJobProblems(doc(' data-job="prose"', PROSE_HEAD.replace('light dark', 'dark'))).some(m => /color-scheme/.test(m)), 'a wrong color-scheme');
  assert.ok(pageJobProblems(doc(' data-job="prose"', PROSE_HEAD.replace('#fbfaf8', '#ffffff'))).some(m => /theme-color of #fbfaf8 for \(prefers-color-scheme: light\)/.test(m)), 'a wrong light theme colour');
  assert.ok(pageJobProblems(doc(' data-job="prose"', PROSE_HEAD + '<meta name="theme-color" content="#15130f">')).some(m => /no other \(found 3\)/.test(m)), 'a third theme-color');
  assert.ok(pageJobProblems(doc(' data-job="prose"', PROSE_HEAD.replace(' media="(prefers-color-scheme: dark)"', ''))).length >= 1, 'a theme-color without its media');
  // and the job lint is part of the page lint the surface check runs
  assert.ok(pageTypeProblems(doc('')).some(m => /declares no job/.test(m)));
});

test('the page generator refuses a page that declares no job, or an unknown one', async () => {
  const { shell } = await import('./lib/legal-render.mjs');
  const page = { title: 'T', description: 'd', path: '/t', en: '', th: '' };
  assert.throws(() => shell(page), /declares no job/);
  assert.throws(() => shell({ ...page, job: 'article' }), /declares no job/);
  assert.match(shell({ ...page, job: 'prose' }), /<html lang="en" data-job="prose">/);
  assert.ok(shell({ ...page, job: 'prose' }).includes(readingMeta()), 'a prose page carries the reading meta lines');
  assert.match(shell({ ...page, job: 'default' }), /<meta name="theme-color" content="#15130f">/);
  assert.ok(!shell({ ...page, job: 'default' }).includes('name="color-scheme"'));
});

test('the built pages declare the jobs they are meant to have: the legal pages and the changelog are prose, the home, pricing and 404 pages are the default', () => {
  const want = { 'terms.html': 'prose', 'privacy.html': 'prose', 'refund.html': 'prose', 'changelog.html': 'prose', 'index.html': 'default', 'pricing.html': 'default', '404.html': 'default' };
  const pages = htmlPages(WEB);
  assert.deepEqual([...pages].sort(), Object.keys(want).sort(), 'every page is judged, none left out');
  for (const f of pages) {
    const html = readFileSync(join(WEB, f), 'utf8');
    assert.equal((/<html [^>]*data-job="([a-z]+)"/.exec(html) || [])[1], want[f], f);
    assert.deepEqual(pageJobProblems(html), [], f);
    if (want[f] === 'prose') assert.ok(html.includes(readingMeta()), f + ' carries the reading meta lines');
    else assert.ok(!html.includes('name="color-scheme"'), f + ' sets no color-scheme');
  }
});
