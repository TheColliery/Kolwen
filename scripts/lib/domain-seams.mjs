// The domain seams (BB-197 item 7): what keeps a group of pages able to move to its own host later. Today the map holds one group, the company site at kolwen.com.
// Nothing here buys a domain or moves a page. web-src/seams.json is the map; surface-check rule 20 runs `seamProblems` on a snapshot of the tree, and
// scripts/domain-seams.test.mjs proves each seam with a planted defect, using neutral fixture groups on reserved .invalid hosts. Zero dependencies; every function is pure over a
// snapshot, so a test can plant a defect in memory.
//
// The five seams (design note section R1.3):
//  1. PATH PREFIXES AS GROUPS. Every served page belongs to exactly one group; a page outside every group fails. A group moves by a web/_redirects change.
//  2. THE LEGAL PAGES COVER EVERY GROUP. Every page of every group links the one terms and privacy pages at kolwen.com, and no other file holds a copy of a legal text.
//  3. THE CSP IS KEYED PER ZONE. A zone is one Worker: one publish root, one headers file. Cloudflare joins the values of two matching rules, so one policy per path is the only
//     way a served header is the one declared, and another zone's policy is a separate rule set in its own file, never a second rule beside this one. A rule keyed on a host
//     (`https://host/path`) counts as matching every path of a zone whose group has that host.
//  4. HOST-ONLY COOKIES. Nothing shipped sets a cookie (today none is set), and no cookie carries a Domain attribute, which scopes it to a host and every subdomain of it
//     (RFC 6265 section 5.3: without the attribute the cookie is host-only). RFC 6265 is cited from the standard, not fetched here, and the library has no row for it.
//  5. THE PAGE-KEYED CATALOGUE. No catalogue key names a domain or a host, so a page that moves host keeps its strings.
//
// STATED LIMITS.
//  - Legal copy: a paragraph is a copy when it has 12 words or more, counted by Intl.Segmenter (ICU word segmentation, which uses a dictionary for Thai, a script written without spaces
//    between words) and compared by its letters and digits alone, so a different wrap, markup or spacing is still the same copy. A reworded or translated paragraph, and a paragraph under
//    12 words, are not found; a link target inside the Markdown source of a paragraph is dropped before the comparison. The dictionary is ICU's, so a count near the limit can differ
//    between ICU versions.
//  - Cookies: the check reads the text of shipped files (a headers file, a page's markup and inline scripts, Worker code). It finds a Set-Cookie header, a quoted `Set-Cookie`, a meta
//    set-cookie, any `.cookie` or `['cookie']` write (however the document is named, with a comment between the object and the dot, the dot and the name, inside the brackets, or between the property and the operator), a destructuring target (`[document.cookie] = a`,
//    `({ k: d.cookie } = o)`) and a for-of or for-in target, `Object.assign(document, { cookie })`, the Cookie Store `set`, a cookie library's `set` or `serialize`, and a `; Domain=`
//    attribute or `domain:` option. It does not see a cookie written through a name built at run time (`document['coo' + 'kie']`), `Reflect.set` or `Object.defineProperty` on the
//    document, `cookieStore['set']`, an inline handler attribute other than a `.cookie` write, or a script a page loads from another origin (rule 13 names every origin a script may come
//    from). What a regular expression cannot see in a destructuring or loop target, all unseen: a target followed by an item that holds `=` or `;`
//    (`[document.cookie, z = 1] = a`, `[document.cookie, [y = 1]] = a`), a target wrapped in parentheses (`[(document.cookie)] = a`, `for ((document.cookie) of l)`), and a
//    cookie reached by a `with` statement or a computed key. A destructuring DEFAULT that only reads the cookie (`const { a = document.cookie } = o`) is reported as a write: it has
//    the same shape, and the check fails loud, never quiet. A match inside a string or a comment is reported too (it reads text, not syntax).
//  - Links: a page is judged by its links in the markup, not by where a browser would send the visitor.
import { htmlTokens } from './html-tokens.mjs';
import { parseHeadersFile, declarations, patternMatches, parsePolicy } from './headers-file.mjs';
import { decodeEntities } from './rendered-text.mjs';

