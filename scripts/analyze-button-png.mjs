/**
 * One-off diagnostic: decode both supplied button PNGs (8-bit RGBA,
 * non-interlaced) with Node's zlib and report the non-transparent content
 * bounds so layout code can trim the transparent padding.
 *
 * Usage: node scripts/analyze-button-png.mjs <file.png> [...]
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

function decodePng(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  const chunks = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    chunks.push({ type, data });
    pos += 12 + len;
  }
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`unsupported: depth ${bitDepth} color ${colorType}`);
  if (interlace !== 0) throw new Error('interlaced PNG unsupported');

  const bpp = 4;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= bpp && prev ? prev[x - bpp] : 0;
      let v = row[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 0xff; break;
        case 2: v = (v + b) & 0xff; break;
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const pp = a + b - c;
          const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pred) & 0xff; break;
        }
      }
      cur[x] = v;
    }
  }
  return { width, height, pixels: out };
}

function contentBounds(px, width, height, alphaMin = 8) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (px[row + x * 4 + 3] >= alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

for (const file of process.argv.slice(2)) {
  const { width, height, pixels } = decodePng(file);
  const b = contentBounds(pixels, width, height);
  const name = file.split(/[\\/]/).pop();
  console.log(JSON.stringify({
    file: name,
    size: `${width}x${height}`,
    content: `${b.minX},${b.minY} → ${b.maxX},${b.maxY}`,
    contentSize: `${b.w}x${b.h}`,
    padding: { left: b.minX, top: b.minY, right: width - 1 - b.maxX, bottom: height - 1 - b.maxY },
    contentAspect: +(b.w / b.h).toFixed(3)
  }, null, 2));
}
