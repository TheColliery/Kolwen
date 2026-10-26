// The raw-text class: the page rules read markup inside text the HTML tokenizer never reads as markup. That text is a comment, the raw-text body of
// script, style, xmp, iframe, noembed and noframes, the RCDATA body of title and textarea, and the body of plaintext. A reader that looks for the next
// tag inside it can swallow the real element after it. Every row plants one defect in a copy of this tree and runs the real scripts/surface-check.mjs
// on it, except the csp-hashes rows, which call the library directly. A valid page is a row that must pass. Each child runs under a heap cap and a
// kill timer, and no time is asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };
const lineOf = (s, i) => s.slice(0, i).split('\n').length;

function surfaceCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'raw-text-'));
  const env = childEnv(dir);
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).stdout.split('\0').filter(Boolean);
  for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: dir, env, timeout: 60000 }).status, 0, 'git ' + args[0]);
  return dir;
}
const surface = (dir, timeout = 120000) => { const r = spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 }); return { ...r, out: (r.stdout || '') + (r.stderr || '') }; };
const edit = (dir, f, fn) => { const p = join(dir, f); const before = readFileSync(p, 'utf8'); const after = fn(before); assert.notEqual(after, before, f + ' was not changed'); writeFileSync(p, after); return after; };

// Admits, in web/_headers, every inline script and style hash the gate names as missing (the first run lists them, the second is the verdict), so the
// hash rule passes and only the rule under test can speak. Each kind goes into its own directive.
function admitAll(dir) {
  const first = surface(dir);
  const want = { script: new Set(), style: new Set() };
  for (const m of first.out.matchAll(/does not admit the inline (script|style) whose hash is ('sha256-[^']+')/g)) want[m[1]].add(m[2]);
  for (const kind of ['script', 'style']) {
    if (want[kind].size === 0) continue;
    edit(dir, 'web/_headers', h => h.replace(new RegExp(kind + '-src([^;\\n]*)', 'g'), (m, rest) => kind + '-src' + rest + ' ' + [...want[kind]].join(' ')));
  }
  return surface(dir);
}

// The page rules read a planted index.html: a plant goes in before the closing body tag.
const plant = (dir, markup) => edit(dir, 'web/index.html', s => s.replace('</body>', markup + '\n</body>'));
const BUY = (line, label) => `web/index.html: line ${line}: has a link that reads as a buy control ${label}`;

// ── the defects: a real role-button link after text the tokenizer never reads as markup ───────────────────────────────────────────────────
// Each plant is balanced (every opener of a tag has its closer, counting the text too), so the balance count cannot hide the reader's answer.
const BUTTON = '<a href="#" role="button">Continue</a>';

test('rule 17 reads the real link after a quoted <a> in a script string: the string is script data, so the link keeps its role', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<script>var s = '<a href="/x">';</script>\n${BUTTON}\n<script>var t = '</a>';</script>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the aria-label of the real link after a quoted <a> in a script string', () => {
  const dir = surfaceCopy();
  try {
    const link = '<a href="#" aria-label="Subscribe">Continue</a>';
    const after = plant(dir, `<script>var s = '<a href="/x">';</script>\n${link}\n<script>var t = '</a>';</script>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(link)), '("Continue Subscribe")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after a quoted <a> in an HTML comment: a comment is data, so the link keeps its role', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<!-- <a href="/x"> -->\n${BUTTON}\n<!-- </a> -->`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after a quoted <a> in a style comment: a style body is raw text, so the link keeps its role', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<style>/* <a href=x> */</style>\n${BUTTON}\n<style>/* </a> */</style>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after a quoted <a> in a title: title is RCDATA, so the link keeps its role', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<title>a <a href="/x"></title>\n${BUTTON}\n<title>b </a></title>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after a quoted <a> in a textarea: textarea is RCDATA, so the link keeps its role', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<textarea><a href="/x"></textarea>\n${BUTTON}\n<textarea></a></textarea>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the payment script after a fake <script> in a style body: the style body is raw text, so the real script is not swallowed', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<style>/* <script> */</style>\n<script>Paddle.Setup({})</script>\n<p>x</script></p>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${lineOf(after, after.indexOf('<script>Paddle'))}: carries a payment script`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the payment script after a fake <script> in a comment: the comment is data, so the real script is not swallowed', () => {
  const dir = surfaceCopy();
  try {
    // The fake opener and the real script sit on different lines, so a finding at the fake's line cannot pass for the real one.
    const after = plant(dir, `<!-- <script> -->\n<script>Paddle.Setup({})</script>\n<!-- </script> -->`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${lineOf(after, after.indexOf('<script>Paddle'))}: carries a payment script`), r.out);
    assert.doesNotMatch(r.out, new RegExp(`web/index.html: line ${lineOf(after, after.indexOf('<!-- <script>'))}: carries a payment script`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 13 names the real style hash when a style attribute holds a >: the browser reads the body after the quoted >', async () => {
  const { cspHash } = await lib();
  const dir = surfaceCopy();
  try {
    plant(dir, `<style title="a>b">.k{color:red}</style>`);
    const r = surface(dir);
    assert.ok(r.out.includes(cspHash('.k{color:red}')), 'the hash of the body the browser reads is named as missing: ' + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the valid pages: a raw-text body that holds markup is not a finding ─────────────────────────────────────────────────────────────────────

test('a valid page passes: a <style> in a script string is script data and gets no no-closer finding', () => {
  const dir = surfaceCopy();
  try {
    plant(dir, `<script>var s = "<style>";</script>`);
    const r = admitAll(dir);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /has 1 <style>/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a valid page passes: an <a> in a script string is script data and gets no no-closer finding', () => {
  const dir = surfaceCopy();
  try {
    plant(dir, `<script>var s = "<a href=/x>";</script>`);
    const r = admitAll(dir);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /has 1 <a> element/, r.out);
    assert.doesNotMatch(r.out, /unbalanced <a>/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a valid page passes: a free-plan phrase in a comment or a script body is not visible text, so rule 19 says nothing', () => {
  const dir = surfaceCopy();
  try {
    plant(dir, `<!-- the free tier is listed elsewhere -->\n<script>var s = "a free tier";</script>`);
    const r = admitAll(dir);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /a Free plan or a free tier/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the comment and closer forms: the abrupt comment ends, a comment closed by --!>, and an upper-case closer end their bodies ───────────────────────

test('rule 17 reads the real link after <!--> , an empty comment the tokenizer closes at once', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<!-->\n${BUTTON}\n<!-- x -->`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after <!---> , the other abrupt empty comment', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<!--->\n${BUTTON}\n<!-- x -->`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after an upper-case </SCRIPT> ends a script body', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<SCRIPT>var s = '<a href=x>';</SCRIPT>\n${BUTTON}\n<SCRIPT>var t = '</a>';</SCRIPT>`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17 reads the real link after a comment closed by --!> , and an end tag inside a later comment is no end tag', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<!-- x --!>\n${BUTTON}\n<!-- </a> -->`);
    const r = admitAll(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(BUY(lineOf(after, after.indexOf(BUTTON)), '("Continue")')), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the structured-data block is read through the shared reader: a commented-out copy is no block ───────────────────────────────────────────

test('the structured-data check reads the real block after a commented-out copy: a broken block is "ld+json does not parse"', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/index.html', p => p.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/, '<!-- <script type="application/ld+json">{}</script> -->$1{"broken":$3'));
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /web\/index\.html: ld\+json does not parse/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a </script-x> inside the structured-data body is data, not its closer: the block still parses and the gate passes', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/index.html', p => p.replace('<script type="application/ld+json">\n{\n', '<script type="application/ld+json">\n{\n\t"x": "</script-x>",\n'));
    const r = surface(dir);
    assert.equal(r.status, 0, r.out);
    assert.doesNotMatch(r.out, /ld\+json does not parse/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the unclosed bodies: a finding at its line, never a silent end of file ───────────────────────────────────────────────────────────

test('an unclosed comment is a finding at its line: the markup after it would be hidden from the browser, so the rules say so', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<!-- oops`);
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${lineOf(after, after.indexOf('<!-- oops'))}: has an unclosed comment`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an unclosed textarea is a finding at its line: its body runs to the end of the input', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<textarea>x`);
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${lineOf(after, after.indexOf('<textarea>x'))}: has an unclosed <textarea>`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a plaintext element is a finding at its line: its body is the rest of the input', () => {
  const dir = surfaceCopy();
  try {
    const after = plant(dir, `<plaintext>`);
    const r = surface(dir);
    assert.equal(r.status, 1, r.out);
    assert.ok(r.out.includes(`web/index.html: line ${lineOf(after, after.indexOf('<plaintext>'))}: has a <plaintext> element`), r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the csp-hashes level: the library names the same bodies the reader reads ────────────────────────────────────────────────────────

const lib = () => import(pathToFileURL(join(ROOT, 'scripts/lib/csp-hashes.mjs')).href);

test('inlineStyles reads a style whose attribute holds a >: the body is the text after the closing bracket of its start tag', async () => {
  const { inlineStyles } = await lib();
  assert.deepEqual(inlineStyles('<style title="a>b">.k{color:red}</style>'), ['.k{color:red}']);
});

test('inlineStyles skips a <style-x> opener, and reads the real <style> after it (kills an opener that admits any character)', async () => {
  const { inlineStyles } = await lib();
  assert.deepEqual(inlineStyles('<style-x>.p{}</style-x><style>.k{color:red}</style>'), ['.k{color:red}']);
});

test('inlineScripts skips a <script-x> opener, and reads the real <script> after it', async () => {
  const { inlineScripts } = await lib();
  assert.deepEqual(inlineScripts('<script-x></script-x><script>p()</script>'), ['p()']);
});

test('inlineStyles reads no style out of a comment: the comment is data', async () => {
  const { inlineStyles } = await lib();
  assert.deepEqual(inlineStyles('<!-- <style>x{}</style> --><style>.k{color:red}</style>'), ['.k{color:red}']);
});
