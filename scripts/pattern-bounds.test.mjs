// Tests for the matching and expansion on repository-controlled text (K-16): the `_headers` path patterns (scripts/lib/headers-file.mjs patternMatches), the `var()` expansion of the
// type lint (scripts/lib/type-lint.mjs, reached through fontSizeProblems), and the strip of injected scripts (scripts/lib/injected-strip.mjs stripEdge, used by post-deploy-check).
// Each pathological witness runs in a child with a heap cap and a kill timeout: a matcher that goes super-linear is killed, and the test fails. Their bounds are time only: the
// matchers are not instrumented to count steps, so a wall-clock kill is the only observable, and the bound (30 s) is far above what a linear run takes. The equivalence tests compare
// the new code with the old algorithms, kept here verbatim, on grids and random inputs, so a kept result is checked, not assumed. Run: node --test scripts/pattern-bounds.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patternMatches } from './lib/headers-file.mjs';
import { fontSizeProblems } from './lib/type-lint.mjs';
import { catalogueProblems } from './lib/i18n-catalogue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = rel => pathToFileURL(join(ROOT, ...rel)).href;
const HEAP_MB = 256, KILL_MS = 30000;

// The matcher and the injected-script pattern as they stood before K-16, verbatim: the reference for the equivalence tests.
function legacyPatternMatches(pattern, path) {
  const re = pattern.split(/(\*|:[A-Za-z]\w*)/).map(part => (part === '*' ? '.*' : /^:[A-Za-z]/.test(part) ? '[^/]+' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp('^' + re + '$').test(path);
}
const CF_INJECT_LEGACY = /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:\/cdn-cgi\/|__CF\$cv\$params)(?:(?!<\/script>)[\s\S])*?<\/script>/g;
const legacyStrip = t => { let prev; do { prev = t; t = t.replace(CF_INJECT_LEGACY, ''); } while (t !== prev); return t; };

// Runs `source` in a child with a heap cap and a kill timeout. The child prints one line: OK and what it computed, or ERR and the message (exit 3).
// Each child gets its own sandbox directory as its home and temp folders: one per call, removed after the assertions (a narrow delete of that one directory).
const sandboxEnv = dir => ({ HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir });
function inChild(body, env = {}, heapMb = HEAP_MB) {
  const sandbox = mkdtempSync(join(tmpdir(), 'pattern-bounds-sandbox-'));
  try {
    const r = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, '--input-type=module', '-e', body], { env: { ...process.env, ...env, ...sandboxEnv(sandbox) }, encoding: 'utf8', timeout: KILL_MS, killSignal: 'SIGKILL' });
    assert.equal(r.signal, null, 'the child was killed, so the code ran away (' + r.signal + ')');
    assert.equal(r.status, 0, 'the child failed: ' + JSON.stringify(r.stdout) + ' ' + JSON.stringify(r.stderr.slice(0, 300)));
    return r.stdout.trim();
  } finally { rmSync(sandbox, { recursive: true, force: true }); }
}

const PATTERNS = ['/*', '/fonts/thai/*.woff2', '/blog/:slug', '/index.html', '/*.svg', '/a/*/b/*', ':x', '*', '/', '', '/:a/:b', '/a*c', '/a/*', '/*/*/*', '/x/:y/*.css', '/a?b', '/a/*/:b'];
const PATHS = ['/', '/fonts/thai/kw.0123.woff2', '/fonts/thai/OFL.txt', '/blog/x', '/blog/x/y', '/indexxhtml', '/index.html', '/favicon.svg', '/a/b/c/d/b/e', 'x', 'a\nb', 'a\rb', 'a\u2028b', 'a\u2029b', 'a b', '/a/c', '/abc', '/a/q/r', '', '/a/b', '/x/yy/q.css', '/a?b', '/a/bc/d/c', '/a/b/'];

test('K-16 (1) a pattern of many splats against a path it does not match is matched in time linear in the path', () => {
  // the path holds the pattern's last character, so the old matcher's search goes on; it backtracks through every way twenty `.*` can split the path and never finishes
  const out = inChild(`import { patternMatches } from ${JSON.stringify(url(['scripts', 'lib', 'headers-file.mjs']))};
console.log('OK ' + patternMatches(process.env.PAT, process.env.PATH_IN));`, { PAT: '/' + '*/'.repeat(20) + 'x', PATH_IN: '/' + 'a/'.repeat(40) + 'x/' });
  assert.equal(out, 'OK false');
});

test('K-16 (2) the path matcher keeps the results of the old matcher on a grid of patterns and paths, the dot, the placeholder and the splat included', () => {
  for (const p of PATTERNS) for (const path of PATHS) assert.equal(patternMatches(p, path), legacyPatternMatches(p, path), JSON.stringify([p, path]));
});

