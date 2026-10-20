# Mobile Landscape Fullscreen — implementation notes

Goal: phones get the largest practical landscape gameplay area while every
existing gameplay behavior (physics, levels, questions, audio, scoring,
controls, pause semantics) stays untouched.

## Root cause of "fullscreen works in emulation but not on my iPhone"

**iPhone Safari has no element Fullscreen API — at all** (verified against
WebKit/Apple documentation, current through iOS 26.4): only `<video>` can
go fullscreen (`webkitEnterFullscreen`). `Element.requestFullscreen` and
`webkitRequestFullscreen` do not exist for HTML elements on iPhone (they
DO on iPadOS). Desktop Chrome's responsive emulation keeps Chrome's real
Fullscreen API regardless of the emulated iPhone UA — so "PLAY FULLSCREEN"
genuinely works there and genuinely cannot work on the device. This is a
capability difference, not a request-path bug: no button, promise handling
or user-gesture fix can change it.

The supported iPhone experience is therefore **B: the Home Screen
standalone web app** (install once, launches without Safari's bars), with
**C: normal landscape browser play** always available. The failures that
DID exist on the real device path and are fixed in this build:

| Real-device defect | Fix |
| --- | --- |
| Install instructions said "tap Share in Safari" — invisible in landscape Safari (Share lives in the page menu), no "Open as Web App" mention | 7-step guide matching the real device flow (Safari → Share via the page menu → Add to Home Screen → keep Open as Web App → Add → launch → rotate); card scrolls safely on short viewports |
| After dismissing the guidance the install route was gone for the session (read as "the feature failed") | Compact ⌂ INSTALL corner chip keeps the route reachable and re-opens the instructions on demand; it never auto-prompts |
| No rotation-lock hint when the phone did not rotate | The rotate overlay mentions the device Rotation Lock honestly (the site cannot change it) |
| Rejections were indistinguishable from "no API" on-device | `FullscreenController.lastError` records name+message from `fullscreenerror` events, rejected promises and resolve-but-never-entered cases; shown in diagnostics |
| No way to tell WHICH build the phone was running | Build ID (`version+git-hash@timestamp`) injected at build time, printed to console, on `<html data-wb-build>`, in `?diag=1` |
| Transient measurements during iOS rotation could resize the canvas to a sliver | `ViewportController` ignores sub-60px transient sizes, keeps the last good size and re-checks on a bounded settle chain |
| The pause-menu EXIT FULLSCREEN control was lost in the pause-menu redesign | Restored as a bottom-left disk, visible only while `document.fullscreenElement` is genuinely set |

## The three display modes (never conflated)

| Mode | Detected by | Consequence |
| --- | --- | --- |
| **A. Native element fullscreen** | Fullscreen API probed on `documentElement` (std/webkit/ms), `fullscreenEnabled`, and — the only proof — `document.fullscreenElement` after the request | PLAY FULLSCREEN card/chip; pause-menu EXIT FULLSCREEN; orientation lock attempted (Android) |
| **B. Home Screen standalone** | `(display-mode: standalone|fullscreen|minimal-ui)` media queries + legacy `navigator.standalone` | No fullscreen UI at all (no chrome to reclaim); safe-area insets respected |
| **C. Browser play** | Neither of the above | Game fills the visible viewport (VisualViewport-aware); iPhone shows the install guide once + chip; game fully playable without installing |

A full-viewport CSS layout is **never** reported as native fullscreen, and
standalone never needs `document.fullscreenElement`. Capability detection
is runtime probing — never a UA-string decision (an iPhone UA under Chrome
emulation still gets fullscreen because the API really is there).

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
