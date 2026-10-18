// The domain seams (BB-197 item 7): each seam has a planted defect that must be found, and the real tree must be clean.
// Run from the repository root: node --test scripts/domain-seams.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
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
  // a script that is not code (structured data) or prose on the page is not a cookie
  assert.deepEqual(one('web/index.html', '<script type="application/ld+json">{"note": "set-cookie"}</script><p>The Set-Cookie header and cookieStore.set(x) are named here in prose.</p>'), []);
  assert.deepEqual(one('web/index.html', inline('var a = d.cookie; if (d.cookie == "x") {} var s = "Set-Cookie is not sent";')), []);
  // reading, comparing and prose are not setting
  assert.deepEqual(one('web/index.html', '<script>if (document.cookie === "") {}; var c = document.cookie;</script><p>This site sets no cookie and no Domain is shared.</p>'), []);
  assert.deepEqual(one('web/_headers', '# no Set-Cookie header is sent here, no Domain\n# a cookie sent with ; Domain=.x would reach every subdomain, so none is\n/*\n  Referrer-Policy: no-referrer\n'), []);
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

test('the map holds only the live group, and no tracked file but this test names a host the owner has not bought', () => {
  assert.deepEqual(Object.keys(JSON.parse(REAL.seamsText).groups), ['company']);
  // a later group is added to the map by its own unit, on the owner's word for what it serves; until then no public file announces one
  const hits = REAL.files.filter(f => f.file !== 'scripts/domain-seams.test.mjs' && /kolwen\.(?:ai|dev|app)\b/i.test(f.text)).map(f => f.file);
  assert.deepEqual(hits, []);
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
    edit('web/404.html', s => s.split('href="/privacy"').join('href="/privacy-x"'));
    const c = surface();
    assert.match(c.stdout + c.stderr, /web\/404\.html: group company: no link to the privacy page/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
