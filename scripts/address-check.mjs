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
// Verdicts: ROUTES (the first enabled rule for the address, in Cloudflare's order, forwards or hands it to a worker, and no enabled rule behind it disagrees) · CONFLICT (it does, but an enabled
// rule behind it would drop) · DROPS (the first enabled rule drops) · DISABLED (its rules exist and are all off) · NO RULE. Only ROUTES passes: the zone's catch-all NEVER counts, whatever it does, because the property checked is that each published address has a
// rule of its own (a misspelled or never-created address must not pass because a catch-all happens to forward). The catch-all is printed as one information line.
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

// THE ORDER CLOUDFLARE APPLIES, which this implements. Of the rules that match an address, only the first processes its mail: "If you create more than one rule with the same email pattern,
// only the rule shown first in the dashboard list processes incoming emails" (developers.cloudflare.com/email-routing/setup/email-routing-addresses/, read 2026-10-17). The API's
// `priority` field is described there only as "Priority of the routing rule" (developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/list/, same date), without a
// direction; the zone's own rules show it (read 2026-10-17): every literal rule has priority 0 and the catch-all has 2147483647 and is listed last, so a LOWER number runs first, and rules
// with the same number keep the order the API lists them (the dashboard order). So an address's rules are ordered by ascending priority, ties by list position, DISABLED ones left out,
// and the first one decides: a drop there means the mail is dropped, whatever delivering rule stands behind it. A delivering first rule with a different-outcome rule shadowed behind it
// is a CONFLICT and fails too (a stale drop is one dashboard reorder from taking effect). Rules that agree (all deliver) are redundant, not wrong.
// The verdict of each address against the zone's rules. The catch-all rule is not an input: it never counts. Pure: no network, no clock.
export function judge(addresses, rules) {
  return addresses.map(address => {
    const own = (rules || []).map((r, index) => ({ r, index })).filter(({ r }) => literalTo(r).includes(address));
    const live = own.filter(({ r }) => r.enabled).sort((a, b) => (Number(a.r.priority) || 0) - (Number(b.r.priority) || 0) || a.index - b.index).map(({ r }) => r);
    if (live.length === 0) return own.length ? { address, verdict: 'DISABLED', ok: false } : { address, verdict: 'NO RULE', ok: false };
    if (!delivers(live[0])) return { address, verdict: 'DROPS', ok: false };
    if (live.some(r => !delivers(r))) return { address, verdict: 'CONFLICT', ok: false };
    return { address, verdict: 'ROUTES', ok: true };
  });
}

// What the zone's catch-all does, as one word for an information line: forwards · drops · disabled · absent. Never a pass, and never a destination.
export function catchAllNote(catchAll) {
  if (!catchAll) return 'absent';
  if (!catchAll.enabled) return 'disabled';
  return delivers(catchAll) ? 'forwards' : 'drops';
}

// Every routing rule, page by page. `getPage(page, perPage)` returns one parsed response body. Pure apart from that call: no network, no clock.
// The vendor's list-rules page documents `page` (minimum 1), `per_page` (minimum 5, maximum 50) and a `result_info` of count, page, per_page, total_count and total_pages
// (developers.cloudflare.com/api/resources/email_routing/subresources/rules/methods/list/, read 2026-10-17), but a response can still omit `total_pages`, and defaulting it to 1
// hid every rule past page one. So the page count is `total_pages` when present, else ceil(total_count / per_page), and the loop also stops on a short page (fewer than
// per_page results). Cross-check: the rules collected must equal `total_count`, else the pages disagree with the zone and the check fails by name rather than judge half a list.
// MAX_PAGES bounds the loop so a response that never ends cannot spin it: 100 pages of 50 is 5,000 rules, far above any zone this check reads; reaching it fails by name.
export const MAX_PAGES = 100;
export const PER_PAGE = 50;
export async function fetchAllRules(getPage, perPage = PER_PAGE) {
  const rules = [];
  let totalCount = null;
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new Error(`the routing rules did not end within ${MAX_PAGES} pages of ${perPage}; the response is not trusted and no verdict is given`);
    const body = await getPage(page, perPage) || {};
    if (body.success === false) throw new Error(`the routing rules page ${page} answered with an error (success false); no verdict is given`);
    if (!Array.isArray(body.result)) throw new Error(`the routing rules page ${page} did not return a list; no verdict is given`);
    const results = body.result;
    rules.push(...results);
    const info = body.result_info || {};
    const size = Number.isInteger(info.per_page) && info.per_page > 0 ? info.per_page : perPage;
    if (Number.isInteger(info.total_count) && info.total_count >= 0) {
      // The first total_count seen is the one the rules are checked against: a later page reporting another number means the list changed while it was read, and a rule can have moved across a page already read.
      if (totalCount !== null && info.total_count !== totalCount) throw new Error(`the routing rules changed during the read: page ${page} says ${info.total_count} rules, an earlier page said ${totalCount}; no verdict is given`);
      totalCount = info.total_count;
    }
    const pages = Number.isInteger(info.total_pages) && info.total_pages > 0 ? info.total_pages : totalCount !== null ? Math.ceil(totalCount / size) : null;
    if (results.length < size || (pages !== null && page >= pages)) break;
  }
  if (totalCount !== null && rules.length !== totalCount) throw new Error(`the routing rules pages disagree with the zone: ${rules.length} rules read, the zone says ${totalCount}; no verdict is given`);
  return rules;
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
  let rules, catchAll = null;
  try {
    const zones = await get('/zones?name=kolwen.com&account.id=' + encodeURIComponent(account), token, 'the zone lookup');
    const zone = (zones.result || [])[0];
    if (!zone) throw new Error('the zone kolwen.com was not found for this account');
    rules = await fetchAllRules((page, perPage) => get(`/zones/${zone.id}/email/routing/rules?per_page=${perPage}&page=${page}`, token, 'the email routing rules'));
    catchAll = (await get(`/zones/${zone.id}/email/routing/rules/catch_all`, token, 'the catch-all rule')).result || null;
  } catch (e) { console.error('FAIL ' + (e && e.message ? e.message : 'the zone could not be read')); process.exitCode = 1; return; }
  const verdicts = judge(addresses, rules);
  for (const v of verdicts) console.log(`${v.ok ? 'PASS' : 'FAIL'} ${v.address} ${v.verdict}`);
  const bad = verdicts.filter(v => !v.ok);
  console.log(`${verdicts.length} address(es) checked, ${bad.length} without a route of their own (the zone's catch-all ${catchAllNote(catchAll)}; it never counts)`);
  if (bad.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('FAIL address-check could not finish'); process.exitCode = 1; });
