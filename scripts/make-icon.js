// Draws the PadBridge icon (a round button cap) and writes app/icon.ico.
// Run again after changing the colours: node scripts/make-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const INK = [22, 23, 26], PAPER = [251, 251, 248], BLUE = [8, 111, 171];

function pixel(x, y) {
  const d = Math.hypot(x - 127.5, y - 127.5);
  const edge = (r) => Math.max(0, Math.min(1, r - d + 0.5)); // 1 inside radius r, soft 1px edge
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  let rgb = INK;
  let alpha = edge(124);
  rgb = mix(rgb, PAPER, edge(108));
  rgb = mix(rgb, INK, edge(86));
  rgb = mix(rgb, BLUE, edge(70));
  return [...rgb, Math.round(alpha * 255)];
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) raw.set(pixel(x, y), y * (SIZE * 4 + 1) + 1 + x * 4);
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), body.length + 4);
  return out;
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);

// ICO container holding the one PNG (Windows accepts PNG-compressed 256px entries).
const header = Buffer.alloc(22);
header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);       // type: icon, count: 1
header[6] = 0; header[7] = 0;                                 // 0 means 256
header.writeUInt16LE(1, 10); header.writeUInt16LE(32, 12);    // planes, bits per pixel
header.writeUInt32LE(png.length, 14); header.writeUInt32LE(22, 18);
const out = path.join(__dirname, '..', 'app', 'icon.ico');
fs.writeFileSync(out, Buffer.concat([header, png]));
fs.writeFileSync(path.join(__dirname, '..', 'app', 'icon.png'), png);
console.log(`wrote ${out} (${png.length + 22} bytes)`);
