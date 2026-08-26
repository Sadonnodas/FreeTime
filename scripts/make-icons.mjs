/**
 * Generates the PWA icon PNGs with no dependencies.
 *
 * A PNG is just a signature plus a few length-prefixed chunks: IHDR (size and
 * format), IDAT (zlib-compressed pixel rows, each prefixed with a filter byte),
 * and IEND. Node's zlib does the only hard part, so hand-rolling this is
 * cheaper than pulling in a whole image library for three flat squares.
 *
 * These are deliberate placeholders — a dark tile with an accent ring. Drop
 * real artwork into static/icons/ with the same filenames to replace them.
 *
 * Run: node scripts/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { Buffer } from 'node:buffer';

const BG = [15, 15, 17];
const ACCENT = [124, 156, 255];

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** @param {number} size @param {number} inset fraction of the canvas left as padding */
function render(size, inset) {
  const rows = [];
  const cx = size / 2;
  const usable = size * (1 - inset * 2);
  const outer = usable / 2;
  const inner = outer * 0.62;

  for (let y = 0; y < size; y++) {
    // Each scanline starts with a filter-type byte; 0 means "no filtering".
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cx);
      const on = d <= outer && d >= inner;
      const [r, g, b] = on ? ACCENT : BG;
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync('static/icons', { recursive: true });

// A maskable icon gets cropped to whatever shape the OS wants, so its art must
// sit inside a safe zone — hence the larger inset on that one.
const targets = [
  ['static/icons/icon-192.png', 192, 0.18],
  ['static/icons/icon-512.png', 512, 0.18],
  ['static/icons/icon-512-maskable.png', 512, 0.28],
  ['static/icons/apple-touch-icon.png', 180, 0.18]
];

for (const [path, size, inset] of targets) {
  writeFileSync(path, render(size, inset));
  console.log('wrote', path);
}
