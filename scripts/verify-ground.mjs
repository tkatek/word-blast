/**
 * Ground & background verification — proves, on the RUNNING game, that:
 *
 *   1. exactly ONE static ground collider exists, spanning the full world,
 *      with its top at WORLD.GROUND_Y;
 *   2. the painted grass line of the official background lands on that same
 *      line (measured IN PIXELS from the screenshot under the slingshot and
 *      under the towers — the two gameplay zones);
 *   3. ground-level blocks, pigs and answer plaques rest exactly on the
 *      collider (nothing floating, nothing sunk);
 *   4. the slingshot base is planted on the ground;
 *   5. no fake ground graphics: below the grass line the art is textured
 *      (a painted rectangle would be a uniform row of pixels);
 *   6. the whole world is visible on every viewport (desktop / tablet /
 *      phone landscape / ultrawide) — never cropped.
 *
 * Run: node scripts/verify-ground.mjs [url]   (default http://localhost:5173/)
 * Screenshots: docs/screenshots/ground-*.png
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'docs', 'screenshots');
const URL = process.argv[2] || 'http://localhost:5173/';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const GRASS_TOL_PX = 8;      // painted grass is soft; the line is fuzzy ±a few px
const REST_TOL_PX = 3;       // rested bodies sit within this of the collider top

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** In-page ground facts from the live scene (runs in the browser). */
const FACTS = () => {
  const s = window.__WB__.scene();
  const M = window.Phaser ? null : null;
  const t = s.factory.terrain[0];
  const bgSrc = s.background.image.texture.getSourceImage();
  const cam = s.cameras.main;
  const groundTop = t.bounds.min.y;
  const near = (go, half) => Math.abs(go.y + half - groundTop) <= 30;
  const blocks = s.factory.blocks
    .map((b) => ({ asset: b.wb.asset, bottom: b.y + b.displayHeight / 2 }))
    .filter((b) => Math.abs(b.bottom - groundTop) <= 30);
  const plaques = s.factory.targets
    .map((p) => ({ choice: p.wb.choiceId, bottom: p.y + 40 }))
    .filter((p) => Math.abs(p.bottom - groundTop) <= 30);
  return {
    state: window.__WB__.state(),
    level: s.levelId,
    question: s.questionIndex + 1,
    collider: {
      count: s.factory.terrain.length,
      top: +groundTop.toFixed(2),
      left: +t.bounds.min.x.toFixed(1),
      right: +t.bounds.max.x.toFixed(1)
    },
    background: {
      key: s.background.image.texture.key,
      srcW: bgSrc.width, srcH: bgSrc.height,
      scale: +s.background.image.scaleX.toFixed(4),
      x: +s.background.image.x.toFixed(1), y: +s.background.image.y.toFixed(1)
    },
    camera: {
      zoom: +cam.zoom.toFixed(4),
      viewX: +cam.worldView.x.toFixed(1), viewY: +cam.worldView.y.toFixed(1),
      viewW: +cam.worldView.width.toFixed(1), viewH: +cam.worldView.height.toFixed(1)
    },
    slingshot: { x: s.slingshot.anchor.x, y: s.slingshot.anchor.y, baseY: s.slingshot.anchor.y + 133 },
    groundBlocks: { n: blocks.length, worstOffset: blocks.reduce((m, b) => Math.max(m, Math.abs(b.bottom - groundTop)), 0) },
    groundPlaques: { n: plaques.length, worstOffset: plaques.reduce((m, p) => Math.max(m, Math.abs(p.bottom - groundTop)), 0) },
    viewport: [window.innerWidth, window.innerHeight]
  };
};

async function loadLevel(page, levelId) {
  await page.evaluate((id) => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(id); }, levelId);
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await sleep(700); // let labels/HUD settle
}

/**
 * Pixel-measure the painted grass line at world x (mapped through the live
 * camera) and compare with the collider line. Returns world-space y.
 */
async function grassLineAt(png, worldX, facts) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, C = info.channels;
  const sx = Math.round((worldX - facts.camera.viewX) * facts.camera.zoom);
  if (sx < 2 || sx > W - 2) return null;
  const groundSy = Math.round((facts.collider.top - facts.camera.viewY) * facts.camera.zoom);
  const isGrass = (y) => {
    const i = (y * W + sx) * C;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    return g > r + 12 && g > b + 12 && g > 90;
  };
  // scan a window ±60 screen px around the expected line; find the topmost
  // run of >=6 grass pixels (the painted field edge)
  const from = Math.max(2, groundSy - 60);
  const to = Math.min(info.height - 2, groundSy + 60);
  let run = 0;
  for (let y = from; y < to; y++) {
    if (isGrass(y)) { if (++run >= 6) { const sy = y - 5; return { worldY: (sy / facts.camera.zoom) + facts.camera.viewY, screenErr: sy - groundSy }; } }
    else run = 0;
  }
  return null;
}

