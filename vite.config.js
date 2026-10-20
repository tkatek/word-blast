import { defineConfig } from 'vite';

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
  server: {
    port: 8080,
    host: true,
    open: false
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
