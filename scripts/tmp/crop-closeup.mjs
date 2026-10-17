import sharp from 'sharp';
// close-up of the new parchment answer panels from the after-L8 capture
const src = 'screenshots/structures/after-L8.png';
const img = sharp(src);
const { width, height } = await img.metadata();
// panel cluster around the stone tower (x ~700..940, y ~120..320 world = screenshot px 1:1)
const crop = { left: 660, top: 110, width: 330, height: 230 };
await img.extract(crop).resize(660, 460, { kernel: 'nearest' }).png()
  .toFile('screenshots/structures/after-answer-closeup.png');
console.log('ok');
