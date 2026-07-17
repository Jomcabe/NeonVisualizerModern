'use strict';

// Generates build/icon.png (1024x1024) — a neon "N" mark on black — with no
// external dependencies, so CI can build the macOS icon on a clean runner.

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const buf = Buffer.alloc(SIZE * SIZE * 4);

function set(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
  const i = (y * SIZE + x) * 4;
  // simple src-over onto whatever's there
  const ba = buf[i + 3] / 255;
  const sa = a / 255;
  const outA = sa + ba * (1 - sa);
  if (outA <= 0) return;
  buf[i] = Math.round((r * sa + buf[i] * ba * (1 - sa)) / outA);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * ba * (1 - sa)) / outA);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * ba * (1 - sa)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

// Rounded-rect black background with a subtle radial glow.
const radius = 220;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const inCorner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 > radius ** 2;
    let outside = false;
    if (x < radius && y < radius && inCorner(radius, radius)) outside = true;
    if (x > SIZE - radius && y < radius && inCorner(SIZE - radius, radius)) outside = true;
    if (x < radius && y > SIZE - radius && inCorner(radius, SIZE - radius)) outside = true;
    if (x > SIZE - radius && y > SIZE - radius && inCorner(SIZE - radius, SIZE - radius)) outside = true;
    if (outside) continue;
    const dx = (x - SIZE / 2) / SIZE;
    const dy = (y - SIZE / 2) / SIZE;
    const d = Math.sqrt(dx * dx + dy * dy);
    const glow = Math.max(0, 0.28 - d) * 2.6;
    const r = Math.round(12 + glow * 40);
    const g = Math.round(14 + glow * 90);
    const b = Math.round(22 + glow * 120);
    set(x, y, r, g, b, 255);
  }
}

// Neon gradient stroke helper.
function grad(t) {
  // cyan -> violet -> magenta
  const stops = [
    [0, 229, 255],
    [123, 92, 255],
    [255, 62, 165]
  ];
  t = Math.max(0, Math.min(1, t));
  const seg = t * 2;
  const i = Math.min(1, Math.floor(seg));
  const f = seg - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// Draw a thick glowing line segment (with additive-ish glow falloff).
function stroke(x0, y0, x1, y1, width, tOff) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = x0 + (x1 - x0) * t;
    const cy = y0 + (y1 - y0) * t;
    const [r, g, b] = grad(tOff + t * 0.5);
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        const dist = Math.hypot(ox, oy);
        if (dist > width) continue;
        const core = Math.max(0, 1 - dist / (width * 0.45));
        const glow = Math.max(0, 1 - dist / width) * 0.5;
        const a = Math.min(1, core + glow);
        set(Math.round(cx + ox), Math.round(cy + oy), r, g, b, Math.round(a * 255));
      }
    }
  }
}

// The "N": two verticals + a diagonal.
const m = 300, top = 300, bot = 724, w = 46;
stroke(m, bot, m, top, w, 0.0);            // left vertical
stroke(m, top, SIZE - m, bot, w, 0.25);    // diagonal
stroke(SIZE - m, bot, SIZE - m, top, w, 0.6); // right vertical

// ---- Encode PNG ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b) {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
// compression, filter, interlace default 0

// Add filter byte (0) per scanline.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  buf.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const idat = zlib.deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0))
]);

const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
console.log('Wrote build/icon.png (' + SIZE + 'x' + SIZE + ', ' + png.length + ' bytes)');
