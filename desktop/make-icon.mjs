// Draws the app icon: the brand mark from the page header, an amber ring on booth black,
// as a 512 by 512 PNG written with nothing but Node's zlib. Run: node desktop/make-icon.mjs
// The colours are read from web/styles.css so the icon follows the palette.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, '..', 'web', 'styles.css'), 'utf8');
const token = (name, fallback) => {
  const m = css.match(new RegExp('--' + name + ':\s*(#[0-9a-fA-F]{6})'));
  return m ? m[1] : fallback;
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const BOOTH = hex(token('booth-black', '#0f0d0c'));
const AMBER = hex(token('jog-amber', '#ff7a2d'));
const SOFT = hex(token('jog-amber-soft', '#ffa062'));

const SIZE = 512;
const SS = 4; // supersampling per axis
const radiusBox = SIZE * 0.22; // rounded square corner
const ringR = SIZE * 0.30;
const ringW = SIZE * 0.085;

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function sample(x, y) {
  // Rounded square mask.
  const cx = Math.min(Math.max(x, radiusBox), SIZE - radiusBox);
  const cy = Math.min(Math.max(y, radiusBox), SIZE - radiusBox);
  const dBox = Math.hypot(x - cx, y - cy);
  if (dBox > radiusBox) return null;
  // Ring: amber, slightly brighter on the right as the page's conic gradient is.
  const dx = x - SIZE / 2;
  const dy = y - SIZE / 2;
  const d = Math.hypot(dx, dy);
  if (Math.abs(d - ringR) <= ringW / 2) {
    const angle = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI);
    const t = 0.5 + 0.5 * Math.cos(angle * 2 * Math.PI);
    return mix(AMBER, SOFT, t * 0.6);
  }
  return BOOTH;
}

const rows = [];
for (let py = 0; py < SIZE; py += 1) {
  const row = Buffer.alloc(1 + SIZE * 4);
  row[0] = 0; // filter: none
  for (let px = 0; px < SIZE; px += 1) {
    let r = 0; let g = 0; let b = 0; let a = 0;
    for (let sy = 0; sy < SS; sy += 1) {
      for (let sx = 0; sx < SS; sx += 1) {
        const c = sample(px + (sx + 0.5) / SS, py + (sy + 0.5) / SS);
        if (c) { r += c[0]; g += c[1]; b += c[2]; a += 1; }
      }
    }
    const n = SS * SS;
    const o = 1 + px * 4;
    if (a) { row[o] = Math.round(r / a); row[o + 1] = Math.round(g / a); row[o + 2] = Math.round(b / a); }
    row[o + 3] = Math.round((a / n) * 255);
  }
  rows.push(row);
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
mkdirSync(join(here, '..', 'build'), { recursive: true });
writeFileSync(join(here, '..', 'build', 'icon.png'), png);
console.log('build/icon.png written,', png.length, 'bytes');
