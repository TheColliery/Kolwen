// The ONE routine that names an inline <style> or <script> body to a Content-Security-Policy: sha256 of the body's UTF-8 bytes, base64,
// quoted as a source-list token. scripts/surface-check.mjs (rule 13, which recomputes every hash from the served HTML) and
// scripts/lib/page-sync.mjs (which keeps the style-src hashes of web/_headers in step with the pages) both use it, so the two cannot disagree
// about what a hash is, and nobody types a hash by hand.
//
// The bodies are read by the shared walk in scripts/lib/page-claims.mjs, the reader rule 13 reads its elements with: a tag ends at the first `>` outside a
// quoted value, a <style> or <script> inside a comment, a script or a style body, or a title or textarea is no element, and a body is read to its own end tag.
//
// The body is hashed as given: the callers normalise CRLF to LF first (the pages are served from git, which stores LF), and inlineStyles does
// it for its own input too.
import { createHash } from 'node:crypto';
import { elementsOf } from './page-claims.mjs';

export const cspHash = text => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";

// The bodies of the inline <style> elements of a page, in document order (the one in a <noscript> included, as rule 13 counts it).
export const inlineStyles = html => elementsOf(html.replace(/\r\n/g, '\n'), /<(style)\b/gi).elements.map(e => e.body);

// The bodies of the inline EXECUTABLE <script> elements of a page, in document order: no src, and a type of nothing, a JavaScript type or module. A JSON data
// block (ld+json) is not code, so the policy needs no hash for it; surface-check rule 13 classifies the same way, and recomputes every hash itself.
const EXEC_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module']);
export const inlineScripts = html => elementsOf(html.replace(/\r\n/g, '\n'), /<(script)\b/gi).elements
  .filter(e => {
    const attrs = e.tag.text.slice('<script'.length, -1);
    return !/\bsrc\s*=/i.test(attrs) && EXEC_TYPES.has(((attrs.match(/\btype\s*=\s*["']?([^"'\s>]+)/i) || [])[1] || '').toLowerCase());
  })
  .map(e => e.body);
