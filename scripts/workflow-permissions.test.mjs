// Tests for surface-check rule 11 (a job-level `permissions:` block that checks the repository out must state `contents`), and for the line reader behind it.
//
// The rule reads workflow YAML by lines, so every row here plants ONE workflow in a throwaway repository of the tracked files and runs the real scripts/surface-check.mjs
// on it. Each row asserts the finding by file and line. A form the reader cannot read is a FINDING, never a pass: the reader fails closed on what it does not read, and
// each row below is a spelling a valid workflow may use that the old reader passed or misnamed. Each child runs under a heap cap and a kill timer, and no time is asserted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const childEnv = dir => { const home = join(dir, '.sandbox-home'); mkdirSync(home, { recursive: true }); return { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home }; };

// The tracked files of this tree in a throwaway repository (surface-check reads the tracked files with git).
function surfaceCopy() {
  const dir = mkdtempSync(join(tmpdir(), 'rule11-'));
  const env = childEnv(dir);
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', timeout: 30000 }).stdout.split('\0').filter(Boolean);
  for (const f of files) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(join(ROOT, f))); }
  for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(spawnSync('git', args, { cwd: dir, env, timeout: 60000 }).status, 0, 'git ' + args[0]);
  return dir;
}
// One probe workflow, staged so that git lists it, then the real gate on the copy. Returns the exit status and the output.
function gateWith(dir, yaml) {
  mkdirSync(join(dir, '.github/workflows'), { recursive: true });
  writeFileSync(join(dir, '.github/workflows/probe.yml'), yaml);
  assert.equal(spawnSync('git', ['add', '-A'], { cwd: dir, env: childEnv(dir), timeout: 60000 }).status, 0);
  const r = spawnSync(process.execPath, ['--max-old-space-size=512', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir), maxBuffer: 64 << 20 });
  assert.equal(r.error, undefined, 'surface-check was killed: ' + (r.error && r.error.code));
  return { status: r.status, out: r.stdout + r.stderr };
}
// The findings of the probe workflow only (the rest of the tree passes the gate, which the baseline test holds).
const probeLines = out => out.split('\n').filter(l => l.includes('.github/workflows/probe.yml:'));