/** Fake-ground detector: rows below the grass line must be TEXTURED art. */
async function uniformRowScan(png, facts) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, C = info.channels;
  const y0 = Math.round((facts.collider.top + 30 - facts.camera.viewY) * facts.camera.zoom);
  let uniform = 0;
  for (let y = y0; y < Math.min(y0 + 120, info.height - 2); y += 8) {
    let min = 255 * 3, max = 0;
    for (let x = Math.round(W * 0.2); x < W * 0.8; x += 24) {
      const i = (y * W + x) * C;
      const sum = data[i] + data[i + 1] + data[i + 2];
      if (sum < min) min = sum;
      if (sum > max) max = sum;
    }
    if (max - min < 6) uniform++; // a flat painted rectangle
  }
  return uniform;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-background-timer-throttling']
});
try {
  await mkdir(OUT, { recursive: true });
  const page = await browser.newPage();

  const CASES = [
    { tag: 'desktop-L1', viewport: { width: 1280, height: 720 }, level: 1 },
    { tag: 'desktop-L15', viewport: { width: 1280, height: 720 }, level: 15 },
    { tag: 'tablet-L1', viewport: { width: 1180, height: 820 }, level: 1 },
    { tag: 'phone-L1', viewport: { width: 844, height: 390 }, level: 1 },
    { tag: 'ultrawide-L1', viewport: { width: 2560, height: 1080 }, level: 1 }
  ];

  for (const c of CASES) {
    console.log(`\n== ${c.tag} (${c.viewport.width}x${c.viewport.height}, level ${c.level}) ==`);
    await page.setViewport(c.viewport);
    if (c === CASES[0]) {
      await page.goto(URL, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__WB__ && window.__WB__.game && window.__WB__.game.scene.isActive('MenuScene'), { timeout: 30000 });
    }
    await loadLevel(page, c.level);
    const facts = await page.evaluate(FACTS);
    const file = join(OUT, `ground-${c.tag}.png`);
    await page.screenshot({ path: file });

    check(`${c.tag}: one full-width collider at GROUND_Y`,
      facts.collider.count === 1 && facts.collider.left <= -180 && facts.collider.right >= 1480,
      `count=${facts.collider.count} top=${facts.collider.top} x[${facts.collider.left}, ${facts.collider.right}]`);

    check(`${c.tag}: official background in place`,
      facts.background.key === 'bg-gameplay' && facts.background.srcW === 1672 && facts.background.srcH === 941,
      `${facts.background.key} ${facts.background.srcW}x${facts.background.srcH} scale=${facts.background.scale}`);

    const v = facts.camera;
    check(`${c.tag}: whole 1280x720 world visible`,
      v.viewX <= 0.5 && v.viewY <= 0.5 && v.viewX + v.viewW >= 1279.5 && v.viewY + v.viewH >= 719.5,
      `view=[${v.viewX},${v.viewY} ${v.viewW}x${v.viewH}] zoom=${v.zoom}`);

    check(`${c.tag}: slingshot base on the ground`,
      Math.abs(facts.slingshot.baseY - facts.collider.top) <= 10,
      `base y=${facts.slingshot.baseY.toFixed(1)} ground=${facts.collider.top}`);

    if (facts.groundBlocks.n > 0) {
      check(`${c.tag}: ${facts.groundBlocks.n} ground blocks rest on the collider`,
        facts.groundBlocks.worstOffset <= REST_TOL_PX,
        `worst offset ${facts.groundBlocks.worstOffset.toFixed(2)}px`);
    }
    if (facts.groundPlaques.n > 0) {
      check(`${c.tag}: ${facts.groundPlaques.n} ground plaques rest on the collider`,
        facts.groundPlaques.worstOffset <= REST_TOL_PX,
        `worst offset ${facts.groundPlaques.worstOffset.toFixed(2)}px`);
    }

    const underSling = await grassLineAt(file, 260, facts);   // left field
    const underTowers = await grassLineAt(file, 940, facts);  // center-right field
    for (const [zone, m] of [['sling zone', underSling], ['tower zone', underTowers]]) {
      check(`${c.tag}: painted grass line on collider (${zone})`,
        !!m && Math.abs(m.worldY - facts.collider.top) <= GRASS_TOL_PX,
        m ? `painted y=${m.worldY.toFixed(1)} vs collider ${facts.collider.top} (err ${(m.worldY - facts.collider.top).toFixed(1)}px)` : 'grass not found in window');
    }

    const uniform = await uniformRowScan(file, facts);
    check(`${c.tag}: no fake flat ground graphics below the grass`, uniform === 0, `${uniform} uniform rows`);
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nGROUND VERIFICATION: ${results.length - failed}/${results.length} checks passed${failed ? ' — FAILURES ABOVE' : ''}`);
process.exit(failed ? 1 : 0);
