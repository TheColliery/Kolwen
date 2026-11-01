// The one reader of a file a CI check reads by a path it was given (K-19): page-weight reads a page's assets, sitemap-lastmod reads the
// pages its record names. A path is resolved to its real location first. A real location outside the root is refused; a file that is
// not a regular file, or is over the read cap, is refused before it is read. Callers key a visited set on `file`, the real path, so one
// file reached under two URLs (a directory alias) is read once.
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
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
  const st = lstatSync(real, { bigint: true });
  if (!st.isFile()) return { refused: 'is not a regular file' };
  if (st.size > BigInt(max)) return { refused: `is ${st.size} bytes, over the ${max} byte read cap` };
  return { file: real, dev: st.dev, ino: st.ino }; // the identity the check saw: readContained holds the opened descriptor to it
}

// The bytes at a path, read once it is located: { file, bytes } | { missing: true } | { refused: why }.
// The real reads readContained makes: a test counts them to hold a file to one read.
export const reads = { n: 0 };
// The bytes at a path: one descriptor, opened once and checked on that descriptor (fstat), then read at most max + 1 bytes, so a file that
// grows after the check is refused rather than read in full. The descriptor is closed in every case.
// `seam.afterLocate(file)`, when given, runs between the check and the open. Production passes none; the witness uses it to swap the file.
export function readContained(root, rel, max = MAX_READ_BYTES, seam = {}) {
  const at = locate(root, rel, max);
  if (at.file === undefined) return at;
  if (seam.afterLocate) seam.afterLocate(at.file);
  reads.n++;
  let fd;
  try { fd = openSync(at.file, 'r'); }
  catch (e) { return e.code === 'ENOENT' ? { missing: true } : { refused: `cannot be read (${e.code || e.message})` }; }
  try {
    const st = fstatSync(fd, { bigint: true });
    // the descriptor must be the file the check saw: a last component swapped for another file between the check and the open is refused
    if (st.dev !== at.dev || st.ino !== at.ino) return { refused: 'changed between the check and the read' };
    if (!st.isFile()) return { refused: 'is not a regular file' };
    if (st.size > BigInt(max)) return { refused: `is ${st.size} bytes, over the ${max} byte read cap` };
    const chunks = [], chunk = Buffer.alloc(64 * 1024);
    let total = 0;
    for (;;) {
      const n = readSync(fd, chunk, 0, Math.min(chunk.length, max + 1 - total), null);
      if (n === 0) break;
      total += n;
      if (total > max) return { refused: `grew past the ${max} byte read cap while it was read` };
      chunks.push(Buffer.from(chunk.subarray(0, n)));
    }
    return { file: at.file, bytes: Buffer.concat(chunks) };
  } finally { closeSync(fd); }
}
