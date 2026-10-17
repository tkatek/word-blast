import sharp from 'sharp';
const p = 'C:/Users/HP/Downloads/Panneau de parchemin fantasy en bois.png';
const img = sharp(p);
const meta = await img.metadata();
console.log('meta:', JSON.stringify(meta));
const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    const a = data[(y * info.width + x) * info.channels + (info.channels - 1)];
    if (a > 10) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log('canvas:', info.width + 'x' + info.height, 'content:', (maxX-minX+1) + 'x' + (maxY-minY+1), 'pads LRTB:', minX, info.width-1-maxX, minY, info.height-1-maxY);
