/**
 * Fix #6 verification — drives the REAL game in headless Chrome and
 * captures the bird integration at every stage:
 *   01 red bird seated in the slingshot            (level 1)
 *   02 bird dragged back — bands, pouch, tilt, dots (real mouse drag)
 *   03 bird flying toward a tower
 *   04 bird colliding with the structure / answer flow
 *   05 yellow bird speed-boost trail               (level 4)
 *   06 purple bird freeze burst                    (level 7)
 *   07 blue bird split into three                  (level 10)
 *   08 black bird explosion                        (level 12)
 *   09 mobile-landscape rendering                  (844×390, level 1)
 *
 * Also asserts programmatically: all six textures loaded, no visible
 * 'proj-*' circle texture on any live projectile/slingshot preview,
 * skins stay centered on their physics bodies, shots are consumed and
 * questions advance.
 *
 * Usage: node scripts/verify-birds.mjs [url]     (default :8081)
 * Requires the dev server (npm run dev) and Google Chrome.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'screenshots');
const URL_BASE = process.argv[2] || 'http://localhost:8081/';
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll a page expression until it returns truthy (or timeout → last value). */
async function poll(page, exprFn, timeout = 4000, everyMs = 60) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await page.evaluate(exprFn);
    if (last) return last;
    await sleep(everyMs);
  }
  return last;
}

async function waitForState(page, state, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate((st) => window.__WB__.state() === st, state)) return;
    await sleep(100);
  }
  const s = await page.evaluate(() => window.__WB__.state());
  throw new Error(`waitForState(${state}) timed out; state=${s}`);
}

async function shot(page, name) {
  await page.screenshot({ path: join(OUT, name) });
  console.log(`  📸 ${name}`);
}

/** Real-mouse slingshot drag: press at pouch, pull back, hold (no release). */
async function dragBack(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    await sleep(16);
  }
}