export const SEAMS_FILE = 'web-src/seams.json';
export const CATALOGUE_DIR = 'web-src/i18n';
export const TEMPLATE_DIR = 'web-src/pages';
const FALLBACK_PATH = '/__no-such-page__'; // a path no page has: the request the 404 page answers
const MIN_COPY_WORDS = 12;
const HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const isBinary = f => /\.(png|ico|woff2?|ttf)$/i.test(f);

// The clean URL path of a page file under its zone's publish root: web/index.html is /, web/pricing.html /pricing, web/docs/index.html /docs/.
export function pagePath(file, root) {
  let p = '/' + (root && file.startsWith(root + '/') ? file.slice(root.length + 1) : file);
  p = p.replace(/\.html$/, '');
  return p === '/index' ? '/' : p.replace(/\/index$/, '/');
}

const prob = (file, msg) => ({ file, msg });

// The map, parsed and shape-checked. { seams, problems }: seams is null when the file is absent or not JSON.
export function parseSeams(text) {
  const problems = [];
  const bad = msg => problems.push(prob(SEAMS_FILE, msg));
  if (text == null) { bad('is missing, so no page belongs to any group and nothing is checked (seam 1 to 5); restore it'); return { seams: null, problems }; }
  const obj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  let seams;
  try { seams = JSON.parse(text); } catch (e) { bad(`is not valid JSON (${e.message.slice(0, 100)})`); return { seams: null, problems }; }
  if (!obj(seams)) { bad('is not a JSON object'); return { seams: null, problems }; }
  const strs = v => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && x !== '');
  if (!obj(seams.groups) || !obj(seams.groups.company)) bad('the company group is missing from "groups"');
  if (!obj(seams.zones)) bad('"zones" is missing');
  const lg = seams.legal;
  if (!obj(lg) || !HOST.test(lg.host ?? '') || !/^\/\S*$/.test(lg.terms ?? '') || !/^\/\S*$/.test(lg.privacy ?? '') || !strs(lg.sources) || !strs(lg.renderedAs)) bad('"legal" needs a host, the terms and privacy paths, "sources" and "renderedAs"');
  const groups = obj(seams.groups) ? seams.groups : {}, zones = obj(seams.zones) ? seams.zones : {};
  const owner = new Map(); // header file -> zone name
  for (const [name, z] of Object.entries(zones)) {
    if (!obj(z) || typeof z.root !== 'string' || typeof z.headers !== 'string' || !z.root || !z.headers) { bad(`zone ${name} names no root and headers file`); continue; }
    if (!strs(z.csp) || !z.csp.every(p => /^(?:\/|https?:\/\/)/.test(p))) bad(`zone ${name} lists no CSP rule pattern (each is a path that starts with a slash, or a host rule that starts with https://)`);
    if (owner.has(z.headers)) bad(`zones ${owner.get(z.headers)} and ${name} share the headers file ${z.headers}; each zone is one Worker with its own, because Cloudflare joins the values of two matching rules`);
    else owner.set(z.headers, name);
  }
  const prefixes = new Map();
  for (const [name, g] of Object.entries(groups)) {
    if (!obj(g)) { bad(`group ${name} is not an object`); continue; }
    if (g.state !== 'live' && g.state !== 'later') bad(`group ${name}: state "${g.state}" is not live or later`);
    if (typeof g.host !== 'string' || !HOST.test(g.host)) bad(`group ${name}: host "${g.host}" is not a bare lower-case host name`);
    if (typeof g.zone !== 'string' || !g.zone) bad(`group ${name} names no zone`);
    else if (g.state === 'live' && !zones[g.zone]) bad(`live group ${name} is in zone ${g.zone}, which web-src/seams.json does not declare under "zones"`);
    if (g.pages !== undefined && !(Array.isArray(g.pages) && g.pages.every(p => typeof p === 'string' && p.startsWith('/')))) bad(`group ${name}: "pages" is a list of paths that start with a slash`);
    if (g.prefix !== undefined) {
      if (typeof g.prefix !== 'string' || !/^\/(?:[^/\s]+\/)*$/.test(g.prefix)) bad(`group ${name}: prefix "${g.prefix}" must start and end with a slash`);
      else if (g.prefix === '/') bad(`group ${name}: prefix / would hold every page; list a group's pages instead`);
      else if (prefixes.has(g.prefix)) bad(`prefix ${g.prefix} is taken by two groups (${prefixes.get(g.prefix)}, ${name})`);
      else prefixes.set(g.prefix, name);
    }
    if (!(g.pages?.length > 0) && g.prefix === undefined) bad(`group ${name} holds no page and no prefix`);
  }
  for (const [a, an] of prefixes) for (const [b, bn] of prefixes) if (a !== b && a.startsWith(b)) bad(`prefix ${a} lies inside ${b} (groups ${an} and ${bn}); a page under it would belong to two groups`);
  return { seams, problems };
}

