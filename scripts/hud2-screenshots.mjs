/**
 * HUD artwork-integration acceptance run — boots the REAL built game
 * (vite build output served over HTTP) in Chrome/Edge and verifies +
 * captures the supplied-artwork top bar:
 *
 *   viewports: 1920×1080, 1366×768, 1024×768, 1280×800, 844×390, 667×375
 *   states:    desktop/tablet/phone HUD, 1 heart, large score, muted,
 *              question card docked below the HUD, pause menu, camera-shake
 *              stability, HUD-tap isolation (pause tap must not fire a bird)
 *
 * Run:  node scripts/hud2-screenshots.mjs [http://host:port]
 * (defaults to the vite preview server on :4173)
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Byte-identical comparison of two screenshot buffers (same clip). */
async function sharpDiff(a, b) {
  if (a.length !== b.length) return false;
  const [ra, rb] = await Promise.all([
    sharp(a).raw().toBuffer(),
    sharp(b).raw().toBuffer()
  ]);
  if (ra.length !== rb.length) return false;
  let diff = 0;
  for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) diff++;
  return diff === 0; // exact: HUD strip must not move a single pixel
}

const root = dirname(fileURLToPath(import.meta.url));
const OUT = join(root, '..', 'screenshots', 'hud2');
mkdirSync(OUT, { recursive: true });