test('gateWith returns the exit status: a probe with a finding exits 1, and a probe with none exits 0', () => {
  const dir = surfaceCopy();
  try {
    const bad = gateWith(dir, 'name: probe\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions:\n      pull-requests: write\n    steps:\n    - uses: actions/checkout@v4\n');
    assert.equal(bad.status, 1, bad.out);
    assert.ok(probeLines(bad.out).length > 0, bad.out);
    const good = gateWith(dir, 'name: probe\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n    - uses: actions/checkout@v4\n');
    assert.equal(good.status, 0, good.out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('baseline: the tracked tree passes surface-check, so each row below is the probe alone', () => {
  const dir = surfaceCopy();
  try {
    const r = spawnSync(process.execPath, ['--max-old-space-size=512', join(dir, 'scripts/surface-check.mjs')], { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL', cwd: dir, env: childEnv(dir) });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a clean workflow is not a finding: a block that states contents, and an empty block, read and pass', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  reads:', '    runs-on: ubuntu-latest', '    permissions:', '      contents: read', '    steps:', '      - uses: actions/checkout@v4',
      '  empty:', '    runs-on: ubuntu-latest', '    permissions: {}', '    steps:', '      - run: true', '',
    ].join('\n'));
    assert.deepEqual(probeLines(out), [], out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 reads a flow permissions value: "permissions: { pull-requests: write }" on a job that checks out is a finding, not a pass', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    permissions: { pull-requests: write }', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 6: permissions: value "\{ pull-requests: write \}" is not one this reader reads/m, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 reads a permissions key with a trailing comment as a block: the members are read, and a job without contents is a finding', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    permissions: # least privilege', '      pull-requests: write', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: job "probe" declares its own permissions: block and checks the repository out, but does not state contents:/m, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 reads a quoted uses: by stripping its quotes: "actions/checkout@v4" in quotes is a checkout, and its job without contents is a finding', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    permissions:', '      pull-requests: write', '    steps:', '      - uses: "actions/checkout@v4"', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: job "probe" declares its own permissions: block and checks the repository out, but does not state contents:/m, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 does not pass an anchor or an alias for permissions: neither job is read, so both are findings', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  first:', '    runs-on: ubuntu-latest', '    permissions: &p', '      pull-requests: write', '    steps:', '      - run: true',
      '  second:', '    runs-on: ubuntu-latest', '    permissions: *p', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 6: permissions: value "&p" is not one this reader reads/m, out);
    assert.match(out, /\.github\/workflows\/probe\.yml: line 12: permissions: value "\*p" is not one this reader reads/m, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 names a job key with text after its colon, names that one job, and does not hand its members to the job above', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  first:', '    runs-on: ubuntu-latest', '    steps:', '      - run: true',
      '  probe: {runs-on: ubuntu-latest}', '    permissions:', '      pull-requests: write', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 8: job "probe" has text after its colon, so this reader cannot read this job/, out);
    assert.doesNotMatch(out, /job "first" declares/, 'the members of "probe" are not read as members of "first": ' + out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 reads a job key with a trailing comment as the key it is: "probe:   # the probe job" is job "probe", and its missing contents is named for that job', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:   # the probe job', '    runs-on: ubuntu-latest', '    permissions:', '      pull-requests: write', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.doesNotMatch(out, /probe\.yml: line \d+: job "probe" has text after its colon/, out);
    assert.match(out, /\.github\/workflows\/probe\.yml: job "probe" declares its own permissions: block and checks the repository out, but does not state contents:/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 fails closed on a quoted member key at job-member indent: "permissions": is not read, so the job cannot be passed', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    "permissions":', '      pull-requests: write', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 6: a line at job-member indent in job "probe" is not a plain key: value line/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 fails closed on a spaced member key: "permissions :" (a space before the colon) is not read', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    permissions :', '      pull-requests: write', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 6: a line at job-member indent in job "probe" is not a plain key: value line/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 fails closed on a job whose value is a flow mapping on the next line', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    {runs-on: ubuntu-latest, permissions: {pull-requests: write}, steps: [{uses: actions/checkout@v4}]}', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 5: a line at job-member indent in job "probe" is not a plain key: value line/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 names a line inside a permissions: block that is not a key: value line, and does not pass the job', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    permissions:', '      "contents": read', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 7: a line inside permissions: is not a key: value line this reader reads/, out);
    assert.doesNotMatch(out, /job "probe" declares its own permissions: block/, 'one finding for the line, not a second for the job: ' + out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rule 11 names an unread permissions value and not the job it sits in: one finding per fault', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '    runs-on: ubuntu-latest', '    permissions: { pull-requests: write }', '    steps:', '      - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: line 6: permissions: value "\{ pull-requests: write \}" is not one this reader reads/, out);
    assert.doesNotMatch(out, /job "probe" declares its own permissions: block/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A job's members sit at the indent its first member line sets (valid YAML at any indent), so a job at 6 or 3 spaces is read as a job at 4 is.
test('rule 11 reads job members at 6 spaces: a job that checks out and states no contents is a finding', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '      runs-on: ubuntu-latest', '      permissions:', '        pull-requests: write', '      steps:', '        - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: job "probe" declares its own permissions: block and checks the repository out, but does not state contents:/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rule 11 reads job members at 3 spaces: a job that checks out and states no contents is a finding', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '   runs-on: ubuntu-latest', '   permissions:', '     pull-requests: write', '   steps:', '     - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.match(out, /\.github\/workflows\/probe\.yml: job "probe" declares its own permissions: block and checks the repository out, but does not state contents:/, out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('rule 11 reads a clean job at 6 spaces: a permissions block that states contents passes', () => {
  const dir = surfaceCopy();
  try {
    const { out } = gateWith(dir, [
      'name: probe', 'on: push', 'jobs:',
      '  probe:', '      runs-on: ubuntu-latest', '      permissions:', '        contents: read', '      steps:', '        - uses: actions/checkout@v4', '',
    ].join('\n'));
    assert.deepEqual(probeLines(out), [], out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
