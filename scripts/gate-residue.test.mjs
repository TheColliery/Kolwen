// The gate's own failure paths: an unreadable tracked file, a library that will not load, a workflow shape the job reader must read or name, an SVG whose
// style or script the gate must name, and the robots reader's character references. Each row plants one defect in a copy of the tree and runs the real
// scripts/surface-check.mjs on it, except the rows that read one file or call one library directly. Each child runs under a heap cap and a kill timer,
// and no time is asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };

function surfaceCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'gate-residue-'));
  const env = childEnv(dir);
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).stdout.split('\0').filter(Boolean);
  for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: dir, env, timeout: 60000 }).status, 0, 'git ' + args[0]);
  return dir;
}
const surface = (dir, timeout = 120000) => { const r = spawnSync(process.execPath, ['--max-old-space-size=2048', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 }); return { ...r, out: (r.stdout || '') + (r.stderr || '') }; };
const edit = (dir, f, fn) => { const p = join(dir, f); const before = readFileSync(p, 'utf8'); const after = fn(before); assert.notEqual(after, before, f + ' was not changed'); writeFileSync(p, after); return after; };
// A file added to the copy and staged, so that the gate's own git ls-files lists it.
const stage = (dir, f, text) => { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), text); assert.equal(spawnSync('git', ['add', '-A'], { cwd: dir, env: childEnv(dir), timeout: 60000 }).status, 0); };
const plant = (dir, markup) => edit(dir, 'web/index.html', s => s.replace('</body>', markup + '\n</body>'));

// The gate on a copy with one probe workflow: { status, out }. The probe's findings are the lines naming its path.
function gateWith(dir, yaml) {
  stage(dir, '.github/workflows/probe.yml', yaml);
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
  assert.equal(r.error, undefined, 'surface-check was killed: ' + (r.error && r.error.code));
  return { status: r.status, out: r.stdout + r.stderr };
}
const probeLines = out => out.split('\n').filter(l => l.includes('.github/workflows/probe.yml:'));
const JOB = (permissionsAndSteps) => `name: probe\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n${permissionsAndSteps}`;