/** Launch the selected projectile via the game's own inverse solver. */
async function autoAimLaunch(page) {
  await page.evaluate(() => window.__WB__.autoAim());
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-background-timer-throttling'],
  defaultViewport: { width: 1280, height: 720 }
});

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('bird') || t.includes('[Boot]')) console.log('  [console]', t.slice(0, 160));
  });
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await page.evaluate(() => window.__WB__.setAutoPause(false));

  /* ---- texture + registry assertions ------------------------------- */
  const tex = await page.evaluate(() => {
    const g = window.__WB__.game;
    const out = {};
    for (const k of ['bird-red', 'bird-blue', 'bird-yellow', 'bird-black', 'bird-purple', 'bird-green']) {
      const t = g.textures.exists(k) ? g.textures.get(k).getSourceImage() : null;
      out[k] = t ? `${t.width}x${t.height}` : 'MISSING';
    }
    return out;
  });
  check('all six bird textures loaded', Object.values(tex).every((v) => v !== 'MISSING'), JSON.stringify(tex));

  /* ---- 01: red bird in the slingshot (level 1) ---------------------- */
  await page.evaluate(() => window.__WB__.gotoLevel(1));
  await waitForState(page, 'AIMING');
  await sleep(350);
  const preview1 = await page.evaluate(() => {
    const p = window.__WB__.scene().slingshot.preview;
    return p ? { tex: p.texture.key, w: +p.displayWidth.toFixed(1) } : null;
  });
  check('slingshot preview is the red bird', preview1 && preview1.tex === 'bird-red', JSON.stringify(preview1));
  await shot(page, '01-red-bird-slingshot.png');

  /* ---- 02: drag back — bands + pouch + tilt + trajectory dots ------- */
  const coords = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const v = s.cameras.main.worldView;
    const rect = window.__WB__.game.canvas.getBoundingClientRect();
    const toClient = (wx, wy) => ({
      x: Math.round(rect.left + ((wx - v.x) / v.width) * rect.width),
      y: Math.round(rect.top + ((wy - v.y) / v.height) * rect.height)
    });
    return { pouch: toClient(195, 346), pull: toClient(78, 430) };
  });
  await dragBack(page, coords.pouch, coords.pull);
  await sleep(120);
  const dragState = await page.evaluate(() => {
    const p = window.__WB__.scene().slingshot.preview;
    return { dragging: window.__WB__.scene().slingshot.isDragging(), x: +p.x.toFixed(0), y: +p.y.toFixed(0), rot: +p.rotation.toFixed(2) };
  });
  check('drag pulls the bird with the pouch', dragState.dragging && dragState.x < 130 && dragState.y > 400,
    JSON.stringify(dragState));
  await shot(page, '02-bird-dragged-back.png');

  /* ---- 03: release → mid-flight ------------------------------------ */
  await page.mouse.up();
  const flight = await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    return ps.length && ps[0].x > 320 && ps[0].x < 900
      ? ps.map((p) => ({ type: p.wb.typeKey, x: +p.x.toFixed(0), y: +p.y.toFixed(0) })) : null;
  }, 4000, 40);
  check('red bird launched and flying', !!flight && flight[0].type === 'basic' && flight[0].x > 200,
    JSON.stringify(flight));
  const skinSync = await page.evaluate(() => {
    const p = window.__WB__.scene().factory.projectiles[0];
    if (!p || !p.wb.skin) return null;
    const k = p.wb.skin.skin;
    return { dx: Math.abs(k.x - p.x), dy: Math.abs(k.y - p.y), tex: k.texture.key, rot: +k.rotation.toFixed(2) };
  });
  check('skin centered on physics body', skinSync && skinSync.dx < 0.01 && skinSync.dy < 0.01 && skinSync.tex === 'bird-red',
    JSON.stringify(skinSync));
  await shot(page, '03-bird-flying.png');

  /* ---- 04: let it land / answer ------------------------------------ */
  await sleep(3500);
  const after = await page.evaluate(() => {
    const i = window.__WB__.info();
    return { state: window.__WB__.state(), shotsUsed: i.shotsUsed, q: i.questionIndex, score: i.score };
  });
  check('shot consumed and game advanced normally',
    after.shotsUsed === 1 && ['AIMING', 'ANSWER_FEEDBACK', 'PHYSICS_RESOLVING', 'NEXT_QUESTION', 'QUESTION_READY'].includes(after.state),
    JSON.stringify(after));
  await shot(page, '04-after-collision.png');

  /* ---- 05: yellow speed boost (level 4) ----------------------------- */
  await page.evaluate(() => window.__WB__.gotoLevel(4));
  await waitForState(page, 'AIMING');
  await page.evaluate(() => window.__WB__.scene().selectProjectile('speed'));
  await sleep(250);
  await autoAimLaunch(page);
  await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    return ps.length && !ps[0].wb.firstImpactDone ? true : null;
  }, 2500);
  await page.mouse.click(640, 360); // tap while flying → boost
  const boostUsed = await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    return ps.some((p) => p.wb.typeKey === 'speed' && p.wb.abilityUsed)
      ? ps.map((p) => ({ type: p.wb.typeKey, used: p.wb.abilityUsed })) : null;
  }, 2500);
  check('yellow bird boost activated', !!boostUsed, JSON.stringify(boostUsed));
  await sleep(120);
  await shot(page, '05-yellow-boost.png');
  await sleep(2500);

  /* ---- 06: purple freeze (level 7) ---------------------------------- */
  await page.evaluate(() => window.__WB__.gotoLevel(7));
  await waitForState(page, 'AIMING');
  await page.evaluate(() => window.__WB__.scene().selectProjectile('ice'));
  await sleep(250);
  await autoAimLaunch(page);
  const froze = await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    return ps.some((p) => p.wb.typeKey === 'ice' && p.wb.firstImpactDone) ? true : null;
  }, 5000);
  await sleep(100); // let the burst particles render a couple frames
  await shot(page, '06-purple-freeze.png');
  check('purple bird freeze triggered on first impact', !!froze);
  await sleep(2500);

  /* ---- 07: blue split (level 10) ------------------------------------ */
  await page.evaluate(() => window.__WB__.gotoLevel(10));
  await waitForState(page, 'AIMING');
  await page.evaluate(() => window.__WB__.scene().selectProjectile('split'));
  await sleep(250);
  await autoAimLaunch(page);
  await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    return ps.length && !ps[0].wb.firstImpactDone ? true : null;
  }, 2500);
  await page.mouse.click(640, 360); // tap while flying → split
  const split = await poll(page, () => {
    const ps = window.__WB__.scene().factory.projectiles;
    if (ps.length !== 3) return null;
    const spread = Math.max(...ps.map((p) => p.x)) - Math.min(...ps.map((p) => p.x));
    return spread > 26 ? ps.map((p) => ({
      type: p.wb.typeKey, x: +p.x.toFixed(0),
      skin: p.wb.skin ? p.wb.skin.skin.texture.key : null,
      w: p.wb.skin ? +p.wb.skin.skin.displayWidth.toFixed(0) : null
    })) : null;
  }, 2500);
  check('blue bird split into parent + two children', !!split
    && split.filter((p) => p.type === 'split-child').length === 2
    && split.every((p) => p.skin === 'bird-blue'),
    JSON.stringify(split));
  await shot(page, '07-blue-split.png');
  await sleep(2500);

  /* ---- 08: black bomb (level 12) ------------------------------------ */
  await page.evaluate(() => window.__WB__.gotoLevel(12));
  await waitForState(page, 'AIMING');
  await page.evaluate(() => {
    // instrument the explosion so the screenshot catches the flash frame
    const fx = window.__WB__.scene().fx;
    window.__boom = { fired: false, x: 0, y: 0, t: 0 };
    const orig = fx.explosion.bind(fx);
    fx.explosion = (x, y) => { window.__boom = { fired: true, x, y, t: performance.now() }; return orig(x, y); };
  });
  await page.evaluate(() => window.__WB__.scene().selectProjectile('bomb'));
  await sleep(250);
  await autoAimLaunch(page);
  const boom = await poll(page, () => (window.__boom && window.__boom.fired ? window.__boom : null), 6000, 40);
  await sleep(60); // flash + ring are 260-330ms — catch them mid-play
  await shot(page, '08-black-explosion.png');
  check('black bird detonated (explosion VFX fired)', !!boom, JSON.stringify(boom));
  await sleep(2000);

  /* ---- 09: mobile landscape (844×390) -------------------------------- */
  await page.evaluate(() => window.__WB__.gotoLevel(1));
  await waitForState(page, 'AIMING');
  await page.setViewport({ width: 844, height: 390 });
  await sleep(900); // resize + orientation handling
  const mob = await page.evaluate(() => {
    const p = window.__WB__.scene().slingshot.preview;
    return { state: window.__WB__.state(), preview: p ? p.texture.key : null, w: p ? +p.displayWidth.toFixed(0) : null };
  });
  check('mobile landscape keeps the bird in the slingshot',
    mob.state === 'AIMING' && mob.preview === 'bird-red', JSON.stringify(mob));
  await shot(page, '09-mobile-landscape.png');

  /* ---- no legacy circle visible anywhere ----------------------------- */
  const circles = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const offenders = [];
    const p = s.slingshot.preview;
    if (p && p.texture.key.startsWith('proj-')) offenders.push('preview:' + p.texture.key);
    for (const pr of s.factory.projectiles) {
      if (pr.visible && pr.texture.key.startsWith('proj-')) offenders.push('projectile:' + pr.texture.key);
      if (pr.wb.skin && pr.wb.skin.skin.texture.key.startsWith('proj-')) offenders.push('skin:' + pr.wb.skin.skin.texture.key);
    }
    return offenders;
  });
  check('no legacy orange circle visible in gameplay', circles.length === 0, circles.join(',') || 'none');
} catch (e) {
  check('script completed without error', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== bird verification: ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(failed.length ? 1 : 0);
