// Kolwen post-deploy smoke check — is what is SERVED what we committed?
//
// Closes LWK-077 O1-O3: Workers Builds deploys on push, outside Actions, and has silently
// produced no build at all before (acf684f served stale content until a human curled it).
//
// Usage: node scripts/post-deploy-check.mjs [--wait <seconds>] [--origin <url>]
// Exit 0 = every deployed file matches and the served security headers are the ones web/_headers declares.
// Exit 1 = a mismatch, or nothing could be observed. Exit 2 = a bad argument, or nothing declared to compare.
// --origin checks ONE host instead of the two production origins: a preview URL, a workers.dev host, or a local
// server. Zone-only headers (HSTS, nosniff) and the production noindex rail apply to kolwen.com hosts alone.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseHeadersFile, declaredSecurityHeaders, servedHeaderMisses, robotsRailMisses, notFoundVerdict } from './lib/headers-file.mjs';

const args = process.argv.slice(2);
const w = args.indexOf('--wait');
const o = args.indexOf('--origin');
// R5: --wait with no value yielded NaN, the loop never ran, and the script printed the exact
// words of a real outage. The one message this must be incapable of faking.
let budget = 240;
if (w >= 0) {
  const v = Number(args[w + 1]);
  if (!Number.isFinite(v) || v <= 0) { console.error(`--wait needs a positive number, got ${JSON.stringify(args[w + 1])}`); process.exit(2); }
  budget = v;
}
// LWK-168: --wait is a promise about how long this job runs, so it is a DEADLINE, computed once.
// `budget` used to be read only at the top of each round, and the fetch() calls below carried no
// timeout, so a request that never answered held the job open long past `--wait 300`.
const started = Date.now();
const deadline = started + budget * 1000;

// R1: kolwen.com refuses datacenter egress (HTTP 403 on every attempt from a GitHub runner,
// 200 from a residential IP — measured). The workers.dev origin serves the same deployment and
// may not carry the same edge rules, so the second is tried when the first does not ANSWER --
// a mismatching first origin is not second-guessed, by design. If NEITHER answers, that is
// reported as an observation failure — never as a pass.
let ORIGINS = ['https://kolwen.com/', 'https://kolwen.hetcreep.workers.dev/'];
if (o >= 0) {
  let u = null;
  try { u = new URL(args[o + 1]); } catch { /* reported below */ }
  if (!u || !/^https?:$/.test(u.protocol)) { console.error(`--origin needs an http(s) URL, got ${JSON.stringify(args[o + 1])}`); process.exit(2); }
  ORIGINS = [u.origin + '/'];
}

// LWK-211: what web/_headers declares for every response. Read once; a file that declares none of it is a
// finding, not a pass, because a served-header check with nothing to compare against would print success.
let DECLARED;
try { DECLARED = declaredSecurityHeaders(parseHeadersFile(readFileSync('web/_headers', 'utf8'))); }
catch (e) { console.error('post-deploy check cannot compare served headers: ' + e.message); process.exit(2); }
// Per response: HTML must carry the declared headers (and, on a production host, the zone's HSTS and nosniff);
// EVERY response from a production host must be free of X-Robots-Tag.
const NOTES = new Set();
const headerMisses = (origin, r, what, html) => {
  const host = new URL(origin).hostname;
  const out = robotsRailMisses(host, r.headers);
  if (html) out.push(...servedHeaderMisses(host, r.headers, DECLARED));
  return out.map(m => `${what}: ${m}`);
};

// R4: strip Cloudflare's injected script STRUCTURALLY — any script mentioning /cdn-cgi/ or its
// __CF$cv$params global — rather than by a byte-prefix of today's minified output. A literal
// prefix breaks the day the edge changes its bundler, reddening a correct deploy.
const CF_INJECT = /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:\/cdn-cgi\/|__CF\$cv\$params)(?:(?!<\/script>)[\s\S])*?<\/script>/g;
// Applied to a FIXED POINT, not once. This closes the ITERATE-ONCE case, where removing one
// match reveals another (CodeQL js/incomplete-multi-character-sanitization). It does NOT close
// the reassembly case: stripping a match can weld "<scr" to "ipt>" into a fresh "<script" that
// carries no /cdn-cgi/ marker and so is never matched again. That is survivable here for the
// reason on the line above and only for that reason — this output is compared for equality and
// never re-served as HTML. The loop is an improvement, not a sanitizer.
const stripEdge = t => { let prev; do { prev = t; t = t.replace(CF_INJECT, ''); } while (t !== prev); return t; };
const normHtml = t => stripEdge(t.replace(/\r\n/g, '\n')).replace(/\n{2,}/g, '\n').trim();
const sha = b => createHash('sha256').update(b).digest('hex').slice(0, 16);

