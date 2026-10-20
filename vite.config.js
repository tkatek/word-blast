import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pkgRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Build identity — "<version>+<git-short-hash>@<timestamp>". Surfaced by
 * js/build-info.js, printed to the console at startup and shown in the
 * ?diag=1 diagnostics panel, so a stale phone deployment (or an uncompiled
 * root served by mistake) is recognizable at a glance on the real device.
 */
function buildId() {
  let version = '0';
  try { version = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version || '0'; } catch (e) { /* keep */ }
  let hash = 'no-git';
  try { hash = execSync('git rev-parse --short HEAD', { cwd: pkgRoot }).toString().trim(); } catch (e) { /* keep */ }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16); // YYYY-MM-DD-HH-MM (UTC)
  return `${version}+${hash}@${stamp}`;
}

// Asset base path for the PRODUCTION build.
//   default './'        → portable relative URLs: works when dist/ is served
//                          by VS Code Live Server, any static host, or any
//                          subdirectory (verified by scripts/verify-build.mjs).
//   VITE_BASE env var   → absolute deployment prefix, e.g. '/word-blast/' for
//                          GitHub Pages CI (npm run build:pages) or a future
//                          Boston English Center game route.
// Runtime asset URLs in js/scenes/BootScene.js use import.meta.env.BASE_URL,
// so the same source tree serves every target without code changes.
export default defineConfig({
  root: __dirname,
  base: process.env.VITE_BASE || './',
  define: {
    __WB_BUILD_ID__: JSON.stringify(buildId())
  },
  server: {
    port: 8080,
    host: true,
    open: false
  },
  build: {
    outDir: 'dist',
    // Sourcemaps stay OFF for production: they added ~11 MB to every deploy
    // and are never needed to play the game. Debug against `npm run dev`.
    sourcemap: false
  }
});
