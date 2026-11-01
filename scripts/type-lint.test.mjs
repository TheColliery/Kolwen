// Tests for the layout tokens (scripts/lib/layout-tokens.mjs) and their static lint (scripts/lib/type-lint.mjs, surface-check rule 21): each defect the lint exists for is planted and found, the
// built pages are clean, and the tokens do what their comments say. Node builtins only. No browser here: the rendered checks have their own test file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sizeProblem, fontSizeProblems, pageTypeProblems, declarationsOf } from './lib/type-lint.mjs';
import { TOKENS, tokenName, tokensCss, VIEWPORT_META, FLUID_FROM, FLUID_TO, PX_PER_REM } from './lib/layout-tokens.mjs';
import { htmlPages } from './lib/web-files.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');
const page = (css, meta = VIEWPORT_META) => `<!DOCTYPE html><html lang="en" data-job="default"><head>${meta}<style>${css}</style></head><body><p>x</p></body></html>`;
const why = (css, meta) => pageTypeProblems(page(css, meta));

test('the built pages and the font manifest pass the lint', () => {
  const fonts = [readFileSync(join(WEB, 'fonts/fonts.css'), 'utf8')];
  const pages = htmlPages(WEB);
  assert.ok(pages.length >= 7, 'the lint reads every page: ' + pages.length);
  for (const f of pages) assert.deepEqual(pageTypeProblems(readFileSync(join(WEB, f), 'utf8'), fonts), [], f);
});

test('a font size in px, pt or any other absolute unit is found, in the property and in the font shorthand', () => {
  for (const css of ['p{font-size:14px}', 'p{font-size:12pt}', 'p{font-size:1cm}', 'p{font:14px/1.5 sans-serif}', 'p{font:italic 600 14px/1.5 "A B",sans-serif}', 'p{font-size:calc(1rem + 2px)}']) {
    assert.ok(why(css).some(m => /absolute unit/.test(m)), css + ': ' + JSON.stringify(why(css)));
  }
});

test('a font size by viewport units alone is found (SC 1.4.4, failure F94); one with a rem term in the same value is not', () => {
  for (const css of ['p{font-size:2vw}', 'p{font-size:calc(2vw + 3vh)}', 'p{font-size:clamp(1vw, 2vw, 3vw)}', 'p{font-size:min(2vw, 20px)}', 'p{font-size:5dvmin}']) {
    assert.ok(why(css).some(m => /viewport units|absolute unit/.test(m)), css + ': ' + JSON.stringify(why(css)));
  }
  assert.ok(why('p{font-size:2vw}').some(m => /viewport units \(vw\) with no rem term.*F94/.test(m)));
  for (const css of ['p{font-size:calc(1rem + 2vw)}', 'p{font-size:clamp(1rem, .5rem + 2vw, 2rem)}', 'p{font-size:1.25rem}', 'p{font-size:.875rem}', 'p{font-size:inherit}', 'p{font-size:max(1rem, 2vw)}']) {
    assert.deepEqual(why(css), [], css);
  }
});

test('a clamp() with no rem term, a unit that is not rem, a keyword size and a size with no rem at all are found', () => {
  assert.ok(why('p{font-size:clamp(1rem, 2vw, 40px)}').some(m => /absolute unit/.test(m)), 'a px bound inside a clamp');
  assert.ok(sizeProblem('clamp(10vw, 12vw, 14vw)'), 'a clamp of viewport units');
  assert.match(sizeProblem('clamp(1em, 2vw, 3em)'), /not rem/);
  for (const css of ['p{font-size:1.2em}', 'p{font-size:120%}', 'p{font-size:large}', 'p{font-size:smaller}', 'p{font-size:12}']) assert.ok(why(css).length > 0, css);
  assert.match(sizeProblem('clamp(1vw, 2vw, 3vw)'), /no rem term/);
  // a rem term elsewhere in the value does not excuse a clamp that has none of its own
  assert.match(sizeProblem('calc(1rem + clamp(1vw, 2vw, 3vw))'), /a clamp\(\) with no rem term/);
  assert.equal(sizeProblem('calc(1rem + clamp(1rem, 2vw, 3rem))'), null);
});

test('a var() is followed to its custom property and that value is judged; one that resolves to nothing is found', () => {
  assert.ok(why(':root{--s:14px} p{font-size:var(--s)}').some(m => /absolute unit/.test(m)), 'a px token');
  assert.ok(why(':root{--a:var(--b);--b:2vw} p{font-size:var(--a)}').some(m => /viewport units/.test(m)), 'a chain');
  assert.deepEqual(why(':root{--a:var(--b);--b:1.5rem} p{font-size:var(--a)}'), [], 'a chain of rem');
  assert.ok(why('p{font-size:var(--missing)}').some(m => /var\(--missing\) resolves to nothing/.test(m)), 'an undefined token');
  assert.deepEqual(why('p{font-size:var(--missing, 1rem)}'), [], 'a fallback that is rem');
  assert.ok(why('p{font:var(--missing) sans-serif}').some(m => /resolves to nothing/.test(m)));
  assert.deepEqual(why(':root{--s:1rem} p{font:var(--s)/1.5 sans-serif}'), [], 'the shorthand through a token');
});

