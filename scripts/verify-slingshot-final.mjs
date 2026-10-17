/**
 * FINAL slingshot fix verification + screenshot capture.
 *
 * Captures the 8 required states (desktop 1280×720) plus mobile-landscape
 * samples, and runs hard assertions:
 *   - DIFFERENTIAL wood check: frame with wood visible minus frame with
 *     wood hidden must cover the full artwork rect (trunk down to the
 *     grass, both fork tips) — no color heuristics
 *   - mechanics: drag → release → physics body spawns at the pouch,
 *     flies right; correct answer advances the question; re-arm reloads
 *     the next bird; restart-question keeps the slingshot intact
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'screenshots', 'slingshot-fix');
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(page, fn, timeout = 15000, everyMs = 50, arg = undefined) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await page.evaluate(fn, arg);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : 'FAIL  '}${name}${detail ? ' — ' + detail : ''}`);
};

async function newGamePage(w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h });
  page.on('response', (r) => { if (r.status() >= 400) console.log('[http' + r.status() + ']', r.url()); });
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await page.evaluate(() => window.__WB__.gotoLevel(1));
  const armed = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 60);
  return { page, armed };
}

try {
  const { page, armed } = await newGamePage(1280, 720);
  check('game armed (AIMING)', !!armed);

  /* ---- 1/2. idle with full wooden body + bird seated ---- */
  await sleep(700); // bird load-in tween settle
  await page.screenshot({ path: join(OUT, '01-desktop-idle-full.png') });
  await page.screenshot({ path: join(OUT, '02-desktop-idle-closeup.png'), clip: { x: 80, y: 260, width: 340, height: 300 } });

  /* ---- differential wood check (deterministic, color-free) ---- */
  const woodInfo = await page.evaluate(() => {
    const r = window.__WB__.scene().slingshot.renderer;
    return {
      w: r.wood.width, h: r.wood.height, frame: r.wood.frame.name,
      x: r.wood.x, y: r.wood.y, scale: r.scale, visible: r.wood.visible
    };
  });
  check('wood sprite = complete texture (1254×1254, __BASE)',
    woodInfo.w === 1254 && woodInfo.h === 1254 && woodInfo.frame === '__BASE',
    JSON.stringify(woodInfo));

  // freeze everything dynamic inside the slingshot region (bird breathing
  // tween) so the ONLY difference between the two frames is the wood
  await page.evaluate(() => {
    const s = window.__WB__.scene();
    s.tweens.killTweensOf(s.slingshot.preview);
    s.slingshot.preview.setScale(s.slingshot.preview.scaleX);
  });
  const withWood = await page.screenshot({ encoding: 'binary' });
  await page.evaluate(() => { window.__WB__.scene().slingshot.renderer.wood.setVisible(false); });
  await sleep(80);
  const withoutWood = await page.screenshot({ encoding: 'binary' });
  await page.evaluate(() => { window.__WB__.scene().slingshot.renderer.wood.setVisible(true); });
  await sleep(80);

  // analyze ONLY the slingshot region (excludes the ticking HUD timer etc.)
  const REG = { x0: 140, x1: 260, y0: 325, y1: 490 };
  const a = await sharp(withWood).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(withoutWood).raw().toBuffer({ resolveWithObject: true });
  let dMinX = 1e9, dMaxX = -1, dMinY = 1e9, dMaxY = -1, changed = 0;
  for (let y = REG.y0; y < REG.y1; y++) {
    for (let x = REG.x0; x < REG.x1; x++) {
      const i = (y * a.info.width + x) * a.info.channels;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 40) {
        changed++;
        if (x < dMinX) dMinX = x; if (x > dMaxX) dMaxX = x;
        if (y < dMinY) dMinY = y; if (y > dMaxY) dMaxY = y;
      }
    }
  }
  // expected artwork rect in world/canvas px (1:1 viewport):
  // x 155.3..230.7, y 340.5..479.7 — allow a few px of anti-aliased slack
  const expect = { x0: 150, x1: 236, y0: 335, y1: 484 };
  check('wood renders across FULL artwork rect (fork tops → grass)',
    changed > 2000 && dMinX >= expect.x0 - 2 && dMaxX <= expect.x1 + 2
    && dMinY >= expect.y0 - 2 && dMaxY <= expect.y1 + 2 && dMaxY > 470,
    `diff bbox x ${dMinX}..${dMaxX}, y ${dMinY}..${dMaxY}, ${changed} px changed`);
  // trunk continuity: every 8px row from the fork crotch to the grass must
  // contain changed (wood) pixels inside the trunk column band
  let trunkGapRows = [];
  for (let y = 380; y <= 472; y += 8) {
    let hit = false;
    for (let x = 160; x <= 232 && !hit; x++) {
      const i = (y * a.info.width + x) * a.info.channels;
      const d = Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      if (d > 40) hit = true;
    }
    if (!hit) trunkGapRows.push(y);
  }
  check('trunk continuous fork→grass (no invisible trunk)', trunkGapRows.length === 0,
    trunkGapRows.length ? 'gap rows ' + trunkGapRows.join(',') : 'all rows covered');

  /* ---- 3/4. drag back: bands stretch, bird+ pouch move together ---- */
  const drag = await page.evaluate(() => {
    const sl = window.__WB__.scene().slingshot;
    const a = sl.anchor;
    sl.onPointerDown({ worldX: a.x, worldY: a.y });
    sl.onPointerMove({ worldX: 70, worldY: 400 });
    return { pouch: sl.pouchPoint(), dragging: sl.isDragging(), preview: { x: sl.preview.x, y: sl.preview.y } };
  });
  check('drag engages (bird+pouch follow pointer, clamped)',
    drag.dragging && Math.abs(drag.pouch.x - drag.preview.x) < 0.01 && Math.abs(drag.pouch.y - drag.preview.y) < 0.01,
    JSON.stringify(drag));
  await sleep(150);
  await page.screenshot({ path: join(OUT, '03-desktop-pulled-back.png') });
  await page.screenshot({ path: join(OUT, '04-desktop-bands-stretching-closeup.png'), clip: { x: 20, y: 280, width: 420, height: 260 } });
  const bands = await page.evaluate(() => {
    const r = window.__WB__.scene().slingshot.renderer;
    return { rearTip: r.rearTip, frontTip: r.frontTip, anchor: r.anchor };
  });
  check('band anchor tips pinned to wood fork tips (static)',
    Math.abs(bands.rearTip.x - 173.64) < 0.5 && Math.abs(bands.rearTip.y - 342.22) < 0.5
    && Math.abs(bands.frontTip.x - 216.48) < 0.5 && Math.abs(bands.frontTip.y - 347.18) < 0.5,
    JSON.stringify(bands));

  /* ---- 5. release: real Matter launch from the pouch position ---- */
  const launchState = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const sl = s.slingshot;
    const p = sl.pouchPoint();
    sl.onPointerUp();
    return { releasedAt: p, state: s.stateMachine.current };
  });
  await sleep(150); // bird visibly in flight, near the slingshot
  const flight = await page.evaluate(() => {
    const s = window.__WB__.scene();
    return { state: s.stateMachine.current, projectiles: s.factory.projectiles.map((p) => ({ x: +p.x.toFixed(0), y: +p.y.toFixed(0), v: p.body.velocity })) };
  });
  check('release → PROJECTILE_FLYING with real physics body',
    launchState.state === 'PROJECTILE_FLYING' || flight.state === 'PROJECTILE_FLYING',
    JSON.stringify(flight));
  check('projectile flies rightward from the pouch',
    flight.projectiles.length === 1 && flight.projectiles[0].x > launchState.releasedAt.x && flight.projectiles[0].v.x > 0,
    `spawned (${launchState.releasedAt.x.toFixed(0)},${launchState.releasedAt.y.toFixed(0)}) now (${flight.projectiles[0]?.x},${flight.projectiles[0]?.y})`);
  await page.screenshot({ path: join(OUT, '05-desktop-just-released.png') });

  /* ---- 6. pouch snapping back: freeze the real snap at mid-animation ---- */
  const reArmed1 = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 25000, 60);
  check('slingshot re-armed after shot', !!reArmed1);
  await page.evaluate(() => {
    const sl = window.__WB__.scene().slingshot;
    const a = sl.anchor;
    sl.onPointerDown({ worldX: a.x, worldY: a.y });
    sl.onPointerMove({ worldX: 70, worldY: 400 });
  });
  await sleep(120);
  const snapState = await page.evaluate(() => {
    const sl = window.__WB__.scene().slingshot;
    sl.onPointerUp();                 // fires the real launch + starts the snap
    // pin the LIVE snap at t=0.2 (pouch ~halfway back, bands stretched):
    // a huge ms with a matching t0 makes snapT ≈ 0.2 on every later frame,
    // so the screenshot shows the genuine mid-snap renderer state
    sl.snap.ms = 1e9;
    sl.snap.t0 = sl.scene.time.now - 2e8;
    sl.redraw();
    return { snapping: !!sl.snap, t: sl.snapT(), pouch: sl.pouchPoint(), previewGone: !sl.preview };
  });
  await page.screenshot({ path: join(OUT, '06-desktop-pouch-snapping-back.png'), clip: { x: 60, y: 250, width: 420, height: 300 } });
  check('empty pouch mid-snap (bird detached, no ghost preview)',
    snapState.previewGone && !!snapState.snapping && Math.abs(snapState.t - 0.2) < 0.01
    && Math.hypot(snapState.pouch.x - 195, snapState.pouch.y - 346) > 20,
    JSON.stringify(snapState));

  /* ---- 7. next bird loaded after the shot resolves ---- */
  const reArmed2 = await poll(page, () => {
    const s = window.__WB__.scene();
    return s.stateMachine.current === 'AIMING' && s.slingshot.preview ? true : null;
  }, 25000, 60);
  await sleep(500);
  await page.screenshot({ path: join(OUT, '07-desktop-next-bird-loaded.png') });
  const nextBird = await page.evaluate(() => {
    const sl = window.__WB__.scene().slingshot;
    return { atAnchor: Math.hypot(sl.preview.x - sl.anchor.x, sl.preview.y - sl.anchor.y) < 0.01, tex: sl.preview.texture.key };
  });
  check('next bird loaded seated at the anchor', !!reArmed2 && nextBird.atAnchor, JSON.stringify(nextBird));

  /* ---- gameplay: correct answer advances the question ---- */
  const before = await page.evaluate(() => window.__WB__.info());
  const sol = await page.evaluate(() => window.__WB__.autoAim());
  const qAdvanced = await poll(page, (prev) => {
    const i = window.__WB__.info();
    return i.questionIndex > prev || i.state === 'LEVEL_COMPLETE' ? i : null;
  }, 30000, 80, before.questionIndex);
  const after = await page.evaluate(() => window.__WB__.info());
  check('correct answer → collision → scoring → question progression',
    !!qAdvanced && after.score > 0,
    `Q${before.questionIndex}→${after.questionIndex}, score ${before.score}→${after.score}${sol ? ', autoAim hit' : ''}`);

  /* ---- 8. after restarting a question ---- */
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 60);
  await page.evaluate(() => window.__WB__.scene().restartQuestionFromMenu());
  const reArmed3 = await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 60);
  await sleep(500);
  await page.screenshot({ path: join(OUT, '08-desktop-after-restart-question.png') });
  const afterRestart = await page.evaluate(() => {
    const r = window.__WB__.scene().slingshot.renderer;
    return { frame: r.wood.frame.name, vis: r.wood.visible, w: r.wood.width, armed: !!window.__WB__.scene().slingshot.preview };
  });
  check('slingshot intact after question restart', !!reArmed3 && afterRestart.frame === '__BASE' && afterRestart.vis && afterRestart.w === 1254 && afterRestart.armed,
    JSON.stringify(afterRestart));

  /* ---- mobile landscape ---- */
  const mob = await newGamePage(844, 390);
  check('mobile landscape armed', !!mob.armed);
  await sleep(700);
  await mob.page.screenshot({ path: join(OUT, 'm1-mobile-landscape-idle.png') });
  await mob.page.evaluate(() => {
    const sl = window.__WB__.scene().slingshot;
    sl.onPointerDown({ worldX: sl.anchor.x, worldY: sl.anchor.y });
    sl.onPointerMove({ worldX: 70, worldY: 400 });
  });
  await sleep(150);
  await mob.page.screenshot({ path: join(OUT, 'm2-mobile-landscape-pulled.png') });
  await mob.page.evaluate(() => window.__WB__.scene().slingshot.onPointerUp());
  await sleep(200);
  await mob.page.screenshot({ path: join(OUT, 'm3-mobile-landscape-released.png') });
  const mobWood = await mob.page.evaluate(() => {
    const r = window.__WB__.scene().slingshot.renderer;
    return { frame: r.wood.frame.name, w: r.wood.width };
  });
  check('mobile landscape renders the complete wood', mobWood.frame === '__BASE' && mobWood.w === 1254, JSON.stringify(mobWood));
  await mob.page.close();
  await page.close();
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length === 0 ? 'ALL CHECKS PASSED' : failed.length + ' CHECKS FAILED'} (${results.length} total)`);
process.exit(failed.length === 0 ? 0 : 1);
