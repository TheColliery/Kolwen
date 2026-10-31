// Tests for the matching and expansion on repository-controlled text (K-16): the `_headers` path patterns (scripts/lib/headers-file.mjs patternMatches), the `var()` expansion of the
// type lint (scripts/lib/type-lint.mjs, reached through fontSizeProblems), and the strip of injected scripts (scripts/lib/injected-strip.mjs stripEdge, used by post-deploy-check).
// Each pathological witness runs in a child with a heap cap and a kill timeout: a matcher that goes super-linear is killed, and the test fails. Their bounds are time only: the
// matchers are not instrumented to count steps, so a wall-clock kill is the only observable, and the bound (30 s) is far above what a linear run takes. The equivalence tests compare
// the new code with the old algorithms, kept here verbatim, on grids and random inputs, so a kept result is checked, not assumed. Run: node --test scripts/pattern-bounds.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { patternMatches } from './lib/headers-file.mjs';
import { fontSizeProblems } from './lib/type-lint.mjs';

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