test('a style attribute, a noscript style and a second block are read too, and a comment is not', () => {
  const inline = '<!DOCTYPE html><html><head>' + VIEWPORT_META + '</head><body><p style="font-size:13px">x</p></body></html>';
  assert.ok(pageTypeProblems(inline).some(m => /absolute unit/.test(m)), 'a style attribute');
  const noscript = '<!DOCTYPE html><html><head>' + VIEWPORT_META + '<noscript><style>p{font-size:2vw}</style></noscript></head><body></body></html>';
  assert.ok(pageTypeProblems(noscript).some(m => /viewport units/.test(m)), 'a noscript style');
  assert.deepEqual(why('/* p{font-size:14px} */ p{font-size:1rem}'), [], 'a comment');
  assert.deepEqual(why('p::after{content:"font-size:14px"} q{font-size:1rem}'), [], 'a string');
  assert.ok(pageTypeProblems(page('p{font-size:1rem}') + '<style>q{font-size:9px}</style>').some(m => /absolute unit/.test(m)), 'a block after the first');
});

test('the viewport meta must be exactly the layout formula\'s: device width, scale 1, cover, and nothing that blocks zoom', () => {
  assert.deepEqual(why('p{font-size:1rem}'), []);
  const meta = c => `<meta name="viewport" content="${c}">`;
  assert.ok(why('p{font-size:1rem}', meta('width=device-width, initial-scale=1')).some(m => /lacks viewport-fit=cover/.test(m)), 'no cover');
  assert.ok(why('p{font-size:1rem}', meta('initial-scale=1, viewport-fit=cover')).some(m => /lacks width=device-width/.test(m)));
  assert.ok(why('p{font-size:1rem}', meta('width=device-width, viewport-fit=cover')).some(m => /lacks initial-scale=1/.test(m)));
  assert.ok(why('p{font-size:1rem}', meta('width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no')).some(m => /user-scalable/.test(m)));
  assert.ok(why('p{font-size:1rem}', meta('width=device-width, initial-scale=1, viewport-fit=cover, maximum-scale=1')).some(m => /maximum-scale/.test(m)));
  assert.ok(why('p{font-size:1rem}', '').some(m => /0 viewport metas/.test(m)), 'none');
  assert.ok(why('p{font-size:1rem}', VIEWPORT_META + VIEWPORT_META).some(m => /2 viewport metas/.test(m)), 'two');
});

test('declarations are split outside strings and parentheses, and a selector with a colon creates no font-size finding', () => {
  // declarationsOf understands no selector, so it does hand back selector-shaped entries for a:hover and b::after; what matters is what the lint does with them
  const css = 'a:hover{color:red} @media (min-width:640px){p{font-size:1rem;margin:0}} b::after{content:"a;b{c}"}';
  const d = declarationsOf(css);
  assert.deepEqual(d.filter(x => x.prop === 'font-size').map(x => x.value), ['1rem']);
  assert.deepEqual(fontSizeProblems([css]), [], 'selector colons do not create font-size findings');
  assert.ok(fontSizeProblems([css + ' i{font-size:12px}']).length === 1, 'and a real px size in the same text is still the one finding');
});

// ── the tokens ────────────────────────────────────────────────────────────────────────────────────────────────
const px = (value, widthPx, rootPx = PX_PER_REM) => {
  // evaluates the tokens' clamp(<rem>, <rem> + <n>vw, <rem>) and plain rem values, at a viewport width, to px
  const remPx = s => parseFloat(s) * rootPx;
  const m = /^clamp\(([-\d.]+)rem, ([-\d.]+)rem \+ ([-\d.]+)vw, ([-\d.]+)rem\)$/.exec(value);
  if (!m) return remPx(value);
  const [lo, off, vw, hi] = [remPx(m[1]), remPx(m[2]), parseFloat(m[3]), remPx(m[4])];
  return Math.min(hi, Math.max(lo, off + (vw / 100) * widthPx));
};

test('every token is named from its path, and every size token is in rem (or a clamp whose bounds and preferred term carry rem)', () => {
  assert.equal(tokenName('font.size.display'), '--kw-font-size-display');
  assert.equal(tokenName('size.container.reading'), '--kw-size-container-reading');
  for (const [path, value] of Object.entries(TOKENS)) {
    if (/^(font\.size|space\.(inset|section|header-block|footer|cell|button)|size\.container)/.test(path) && !/gutter|header-top|footer-end/.test(path)) {
      assert.ok(/rem/.test(value) && !/px/.test(value.replace(/env\([^)]*\)/g, '')), path + ' is rem: ' + value);
    }
    if (value.startsWith('clamp(')) assert.match(value, /^clamp\([-\d.]+rem, [-\d.]+rem \+ [-\d.]+vw, [-\d.]+rem\)$/, path + ' is a clamp with rem bounds and a rem term');
  }
  const css = tokensCss();
  for (const path of Object.keys(TOKENS)) assert.ok(css.includes(tokenName(path) + ':'), path);
  assert.ok(!/<\/style/i.test(css), 'the block cannot close a style element');
});

