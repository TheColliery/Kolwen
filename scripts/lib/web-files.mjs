// The files Cloudflare serves from the publish root (web/), as paths relative to it, with "/" separators, sorted with the default code-unit comparator.
// Recursive: web/fonts/ holds the self-hosted fonts, and a deployed file the prober never looks at would go unchecked. `_headers` and `_redirects` at the ROOT
// are parsed by Workers and, in Cloudflare's own words, "will not itself be served as a static asset", so fetching them returns the 404 page; nothing else is exempt.
// scripts/post-deploy-check.mjs is the caller.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

export const NOT_SERVED = new Set(['_headers', '_redirects']);

export function servedFiles(webDir) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix + e.name;
      if (e.isDirectory()) walk(join(dir, e.name), path + '/');
      else if (e.isFile() && !(prefix === '' && NOT_SERVED.has(e.name))) out.push(path);
    }
  };
  walk(webDir, '');
  return out.sort();
}
