import sharp from 'sharp';
for (const k of ['s', 'm', 'l']) {
  const p = `public/assets/images/tower/props/answer_panel_${k}.png`;
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let minX = info.width, maxX = -1, minY = info.height, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 10) { if (x < minX)minX = x; if (x > maxX)maxX = x; if (y < minY)minY = y; if (y > maxY)maxY = y; }
  }
  console.log(k, info.width + 'x' + info.height, 'content', (maxX - minX + 1) + 'x' + (maxY - minY + 1), 'pads LRTB', minX, info.width - 1 - maxX, minY, info.height - 1 - maxY);
}
