// Generates the extension icons (Memoko face + HP bar) with zero dependencies:
// analytic drawing + a minimal PNG encoder over node:zlib.
// Usage: node scripts/gen-icons.mjs  → public/icons/icon{16,32,48,128}.png

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const SIZES = [16, 32, 48, 128];

// ---- minimal PNG encoder (8-bit RGBA, no filtering) ----------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- scene: Memoko (fresh) + HP bar ---------------------------------------
// The face is defined in the same 32×32 coordinate space as the in-page
// sprite (src/content/ui/avatar.ts), mapped into unit space below.

const BG = [21, 23, 27];
const GREEN = [52, 211, 153];
const TRACK = [255, 255, 255];
const HAIR = [232, 147, 168];
const SKIN = [255, 217, 196];
const INK = [80, 58, 68];
const MOUTH = [207, 106, 120];
const BLUSH = [255, 158, 176];

const FACE_SCALE = 0.019; // 32-box units → unit space
const FACE_CY = 0.4;

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
}

const circ = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) <= r;
const ell = (x, y, cx, cy, rx, ry) =>
  ((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry) <= 1;
// happy closed eye: arc of a circle below the lid line
const eyeArc = (x, y, cx) => Math.abs(Math.hypot(x - cx, y - 21.1) - 2.6) < 0.8 && y < 19.9;
// ahoge: left half of a thin ring
const ahoge = (x, y) => Math.abs(Math.hypot(x - 17.8, y - 4.55) - 2.7) < 0.8 && x < 17.8;
// scalloped bangs: union of three circles over the forehead
const bangs = (x, y) =>
  circ(x, y, 10.3, 11.4, 5.8) || circ(x, y, 16, 9.6, 6.6) || circ(x, y, 21.7, 11.4, 5.8);

/** Color of the icon at unit coordinates (u right, v down) → [r,g,b,a]. */
function sample(u, v) {
  if (sdRoundRect(u, v, 0.5, 0.5, 0.5, 0.5, 0.21) > 0) return [0, 0, 0, 0];
  let col = BG;
  const x = (u - 0.5) / FACE_SCALE + 16;
  const y = (v - FACE_CY) / FACE_SCALE + 16.5;

  const inHair =
    circ(x, y, 16, 15.8, 12.4) ||
    ell(x, y, 4.9, 20.5, 2.7, 5.6) ||
    ell(x, y, 27.1, 20.5, 2.7, 5.6) ||
    bangs(x, y) ||
    ahoge(x, y);
  if (inHair) col = HAIR;
  if (circ(x, y, 16, 17.6, 10) && !bangs(x, y)) {
    col = SKIN;
    if (ell(x, y, 9.9, 22.3, 2.0, 1.15) || ell(x, y, 22.1, 22.3, 2.0, 1.15)) col = BLUSH;
    if (eyeArc(x, y, 12) || eyeArc(x, y, 20)) col = INK;
    if (Math.hypot(x - 16, y - 22.4) < 2.7 && y > 22.4) col = MOUTH;
  }

  const barTrack = sdRoundRect(u, v, 0.5, 0.745, 0.275, 0.048, 0.048);
  if (barTrack <= 0) {
    // track at 13% white over bg
    col = [
      BG[0] + (TRACK[0] - BG[0]) * 0.13,
      BG[1] + (TRACK[1] - BG[1]) * 0.13,
      BG[2] + (TRACK[2] - BG[2]) * 0.13,
    ];
    // fill: left 72% of the bar
    if (u <= 0.225 + 0.55 * 0.72) col = GREEN;
  }
  return [col[0], col[1], col[2], 255];
}

function render(size) {
  const SS = 4; // supersamples per axis
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (px + (sx + 0.5) / SS) / size;
          const v = (py + (sy + 0.5) / SS) / size;
          const [cr, cg, cb, ca] = sample(u, v);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      rgba[i] = a > 0 ? Math.round(r / a) : 0;
      rgba[i + 1] = a > 0 ? Math.round(g / a) : 0;
      rgba[i + 2] = a > 0 ? Math.round(b / a) : 0;
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, render(size));
  console.log('wrote', file);
}
