// Tests for the WOFF2 reader (scripts/lib/woff2-cmap.mjs) on crafted fonts (K-15): a reader that trusts a font's own sizes inflates what it is not asked to, maps code points
// past Unicode, and holds more name bytes than a name table should. Each witness runs the reader in a child process with a heap cap and a kill timeout: a reader that runs away
// is killed and the test fails, instead of hanging the runner. The refusal is one line and exit 3. Run: node --test scripts/woff2-bounds.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const READER = pathToFileURL(join(ROOT, 'scripts', 'lib', 'woff2-cmap.mjs')).href;
const TAG_INDEX = { cmap: 0, name: 5 }; // WOFF2 section 5.1: the known-table index of each tag used here
const HEAP_MB = 256, KILL_MS = 30000;
const sandboxEnv = dir => ({ HOME: dir, USERPROFILE: dir, TEMP: dir, TMP: dir, TMPDIR: dir });

// A UIntBase128 (WOFF2 section 6.1): big-endian groups of seven bits, the high bit set on every byte but the last.
function uint128(n) {
  const bytes = [];
  do { bytes.unshift(n % 128); n = Math.floor(n / 128); } while (n > 0);
  for (let i = 0; i < bytes.length - 1; i++) bytes[i] |= 0x80;
  return Buffer.from(bytes);
}

// A WOFF2 file: the 48-byte header, one untransformed directory entry per table (its tag and the declared length), then ONE brotli stream of the payload.
function woff2({ tables, lengths = tables.map(t => t.data.length), payload = Buffer.concat(tables.map(t => t.data)), quality = 11 }) {
  const dir = Buffer.concat(tables.map((t, i) => Buffer.concat([Buffer.from([TAG_INDEX[t.tag]]), uint128(lengths[i])])));
  const stream = brotliCompressSync(payload, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: quality } });
  const head = Buffer.alloc(48);
  head.write('wOF2', 0, 'latin1');
  head.writeUInt16BE(tables.length, 12);
  head.writeUInt32BE(stream.length, 20);
  return Buffer.concat([head, dir, stream]);
}

// A cmap table with one subtable: platform 3, encoding 10 (Windows, full Unicode), format 12, from the groups [start, end, glyph].
function cmapWithGroups(groups) {
  const sub = Buffer.alloc(16 + groups.length * 12);
  sub.writeUInt16BE(12, 0);
  sub.writeUInt32BE(sub.length, 4);
  sub.writeUInt32BE(groups.length, 12);
  groups.forEach(([b, e, g], i) => { sub.writeUInt32BE(b, 16 + i * 12); sub.writeUInt32BE(e, 20 + i * 12); sub.writeUInt32BE(g, 24 + i * 12); });
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 2); // one encoding record
  head.writeUInt16BE(3, 4);
  head.writeUInt16BE(10, 6);
  head.writeUInt32BE(12, 8);
  return Buffer.concat([head, sub]);
}

// A name table with `count` records that all point at the same 65534 bytes of storage (an even length, UTF-16): the records hold count * 65534 bytes in all.
function nameWithRecords(count, len = 65534) {
  const base = 6 + count * 12;
  const head = Buffer.alloc(base);
  head.writeUInt16BE(count, 2);
  head.writeUInt16BE(base, 4);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    head.writeUInt16BE(3, r); head.writeUInt16BE(1, r + 2); head.writeUInt16BE(0x409, r + 4); head.writeUInt16BE(1, r + 6);
    head.writeUInt16BE(len, r + 8); head.writeUInt16BE(0, r + 10);
  }
  return Buffer.concat([head, Buffer.alloc(len)]);
}

// The reader, called on a font, in a child with a heap cap and a kill timeout. The child prints one line: OK and a size, or ERR and the message (exit 3).
function runReader(call, font) {
  const dir = mkdtempSync(join(tmpdir(), 'woff2-bounds-'));
  try {
    const file = join(dir, 'font.woff2'), script = join(dir, 'check.mjs');
    writeFileSync(file, font);
    writeFileSync(script, `import { readFileSync } from 'node:fs';
const m = await import(${JSON.stringify(READER)});
const b = readFileSync(process.env.KW_FONT);
try { const r = ${call}; console.log('OK ' + (r instanceof Set ? r.size : r.length)); }
catch (e) { console.log('ERR ' + String(e.message)); process.exitCode = 3; }
`);
    return spawnSync(process.execPath, [`--max-old-space-size=${HEAP_MB}`, script], { env: { ...process.env, KW_FONT: file, ...sandboxEnv(dir) }, encoding: 'utf8', timeout: KILL_MS, killSignal: 'SIGKILL' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// The reader refuses the font with one line that matches `pattern`, and was not killed on the way.
function refuses(call, font, pattern, why) {
  const r = runReader(call, font);
  assert.equal(r.signal, null, why + ': the reader was killed, so it ran away (' + r.signal + ')');
  assert.equal(r.status, 3, why + ': the reader did not refuse the font: ' + JSON.stringify(r.stdout));
  assert.match(r.stdout, pattern);
  assert.equal(r.stdout, r.stdout.split(String.fromCharCode(10))[0] + String.fromCharCode(10), why + ': one line, nothing after it: ' + JSON.stringify(r.stdout));
}

test('K-15 (1) a table that runs past the bytes its brotli stream inflates to is refused, not read short', () => {
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups([[0x41, 0x41, 1]]) }], lengths: [5000] });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: table "cmap" runs past/, 'a declared 5000-byte cmap over a shorter stream');
});

