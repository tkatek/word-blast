# WORD BLAST — remtoo.net deployment (`/soufiane/word-blast/`)

## Why the first upload failed

`https://remtoo.net/soufiane/word-blast/` showed
`Failed to resolve module specifier "phaser"` because the server was given the
**uncompiled project source** (the zip containing `js/`, `node_modules/`, the
root `index.html`, …), not the compiled game.

The root `index.html` loads `./js/main.js`, and `js/main.js` starts with
`import Phaser from 'phaser'` — a bare npm specifier. Browsers cannot resolve
that; only Vite can, during `npm run build`, which bundles Phaser into
`dist/assets/index-*.js` and rewrites `dist/index.html` to load that bundle.

**Only the contents of `dist/` (after `build:remtoo`) are deployable.**
The same rule is already true for GitHub Pages (its workflow builds
`dist/` and publishes that) and for VS Code Live Server (`.vscode/settings.json`
points Live Server at `dist/`).

## Build

```bash
npm run build:remtoo        # vite build --base=/soufiane/word-blast/
npm run verify:remtoo       # headless test: serves dist/ at /soufiane/word-blast/
```

`verify:remtoo` starts a real static server mounted at the exact deployment
prefix, loads the page in a headless browser and asserts: zero HTTP 404s, zero
page errors (explicitly including module-specifier errors), the menu boots,
all six bird textures load, a level starts (AIMING state) and the slingshot
preview appears. Screenshot: `screenshots/12-remtoo-base-build.png`.

Asset paths need no manual editing: every runtime URL in the source is built
from `import.meta.env.BASE_URL`, so Vite bakes `/soufiane/word-blast/` into
this build automatically. The manifest link and icons are relative
(`./manifest.webmanifest`, `./assets/...`) and resolve correctly under the
subpath.

## Upload (exact destination)

1. Zip: `word-blast-remtoo.zip` (project root, ~4 MB, 151 entries —
   `index.html` at the ZIP root, no `dist/` wrapper, no source, no
   `node_modules`).
2. In the hosting file manager open `public_html/soufiane/` and create a
   folder named `word-blast` (the URL `https://remtoo.net/soufiane/word-blast/`
   must map to it; adjust the parent if the document root differs).
3. **Delete the old contents of that folder first** — the previous upload has
   source files (`js/`, `css/`, `package.json`, …) that must not remain next
   to the build.
4. Upload `word-blast-remtoo.zip` INTO `public_html/soufiane/word-blast/` and
   extract it there. After extraction the folder must contain `index.html`,
   `manifest.webmanifest` and `assets/` directly — not another nested folder.
5. Delete the uploaded zip from the server after extraction.
6. Visit `https://remtoo.net/soufiane/word-blast/` and hard-refresh
   (Ctrl+F5). The console should show
   `[WORD BLAST] build <version>+<hash>@<timestamp>`. `?diag=1` appended to
   the URL shows the on-device diagnostics panel with that same build id.

## Local vs public verification

Everything above except step 6 was verified locally in this repo:
the compiled build served at `/soufiane/word-blast/` boots the menu, loads
textures/audio and starts a level with zero errors. The public-site check
(step 6) requires the upload, which needs server access.

## Other targets stay untouched

- GitHub Pages: `npm run build:pages` + `npm run verify:pages` (base
  `/word-blast/`) — unchanged and re-verified.
- VS Code Live Server: `npm run build` (relative base `./`) +
  `npm run verify:build` — unchanged and re-verified.
