#!/usr/bin/env node
// Hermetic spawn tests for scripts/secret-gate.mjs (LWK-239): the real entry file is run against a throwaway git
// repository, and the exit code, the sanctioned output and the effect are asserted. PORTABLE like the gate: node builtins
// only, no repository path or name, so a sibling repo copies it beside the gate unchanged.
//
// NAMED DIVERGENCE from the org canon's secret-gate.test.mjs (the template copy in the org repo). This file is NOT
// byte-equal to it, on purpose: the canon test asserts a newer gate than this room runs. The canon gate scans the STAGED
// blobs, drops an inherited GIT_DIR and honours GIT_INDEX_FILE; this room's gate (scripts/secret-gate.mjs, a different
// blob) still reads the working-tree copy of each tracked path and names that as its routed limit. Those canon tests
// (a staged key removed from the working tree, a hook-inherited GIT_DIR, a commit's own index, an unreadable or damaged
// staged blob) would fail here for a reason that is the gate's, not the test's. This room keeps its own test file and
// its own tests, and takes from the canon the part that does not depend on the gate: the test's SANDBOX (below). When
// the room adopts the canon gate, it adopts the canon test with it, byte-equal, and this note goes.
//
// THE SANDBOX. The fixtures must not depend on, or write into, the developer's own machine. Every fixture folder lives in
// ONE sandbox of the test's own, every child's TEMP, TMP, TMPDIR, HOME and USERPROFILE point at it, and the developer's
// global git configuration (a hooks path, a signing rule, a template directory) never applies: GIT_CONFIG_GLOBAL is an
// empty file of the sandbox and the system config is off. The last test plants a hostile global config and proves it.
//
// NO SECRET-SHAPED LITERAL APPEARS IN THIS FILE. The sample key is assembled at runtime from fragments.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE = path.join(HERE, 'secret-gate.mjs');
const LIB = path.join(HERE, 'lib', 'secret-scan.mjs');
const KEY = ['AK', 'IA', 'ABCDEFGHIJKLMNOP'].join(''); // an access-key-id shape, assembled so this file never carries one
const ZERO = '0'.repeat(40);
const made = [];
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-sandbox-'));
const EMPTY_GLOBAL = path.join(SANDBOX, 'empty-global-gitconfig');
fs.writeFileSync(EMPTY_GLOBAL, '');
// A hook runs with GIT_DIR, GIT_INDEX_FILE and friends set; a fixture that inherited them would write into the repository
// the hook runs for. Every fixture git call, and the gate under test, gets an environment without them.
const gitEnv = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k))),
  TEMP: SANDBOX, TMP: SANDBOX, TMPDIR: SANDBOX, HOME: SANDBOX, USERPROFILE: SANDBOX,
  GIT_CONFIG_GLOBAL: EMPTY_GLOBAL, GIT_CONFIG_NOSYSTEM: '1',
});

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv() }).trim();
}

// A throwaway repository holding the gate and its scanner, with one commit per entry of `commits` ({ file: text } maps;
// a null text deletes the file).
function repo(commits, { withLib = true } = {}) {
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'secret-gate-'));
  made.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.invalid');
  git(dir, 'config', 'user.name', 'test');
  git(dir, 'config', 'commit.gpgsign', 'false');
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'secret-gate.mjs'));
  if (withLib) fs.copyFileSync(LIB, path.join(dir, 'scripts', 'lib', 'secret-scan.mjs'));
  commits.forEach((files, i) => {
    for (const [f, text] of Object.entries(files)) {
      const p = path.join(dir, f);
      if (text === null) fs.rmSync(p, { force: true });
      else { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text, 'utf8'); }
    }
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', `commit ${i + 1}`);
  });
  return dir;
}

function run(dir, args = [], input = '') {
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'secret-gate.mjs'), ...args], {
    cwd: dir, input, encoding: 'utf8', timeout: 60000,
    env: { ...gitEnv(), HOME: dir, USERPROFILE: dir },
  });
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' };
}

test.after(() => { for (const d of [...made, SANDBOX]) fs.rmSync(d, { recursive: true, force: true }); });

test('a clean tree passes: exit 0 and a PASS SECRETS line naming the files scanned', () => {
  const r = run(repo([{ 'README.md': 'hello\n' }]));
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /^PASS SECRETS: tree scan of \d+ tracked text file\(s\) clean/m);
});

