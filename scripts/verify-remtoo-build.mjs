/**
 * remtoo.net build verification — serves dist/ under the REAL deployment
 * prefix /soufiane/word-blast/ (like https://remtoo.net/soufiane/word-blast/)
 * and asserts:
 *   - HTML + compiled bundles load with the /soufiane/word-blast/ base (no 404s),
 *   - no "Failed to resolve module specifier" page errors (the symptom of
 *     serving the uncompiled root instead of this build),
 *   - Phaser boots, the menu appears, textures exist,
 *   - a level starts (AIMING) and the slingshot preview is ready.
 *
 * Run AFTER `npm run build:remtoo` (which builds with --base=/soufiane/word-blast/).
 * Mirrors scripts/verify-pages-build.mjs (the GitHub Pages variant).
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(ROOT, 'dist');
const PREFIX = '/soufiane/word-blast/';
const PORT = 8092;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json',
  '.ico': 'image/x-icon', '.map': 'application/json', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json'
};

const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(PREFIX)) { res.writeHead(404).end('prefix only'); return; }
  let rel = url.slice(PREFIX.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(DIST, rel));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found: ' + rel);
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].find((p) => existsSync(p)),
  headless: true,
  args: ['--no-sandbox'],
  defaultViewport: { width: 1280, height: 720 }
});
let ok = true;
try {
  const page = await browser.newPage();
  const bad = [];
  const pageErrors = [];
  page.on('response', (r) => { if (r.status() >= 400 && !r.url().includes('favicon')) bad.push(r.status() + ' ' + r.url()); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}${PREFIX}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const g = window.__WB__ && window.__WB__.game;
    return g && g.scene.isActive('MenuScene') && g.textures.exists('bird-red');
  }, { timeout: 30000 });
  await page.evaluate(() => { window.__WB__.setAutoPause(false); window.__WB__.gotoLevel(1); });
  await page.waitForFunction(() => window.__WB__.state() === 'AIMING', { timeout: 15000 });
  const tex = await page.evaluate(() => {
    const g = window.__WB__.game;
    return ['bird-red', 'bird-blue', 'bird-yellow', 'bird-black', 'bird-purple', 'bird-green']
      .every((k) => g.textures.exists(k));
  });
  const preview = await page.evaluate(() => {
    const p = window.__WB__.scene().slingshot.preview;
    return p ? p.texture.key : null;
  });
  const buildId = await page.evaluate(() => document.documentElement.dataset.wbBuild || '(none)');
  await page.screenshot({ path: join(ROOT, 'screenshots', '12-remtoo-base-build.png') });
  const moduleErrors = pageErrors.filter((e) => /module specifier|Failed to fetch dynamically imported/.test(e));
  console.log(`remtoo-base boot under ${PREFIX}: textures=${tex}, preview=${preview}, build=${buildId}`);
  console.log(`http errors=[${bad.join(' | ')}] page errors=[${pageErrors.join(' | ')}]`);
  ok = tex && preview === 'bird-red' && bad.length === 0 && moduleErrors.length === 0;
} catch (e) {
  ok = false;
  console.error('FAILED:', String(e).slice(0, 300));
} finally {
  await browser.close();
  server.close();
}
console.log(ok ? '== remtoo.net base build verification PASSED ==' : '== remtoo.net base build verification FAILED ==');
process.exit(ok ? 0 : 1);