// The expansion's witness: a chain of twelve custom properties, each naming the one before it twenty times. The old expansion re-expands every name at every reference: 20^8 leaves.
function fanOutCss(levels, width) {
  let css = ':root{--d0:1rem;';
  for (let i = 1; i <= levels; i++) css += `--d${i}:${Array(width).fill(`var(--d${i - 1})`).join(' ')};`;
  return css + `}p{font-size:var(--d${levels})}`;
}

test('K-16 (3) a chain of custom properties that each name the previous one many times expands in time linear in its size', () => {
  const out = inChild(`import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([process.env.CSS]);
console.log('OK ' + problems.some(p => /passed 65536 characters and was cut/.test(p.why)));`, { CSS: fanOutCss(12, 20) });
  assert.equal(out, 'OK true', 'the lint completes, and names the expansion it cut at its character bound');
});

test('K-16 (4) the expansion keeps the results of the old expansion on the chains and fallbacks it judges today', () => {
  const css = [
    [':root{--a:1rem}p{font-size:var(--a)}', []],
    [':root{--a:1rem;--b:var(--a);--c:var(--b)}p{font-size:var(--c)}', []],
    ['p{font-size:var(--missing, 1rem)}', []],
    ['p{font-size:var(--missing)}', ['var(--missing) resolves to nothing, so its size cannot be judged']],
    [':root{--a:12px}p{font-size:var(--a)}', ['an absolute unit (px): a font size is rem, so the visitor\'s own text size scales it']],
    [':root{--a:var(--b);--b:var(--a)}p{font-size:var(--a)}', ['var(--a) resolves to nothing, so its size cannot be judged']],
  ];
  for (const [text, whys] of css) assert.deepEqual(fontSizeProblems([text]).map(p => p.why), whys, text);
});

// The injected-script strip: K-16's bounded scan, against the old pattern on fixtures and on random strings built from its tokens.
test('K-16 (5) the strip of injected scripts keeps the results of the old pattern, fixed point included', async () => {
  const { stripEdge } = await import(url(['scripts', 'lib', 'injected-strip.mjs']));
  const fixtures = ['<script src="/cdn-cgi/x.js"></script><p>a</p>', '<script>var a=1</script>', '<scripts>/cdn-cgi/</scripts>', '<script>__CF$cv$params</script>x<script type="a">/cdn-cgi/</script>y',
    '<script><script>/cdn-cgi/</script>', '<scr<script>/cdn-cgi/</script>ipt>'];
  for (const t of fixtures) assert.equal(stripEdge(t), legacyStrip(t), JSON.stringify(t));
  const tokens = ['<', 'script', 'scr', 'ipt', '>', '/', '</script>', '<script>', '/cdn-cgi/', '__CF$cv$params', ' ', 's'];
  let seed = 7;
  const next = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let i = 0; i < 3000; i++) {
    let t = '';
    for (let k = 0, len = 1 + next(24); k < len; k++) t += tokens[next(tokens.length)];
    assert.equal(stripEdge(t), legacyStrip(t), JSON.stringify(t));
  }
});

test('K-16 (6) a page of many unclosed script openers is stripped in time linear in its size', () => {
  // the old pattern scans to the end of the page from every opener: quadratic in the openers, and the fixed point repeats it
  const out = inChild(`import { stripEdge } from ${JSON.stringify(url(['scripts', 'lib', 'injected-strip.mjs']))};
const t = '<script>'.repeat(60000) + '</script>';
console.log('OK ' + stripEdge(t).length);`);
  assert.equal(out, 'OK ' + ('<script>'.length * 60000 + '</script>'.length), 'nothing carries a marker, so nothing is removed');
});

