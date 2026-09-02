// Kolwen post-deploy smoke check — is the LIVE page the page we committed?
//
// The gap this closes (LWK-077 O1-O3): Workers Builds deploys on push, OUTSIDE Actions, and has
// silently produced no build at all before — acf684f served stale content until a human curled
// it. CI green proves things about the repo; until now nothing proved anything about what is
// actually served.
//
// It compares the live body against the committed web/index.html rather than hunting a build
// marker, deliberately: a static asset cannot know its own commit without a build step, and the
// comparison catches strictly more — a stale deploy AND any unexpected difference in what is
// served. This is the check the head has run by hand since unit 11, made repeatable.
//
// Usage: node scripts/post-deploy-check.mjs [--wait <seconds>]
// Exit 0 = live matches committed. Exit 1 = it does not, with the difference named.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const w = args.indexOf('--wait');
const budget = w >= 0 ? Number(args[w + 1]) : 240;
const URL = 'https://kolwen.com/';

// Cloudflare injects its JSD bot-detection script INTO the served body (a hidden 1x1 iframe
// plus a __CF$cv$params block) before </body>. It is an edge feature we neither control nor
// authored, so it is stripped before comparison; everything else must match our file exactly.
// Recorded rather than silently tolerated: this injection is also why the room's "no cookies"
// claim needs a browser-based re-measurement — see the LWK-090 return.
const CF_INJECT = /<script>\(function\(\)\{function c\(\)[\s\S]*?<\/script>/g;
const norm = s => s.replace(/\r\n/g, '\n').replace(CF_INJECT, '').replace(/\n{2,}/g, '\n').trim();

const expected = norm(readFileSync('web/index.html', 'utf8'));
const started = Date.now();
let last = null, lastErr = null;

while ((Date.now() - started) / 1000 < budget) {
  try {
    const r = await fetch(URL + '?cb=' + Date.now(), { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    last = norm(await r.text());
    if (last === expected) {
      console.log(`live page matches the committed web/index.html (${expected.length} chars, edge injection stripped) — deploy confirmed`);
      process.exitCode = 0; break;
    }
  } catch (e) { lastErr = e.message; }
  await new Promise(r => setTimeout(r, 15000));
}

if (process.exitCode === 0) { /* matched above */ } else {
console.error(`post-deploy check FAILED after ${budget}s`);
if (last === null) {
  // An unreachable origin and a stale deploy are different failures; name which one this is.
  console.error(`  the origin never answered — last error: ${lastErr}`);
  console.error(`  REACHABILITY failure, not a stale-content one`);
} else {
  console.error(`  committed: ${expected.length} chars`);
  console.error(`  live     : ${last.length} chars`);
  const i = [...expected].findIndex((c, n) => c !== last[n]);
  if (i >= 0) {
    console.error(`  first difference at char ${i}`);
    console.error(`    committed ${JSON.stringify(expected.slice(i, i + 70))}`);
    console.error(`    live      ${JSON.stringify(last.slice(i, i + 70))}`);
  }
  console.error(`  the page is serving, but it is NOT what this commit says — the deploy did not run, or ran and did not publish`);
}
process.exitCode = 1;
}
