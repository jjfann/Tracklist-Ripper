// Renders the vinyl toolbar icons as PNGs with no dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const ROSEWOOD = [0x8c, 0x30, 0x40];
const BUTTER = [0xf2, 0xd9, 0x8c];
const VINYL = [0x1b, 0x14, 0x16];
const GROOVE = [0x3a, 0x2c, 0x30];
const SHINE = [0x44, 0x36, 0x3a];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Colour of the record at a point in unit space (-1..1), or null when outside it.
function sample(x, y, size) {
  const r = Math.hypot(x, y);
  if (r > 0.96) return null;
  if (r < 0.07) return null; // spindle hole
  if (r < 0.14) return BUTTER;
  if (r < 0.42) return ROSEWOOD;
  // grooves only where there are enough pixels to show them
  const angle = Math.atan2(y, x);
  const shine = Math.abs(Math.sin(angle - 0.8)) > 0.985 && r > 0.5 && r < 0.9;
  if (shine && size >= 32) return SHINE;
  if (size >= 32) {
    const ring = Math.sin(r * (size >= 128 ? 90 : 45));
    if (ring > 0.75) return GROOVE;
  } else if (r > 0.6 && r < 0.68) {
    return GROOVE;
  }
  return VINYL;
}

function render(size) {
  const ss = 4; // supersampling
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((px + (sx + 0.5) / ss) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / ss) / size) * 2 - 1;
          const c = sample(x, y, size);
          if (c) { rr += c[0]; gg += c[1]; bb += c[2]; aa += 1; }
        }
      }
      const i = (py * size + px) * 4;
      const n = ss * ss;
      if (aa) {
        buf[i] = Math.round(rr / aa);
        buf[i + 1] = Math.round(gg / aa);
        buf[i + 2] = Math.round(bb / aa);
      }
      buf[i + 3] = Math.round((aa / n) * 255);
    }
  }
  return encodePng(size, buf);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../assets/icons/icon-${size}.png`, import.meta.url), render(size));
}
console.log('icons written');
