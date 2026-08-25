// Generator for every Kolwen brand asset. The mark is three axis-aligned
// rectangles, so rasterising it here is exact - no renderer, no font, nothing
// to install. Run: node make-brand.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

// Framed so the mark fills 83% of its box - Material's 20-of-24dp live area.
const BARS = [
  { x: 8.5,   y: 9.1,   w: 64.3, h: 25.0  },
  { x: 17.85, y: 46.25, w: 64.3, h: 19.66 },
  { x: 27.2,  y: 75.46, w: 64.3, h: 15.45 },
];

// Social platforms mask an avatar to the INSCRIBED CIRCLE, where the square live area
// above does not apply: the mark reaches radius 58.27 from centre against the 50 a circle
// allows, so the outer bars' far corners shear off (~4px each at a 48px avatar). Rebuild
// the same 83% fill against the ROUND zone - scale about the centre until the mark's
// circumscribed circle is 83% of the crop circle. Square/rounded-rect uses keep BARS.
const CENTRE = 50;
const INK_RADIUS = Math.max(...BARS.flatMap(b =>
  [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
    .map(([x, y]) => Math.hypot(x - CENTRE, y - CENTRE))));
const AVATAR_SCALE = (0.83 * CENTRE) / INK_RADIUS;
const AVATAR_BARS = BARS.map(b => ({
  x: CENTRE + (b.x - CENTRE) * AVATAR_SCALE,
  y: CENTRE + (b.y - CENTRE) * AVATAR_SCALE,
  w: b.w * AVATAR_SCALE,
  h: b.h * AVATAR_SCALE,
}));

const AMBER_DARK_GROUND  = '#e8833a';  // 6.84:1 on #15130f
const AMBER_LIGHT_GROUND = '#A65A19';  // 5.125:1 on white; 3.620:1 on charcoal = large/non-text only
const CHARCOAL           = '#15130f';

const rects = (fill, bars) => bars.map(b =>
  `  <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}"${fill ? ` fill="${fill}"` : ''}/>`).join('\n');

const svg = (fill, bg, bars = BARS) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Kolwen">
  <title>Kolwen</title>
${bg ? `  <rect width="100" height="100" fill="${bg}"/>\n` : ''}${rects(fill, bars)}
</svg>
`;

writeFileSync(`${OUT}/kolwen-mark.svg`,         svg(AMBER_DARK_GROUND, null));
writeFileSync(`${OUT}/kolwen-mark-onlight.svg`, svg(AMBER_LIGHT_GROUND, null));
writeFileSync(`${OUT}/kolwen-mark-mono.svg`,    svg('currentColor', null));
writeFileSync(`${OUT}/kolwen-icon.svg`,         svg(AMBER_DARK_GROUND, CHARCOAL));

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

function png(size, fg, bg, bars = BARS) {
  const [fr, fg_, fb] = hex(fg);
  const [br, bg_, bb] = bg ? hex(bg) : [0, 0, 0];
  const bgA = bg ? 255 : 0;
  const s = size / 100;
  const SS = 4;  // supersample so sub-pixel bar edges land as coverage, not a hard cut
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px = (x + (sx + 0.5) / SS) / s, py = (y + (sy + 0.5) / SS) / s;
        if (bars.some(b => px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h)) hits++;
      }
      const a = hits / (SS * SS);
      const i = row + 1 + x * 4;
      raw[i]     = Math.round(fr  * a + br  * (1 - a));
      raw[i + 1] = Math.round(fg_ * a + bg_ * (1 - a));
      raw[i + 2] = Math.round(fb  * a + bb  * (1 - a));
      raw[i + 3] = Math.round(255 * a + bgA * (1 - a));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let TBL = null;
function crc32(buf) {
  if (!TBL) {
    TBL = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TBL[n] = c; }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

// The whole point of AVATAR_BARS: prove the circle crop cannot reach the ink.
const maxRadius = bars => Math.max(...bars.flatMap(b =>
  [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]
    .map(([x, y]) => Math.hypot(x - CENTRE, y - CENTRE))));
assert(maxRadius(BARS) > CENTRE, 'BARS should overflow the inscribed circle - that is the defect this variant answers');
assert(maxRadius(AVATAR_BARS) <= CENTRE, 'AVATAR_BARS must fit inside the inscribed circle');

const made = [];
for (const [name, size, fg, bg, bars] of [
  ['kolwen-mark-128.png',          128,  AMBER_DARK_GROUND,  null],
  ['kolwen-mark-onlight-128.png',  128,  AMBER_LIGHT_GROUND, null],
  ['kolwen-icon-128.png',          128,  AMBER_DARK_GROUND,  CHARCOAL],
  ['kolwen-icon-256.png',          256,  AMBER_DARK_GROUND,  CHARCOAL],
  ['kolwen-icon-512.png',          512,  AMBER_DARK_GROUND,  CHARCOAL],   // square / rounded-rect
  ['kolwen-icon-1024.png',        1024,  AMBER_DARK_GROUND,  CHARCOAL],   // store / press
  ['kolwen-avatar-512.png',        512,  AMBER_DARK_GROUND,  CHARCOAL, AVATAR_BARS], // circle crop
  ['kolwen-favicon-32.png',         32,  AMBER_DARK_GROUND,  CHARCOAL],
  ['kolwen-favicon-16.png',         16,  AMBER_DARK_GROUND,  CHARCOAL],
]) {
  const buf = png(size, fg, bg, bars);
  writeFileSync(`${OUT}/${name}`, buf);
  made.push(`${name.padEnd(30)} ${size}x${size}  ${buf.length}B`);
}
console.log('svg: kolwen-mark / -onlight / -mono / kolwen-icon');
console.log(made.join('\n'));
