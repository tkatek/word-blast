// Temporary asset report: dimensions + weight of every shipped image.
import fs from 'node:fs';
import path from 'node:path';

function pngSize(b) { return [b.readUInt32BE(16), b.readUInt32BE(20)]; }
function webpSize(b) {
  const fmt = b.toString('ascii', 12, 16);
  if (fmt === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (fmt === 'VP8L') { const n = b.readUInt32LE(21); return [(n & 0x3fff) + 1, ((n >> 14) & 0x3fff) + 1]; }
  if (fmt === 'VP8X') return [(b.readUIntLE(24, 3) >>> 0) + 1, (b.readUIntLE(27, 3) >>> 0) + 1];
  return ['?', '?'];
}

const root = 'public/assets/images';
const out = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(png|webp)$/i.test(e.name)) {
      const b = fs.readFileSync(p);
      let s;
      try { s = /\.png$/i.test(e.name) ? pngSize(b) : webpSize(b); } catch { s = ['err', 'err']; }
      out.push([p.split(path.sep).join('/'), `${s[0]}x${s[1]}`, Math.round(b.size / 1024)]);
    }
  }
})(root);
out.sort((a, b) => b[2] - a[2]);
for (const [p, dim, kb] of out) console.log(`${String(kb).padStart(6)} KB  ${dim.padStart(12)}  ${p}`);
console.log(`TOTAL: ${Math.round(out.reduce((n, r) => n + r[2], 0))} KB in ${out.length} files`);
