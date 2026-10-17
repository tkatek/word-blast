/**
 * Fix #6B REPRODUCTION — recreates the reported glitches in headless Chrome
 * and captures the evidence, before any fix is applied:
 *
 *   R1  drag started AWAY from the pouch → bird teleports to the pointer
 *       ("slingshot looks disconnected while being pulled")
 *   R2  three deliberate misses in a row → resting birds accumulate on the
 *       field ("multiple red birds visible", "bird in slingshot while
 *       another remains", "birds remaining near the towers")
 *   R3  post-bounce rotation behavior ("unnatural positioning/rotation")
 *
 * Usage: node scripts/repro-ghosts.mjs   (dev server on :8081)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'screenshots');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});
try {
  const page = await browser.newPage();
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
  await sleep(300);

  /* ---------- R1: grab 55px away from the pouch, then pull ----------
   * The glitch metric is the DISCONTINUITY at drag start: how far the bird
   * moved MINUS how far the pointer moved. Legacy behavior teleported the
   * bird onto the pointer (large residual); the grab-offset fix keeps the
   * bird glued to the hand (residual ≈ 0). */
  const before = await page.evaluate(() => {
    const p = window.__WB__.scene().slingshot.preview;
    return { x: p.x, y: p.y };
  });
  const press = { x: before.x + 40, y: before.y + 38 };
  const moveTo = { x: before.x + 10, y: before.y + 10 };
  await page.mouse.move(press.x, press.y);
  await page.mouse.down();
  await page.mouse.move(moveTo.x, moveTo.y, { steps: 4 });
  await sleep(150);
  const afterGrab = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const p = s.slingshot.preview;
    return { x: +p.x.toFixed(1), y: +p.y.toFixed(1), dragging: s.slingshot.isDragging() };
  });
  const birdMove = Math.hypot(afterGrab.x - before.x, afterGrab.y - before.y);
  const pointerMove = Math.hypot(moveTo.x - press.x, moveTo.y - press.y);
  const jump = Math.abs(birdMove - pointerMove);
  console.log(`R1 drag-start discontinuity: ${jump.toFixed(1)}px  (bird moved ${birdMove.toFixed(1)}px, pointer moved ${pointerMove.toFixed(1)}px; dragging=${afterGrab.dragging})`);
  await page.screenshot({ path: join(OUT, 'R1-grab-jump.png'), clip: { x: 0, y: 180, width: 560, height: 400 } });
  await page.mouse.up();
  await sleep(600);

  /* ---------- R2: three deliberate misses → ghost accumulation ------ */
  for (let shot = 1; shot <= 3; shot++) {
    // wait for AIMING (re-arm after each resolved miss)
    await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
    // lob short of the towers so the bird lands and rests in the field
    await page.evaluate(() => window.__WB__.simulateShot({ vx: 14, vy: -7 }));
    await sleep(4500); // flight + settle + resolve
    const counts = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return {
        state: window.__WB__.state(),
        projectiles: s.factory.projectiles.length,
        skins: s.factory.birdSkins.length,
        resting: s.factory.projectiles.filter((p) => !p.wb.consumed).map((p) => ({ x: +p.x.toFixed(0), y: +p.y.toFixed(0) }))
      };
    });
    console.log(`R2 shot ${shot}: ${JSON.stringify(counts)}`);
    await page.screenshot({ path: join(OUT, `R2-after-shot-${shot}.png`) });
  }
  // final state: bird in slingshot + ghosts on field
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await page.screenshot({ path: join(OUT, 'R2-ghosts-while-armed.png') });

  /* ---------- R3: post-bounce rotation sample ------------------------ */
  // shot budget may be exhausted (LEVEL_FAILED) — the ghost/rotation data
  // above is already captured; only run R3 when a shot is actually possible
  const canFire = await page.evaluate(() => window.__WB__.state() === 'AIMING');
  if (!canFire) {
    console.log('R3 skipped: shot budget exhausted (LEVEL_FAILED) — expected after 4 misses');
  } else {
  await page.evaluate(() => window.__WB__.simulateShot({ vx: 19, vy: -6 }));
  const rot = [];
  for (let i = 0; i < 26; i++) {
    await sleep(140);
    rot.push(await page.evaluate((t) => {
      const ps = window.__WB__.scene().factory.projectiles;
      if (!ps.length) return null;
      const p = ps[0];
      const v = p.body.velocity;
      const k = p.wb.skin ? p.wb.skin.skin : p;
      return {
        t, x: +p.x.toFixed(0), speed: +Math.hypot(v.x, v.y).toFixed(1),
        impacted: p.wb.firstImpactDone,
        bodyRot: +p.rotation.toFixed(2), skinRot: +k.rotation.toFixed(2)
      };
    }, i));
  }
  console.log('R3 rotation trace (t, x, speed, impacted, bodyRot, skinRot):');
  for (const r of rot.filter(Boolean)) console.log(`   t${String(r.t).padStart(2)} x=${String(r.x).padStart(4)} v=${String(r.speed).padStart(5)} hit=${r.impacted ? 1 : 0} body=${r.bodyRot.toFixed(2).padStart(6)} skin=${r.skinRot.toFixed(2).padStart(6)}`);
  }
} finally {
  await browser.close();
}
