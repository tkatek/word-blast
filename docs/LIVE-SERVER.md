# Live Server preview (port 5500) — how it is wired

## Why the game used to show a blank light-blue screen

VS Code Live Server is a plain static file server. When it served the project
**root**, the browser received the *uncompiled* `index.html`, whose entry
module `js/main.js` starts with:

```js
import Phaser from 'phaser';   // bare specifier — needs a bundler
```

Browsers cannot resolve bare specifiers, so the request became
`GET /phaser` → **404**, the whole ES-module graph died, no canvas was ever
created, and the only thing painted was the `#8ecae6` sky-blue page background
from `css/style.css`. The Vite dev server (`npm run dev`, port 8080) rewrites
bare imports on the fly, which is why the game worked there and not in Live
Server.

## The permanent setup

| Piece | File | Effect |
|---|---|---|
| Live Server root | `.vscode/settings.json` | `liveServer.settings.root: "/dist"`, port **5500** → `http://127.0.0.1:5500/` serves the compiled game |
| Vite base paths | `vite.config.js` | already `base: './'` → JS/CSS/textures/audio all load with page-relative URLs from `dist/` |
| Auto rebuild | `package.json` → `npm run watch` | `vite build --watch` recompiles into `dist/` on every source change |
| Auto reload | Live Server watches `dist/` | a rebuild rewrites `dist/index.html` → the page reloads itself (`fullReload`, 600 ms debounce) |
| Fallback parent workspace | `../.vscode/settings.json` | if the parent folder is opened instead, Live Server serves `/word-blast/dist` |

A one-time **restart of Live Server** (click the status-bar port, or
*Go Live* again) is required after changing its settings — settings are read
at server start.

## Daily workflow

```bash
npm run watch        # keep running: rebuilds dist/ on every save
```

Then **Go Live** in VS Code → preview at `http://127.0.0.1:5500/`.
Edit any source file → Vite rebuilds → the page reloads automatically.

## Never a silent blank screen again

`index.html` embeds a dependency-free boot watchdog:

- shows a small "Loading WORD BLAST…" chip while booting;
- records script/CSS/module/resource load failures and unhandled rejections;
- if the Phaser canvas does not appear within 8 s, it replaces the blank
  page with an error card that names the captured errors and — when it
  detects the "uncompiled root" failure signature (`Failed to resolve module
  specifier`) — tells you exactly which command fixes it.

`js/main.js` handshakes with it (`window.__wbBoot.ok()` on Phaser `ready`,
`fail()` if the constructor throws), so a WebGL/init failure is also reported.

## Ports

- **5500** — VS Code Live Server, serves `dist/` (the normal preview URL).
- 8080 — `npm run dev` (Vite dev server, unbundled, for development).
