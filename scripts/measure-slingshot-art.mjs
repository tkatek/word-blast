/**
 * Measure the slingshot artwork's alpha silhouette: fork tips, handle
 * bottom, fork gap — to verify/derive the SLINGSHOT.ART anchors.
 */
import sharp from 'sharp';

const PNG = 'public/assets/images/slingshot/slingshot-wood.png';
const img = sharp(PNG);
const { width, height } = await img.metadata();
console.log('dimensions:', width, 'x', height);

const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const A = (x, y) => data[(y * info.width + x) * info.channels + 3];
const opaque = (x, y) => A(x, y) > 40;

// bounding box of opaque pixels
let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (opaque(x, y)) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
}
console.log('opaque bbox:', { minX, maxX, minY, maxY });

// topmost opaque pixel (fork tips region — scan the top 25% of the art)
const scanTop = Math.floor(info.height * 0.25);
const rows = [];
for (let y = minY; y < scanTop; y++) {
  const runs = [];
  let run = null;
  for (let x = minX; x <= maxX; x++) {
    if (opaque(x, y)) {
      if (!run) run = { x0: x, x1: x };
      else run.x1 = x;
    } else if (run) {
      if (run.x1 - run.x0 > 4) runs.push(run);
      run = null;
    }
  }
  if (run && run.x1 - run.x0 > 4) runs.push(run);
  if (runs.length >= 2) rows.push({ y, runs });
  if (rows.length > 6) break;
}
console.log('first rows with 2+ horizontal runs (the two prongs):');
for (const r of rows) console.log('  y=%d runs=%j', r.y, r.runs);

// handle bottom: for the bottom 10 rows that contain opaque pixels, report center of run
for (let y = maxY; y > maxY - 6; y--) {
  let x0 = null, x1 = null;
  for (let x = minX; x <= maxX; x++) {
    if (opaque(x, y)) { if (x0 === null) x0 = x; x1 = x; }
  }
  console.log('bottom row y=%d: x %d..%d center=%d', y, x0, x1, (x0 + x1) / 2);
}

// widest row overall (the fork spread) and the gap between prongs at several heights
for (const y of [minY + 10, minY + 30, minY + 60, minY + 90, minY + 120, minY + 160]) {
  const runs = [];
  let run = null;
  for (let x = minX; x <= maxX; x++) {
    if (opaque(x, y)) {
      if (!run) run = { x0: x, x1: x }; else run.x1 = x;
    } else if (run) { if (run.x1 - run.x0 > 3) runs.push(run); run = null; }
  }
  if (run && run.x1 - run.x0 > 3) runs.push(run);
  console.log('y=%d runs=%j', y, runs.map((r) => `${r.x0}..${r.x1}`));
}

// trunk center at mid height (should be one run)
for (const y of [400, 500, 700, 900]) {
  let x0 = null, x1 = null;
  for (let x = minX; x <= maxX; x++) {
    if (opaque(x, y)) { if (x0 === null) x0 = x; x1 = x; }
  }
  console.log('trunk row y=%d: x %s..%s center=%s', y, x0, x1, x0 === null ? '-' : ((x0 + x1) / 2).toFixed(0));
}