// R3: check every served file, not just index.html -- checking only index.html would have
// printed "deploy confirmed" for a commit that changed sitemap.xml and never looked at it.
// NOT recursive, and that is safe only because something else keeps web/ flat:
// surface-check.mjs holds an allowlist of the files we ship and fails on any other tracked
// path under web/, and it is a required CI context. If that allowlist ever admits a
// subdirectory, this line must become recursive or a deployed file goes unchecked.

// SHIPPED BUT NOT FETCHABLE. Cloudflare parses `_headers` and, in its own words, the file
// "will not itself be served as a static asset" — so fetching it returns the 404 page, the
// comparison fails, and this gate would red on every deploy forever. Verified at the docs,
// 2026-09-05. Anything else with that property joins this list; nothing else is exempt.
const NOT_SERVED = new Set(['_headers', '_redirects']);
const files = readdirSync('web')
  .filter(f => statSync(`web/${f}`).isFile())
  .filter(f => !NOT_SERVED.has(f));
const TEXT = /\.(html|xml|txt|svg|json)$/i;

// LWK-179: the deadline above bounds the JOB; it did not bound each origin's SHARE of it, so a first
// origin that hung consumed the whole remaining --wait and the fallback origin was never tried --
// the one thing the fallback exists for. Two guards, and they are not interchangeable:
//   1. THE SPLIT (the cure). An origin may spend at most the remaining budget divided by the
//      origins NOT YET TRIED this round, so the last origin is structurally always reached. A flat
//      per-request timeout alone cannot do this: eleven requests at any ceiling can still outlast
//      the wait before origin two is tried.
//   2. THE CEILING (the secondary guard). No single request waits longer than 15 s. The live probe
//      answers in well under a second, so 15 s is a wide margin over real latency and cannot
//      false-red a slow-but-alive origin, while one HUNG request costs a small slice of a share.
// Every request is bounded by min(what is left of ITS ORIGIN'S share, the ceiling), and is not
// started once none is left. An abort throws out of probe() into the round's own catch, so it is
// reported as an origin that did not answer -- the reachability message -- never read as a pass.
const REQUEST_CEILING_MS = 15_000;
async function get(url, until) {
  const left = until - Date.now();
  if (left <= 0) throw new Error(`this origin's share of the --wait budget was used up before this request started`);
  // AbortSignal.timeout takes an INTEGER of milliseconds: a share divided by two is routinely
  // fractional, and a fractional value throws a RangeError before any request is made.
  const ms = Math.max(1, Math.floor(Math.min(left, REQUEST_CEILING_MS)));
  try {
    return await fetch(url, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    if (e?.name === 'TimeoutError') throw new Error(`no answer within ${(ms / 1000).toFixed(1)}s`);
    throw e;
  }
}

async function probe(origin, until) {
  const misses = [];

  // not_found_handling: 404-page — an unmatched path must answer 404, not 200 with the home
  // page. Measured 2026-09-03: it used to answer 200, so crawlers indexed pages that do not
  // exist. A cache-buster keeps this off any edge copy.
  {
    const miss = `no-such-page-${Date.now()}`;
    const r404 = await get(origin + miss, until);
    if (r404.status !== 404) {
      misses.push(`/${miss}: served HTTP ${r404.status}, expected 404 (assets.not_found_handling is 404-page)`);
    }
    // The 404 page is an HTML response too, and the one a mistyped URL gets: it must carry the same headers.
    // Only when it really is a 404: a 403 from an edge that refuses this client says nothing about our headers.
    // And only when the body IS web/404.html: a platform 404 is not an asset response, so no _headers rule
    // reaches it (see notFoundVerdict). Production must serve the page; any other host is told, not failed.
    if (r404.status === 404) {
      const host = new URL(origin).hostname;
      misses.push(...robotsRailMisses(host, r404.headers).map(m => `/${miss} (the 404 page): ${m}`));
      const isOurs = normHtml(await r404.text()) === normHtml(readFileSync('web/404.html', 'utf8'));
      const v = notFoundVerdict(host, isOurs, r404.headers, DECLARED);
      misses.push(...v.misses.map(m => `/${miss} (the 404 page): ${m}`));
      v.notes.forEach(n => NOTES.add(n));
    }
  }
  for (const f of files) {
    const url = origin + (f === 'index.html' ? '' : f) + '?cb=' + Date.now();
    const r = await get(url, until);
    // A 404 on a file we SHIP is a missing deploy, not an unreachable site: report it as a
    // MISS so the operator reads "this file is not there" instead of "I could not see".
    // Anything else non-OK (403, 5xx, a redirect loop) is still a reachability problem and
    // still throws, because those say nothing about whether the file exists.
    if (r.status === 404) { misses.push(`${f}: served HTTP 404 — the file is not in the deploy`); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${f}`);
    // After the reachability throw above, so a refused client is still tried on the next origin.
    misses.push(...headerMisses(origin, r, f, /\.html$/i.test(f)));
    if (TEXT.test(f)) {
      const live = normHtml(await r.text());
      const want = normHtml(readFileSync(`web/${f}`, 'utf8'));
      if (live !== want) misses.push(`${f}: served ${live.length} chars, committed ${want.length}`);
    } else {
      const live = sha(Buffer.from(await r.arrayBuffer()));
      const want = sha(readFileSync(`web/${f}`));
      if (live !== want) misses.push(`${f}: served sha ${live}, committed ${want}`);
    }
  }
  return misses;
}

// The wait is for PUBLICATION, not merely for reachability. Measured at fc02a93: this job
// finished in 5 s while Workers Builds published 18 s later, so the gate compared against the
// PREVIOUS page and went red on a commit that was in fact fine. The old loop set `reached` on
// the first origin that ANSWERED and broke out — so `--wait 300` could only ever wait out a site
// that was down, never a deploy still in flight, which is the one case the wait exists for.
// A mismatch now RETRIES until the budget runs out, and only the final state is reported.
let matched = false, lastMisses = null, lastErr = {};
while (Date.now() < deadline) {
  // Per-ROUND state, cleared per round. Both were declared once outside the loop and never
  // reset, so a round in which every origin THREW still reported the PREVIOUS round's
  // staleness -- naming an origin that had not answered for minutes and calling an outage a
  // stale deploy. Exit code was right either way; the diagnosis an operator reads was not.
  lastMisses = null; lastErr = {};
  for (const [i, origin] of ORIGINS.entries()) {
    // This origin's share: what is left, divided by the origins not yet tried (this one included).
    const until = Date.now() + (deadline - Date.now()) / (ORIGINS.length - i);
    try {
      const misses = await probe(origin, until);
      if (misses.length === 0) {
        console.log(`all ${files.length} deployed files match what is committed, and every HTML response (including the 404 page) carries the CSP, Referrer-Policy and Permissions-Policy that web/_headers declares, via ${origin}`);
        matched = true;
      } else {
        lastMisses = { origin, misses };
      }
      break;
    } catch (e) { lastErr[origin] = e.message; }
  }
  if (matched) break;
  // Never sleep past the deadline: the pause between rounds is inside the budget too.
  await new Promise(r => setTimeout(r, Math.max(0, Math.min(15000, deadline - Date.now()))));
}

for (const n of NOTES) console.error('note: ' + n);
if (matched) {
  process.exitCode = 0;
} else if (lastMisses) {
  const waited = Math.round((Date.now() - started) / 1000);
  console.error(`post-deploy check FAILED via ${lastMisses.origin} — still not published after ${waited}s:`);
  lastMisses.misses.forEach(m => console.error('  - ' + m));
  process.exitCode = 1;
} else {
  console.error(`post-deploy check could not OBSERVE anything after ${budget}s — this is a reachability failure, not a staleness one:`);
  for (const o of ORIGINS) console.error(`  ${o} -> ${lastErr[o] || 'no attempt completed'}`);
  console.error('  A gate that cannot see must not report success. Failing.');
  process.exitCode = 1;
}