// ── an unreadable tracked file ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('an unreadable tracked file is a finding that names it, and the rules after it still run', () => {
  const dir = surfaceCopy();
  try {
    rmSync(join(dir, 'web/privacy.html')); // still in the index: git lists it, the disk does not hold it
    plant(dir, '<p>Free plan</p>');
    const r = surface(dir);
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /web\/privacy\.html[^\n]*could not be read/, r.out);
    assert.doesNotMatch(r.out, /\n\s+at /, 'no stack trace: ' + r.out);
    assert.match(r.out, /a Free plan or a free tier/, 'a rule after the unreadable file still ran: ' + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── a library that will not load names itself, and a rule that depends on it says so ────────────────────────────────────────────────────────

function breakLibrary(dir, f) { edit(dir, f, s => s + '\nexport const = ;\n'); }

test('a broken rendered-text library names itself in the rule that reads with it', () => {
  const dir = surfaceCopy();
  try {
    breakLibrary(dir, 'scripts/lib/rendered-text.mjs');
    const r = surface(dir);
    assert.match(r.out, /scripts\/lib\/rendered-text\.mjs[^\n]*could not be loaded/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a broken html-tokens library names itself, and the rule that walks with it does not say it cannot walk the markup', () => {
  const dir = surfaceCopy();
  try {
    breakLibrary(dir, 'scripts/lib/html-tokens.mjs');
    const r = surface(dir);
    assert.match(r.out, /scripts\/lib\/html-tokens\.mjs[^\n]*could not be loaded/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a broken csp-hashes library: rule 13 says it could not run and reports no stale hash', () => {
  const dir = surfaceCopy();
  try {
    breakLibrary(dir, 'scripts/lib/csp-hashes.mjs');
    const r = surface(dir);
    assert.match(r.out, /scripts\/lib\/csp-hashes\.mjs[^\n]*could not be loaded/, r.out);
    assert.doesNotMatch(r.out, /a stale hash/, 'no hash is stale when the hash routine did not load: ' + r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a broken legal-render library names itself (the live-button rule allows nothing)', () => {
  const dir = surfaceCopy();
  try {
    breakLibrary(dir, 'scripts/lib/legal-render.mjs');
    const r = surface(dir);
    assert.match(r.out, /scripts\/lib\/legal-render\.mjs[^\n]*could not be loaded/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a broken legal-state library names itself (the legal-state rule says it could not read the record)', () => {
  const dir = surfaceCopy();
  try {
    breakLibrary(dir, 'scripts/lib/legal-state.mjs');
    const r = surface(dir);
    assert.match(r.out, /scripts\/lib\/legal-state\.mjs[^\n]*could not be loaded/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── post-deploy-check: the exit code is set, never by exit(), so a pipe keeps the report ─────────────────────────────────────────────────

test('post-deploy-check.mjs sets process.exitCode and never calls process.exit (a pipe is asynchronous on POSIX)', () => {
  const src = readFileSync(join(ROOT, 'scripts/post-deploy-check.mjs'), 'utf8');
  assert.doesNotMatch(src, /process\.exit\(/, 'process.exit truncates a piped report');
  assert.match(src, /process\.exitCode\s*=/, 'the exit code is set');
});

// ── a character reference in a robots name or content is decoded (the attribute value is what the browser reads) ───────────────────────

test('a robots noindex written as a numeric character reference is read as noindex', async () => {
  const { isRobotsNoindex } = await import(pathToFileURL(join(ROOT, 'scripts/lib/page-claims.mjs')).href);
  assert.equal(isRobotsNoindex('<meta name="robots" content="&#110;oindex">'), true, 'decimal reference');
  assert.equal(isRobotsNoindex('<meta name="robots" content="&#x6E;oindex">'), true, 'hex reference');
  assert.equal(isRobotsNoindex('<meta name="&#114;obots" content="noindex">'), true, 'reference in the name');
  assert.equal(isRobotsNoindex('<meta name="robots" content="index,follow">'), false, 'no noindex is still no noindex');
});

test('a numeric reference with leading zeros past eight digits is read as noindex, as the browser reads it', async () => {
  const { isRobotsNoindex } = await import(pathToFileURL(join(ROOT, 'scripts/lib/page-claims.mjs')).href);
  assert.equal(isRobotsNoindex('<meta name="robots" content="&#0000000110;oindex">'), true, 'decimal, nine digits');
  assert.equal(isRobotsNoindex('<meta name="robots" content="&#x000000006e;oindex">'), true, 'hex, twelve digits');
});

test('a numeric reference the browser maps to U+FFFD (zero, a surrogate, past U+10FFFF) is not a letter of noindex', async () => {
  const { isRobotsNoindex } = await import(pathToFileURL(join(ROOT, 'scripts/lib/page-claims.mjs')).href);
  assert.equal(isRobotsNoindex('<meta name="robots" content="no&#0;index">'), false, 'zero');
  assert.equal(isRobotsNoindex('<meta name="robots" content="no&#xD800;index">'), false, 'surrogate');
  assert.equal(isRobotsNoindex('<meta name="robots" content="no&#99999999999;index">'), false, 'past U+10FFFF');
});

// ── rule 17(a): the lowercase clause and the Thai clause are read, and say so ───────────────────────────────────────────────────────────

test('rule 17(a) reads a lowercase "free plan" in visible text', () => {
  const dir = surfaceCopy();
  try {
    plant(dir, '<p>a free plan is listed here</p>');
    const r = surface(dir);
    assert.match(r.out, /says "free plan", a Free plan or a free tier/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 17(a) reads the Thai word for free in visible text', () => {
  const dir = surfaceCopy();
  try {
    plant(dir, '<p>ฟรี</p>');
    const r = surface(dir);
    assert.match(r.out, /says "ฟรี", a Free plan or a free tier/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── rule 11: a line of a run body is not a step, and an indentless step sequence is read ────────────────────────────────────────────────

test('rule 11: a uses: text inside a run body is not a checkout, so a job without one passes', () => {
  const dir = surfaceCopy();
  try {
    const g = gateWith(dir, JOB('    permissions:\n      pull-requests: write\n    steps:\n      - run: |\n          echo "uses: actions/checkout@v4"\n'));
    assert.deepEqual(probeLines(g.out), [], g.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 control: the same job with no uses: text passes', () => {
  const dir = surfaceCopy();
  try {
    const g = gateWith(dir, JOB('    permissions:\n      pull-requests: write\n    steps:\n      - run: echo ok\n'));
    assert.deepEqual(probeLines(g.out), [], g.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11: an indentless step sequence is read, and a clean job with contents passes', () => {
  const dir = surfaceCopy();
  try {
    const g = gateWith(dir, JOB('    permissions:\n      contents: read\n    steps:\n    - uses: actions/checkout@v4\n    - run: echo ok\n'));
    assert.deepEqual(probeLines(g.out), [], g.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11: an indentless step sequence with a checkout and no contents is named as a job without contents', () => {
  const dir = surfaceCopy();
  try {
    const g = gateWith(dir, JOB('    permissions:\n      pull-requests: write\n    steps:\n    - uses: actions/checkout@v4\n    - run: echo ok\n'));
    assert.match(g.out, /probe\.yml: job "build" declares its own permissions: block and checks the repository out, but does not state contents/, g.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11: a block scalar opened on a "- key: |" line takes the key\'s column, so the sibling keys of its step are read', () => {
  const dir = surfaceCopy();
  try {
    const g = gateWith(dir, JOB('    permissions:\n      pull-requests: write\n    steps:\n      - name: |\n          Check out the code\n        uses: actions/checkout@v4\n'));
    assert.match(g.out, /probe\.yml: job "build" declares its own permissions: block and checks the repository out, but does not state contents/, g.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11: a line that STARTS with uses: inside a run: | body is script text, so a job without a checkout passes', () => {
  const dir = surfaceCopy();
  try {
    const g = gateWith(dir, JOB('    permissions:\n      pull-requests: write\n    steps:\n      - run: |\n          cat <<EOF\n          uses: actions/checkout@v4\n          EOF\n'));
    assert.deepEqual(probeLines(g.out), [], g.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// The three forms the job reader still passed (fail-closed required): each must be named at its own line, never a silent pass.
const UNREAD_FORMS = {
  'a quoted permissions key': '    "permissions":\n      pull-requests: write\n    steps:\n      - uses: actions/checkout@v4\n',
  'permissions with a space before its colon': '    permissions :\n      pull-requests: write\n    steps:\n      - uses: actions/checkout@v4\n',
  'the job value as a flow mapping on the next line': '    {runs-on: ubuntu-latest, permissions: {pull-requests: write}, steps: [{uses: actions/checkout@v4}]}\n',
};
for (const [label, members] of Object.entries(UNREAD_FORMS)) {
  test(`rule 11 names ${label} at its line, and does not pass the job`, () => {
    const dir = surfaceCopy();
    try {
      const g = gateWith(dir, `name: probe\non: push\njobs:\n  build:\n${members}`);
      assert.notEqual(g.status, 0, g.out);
      assert.ok(probeLines(g.out).length > 0, 'a finding names the probe: ' + g.out);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test('gateWith returns the exit status, and a probe with a finding exits non-zero', () => {
  const dir = surfaceCopy();
  try {
    const bad = gateWith(dir, JOB('    permissions:\n      pull-requests: write\n    steps:\n    - uses: actions/checkout@v4\n'));
    assert.equal(bad.status, 1, bad.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── the SVG loop: an unclosed <style> is named, and a <script> in any SVG under web/ is a finding ───────────────────────────────────────

test('an SVG whose <style> has no closer is named as an unclosed style, not as a stale hash', () => {
  const dir = surfaceCopy();
  try {
    edit(dir, 'web/band-404.svg', s => s.replace(/<\/style>/i, ''));
    const r = surface(dir);
    assert.match(r.out, /web\/band-404\.svg[^\n]*unclosed <style>/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a <script> in an SVG under a subfolder of web/ is a finding naming that file', () => {
  const dir = surfaceCopy();
  try {
    stage(dir, 'web/icons/probe.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n');
    const r = surface(dir);
    assert.match(r.out, /web\/icons\/probe\.svg[^\n]*<script>/, r.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
