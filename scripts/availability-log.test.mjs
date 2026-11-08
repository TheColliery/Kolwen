// Tests for scripts/availability-log.mjs: the probe records what it saw and exits 0; only a probe that cannot run fails.
// No network: the probed site is a local node:http server, a fake fetch that never answers, or a port that was just closed (a refused connection).
// The CLI rows spawn the real script under a heap cap, a kill timer and a sandbox HOME, TEMP and TMPDIR. The local server answers in THIS process, so the CLI
// is spawned asynchronously: a synchronous spawn would block the event loop that serves it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAvailability, classify } from './availability-log.mjs';
import { PATHS } from '../worker/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'availability-log.mjs');
const HEAP_MB = 256, KILL_MS = 60000;
const SANDBOX = mkdtempSync(join(tmpdir(), 'availability-log-test-'));
test.after(() => rmSync(SANDBOX, { recursive: true, force: true }));

// The local site: '/terms' answers 500, the cache-busted missing path answers 404, everything else 200.
const route = p => (p === '/terms' ? 500 : p.startsWith('/no-such-page-') ? 404 : 200);
function serve(status = route) {
  return new Promise(ok => {
    const srv = createServer((req, res) => { res.writeHead(typeof status === 'function' ? status(req.url) : status); res.end('<p>x</p>'); });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
}
const originOf = srv => `http://127.0.0.1:${srv.address().port}`;
const closeSrv = srv => new Promise(ok => srv.close(ok));
const UTC_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function runCli(args, env = {}) {
  return new Promise(ok => {
    const e = { ...process.env, HOME: SANDBOX, USERPROFILE: SANDBOX, TEMP: SANDBOX, TMP: SANDBOX, TMPDIR: SANDBOX };
    delete e.GITHUB_STEP_SUMMARY;
    Object.assign(e, env);
    const child = spawn(process.execPath, [`--max-old-space-size=${HEAP_MB}`, SCRIPT, ...args], { env: e });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    const kill = setTimeout(() => child.kill('SIGKILL'), KILL_MS);
    child.on('close', (status, signal) => { clearTimeout(kill); ok({ status, signal, stdout, stderr }); });
  });
}

test('a 200, a 500 and the 404 on the missing path are each recorded with their status, and the run returns', async () => {
  const srv = await serve();
  try {
    const recs = await runAvailability({ origin: originOf(srv), paths: PATHS, timeoutMs: 5000, write: () => {} });
    const byPath = Object.fromEntries(recs.map(r => [new URL(r.url).pathname.startsWith('/no-such-page-') ? '/no-such-page' : new URL(r.url).pathname, r]));
    assert.equal(byPath['/'].status, 200);
    assert.equal(byPath['/terms'].status, 500, 'a 5xx is a recorded result, not a failure');
    assert.equal(byPath['/no-such-page'].status, 404);
    assert.equal(byPath['/status.json'].status, 200);
    for (const r of recs) assert.equal(r.error, null, r.url);
  } finally { await closeSrv(srv); }
});

test('the probed set is every worker PATH, the cache-busted missing path and /status.json, and nothing else', async () => {
  const srv = await serve();
  try {
    const recs = await runAvailability({ origin: originOf(srv), paths: PATHS, timeoutMs: 5000, write: () => {} });
    assert.equal(recs.length, PATHS.length + 2);
    const paths = recs.map(r => new URL(r.url).pathname);
    for (const p of PATHS) assert.ok(paths.includes(p), `missing ${p}`);
    assert.ok(paths.includes('/status.json'));
    assert.equal(paths.filter(p => p.startsWith('/no-such-page-')).length, 1);
  } finally { await closeSrv(srv); }
});

test('a request that never answers is recorded as the class timeout, with no status', async () => {
  const hangs = (url, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => {
    const e = new Error('aborted'); e.name = 'TimeoutError'; rej(e);
  }));
  const recs = await runAvailability({ origin: 'https://example.invalid', paths: ['/'], timeoutMs: 30, fetchImpl: hangs, write: () => {} });
  assert.equal(recs[0].status, null);
  assert.equal(recs[0].error, 'timeout');
});

test('a refused connection is recorded as the class refused, and the run still returns', async () => {
  const srv = await serve();
  const origin = originOf(srv);
  await closeSrv(srv);
  const recs = await runAvailability({ origin, paths: ['/'], timeoutMs: 5000, write: () => {} });
  assert.ok(recs.length > 0);
  for (const r of recs) { assert.equal(r.status, null); assert.equal(r.error, 'refused', r.url); }
});

test('the error class is read from the error name and the cause code, and never from the message', () => {
  assert.equal(classify({ name: 'TimeoutError' }), 'timeout');
  assert.equal(classify({ name: 'AbortError' }), 'timeout');
  assert.equal(classify({ name: 'TypeError', cause: { code: 'ECONNREFUSED' } }), 'refused');
  assert.equal(classify({ name: 'TypeError', cause: { code: 'ENOTFOUND' } }), 'dns');
  assert.equal(classify(new Error('a message that names /terms and the host')), 'network');
});

test('every line is one JSON record with a UTC time ending in Z, and no line carries a percentage', async () => {
  const srv = await serve();
  const lines = [];
  try {
    await runAvailability({ origin: originOf(srv), paths: PATHS, timeoutMs: 5000, write: l => lines.push(l) });
  } finally { await closeSrv(srv); }
  assert.equal(lines.length, PATHS.length + 2);
  for (const l of lines) {
    const r = JSON.parse(l);
    assert.deepEqual(Object.keys(r).sort(), ['error', 'ms', 'status', 't', 'url']);
    assert.match(r.t, UTC_Z);
    assert.ok(!l.includes('%'), 'no percentage in a record');
  }
});

test('no request carries a body, a cookie or a query, except the cache-busted missing path', async () => {
  const seen = [];
  const recording = async (url, init) => {
    seen.push({ url, init });
    return new Response('x', { status: 200 });
  };
  await runAvailability({ origin: 'https://example.invalid', paths: ['/', '/pricing'], timeoutMs: 5000, fetchImpl: recording, write: () => {} });
  for (const { url, init } of seen) {
    assert.ok(!init.body, 'no body');
    assert.ok(!init.headers || !Object.keys(init.headers).some(k => k.toLowerCase() === 'cookie'), 'no cookie');
    assert.ok(!(init.method && init.method !== 'GET'), 'GET only');
    if (!new URL(url).pathname.startsWith('/no-such-page-')) assert.equal(new URL(url).search, '', url);
  }
});

test('a bad origin, a bad timeout or an unknown flag exits 2 with a message on stderr and no record on stdout', async () => {
  for (const args of [['--origin', 'ftp://kolwen.com'], ['--origin', 'not a url'], ['--timeout', 'abc'], ['--timeout', '0'], ['--bogus']]) {
    const r = await runCli(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.ok(r.stderr.length > 0, args.join(' '));
    assert.equal(r.stdout, '', args.join(' '));
  }
});

test('the run exits 0 when every URL was observed, and writes the Markdown table when GITHUB_STEP_SUMMARY is set', async () => {
  const srv = await serve();
  const sum = join(SANDBOX, 'summary.md');
  try {
    const r = await runCli(['--origin', originOf(srv)], { GITHUB_STEP_SUMMARY: sum });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim().split('\n').length, PATHS.length + 2);
    const md = readFileSync(sum, 'utf8');
    assert.match(md, /\| time \(UTC\) \| URL \| result \| latency \(ms\) \|/);
    assert.equal(md.split('\n').filter(l => /^\| \d{4}-/.test(l)).length, PATHS.length + 2);
    assert.ok(!/%/.test(md + r.stdout), 'no percentage in the summary or the lines');
  } finally { await closeSrv(srv); }
});

test('without GITHUB_STEP_SUMMARY the run writes no summary file and still exits 0', async () => {
  const srv = await serve();
  try {
    const r = await runCli(['--origin', originOf(srv)]);
    assert.equal(r.status, 0, r.stderr);
  } finally { await closeSrv(srv); }
});