const groupsOf = (seams, path) => Object.entries(seams.groups).filter(([, g]) => (g.pages ?? []).includes(path) || (g.prefix !== undefined && path.startsWith(g.prefix))).map(([n]) => n);

// SEAM 1. Every served page belongs to exactly one group.
export function groupProblems(seams, paths) {
  const out = [];
  const moveNote = 'add it to the group that owns it in web-src/seams.json; a group moves to its own host later by a web/_redirects change (301 from each of its paths), not by rewriting a page';
  for (const path of paths) {
    const owners = groupsOf(seams, path);
    if (owners.length === 0) out.push(prob(SEAMS_FILE, `${path} belongs to no group; ${moveNote}`));
    else if (owners.length > 1) out.push(prob(SEAMS_FILE, `${path} belongs to more than one group (${owners.join(', ')}); a page has one home`));
    for (const n of owners) if (seams.groups[n].state === 'later') out.push(prob(SEAMS_FILE, `group ${n} has state later, so it serves no page yet, but ${path} is under its prefix or listed in it; set its state to live when it has something real to serve`));
  }
  for (const [n, g] of Object.entries(seams.groups)) for (const p of g.pages ?? []) if (!paths.includes(p)) out.push(prob(SEAMS_FILE, `group ${n} lists ${p}, which no served page has`));
  return out;
}

const zoneRootOf = (seams, file) => Object.values(seams.zones ?? {}).map(z => z.root).filter(r => file.startsWith(r + '/')).sort((a, b) => b.length - a.length)[0] ?? 'web';

// SEAM 2a. Every page of every group links the one set of legal pages, resolved from the group's own host.
export function legalLinkProblems(seams, pages) {
  const out = [];
  const lg = seams.legal;
  for (const { file, html } of pages) {
    const path = pagePath(file, zoneRootOf(seams, file));
    const [name] = groupsOf(seams, path);
    if (!name) continue; // seam 1 reports a page with no group
    const group = seams.groups[name];
    let links;
    try {
      links = htmlTokens(html, { scripting: false }).filter(t => t.type === 'tag' && !t.closing && t.name === 'a' && t.attrs.has('href')).map(t => { try { return new URL(t.attrs.get('href'), `https://${group.host}${path}`); } catch { return null; } }).filter(Boolean);
    } catch (e) { out.push(prob(file, `group ${name}: the HTML could not be read (${e.message.slice(0, 120)})`)); continue; }
    for (const [what, p] of [['terms', lg.terms], ['privacy', lg.privacy]]) {
      if (!links.some(u => u.origin === `https://${lg.host}` && u.pathname.replace(/\/$/, '') === p.replace(/\/$/, ''))) out.push(prob(file, `group ${name}: no link to the ${what} page (https://${lg.host}${p}); the one set of legal pages covers every group, so a page of any group links it`));
    }
  }
  return out;
}

// A text as it reads: tags dropped, link targets dropped, entities decoded, lower-cased.
const decoded = s => { try { return decodeEntities(s); } catch { return s; } }; // a file that holds an unknown character reference (a test fixture) is compared undecoded
const plainOf = s => decoded(s.replace(/\]\([^)\s]*\)/g, ']').replace(/<[^>]*>/g, ' ')).toLowerCase();
// The comparison key: the letters, digits and marks alone, joined. A copy keeps them when it changes its markup, its wrapping or its spacing, and Thai (no spaces between words) compares as it is written.
const keyOf = s => (plainOf(s).match(/[\p{L}\p{N}\p{M}]+/gu) || []).join('');
// The length of a paragraph, in words: ICU word segmentation (Intl.Segmenter), which splits Thai by a dictionary, so a paragraph in a script written without spaces is measured like any other.
const SEGMENTER = new Intl.Segmenter('th', { granularity: 'word' });
export function wordCount(s) {
  let n = 0;
  for (const seg of SEGMENTER.segment(plainOf(s))) if (seg.isWordLike) n++;
  return n;
}

