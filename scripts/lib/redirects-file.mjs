// Parser for the Workers static-assets `_redirects` file (a library for scripts/surface-check.mjs and
// scripts/post-deploy-check.mjs; run on its own it does nothing).
//
// Syntax, from Cloudflare's "Workers > Static assets > Redirects" page (developers.cloudflare.com, read 2026-10-08):
// one redirect per line, `[source] [destination] [status?]`, status default 302, lines starting with `#` are comments,
// 2,000 static and 100 dynamic redirects at most, 1,000 characters per declaration; the file is parsed by Workers and
// is never served as an asset; redirects are followed whether or not an asset matches the request.
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function parseRedirectsFile(text) {
  const rules = [];
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const f = line.split(/\s+/);
    rules.push({ line: i + 1, length: raw.length, fields: f.length, source: f[0], dest: f[1], status: f.length > 2 ? Number(f[2]) : 302 });
  });
  return rules;
}

// A rule is dynamic when its source holds a splat or a placeholder (the page's own words); this repo uses none.
export const isDynamic = r => /[*:]/.test(r.source);

// What an edge answer must look like for one static rule: null when it does, else the reason.
export function redirectMiss(rule, status, location, origin) {
  if (status !== rule.status) return `${rule.source}: answered HTTP ${status}, expected ${rule.status} (web/_redirects line ${rule.line})`;
  // The whole destination counts: origin (a 301 to the right path on another host, scheme or port is a miss), path, query and
  // fragment (Cloudflare permits both in a destination, and `/pricing` is not `/pricing?plan=standard`).
  const whole = u => u.origin + u.pathname + u.search + u.hash;
  let got = null;
  if (location) { try { got = whole(new URL(location, origin)); } catch { /* an unparsable Location is a miss below */ } }
  const want = whole(new URL(rule.dest, origin));
  if (got !== want) return `${rule.source}: Location is ${JSON.stringify(location)}, expected ${want}`;
  return null;
}