test('a fluid token is its small value at and below the band and its large value at and above it, and the fixed values are the sizes the pages used', () => {
  assert.equal(FLUID_FROM, 420); assert.equal(FLUID_TO, 440);
  const want = { 'font.size.display': [28, 34], 'font.size.title': [20, 24], 'font.size.title-home': [18, 21], 'font.size.cell': [13, 14], 'space.cell': [6, 10], 'space.button': [8, 12] };
  for (const [path, [lo, hi]] of Object.entries(want)) {
    for (const w of [320, 360, 390, 420]) assert.ok(Math.abs(px(TOKENS[path], w) - lo) < 1e-9, `${path} at ${w}`);
    for (const w of [440, 640, 1280, 2560]) assert.ok(Math.abs(px(TOKENS[path], w) - hi) < 1e-9, `${path} at ${w}`);
    const mid = px(TOKENS[path], 430);
    assert.ok(mid > lo && mid < hi, `${path} moves between the two inside the band`);
  }
  const fixed = { 'font.size.1': 12, 'font.size.2': 12.5, 'font.size.3': 13, 'font.size.4': 13.5, 'font.size.5': 14, 'font.size.6': 14.5, 'font.size.7': 15, 'font.size.8': 15.5, 'font.size.9': 18, 'font.size.10': 20, 'font.size.11': 26,
    'space.inset-inline': 20, 'space.inset-block-start': 36, 'space.section': 28, 'size.container.narrow': 600, 'size.container.reading': 760, 'size.container.wide': 1100 };
  for (const [path, want16] of Object.entries(fixed)) assert.equal(px(TOKENS[path], 390), want16, path);
  // a larger root size scales every one of them (the visitor's own setting): twice the root, twice the size
  for (const path of Object.keys(want)) assert.ok(Math.abs(px(TOKENS[path], 1280, 32) - 2 * px(TOKENS[path], 1280, 16)) < 1e-9, path + ' at 200%');
});

test('the safe-area gutters are max(our minimum, env(safe-area-inset-*)), so the inset wins only where it is larger', () => {
  for (const path of ['space.gutter-inline', 'space.gutter-inline-roomy']) {
    assert.match(TOKENS[path], /^max\(var\(--kw-space-[a-z-]+\), env\(safe-area-inset-left, 0px\)\) max\(var\(--kw-space-[a-z-]+\), env\(safe-area-inset-right, 0px\)\)$/, path);
  }
  assert.match(TOKENS['space.header-top'], /env\(safe-area-inset-top, 0px\)/);
  assert.match(TOKENS['space.footer-end'], /env\(safe-area-inset-bottom, 0px\)/);
});

// ── the rule in the gate every push runs ─────────────────────────────────────────────────────────────────────────
test('surface-check rule 21 checks each page on its own: a page it cannot check is one FAIL line naming it, the other pages are still checked, and nothing is a stack trace', () => {
  const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const dir = mkdtempSync(join(tmpdir(), 'rule21-'));
  const home = join(dir, '.sandbox-home');
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home };
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
  try {
    for (const f of tracked) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
    for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(run('git', args).status, 0, 'git ' + args[0]);
    const surface = () => run(process.execPath, ['--max-old-space-size=2048', 'scripts/surface-check.mjs']);
    assert.equal(surface().status, 0, 'the copy of the tree passes before anything is planted');
    const edit = (f, fn) => { writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), 'utf8'))); run('git', ['add', '-A']); };
    // the lint throws for every prose page (a page it cannot tokenize), and a px size is planted in the home page
    edit('scripts/lib/type-lint.mjs', s => s.replace('export function pageTypeProblems(html, extraCss = []) {', 'export function pageTypeProblems(html, extraCss = []) {\n  if (html.includes(\'<html lang="en" data-job="prose">\')) throw new Error(\'planted\');'));
    edit('web/index.html', s => s.replace('</style>', 'p.kwprobe{font-size:13px}</style>'));
    const r = surface();
    const out = r.stdout + r.stderr;
    assert.equal(r.status, 1, out);
    for (const p of ['terms', 'privacy', 'refund', 'changelog']) assert.match(out, new RegExp(`web/${p}\\.html: rule 21 could not check this page \\(planted\\)`), p);
    assert.match(out, /web\/index\.html: .*font-size: 13px is an absolute unit/, 'the home page, after the pages that threw, is still checked');
    assert.doesNotMatch(out, /\n\s+at /, 'no stack trace');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A custom property first expanded deep in a chain (where the depth limit cuts it) must not hand a shallower reference the cut's fallback.
test('a name first expanded deep in a chain does not hand a shallower reference its depth-limit fallback', () => {
  const defs = Array.from({ length: 7 }, (_, i) => `--a${i}: var(--a${i + 1});`).join('') + '--a7: var(--a8, 1rem);--a8: 12px;';
  const css = `:root{${defs}} h1{font-size: var(--a0)} p{font-size: var(--a7)}`;
  assert.equal(fontSizeProblems([css]).length, 1, 'the 12px behind --a7 is the one px finding; a 1rem fallback cut by the depth limit must not hide it');
});