const BASE = process.argv[2] || 'http://127.0.0.1:4173';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];
const ok = (cond, msg) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) problems.push(msg);
};

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe` : null
  ].filter(Boolean);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

async function newPage(browser, { w, h, mobile = false, touch = false }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: mobile, hasTouch: touch });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  return page;
}

async function gotoGameScene(page, levelId = 3) {
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 30000 });
  await page.evaluate((id) => window.__WB__.gotoLevel(id), levelId);
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));
  await sleep(700); // arming + entrance tweens settle
}

/** HUD geometry probes inside the live scene. */
async function hudProbe(page) {
  return page.evaluate(() => {
    const s = window.__WB__.scene();
    const hud = s.hud;
    const cardTop = 158 - (620 * (484 / 2082)) / 2; // config QUESTION_CARD.TOP
    const main = s.cameras.main;
    return {
      barBottom: hud.barBottom,
      cardTop,
      uiCamExists: !!hud.uiCam && hud.uiCam !== main,
      // structural shake isolation: the HUD tree must NOT render on the
      // gameplay camera (cameraFilter bit set for that camera's id)
      mainIgnoresHud: (hud.root.cameraFilter & main.id) !== 0,
      levelPanelTex: hud.levelPanel.texture.key,
      progressTex: hud.progressPanel.texture.key,
      pauseTex: hud.pauseBtn.list[0].texture.key,
      // every artwork PNG actually fetched over HTTP (no silent fallback)
      fetchedHudPngs: performance.getEntriesByType('resource')
        .filter((r) => r.name.includes('/assets/images/ui/hud/')).length
    };
  });
}

const main = async () => {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome/Edge executable found');
  console.log('browser:', exe);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--use-angle=default', '--disable-gpu-sandbox', '--mute-audio']
  });

  /* ---------------- desktop 1920×1080 ---------------- */
  {
    const page = await newPage(browser, { w: 1920, h: 1080 });
    await gotoGameScene(page, 3);
    const probe = await hudProbe(page);
    ok(probe.uiCamExists, 'dedicated HUD camera exists alongside the gameplay camera');
    ok(probe.mainIgnoresHud, 'gameplay camera does not render the HUD tree (shake isolation)');
    ok(probe.levelPanelTex === 'hud-level-panel', 'level panel uses supplied artwork');
    ok(probe.progressTex === 'hud-progress-panel', 'progress panel uses supplied artwork');
    ok(probe.pauseTex === 'hud-pause-btn', 'pause button uses supplied artwork');
    ok(probe.fetchedHudPngs === 7, `all 7 HUD PNGs fetched over HTTP (${probe.fetchedHudPngs})`);
    ok(probe.barBottom + 4 <= probe.cardTop, `HUD band (${probe.barBottom}) clears the card top (${probe.cardTop.toFixed(0)})`);
    await page.screenshot({ path: join(OUT, '1-desktop-1920x1080.png') });

    // camera-shake stability, proven on PIXELS: clip the HUD strip before and
    // mid-shake and require an identical bitmap (the world around it moves).
    const zoom = await page.evaluate(() => window.__WB__.scene().cameras.main.zoom);
    const clip = { x: 0, y: 0, width: Math.floor(1280 * zoom), height: Math.ceil(84 * zoom) };
    const calm = await page.screenshot({ clip });
    await page.evaluate(() => {
      const s = window.__WB__.scene();
      s.fx.shakeForImpact(160, 0.02); // stronger than the capped gameplay shake
    });
    await sleep(90); // mid-shake
    const shaking = await page.screenshot({ clip });
    const worldMoved = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return s.cameras.main.shakeEffect ? s.cameras.main.shakeEffect.isRunning : true;
    });
    const identical = await sharpDiff(calm, shaking);
    await page.screenshot({ path: join(OUT, '2-desktop-shake.png') });
    ok(worldMoved, 'gameplay camera shake actually ran during the probe');
    ok(identical, 'HUD bitmap identical before vs mid-shake');
    await sleep(400); // let the shake finish

    // pause via the real button coordinates — must open the menu, not fire
    const pauseXY = await page.evaluate(() => {
      const b = window.__WB__.scene().hud.pauseBtn;
      const cam = window.__WB__.scene().cameras.main;
      const scale = cam.zoom / (window.devicePixelRatio || 1);
      return { x: (b.x - cam.worldView.x) * cam.zoom, y: (b.y - cam.worldView.y) * cam.zoom };
    });
    const shotsBefore = await page.evaluate(() => window.__WB__.scene().shotsLeft);
    await page.mouse.click(pauseXY.x, pauseXY.y);
    await sleep(400);
    const paused = await page.evaluate(() => window.__WB__.scene().stateMachine.isPaused());
    ok(paused, 'pause-button click opens the existing pause flow');
    const shotsAfter = await page.evaluate(() => window.__WB__.scene().shotsLeft);
    ok(shotsBefore === shotsAfter, 'pause-button tap did not fire or activate a bird');
    await page.screenshot({ path: join(OUT, '3-desktop-pause-menu.png') });

    // resume first — the sound button sits under the pause scrim while open
    await page.keyboard.press('KeyP');
    await sleep(350);
    const resumed = await page.evaluate(() => !window.__WB__.scene().stateMachine.isPaused());
    ok(resumed, 'P resumes the existing pause flow');

    // sound button toggles the real setting
    const sndXY = await page.evaluate(() => {
      const b = window.__WB__.scene().hud.soundBtn;
      const cam = window.__WB__.scene().cameras.main;
      return { x: (b.x - cam.worldView.x) * cam.zoom, y: (b.y - cam.worldView.y) * cam.zoom };
    });
    await page.mouse.click(sndXY.x, sndXY.y);
    await sleep(150);
    const soundAfter = await page.evaluate(() => window.__WB__.save().data.settings.sound);
    const icoKey = await page.evaluate(() => window.__WB__.scene().hud.soundIco.texture.key);
    ok(soundAfter === false && icoKey === 'wbhud-sound-off', 'sound button mutes + swaps the icon');
    await page.screenshot({ path: join(OUT, '4-desktop-muted.png') });
    await page.mouse.click(sndXY.x, sndXY.y); // restore
    await sleep(150);
    await page.close();
  }

  /* ---------------- laptop / tablets ---------------- */
  for (const [w, h, name] of [[1366, 768, 'laptop'], [1280, 800, 'tablet-1280'], [1024, 768, 'tablet-1024']]) {
    const page = await newPage(browser, { w, h });
    await gotoGameScene(page, 3);
    await page.screenshot({ path: join(OUT, `5-${name}-${w}x${h}.png`) });
    await page.close();
  }

  /* ---------------- phone landscape ---------------- */
  for (const [w, h, name] of [[844, 390, 'phone'], [667, 375, 'phone-small']]) {
    const page = await newPage(browser, { w, h, mobile: true, touch: true });
    await gotoGameScene(page, 3);
    const probe = await hudProbe(page);
    ok(probe.barBottom + 4 <= probe.cardTop, `(${name}) HUD band clears the card top`);
    await page.screenshot({ path: join(OUT, `6-${name}-${w}x${h}.png`) });
    // 44 CSS px touch target check against the real zoom
    const css = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const zoom = s.cameras.main.zoom;
      return { pause: s.hud.layout.elements.pause.hit * zoom, zoom };
    });
    ok(css.pause >= 44, `(${name}) pause hit-box ${css.pause.toFixed(1)} CSS px (zoom ${css.zoom.toFixed(2)})`);
    await page.close();
  }

  /* ---------------- 1 heart + large score + card dock (desktop) ----- */
  {
    const page = await newPage(browser, { w: 1366, h: 768 });
    await gotoGameScene(page, 3);
    await page.evaluate(() => {
      const s = window.__WB__.scene();
      // drive the REAL systems: lose two hearts through the failure funnel
      s.hearts.charge(); s.hearts.clearCharge();
      s.hearts.charge(); s.hearts.clearCharge();
      s.scoring.liveScore = () => 123450; // display-only probe of a large score
      s.refreshHUD();
    });
    await sleep(600);
    const hearts = await page.evaluate(() => window.__WB__.scene().hearts.remaining);
    ok(hearts === 1, 'one-heart state renders from the authoritative value');
    await page.screenshot({ path: join(OUT, '7-desktop-one-heart-big-score.png') });
    await page.evaluate(() => {
      const s = window.__WB__.scene();
      delete s.scoring.liveScore; // restore the real funnel
      s.refreshHUD();
    });
    // question card docked below the HUD (top resting spot)
    const dock = await page.evaluate(() => {
      const s = window.__WB__.scene();
      const card = s.card.root;
      const hudBottom = s.hud.barBottom;
      const cardTopWorld = card.y - (card.displayHeight / 2) * card.scaleY;
      return { hudBottom, cardTopWorld, phase: s.card.phase };
    });
    ok(dock.phase === 'READY_TOP', 'question card reached its top resting spot');
    ok(dock.cardTopWorld >= dock.hudBottom + 4,
      `card top ${dock.cardTopWorld.toFixed(0)} sits below HUD bottom ${dock.hudBottom} with a gap`);
    await page.screenshot({ path: join(OUT, '8-desktop-card-docked.png') });

    // resize robustness: no duplicate panels, HUD intact
    await page.setViewport({ width: 1024, height: 768 });
    await sleep(600);
    const recount = await page.evaluate(() => {
      const s = window.__WB__.scene();
      return {
        levelPanels: s.hud.root.list.filter((o) => o.texture && o.texture.key === 'hud-level-panel').length,
        timerTexts: s.hud.root.list.filter((o) => o.text === s.hud.timerText.text && o !== s.hud.timerText).length,
        timer: s.levelTimer.remainingMs
      };
    });
    ok(recount.levelPanels === 1 && recount.timerTexts === 0, 'resize created no duplicate panels/counters');
    ok(recount.timer > 0, 'resize did not reset the level timer');
    await page.screenshot({ path: join(OUT, '9-desktop-after-resize.png') });
    await page.close();
  }

  await browser.close();

  console.log('\n== hud2 acceptance =========================================');
  if (problems.length) {
    console.log(`PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(' -', p);
    process.exit(1);
  }
  console.log('all checks passed');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
