// The set of code points a WOFF2 font file maps to a glyph, read from the file itself with node builtins only (the coverage check of web-build rule W-PERF-06).
// WOFF2 (W3C Recommendation 2024-08-08): a 48-byte header, a table directory (flag byte, optional tag, UIntBase128 lengths), then ONE brotli stream holding every
// table in directory order. The cmap table is never transformed (only glyf and loca are, by default), so its bytes in the stream are the plain cmap table.
import { brotliDecompressSync } from 'node:zlib';

// The 63 table tags a directory flag byte can name (WOFF2 §5.1 "Known Table Tags"), by index.
const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

function base128(buf, at) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (at.p >= buf.length) throw new Error('woff2: table directory ends inside a UIntBase128');
    const b = buf[at.p++];
    if (i === 0 && b === 0x80) throw new Error('woff2: UIntBase128 with a leading zero');
    if (value > 0x1ffffff) throw new Error('woff2: UIntBase128 overflows 32 bits');
    value = value * 128 + (b & 0x7f);
    if (!(b & 0x80)) return value;
  }
  throw new Error('woff2: UIntBase128 longer than 5 bytes');
}

// The bytes of one table of a WOFF2 file, as stored (a transformed table is returned transformed).
export function woff2Table(buf, wanted) {
  if (buf.length < 48 || buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('woff2: not a WOFF2 file');
  const numTables = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  const at = { p: 48 }, dir = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[at.p++];
    const idx = flags & 0x3f, version = flags >> 6;
    let tag;
    if (idx === 63) { tag = buf.toString('latin1', at.p, at.p + 4); at.p += 4; } else tag = KNOWN[idx];
    const orig = base128(buf, at);
    const transformed = tag === 'glyf' || tag === 'loca' ? version !== 3 : version !== 0;
    const stored = transformed ? base128(buf, at) : orig;
    dir.push({ tag, stored });
  }
  const data = brotliDecompressSync(buf.subarray(at.p, at.p + compressed));
  let off = 0;
  for (const t of dir) { if (t.tag === wanted) return data.subarray(off, off + t.stored); off += t.stored; }
  throw new Error('woff2: no ' + wanted + ' table');
}

// cmap subtables 4 and 12 on the Unicode platforms (0, any) and Windows Unicode (3, 1) and (3, 10): the ones a browser reads. A code point mapped to glyph 0 is unmapped.
export function woff2Cmap(buf) {
  const t = woff2Table(buf, 'cmap');
  const out = new Set();
  const n = t.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const platform = t.readUInt16BE(4 + i * 8), enc = t.readUInt16BE(6 + i * 8), off = t.readUInt32BE(8 + i * 8);
    if (!(platform === 0 || (platform === 3 && (enc === 1 || enc === 10)))) continue;
    const format = t.readUInt16BE(off);
    if (format === 4) {
      const segs = t.readUInt16BE(off + 6) / 2;
      const end = off + 14, start = end + segs * 2 + 2, delta = start + segs * 2, range = delta + segs * 2;
      for (let s = 0; s < segs; s++) {
        const e = t.readUInt16BE(end + s * 2), b = t.readUInt16BE(start + s * 2), d = t.readUInt16BE(delta + s * 2), r = t.readUInt16BE(range + s * 2);
        for (let c = b; c <= e && c !== 0xffff; c++) {
          let gid;
          if (r === 0) gid = (c + d) & 0xffff;
          else { const g = t.readUInt16BE(range + s * 2 + r + (c - b) * 2); gid = g === 0 ? 0 : (g + d) & 0xffff; }
          if (gid !== 0) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = t.readUInt32BE(off + 12);
      for (let g = 0; g < groups; g++) {
        const b = t.readUInt32BE(off + 16 + g * 12), e = t.readUInt32BE(off + 20 + g * 12), gid = t.readUInt32BE(off + 24 + g * 12);
        // each character maps to gid + (c - b), so a group that starts at glyph 0 leaves only its first character on .notdef
        for (let c = b; c <= e; c++) if (gid + (c - b) !== 0) out.add(c);
      }
    }
  }
  return out;
}

// The name table of a WOFF2 file as [{ id, platform, text }] (platform 3 is UTF-16BE, platform 1 is read as latin1, enough for the ASCII the records of this site hold).
export function woff2Names(buf) {
  const t = woff2Table(buf, 'name');
  const count = t.readUInt16BE(2), base = t.readUInt16BE(4), out = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12, platform = t.readUInt16BE(r), id = t.readUInt16BE(r + 6), len = t.readUInt16BE(r + 8), off = t.readUInt16BE(r + 10);
    const raw = t.subarray(base + off, base + off + len);
    if (platform === 3 || platform === 0) out.push({ id, platform, text: Buffer.from(raw).swap16().toString('utf16le') });
    else out.push({ id, platform, text: raw.toString('latin1') });
  }
  return out;
}
