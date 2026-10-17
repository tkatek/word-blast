import sharp from 'sharp';
const buffs = [];
for (const k of ['s', 'm', 'l']) {
  buffs.push(await sharp(`public/assets/images/tower/props/answer_panel_${k}.png`).png().toBuffer());
}
const W = 170, GAP = 24, H = 3 * 80 + 2 * GAP;
const canvas = sharp({ create: { width: W, height: H, channels: 4, background: { r: 142, g: 202, b: 230, alpha: 1 } } });
await canvas.composite(buffs.map((input, i) => ({ input, left: 0, top: i * (80 + GAP) })))
  .png().toFile('screenshots/structures/panels-preview.png');
console.log('ok');
