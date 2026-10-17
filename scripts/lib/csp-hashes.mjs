// The ONE routine that names an inline <style> or <script> body to a Content-Security-Policy: sha256 of the body's UTF-8 bytes, base64,
// quoted as a source-list token. scripts/surface-check.mjs (rule 13, which recomputes every hash from the served HTML) and
// scripts/lib/page-sync.mjs (which keeps the style-src hashes of web/_headers in step with the pages) both use it, so the two cannot disagree
// about what a hash is, and nobody types a hash by hand.
//
// The body is hashed as given: the callers normalise CRLF to LF first (the pages are served from git, which stores LF), and inlineStyles does
// it for its own input too.
import { createHash } from 'node:crypto';

export const cspHash = text => "'sha256-" + createHash('sha256').update(text, 'utf8').digest('base64') + "'";

// One pattern for an inline style block. The end tag tolerates whitespace and attributes before ">", as the HTML parser does
// (CodeQL js/bad-tag-filter), so a pattern that stops at a bare "</style>" cannot hash the wrong text.
export const STYLE_BLOCK_SOURCE = '<style\\b[^>]*>([\\s\\S]*?)<\\/style\\b[^>]*>';

// The bodies of the inline <style> blocks of a page, in document order (the one in a <noscript> included, as rule 13 counts it).
export const inlineStyles = html => [...html.replace(/\r\n/g, '\n').matchAll(new RegExp(STYLE_BLOCK_SOURCE, 'gi'))].map(m => m[1]);
