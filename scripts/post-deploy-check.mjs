// Kolwen post-deploy smoke check — is what is SERVED what we committed?
//
// Closes LWK-077 O1-O3: Workers Builds deploys on push, outside Actions, and has silently
// produced no build at all before (acf684f served stale content until a human curled it).
//
// Usage: node scripts/post-deploy-check.mjs [--wait <seconds>]
// Exit 0 = every deployed file matches. Exit 1 = a mismatch, or nothing could be observed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const w = args.indexOf('--wait');
// R5: --wait with no value yielded NaN, the loop never ran, and the script printed the exact
// words of a real outage. The one message this must be incapable of faking.
let budget = 240;
if (w >= 0) {
  const v = Number(args[w + 1]);
  if (!Number.isFinite(v) || v <= 0) { console.error(`--wait needs a positive number, got ${JSON.stringify(args[w + 1])}`); process.exit(2); }
  budget = v;
}

// R1: kolwen.com refuses datacenter egress (HTTP 403 on every attempt from a GitHub runner,
// 200 from a residential IP — measured). The workers.dev origin serves the same deployment and
// may not carry the same edge rules, so both are tried and the reachable one is used. If
// NEITHER answers, that is reported as an observation failure — never as a pass.
const ORIGINS = ['https://kolwen.com/', 'https://kolwen.hetcreep.workers.dev/'];

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

// R3: the trigger covers web/**, so the assertion must too. Checking only index.html would have
// printed "deploy confirmed" for a commit that changed sitemap.xml and never looked at it.
const files = readdirSync('web').filter(f => statSync(`web/${f}`).isFile());
const TEXT = /\.(html|xml|txt|svg|json)$/i;

async function probe(origin) {
  const misses = [];
  for (const f of files) {
    const url = origin + (f === 'index.html' ? '' : f) + '?cb=' + Date.now();
    const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status} on ${f}`);
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

const started = Date.now();
let reached = null, lastErr = {};
while ((Date.now() - started) / 1000 < budget) {
  for (const origin of ORIGINS) {
    try {
      const misses = await probe(origin);
      reached = origin;
      if (misses.length === 0) {
        console.log(`all ${files.length} deployed files match what is committed, via ${origin}`);
        process.exitCode = 0;
      } else {
        console.error(`post-deploy check FAILED via ${origin} — the deploy did not publish this commit:`);
        misses.forEach(m => console.error('  - ' + m));
        process.exitCode = 1;
      }
      break;
    } catch (e) { lastErr[origin] = e.message; }
  }
  if (reached) break;
  await new Promise(r => setTimeout(r, 15000));
}

if (!reached) {
  console.error(`post-deploy check could not OBSERVE anything after ${budget}s — this is a reachability failure, not a staleness one:`);
  for (const o of ORIGINS) console.error(`  ${o} -> ${lastErr[o] || 'no attempt completed'}`);
  console.error('  A gate that cannot see must not report success. Failing.');
  process.exitCode = 1;
}