test('F-2 a definition with many references to a capped name is cut inside the replacement, and the lint says it was cut', () => {
  // --b is 65000 characters and --a names it 20000 times: the whole replacement would be 1.3 G characters, past V8's string limit, so the cut must happen while it is built
  const css = `:root{--b:${'x'.repeat(65000)};--a:${'var(--b) '.repeat(20000)}}p{font-size:var(--a)}`;
  const dir = mkdtempSync(join(tmpdir(), 'pattern-bounds-'));
  try {
    const file = join(dir, 'page.css');
    writeFileSync(file, css);
    const out = inChild(`import { readFileSync } from 'node:fs';
import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([readFileSync(process.env.CSS_FILE, 'utf8')]);
console.log('OK ' + problems.some(p => /passed 65536 characters and was cut/.test(p.why)));`, { CSS_FILE: file }, 1024);
    assert.equal(out, 'OK true', 'the lint completes and says the expansion was cut');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CR-2 many definitions each naming a near-cap value are cut once the memo holds its bound, and the lint says so', () => {
  // --big is 60000 characters and each of 100 definitions names it once: each expansion is under the per-expansion cap, but together they would keep 6 M characters in the memo
  const defs = [`--big:${'x'.repeat(60000)}`], uses = [];
  for (let i = 0; i < 100; i++) { defs.push(`--n${i}:var(--big)`); uses.push(`p.c${i}{font-size:var(--n${i})}`); }
  const css = `:root{${defs.join(';')}}${uses.join('')}`;
  const dir = mkdtempSync(join(tmpdir(), 'pattern-bounds-memo-'));
  try {
    const file = join(dir, 'memo.css');
    writeFileSync(file, css);
    const out = inChild(`import { readFileSync } from 'node:fs';
import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([readFileSync(process.env.CSS_FILE, 'utf8')]);
console.log('OK ' + problems.some(p => /the custom-property memo passed 4194304 characters and later names were cut/.test(p.why)));`, { CSS_FILE: file }, 1024);
    assert.equal(out, 'OK true', 'the lint reports the cut once the memo holds its bound');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K-24 many aliases of a definition with many unresolved names are cut once the memo counts their missing-name lists, and the lint says so', () => {
  // --base holds 4000 unresolved names; 200 aliases each name it, and each alias keeps its own copy of the 4000 names: values stay empty, so only the names can fill the memo
  const names = Array.from({ length: 4000 }, (_, i) => `var(--u${i})`).join(' ');
  const defs = [`--base:${names}`], uses = [];
  for (let i = 0; i < 200; i++) { defs.push(`--a${i}:var(--base)`); uses.push(`p.c${i}{font-size:var(--a${i})}`); }
  const css = `:root{${defs.join(';')}}${uses.join('')}`;
  const dir = mkdtempSync(join(tmpdir(), 'pattern-bounds-missing-'));
  try {
    const file = join(dir, 'missing.css');
    writeFileSync(file, css);
    const out = inChild(`import { readFileSync } from 'node:fs';
import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([readFileSync(process.env.CSS_FILE, 'utf8')]);
console.log('OK ' + problems.some(p => /the custom-property memo passed 4194304 characters and later names were cut/.test(p.why)));`, { CSS_FILE: file }, 1024);
    assert.equal(out, 'OK true', 'the lint reports the cut once the memo counts the missing names');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('K-25 one definition naming 200 unresolved names, used by 500 declarations, reports each missing name once', () => {
  // --base names 200 unresolved names and 500 font-size declarations use it. Each name is one missing name, reported once per run, so each of the 200 appears in the problems exactly once: a name that is dropped, or reported twice, fails
  const names = Array.from({ length: 200 }, (_, i) => 'var(--u' + i + ')').join(' ');
  const defs = ['--base:' + names], uses = [];
  for (let i = 0; i < 500; i++) uses.push('p.c' + i + '{font-size:var(--base)}');
  const css = ':root{' + defs.join(';') + '}' + uses.join('');
  const dir = mkdtempSync(join(tmpdir(), 'pattern-bounds-once-'));
  try {
    const file = join(dir, 'once.css');
    writeFileSync(file, css);
    const out = inChild(`import { readFileSync } from 'node:fs';
import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([readFileSync(process.env.CSS_FILE, 'utf8')]);
console.log('W ' + JSON.stringify(problems.map(p => p.why)));`, { CSS_FILE: file }, 1024);
    const whys = JSON.parse(out.replace(/^W /, ''));
    const notOnce = Array.from({ length: 200 }, (_, i) => i).filter(i => whys.filter(w => w.startsWith('var(--u' + i + ') ')).length !== 1);
    assert.deepEqual(notOnce, [], 'each of the 200 names is reported exactly once; the indexes that are not: ' + notOnce.join(', '));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('one missing name under 500 font shorthands is one problem, not one per shorthand', () => {
  const css = Array.from({ length: 500 }, (_, i) => 'p.c' + i + '{font:var(--missing)}').join('');
  const dir = mkdtempSync(join(tmpdir(), 'pattern-bounds-shorthand-'));
  try {
    const file = join(dir, 'shorthand.css');
    writeFileSync(file, css);
    const out = inChild(`import { readFileSync } from 'node:fs';
import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([readFileSync(process.env.CSS_FILE, 'utf8')]);
console.log('N ' + problems.length);`, { CSS_FILE: file }, 1024);
    assert.equal(out, 'N 1', 'one missing name is one problem');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a declaration with a long whitespace run inside its value is read to its end, not re-scanned at every character', () => {
  // The pathological input: three hundred thousand spaces inside one value. The lazy match this replaced re-scanned the run at each character, so the
  // child runs past the kill timer on the old code; the bound is the child's heap cap and that timer, not a clock read here.
  const out = inChild(`import { fontSizeProblems, declarationsOf } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const css = 'p{font-size:1rem' + ' '.repeat(300000) + 'x}';
const value = declarationsOf(css)[0].value;
fontSizeProblems([css]);
console.log('OK ' + value.slice(-1));`);
  assert.equal(out, 'OK x', 'the declaration is read to its end, and its parsed value ends in the final character');
});

test('a declaration naming twenty thousand unresolved names reports them in output bounded by its length', () => {
  // The fixture is built inside the child (a 270 KB argument is refused by the kernel on Linux). Its problems are summed without joining them.
  const out = inChild(`import { pageTypeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const names = Array.from({ length: 20000 }, (_, i) => 'var(--u' + i + ')').join(' ');
const html = '<!doctype html><html><head><style>p{font-size:' + names + '}</style></head><body></body></html>';
let chars = 0;
for (const p of pageTypeProblems(html)) chars += p.length;
let omitted = 0;
for (const p of pageTypeProblems(html)) { chars += p.length; if (p.includes('19800 more unresolved names were not listed')) omitted++; }
console.log('OK ' + chars + ' ' + omitted);`);
  const m = /^OK (\d+) (\d+)$/.exec(out);
  assert.ok(m && Number(m[1]) < 1000000 && Number(m[2]) === 1, 'the problems\' text and the count line are ' + out + ' for a twenty-thousand-name declaration');
});

test('sixty catalogues with disjoint keys are compared with the default language only, so no pair of them is compared', () => {
  // Each file holds keys no other file holds. A pairwise comparison reports each key missing from another file of the sixty, not only from the default
  // language: about 7 million lines, past the child's heap cap. The assertion counts the missing-key lines that name a non-default reference.
  const out = inChild(`import { catalogueProblems } from ${JSON.stringify(url(['scripts', 'lib', 'i18n-catalogue.mjs']))};
const files = { 'en.json': Buffer.from(JSON.stringify({ home: { hi: 'x' } })) };
for (let i = 0; i < 60; i++) files[String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26)) + '.json'] = Buffer.from(JSON.stringify({ home: Object.fromEntries(Array.from({ length: 2000 }, (_, j) => ['k' + i + 'x' + j, 'v'])) }));
const problems = catalogueProblems(files);
console.log('PAIRS ' + problems.filter(p => p.includes(' is missing (it is in ') && !p.startsWith('en.json:') && !p.endsWith('(it is in en.json)')).length);`);
  assert.equal(out, 'PAIRS 0', 'a missing-key line that names a non-default catalogue is a pairwise comparison that ran');
});

test('a catalogue whose keys nest past the key-text budget is refused, and its keys are not built', () => {
  let obj = { v: 'x' };
  for (let i = 0; i < 2000; i++) obj = { k: 'x', n: obj };
  const problems = catalogueProblems({ 'en.json': Buffer.from(JSON.stringify(obj)) });
  assert.ok(problems.some(p => /key text/.test(p)), 'no key-text budget problem: ' + problems.slice(0, 3).join(' | '));
});

test('an over-budget catalogue is refused whole: its partial keys are neither stored nor compared with the others', () => {
  // The first file is the nested chain past the key-text budget. The walk stops partway, so a stored partial walk would report the second file as
  // missing keys the first file was never fully read for.
  let obj = { v: 'x' };
  for (let i = 0; i < 2000; i++) obj = { k: 'x', n: obj };
  const problems = catalogueProblems({ 'en.json': Buffer.from(JSON.stringify(obj)), 'th.json': Buffer.from(JSON.stringify({ v: 'x' })) });
  assert.ok(problems.some(p => /key text/.test(p)), 'the budget line is missing: ' + problems.slice(0, 3).join(' | '));
  assert.deepEqual(problems.filter(p => / is missing \(it is in /.test(p)), [], 'a partial walk of the over-budget file was compared');
});

test('a 2,000-key English catalogue beside 300 empty catalogues gives at most 500 listed keys and one count line per file and direction', () => {
  // Every empty catalogue lacks every English key. Listing each one costs the English key count per file; the bound is the listing budget plus two count lines per file.
  const out = inChild(`import { catalogueProblems } from ${JSON.stringify(url(['scripts', 'lib', 'i18n-catalogue.mjs']))};
const en = { home: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['k' + i, 'v'])) };
const files = { 'en.json': Buffer.from(JSON.stringify(en)) };
const tagOf = i => String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
for (let i = 0; i < 300; i++) files[tagOf(i) + '.json'] = Buffer.from('{}');
console.log('N ' + catalogueProblems(files).length);`);
  const n = Number(/^N (\d+)$/.exec(out)?.[1]);
  assert.ok(n <= 500 + 2 * 300, 'the problems number ' + n + ', over the 500 listed keys plus two count lines for each of the 300 files');
});

test('sixty catalogues with disjoint keys stay within twice their key count, and a key that a third file lacks is still reported', () => {
  // The disjoint files are compared with the default language only. The witness counts every problem and checks one line that must still be there.
  const out = inChild(`import { catalogueProblems } from ${JSON.stringify(url(['scripts', 'lib', 'i18n-catalogue.mjs']))};
const en = { home: { hi: 'x', shared: 'y' } };
const files = { 'en.json': Buffer.from(JSON.stringify(en)), 'th.json': Buffer.from(JSON.stringify(en)) };
const tagOf = i => String.fromCharCode(97 + (i % 26)) + String.fromCharCode(97 + Math.floor(i / 26));
let keys = 4;
for (let i = 0; i < 60; i++) { files[tagOf(i) + '.json'] = Buffer.from(JSON.stringify({ home: Object.fromEntries(Array.from({ length: 2000 }, (_, j) => ['k' + i + 'x' + j, 'v'])) })); keys += 2000; }
const problems = catalogueProblems(files);
console.log(JSON.stringify({ n: problems.length, keys, lacks: problems.includes(tagOf(0) + '.json: key home.shared is missing (it is in en.json)') }));`);
  const r = JSON.parse(out);
  assert.ok(r.n <= 2 * r.keys, 'the problems number ' + r.n + ', over twice the ' + r.keys + ' keys');
  assert.equal(r.lacks, true, 'a key that the third file lacks was not reported');
});

test('a Markdown passage of two hundred thousand open brackets is converted in one pass', () => {
  const out = inChild(`import { inline } from ${JSON.stringify(url(['scripts', 'lib', 'legal-render.mjs']))};
const md = '['.repeat(200000);
console.log('OK ' + (inline(md) === md));`);
  assert.equal(out, 'OK true', 'a bracket with no closing bracket is text, and the passage comes back as it went in');
});

test('a path pattern with a hundred thousand wildcards is refused loudly, not matched', () => {
  const out = inChild(`import { patternMatches } from ${JSON.stringify(url(['scripts', 'lib', 'headers-file.mjs']))};
let r;
try { r = String(patternMatches('/' + '*/'.repeat(100000) + 'x', '/' + 'a/'.repeat(100000))); } catch { r = 'REFUSED'; }
console.log('OK ' + r);`);
  assert.equal(out, 'OK REFUSED', 'the matcher refuses a pattern past its wildcard bound');
});

test('a catalogue with a reserved key nested under reserved keys reports the first, in output bounded by its length', () => {
  const out = inChild(`import { catalogueDomainProblems } from ${JSON.stringify(url(['scripts', 'lib', 'domain-seams.mjs']))};
let inner = { v: 'x' };
for (let i = 0; i < 2000; i++) inner = { domain: inner };
const problems = catalogueDomainProblems({ 'en.json': JSON.stringify({ home: inner }) }, ['home']);
let chars = 0;
for (const p of problems) chars += JSON.stringify(p).length;
console.log('OK ' + chars + ' ' + problems.length);`);
  const m = /^OK (\d+) (\d+)$/.exec(out);
  assert.ok(m && Number(m[1]) < 2000 && Number(m[2]) === 1, 'the report is ' + out + '; one reserved key is reported once, not at each level below it');
});

test('a bulk of cookie property names before commas is checked in time linear in its length', () => {
  // A destructuring target is read up to its closing bracket, and the read starts again at every cookie name. A bulk with no bracket at all is quadratic on
  // the base commit; the control checks that a real destructuring write is still reported.
  const out = inChild(`import { cookieProblems } from ${JSON.stringify(url(['scripts', 'lib', 'domain-seams.mjs']))};
const bulk = cookieProblems([{ file: 'web/x.js', text: '.cookie,'.repeat(100000) }]).length;
const control = cookieProblems([{ file: 'web/y.js', text: '[document.cookie, y] = z;' }]).length;
console.log('OK ' + bulk + ' ' + control);`);
  assert.equal(out, 'OK 1 1', 'the bulk is one reported line, not skipped, and the control is one write');
});

test('a cookie write whose destructuring target is longer than the bound is reported, not skipped', () => {
  // The target is forty names, about 630 characters: past the bound, so it cannot be read in full. It must be reported, not passed over.
  const out = inChild(`import { cookieProblems } from ${JSON.stringify(url(['scripts', 'lib', 'domain-seams.mjs']))};
const names = Array.from({ length: 40 }, (_, i) => 'name' + i + 'x'.repeat(10)).join(',');
console.log('OK ' + cookieProblems([{ file: 'web/z.js', text: '[document.cookie, ' + names + '] = z;' }]).length);`);
  assert.equal(out, 'OK 1', 'the long target is reported as one line');
});

test('a cookie write whose long destructuring target holds a parenthesis is reported, not skipped', () => {
  // The same forty names, with a parenthesis at the front of the target. The report must not depend on whether the target holds a parenthesis.
  const out = inChild(`import { cookieProblems } from ${JSON.stringify(url(['scripts', 'lib', 'domain-seams.mjs']))};
const names = Array.from({ length: 40 }, (_, i) => 'name' + i + 'x'.repeat(10)).join(',');
console.log('OK ' + cookieProblems([{ file: 'web/p.js', text: '[document.cookie, (a), ' + names + '] = z;' }]).length);`);
  assert.equal(out, 'OK 1', 'the long target with a parenthesis is reported as one line');
});

test('a bulk of for-loop cookie targets is checked in time linear in its length', () => {
  // The for-loop alternative reads its target to the next parenthesis, and restarts at each cookie name; with no parenthesis the base is quadratic.
  const out = inChild(`import { cookieProblems } from ${JSON.stringify(url(['scripts', 'lib', 'domain-seams.mjs']))};
console.log('OK ' + cookieProblems([{ file: 'web/f.js', text: 'for(' + '.cookie,'.repeat(100000) }]).length);`);
  assert.equal(out, 'OK 1', 'the bulk is one reported line');
});

test('a reserved key under a deep chain of keys is reported in output bounded by the input', () => {
  // A chain of a thousand keys ends in a thousand sibling objects, each with a reserved key. Each report quotes its full path, so the output grows with the
  // depth times the leaves: the bound is twenty times the input.
  const out = inChild(`import { catalogueDomainProblems } from ${JSON.stringify(url(['scripts', 'lib', 'domain-seams.mjs']))};
let bottom = {};
for (let j = 0; j < 1000; j++) bottom['x' + j] = { domain: 'x' };
let obj = bottom;
for (let i = 0; i < 1000; i++) obj = { k: obj };
const text = JSON.stringify({ home: obj });
let chars = 0;
for (const p of catalogueDomainProblems({ 'en.json': text }, ['home'])) chars += JSON.stringify(p).length;
console.log('OK ' + text.length + ' ' + chars);`);
  const m = /^OK (\d+) (\d+)$/.exec(out);
  assert.ok(m && Number(m[2]) < 20 * Number(m[1]), 'the report is ' + (m ? m[2] : out) + ' characters for ' + (m ? m[1] : '?') + ' of input');
});

test('a bulk of link openers with no closing parenthesis is converted in time linear in its length', () => {
  // Each opener's url is read to the next parenthesis or space, and no parenthesis comes, so each opener reads to the end of the passage. The control is a
  // closed link, which must still become an anchor.
  const out = inChild(`import { inline } from ${JSON.stringify(url(['scripts', 'lib', 'legal-render.mjs']))};
const bulk = inline('[a](https://'.repeat(80000));
const control = inline('[a](https://x.y)') === '<a href="https://x.y">a</a>';
console.log('OK ' + control + ' ' + bulk.length);`);
  assert.equal(out, 'OK true 960000', 'the control is an anchor, and the bulk is text unchanged');
});

// The inline svg pattern as it stood before this change, verbatim: the reference for the equivalence test.
const legacySvgBlank = t => t.replace(/<(svg)\b[\s\S]*?<\/\1\b[^>]*>/gi, m => m.replace(/[^\n]/g, ' '));

test('a bulk of inline svg openers with no closer is blanked inside its timer, and a closed svg is blanked as before', () => {
  // Each opener would read the rest of the text for its closer; with no closer anywhere, the old pattern is quadratic and the child is killed at its timer.
  const out = inChild(`import { blankSvgs } from ${JSON.stringify(url(['scripts', 'lib', 'svg-blank.mjs']))};
const bulk = blankSvgs('<svg'.repeat(400000));
const control = blankSvgs('a<svg>x</svg>b') === 'a' + ' '.repeat(12) + 'b';
console.log('OK ' + control + ' ' + bulk.length + ' ' + JSON.stringify(blankSvgs('')));`);
  assert.equal(out, 'OK true 1600000 ""', 'the control is blanked, the bulk keeps its length, and the empty text stays empty');
});

test('blankSvgs blanks exactly what the old inline svg pattern blanked, on a deterministic set of small mixed inputs', async () => {
  const { blankSvgs } = await import('./lib/svg-blank.mjs');
  const pieces = ['<', 'svg', 'SVG', '</', '>', ' ', '\n', 'x', '</svg>', '<svg>', '</svg ', '<svgx', '</svgx>', '<svg-a', '</svg\n>'];
  let seed = 7;
  const rnd = n => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed % n; };
  for (let t = 0; t < 3000; t++) {
    let s = '';
    const len = 1 + rnd(14);
    for (let k = 0; k < len; k++) s += pieces[rnd(pieces.length)];
    assert.equal(blankSvgs(s), legacySvgBlank(s), JSON.stringify(s));
  }
});

test('an inline svg opener followed by a run of closers that have no greater-than is blanked inside its timer, and the text keeps its length', () => {
  // Each closer's search ran to the end of the text for its greater-than, so 100,000 closers with none took quadratic time and the child was killed.
  const out = inChild(`import { blankSvgs } from ${JSON.stringify(url(['scripts', 'lib', 'svg-blank.mjs']))};
const text = '<svg>' + '</svg '.repeat(100000);
console.log('OK ' + blankSvgs(text).length + ' ' + text.length);`);
  const [, got, want] = out.split(' ');
  assert.equal(got, want, 'the text keeps its length');
});

// The Wrangler source-map key, read as the surface check reads wrangler.jsonc: comments are removed first, so a comment that names the key does not satisfy it.
test('the Wrangler source-map key passes when it is true', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.equal(sourceMapsProblem('{\n\t"name": "kolwen",\n\t"upload_source_maps": true,\n\t"main": "worker/index.mjs"\n}\n'), null);
});

test('the Wrangler source-map key fails when it is absent, false, or a string', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.notEqual(sourceMapsProblem('{\n\t"name": "kolwen"\n}\n'), null, 'absent');
  assert.notEqual(sourceMapsProblem('{\n\t"upload_source_maps": false\n}\n'), null, 'false');
  assert.notEqual(sourceMapsProblem('{\n\t"upload_source_maps": "true"\n}\n'), null, 'a string is not the boolean');
});

test('the Wrangler source-map key named only in a comment fails, and a comment after the value does not hide it', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.notEqual(sourceMapsProblem('{\n\t// "upload_source_maps": true,\n\t/* "upload_source_maps": true, */\n\t"name": "kolwen"\n}\n'), null, 'named only in comments');
  assert.equal(sourceMapsProblem('{\n\t"upload_source_maps": true, // a note\n\t"name": "kolwen"\n}\n'), null, 'a trailing comment on the key line');
});

test('the Wrangler source-map key is read at the top level: a key only inside previews or env fails', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.notEqual(sourceMapsProblem('{\n\t"previews": {\n\t\t"upload_source_maps": true\n\t}\n}\n'), null, 'only in previews');
  assert.notEqual(sourceMapsProblem('{\n\t"env": {\n\t\t"a": {\n\t\t\t"upload_source_maps": true\n\t\t}\n\t}\n}\n'), null, 'only in env');
});

test('a duplicate Wrangler source-map key takes its last value, as JSON.parse does', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.notEqual(sourceMapsProblem('{\n\t"upload_source_maps": true,\n\t"upload_source_maps": false\n}\n'), null, 'true then false');
  assert.equal(sourceMapsProblem('{\n\t"upload_source_maps": false,\n\t"upload_source_maps": true\n}\n'), null, 'false then true');
});

test('a double slash inside a string is not a comment, so a URL before the key does not hide it', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.equal(sourceMapsProblem('{"route": "https://x.example/y", "upload_source_maps": true}'), null);
});

test('the Wrangler source-map key passes with a trailing comma, and the real wrangler.jsonc passes', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.equal(sourceMapsProblem('{"upload_source_maps": true,}'), null);
  assert.equal(sourceMapsProblem(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8')), null, 'the real file');
});

test('a bulk of source-map keys is read inside its timer, and a text that does not parse is reported', () => {
  const out = inChild(`import { sourceMapsProblem } from ${JSON.stringify(url(['scripts', 'lib', 'wrangler-jsonc.mjs']))};
const bulk = '"upload_source_maps":'.repeat(50000);
const broken = sourceMapsProblem('{"upload_source_maps": true');
console.log('OK ' + typeof sourceMapsProblem(bulk) + ' ' + (broken === null ? 'passed' : 'reported'));`);
  assert.equal(out, 'OK string reported');
});

test('the Wrangler source-map key is not read past a glued comment, and an unclosed block comment is a problem', async () => {
  const { sourceMapsProblem } = await import('./lib/wrangler-jsonc.mjs');
  assert.notEqual(sourceMapsProblem('{"upload_source_maps": tr/**/ue}'), null, 'a comment inside a value joins the words either side of it');
  assert.notEqual(sourceMapsProblem('{"upload_source_maps": true} /* unfinished'), null, 'an unclosed block comment');
});

test('surface-check fails and names the Wrangler library when the library is removed', () => {
  const copy = mkdtempSync(join(tmpdir(), 'pattern-bounds-library-'));
  const env = { ...process.env, ...sandboxEnv(copy) };
  try {
    for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, env, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' }).split('\0').filter(Boolean)) {
      mkdirSync(dirname(join(copy, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(copy, f));
    }
    rmSync(join(copy, 'scripts', 'lib', 'wrangler-jsonc.mjs'));
    execFileSync('git', ['init', '-q'], { cwd: copy, env, timeout: 30000, killSignal: 'SIGKILL' });
    execFileSync('git', ['add', '-A'], { cwd: copy, env, timeout: 30000, killSignal: 'SIGKILL' });
    const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, join(ROOT, 'scripts', 'surface-check.mjs')], { cwd: copy, env, encoding: 'utf8', timeout: KILL_MS * 4, killSignal: 'SIGKILL' });
    assert.equal(r.signal, null, 'surface-check was killed');
    assert.equal(r.status, 1, 'surface-check passed without the library: ' + r.stdout.slice(0, 300));
    assert.ok((r.stdout + r.stderr).includes('scripts/lib/wrangler-jsonc.mjs: could not be loaded'), 'the gate did not name the library that would not load');
  } finally { rmSync(copy, { recursive: true, force: true }); }
});

test('a value nested 100,000 levels deep is reported without a throw', () => {
  const out = inChild(`import { sourceMapsProblem } from ${JSON.stringify(url(['scripts', 'lib', 'wrangler-jsonc.mjs']))};
const deep = '{"upload_source_maps": ' + '['.repeat(100000) + ']'.repeat(100000) + '}';
console.log('OK ' + typeof sourceMapsProblem(deep));`);
  assert.equal(out, 'OK string');
});

test('surface-check fails on a wrangler.jsonc with no upload_source_maps line, and names the key', () => {
  const copy = mkdtempSync(join(tmpdir(), 'pattern-bounds-surface-'));
  const env = { ...process.env, ...sandboxEnv(copy) };
  try {
    for (const f of execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, env, encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL' }).split('\0').filter(Boolean)) {
      mkdirSync(dirname(join(copy, f)), { recursive: true });
      copyFileSync(join(ROOT, f), join(copy, f));
    }
    const wrangler = join(copy, 'wrangler.jsonc');
    writeFileSync(wrangler, readFileSync(wrangler, 'utf8').split('\n').filter(line => !line.includes('"upload_source_maps"')).join('\n'));
    execFileSync('git', ['init', '-q'], { cwd: copy, env, timeout: 30000, killSignal: 'SIGKILL' });
    execFileSync('git', ['add', '-A'], { cwd: copy, env, timeout: 30000, killSignal: 'SIGKILL' });
    const r = spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, join(ROOT, 'scripts', 'surface-check.mjs')], { cwd: copy, env, encoding: 'utf8', timeout: KILL_MS * 4, killSignal: 'SIGKILL' });
    assert.equal(r.signal, null, 'surface-check was killed');
    assert.equal(r.status, 1, 'surface-check passed a wrangler.jsonc with no key: ' + r.stdout.slice(0, 300));
    assert.match(r.stdout + r.stderr, /upload_source_maps is absent/);
  } finally { rmSync(copy, { recursive: true, force: true }); }
});

test('a font shorthand with no size and no missing name is still reported', () => {
  const css = 'p.u{font:italic bold}';
  const dir = mkdtempSync(join(tmpdir(), 'pattern-bounds-unreadable-'));
  try {
    const file = join(dir, 'unreadable.css');
    writeFileSync(file, css);
    const out = inChild(`import { readFileSync } from 'node:fs';
import { fontSizeProblems } from ${JSON.stringify(url(['scripts', 'lib', 'type-lint.mjs']))};
const problems = fontSizeProblems([readFileSync(process.env.CSS_FILE, 'utf8')]);
console.log('W ' + JSON.stringify(problems.map(p => p.why)));`, { CSS_FILE: file }, 1024);
    assert.deepEqual(JSON.parse(out.replace(/^W /, '')), ['a font shorthand whose size cannot be read'], 'the unreadable shorthand is reported once');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
