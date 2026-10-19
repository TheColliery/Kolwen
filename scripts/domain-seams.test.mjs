// The domain seams (BB-197 item 7): each seam has a planted defect that must be found, and the real tree must be clean.
// Run from the repository root: node --test scripts/domain-seams.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SEAMS_FILE, pagePath, parseSeams, groupProblems, legalLinkProblems, legalCopyProblems, cspZoneProblems, cookieProblems, catalogueDomainProblems, seamProblems, snapshotOf, wordCount,
} from './lib/domain-seams.mjs';

const tracked = execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean);
const REAL = snapshotOf(tracked, p => readFileSync(p));
const seamsOf = (edit = () => {}) => { const o = JSON.parse(REAL.seamsText); edit(o); return o; };
// The mechanism is proven with NEUTRAL fixture groups: the map holds only the live company site, and the hosts below are under the reserved .invalid TLD (RFC 2606), so no fixture names a domain anyone could own.
const addB = o => { o.groups['group-b'] = { role: 'a fixture group', host: 'group-b.invalid', state: 'later', zone: 'zone-b', prefix: '/b/' }; };
const addBC = o => { addB(o); o.groups['group-c'] = { role: 'a second fixture group', host: 'group-c.invalid', state: 'later', zone: 'zone-c', prefix: '/c/' }; };
const snap = edit => { const s = structuredClone(REAL); edit(s); return s; };
const msgs = ps => ps.map(p => `${p.file}: ${p.msg}`);
const has = (ps, re) => ps.some(p => re.test(`${p.file}: ${p.msg}`));

test('the real tree is clean under every seam', () => {
  assert.deepEqual(msgs(seamProblems(REAL)), []);
  assert.ok(REAL.pages.length >= 7 && REAL.files.length > 50, 'the snapshot is not empty: ' + REAL.pages.length + ' pages, ' + REAL.files.length + ' files');
});

// ── seam 1: path prefixes as groups ─────────────────────────────────────────────────────────────────────────
test('seam 1: a page file becomes a clean URL path', () => {
  assert.equal(pagePath('web/index.html', 'web'), '/');
  assert.equal(pagePath('web/pricing.html', 'web'), '/pricing');
  assert.equal(pagePath('web/404.html', 'web'), '/404');
  assert.equal(pagePath('web/docs/index.html', 'web'), '/docs/');
  assert.equal(pagePath('web/docs/a.html', 'web'), '/docs/a');
});

test('seam 1: every served page of the real tree belongs to exactly one group, and today that is company', () => {
  const { seams, problems } = parseSeams(REAL.seamsText);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(seams.groups), ['company'], 'the map holds only the live group');
  assert.equal(seams.groups.company.state, 'live');
  const paths = REAL.pages.map(p => pagePath(p.file, 'web'));
  assert.deepEqual(msgs(groupProblems(seams, paths)), []);
  assert.deepEqual([...seams.groups.company.pages].sort(), [...paths].sort(), 'company holds every served page today');
});

