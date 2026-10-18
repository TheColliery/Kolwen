// A static server for the publish root (web/), on 127.0.0.1 and an ephemeral port, that answers the way the Worker's static assets do closely enough to render the pages: `/` is index.html, `/pricing`
// is pricing.html, `/404` is 404.html (served with 200: this server is for rendering, the 404 STATUS is post-deploy-check's), a file is itself, anything else is a 404. With `headers` on, the rule
// `/*` of web/_headers is applied to every response, so a page is rendered under its real Content-Security-Policy and a hash that does not match is a violation the browser reports. Node
// builtins only. The server serves files under the root and nothing else: a path is resolved and must stay inside it.
//
// THE ANSWER IS A FUNCTION OF THE URL (makeResponder), and the HTTP server is one way to deliver it. The other is the browser's own DevTools channel: a browser that cannot reach a Windows loopback
// server (a headless shell inside WSL, whose NAT cannot see the host's 127.0.0.1) is given the same answer through Fetch.fulfillRequest (scripts/lib/browser.mjs), so one piece of code decides what
// every page is served as, whichever way it travels.
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { parseHeadersFile } from './headers-file.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.ico': 'image/x-icon' };

// The answer for one request target (the path and query a browser asks for): { status, headers (an object, lower-case names), body (a Buffer) }.
export function makeResponder(webDir, { headers = true } = {}) {
  const root = resolve(webDir);
  const rules = headers && existsSync(join(root, '_headers')) ? parseHeadersFile(readFileSync(join(root, '_headers'), 'utf8')).filter(r => r.pattern === '/*') : [];
  const extra = Object.fromEntries(rules.flatMap(r => r.headers.map(h => [h.name, h.value])));
  return target => {
    let file = null;
    try {
      const path = decodeURIComponent(new URL(target, 'http://x').pathname);
      const candidates = path === '/' ? ['index.html'] : path.endsWith('/') ? [path.slice(1) + 'index.html'] : [path.slice(1), path.slice(1) + '.html'];
      for (const c of candidates) {
        const p = resolve(root, c);
        if (!p.startsWith(root + sep) || c.startsWith('_')) continue; // inside the root, and `_headers` / `_redirects` are never served
        if (existsSync(p) && statSync(p).isFile()) { file = p; break; }
      }
    } catch { /* a malformed URL is a 404 */ }
    if (!file) return { status: 404, headers: { 'content-type': 'text/plain' }, body: Buffer.from('not found') };
    return { status: 200, headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store', ...extra }, body: readFileSync(file) };
  };
}

export async function serveWeb(webDir, { headers = true } = {}) {
  const respond = makeResponder(webDir, { headers });
  const server = createServer((req, res) => {
    const out = respond(req.url);
    res.writeHead(out.status, out.headers);
    res.end(out.body);
  });
  await new Promise((ok, no) => { server.once('error', no); server.listen(0, '127.0.0.1', ok); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise(r => server.close(() => r())) };
}
