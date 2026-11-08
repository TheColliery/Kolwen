// Kolwen availability log: what the public site answered, recorded from wherever this runs.
//
// What it probes, at https://kolwen.com (or --origin <url>): every path in worker/index.mjs PATHS, one cache-busted missing path (its record shows the status;
// 404 is the expected answer), and /status.json.
// What it records, per URL, one JSON line on stdout: the time in UTC with a trailing Z, the URL, the HTTP status or the error class (timeout, refused, dns,
// network), and the latency in ms. It records no request content, no response body, no cookies and no visitor data, and it computes no uptime percentage.
// The request is a fixed GET with a generic user agent and no identifier. When GITHUB_STEP_SUMMARY is set, the same records are appended to that file as a
// Markdown table.
//
// Usage: node scripts/availability-log.mjs [--origin <url>] [--timeout <ms>]     (--help prints the usage line)
// Exit 0 = the probe ran and observed every URL. A down page, a 5xx, a refused connection or a timeout is a RECORDED result, never a failure.
// Exit 2 = a bad argument (an origin that is not http(s), a timeout that is not a positive whole number, an unknown flag). Nothing is probed.
// Exit 1 = the probe itself could not run, or could not append its summary (a script error, or a summary file that cannot be written).
//
// Limits: kolwen.com refused every attempt from a GitHub runner until 2026-10-02 (the R1 comment in scripts/post-deploy-check.mjs). A refusal from a runner is the
// site's answer and is recorded as such, not as a probe failure. A run from this machine or another host is a different vantage point, and the record says
// only what that host saw. Zero dependencies: Node builtins only.
import { appendFileSync } from 'node:fs';
import { missPath } from './lib/served-probe.mjs';
import { isMainModule } from './lib/entry-guard.mjs';

const DEFAULT_ORIGIN = 'https://kolwen.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const STATUS_PATH = '/status.json';
const USER_AGENT = 'kolwen-availability-log';
const USAGE = 'usage: node scripts/availability-log.mjs [--origin <url>] [--timeout <ms>]\n';

class UsageError extends Error {}

// The error class of a request that got no response. The class is read from the error's name and its cause's code, never from its message: a message may name
// the URL or the host, and a record carries the class only.
export function classify(e) {
  const code = e?.cause?.code ?? e?.code;
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return 'timeout';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns';
  return 'network';
}

// The paths to probe, in order: every given path, then the cache-busted missing path, then the status endpoint.
export function targetsFor(paths) {
  // missPath has no leading slash (post-deploy-check joins it to an origin that ends in one); here the origin has none, so the slash is added.
  return [...paths, '/' + missPath(), STATUS_PATH];
}

// One GET. A status is recorded whatever it is; a request that got no response is recorded with its class and no status.
export async function probeOne(origin, path, { fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = origin + path;
  const started = Date.now();
  const t = new Date(started).toISOString();
  try {
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': USER_AGENT, 'cache-control': 'no-cache' } });
    try { await res.body?.cancel(); } catch { /* the body is never read */ }
    return { t, url, status: res.status, error: null, ms: Date.now() - started };
  } catch (e) {
    return { t, url, status: null, error: classify(e), ms: Date.now() - started };
  }
}

// Probes every target once, in order, and hands each record to write as one line. Returns the records.
export async function runAvailability({ origin = DEFAULT_ORIGIN, paths, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch, write = line => process.stdout.write(line + '\n') } = {}) {
  const records = [];
  for (const path of targetsFor(paths)) {
    const r = await probeOne(origin, path, { fetchImpl, timeoutMs });
    records.push(r);
    write(JSON.stringify(r));
  }
  return records;
}

// The records as a Markdown table, for the run's step summary. A row is the record itself: no verdict is added.
export function summaryTable(records) {
  const head = ['| time (UTC) | URL | result | latency (ms) |', '| --- | --- | --- | --- |'];
  const rows = records.map(r => `| ${r.t} | ${r.url} | ${r.error ? r.error : r.status} | ${r.ms} |`);
  return [...head, ...rows, ''].join('\n') + '\n';
}

// The arguments, or a UsageError naming the one that is wrong. The origin is kept as its origin only (no path, no query).
export function parseArgs(argv) {
  const out = { origin: DEFAULT_ORIGIN, timeoutMs: DEFAULT_TIMEOUT_MS, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a === '--origin' || a === '--timeout') {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${a} needs a value`);
      if (a === '--origin') {
        let u = null;
        try { u = new URL(v); } catch { /* reported below */ }
        if (!u || !/^https?:$/.test(u.protocol)) throw new UsageError(`--origin needs an http(s) URL, got ${JSON.stringify(v)}`);
        out.origin = u.origin;
      } else {
        if (!/^\d+$/.test(v) || Number(v) <= 0) throw new UsageError(`--timeout needs a positive whole number of ms, got ${JSON.stringify(v)}`);
        out.timeoutMs = Number(v);
      }
      continue;
    }
    throw new UsageError(`unknown argument ${JSON.stringify(a)}`);
  }
  return out;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  let opts;
  try { opts = parseArgs(argv); }
  catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`availability-log: ${e.message}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (opts.help) { process.stdout.write(USAGE); process.exitCode = 0; return; }
  try {
    // The worker's list is read here, after the guard: a bare copy of scripts/ has no worker/ and must run nothing on an import.
    const { PATHS: paths } = await import(new URL('../worker/index.mjs', import.meta.url).href);
    const records = await runAvailability({ origin: opts.origin, paths, timeoutMs: opts.timeoutMs });
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summaryTable(records));
    process.exitCode = 0;
  } catch (e) {
    // The code or the name only: a message can echo a path from the summary file or the system.
    process.stderr.write(`availability-log could not run: ${e?.code || e?.name || 'error'}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule(import.meta.url)) await main();