test('seam 1: a page outside every group fails, and the message names the _redirects change that moves a group', () => {
  const ps = groupProblems(seamsOf(), ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog', '/404', '/orphan']);
  assert.ok(has(ps, /\/orphan belongs to no group/), JSON.stringify(ps));
  assert.ok(has(ps, /web\/_redirects/), 'it names the redirect file');
});

test('seam 1: a page in the publish root of one zone whose group says another zone fails', () => {
  const s = snap(x => {
    x.seamsText = JSON.stringify(seamsOf(o => {
      o.groups.company.pages = o.groups.company.pages.filter(p => p !== '/pricing');
      o.groups['group-b'] = { role: 'a fixture group', host: 'group-b.invalid', state: 'live', zone: 'zone-b', pages: ['/pricing'] };
      o.zones['zone-b'] = { root: 'web-b', headers: 'web-b/_headers', csp: ['/*'] };
    }));
  });
  assert.ok(has(seamProblems(s), /web\/pricing\.html: is served by the company zone's Worker, but group group-b says zone zone-b/), JSON.stringify(msgs(seamProblems(s)).slice(0, 4)));
});

test('seam 1: a page in two groups fails', () => {
  const seams = seamsOf(o => { addB(o); o.groups.company.pages.push('/b/x'); });
  const ps = groupProblems(seams, ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog', '/404', '/b/x']);
  assert.ok(has(ps, /\/b\/x belongs to more than one group \(company, group-b\)/), JSON.stringify(ps));
});

test('seam 1: a group that is still later serves no page, and a listed page that no file serves is stale', () => {
  const live = ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog', '/404'];
  assert.ok(has(groupProblems(seamsOf(addB), [...live, '/b/index']), /group group-b has state later, so it serves no page yet, but \/b\/index is under its prefix/));
  assert.ok(has(groupProblems(seamsOf(o => { o.groups.company.pages.push('/gone'); }), live), /company lists \/gone, which no served page has/));
});

test('seam 1: a malformed map fails on every shape rule, and an unreadable one fails loud', () => {
  const bad = (edit, re, what) => { const { problems } = parseSeams(JSON.stringify(seamsOf(edit))); assert.ok(problems.some(p => re.test(p.msg)), what + ': ' + JSON.stringify(problems)); };
  bad(o => { addB(o); o.groups['group-b'].prefix = 'b/'; }, /prefix "b\/" must start and end with a slash/, 'prefix without slashes');
  bad(o => { addBC(o); o.groups['group-c'].prefix = '/b/'; }, /prefix \/b\/ is taken by two groups/, 'a prefix twice');
  bad(o => { addBC(o); o.groups['group-c'].prefix = '/b/c/'; }, /prefix \/b\/c\/ lies inside \/b\//, 'nested prefixes');
  bad(o => { addB(o); o.groups['group-b'].state = 'soon'; }, /state "soon" is not live or later/, 'unknown state');
  bad(o => { delete o.groups.company; }, /company group is missing/, 'no company group');
  bad(o => { o.groups.company.zone = 'nowhere'; }, /live group company is in zone nowhere, which web-src\/seams\.json does not declare/, 'a live group in an undeclared zone');
  bad(o => { addB(o); o.groups['group-b'].prefix = undefined; }, /group group-b holds no page and no prefix/, 'a group with neither');
  bad(o => { o.groups.company.host = 'Kolwen.com/x'; }, /host "Kolwen\.com\/x" is not a bare lower-case host name/, 'a host with a path');
  assert.ok(parseSeams('{ not json').problems.some(p => /is not valid JSON/.test(p.msg)));
  assert.ok(parseSeams(null).problems.some(p => /is missing/.test(p.msg)));
  assert.equal(parseSeams(null).seams, null);
});

// ── seam 2: the legal pages cover every group ────────────────────────────────────────────────────────────────
test('seam 2: every page of every group links the one terms and privacy pages (the real footers do)', () => {
  const { seams } = parseSeams(REAL.seamsText);
  assert.deepEqual(msgs(legalLinkProblems(seams, REAL.pages)), []);
});

test('seam 2: a page without the privacy link, or with a copy of it off-site, fails and names its group', () => {
  const seams = parseSeams(REAL.seamsText).seams;
  const page = (file, html) => ({ file, html });
  const footer = '<footer><a href="/terms">T</a><a href="/privacy">P</a></footer>';
  assert.deepEqual(legalLinkProblems(seams, [page('web/index.html', footer)]), []);
  assert.ok(has(legalLinkProblems(seams, [page('web/pricing.html', '<footer><a href="/terms">T</a></footer>')]), /web\/pricing\.html: group company: no link to the privacy page \(https:\/\/kolwen\.com\/privacy\)/));
  assert.ok(has(legalLinkProblems(seams, [page('web/pricing.html', '<footer><a href="/terms">T</a><a href="https://example.com/privacy">P</a></footer>')]), /no link to the privacy page/));
  assert.ok(has(legalLinkProblems(seams, [page('web/pricing.html', '<footer><a href="/privacy">P</a></footer>')]), /no link to the terms page/));
  // a link in a comment, in a script string or without an href is no link
  assert.ok(has(legalLinkProblems(seams, [page('web/pricing.html', '<!-- <a href="/terms">T</a><a href="/privacy">P</a> --><script>"<a href=\\"/terms\\">"</script><a>x</a>')]), /no link to the terms page/));
  // a group that has moved to its own host reaches the one set at kolwen.com by an absolute link, never a relative one
  const moved = parseSeams(JSON.stringify(seamsOf(o => { addB(o); o.groups['group-b'].state = 'live'; o.groups['group-b'].zone = 'company'; }))).seams;
  const rel = legalLinkProblems(moved, [page('web/b/index.html', footer)]);
  assert.ok(has(rel, /group group-b: no link to the terms page/), JSON.stringify(rel));
  assert.deepEqual(legalLinkProblems(moved, [page('web/b/index.html', '<a href="https://kolwen.com/terms">T</a><a href="https://kolwen.com/privacy">P</a>')]), []);
});

test('seam 2: a Thai legal paragraph is measured in words by a segmenter, so one with few spaces is found', () => {
  const sources = REAL.legal.sources, lg = parseSeams(REAL.seamsText).seams.legal, allowed = new Set([...sources.map(s => s.file), ...lg.renderedAs, ...lg.generatedBy]);
  const terms = sources.find(s => s.file === 'TERMS.md').text;
  const paras = terms.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim());
  // a Thai paragraph with fewer than 12 chunks between spaces (a count of spaces would let it through) and at least 12 words by the segmenter
  const thai = paras.find(s => /\p{Script=Thai}/u.test(s) && !/^[|#>`]/.test(s) && s.split(' ').length < 12 && wordCount(s) >= 12);
  assert.ok(thai, 'such a Thai paragraph exists in TERMS.md to plant (the unit is words, not spaces)');
  const ps = legalCopyProblems({ sources, files: [...REAL.files, { file: 'README.md', text: 'Intro.\n\n' + thai + '\n' }], allowed });
  assert.ok(has(ps, /README\.md: holds a paragraph of TERMS\.md/), JSON.stringify(ps));
  // the same paragraph with other spacing and a line wrap in the middle is the same copy; a Thai sentence of fewer than 12 words is a quotation
  const wrapped = thai.replace(/ /g, '\n  ').replace(/(.{20})/, '$1\n');
  assert.ok(has(legalCopyProblems({ sources, files: [...REAL.files, { file: 'README.md', text: wrapped }], allowed }), /README\.md: holds a paragraph of TERMS\.md/), 'a wrapped copy is found');
  const few = Array.from(thai).slice(0, 18).join('');
  assert.ok(wordCount(few) < 12, 'the quotation is under the threshold');
  assert.deepEqual(legalCopyProblems({ sources, files: [...REAL.files, { file: 'README.md', text: few }], allowed }), []);
  // the unit: whitespace-separated Latin words, and Thai words found by dictionary
  assert.equal(wordCount('one two three'), 3);
  assert.ok(wordCount('ผู้ใช้ต้องอ่านข้อกำหนดนี้ก่อนใช้บริการ') >= 5, 'Thai words run together are counted');
});

test('seam 2: no second copy of a legal text exists anywhere in the tree', () => {
  const sources = REAL.legal.sources, lg = parseSeams(REAL.seamsText).seams.legal, allowed = new Set([...sources.map(s => s.file), ...lg.renderedAs, ...lg.generatedBy]);
  assert.deepEqual(msgs(legalCopyProblems({ sources, files: REAL.files, allowed })), []);
  const para = text => text.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).find(s => s.split(' ').length >= 20 && !/^[|#>`]/.test(s));
  const terms = sources.find(s => s.file === 'TERMS.md').text, privacy = sources.find(s => s.file === 'PRIVACY.md').text;
  const copied = para(terms), thai = privacy.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).find(s => /\p{Script=Thai}/u.test(s) && s.split(' ').length >= 12);
  assert.ok(copied && thai, 'a long English paragraph of the terms and a Thai one of the privacy notice exist to plant');
  const files = [...REAL.files, { file: 'docs/oops.md', text: 'Intro.\n\n' + copied + '\n' }, { file: 'web/pricing.html', text: '<p><strong>' + thai.replace(/ /g, '</strong> <strong>') + '</strong></p>' }];
  const ps = legalCopyProblems({ sources, files, allowed });
  assert.ok(has(ps, /docs\/oops\.md: holds a paragraph of TERMS\.md/), JSON.stringify(ps));
  assert.ok(has(ps, /web\/pricing\.html: holds a paragraph of PRIVACY\.md/), 'a Thai paragraph copied into markup is found');
  // capitals make no difference
  assert.ok(has(legalCopyProblems({ sources, files: [...REAL.files, { file: 'docs/upper.md', text: copied.toUpperCase() }], allowed }), /docs\/upper\.md: holds a paragraph of TERMS\.md/), 'a copy in capitals is found');
  // a short sentence is a quotation, not a copy, and the sources and their renderings are allowed
  const short = copied.split(' ').slice(0, 6).join(' ');
  assert.deepEqual(legalCopyProblems({ sources, files: [...REAL.files, { file: 'docs/short.md', text: short }], allowed }), []);
  // the rule is not vacuous: an empty source list is a finding
  assert.ok(has(legalCopyProblems({ sources: [], files: REAL.files, allowed }), /no legal source/));
});

// ── seam 3: the CSP is keyed per zone ────────────────────────────────────────────────────────────────────────
const headersOf = s => s.headers['web/_headers'];
const zonePaths = ['/', '/pricing', '/terms', '/privacy', '/refund', '/changelog', '/404'];

test('seam 3: in the real tree one rule, /*, carries the CSP and it belongs to the company zone', () => {
  const seams = parseSeams(REAL.seamsText).seams;
  assert.deepEqual(msgs(cspZoneProblems(seams, 'company', headersOf(REAL), zonePaths)), []);
});

test('seam 3: a second CSP rule that overlaps the zone rule fails: Cloudflare would join the two values', () => {
  const seams = parseSeams(REAL.seamsText).seams;
  const h = headersOf(REAL) + '\n/pricing\n  Content-Security-Policy: default-src \'none\'\n';
  const ps = cspZoneProblems(seams, 'company', h, zonePaths);
  assert.ok(has(ps, /declares a Content-Security-Policy on \/pricing, which no zone claims/), JSON.stringify(ps));
  const seams2 = parseSeams(JSON.stringify(seamsOf(o => { o.zones.company.csp.push('/pricing'); }))).seams;
  const ps2 = cspZoneProblems(seams2, 'company', h, zonePaths);
  assert.ok(has(ps2, /\/pricing is matched by 2 CSP rules \(\/\*, \/pricing\); Cloudflare joins the values of two matching rules/), JSON.stringify(ps2));
});

test('seam 3: a host-keyed CSP rule is seen: on a host of the zone it joins with /*, and on any other host no zone claims it', () => {
  const seams = parseSeams(REAL.seamsText).seams;
  const rule = (host, extra = "Content-Security-Policy: default-src 'none'") => `\nhttps://${host}/*\n  ${extra}\n`;
  const own = cspZoneProblems(seams, 'company', headersOf(REAL) + rule('kolwen.com'), zonePaths);
  assert.ok(has(own, /declares a Content-Security-Policy on https:\/\/kolwen\.com\/\*, which no zone claims/), JSON.stringify(own));
  const claimedMap = parseSeams(JSON.stringify(seamsOf(o => { o.zones.company.csp.push('https://kolwen.com/*'); })));
  assert.deepEqual(claimedMap.problems, [], 'a zone may claim a host rule');
  const claimed = claimedMap.seams;
  // a host rule on a path no page has is a rule the zone claims and that joins nothing on its pages
  const sub = parseSeams(JSON.stringify(seamsOf(o => { o.zones.company.csp.push('https://kolwen.com/other/*'); }))).seams;
  assert.deepEqual(msgs(cspZoneProblems(sub, 'company', headersOf(REAL) + rule('kolwen.com').replace('/*', '/other/*'), zonePaths)), [], 'a host rule for another path does not join the pages');
  const both = cspZoneProblems(claimed, 'company', headersOf(REAL) + rule('kolwen.com'), zonePaths);
  assert.ok(has(both, /\/pricing is matched by 2 CSP rules \(\/\*, https:\/\/kolwen\.com\/\*\); Cloudflare joins the values of two matching rules/), JSON.stringify(both));
  assert.ok(has(both, /the path of an unmatched request \(the 404 fallback\) is matched by 2 CSP rules/), 'the 404 fallback joins too');
  // a host rule for a host no group of the zone has (a preview host, a placeholder host) is refused as outside the map, and does not join anything
  const preview = cspZoneProblems(seams, 'company', headersOf(REAL) + rule(':version.:subdomain.workers.dev'), zonePaths);
  assert.ok(has(preview, /declares a Content-Security-Policy on https:\/\/:version\.:subdomain\.workers\.dev\/\*, which no zone claims/), JSON.stringify(preview));
  assert.ok(!has(preview, /matched by 2 CSP rules/), 'it joins nothing on the zone host');
  // a host rule with another header (the real preview rule sets only X-Robots-Tag) carries no CSP and is not a CSP rule
  assert.deepEqual(msgs(cspZoneProblems(seams, 'company', headersOf(REAL) + rule('kolwen.com', 'X-Robots-Tag: noindex'), zonePaths)), []);
});

test('seam 3: a claimed pattern with no rule, a path with no CSP, and a zone that drops /* all fail', () => {
  const seams = parseSeams(REAL.seamsText).seams;
  const noCsp = headersOf(REAL).split('\n').filter(l => !/^\s+Content-Security-Policy:/.test(l)).join('\n');
  const ps = cspZoneProblems(seams, 'company', noCsp, zonePaths);
  assert.ok(has(ps, /zone company claims the CSP rule \/\*, which web\/_headers does not declare/), JSON.stringify(ps));
  assert.ok(has(ps, /\/pricing is matched by no CSP rule/), JSON.stringify(ps));
  const rekeyed = parseSeams(JSON.stringify(seamsOf(o => { o.zones.company.csp = zonePaths; }))).seams;
  const h = headersOf(REAL).replace(/\n\/\*\n/, '\n/pricing\n');
  assert.ok(has(cspZoneProblems(rekeyed, 'company', h, zonePaths), /post-deploy-check reads the "\/\*" rule/), 'the served-header reader is named');
});

test('seam 3: an unmatched path (the 404 fallback) must get the CSP, and the strict policy admits no unsafe-inline', () => {
  const seams = parseSeams(REAL.seamsText).seams;
  const h = headersOf(REAL).replace(/\n\/\*\n(\s+Content-Security-Policy:)/, '\n/*.html\n$1');
  const ps = cspZoneProblems(parseSeams(JSON.stringify(seamsOf(o => { o.zones.company.csp = ['/*.html']; }))).seams, 'company', h, zonePaths);
  assert.ok(has(ps, /the path of an unmatched request \(the 404 fallback\) is matched by no CSP rule/), JSON.stringify(ps));
  const loose = headersOf(REAL).replace(/(Content-Security-Policy: [^\n]*?script-src )/, "$1'unsafe-inline' ");
  assert.ok(has(cspZoneProblems(seams, 'company', loose, zonePaths), /company zone's policy admits 'unsafe-inline' in script-src/), 'a strict zone stays strict');
});

test('seam 3: two zones may not share one headers file, and a live zone names a root and a headers file', () => {
  const dup = parseSeams(JSON.stringify(seamsOf(o => { o.zones.other = { root: 'web', headers: 'web/_headers', csp: ['/x/*'] }; })));
  assert.ok(dup.problems.some(p => /zones company and other share the headers file web\/_headers/.test(p.msg)), JSON.stringify(dup.problems));
  const bare = parseSeams(JSON.stringify(seamsOf(o => { o.zones.company = { csp: ['/*'] }; })));
  assert.ok(bare.problems.some(p => /zone company names no root and headers file/.test(p.msg)), JSON.stringify(bare.problems));
});

test('seam 3: today served headers are exactly the declared ones: the rule parser reads /_headers into the same five values', async () => {
  const { parseHeadersFile, declaredSecurityHeaders } = await import('./lib/headers-file.mjs');
  const d = declaredSecurityHeaders(parseHeadersFile(headersOf(REAL)));
  assert.equal(Object.keys(d).length, 5);
  assert.match(d.csp, /^default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; script-src /);
});

// ── seam 4: host-only cookies, and today none at all ────────────────────────────────────────────────────────
test('seam 4: nothing the site ships sets a cookie, with or without a Domain attribute', () => {
  assert.deepEqual(msgs(cookieProblems(REAL.shipped)), []);
  assert.ok(REAL.shipped.some(f => f.file === 'web/_headers') && REAL.shipped.some(f => f.file === 'web/index.html'), 'the scan reaches the headers file and the pages');
});

test('seam 4: a Set-Cookie header, a document.cookie write and a Worker cookie call each fail; a Domain attribute is named as the parent-domain scope', () => {
  const one = (file, text) => cookieProblems([{ file, text }]);
  const p = (file, text, re, what) => assert.ok(has(one(file, text), re), what + ': ' + JSON.stringify(one(file, text)));
  p('web/_headers', '/*\n  Set-Cookie: a=b; Path=/\n', /sets a cookie.*Set-Cookie header/, 'a Set-Cookie header');
  p('web/_headers', '/*\n  set-cookie: a=b; Domain=.kolwen.com\n', /Domain attribute.*every subdomain/, 'a Domain attribute in a header');
  p('web/index.html', '<script>document.cookie = "a=b";</script>', /writes document\.cookie/, 'a document.cookie write');
  p('web/index.html', '<script>document["cookie"] += "a=b";</script>', /writes document\.cookie/, 'a bracket write');
  // every assignment operator that writes: the logical ones ("set it if absent") and the shifts and the rest, not only the single-character ones
  for (const op of ['||=', '&&=', '??=', '%=', '**=', '<<=', '>>=', '>>>=', '+=', '-=', '*=', '/=', '&=', '|=', '^=']) {
    p('web/index.html', `<script>document.cookie ${op} "a=b";</script>`, /writes document\.cookie/, `a write with ${op}`);
    p('web/index.html', `<script>d["cookie"]${op}"a=b";</script>`, /writes document\.cookie/, `a bracket write with ${op}, no spaces`);
  }
  p('web/index.html', '<script>document.cookie="a=b; domain=kolwen.com";</script>', /Domain attribute/, 'a Domain attribute in script');
  p('web/index.html', '<meta http-equiv="set-cookie" content="a=b">', /sets a cookie/, 'a meta set-cookie');
  p('worker/index.js', 'export default { fetch() { const r = new Response(""); r.headers.append("Set-Cookie", "a=b"); return r; } }', /sets a cookie/, 'a Worker Set-Cookie');
  p('worker/index.js', 'c.cookies.set("s", v, { domain: ".kolwen.com" });', /Domain attribute/, 'a cookie library domain option');
  p('worker/index.js', 'await cookieStore.set("a", "b");', /sets a cookie/, 'the Cookie Store API');
  // the same forms in a page's INLINE script (the inline script's hash in the CSP is rule 13's business, not this seam's: this seam must speak on its own)
  const inline = code => `<!DOCTYPE html><html><body><script>${code}</script></body></html>`;
  p('web/index.html', inline('cookieStore.set("a", "b");'), /sets a cookie \(the Cookie Store API\)/, 'the Cookie Store API in an inline script');
  p('web/index.html', inline('fetch("/", { headers: { "Set-Cookie": "a=b" } });'), /sets a cookie \(a Set-Cookie header\)/, 'a quoted Set-Cookie header in an inline script');
  p('web/index.html', inline('document[`cookie`] = "a=b";'), /writes document\.cookie/, 'a template-literal bracket write');
  p('web/index.html', inline('Object.assign(document, { cookie: "a=b" });'), /writes document\.cookie/, 'Object.assign on the document');
  p('web/index.html', inline('const d = document; d.cookie = "a=b";'), /writes document\.cookie/, 'a write through another name for the document');
  p('web/index.html', inline('cookieLib.set("s", v, { domain: ".kolwen.com" });'), /Domain attribute/, 'a cookie library domain option in an inline script');
  p('web/index.html', inline('cookies.set("s", v);'), /sets a cookie \(a cookie call\)/, 'a cookie library call in an inline script');
  // a write whose `=` is not right after the property: a comment between them, a destructuring target (array or object, any position), a for-of or for-in target
  for (const code of ['document.cookie /* c */ = "a=b";', 'document.cookie // c\n = "a=b";', 'document["cookie"] /* c */ += "a=b";', '[document.cookie] = ["a=b"];', '[x, document.cookie] = ["a", "a=b"];', '[document.cookie, y] = z;', '[...document.cookie] = z;',
    '({ k: document.cookie } = o);', '({ k: document.cookie, j } = o);', '({ a, k: d.cookie } = o);', '[[document.cookie]] = [["a=b"]];', '[document["cookie"]] = ["a=b"];', '[document.cookie = "d"] = [];',
    'for (document.cookie of ["a=b"]) {}', 'for (d.cookie in o) {}', 'for await (document.cookie of s) {}', 'for (document["cookie"] of l) {}']) {
    p('web/index.html', inline(code), /writes document\.cookie/, code);
    p('worker/index.js', code, /writes document\.cookie/, 'a code file: ' + code);
  }
  // and the look-alikes that only read are not writes
  for (const code of ['var [a, b] = [x, document.cookie];', 'f({ k: document.cookie });', 'for (const c of document.cookie.split(";")) {}', 'var o = { k: document.cookie }; var z = 1;', 'if ([document.cookie] == z) {}', 'if ([document.cookie] === z) {}', 'for (var i in document.cookie) {}', 'var q = { k: document.cookie }\nb = 1', 'x = [document.cookie]\ny = 2'])
    assert.deepEqual(one('web/index.html', inline(code)), [], code);
  // PR #56 round 1 (CodeRabbit 4309062039, the reviewer's L-2): a for-of or for-in target with a comment or closing delimiters before `of`, the update operators, a line comment ended by CR, U+2028 or
  // U+2029, and a property or key spelled with an escape. Built from code points: the test file holds no escape of its own.
  const BS = String.fromCharCode(92), CR = String.fromCharCode(13), LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029), NL = String.fromCharCode(10);
  const more = [
    'for (document.cookie /* c */ of l) {}', 'for ([document.cookie] of l) {}', 'for ({ k: document.cookie } of l) {}', 'for ([document.cookie, y] in o) {}', 'for (document.cookie // c' + NL + ' of l) {}', 'for ([document.cookie] /* c */ of l) {}',
    'for ([[document.cookie]] of l) {}', 'for await ([document.cookie] of s) {}',
    'document.cookie++;', '++document.cookie;', 'document.cookie--;', '--document.cookie;', 'd["cookie"]++;', '++a.b.cookie;', 'document.cookie /* c */ ++;', '-- /* c */ document.cookie;',
    'document.cookie // c' + CR + '= "x";', 'document.cookie // c' + LS + '= "x";', 'document.cookie // c' + PS + '= "x";',
    'document.' + BS + 'u0063ookie = "a=b";', 'document.' + BS + 'u{63}ookie = "a=b";', 'document.c' + BS + 'u006Fokie = "a=b";', 'document["c' + BS + 'x6fokie"] = "a=b";', 'document["' + BS + 'u0063ookie"] += "a=b";',
    'document[`c' + BS + 'x6Fokie`] = "a=b";', 'document["c' + BS + 'u{6f}okie"]++;',
    // PR #56 round 2 (Q-8a): a comment between the object, the dot and the name, or inside the brackets
    'document /* c */ . /* c */ cookie = "x";', 'document. /* c */ cookie = "x";', 'document. // c' + NL + ' cookie = "x";', 'document[ /* c */ "cookie" /* c */ ] = "x";', 'document[ // c' + NL + ' "cookie" ] += "x";',
    'document. /* c */ cookie++;', '++document. /* c */ cookie;', 'for (document. /* c */ cookie of l) {}', '[document. /* c */ cookie] = a;', '({ k: document /* c */ . /* c */ cookie } = o);',
  ];
  for (const code of more) {
    p('web/index.html', inline(code), /writes document\.cookie/, code);
    p('worker/index.js', code, /writes document\.cookie/, 'a code file: ' + code);
  }
  // what only reads stays clean: a property that merely starts with the word, a loop variable of that name, the postfix operator across a line break (the grammar forbids it), and a comparison
  for (const code of ['for (const cookieof of l) {}', 'for (d.cookieof of l) {}', 'var n = d.cookies++;', 'a = document.cookie' + NL + '++b;', 'x = document.cookie;' + NL + '--y;', 'f(document.cookie) // c' + CR + 'g = 1', 'if (document.cookie > 1) {}', 'var o = { cookie: 1 }; o.cookie2 = 2;', 'var a = document. /* c */ cookie;', 'if (document /* c */ . /* c */ cookie == z) {}', 'x = document[ /* c */ "cookie" ];'])
    assert.deepEqual(one('web/index.html', inline(code)), [], code);
  // the stated limits, kept true: these writes are NOT seen (an item that holds = after the target, a parenthesised target, an HTML-like comment as the line break, a key built at run time), and two
  // forms that only read are reported (a destructuring default, and a statement that starts with `document.cookie` on the line after a postfix operator)
  for (const code of ['[document.cookie, z = 1] = a;', '[document.cookie, [y = 1]] = a;', '[(document.cookie)] = a;', 'for ((document.cookie) of l) {}', 'document.cookie <!-- c' + NL + '= "x";', 'document["coo" + "kie"] = "a=b";', 'document[k] = "a=b";']) assert.deepEqual(one('web/index.html', inline(code)), [], 'a stated limit: ' + code);
  assert.ok(has(one('web/index.html', inline('const { a = document.cookie } = o;')), /writes document\.cookie/), 'a stated loud false positive: a default that reads');
  assert.ok(has(one('web/index.html', inline('i++' + NL + 'document.cookie;')), /writes document\.cookie/), 'a stated loud false positive: a statement after a postfix operator that reads');
  // a script that is not code (structured data) or prose on the page is not a cookie
  assert.deepEqual(one('web/index.html', '<script type="application/ld+json">{"note": "set-cookie"}</script><p>The Set-Cookie header and cookieStore.set(x) are named here in prose.</p>'), []);
  assert.deepEqual(one('web/index.html', inline('var a = d.cookie; if (d.cookie == "x") {} var s = "Set-Cookie is not sent";')), []);
  // reading, comparing and prose are not setting
  assert.deepEqual(one('web/index.html', '<script>if (document.cookie === "") {}; var c = document.cookie;</script><p>This site sets no cookie and no Domain is shared.</p>'), []);
  for (const cmp of ['==', '===', '!=', '!==', '<=', '>=', '<', '>']) assert.deepEqual(one('web/index.html', `<script>if (document.cookie ${cmp} "x") {}</script>`), [], `a comparison with ${cmp} reads, never writes`);
  assert.deepEqual(one('web/index.html', '<script>var f = x => x.cookie; var g = (document.cookie, 1);</script>'), [], 'an arrow function that returns the property reads');
  assert.deepEqual(one('web/_headers', '# no Set-Cookie header is sent here, no Domain\n# a cookie sent with ; Domain=.x would reach every subdomain, so none is\n/*\n  Referrer-Policy: no-referrer\n'), []);
});

// A regular expression over a file a stranger could write must not take longer as its input grows. Not a wall-clock assertion: the check runs in a child under a kill-timeout and a heap cap, and the
// test asserts that the child FINISHED (it was not killed, it did not run out of memory). Each input has no `=` and no `of`, so the engine has to try every split.
test('seam 4: the cookie check finishes on pathological input: every input ends the child itself, under a kill-timeout and a heap cap, never by the kill', () => {
  const lib = pathToFileURL(join(process.cwd(), 'scripts/lib/domain-seams.mjs')).href;
  const child = `
    const { cookieProblems } = await import(${JSON.stringify(lib)});
    const N = 200000, NL = String.fromCharCode(10), CR = String.fromCharCode(13);
    const inputs = [
      'document.cookie' + ' /*'.repeat(N),
      '[document.cookie' + ' '.repeat(N) + ']' + ' '.repeat(N),
      '[document.cookie] '.repeat(N / 4),
      'for (' + 'x '.repeat(N),
      '.cookie] ' + ' '.repeat(50) + '.cookie]'.repeat(N / 60),
      'for (document.cookie' + ' /* c */'.repeat(N / 8),
      'for (document.cookie' + ' /* c */'.repeat(N / 8) + ' ]'.repeat(N / 8),
      '++' + ' '.repeat(N) + 'document',
      '++ /* c */'.repeat(N / 8) + 'document.cookie',
      'document.cookie' + (' //' + CR).repeat(N / 4),
      'document.cookie //' + 'x'.repeat(N),
      'document.cookie' + (NL + ' ').repeat(N / 2),
      'document["' + 'c'.repeat(N) + '"]',
      'document[' + "'" + 'c\\\\x6f'.repeat(N / 8),
      '.' + ' /* c */'.repeat(N / 8) + ' x',
      '[' + ' /* c */'.repeat(N / 8) + ' "cookie"',
      '. '.repeat(N / 2) + 'cookie',
    ];
    let seen = 0;
    for (const t of inputs) { cookieProblems([{ file: 'web/index.html', text: '<script>' + t + '</script>' }]); cookieProblems([{ file: 'worker/index.js', text: t }]); seen++; }
    console.log('FINISHED ' + seen);
  `;
  const r = spawnSync(process.execPath, ['--max-old-space-size=256', '--input-type=module', '-e', child], { encoding: 'utf8', timeout: 120000, killSignal: 'SIGKILL' });
  assert.equal(r.error, undefined, 'the child was not killed by the timeout: ' + (r.error && r.error.message));
  assert.equal(r.signal, null, 'and no signal ended it: ' + r.signal);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^FINISHED 17\n?$/);
});

test('seam 4: the scan is not vacuous: no shipped file at all is a finding', () => {
  assert.ok(has(cookieProblems([]), /no shipped file/));
});

// ── seam 5: the page-keyed catalogue names no domain or host ─────────────────────────────────────────────────
test('seam 5: the real catalogue is keyed by page and names no domain or host in any key', () => {
  assert.deepEqual(msgs(catalogueDomainProblems(REAL.catalogue, REAL.templates)), []);
  assert.deepEqual(Object.keys(JSON.parse(Object.values(REAL.catalogue)[0])).sort(), ['home', 'notfound', 'pricing', 'shared']);
});

test('seam 5: a key that names a host, a TLD or a domain fails, at any depth and in any language file', () => {
  const cat = edit => { const c = structuredClone(REAL.catalogue); for (const k of Object.keys(c)) { const o = JSON.parse(c[k]); edit(o, k); c[k] = JSON.stringify(o); } return c; };
  const bad = (edit, re, what) => assert.ok(has(catalogueDomainProblems(cat(edit), REAL.templates), re), what);
  bad(o => { o.home['host-a.invalid'] = 'x'; }, /key "host-a\.invalid" names a host/, 'a host-shaped key');
  bad(o => { o.pricing.compare.com = 'x'; }, /key "pricing\.compare\.com" names a domain or host/, 'a TLD segment');
  bad(o => { o.shared.domain = 'x'; }, /key "shared\.domain" names a domain or host/, 'the word domain');
  bad(o => { o.shared.footer.hostname = 'x'; }, /key "shared\.footer\.hostname"/, 'the word hostname');
  bad(o => { o['host-b.invalid'] = { a: 'x' }; }, /key "host-b\.invalid" names a host/, 'a host as a page key');
  bad(o => { o.checkout = { a: 'x' }; }, /top-level key "checkout" is neither a template page nor shared/, 'a top-level key that is no page');
  assert.ok(has(catalogueDomainProblems({}, REAL.templates), /no catalogue file/), 'an empty catalogue is a finding, not a pass');
  assert.ok(has(catalogueDomainProblems({ 'web-src/i18n/en.json': '{ no' }, REAL.templates), /is not valid JSON/));
  // values may name the brand and hosts: the rule reads keys only
  assert.deepEqual(catalogueDomainProblems(cat(o => { o.home.origin = 'Visit kolwen.com or host-a.invalid'; }), REAL.templates), []);
});

test('the one entry point reports every seam: a cookie, a catalogue host key, a legal copy, a second CSP rule and a page with no legal link, in one snapshot', () => {
  const terms = REAL.legal.sources.find(s => s.file === 'TERMS.md').text;
  const copied = terms.split(/\n\s*\n/).map(s => s.replace(/\s+/g, ' ').trim()).find(s => s.split(' ').length >= 20 && !/^[|#>`]/.test(s));
  const s = snap(x => {
    x.shipped.push({ file: 'web/extra.js', text: 'document.cookie = "a=b";' });
    const en = Object.keys(x.catalogue)[0], cat = JSON.parse(x.catalogue[en]);
    cat.shared['host-a.invalid'] = 'x';
    x.catalogue[en] = JSON.stringify(cat);
    x.files.push({ file: 'docs/copy.md', text: copied });
    x.headers['web/_headers'] += "\n/pricing\n  Content-Security-Policy: default-src 'none'\n";
    x.pages = x.pages.map(p => (p.file === 'web/pricing.html' ? { ...p, html: p.html.split('href="/privacy"').join('href="/x"') } : p));
  });
  const ps = seamProblems(s);
  for (const [re, what] of [[/web\/extra\.js: writes document\.cookie/, 'seam 4'], [/key "host-a\.invalid" names a host/, 'seam 5'], [/docs\/copy\.md: holds a paragraph of TERMS\.md/, 'seam 2 copy'], [/declares a Content-Security-Policy on \/pricing/, 'seam 3'], [/web\/pricing\.html: group company: no link to the privacy page/, 'seam 2 link']]) assert.ok(has(ps, re), what + ': ' + JSON.stringify(msgs(ps).map(m => m.slice(0, 90))));
  // a map that is missing or malformed ends the run with its own findings: nothing is judged against no map
  assert.deepEqual(msgs(seamProblems(snap(x => { x.seamsText = null; }))).length, 1);
});

// A host of the brand other than the one the owner holds: `kolwen.` and a label that is not `com`, except the Worker's own production alias (`kolwen.hetcreep.workers.dev`, which wrangler.jsonc
// disables and which three files record). Generic: it names no host, and catches any other top-level domain.
// Each exemption ends at a HOST boundary: a word character or a hyphen, or a dot followed by a letter or digit, continues the host (`kolwen.com.au`, `kolwen.com-shop`,
// `kolwen.hetcreep.workers.dev.evil`); a dot that ends a sentence does not.
const OTHER_BRAND_HOST = /\bkolwen\.(?!com(?![\w-]|\.[a-z0-9]))(?!hetcreep\.workers\.dev(?![\w-]|\.[a-z0-9]))[a-z][a-z0-9-]*/i;
// A browser reads a host through IDNA mapping (UTS #46) and a URL through its percent-decoding, so the text is tested as written AND in the form a browser would read it: the fullwidth ASCII block
// U+FF01 to U+FF5E (the fullwidth letters and full stop) as ASCII, the ideographic full stops U+3002 and U+FF61 as a dot, the characters that map to nothing in a host (soft hyphen, zero width space,
// joiners, word joiner, BOM) dropped, and every percent escape decoded once (UTF-8, so %E3%80%82 is U+3002). The mapping is written out and calls no Unicode compatibility normalisation: no source of this repository does (a test of
// i18n-catalogue.test.mjs holds that line, because that form would damage the Thai catalogue), and one host guard is no reason to open it. STATED LIMITS, each kept true by a test below: every other mapping
// of UTS #46's table (mathematical and circled letters, compatibility ligatures, small forms), a double-encoded escape (%252E, %25E3%2580%2582), a truncated or invalid escape sequence, a punycode label (xn--), a bidi control; and prose that is no host is caught
// (`Kolwen.Next`, a file name such as `kolwen.svg`): the guard is a loud tripwire on our own text, never a parser of hosts.
const IGNORED_IN_HOST = new RegExp('[' + String.fromCharCode(0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff) + ']', 'g');
const IDEOGRAPHIC_STOP = new RegExp('[' + String.fromCharCode(0x3002, 0xff61) + ']', 'g');
const FULLWIDTH_ASCII = new RegExp('[' + String.fromCharCode(0xff01) + '-' + String.fromCharCode(0xff5e) + ']', 'g');
// Percent-decoding comes first and covers every escaped byte, not only %2E: the UTF-8 bytes of U+3002, U+FF0E and U+FF61 (`%E3%80%82`, `%EF%BC%8E`, `%EF%BD%A1`) decode to the characters the later
// steps map to a dot. A run of escapes is decoded as UTF-8 without throwing (an invalid byte becomes U+FFFD, so one bad escape spoils only itself). One pass only, as a browser does it.
const PERCENT_RUN = /(?:%[0-9a-f]{2})+/gi;
const percentDecoded = text => text.replace(PERCENT_RUN, run => new TextDecoder().decode(Uint8Array.from(run.slice(1).split('%'), h => parseInt(h, 16))));
const asBrowserReads = text => percentDecoded(text).replace(FULLWIDTH_ASCII, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(IGNORED_IN_HOST, '').replace(IDEOGRAPHIC_STOP, '.');
const namesOtherHost = text => OTHER_BRAND_HOST.test(text) || OTHER_BRAND_HOST.test(asBrowserReads(text));

test('the guard also reads a host the way a browser does: fullwidth and ideographic stops and letters, a soft hyphen or zero width character, a percent-encoded dot', () => {
  const F = String.fromCharCode;
  const caught = ['kolwen' + F(0x3002) + 'ai', 'kolwen' + F(0xff0e) + 'ai', 'kolwen' + F(0xff61) + 'ai', F(0xff4b, 0xff4f, 0xff4c, 0xff57, 0xff45, 0xff4e) + '.ai', 'kolwen%2Eai', 'kolwen%2eai', 'kolwen.com.' + F(0xad) + 'au', 'kolwen.com.' + F(0x200b) + 'au',
    'kol' + F(0xad) + 'wen.ai', 'kolwen.' + F(0x2060) + 'ai', F(0xff4b, 0xff4f, 0xff4c, 0xff57, 0xff45, 0xff4e, 0x3002, 0xff43, 0xff4f, 0xff4d, 0x3002, 0xff41, 0xff55) + '', 'https://kolwen%2Ecom%2Eau/x',
    // Q-8b: the three stops that map to a dot, percent-encoded as the UTF-8 bytes of U+3002, U+FF0E and U+FF61
    'kolwen%E3%80%82ai', 'kolwen%e3%80%82ai', 'kolwen%EF%BC%8Eai', 'kolwen%EF%BD%A1ai', 'https://kolwen%E3%80%82com%E3%80%82au/x', 'kolwen%EF%BC%8Ecom%EF%BC%8Eau'];
  for (const host of caught) assert.ok(namesOtherHost(host), JSON.stringify(host));
  // the held hosts stay clean in every spelling, and so does a sentence end in a fullwidth form
  for (const ok of ['kolwen.com', 'kolwen%2Ecom', 'kolwen' + F(0xff0e) + 'com', 'kolwen' + F(0x3002) + 'com' + F(0x3002), F(0xff4b, 0xff4f, 0xff4c, 0xff57, 0xff45, 0xff4e) + '.com', 'kolwen.hetcreep.workers.dev' + F(0x3002), 'kolwen%E3%80%82com', 'kolwen%EF%BC%8Ecom', 'kolwen%EF%BD%A1com%EF%BD%A1']) assert.ok(!namesOtherHost(ok), JSON.stringify(ok));
  // the stated limits, kept true
  for (const host of ['kolwen%252Eai', 'kolwen%25E3%2580%2582ai', 'kolwen%E3%80ai', 'xn--kolwen-abc.ai', F(0xd835, 0xdc24, 0xd835, 0xdc28, 0xd835, 0xdc25, 0xd835, 0xdc30, 0xd835, 0xdc1e, 0xd835, 0xdc27) + '.ai', F(0x24a6) + 'olwen.ai', 'kolwen' + F(0xfe52) + 'ai']) assert.ok(!namesOtherHost(host), 'a stated limit: ' + JSON.stringify(host));
  for (const prose of ['Kolwen.Next', 'kolwen.svg']) assert.ok(namesOtherHost(prose), 'a stated loud false positive: ' + prose);
});

test('the guard against a host the owner does not hold names none, and catches any other top-level domain', () => {
  for (const host of ['kolwen.invalid', 'KOLWEN.INVALID', 'kolwen.example', 'a visit to kolwen.test/x', 'kolwen.some-other']) assert.ok(OTHER_BRAND_HOST.test(host), host);
  // an exemption ends at a HOST boundary: a name that only STARTS with an approved host is another host (a different registrable domain, or a suffixed alias)
  for (const host of ['kolwen.com.au', 'kolwen.com.th/x', 'see kolwen.com.au.', 'kolwen.com-shop.example', 'kolwen.comx', 'kolwen.hetcreep.workers.dev.evil', 'kolwen.hetcreep.workers.devx', 'kolwen.hetcreep.workers.dev-2.example']) assert.ok(OTHER_BRAND_HOST.test(host), host);
  for (const ok of ['kolwen.com', 'KOLWEN.COM/pricing', 'ic.kolwen.com', 'kolwen.hetcreep.workers.dev', 'the Kolwen word mark']) assert.ok(!OTHER_BRAND_HOST.test(ok), ok);
  // the host also ends at punctuation: a sentence that ends with the host, or a list of them, is not another host
  for (const ok of ['Visit kolwen.com.', 'kolwen.com, kolwen.com; kolwen.com) kolwen.com?', 'kolwen.com.\nNext line', 'kolwen.com:443/x', 'https://kolwen.com/', 'the alias kolwen.hetcreep.workers.dev.', 'kolwen.hetcreep.workers.dev/path']) assert.ok(!OTHER_BRAND_HOST.test(ok), ok);
});

test('the map holds only the live group, and no tracked file but this test names a host the owner has not bought', () => {
  assert.deepEqual(Object.keys(JSON.parse(REAL.seamsText).groups), ['company']);
  // a later group is added to the map by its own unit, on the owner's word for what it serves; until then no public file announces one
  // address-check names look-alike domains (kolwen.community, kolwen.com.au) only as the negatives its address pattern must refuse; no page, header or catalogue is among the exempt
  const NEGATIVES = new Set(['scripts/domain-seams.test.mjs', 'scripts/address-check.mjs', 'scripts/address-check.test.mjs']);
  const hits = REAL.files.filter(f => !NEGATIVES.has(f.file) && namesOtherHost(f.text)).map(f => f.file);
  assert.deepEqual(hits, []);
});

test('a map or a catalogue file that is not a JSON object is a finding, never a thrown error', () => {
  for (const text of ['null', '[]', '7', '"x"', 'true']) {
    const r = parseSeams(text);
    assert.equal(r.seams, null, text);
    assert.ok(r.problems.some(p => /is not a JSON object/.test(p.msg)), text + ': ' + JSON.stringify(r.problems));
    assert.ok(has(seamProblems(snap(x => { x.seamsText = text; })), /is not a JSON object/), 'through the one entry point: ' + text);
  }
  for (const text of ['null', '[]', '7', '"x"']) {
    const ps = catalogueDomainProblems({ 'web-src/i18n/en.json': text }, REAL.templates);
    assert.ok(ps.some(p => /is not a JSON object/.test(p.msg)), text + ': ' + JSON.stringify(ps));
  }
});

test('the seam map is the file the rule reads', () => {
  assert.equal(SEAMS_FILE, 'web-src/seams.json');
  assert.ok(tracked.includes(SEAMS_FILE), 'it is tracked');
});

// ── the rule runs in the gate every push runs ──────────────────────────────────────────────────────────────────
test('surface-check rule 20 runs the seams on a copy of the tree: clean passes, and a planted Set-Cookie header, an orphan page and a missing legal link each fail it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seams-'));
  const home = join(dir, '.sandbox-home');
  mkdirSync(home, { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, TEMP: home, TMP: home, TMPDIR: home, XDG_CONFIG_HOME: home };
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
  try {
    for (const f of tracked) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), readFileSync(f)); }
    for (const args of [['init', '-q'], ['add', '-A']]) assert.equal(run('git', args).status, 0, 'git ' + args[0]);
    const surface = () => run(process.execPath, ['--max-old-space-size=2048', 'scripts/surface-check.mjs']);
    const base = surface();
    assert.equal(base.status, 0, 'the committed tree passes: ' + base.stdout + base.stderr);
    const edit = (f, fn) => { writeFileSync(join(dir, f), fn(readFileSync(join(dir, f), 'utf8'))); run('git', ['add', '-A']); };
    const headers = readFileSync(join(dir, 'web/_headers'), 'utf8');
    edit('web/_headers', s => s.replace('/*\n  Content-Security-Policy:', '/*\n  Set-Cookie: a=b; Domain=.kolwen.com\n  Content-Security-Policy:'));
    const a = surface();
    assert.equal(a.status, 1, 'a Set-Cookie header fails: ' + a.stdout + a.stderr);
    assert.match(a.stdout + a.stderr, /web\/_headers: sets a cookie \(a Set-Cookie header\)/);
    assert.match(a.stdout + a.stderr, /web\/_headers: holds a cookie with a Domain attribute/);
    edit('web/_headers', () => headers);
    writeFileSync(join(dir, 'web/orphan.html'), readFileSync(join(dir, 'web/404.html'), 'utf8'));
    run('git', ['add', '-A']);
    const b = surface();
    assert.equal(b.status, 1, 'an orphan page fails: ' + b.stdout + b.stderr);
    assert.match(b.stdout + b.stderr, /web-src\/seams\.json: \/orphan belongs to no group/);
    rmSync(join(dir, 'web/orphan.html'));
    const page404 = readFileSync(join(dir, 'web/404.html'), 'utf8');
    edit('web/404.html', s => s.split('href="/privacy"').join('href="/privacy-x"'));
    const c = surface();
    assert.match(c.stdout + c.stderr, /web\/404\.html: group company: no link to the privacy page/);
    edit('web/404.html', () => page404);
    // a bad input is a FAIL line, never a stack trace: a map that is the literal null, and a throw inside the seams
    const seams = readFileSync(join(dir, SEAMS_FILE), 'utf8');
    edit(SEAMS_FILE, () => 'null');
    const d = surface();
    assert.equal(d.status, 1, 'a null map fails: ' + d.stdout + d.stderr);
    assert.match(d.stdout + d.stderr, /web-src\/seams\.json: is not a JSON object/);
    assert.doesNotMatch(d.stdout + d.stderr, /\n\s+at /, 'no stack trace');
    edit(SEAMS_FILE, () => seams);
    edit('scripts/lib/domain-seams.mjs', s => s.replace('export function seamProblems(snap) {', "export function seamProblems(snap) {\n  throw new Error('planted');"));
    const e = surface();
    assert.equal(e.status, 1, 'a throw fails: ' + e.stdout + e.stderr);
    assert.match(e.stdout + e.stderr, /scripts\/lib\/domain-seams\.mjs: rule 20 could not complete \(planted\)/);
    assert.doesNotMatch(e.stdout + e.stderr, /\n\s+at /, 'no stack trace');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
