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

// The three headers `_headers` puts on every response, read from its `/*` rule. Throws (with a message a
// reader can act on) when the file does not declare exactly one of each there, because a check with nothing
// to compare against must not read as a check that passed.
export function declaredSecurityHeaders(rules) {
  const block = rules.find(r => r.pattern === '/*');
  if (!block) throw new Error('web/_headers has no "/*" rule, so there is no declared CSP, Referrer-Policy or Permissions-Policy to compare the served response against');
  const one = name => {
    const d = declarations([block], name);
    if (d.length !== 1) throw new Error(`the "/*" rule in web/_headers declares ${name} ${d.length} times; the served-header check needs exactly one`);
    return d[0].value;
  };
  return { csp: one('Content-Security-Policy'), referrer: one('Referrer-Policy'), permissions: one('Permissions-Policy') };
}

// What is wrong with one HTML response's headers. `headers` is a fetch `Headers`. Empty array = fine.
export function servedHeaderMisses(hostname, headers, declared) {
  const out = [];
  for (const [name, want] of [['Content-Security-Policy', declared.csp], ['Referrer-Policy', declared.referrer], ['Permissions-Policy', declared.permissions]]) {
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
