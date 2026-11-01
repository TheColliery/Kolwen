// The one reader of a file a CI check reads by a path it was given (K-19): page-weight reads a page's assets, sitemap-lastmod reads the
// pages its record names. A path is resolved to its real location first. A real location outside the root is refused; a file that is
// not a regular file, or is over the read cap, is refused before it is read. Callers key a visited set on `file`, the real path, so one
// file reached under two URLs (a directory alias) is read once.
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const MAX_READ_BYTES = 8 << 20;

// Where a repository path leads, without reading it: { file } (the real path), { missing: true } or { refused: why }.
export function locate(root, rel, max = MAX_READ_BYTES) {
  let realRoot;
  try { realRoot = realpathSync.native(root); } catch (e) { return { refused: `the root cannot be resolved (${e.code || e.message})` }; }
  let real;
  try { real = realpathSync.native(resolve(realRoot, String(rel).replace(/^\/+/, ''))); }
  catch (e) { return e.code === 'ENOENT' ? { missing: true } : { refused: `cannot be resolved (${e.code || e.message})` }; }
  const within = relative(realRoot, real);
  if (within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) return { refused: 'leads outside the root' };
  const st = lstatSync(real);
  if (!st.isFile()) return { refused: 'is not a regular file' };
  if (st.size > max) return { refused: `is ${st.size} bytes, over the ${max} byte read cap` };
  return { file: real };
}

// The bytes at a path, read once it is located: { file, bytes } | { missing: true } | { refused: why }.
// The real reads readContained makes: a test counts them to hold a file to one read.
export const reads = { n: 0 };
export function readContained(root, rel, max = MAX_READ_BYTES) {
  const at = locate(root, rel, max);
  if (at.file === undefined) return at;
  reads.n++;
  return { file: at.file, bytes: readFileSync(at.file) };
}
