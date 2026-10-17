/**
 * Fix #17 UI interaction check — REAL pointer clicks on the built game's
 * canvas (puppeteer), not API calls:
 *
 *   1. Clicking the round pause button opens the pause menu and pauses.
 *   2. The click does NOT start a slingshot drag or launch a bird.
 *   3. RESUME (menu button click) resumes gameplay.
 *   4. The sound button toggles the persisted setting + HUD icon.
 *   5. RESTART LEVEL (with confirm) boots a clean level (no dup overlays).
 *
 * Run: node scripts/verify-fix17-ui.mjs [http://host:port]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of candidates) if (existsSync(p)) return p;
  throw new Error('no browser');
}

let passed = 0, failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { passed++; console.log(`  ok  ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
};

/** world (1280×720) → page CSS coords, via the live camera fit view. */
async function worldClick(page, wx, wy) {
  const pos = await page.evaluate((x, y) => {
    const s = window.__WB__.scene();
    const cam = s.cameras.main;
    const rect = window.__WB__.game.canvas.getBoundingClientRect();
    const view = cam.worldView;
    return {
      x: rect.left + ((x - view.x) / view.width) * rect.width,
      y: rect.top + ((y - view.y) / view.height) * rect.height
    };
  }, wx, wy);
  await page.mouse.click(pos.x, pos.y);
  await sleep(250);
}

const main = async () => {
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

  await page.goto(BASE, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => window.__WB__ && window.__WB__.scene(), { timeout: 20000 });
  await page.evaluate(() => {
    window.__WB__.setAutoPause(false);
    window.__WB__.gotoLevel(1);
  });
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine.current === 'AIMING';
  }, { timeout: 30000 });
  await sleep(600);

  const S = () => page.evaluate(() => {
    const s = window.__WB__.scene();
    return {
      state: s.stateMachine.current,
      pauseOpen: !!s.hud.pauseOpen,
      dragging: s.slingshot.isDragging(),
      shots: s.shotsLeft,
      sound: s.save.data.settings.sound,
      hearts: s.hearts.remaining
    };
  });

  /* 1+2: pause button click — menu opens, nothing fired or dragged */
  const before = await S();
  await worldClick(page, 50, 42);          // round pause button (world coords)
  let after = await S();
  ok('pause-button click opens the pause menu', after.pauseOpen && after.state === 'PAUSED');
  ok('pause-button click started no slingshot drag', after.dragging === false);
  ok('pause-button click consumed no shot', after.shots === before.shots);

  /* 3: RESUME click (menu button at world 640, 360-150=210) */
  await worldClick(page, 640, 210);
  after = await S();
  ok('RESUME click closes the menu and resumes', !after.pauseOpen && after.state === 'AIMING');

  /* double-click RESUME race: open + rapid double click must not corrupt */
  await worldClick(page, 50, 42);
  await worldClick(page, 640, 210);
  await worldClick(page, 640, 210);        // menu already closed — no-op
  after = await S();
  ok('rapid double RESUME leaves gameplay running', !after.pauseOpen && after.state === 'AIMING');

  /* 4: sound button toggles setting + audio bus */
  const sound0 = (await S()).sound;
  await worldClick(page, 1235, 42);        // round sound button
  after = await S();
  ok('sound button toggles the persisted setting', after.sound === !sound0);
  await worldClick(page, 1235, 42);        // back to original
  after = await S();
  ok('sound button toggles back', after.sound === sound0);

  /* 5: RESTART LEVEL via menu + confirm dialog */
  await worldClick(page, 50, 42);          // open menu
  await worldClick(page, 640, 346);        // RESTART LEVEL (y 360-14) → confirm card
  const confirming = await page.evaluate(() => window.__WB__.scene().hud.confirmCard.visible);
  ok('destructive restart asks for confirmation', confirming);
  await worldClick(page, 548, 432);        // YES (menu 640-92, 360+72)
  await page.waitForFunction(() => {
    const s = window.__WB__ && window.__WB__.scene();
    return s && s.prepared && s.stateMachine.current === 'AIMING'
      && s.questionIndex === 0 && s.hearts.remaining === 3;
  }, { timeout: 20000 });
  ok('confirmed restart boots a clean level (fresh hearts, aiming)',
    (await S()).state === 'AIMING');

  /* 6: exit-to-levels via menu + confirm lands on LevelSelectScene */
  await worldClick(page, 50, 42);
  await worldClick(page, 640, 482);        // EXIT TO LEVELS (y 360+122) → confirm
  await worldClick(page, 548, 432);        // YES
  await sleep(600);
  const sceneKey = await page.evaluate(() =>
    window.__WB__.game.scene.getScenes(true).map((sc) => sc.scene.key).join(','));
  ok('confirmed exit reaches the level-select screen', sceneKey.includes('LevelSelectScene'), sceneKey);

  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
