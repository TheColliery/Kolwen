#!/usr/bin/env node
// Checks that every @kolwen.com address the built pages publish has an ENABLED Email Routing rule in the Cloudflare zone, and exits 1 naming any that
// has none (the zone's catch-all drops what no rule matches, so an address without a rule is a published address that bounces).
//
//   node scripts/address-check.mjs            read web/*.html and web/llms.txt, ask the zone, print one verdict line per address
//   node scripts/address-check.mjs --help     this text
//
// LOCAL ONLY, NEVER IN CI: it needs a Cloudflare API token that can read Email Routing, and CI holds no Cloudflare token. It reads two environment
// variables by NAME, CLOUDFLARE_READ_TOKEN_ALL and CLOUDFLARE_ACCOUNT_ID_KOLWEN (the process environment first, then on Windows the User-scope
// registry value), makes GET requests only, and prints only addresses and verdicts: never the token, a zone or account id, or a destination.
//
// Verdicts: ROUTES (an enabled rule matches the address and forwards or hands it to a worker) · CATCH-ALL (no rule of its own, but the enabled
// catch-all forwards it) · DISABLED (its rule exists and is off) · DROPS (its rule only drops) · NO RULE. Only ROUTES and CATCH-ALL pass.
// Exit codes: 0 every address passes · 1 an address fails, or the zone could not be read · 2 a bad flag.
// Report problems at https://github.com/TheColliery/Kolwen/issues
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 20000;
const USAGE = 'usage: node scripts/address-check.mjs   (local only; reads CLOUDFLARE_READ_TOKEN_ALL and CLOUDFLARE_ACCOUNT_ID_KOLWEN by name; --help prints this)';

// Every @kolwen.com address in a text, lower-cased, unique, sorted with the default code-unit comparator. The domain must end there: a longer
// domain that starts with kolwen.com (kolwen.community, kolwen.com.au) is another domain, while a closing full stop is not part of the address.
export const addressesIn = text => [...new Set((text.match(/[A-Za-z0-9._%+-]+@kolwen\.com(?![A-Za-z0-9-]|\.[A-Za-z0-9])/gi) || []).map(a => a.toLowerCase()))].sort();

const literalTo = rule => (rule.matchers || []).filter(m => m.type === 'literal' && m.field === 'to').map(m => String(m.value).toLowerCase());
const delivers = rule => (rule.actions || []).some(a => a.type === 'forward' || a.type === 'worker');

// The verdict of each address against the zone's rules and its catch-all rule. Pure: no network, no clock.
export function judge(addresses, rules, catchAll) {
  return addresses.map(address => {
    const own = (rules || []).filter(r => literalTo(r).includes(address));
    if (own.some(r => r.enabled && delivers(r))) return { address, verdict: 'ROUTES', ok: true };
    if (own.some(r => r.enabled)) return { address, verdict: 'DROPS', ok: false };
    if (own.length) return { address, verdict: 'DISABLED', ok: false };
    if (catchAll && catchAll.enabled && delivers(catchAll)) return { address, verdict: 'CATCH-ALL', ok: true };
    return { address, verdict: 'NO RULE', ok: false };
  });
}

// The addresses the built pages publish: every top-level web/*.html and web/llms.txt.
export function publishedAddresses(root = ROOT) {
  const dir = resolve(root, 'web');
  const files = readdirSync(dir).filter(f => f.endsWith('.html') || f === 'llms.txt').sort();
  return addressesIn(files.map(f => readFileSync(resolve(dir, f), 'utf8')).join('\n'));
}

// A User-scope value by name: the process environment first, then (Windows) the registry. The value is returned to the caller and never printed.
function envByName(name) {
  if (process.env[name]) return process.env[name];
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', 'HKCU\\Environment', '/v', name], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'ignore'] });
    const m = new RegExp('^\\s*' + name + '\\s+REG_\\w+\\s+(.+?)\\s*$', 'm').exec(out);
    return m ? m[1] : null;
  } catch { return null; }
}

async function get(path, token, what) {
  const r = await fetch(API + path, { method: 'GET', headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!r.ok) throw new Error(`Cloudflare answered ${r.status} for ${what}`);
  return r.json();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('-h') || args.includes('--help')) { console.log(USAGE); return; }
  if (args.length) { console.error('unknown argument: ' + args.join(' ')); console.error(USAGE); process.exitCode = 2; return; }
  const token = envByName('CLOUDFLARE_READ_TOKEN_ALL'), account = envByName('CLOUDFLARE_ACCOUNT_ID_KOLWEN');
  if (!token || !account) { console.error('FAIL the Cloudflare read token or the account id is not set in the environment (names: CLOUDFLARE_READ_TOKEN_ALL, CLOUDFLARE_ACCOUNT_ID_KOLWEN); nothing was asked'); process.exitCode = 1; return; }
  const addresses = publishedAddresses();
  if (!addresses.length) { console.error('FAIL no @kolwen.com address found in web/*.html or web/llms.txt, so there is nothing to check (an empty check is not a pass)'); process.exitCode = 1; return; }
  let rules = [], catchAll = null;
  try {
    const zones = await get('/zones?name=kolwen.com&account.id=' + encodeURIComponent(account), token, 'the zone lookup');
    const zone = (zones.result || [])[0];
    if (!zone) throw new Error('the zone kolwen.com was not found for this account');
    for (let page = 1; ; page++) {
      const body = await get(`/zones/${zone.id}/email/routing/rules?per_page=50&page=${page}`, token, 'the email routing rules');
      rules.push(...(body.result || []));
      if (page >= ((body.result_info || {}).total_pages || 1)) break;
    }
    catchAll = (await get(`/zones/${zone.id}/email/routing/rules/catch_all`, token, 'the catch-all rule')).result || null;
  } catch (e) { console.error('FAIL ' + (e && e.message ? e.message : 'the zone could not be read')); process.exitCode = 1; return; }
  const verdicts = judge(addresses, rules, catchAll);
  for (const v of verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'} ${v.address} ${v.verdict}`);
  const bad = verdicts.filter(v => !v.ok);
  console.log(`${verdicts.length} address(es) checked, ${bad.length} without a route`);
  if (bad.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('FAIL address-check could not finish'); process.exitCode = 1; });
