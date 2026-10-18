// The ONE reader of a Cloudflare Workers static-assets `_headers` file. surface-check (what the file
// declares) and post-deploy-check (what is served against it) both use it, so the two gates cannot
// disagree about the file.
//
// Format, per Cloudflare's headers page: a line that starts in column 0 and is not a comment opens a
// rule (a path, or an absolute URL); the indented `Name: value` lines under it are that rule's headers;
// `#` starts a comment. Not modelled: the `! Name` detach form. This file uses it nowhere, and a line
// in that shape is read as an ordinary header named `!`, which no gate here asks for.
export function parseHeadersFile(text) {
  const rules = [];
  let cur = null;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (/^\s*(#.*)?$/.test(raw)) return;
    if (!/^\s/.test(raw)) { cur = { pattern: raw.trim(), line: i + 1, headers: [] }; rules.push(cur); return; }
    const m = raw.trim().match(/^([^:\s]+):\s*(.*)$/);
    if (m && cur) cur.headers.push({ name: m[1], value: m[2].trim(), line: i + 1 });
  });
  return rules;
}

// Does the served robots.txt carry the committed one? Both arguments are already newline-normalised
// (post-deploy-check's normHtml). kolwen.com's zone syncs an AI-crawl preference into robots.txt: the edge
// PREPENDS its managed block, fenced by `# BEGIN Cloudflare Managed content` and `# END Cloudflare Managed
// Content` comment lines, with a comment-only content-signals preamble above the fence (read 2026-10-02), and
// serves our file after it, unchanged. So the served body is accepted when it IS the committed file, or when
// the committed file is its FINAL block and everything before is comment lines, one fenced block, and nothing
// else. The managed block's own contents are NOT compared (Cloudflare owns them); any non-comment line ahead
// of the fence, a changed line of ours, or our lines missing is a miss. Limit: if Cloudflare renames the fence
// comments this fails closed (red, naming the file), never open.
const EDGE_ROBOTS_PREFIX = /^(?:#[^\n]*\n)*# BEGIN Cloudflare Managed content[^\n]*\n[\s\S]*\n# END Cloudflare Managed Content[ \t]*\n$/i;
export function robotsVerdict(live, want) {
  if (live === want) return { ok: true, edge: false };
  if (want.length > 0 && live.endsWith(want) && EDGE_ROBOTS_PREFIX.test(live.slice(0, live.length - want.length))) return { ok: true, edge: true };
  return { ok: false, edge: false };
}

// Every declaration of one header, in file order: [{ pattern, value, line }]. Names compare
// case-insensitively, as HTTP header names do.
export function declarations(rules, name) {
  const want = name.toLowerCase();
  return rules.flatMap(r => r.headers.filter(h => h.name.toLowerCase() === want).map(h => ({ pattern: r.pattern, value: h.value, line: h.line })));
}

// A CSP string as a Map of directive name -> token list. A directive named twice keeps the FIRST, as a
// browser does, and the repeats are returned in `repeats` so a caller can refuse them.
export function parsePolicy(value) {
  const dirs = new Map(), repeats = [];
  for (const part of value.split(';').map(p => p.trim()).filter(Boolean)) {
    const [name, ...tokens] = part.split(/\s+/);
    const key = name.toLowerCase();
    if (dirs.has(key)) repeats.push(key); else dirs.set(key, tokens);
  }
  return { dirs, repeats };
}

// ── what a SERVED response must carry (used by post-deploy-check, pure so it can be tested) ─────────

// Hosts that pass through the Cloudflare zone. The zone, not `_headers`, sets HSTS and nosniff there, and
// production must never say noindex. workers.dev and preview hosts skip the zone and are not listed.
export const PRODUCTION_HOSTS = new Set(['kolwen.com', 'www.kolwen.com']);

// The five headers `_headers` puts on every response (CSP, Referrer-Policy, Permissions-Policy, COOP, CORP), read from its `/*` rule. Throws (with a message a
// reader can act on) when the file does not declare exactly one of each there, because a check with nothing
// to compare against must not read as a check that passed.
export function declaredSecurityHeaders(rules) {
  const block = rules.find(r => r.pattern === '/*');
  if (!block) throw new Error('web/_headers has no "/*" rule, so there is no declared CSP, Referrer-Policy, Permissions-Policy, Cross-Origin-Opener-Policy or Cross-Origin-Resource-Policy to compare the served response against');
  const one = name => {
    const d = declarations([block], name);
    if (d.length !== 1) throw new Error(`the "/*" rule in web/_headers declares ${name} ${d.length} times; the served-header check needs exactly one`);
    return d[0].value;
  };
  return { csp: one('Content-Security-Policy'), referrer: one('Referrer-Policy'), permissions: one('Permissions-Policy'), coop: one('Cross-Origin-Opener-Policy'), corp: one('Cross-Origin-Resource-Policy') };
}

// What is wrong with one HTML response's headers. `headers` is a fetch `Headers`. Empty array = fine.
export function servedHeaderMisses(hostname, headers, declared) {
  const out = [];
  for (const [name, want] of [['Content-Security-Policy', declared.csp], ['Referrer-Policy', declared.referrer], ['Permissions-Policy', declared.permissions], ['Cross-Origin-Opener-Policy', declared.coop], ['Cross-Origin-Resource-Policy', declared.corp]]) {
    const got = headers.get(name);
    if (got === null) out.push(`${name} is missing (web/_headers declares one on every response)`);
    else if (got !== want) out.push(`${name} is "${got}", web/_headers declares "${want}"`);
  }
  if (PRODUCTION_HOSTS.has(hostname.toLowerCase())) {
    const hsts = headers.get('Strict-Transport-Security');
    if (hsts === null || !/max-age=\d+/i.test(hsts)) out.push('Strict-Transport-Security is missing or has no max-age (the Cloudflare zone sets it, not this repo)');
    const nosniff = headers.get('X-Content-Type-Options');
    if (nosniff === null) out.push('X-Content-Type-Options is missing (the Cloudflare zone sets it, not this repo)');
    else if (nosniff.trim().toLowerCase() !== 'nosniff') out.push(`X-Content-Type-Options is "${nosniff}", expected exactly nosniff (a repeated value means two layers set it)`);
  }
  return out;
}

// The rail, for EVERY response from a production host, not only HTML: production never says noindex.
export function robotsRailMisses(hostname, headers) {
  const v = headers.get('X-Robots-Tag');
  return PRODUCTION_HOSTS.has(hostname.toLowerCase()) && v !== null ? [`X-Robots-Tag is "${v}" on a production host; noindex belongs to preview hosts only`] : [];
}

// What to make of the response to a request for a path that does not exist. `bodyIsOurPage` says whether
// its body is the committed web/404.html, which is what `assets.not_found_handling: 404-page` promises
// Cloudflare will serve (its SSG/404 page: "Workers will serve the contents of the nearest `404.html`
// file with a `404 Not Found` status"), and only that response is an asset response `_headers` is applied to.
//
// Measured 2026-09-25, LWK-211. On the production hosts a `/*.svg` path rule reached the 404 for a missing
// `/x.svg` (Cache-Control: max-age=86400 on kolwen.com and on the workers.dev alias), so a path rule DOES
// reach the fallback there. On a Workers Preview the same request got a 9-byte "Not found", none of the
// asset service's default headers, no `_headers` rule (neither the path rule nor the host rule) and a
// capitalised X-Robots-Tag that Cloudflare's Previews page documents as its own: the preview never ran
// the 404-page handling, so nothing in `_headers` can decorate that response. Production is therefore held
// to the page AND the headers; any other host is told, not failed, because the repo cannot change what a
// platform preview does.
export function notFoundVerdict(hostname, bodyIsOurPage, headers, declared) {
  if (bodyIsOurPage) return { misses: servedHeaderMisses(hostname, headers, declared), notes: [] };
  if (PRODUCTION_HOSTS.has(hostname.toLowerCase())) {
    return { misses: ['the 404 body is not the committed web/404.html (assets.not_found_handling is 404-page, so an unmatched path must serve that page)'], notes: [] };
  }
  return {
    misses: [],
    notes: [`${hostname} answers an unmatched path with a platform 404, not web/404.html, so the header check on the 404 page was skipped on this host (measured on a Workers Preview, 2026-09-25: a 9-byte body, no asset default headers, no _headers rule applied). Production is held to both.`],
  };
}

// ── the long cache of the versioned font files (web-build rule W-PERF-02) ──────────────────────────────────────────────────────
// The WOFF2 files under /fonts/ carry a hash of their bytes in their names (lib/font-coverage.mjs), so they are served `public, max-age=31536000, immutable`. fonts.css, the one
// unhashed file that names them, and each OFL.txt keep the platform default (revalidated), because their urls never change.
export const FONT_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const ONE_YEAR = 31536000;

// Does a `_headers` path pattern match a request path? A `*` splat matches any run of characters (slashes too), a `:name` placeholder one path segment, everything else literally.
export function patternMatches(pattern, path) {
  const re = pattern.split(/(\*|:[A-Za-z]\w*)/).map(part => (part === '*' ? '.*' : /^:[A-Za-z]/.test(part) ? '[^/]+' : part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('');
  return new RegExp('^' + re + '$').test(path);
}

// The directives of a Cache-Control value: [{ name (lower case), arg (unquoted; null when there is none), bad }]. The value splits on commas outside quotes. The grammar of RFC 9111 section 5.2 is
// `cache-directive = token [ "=" ( token / quoted-string ) ]`: no space around the `=`, and an argument that is there has at least one character (a token is one or more). A piece that is not that
// is { name: the piece, bad: true }, so it can never pass for a directive.
function cacheDirectives(value) {
  return (value.match(/(?:"[^"]*"|[^,"])+/g) || []).map(piece => {
    const m = /^\s*([^\s=,"]+)(?:=(?:"([^"]*)"|([^\s,"]+)))?\s*$/.exec(piece);
    return m ? { name: m[1].toLowerCase(), arg: m[2] ?? m[3] ?? null } : { name: piece.trim().toLowerCase(), arg: null, bad: true, piece: piece.trim() };
  });
}

// null when a served Cache-Control value is a long immutable one (public, exactly one max-age whose whole value is a year or more, immutable), else the reason it is not.
export function fontCacheMiss(value) {
  if (value == null) return 'is served with no Cache-Control, expected ' + FONT_CACHE_CONTROL;
  const served = `is served Cache-Control "${value}"`, directives = cacheDirectives(value);
  // a directive that overrides the year: no-store keeps the file out of the cache, a bare no-cache makes every use ask the origin again, a bare private forbids a shared cache the public the check requires
  // (no-cache="field" and private="field" only name fields, and are not read as bare)
  const override = directives.find(d => !d.bad && (d.name === 'no-store' || ((d.name === 'no-cache' || d.name === 'private') && d.arg === null)));
  if (override) return `${served} with ${override.name}, which stops the year-long reuse, expected ${FONT_CACHE_CONTROL}`;
  // a piece that is no directive at all (`max-age = 1`, `no-cache=`) is named: a cache may drop it, so the header cannot be said to hold what the check wants
  const bad = directives.find(d => d.bad);
  if (bad) return `${served} with a malformed directive "${bad.piece}", expected ${FONT_CACHE_CONTROL}`;
  // exactly one max-age (a second may undo the first, and a cache is free to take either), and its whole value is digits (a numeric prefix such as 31536000junk is a malformed directive a cache drops)
  const ages = directives.filter(d => d.name === 'max-age');
  if (ages.length > 1) return `${served} with ${ages.length} max-age directives, expected exactly one (${FONT_CACHE_CONTROL})`;
  if (ages.length === 1 && !/^\d+$/.test(ages[0].arg ?? '')) return `${served} with a malformed max-age ("${ages[0].arg ?? ''}"), expected ${FONT_CACHE_CONTROL}`;
  if (!ages.length || Number(ages[0].arg) < ONE_YEAR) return `${served}, expected max-age of at least ${ONE_YEAR} (${FONT_CACHE_CONTROL})`;
  if (!directives.some(d => d.name === 'immutable')) return `${served} without immutable, expected ${FONT_CACHE_CONTROL}`;
  if (!directives.some(d => d.name === 'public')) return `${served} without public, expected ${FONT_CACHE_CONTROL}`;
  return null;
}

// The first font url the manifest names, read from the manifest text (the live one, never a name written in this repo's checks).
export const firstFontUrl = css => (/url\(\s*['"]?(\/fonts\/[^'")\s]+\.woff2)['"]?\s*\)/.exec(css) || [])[1] || null;

// The misses of one origin: fetch its fonts.css, take the first font url it names, fetch that, and require the long immutable cache on it. `get(url)` returns a fetch Response.
// `origin` ends with a slash, as in post-deploy-check.
export async function fontCacheMisses(origin, get) {
  const sheet = await get(origin + 'fonts/fonts.css');
  if (!sheet.ok) return [`fonts/fonts.css: served HTTP ${sheet.status}, so no font url can be read from it`];
  const url = firstFontUrl(await sheet.text());
  if (!url) return ['fonts/fonts.css: names no font url, so no font cache header can be checked'];
  const font = await get(origin + url.replace(/^\//, ''));
  if (font.status !== 200) return [`${url}: served HTTP ${font.status}, expected 200`];
  const miss = fontCacheMiss(font.headers.get('cache-control'));
  return miss ? [`${url}: ${miss}`] : [];
}