// SEAM 2b. No file but the sources, their renderings and the generator's own text holds a paragraph of a legal source.
export function legalCopyProblems({ sources, files, allowed }) {
  if (!sources || sources.length === 0) return [prob(SEAMS_FILE, 'legal.sources names no legal source, so the copy check read nothing; list TERMS.md, PRIVACY.md and the clause file')];
  const out = [];
  const paras = sources.map(s => {
    const seen = new Map(); // key -> the start of the paragraph as it reads
    for (const p of s.text.split(/\n\s*\n/)) if (wordCount(p) >= MIN_COPY_WORDS) seen.set(keyOf(p), plainOf(p).trim().replace(/\s+/g, ' ').slice(0, 40));
    return { file: s.file, list: [...seen] };
  });
  if (paras.every(p => p.list.length === 0)) return [prob(SEAMS_FILE, `no paragraph of ${MIN_COPY_WORDS} words in any legal source, so the copy check read nothing`)];
  for (const f of files) {
    if (allowed.has(f.file)) continue;
    const key = keyOf(f.text);
    for (const src of paras) {
      const hit = src.list.find(([k]) => k !== '' && key.includes(k));
      if (hit) out.push(prob(f.file, `holds a paragraph of ${src.file} ("${hit[1]} ..."), a second copy of a legal text; the one set of legal pages is generated from the sources at kolwen.com, so link to it instead`));
    }
  }
  return out;
}

// Does a CSP rule apply to a request for `path` on one of the zone's `hosts`? A path rule applies on every host. A host rule (`https://host/path`; the host may hold :placeholders and a splat,
// a host with no path reads as every path) applies only when the request's host matches it: a rule keyed on a host of the zone is a second policy on the zone's paths.
const HOST_RULE = /^https?:\/\/([^/]+)(\/.*)?$/;
function ruleApplies(rule, hosts, path) {
  const m = HOST_RULE.exec(rule.pattern);
  return m ? hosts.some(h => patternMatches(m[1], h)) && patternMatches(m[2] ?? '/*', path) : patternMatches(rule.pattern, path);
}

// SEAM 3. The CSP of one zone: its patterns are exactly the CSP rules of its headers file (a host-keyed rule included), each path of its root is matched by exactly one, and a strict zone admits no 'unsafe-inline'.
export function cspZoneProblems(seams, zoneName, headersText, paths) {
  const zone = seams.zones[zoneName];
  const out = [];
  if (headersText == null) return [prob(zone.headers, `is missing, so zone ${zoneName} has no CSP rule at all`)];
  const hosts = Object.values(seams.groups).filter(g => g.zone === zoneName).map(g => g.host);
  const rules = parseHeadersFile(headersText).filter(r => declarations([r], 'Content-Security-Policy').length > 0);
  const claimedBy = pattern => Object.entries(seams.zones).filter(([, z]) => z.headers === zone.headers && z.csp.includes(pattern)).map(([n]) => n);
  for (const r of rules) if (claimedBy(r.pattern).length === 0) out.push(prob(zone.headers, `line ${r.line}: declares a Content-Security-Policy on ${r.pattern}, which no zone claims; add it to a zone's "csp" in web-src/seams.json, or remove it`));
  for (const p of zone.csp) if (!rules.some(r => r.pattern === p)) out.push(prob(zone.headers, `zone ${zoneName} claims the CSP rule ${p}, which ${zone.headers} does not declare`));
  if (zoneName === 'company' && !zone.csp.includes('/*')) out.push(prob(SEAMS_FILE, 'the company zone does not claim "/*": post-deploy-check reads the "/*" rule of web/_headers (declaredSecurityHeaders) to compare the served headers, so re-key that reader in the same unit'));
  for (const path of [...paths, FALLBACK_PATH]) {
    const hit = rules.filter(r => ruleApplies(r, hosts, path));
    const label = path === FALLBACK_PATH ? 'the path of an unmatched request (the 404 fallback)' : path;
    if (hit.length === 0) out.push(prob(zone.headers, `${label} is matched by no CSP rule, so it would be served with no policy`));
    else if (hit.length > 1) out.push(prob(zone.headers, `${label} is matched by ${hit.length} CSP rules (${hit.map(r => r.pattern).join(', ')}); Cloudflare joins the values of two matching rules, so the policy served would not be the one declared. Another zone's policy is its own rule set in its own file`));
  }
  if (zone.policy === 'strict-hash') {
    for (const r of rules.filter(r => zone.csp.includes(r.pattern))) {
      const { dirs } = parsePolicy(declarations([r], 'Content-Security-Policy')[0].value);
      for (const d of ['script-src', 'style-src', 'script-src-elem', 'style-src-elem']) if ((dirs.get(d) ?? []).includes("'unsafe-inline'")) out.push(prob(zone.headers, `line ${r.line}: the ${zoneName} zone's policy admits 'unsafe-inline' in ${d}; it is a strict hash policy, so each inline block is admitted by its hash`));
    }
  }
  return out;
}

