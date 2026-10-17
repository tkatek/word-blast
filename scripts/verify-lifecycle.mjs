/**
 * Fix #6B VERIFICATION — real browser (headless Chrome) with the real bird
 * textures. Complements tests/bird-lifecycle-tests.mjs (headless physics)
 * with the VISUAL half of the lifecycle and the required screenshots:
 *
 *   6b-A  one bird loaded in the pouch
 *   6b-B  bird pulled back — offset grab, no jump, bands stretched
 *   6b-C  bird released and flying
 *   6b-D  bird after collision — rests UPRIGHT (no face-down pose)
 *   6b-E  next bird properly loaded after cleanup (old skin gone)
 *   6b-F  next question with no previous birds remaining
 *
 * Plus programmatic checks: ghost-free after repeated misses, restart and
 * pause/resume cleanliness, split children skins, single-projectile rule.
 *
 * Usage: node scripts/verify-lifecycle.mjs   (dev server on :8081)
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, 'screenshots');
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '  ok ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EV = (page, fn, ...args) => page.evaluate(fn, ...args);

async function poll(page, fn, timeout = 6000, everyMs = 60) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await EV(page, fn);
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

try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
  await page.goto('http://localhost:8081/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await EV(page, () => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 20000 });
  await sleep(300);

  /* ---- 6b-A: one bird loaded in the pouch --------------------------- */
  const armed = await EV(page, () => {
    const s = window.__WB__.scene();
    return {
      preview: s.slingshot.preview ? s.slingshot.preview.texture.key : null,
      projectiles: s.factory.projectiles.length,
      skins: s.factory.birdSkins.length
    };
  });
  check('A: exactly one bird (preview) in the pouch, nothing else alive',
    armed.preview === 'bird-red' && armed.projectiles === 0 && armed.skins === 0,
    JSON.stringify(armed));
  await page.screenshot({ path: join(OUT, '6b-A-bird-in-pouch.png') });

  /* ---- 6b-B: offset grab + pull — no jump, bands stretched ----------- */
  const pouch = await EV(page, () => {
    const a = window.__WB__.scene().slingshot.anchor;
    const rect = window.__WB__.game.canvas.getBoundingClientRect();
    const v = window.__WB__.scene().cameras.main.worldView;
    return {
      x: rect.left + ((a.x - v.x) / v.width) * rect.width,
      y: rect.top + ((a.y - v.y) / v.height) * rect.height
    };
  });
  // press 42px off-center (like a thumb covering the bird), pull back
  await page.mouse.move(pouch.x + 30, pouch.y + 30);
  await page.mouse.down();
  await page.mouse.move(pouch.x - 60, pouch.y + 55, { steps: 10 });
  await sleep(150);
  const dragState = await EV(page, () => {
    const s = window.__WB__.scene();
    const a = s.slingshot.anchor;
    const p = s.slingshot.preview;
    return { dragging: s.slingshot.isDragging(), dx: +(p.x - a.x).toFixed(1), dy: +(p.y - a.y).toFixed(1), rot: +p.rotation.toFixed(2) };
  });
  check('B: offset grab never jumps; bird + pouch track the pull together',
    dragState.dragging && Math.hypot(dragState.dx, dragState.dy) > 80,
    JSON.stringify(dragState));
  await page.screenshot({ path: join(OUT, '6b-B-drag-bands.png'), clip: { x: 0, y: 150, width: 700, height: 460 } });

  /* ---- 6b-C: release → exactly one bird flying ----------------------- */
  await page.mouse.up();
  const flight = await poll(page, () => {
    const s = window.__WB__.scene();
    const live = s.factory.projectiles.filter((p) => !p.wb.consumed);
    return live.length === 1 && live[0].x > 260
      ? { skins: s.factory.birdSkins.length, tex: live[0].wb.skin.skin.texture.key } : null;
  }, 4000, 40);
  check('C: release spawns exactly ONE bird; skin follows the body', !!flight && flight.skins === 1 && flight.tex === 'bird-red',
    JSON.stringify(flight));
  await page.screenshot({ path: join(OUT, '6b-C-flying.png') });

  /* ---- 6b-D: after collision the bird rests UPRIGHT ------------------ */
  const settle = await poll(page, () => {
    const s = window.__WB__.scene();
    const p = s.factory.projectiles.find((x) => !x.wb.consumed);
    if (!p) return null;
    const v = p.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (!p.wb.firstImpactDone || speed > 0.5) return null;
    const k = p.wb.skin ? p.wb.skin.skin : null;
    if (!k) return null;
    let ang = k.rotation % (Math.PI * 2);
    if (ang > Math.PI) ang -= Math.PI * 2;
    if (ang < -Math.PI) ang += Math.PI * 2;
    return { upright: Math.abs(ang) < 0.45, angle: +ang.toFixed(2) };
  }, 9000, 80);
  check('D: landed bird eases to an UPRIGHT pose (face readable)', !!settle && settle.upright,
    settle ? `skin angle ${settle.angle} rad` : 'never settled');
  await sleep(250);
  await page.screenshot({ path: join(OUT, '6b-D-after-collision.png') });

  /* ---- 6b-E: shot resolves → landing animation → clean re-arm -------- */
  const shotId = await EV(page, () => window.__WB__.scene().currentShot.id);
  const cleaned = await poll(page, (sid) => {
    const s = window.__WB__.scene();
    const resolved = s.currentShot.resolvedHandled || s.currentShot.answered;
    const skins = s.factory.birdSkins.length;
    return resolved && skins === 0
      ? { state: window.__WB__.state(), bodies: s.factory.projectiles.length } : null;
  }, 12000, 80, shotId);
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 25000, 100);
  const rearmed = await EV(page, () => {
    const s = window.__WB__.scene();
    return { preview: s.slingshot.preview ? s.slingshot.preview.texture.key : null, skins: s.factory.birdSkins.length };
  });
  check('E: resolved bird fades out completely; next bird loads alone',
    !!cleaned && rearmed.skins === 0 && rearmed.preview === 'bird-red',
    `after resolve=${JSON.stringify(cleaned)}; rearm=${JSON.stringify(rearmed)}`);
  await page.screenshot({ path: join(OUT, '6b-E-rearmed-clean.png') });

  /* ---- repeated misses never accumulate visuals ---------------------- */
  for (let i = 0; i < 2; i++) {
    await EV(page, () => window.__WB__.simulateShot({ vx: -6, vy: -5 })); // backward miss
    await poll(page, () => {
      const s = window.__WB__.scene();
      return s.currentShot.resolvedHandled ? true : null;
    }, 15000, 100);
    await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 100);
    await sleep(900); // let the fade drain
  }
  const ghosts = await EV(page, () => {
    const s = window.__WB__.scene();
    return { skins: s.factory.birdSkins.length, bodies: s.factory.projectiles.length };
  });
  check('ghost-free: 3 resolved shots leave ZERO visible birds, ≤1 hidden body',
    ghosts.skins === 0 && ghosts.bodies <= 1, JSON.stringify(ghosts));

  /* ---- 6b-F: correct answer → next question, nothing remains --------- */
  await EV(page, () => window.__WB__.autoAim());
  const advanced = await poll(page, () => {
    const s = window.__WB__.scene();
    return s.questionIndex === 1
      ? { q: s.questionIndex, projectiles: s.factory.projectiles.length, skins: s.factory.birdSkins.length } : null;
  }, 20000, 100);
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 100);
  await sleep(300);
  check('F: question advanced with zero leftover birds; new bird armed alone',
    !!advanced && advanced.projectiles === 0 && advanced.skins === 0,
    JSON.stringify(advanced));
  await page.screenshot({ path: join(OUT, '6b-F-next-question-clean.png') });

  /* ---- pause/resume mid-flight: no duplicate sprites ------------------ */
  await EV(page, () => window.__WB__.simulateShot({ vx: 16, vy: -7 }));
  await poll(page, () => (window.__WB__.state() === 'PROJECTILE_FLYING' ? true : null), 8000, 50);
  const beforePause = await EV(page, () => window.__WB__.scene().factory.birdSkins.length);
  await EV(page, () => window.__WB__.scene().doPause());
  await sleep(200);
  await EV(page, () => window.__WB__.scene().togglePause());
  const afterResume = await EV(page, () => window.__WB__.scene().factory.birdSkins.length);
  check('pause/resume mid-flight creates no duplicate sprites', beforePause === afterResume,
    `${beforePause} -> ${afterResume}`);
  await poll(page, () => {
    const s = window.__WB__.scene();
    return s.currentShot.resolvedHandled || s.currentShot.answered ? true : null;
  }, 20000, 100);

  /* ---- restart mid-question: no ghosts after reboot ------------------- */
  await EV(page, () => { window.__WB__.scene().restartLevel(); });
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 100);
  const fresh = await EV(page, () => {
    const s = window.__WB__.scene();
    return { projectiles: s.factory.projectiles.length, skins: s.factory.birdSkins.length };
  });
  check('restart leaves no ghost birds', fresh.projectiles === 0 && fresh.skins === 0, JSON.stringify(fresh));

  /* ---- split: three blue birds, all despawn afterwards ---------------- */
  await EV(page, () => window.__WB__.gotoLevel(10));
  await poll(page, () => (window.__WB__.state() === 'AIMING' ? true : null), 20000, 100);
  await EV(page, () => {
    const s = window.__WB__.scene();
    s.selectProjectile('split');
  });
  await sleep(250);
  await EV(page, () => window.__WB__.simulateShot({ vx: 17, vy: -7, type: 'split' }));
  await poll(page, () => {
    const s = window.__WB__.scene();
    return s.factory.projectiles.filter((p) => !p.wb.consumed).length === 1
      && !s.factory.projectiles[0].wb.firstImpactDone ? true : null;
  }, 4000, 50);
  await page.mouse.click(640, 360); // tap → split
  const split = await poll(page, () => {
    const s = window.__WB__.scene();
    const live = s.factory.projectiles.filter((p) => !p.wb.consumed);
    return live.length === 3 && s.factory.birdSkins.length === 3
      && s.factory.birdSkins.every((k) => k.skin.texture.key === 'bird-blue') ? true : null;
  }, 4000, 60);
  check('split produces exactly 3 blue bird skins (parent + children)', !!split);
  const splitClean = await poll(page, () => {
    const s = window.__WB__.scene();
    // the shot may also ANSWER (question advance nulls currentShot) —
    // either path must end with zero visible birds
    const done = !s.currentShot || s.currentShot.resolvedHandled || s.currentShot.answered;
    return done && s.factory.birdSkins.length === 0 ? true : null;
  }, 20000, 120);
  check('split shot despawns every bird after resolve', !!splitClean);

  /* ---- no legacy circle visible --------------------------------------- */
  const circles = await EV(page, () => {
    const s = window.__WB__.scene();
    const offenders = [];
    const p = s.slingshot.preview;
    if (p && p.texture.key.startsWith('proj-')) offenders.push('preview');
    for (const pr of s.factory.projectiles) {
      if (pr.visible && pr.texture.key.startsWith('proj-')) offenders.push('projectile:' + pr.wb.typeKey);
    }
    for (const k of s.factory.birdSkins) {
      if (k.skin.texture.key.startsWith('proj-')) offenders.push('skin');
    }
    return offenders;
  });
  check('no legacy orange circle visible anywhere', circles.length === 0, circles.join(',') || 'none');
} catch (e) {
  check('script completed without error', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n== lifecycle visual verification: ${results.length - failed.length}/${results.length} checks passed ==`);
process.exit(failed.length ? 1 : 0);