test('a tracked file carrying a key shape fails: exit 1, file, line and pattern named, the value never printed', () => {
  const r = run(repo([{ 'notes.txt': `a\nb ${KEY} c\n` }]));
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: 1 secret-shaped match\(es\)/);
  assert.match(r.out, /tree "notes\.txt":2 aws-access-key-id \(fp [0-9a-f]{16}\)/);
  assert.ok(!r.out.includes(KEY) && !r.err.includes(KEY), 'the matched value must never be printed');
});

test('an ack silences a hit only when it is committed: the fingerprint in a committed secret-scan.acks passes, an uncommitted one does not', () => {
  const dir = repo([{ 'notes.txt': `x ${KEY}\n` }]);
  const fp = run(dir).out.match(/fp ([0-9a-f]{16})/)[1];
  fs.writeFileSync(path.join(dir, 'secret-scan.acks'), `${fp}  # a known public value\n`, 'utf8');
  assert.strictEqual(run(dir).code, 1, 'an ack that is only in the working tree silences nothing');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'ack');
  const r = run(dir);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /1 acknowledged hit\(s\) via secret-scan\.acks/);
});

test('a line of secret-scan.acks that is not a 16-hex fingerprint fails loud instead of guessing', () => {
  const r = run(repo([{ 'secret-scan.acks': 'not-a-fingerprint\n', 'a.txt': 'x\n' }]));
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: secret-scan\.acks line\(s\) .* are not a 16-hex fingerprint/);
});

test('--pre-push scans the added lines of every pushed commit: a key added and deleted inside the range is still found', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'k.txt': `${KEY}\n` }, { 'k.txt': null }]);
  assert.strictEqual(run(dir).code, 0, 'the tree at HEAD is clean');
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /pushed [0-9a-f]{12} "k\.txt":1 aws-access-key-id/);
});