// SEAM 4. Nothing shipped sets a cookie (today none is set), and no cookie carries a Domain attribute.
const CODE_FILE = /\.(?:m?js|cjs|ts|tsx)$/i;
// A write to a `.cookie` property or a ['cookie'] member of anything (the document under another name too), and the Object.assign form. Three shapes of target:
//  1. the property, then (space and comments) an assignment operator: `document.cookie = x`, `d['cookie'] ??= x`, `document.cookie /* c */ = x`;
//  2. a destructuring target: the property, optional later items, one or more closing `]` or `}`, then `=`: `[document.cookie] = a`, `({ k: d.cookie, j } = o)`, `[[document.cookie]] = a`;
//  3. a for-of or for-in target: `for (document.cookie of list)`, `for await (d['cookie'] in o)`.
//  4. an update operator: `document.cookie++`, `d['cookie']--` (a postfix operator on the same line, as the grammar demands) and `++document.cookie`, `-- /* c */ a.b.cookie`.
// The property may be spelled with an escape (`document.cookie`, `document['c\x6fokie']`). The pieces are built from strings and code points: this file holds no escape of its own that a tool could turn
// into a character, and no line terminator inside a regular expression.
const LINE_END = String.fromCharCode(10, 13, 0x2028, 0x2029); // what ends a // comment: JavaScript's line terminators, not only LF
// A block comment holds no `*/`, so a run of comments can be cut only one way. (A lazy `[\s\S]*?` could swallow several comments as one, and a failed match then tried every cut: exponential on
// `for (document.cookie /* c */ /* c */ ...` with no `of`; found by the timing test of PR #56.)
const BLOCK_COMMENT = '\\/\\*(?:[^*]|\\*(?!\\/))*\\*\\/';
const GAP = '(?:\\s|' + BLOCK_COMMENT + '|\\/\\/[^' + LINE_END + ']*[' + LINE_END + '])*'; // white space and comments
const GAP_SAME_LINE = '(?:[ \\t]|\\/\\*(?:[^*' + LINE_END + ']|\\*(?!\\/))*\\*\\/)*'; // no line break: JavaScript allows none before a postfix ++ or --
// One letter of a word as itself or as an escape: \uXXXX and \u{X...} in an identifier, and \xXX and the legacy octal \NNN too in a string (a classic inline script is sloppy mode, which accepts it). The
// word is lower-case ASCII, so every letter's octal code has exactly three digits, no leading zero: one more literal alternative, disjoint from the others, so the pattern stays linear.
// INSPECT L-3 (1017j) closes the last two string forms: an identity escape (a backslash before a letter that is no escape character yields the letter, in sloppy and strict mode alike; the letters of
// `cookie` are none of b f n r t v u x 0-9, so each is its own alternative, disjoint from the others by the character after the backslash) and a LINE CONTINUATION (a backslash and a line break
// yield nothing) at either end of the key and between any two letters. A continuation starts with a backslash too, but a line break follows it where every letter alternative has a letter, a digit, u or
// x, so no position has two ways to match and the pattern stays linear (timed in the stress test of scripts/domain-seams.test.mjs).
const CONTINUATION = '(?:\\\\(?:' + String.fromCharCode(13, 10) + '|[' + LINE_END + ']))*';
const spell = (word, inString) => {
  const letters = [...word].map(c => {
    const h = c.charCodeAt(0).toString(16).replace(/[a-f]/g, m => '[' + m + m.toUpperCase() + ']');
    return '(?:' + c + '|\\\\u00' + h + '|\\\\u\\{0*' + h + '\\}' + (inString ? '|\\\\x' + h + '|\\\\' + c.charCodeAt(0).toString(8) + '|\\\\' + c : '') + ')';
  });
  return inString ? CONTINUATION + letters.join(CONTINUATION) + CONTINUATION : letters.join('');
};
// A comment may sit between the dot and the name, or inside the brackets (`document /* c */ . /* c */ cookie`); the object and the dot before it lie outside the match, so they need no gap here.
const COOKIE_PROP = '(?:\\.' + GAP + spell('cookie', false) + '(?![\\w$])|\\[' + GAP + '[\'"`]' + spell('cookie', true) + '[\'"`]' + GAP + '\\])';
const ASSIGN_OP = /(?:\*\*|<<|>>>?|&&|\|\||\?\?|[+\-*/%|&^])?=(?![=>])/.source;
const UPDATE_OP = '(?:\\+\\+|--)';
const DOC_COOKIE_WRITE = new RegExp([
  COOKIE_PROP + GAP + ASSIGN_OP,
  COOKIE_PROP + GAP + '(?:,[^\\]}=;]*)?[\\]}](?:' + GAP + '[\\]}])*' + GAP + ASSIGN_OP,
  // never two gaps side by side (the comments between them could be split in as many ways as there are comments): the closing delimiters, each with its own gap, are one optional group
  '\\bfor\\s*(?:await\\s*)?\\(\\s*[^;()]*?' + COOKIE_PROP + GAP + '(?:(?:,[^\\]}=;()]*)?(?:[\\]}]' + GAP + ')+)?(?:of|in)\\b',
  COOKIE_PROP + GAP_SAME_LINE + UPDATE_OP,
  UPDATE_OP + GAP + '[\\w$.]*?' + COOKIE_PROP,
].join('|'));
const ASSIGN_COOKIE = /\bObject\s*\.\s*assign\s*\(\s*document\s*,[^)]*\bcookie\b/;
const COOKIE_CALLS = /\b(?:cookieStore\s*\.\s*set|cookies\s*\.\s*set|setCookie|serialize(?:Cookie)?)\s*\(/;
const DOMAIN_ATTR = /;\s*domain\s*=/i;
const DOMAIN_OPTION = /\bdomain\s*:\s*['"`]/i;
// A script type that is data, not code (structured data, an import map, speculation rules, plain JSON).
const DATA_SCRIPT = /^(?:application\/(?:ld\+)?json|importmap|speculationrules)$/i;
// The cookie forms of a piece of code (a code file, or the body of an inline script).
function codeCookieUses(code, sets, domains) {
  if (/['"`]set-cookie['"`]/i.test(code)) sets.push('a Set-Cookie header');
  if (/\bcookieStore\s*\.\s*set\s*\(/.test(code)) sets.push('the Cookie Store API');
  else if (COOKIE_CALLS.test(code)) sets.push('a cookie call');
  if (ASSIGN_COOKIE.test(code)) sets.push('writes document.cookie');
  if (DOMAIN_OPTION.test(code)) domains.push(1);
}
// INSPECT L-4 (1017j): the patterns above skip a block comment by scanning from its opener to the next end marker, so a text of many openers with no marker near them costs the square of their count (at the
// base commit `document[/*x` repeated: 1,000 times 109 ms, 4,000 times 1,803 ms). The bound that keeps the check linear: the SPAN of a text is the sum, over every `/*`, of its distance to the next `*/`
// (or to the end of the text when none follows), found in one pass with a pointer that never moves back. A real file has each opener close to its own end marker, so its span is about its length; a text
// whose span passes max(SPAN_FACTOR x its length, SPAN_FLOOR) is not read and is a FINDING (fail loud, never quiet), so the work the patterns can be given is bounded by that number.
// STATED LIMIT: a file that is mostly one comment holding more than SPAN_FACTOR openers (a long commented-out block) is refused too, with the message telling its author to close or split them.
export const SPAN_FACTOR = 16, SPAN_FLOOR = 5000000;
export function commentSpan(text) {
  const n = text.length;
  let span = 0, close = -2;
  for (let i = text.indexOf('/*'); i !== -1; i = text.indexOf('/*', i + 1)) {
    if (close !== -1 && close < i + 2) close = text.indexOf('*/', i + 2);
    span += (close === -1 ? n : close + 2) - i;
  }
  return span;
}
export function cookieProblems(files) {
  if (!files || files.length === 0) return [prob('web/', 'no shipped file was read, so the cookie check read nothing')];
  const out = [];
  const today = 'today the site sets no cookie (PRIVACY.md states it, measured); a first cookie is a PRIVACY.md change, and it is host-only';
  const domainMsg = 'a cookie with a Domain attribute is sent to the named host and every subdomain of it (RFC 6265 section 5.3); every cookie here is host-only, so leave Domain out';
  for (const { file, text } of files) {
    const sets = [], domains = [];
    if (/(?:^|\/)_headers$/.test(file)) {
      for (const line of text.split(/\r?\n/)) {
        if (/^\s*#/.test(line)) continue;
        if (/^\s+set-cookie\s*:/i.test(line)) sets.push('a Set-Cookie header');
        if (DOMAIN_ATTR.test(line)) domains.push(1);
      }
    } else {
      const span = commentSpan(text);
      if (span > Math.max(SPAN_FACTOR * text.length, SPAN_FLOOR)) {
        out.push(prob(file, `block comments span ${span} characters in a ${text.length}-character text (many /* openers that never close or overlap): the cookie check does not read it, so close them or split the file`));
        continue;
      }
      if (DOC_COOKIE_WRITE.test(text)) sets.push('writes document.cookie');
      if (DOMAIN_ATTR.test(text)) domains.push(1);
      if (CODE_FILE.test(file)) codeCookieUses(text, sets, domains);
      if (/\.html?$/i.test(file)) {
        // a page: the meta form, and the code forms in each INLINE script (a data block such as structured data is not code, and prose on the page is not a script)
        try {
          let last = null;
          for (const t of htmlTokens(text, { scripting: false })) {
            if (t.type === 'tag' && !t.closing) {
              last = t;
              if (t.name === 'meta' && /^set-cookie$/i.test(t.attrs.get('http-equiv') ?? '')) sets.push('a meta http-equiv set-cookie');
            } else if (t.type === 'raw' && t.name === 'script' && last && !DATA_SCRIPT.test((last.attrs.get('type') ?? '').trim())) codeCookieUses(t.body, sets, domains);
          }
        } catch { /* an unreadable page is reported by seam 2 */ }
      }
    }
    const uniq = [...new Set(sets)];
    for (const how of uniq) out.push(prob(file, how === 'writes document.cookie' ? `writes document.cookie (or a .cookie property of another name for it); ${today}` : `sets a cookie (${how}); ${today}`));
    if (domains.length) out.push(prob(file, `holds a cookie with a Domain attribute: ${domainMsg}`));
  }
  return out;
}

// SEAM 5. No catalogue key names a domain or a host. Keys only: a value may name the brand or a host.
const HOST_KEY = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i;
const HOST_WORDS = new Set(['com', 'ai', 'dev', 'app', 'org', 'net', 'io', 'domain', 'host', 'hostname', 'subdomain', 'tld', 'fqdn']);
export function catalogueDomainProblems(files, templates) {
  const names = Object.keys(files ?? {});
  if (names.length === 0) return [prob(CATALOGUE_DIR, 'no catalogue file was read, so the key check read nothing')];
  const out = [];
  const pageKeys = new Set([...templates, 'shared']);
  for (const file of names) {
    let cat;
    try { cat = JSON.parse(files[file]); } catch (e) { out.push(prob(file, `is not valid JSON (${e.message.slice(0, 100)})`)); continue; }
    if (cat === null || typeof cat !== 'object' || Array.isArray(cat)) { out.push(prob(file, 'is not a JSON object')); continue; }
    for (const k of Object.keys(cat)) if (!pageKeys.has(k)) out.push(prob(file, `top-level key "${k}" is neither a template page nor shared; the catalogue is keyed by page, never by domain`));
    const walk = (o, path) => {
      for (const [k, v] of Object.entries(o)) {
        const full = path ? path + '.' + k : k;
        if (HOST_KEY.test(k)) out.push(prob(file, `key "${k}" names a host; the catalogue is keyed by page, so a page that moves host keeps its strings`));
        else if (HOST_WORDS.has(k.toLowerCase())) out.push(prob(file, `key "${full}" names a domain or host; the catalogue is keyed by page, so a page that moves host keeps its strings`));
        if (v !== null && typeof v === 'object') walk(v, full);
      }
    };
    walk(cat, '');
  }
  return out;
}

// All five seams over one snapshot of the tree.
export function seamProblems(snap) {
  const { seams, problems } = parseSeams(snap.seamsText);
  if (!seams) return problems;
  const out = [...problems];
  if (problems.length > 0) return out; // a map that does not hold its own shape cannot be read further
  const pageOf = p => pagePath(p.file, zoneRootOf(seams, p.file));
  out.push(...groupProblems(seams, snap.pages.map(pageOf)));
  for (const p of snap.pages) {
    const [name] = groupsOf(seams, pageOf(p));
    const zone = Object.entries(seams.zones).find(([, z]) => p.file.startsWith(z.root + '/'))?.[0];
    if (name && zone && seams.groups[name].zone !== zone) out.push(prob(p.file, `is served by the ${zone} zone's Worker, but group ${name} says zone ${seams.groups[name].zone}; moving a group takes its pages to its own zone's root, with a web/_redirects 301 from here`));
  }
  out.push(...legalLinkProblems(seams, snap.pages));
  out.push(...snap.legal.missing.map(f => prob(SEAMS_FILE, `legal file ${f} is not tracked, so the copy check could not read it`)));
  out.push(...legalCopyProblems({ sources: snap.legal.sources, files: snap.files, allowed: new Set([...snap.legal.sources.map(s => s.file), ...seams.legal.renderedAs, ...(seams.legal.generatedBy ?? [])]) }));
  for (const [name, z] of Object.entries(seams.zones)) {
    const paths = snap.pages.filter(p => p.file.startsWith(z.root + '/')).map(pageOf);
    out.push(...cspZoneProblems(seams, name, snap.headers[z.headers] ?? null, paths));
  }
  out.push(...cookieProblems(snap.shipped));
  out.push(...catalogueDomainProblems(snap.catalogue, snap.templates));
  return out;
}

// The snapshot of a tree: `tracked` is the list of tracked files and `read(path)` returns its bytes or text. The caller owns the I/O, so a test can build any tree.
export function snapshotOf(tracked, read) {
  const text = p => { const b = read(p); return typeof b === 'string' ? b : b.toString('utf8'); };
  const texts = tracked.filter(f => !isBinary(f));
  const seamsText = tracked.includes(SEAMS_FILE) ? text(SEAMS_FILE) : null;
  let seams = null;
  try { seams = JSON.parse(seamsText); } catch { /* parseSeams reports it */ }
  const zones = seams && typeof seams.zones === 'object' && seams.zones ? Object.values(seams.zones).filter(z => z && typeof z.root === 'string') : [];
  const roots = zones.length ? zones.map(z => z.root) : ['web'];
  const inRoot = f => roots.some(r => f.startsWith(r + '/'));
  const headers = {};
  for (const z of zones) if (typeof z.headers === 'string' && tracked.includes(z.headers)) headers[z.headers] = text(z.headers);
  const legalFiles = Array.isArray(seams?.legal?.sources) ? seams.legal.sources : [];
  const wrangler = tracked.includes('wrangler.jsonc') ? text('wrangler.jsonc') : '';
  const main = (wrangler.replace(/^\s*\/\/.*$/gm, '').match(/"main"\s*:\s*"([^"]+)"/) || [])[1];
  const shippedNames = new Set([...texts.filter(inRoot), ...(main && tracked.includes(main) ? [main] : []), ...texts.filter(f => CODE_FILE.test(f) && !/^(?:scripts|brand|py)\//.test(f))]);
  return {
    seamsText,
    pages: texts.filter(f => inRoot(f) && f.endsWith('.html')).map(file => ({ file, html: text(file) })),
    headers,
    catalogue: Object.fromEntries(texts.filter(f => new RegExp('^' + CATALOGUE_DIR + '/[^/]+\\.json$').test(f)).map(f => [f, text(f)])),
    templates: texts.filter(f => new RegExp('^' + TEMPLATE_DIR + '/[^/]+\\.html$').test(f)).map(f => f.slice(TEMPLATE_DIR.length + 1, -5)),
    shipped: [...shippedNames].sort().map(file => ({ file, text: text(file) })),
    legal: { sources: legalFiles.filter(f => tracked.includes(f)).map(file => ({ file, text: text(file) })), renderedAs: seams?.legal?.renderedAs ?? [], missing: legalFiles.filter(f => !tracked.includes(f)) },
    files: texts.map(file => ({ file, text: text(file) })),
  };
}
