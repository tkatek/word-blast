/**
 * Collider-equivalence proof for Fix #6: create each bird projectile via
 * the REAL factory in the running browser and compare its Matter body
 * geometry against the legacy circle path values (circumradius must equal
 * PROJECTILE_TYPES radius; area/mass must match a circle body built the
 * old way at the same final radius).
 */
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--no-sandbox'],
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
  const r = await page.evaluate(() => {
    const s = window.__WB__.scene();
    const out = {};
    for (const [key, radius] of [['basic', 16], ['speed', 15], ['ice', 15], ['split', 17], ['bomb', 17]]) {
      const go = s.factory.createProjectile(key, 400, 200, 999);
      const b = go.body;
      const w = b.bounds.max.x - b.bounds.min.x;
      const v0 = b.vertices[0];
      const vr = Math.hypot(v0.x - b.position.x, v0.y - b.position.y);
      out[key] = {
        vertexRadius: +vr.toFixed(3),
        boundsW: +w.toFixed(2),
        expected: radius,
        mass: +b.mass.toFixed(3)
      };
      s.factory.remove(go);
    }
    // legacy-path comparison: same final radius built the old way (40px
    // texture, shape radius 20, display 2r) with the REAL per-type density
    const legacy = {};
    const densities = { basic: 0.0025, bomb: 0.0028 };
    for (const [key, radius] of [['basic', 16], ['bomb', 17]]) {
      const g2 = s.matter.add.image(400, 200, 'proj-basic', undefined, {
        shape: { type: 'circle', radius: 20 }, density: densities[key]
      });
      g2.setDisplaySize(radius * 2, radius * 2);
      const b2 = g2.body;
      const v20 = b2.vertices[0];
      legacy[key] = {
        vertexRadius: +Math.hypot(v20.x - b2.position.x, v20.y - b2.position.y).toFixed(3),
        mass: +b2.mass.toFixed(3)
      };
      g2.destroy();
    }
    return { bird: out, legacy };
  });
  console.log(JSON.stringify(r, null, 1));
} finally {
  await browser.close();
}
