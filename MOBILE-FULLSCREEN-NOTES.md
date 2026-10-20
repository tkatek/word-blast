# Mobile Landscape Fullscreen — implementation notes

Goal: phones get the largest practical landscape gameplay area while every
existing gameplay behavior (physics, levels, questions, audio, scoring,
controls, pause semantics) stays untouched.

## The three mobile outcomes

| Situation | What the player sees |
| --- | --- |
| Phone in **portrait** | Existing "Rotate Your Phone" gate (unchanged, `OrientationGate.js`); gameplay frozen behind it, progress kept |
| Phone in **landscape**, Fullscreen API available (Android Chrome, Edge, Firefox, desktop) | Wooden **⛶ PLAY FULLSCREEN** card ("Play with more screen space.") + "Not now — keep playing". After dismissal or after exiting fullscreen: a small corner chip keeps the control available without blocking |
| Phone in **landscape**, Fullscreen API absent/blocked (**iPhone Safari**, iframe without `allowfullscreen`) | No fullscreen button at all. A one-time "Add to Home Screen" guidance card (Share → Add to Home Screen) + CONTINUE PLAYING. The game stays fully playable in normal landscape |
| Launched from the **Home Screen** (installed web app / standalone) | Nothing — the browser chrome is already gone |

## Files

| File | Role |
| --- | --- |
| `js/systems/FullscreenController.js` (new) | The single owner of the Fullscreen API: capability probing (std/webkit/ms vendors, `fullscreenEnabled === false` = blocked iframe), state machine (`AVAILABLE / REQUESTING / ACTIVE / UNSUPPORTED / DENIED / STANDALONE`), verified enter/exit (the document's `fullscreenElement` is polled for — a resolved promise alone is never trusted), best-effort `screen.orientation.lock('landscape')` after a successful entry, `onChange` subscriptions. Node-safe (unit-tested with injected fake documents) |
| `js/systems/FullscreenEntry.js` (new) | The DOM prompt layer: `computeEntryMode()` is a pure visibility predicate (unit-tested); the installer binds `#fs-entry` / `#fs-chip`, exactly one listener per event, boot-gated on Phaser `ready` (no fullscreen UI over a failed boot), timeout-coalesced updates (rAF stalls while a document is fullscreen) |
| `index.html` | `#fs-entry` card (play + hint variants) and `#fs-chip` markup with critical inline CSS (a CSS 404 can never show a broken card); manifest + `apple-touch-icon` links, `theme-color`, `apple-mobile-web-app-title`; `100dvw/dvh` progressive enhancement on `#game` |
| `css/style.css` | Full wooden-cartoon styling for the card/chip (matches the GameHUD palette); `#game` dynamic viewport units |
| `js/main.js` | Creates the controller once, stores it in the game registry, installs the entry UI after the game exists |
| `js/systems/GameHUD.js` | Pause-menu **EXIT FULLSCREEN** button (blue, y=204) — visible ONLY while the document is actually fullscreen; syncs from controller state; unsubscribes on destroy |
| `js/scenes/GameScene.js` | Removed the old one-shot `tryEnterLandscapeFullscreen()` first-tap hack (it requested fullscreen invisibly and never verified the result). Rotation/pause semantics untouched |
| `js/systems/Viewport.js` | Canvas re-measure now also listens for `webkitfullscreenchange` / `msfullscreenchange` (Safari legacy) |
| `js/dev/DebugAPI.js` | `window.__WB__.fullscreen()` → `{ state, isFullscreen, supported, standalone, prompt }` for automated tests |
| `public/manifest.webmanifest` (new) | name "Word Blast", `display: standalone`, `orientation: landscape`, **relative** `start_url`/`scope` (`./`) so the same manifest is correct under `/word-blast/`, local dist and any future base path |
| `public/assets/images/icons/` (new) | icon-192 / icon-512 / maskable-512 / apple-touch-icon (180) generated from the game logo by `scripts/generate-pwa-icons.mjs` |
| `tests/fullscreen-tests.mjs` (new) | 33 unit tests: capability detection, state machine (verified success, denial, double-tap guard, standalone no-op, lock failures swallowed), entry visibility truth table, manifest fields + icon files on disk. Part of `npm test` |
| `scripts/verify-fullscreen.mjs` (new) | 29 browser checks against the real built game (see below) |

## Guarantees (and how they are enforced)

- **Fullscreen is only ever requested from an explicit button tap** (the card
  button, the chip, or nothing). No rotation handler requests it.
- **Success is verified, not assumed**: `enter()` resolves ACTIVE only after
  `document.fullscreenElement` is non-null; a promise that resolves without
  the element flips the state to DENIED and the card explains that the
  browser blocked it.
- **No broken button is ever shown**: capability detection runs at
  construction; UNSUPPORTED (iPhone Safari / unpermitted iframe) shows the
  Add-to-Home-Screen hint instead and never a fullscreen control.
- **Standalone never sees fullscreen UI** (`display-mode` media queries +
  legacy `navigator.standalone`).
- **Gameplay is never restarted or reset** by orientation or fullscreen
  transitions — verified end-to-end in the browser suite (question index,
  shots, score, hearts, canvas count, pause states all checked). A manually
  paused game stays paused when fullscreen exits; the rotation auto-pause
  still layers correctly with a manual pause.
- **Exactly one canvas, one controller, one listener per event** —
  install-guards everywhere; the browser suite asserts the canvas count
  after every transition.

## Behavior matrix (tested)

| Browser | Result |
| --- | --- |
| Android Chrome (emulated, Fullscreen API) | Card → tap → REAL fullscreen (`document.fullscreenElement` verified), canvas resized, card hidden, pause-menu EXIT FULLSCREEN appears; exit keeps the game paused and re-arms the corner chip |
| iPhone Safari (emulated: element API stripped) | Detected UNSUPPORTED; Add-to-Home-Screen card once per session; CONTINUE PLAYING dismisses; game fully playable; nothing re-prompts on later rotations |
| Installed web app (standalone emulation) | No fullscreen UI at all |
| Rotation mid-aim / paused / during question | Rotate gate + auto-pause in portrait; exact resume in landscape (progress byte-identical); manual pause survives the round-trip |
| 640×280 and 915×412 landscape | Whole 1280×720 world framed, aspect preserved (no stretch), HUD/towers/cards visible |
| `npm run build` (relative base) + `npm run build:pages` (`/word-blast/`) | Manifest, icons and asset URLs resolve under both prefixes |

Reproduce: `npm run build && node scripts/verify-fullscreen.mjs`
(screenshots land in `screenshots/fullscreen/`).

## Real-device status & limitations

- Automated verification ran in **desktop Chrome/Edge with phone emulation**
  (viewport, touch, UA, DPR 2) — including an iPhone-Safari emulation that
  removes the element Fullscreen API exactly like real iOS. **No physical
  iPhone/Android handset was tested in this session**; the MANUAL_CHECKLIST
  section below lists the on-device passes still worth doing.
- iOS Safari cannot fullscreen arbitrary HTML elements and has no orientation
  lock; the Add-to-Home-Screen standalone app is the supported fullscreen
  experience there (the manifest + Apple metadata make it work).
- Browsers may ignore `orientation` in the manifest (iOS ignores it; the
  portrait rotate-gate is the real enforcement).
- Chrome's install prompt criteria (engagement heuristics) are outside the
  page's control; the guidance card only explains HOW to install.
- `screen.orientation.lock` is Android-only and can be refused; failures are
  swallowed silently.

## Manual checklist (on-device)

1. Android Chrome, landscape: tap PLAY FULLSCREEN → toolbar hides, more
   playfield visible, orientation locked; pause menu → EXIT FULLSCREEN works;
   chip reappears after exit.
2. iPhone Safari, landscape: guidance card once, game playable, no dead
   button; Share → Add to Home Screen → launch: standalone, no Safari bars,
   no fullscreen prompts.
3. Rotate mid-aim / while paused / during a question: progress kept.
4. Notch devices: HUD/timers not clipped (safe-area insets on `#game`).

## Embedding in an iframe (future Boston English Center integration)

The controller detects `fullscreenEnabled === false` inside an iframe the
parent has not granted fullscreen to and shows the fallback path instead of a
broken button. To allow fullscreen from a host page:

```html
<iframe src="…/word-blast/" allow="fullscreen" allowfullscreen></iframe>
```

Without that attribute the game simply remains playable windowed — nothing
requests fullscreen that the parent has not permitted.