test('--pre-push with a clean range passes and says what it read; with no refs on stdin it says there is nothing to scan', () => {
  const dir = repo([{ 'a.txt': 'one\n' }, { 'b.txt': 'two\n' }]);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip} refs/heads/main ${ZERO}\n`);
  assert.strictEqual(r.code, 0, r.out + r.err);
  assert.match(r.out, /pushed range: 1 ref\(s\), 2 commit\(s\)/);
  assert.match(run(dir, ['--pre-push'], '').out, /no refs on stdin, nothing to scan/);
});

test('a pushed tag whose target is not a commit is refused by name, never scanned unread', () => {
  const dir = repo([{ 'a.txt': 'one\n' }]);
  const blob = git(dir, 'hash-object', '-w', 'a.txt');
  const r = run(dir, ['--pre-push'], `refs/tags/x ${blob} refs/tags/x ${ZERO}\n`);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: .*pushes a non-commit object \(blob\)/);
});

test('--pre-push with a ref line the scanner cannot read FAILS: exit 1 and the could-not-be-read line, never a pass in tree mode', () => {
  const dir = repo([{ 'a.txt': 'one\n' }]);
  const tip = git(dir, 'rev-parse', 'HEAD');
  const r = run(dir, ['--pre-push'], `refs/heads/main ${tip}\n`); // the remote half of the ref line is missing
  assert.strictEqual(r.code, 1, r.out + r.err);
  assert.match(r.out, /FAIL SECRETS: the pushed range could not be read/);
  assert.doesNotMatch(r.out, /PASS SECRETS/);
});

test('a scan that cannot run fails: a missing scanner and a directory that is not a repository both exit 1 with a FAIL line', () => {
  const noLib = run(repo([{ 'a.txt': 'x\n' }], { withLib: false }));
  assert.strictEqual(noLib.code, 1);
  assert.match(noLib.out, /FAIL SECRETS: scripts\/lib\/secret-scan\.mjs could not load/);
  assert.ok(!/at .*:\d+:\d+/.test(noLib.out + noLib.err), 'no stack frame');
  const dir = fs.mkdtempSync(path.join(SANDBOX, 'secret-gate-nogit-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(GATE, path.join(dir, 'scripts', 'secret-gate.mjs'));
  fs.copyFileSync(LIB, path.join(dir, 'scripts', 'lib', 'secret-scan.mjs'));
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.out, /FAIL SECRETS: .*not inside a git repository/);
});

test('--help prints the usage and exits 0; an unknown flag is an error with the usage on stderr (64)', () => {
  const dir = repo([{ 'a.txt': 'x\n' }]);
  const h = run(dir, ['--help']);
  assert.strictEqual(h.code, 0);
  assert.match(h.out, /^usage: node scripts\/secret-gate\.mjs/);
  const u = run(dir, ['--bogus']);
  assert.strictEqual(u.code, 64);
  assert.match(u.err, /unknown argument "--bogus"/);
  assert.match(u.err, /usage: node scripts\/secret-gate\.mjs/);
  assert.strictEqual(u.out, '');
});

test('a file name that carries a right-to-left override is escaped in the report, never printed raw', () => {
  const rlo = String.fromCharCode(0x202e);
  const name = `evil${rlo}gnp.txt`; // category Cf: legal on every filesystem we run on, and it reorders the text a terminal shows
  const dir = repo([{ [name]: `${KEY}\n` }]);
  const r = run(dir);
  assert.strictEqual(r.code, 1);
  assert.ok(!r.out.includes(rlo), 'the override character must not reach the terminal');
  assert.ok(r.out.includes(String.fromCharCode(92) + 'u202e'), r.out);
});

// The witness for the sandbox. It plants a hostile global git config (an executable hooks path whose pre-commit hook exits 1)
// and a hostile HOME in the test process itself, then builds a fixture and probes a child. Under the old code every fixture
// commit failed with the hostile hook's exit 1; with the sandbox the fixture commits work, the fixture folder lives inside the
// sandbox, the child's TEMP, TMP and TMPDIR point at it, and its global config is an empty file of the sandbox.
test('the fixtures run in the test\'s own sandbox: a hostile global git config and HOME never reach them, and the fixture folders live inside the sandbox', () => {
  const hostile = fs.mkdtempSync(path.join(os.tmpdir(), 'secret-gate-hostile-'));
  made.push(hostile);
  const hooks = path.join(hostile, 'hooks');
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\necho hostile global hook >&2\nexit 1\n', { mode: 0o755 });
  const hostileConfig = '[core]\n\thooksPath = ' + hooks.replace(/\\/g, '/') + '\n';
  fs.writeFileSync(path.join(hostile, '.gitconfig'), hostileConfig); // the per-user file (HOME)
  fs.mkdirSync(path.join(hostile, 'git'));
  fs.writeFileSync(path.join(hostile, 'git', 'config'), hostileConfig); // the XDG file (XDG_CONFIG_HOME), which HOME alone does not cover
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL };
  process.env.HOME = hostile; process.env.USERPROFILE = hostile; process.env.XDG_CONFIG_HOME = hostile;
  process.env.GIT_CONFIG_GLOBAL = path.join(hostile, '.gitconfig');
  try {
    const dir = repo([{ 'a.txt': 'x\n' }]); // a commit under the hostile global hook would fail with exit 1
    assert.ok(path.resolve(dir).startsWith(path.resolve(SANDBOX) + path.sep), 'the fixture folder is inside the sandbox: ' + dir);
    const probe = execFileSync(process.execPath, ['-e', 'const e = process.env; console.log(JSON.stringify([e.TEMP, e.TMP, e.TMPDIR, e.GIT_CONFIG_GLOBAL, e.GIT_CONFIG_NOSYSTEM]))'], { encoding: 'utf8', timeout: 60000, env: gitEnv() });
    const [tmp, tmp2, tmpdir, global, nosys] = JSON.parse(probe);
    assert.deepEqual([tmp, tmp2, tmpdir], [SANDBOX, SANDBOX, SANDBOX]);
    assert.equal(path.dirname(global), SANDBOX);
    assert.equal(fs.readFileSync(global, 'utf8'), '', 'the global config is an empty file of the sandbox');
    assert.equal(nosys, '1');
    // And a child git call itself cannot read the box's global configuration: the hooks path the hostile file sets is not seen.
    const seen = spawnSync('git', ['-C', dir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8', timeout: 60000, env: gitEnv() });
    assert.strictEqual(seen.status, 1, 'git config --get core.hooksPath finds nothing (exit 1): ' + seen.stdout);
    assert.strictEqual(seen.stdout.trim(), '');
  } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});
