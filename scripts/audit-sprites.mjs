import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.argv[2] || 'C:/Users/HP/AppData/Local/Temp/wb-assets/Word-Blast-Tower-Assets';
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));

console.log('key | WxH | content WxH (alpha>10) | opaque% | semi% | padL,padT,padR,padB');
for (const a of manifest.assets) {
  const { data, info } = await sharp(join(root, a.file)).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  let minX = width, minY = height, maxX = -1, maxY = -1, opaque = 0, semi = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (alpha > 240) opaque++; else semi++;
      }
    }
  }
  const cw = maxX - minX + 1, ch = maxY - minY + 1, tot = width * height;
  console.log(`${a.key} | ${width}x${height} | ${cw}x${ch} | ${(100 * opaque / tot).toFixed(0)}% | ${(100 * semi / tot).toFixed(0)}% | ${minX},${minY},${width - 1 - maxX},${height - 1 - maxY}`);
}