test('K-15 (2) a brotli stream that inflates past the sizes its directory declares is refused before it is allocated', () => {
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups([[0x41, 0x41, 1]]) }], lengths: [16], payload: Buffer.alloc(8 * 1024 * 1024) });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: the brotli stream does not decode to the sizes/, 'an 8 MiB stream under a 16-byte directory');
});

test('K-15 (3) a format 12 group that ends past U+10FFFF is refused', () => {
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups([[0, 0xffffffff, 1]]) }] });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: a format 12 cmap group runs from 0 to 4294967295/, 'a group ending at 2^32 - 1');
});

test('K-15 (4) a format 12 group that starts after it ends is refused', () => {
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups([[0x100, 0x10, 1]]) }] });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: a format 12 cmap group runs from 256 to 16/, 'a group from 256 back to 16');
});

test('K-15 (5) the code points a cmap visits are bounded in total across its subtables', () => {
  // nine groups of the whole range: 9 * 1114112 visits, past the bound of eight Unicode ranges
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups(Array.from({ length: 9 }, () => [0, 0x10ffff, 1])) }] });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: the cmap visits more code points/, 'nine whole-range groups');
});

test('K-15 (6) a name table whose records hold more bytes than the bound is refused', () => {
  const font = woff2({ tables: [{ tag: 'name', data: nameWithRecords(17) }] });
  refuses('m.woff2Names(b)', font, /^ERR woff2: the name records hold more than/, 'seventeen records of 65534 bytes');
});

test('F-1 a font that declares a table past the fixed ceiling is refused before anything is inflated', () => {
  // a small font whose stream inflates to 256 MiB, declared as a 256 MiB cmap: the font's own declared size would allow it, so the fixed ceiling must refuse the declaration
  const size = 256 * 1024 * 1024;
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups([[0x41, 0x41, 1]]) }], lengths: [size], payload: Buffer.alloc(size), quality: 1 });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: the table directory declares 268435456 bytes, more than 67108864/, 'a 256 MiB cmap declared by a small font');
});

test('(c) an odd-length UTF-16 name record is refused with one line, not a generic RangeError', () => {
  const font = woff2({ tables: [{ tag: 'name', data: nameWithRecords(1, 3) }] });
  refuses('m.woff2Names(b)', font, /^ERR woff2: a UTF-16 name record has an odd length \(3\)/, 'a 3-byte UTF-16 record');
});

test('CR-1 many encoding records pointing at a format 4 subtable of reversed segments are refused with one line', () => {
  // one reversed segment (start 0x20 after end 0x10) under 2000 encoding records that all point at it: the reader added no visits for a reversed segment, so nothing bounded the records
  const records = 2000, sub = Buffer.alloc(24);
  sub.writeUInt16BE(4, 0); sub.writeUInt16BE(24, 2); sub.writeUInt16BE(2, 6); // format 4, length 24, segCountX2 2: one segment
  sub.writeUInt16BE(0x10, 14); sub.writeUInt16BE(0x20, 18); sub.writeUInt16BE(0, 20); sub.writeUInt16BE(0, 22); // endCode, startCode, idDelta, idRangeOffset
  const head = Buffer.alloc(4 + 8 * records);
  head.writeUInt16BE(0, 0); head.writeUInt16BE(records, 2);
  for (let i = 0; i < records; i++) { const r = 4 + i * 8; head.writeUInt16BE(3, r); head.writeUInt16BE(1, r + 2); head.writeUInt32BE(head.length, r + 4); }
  const font = woff2({ tables: [{ tag: 'cmap', data: Buffer.concat([head, sub]) }] });
  refuses('m.woff2Cmap(b)', font, /^ERR woff2: a format 4 cmap segment runs backwards/, 'reversed segments under many records');
});

test('the one-line check reads the whole refusal: a refusal whose message holds a second line fails the witness', () => {
  // the witness must be able to go red: a two-line refusal is an assertion failure, not a pass
  const font = woff2({ tables: [{ tag: 'cmap', data: cmapWithGroups([[0x41, 0x41, 1]]) }] });
  assert.throws(() => refuses(`(() => { throw new Error('one' + String.fromCharCode(10) + 'two'); })()`, font, /^ERR one/, 'a two-line refusal'), { name: 'AssertionError' });
});
