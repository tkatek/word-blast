/**
 * GameHUD — the top gameplay interface over the supplied wooden artwork.
 *
 *   LEFT    round pause button + level plaque (LEVEL n + name, "LV n" on phones)
 *   CENTER  three-compartment panel: Q n/total | clock + MM:SS | stars
 *   RIGHT   hearts panel | shots panel (bird portrait + ×N) | score | sound
 *
 * PAUSE (final redesign, per the supplied reference): the gameplay FREEZES
 * behind a dark scrim + a SUBTLE BLUR on the gameplay camera only — colors
 * are kept (no grayscale) so the scenery stays recognizable, while the
 * HUD's own camera never filters, so the controls render sharp and
 * colorful. Dead-center sits ONE large round wooden PLAY button (the same
 * carved-plank artwork family as the top bar's pause button, with its
 * metal rim, rivets and leaves) carrying a golden triangle inside a soft
 * golden glow; three clean controls stack beneath it — RESUME (warm wood,
 * largest), RESTART LEVEL (restart icon) and EXIT TO LEVELS (home icon,
 * darker wood, still confirmed before in-level progress is lost). No
 * PAUSED heading and no settings of any kind: sound stays on the top
 * bar's existing sound button. The only extra is a small corner EXIT
 * FULLSCREEN control that exists solely while the document is fullscreen.
 *
 * Design contract with the scene (unchanged since Fix #17):
 *   - The HUD OWNS NO gameplay state. The scene pushes one snapshot object
 *     through sync() (from its single refreshHUD() funnel) plus per-frame
 *     setTimer() from the authoritative LevelTimer. Counters, star progress
 *     and the score count-up are presentation-only.
 *   - Decorative frames are the supplied blank artwork
 *     (public/assets/images/ui/hud — HudArt.js registry). Icons, counters
 *     and labels are separate game objects drawn on top; nothing is baked
 *     into the images. Panel geometry (inner windows, compartment bounds)
 *     comes from pixel measurements of the artwork, never eyeballed.
 *   - Layout lives in the fixed 1280×720 world and is computed by ONE pure
 *     function (HudLayout.computeHudLayout) per device class — desktop /
 *     tablet share the full row, phones get a compact row with enlarged
 *     touch hit-boxes. The Viewport always frames the whole world, so the
 *     layout never re-flows on resize.
 *   - The HUD renders through its OWN camera: the gameplay camera's impact
 *     shake/flash never reaches it (cameras.main ignores the HUD tree).
 *     Both cameras share the same fit-view framing.
 *   - The HUD band stays above y 76 (78 on phones) — below the question
 *     card's top resting spot (y 86), so the existing dock needs no change.
 *     `barBottom` exposes the occupied band for future coordination.
 *   - Every interactive element calls markUiPointer() on pointerdown so the
 *     scene's global tap-to-activate-ability handler can ignore UI taps.
 *
 * Reduced-motion (save settings) disables the pulses and count-up tweens;
 * instant state swaps remain.
 */
import Phaser from 'phaser';
import { WORLD, HUD } from '../config.js';
import { DebugLog } from './DebugLog.js';
import { projectileVisual } from '../data/birds.js';
import { HUD_ART, ensureAllHudArt } from './HudArt.js';
import { computeHudLayout } from './HudLayout.js';
import { computeFitView } from './Viewport.js';

export const HUD_DEPTH = { BAR: 50, MENU: 120 };

/* ------------------------------------------------------------------ */
/* Palette — warm cartoon wood/parchment/gold                          */
/* ------------------------------------------------------------------ */
const PAL = {
  woodEdge: 0x4d3218,
  woodDark: 0x7f5539,
  wood: 0xa4713d,
  woodLight: 0xc8905a,
  woodGrain: 0x8a5a33,
  parchEdge: 0xb98b4e,
  parch: 0xf7e8c9,
  parchLight: 0xfff7e0,
  parchShade: 0xdfc68f,
  gold: 0xffd166,
  goldDeep: 0xe09f3e,
  goldEdge: 0x9c6b1f,
  textLight: '#fff6e5',
  textDark: '#5c3a1e',
  danger: '#e63946'
};

/** Menu button color triplets: [edge, body, light]. */
const BTN_COLORS = {
  green: [0x2f6b45, 0x4f9d69, 0x7fd493],
  blue: [0x25628a, 0x3d8fbf, 0x74c0e8],
  orange: [0xa85a1d, 0xe78a3c, 0xffb066],
  teal: [0x2b7466, 0x45a99b, 0x7fd4c9],
  slate: [0x55617a, 0x7c8ba3, 0xb8c4d6],
  red: [0x96303f, 0xd9536a, 0xff9aa4]
};

/**
 * Pause overlay geometry + tuning (world px inside the fixed 1280×720
 * world; the stack is grouped in `pauseCol`, centered on the world center
 * and nudged/scaled up on phones for comfortable landscape taps).
 */
const PAUSE_UI = {
  SCRIM: 0x050d08,          // near-black green-tinted dark overlay
  SCRIM_ALPHA: 0.52,        // darkening over the blurred scenery
  SCRIM_ALPHA_FLAT: 0.66,   // Canvas fallback (no post-fx blur available)
  PLAY_R: 108,              // wooden play disk radius (Ø 216 ≈ 30% of height)
  PLAY_Y: -122,             // play button center (pauseCol-local)
  RESUME: { y: 36, w: 320, h: 62, size: 24 },
  RESTART: { y: 106, w: 252, h: 52, size: 19 },
  EXIT: { y: 172, w: 252, h: 52, size: 19 },
  STAGGER_MS: 80,           // per-button entrance offset beneath the play button
  PHONE_SCALE: 1.12,        // phones: larger stack for ~44 CSS px touch targets
  PHONE_DY: -16
};

/* ------------------------------------------------------------------ */
/* Procedural textures (generated once; survive scene restarts)        */
/* Icons and menu chrome only — panel frames come from the artwork.    */
/* ------------------------------------------------------------------ */
const TEX = {
  wood: 'wbhud-wood',
  parch: 'wbhud-parch',
  heart: 'wbhud-heart',
  heartEmpty: 'wbhud-heart-empty',
  star: 'wbhud-star',
  starEmpty: 'wbhud-star-empty',
  clock: 'wbhud-clock',
  pauseIcon: 'wbhud-pause-ico',
  playIcon: 'wbhud-play-ico',
  soundOn: 'wbhud-sound-on',
  soundOff: 'wbhud-sound-off',
  coin: 'wbhud-coin',
  round: 'wbhud-round-btn',
  pauseWoodLight: 'wbhud-pwood-light',
  pauseWoodMed: 'wbhud-pwood-med',
  pauseWoodDark: 'wbhud-pwood-dark',
  restartIcon: 'wbhud-restart-ico',
  homeIcon: 'wbhud-home-ico'
};
const btnTex = (c) => `wbhud-btn-${c}`;

/** 5-point star polygon. */
function starPoints(cx, cy, outer, inner) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(new Phaser.Geom.Point(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/** Classic parametric heart silhouette, centered. */
function heartPoints(cx, cy, scale) {
  const pts = [];
  for (let i = 0; i <= 44; i++) {
    const t = (i / 44) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push(new Phaser.Geom.Point(cx + x * scale, cy - y * scale));
  }
  return pts;
}

export function ensureHudTextures(scene) {
  const T = scene.textures;
  const g = scene.add.graphics();

  const tex = (key, w, h, draw) => {
    if (T.exists(key)) return;
    g.clear();
    draw();
    g.generateTexture(key, w, h);
  };

  /* --- menu panel tiles (nine-sliced, slice = 24) -------------------- */
  tex(TEX.wood, 72, 72, () => {
    g.fillStyle(PAL.woodEdge, 1); g.fillRoundedRect(0, 0, 72, 72, 10);
    g.fillStyle(PAL.woodDark, 1); g.fillRoundedRect(3, 3, 66, 66, 8);
    g.fillStyle(PAL.woodLight, 1); g.fillRoundedRect(6, 6, 60, 60, 7);
    g.fillStyle(PAL.wood, 1); g.fillRoundedRect(6, 9, 60, 57, 7);
    g.fillStyle(PAL.woodLight, 0.45); g.fillRoundedRect(10, 10, 52, 13, 6);
    g.fillStyle(PAL.woodEdge, 0.28); g.fillRoundedRect(10, 49, 52, 13, 6);
    g.lineStyle(2, PAL.woodGrain, 0.55);
    for (const y of [30, 40]) {
      g.beginPath(); g.moveTo(12, y); g.lineTo(60, y); g.strokePath();
    }
  });

  tex(TEX.parch, 72, 72, () => {
    g.fillStyle(PAL.parchEdge, 1); g.fillRoundedRect(0, 0, 72, 72, 10);
    g.fillStyle(PAL.parchShade, 1); g.fillRoundedRect(3, 3, 66, 66, 8);
    g.fillStyle(PAL.parch, 1); g.fillRoundedRect(6, 6, 60, 60, 7);
    g.fillStyle(PAL.parchLight, 0.65); g.fillRoundedRect(10, 10, 52, 12, 6);
    g.fillStyle(PAL.parchEdge, 0.35); g.fillRoundedRect(10, 50, 52, 12, 6);
  });

  /* --- menu button tiles (nine-sliced, slice = 18) ------------------- */
  for (const [name, [edge, body, light]] of Object.entries(BTN_COLORS)) {
    tex(btnTex(name), 64, 64, () => {
      g.fillStyle(edge, 1); g.fillRoundedRect(0, 0, 64, 64, 14);
      g.fillStyle(body, 1); g.fillRoundedRect(3, 3, 58, 58, 12);
      g.fillStyle(light, 0.7); g.fillRoundedRect(7, 7, 50, 14, 8);
      g.fillStyle(edge, 0.35); g.fillRoundedRect(7, 43, 50, 14, 8);
    });
  }

  /* --- hearts ------------------------------------------------------ */
  const drawHeart = (fill, edge, hiAlpha) => {
    g.fillStyle(edge, 1); g.fillPoints(heartPoints(28, 30, 1.62), true);
    g.fillStyle(fill, 1); g.fillPoints(heartPoints(28, 29, 1.42), true);
    if (hiAlpha > 0) {
      g.fillStyle(0xffffff, hiAlpha);
      g.fillEllipse(21, 21, 10, 7);
    }
  };
  tex(TEX.heart, 56, 56, () => drawHeart(0xe63946, 0x8f1d2c, 0.55));
  tex(TEX.heartEmpty, 56, 56, () => {
    g.fillStyle(0x4d3f2c, 1); g.fillPoints(heartPoints(28, 30, 1.62), true);
    g.fillStyle(0x6e5a41, 0.9); g.fillPoints(heartPoints(28, 29, 1.42), true);
  });

  /* --- stars ------------------------------------------------------- */
  const drawStar = (fill, edge, sparkle) => {
    g.fillStyle(edge, 1); g.fillPoints(starPoints(28, 29, 27.5, 12), true);
    g.fillStyle(fill, 1); g.fillPoints(starPoints(28, 28, 24, 10.5), true);
    if (sparkle) {
      g.fillStyle(0xffffff, 0.75);
      g.fillEllipse(22, 21, 8, 5);
    }
  };
  tex(TEX.star, 56, 56, () => drawStar(PAL.gold, PAL.goldEdge, true));
  tex(TEX.starEmpty, 56, 56, () => drawStar(0x6e5a41, 0x4d3f2c, false));

  /* --- alarm clock -------------------------------------------------- */
  tex(TEX.clock, 56, 56, () => {
    g.fillStyle(PAL.goldEdge, 1);
    g.fillCircle(11, 11, 7); g.fillCircle(45, 11, 7);       // bells
    g.lineStyle(5, PAL.goldEdge, 1);
    g.beginPath(); g.moveTo(14, 48); g.lineTo(9, 54); g.strokePath();
    g.beginPath(); g.moveTo(42, 48); g.lineTo(47, 54); g.strokePath(); // feet
    g.fillStyle(PAL.goldEdge, 1); g.fillCircle(28, 30, 24); // rim
    g.fillStyle(PAL.parchLight, 1); g.fillCircle(28, 30, 19.5);
    g.fillStyle(PAL.goldEdge, 0.85);                        // 12/3/6/9 ticks
    g.fillCircle(28, 14.5, 2); g.fillCircle(28, 45.5, 2);
    g.fillCircle(12.5, 30, 2); g.fillCircle(43.5, 30, 2);
    g.lineStyle(4, 0x5c3a1e, 1);                            // hands
    g.beginPath(); g.moveTo(28, 30); g.lineTo(28, 18); g.strokePath();
    g.lineStyle(3.4, 0x5c3a1e, 1);
    g.beginPath(); g.moveTo(28, 30); g.lineTo(38, 33); g.strokePath();
    g.fillStyle(0xe63946, 1); g.fillCircle(28, 30, 3);
  });

  /* --- pause icon (two bars) ---------------------------------------- */
  tex(TEX.pauseIcon, 44, 44, () => {
    for (const x of [10, 25]) {
      g.fillStyle(0x4d3218, 1); g.fillRoundedRect(x - 1, 9, 11, 27, 5);
      g.fillStyle(PAL.parchLight, 1); g.fillRoundedRect(x, 10, 9, 25, 4);
    }
  });

  /* --- golden play triangle (pause-overlay RESUME button) ------------ */
  tex(TEX.playIcon, 48, 48, () => {
    g.fillStyle(0x6b400f, 1);
    g.fillPoints([
      new Phaser.Geom.Point(13, 8), new Phaser.Geom.Point(41, 24),
      new Phaser.Geom.Point(13, 40)
    ], true);
    g.fillStyle(0xffd257, 1);
    g.fillPoints([
      new Phaser.Geom.Point(17, 13), new Phaser.Geom.Point(35, 24),
      new Phaser.Geom.Point(17, 35)
    ], true);
    g.fillStyle(0xfff3c0, 0.85);
    g.fillTriangle(19, 15, 28, 21.5, 19, 24);
  });

  /* --- speaker icons ------------------------------------------------ */
  const speaker = () => {
    g.fillStyle(0x4d3218, 1);
    g.fillPoints([
      new Phaser.Geom.Point(9, 18), new Phaser.Geom.Point(17, 18),
      new Phaser.Geom.Point(26, 9), new Phaser.Geom.Point(26, 39),
      new Phaser.Geom.Point(17, 30), new Phaser.Geom.Point(9, 30)
    ], true);
    g.fillStyle(PAL.parchLight, 1);
    g.fillPoints([
      new Phaser.Geom.Point(11, 20), new Phaser.Geom.Point(17, 20),
      new Phaser.Geom.Point(24, 12), new Phaser.Geom.Point(24, 36),
      new Phaser.Geom.Point(17, 28), new Phaser.Geom.Point(11, 28)
    ], true);
  };
  tex(TEX.soundOn, 48, 48, () => {
    speaker();
    g.lineStyle(3.5, PAL.parchLight, 1);
    g.beginPath(); g.arc(28, 24, 10, -0.9, 0.9); g.strokePath();
    g.beginPath(); g.arc(28, 24, 16, -0.8, 0.8); g.strokePath();
  });
  tex(TEX.soundOff, 48, 48, () => {
    speaker();
    g.lineStyle(5, 0xe63946, 1);
    g.beginPath(); g.moveTo(31, 17); g.lineTo(43, 31); g.strokePath();
    g.beginPath(); g.moveTo(43, 17); g.lineTo(31, 31); g.strokePath();
  });

  /* --- score coin ---------------------------------------------------- */
  tex(TEX.coin, 48, 48, () => {
    g.fillStyle(PAL.goldEdge, 1); g.fillCircle(24, 24, 21);
    g.fillStyle(PAL.goldDeep, 1); g.fillCircle(24, 24, 18);
    g.fillStyle(PAL.gold, 1); g.fillCircle(24, 24, 15);
    g.fillStyle(PAL.goldDeep, 1);
    g.fillPoints(starPoints(24, 24, 9.5, 4), true);
  });

  /* --- round wooden button (pause menu / legacy fallback) ------------ */
  tex(TEX.round, 96, 96, () => {
    g.fillStyle(PAL.woodEdge, 1); g.fillCircle(48, 48, 47);
    g.fillStyle(PAL.woodDark, 1); g.fillCircle(48, 48, 44);
    g.fillStyle(PAL.woodLight, 1); g.fillCircle(48, 47, 40);
    g.fillStyle(PAL.wood, 1); g.fillCircle(48, 50, 40);
    g.fillStyle(PAL.woodLight, 0.35); g.fillCircle(40, 40, 14);
    g.lineStyle(3, PAL.woodEdge, 0.35);
    g.beginPath(); g.arc(48, 48, 33, 0, Math.PI * 2); g.strokePath();
  });

  /* --- pause-menu wooden tiles (nine-sliced, slice = 18) --------------
   * Three warm-wood tones for the pause stack — light oak (RESUME),
   * classic oak (RESTART LEVEL) and dark walnut (EXIT TO LEVELS) — in the
   * same cartoon-wood language as the supplied HUD artwork. */
  const pauseTile = (key, edge, body, light, shade, grain) => {
    tex(key, 64, 64, () => {
      g.fillStyle(edge, 1); g.fillRoundedRect(0, 0, 64, 64, 14);
      g.fillStyle(body, 1); g.fillRoundedRect(3, 3, 58, 58, 11);
      g.fillStyle(light, 0.5); g.fillRoundedRect(7, 6, 50, 13, 7);
      g.fillStyle(shade, 0.5); g.fillRoundedRect(7, 45, 50, 12, 7);
      g.lineStyle(1.6, grain, 0.6);
      for (const y of [27, 35, 43]) {
        g.beginPath(); g.moveTo(9, y); g.lineTo(55, y - 1.5); g.strokePath();
      }
    });
  };
  pauseTile(TEX.pauseWoodLight, 0x6b4416, 0xc08a4e, 0xe8ba7d, 0x8a5a28, 0x9a6a34);
  pauseTile(TEX.pauseWoodMed, 0x593a12, 0xa8763e, 0xd2a260, 0x7a5226, 0x86582a);
  pauseTile(TEX.pauseWoodDark, 0x3c280e, 0x7a5426, 0xa87f48, 0x5a3c1a, 0x5f3f1c);

  /* --- restart icon (circular arrow with tangential head) ------------- */
  tex(TEX.restartIcon, 48, 48, () => {
    const cx = 24, cy = 26, r = 12;
    const a0 = Phaser.Math.DegToRad(-62), a1 = Phaser.Math.DegToRad(205);
    g.lineStyle(8.5, 0x3a2410, 1);
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.strokePath();
    g.lineStyle(5, 0xfff3d6, 1);
    g.beginPath(); g.arc(cx, cy, r, a0, a1); g.strokePath();
    const tx = cx + Math.cos(a0) * r, ty = cy + Math.sin(a0) * r;
    const ux = -Math.sin(a0), uy = Math.cos(a0);     // travel direction at a0
    const nx = Math.cos(a0), ny = Math.sin(a0);      // head width direction
    const head = (len, w, color) => {
      g.fillStyle(color, 1);
      g.fillPoints([
        new Phaser.Geom.Point(tx + ux * len, ty + uy * len),
        new Phaser.Geom.Point(tx + nx * w, ty + ny * w),
        new Phaser.Geom.Point(tx - nx * w, ty - ny * w)
      ], true);
    };
    head(11, 7.5, 0x3a2410);
    head(8, 4.5, 0xfff3d6);
  });

  /* --- home icon (pause menu EXIT TO LEVELS) -------------------------- */
  tex(TEX.homeIcon, 48, 48, () => {
    g.fillStyle(0x3a2410, 1); g.fillRoundedRect(9, 24, 30, 19, 3);   // body edge
    g.fillStyle(0xfff3d6, 1); g.fillRoundedRect(12, 26.5, 24, 14.5, 2);
    g.fillStyle(0x3a2410, 1);                                        // roof edge
    g.fillPoints([
      new Phaser.Geom.Point(24, 4), new Phaser.Geom.Point(44, 26),
      new Phaser.Geom.Point(4, 26)
    ], true);
    g.fillStyle(0xffe6b0, 1);
    g.fillPoints([
      new Phaser.Geom.Point(24, 8.5), new Phaser.Geom.Point(39.5, 25),
      new Phaser.Geom.Point(8.5, 25)
    ], true);
    g.fillStyle(0x6b4416, 1); g.fillRoundedRect(20, 31, 8, 12, 2);   // door
  });

  g.destroy();
}

/* ------------------------------------------------------------------ */
/* Small builders shared with the scene overlays (fail panel etc.)      */
/* ------------------------------------------------------------------ */

/** Chunky cartoon text: bold + dark stroke + soft shadow. */
export function chunkyText(scene, x, y, str, size, fill, stroke = 0x4d3218, strokeW = 0) {
  const t = scene.add.text(x, y, str, {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: `${size}px`,
    fontStyle: 'bold',
    color: fill
  });
  if (strokeW > 0) t.setStroke(`#${stroke.toString(16).padStart(6, '0')}`, strokeW);
  t.setShadow(0, 2, 'rgba(35,22,8,0.45)', 2, false, true);
  return t;
}

/**
 * Ink-on-parchment text for the light-centred panels: dark fill, no
 * stroke, barely-there shadow (heavy shadows read as blur at HUD sizes).
 */
function inkText(scene, x, y, str, size, fill = PAL.textDark) {
  const t = scene.add.text(x, y, str, {
    fontFamily: 'Arial, Helvetica, sans-serif',
    fontSize: `${size}px`,
    fontStyle: 'bold',
    color: fill
  });
  t.setShadow(0, 1, 'rgba(255,247,224,0.5)', 1, false, true);
  return t;
}

/** Nine-sliced wooden ('wood') or parchment ('parch') panel. */
export function woodPanel(scene, x, y, w, h, kind = 'wood') {
  ensureHudTextures(scene);
  const key = kind === 'parch' ? TEX.parch : TEX.wood;
  return scene.add.nineslice(x, y, key, undefined, w, h, 24, 24, 24, 24);
}

/** Wooden cartoon button with hover/press feedback. */
export function woodButton(scene, {
  x, y, w = 300, h = 60, label, color = 'green', size = 22, onClick, markUi
}) {
  ensureHudTextures(scene);
  const c = scene.add.container(x, y);
  const bg = scene.add.nineslice(0, 0, btnTex(color), undefined, w, h, 18, 18, 18, 18);
  const txt = chunkyText(scene, 0, 0, label, size, PAL.textLight, 0x3a2410, Math.max(3, size * 0.16))
    .setOrigin(0.5);
  c.add([bg, txt]);
  c.setSize(w, h).setInteractive({ useHandCursor: true });
  const base = { hover: 1.04, press: 0.95 };
  c.on('pointerover', () => c.setScale(base.hover));
  c.on('pointerout', () => c.setScale(1));
  c.on('pointerdown', () => {
    c.setScale(base.press);
    if (markUi) markUi();
  });
  c.on('pointerup', () => c.setScale(base.hover));
  c.labelText = txt;
  c.bg = bg;
  if (onClick) c.on('pointerup', onClick);
  return c;
}

/** "12,450" — thousands separators without locale surprises. */
export function formatScore(n) {
  return String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Pause-menu wooden button: a nine-sliced warm-wood tile (PAUSE_UI tones)
 * with a chunky label and an optional leading icon, both centered as one
 * group. Hover/press are tweened (smooth ~110ms, not instant snaps) and
 * every press emits the click tick before the action runs. `hitPad`
 * enlarges the tap target beyond the visible wood (comfort on phones).
 */
function pauseMenuButton(scene, {
  x, y, w, h, label, tile, icon, size = 19, hitPad = 10,
  onClick, markUi, audio, hoverAudio
}) {
  ensureHudTextures(scene);
  const c = scene.add.container(x, y);
  const bg = scene.add.nineslice(0, 0, tile, undefined, w, h, 18, 18, 18, 18);
  const txt = chunkyText(scene, 0, 0, label, size, PAL.textLight, 0x3a2410, Math.max(3, size * 0.16))
    .setOrigin(0.5);
  c.add([bg, txt]);
  if (icon) {
    const ico = scene.add.image(0, 0, icon).setDisplaySize(size * 1.3, size * 1.3);
    c.add(ico);
    const gap = 9;
    const total = ico.displayWidth + gap + txt.width;
    ico.x = -total / 2 + ico.displayWidth / 2;
    txt.x = -total / 2 + ico.displayWidth + gap + txt.width / 2;
  }
  c.setSize(w + hitPad * 2, h + hitPad * 2).setInteractive({ useHandCursor: true });
  // hover/press scale only — never overwrite:true, which would also kill
  // the entrance tweens (alpha/y) if the pointer arrives mid-animation
  const settle = (to, ms = 110) => {
    if (c.scaleTween) c.scaleTween.stop();
    c.scaleTween = scene.tweens.add({
      targets: c, scale: to, duration: ms, ease: 'Sine.easeOut'
    });
  };
  c.on('pointerover', () => { bg.setTint(0xfff1d6); settle(1.045); hoverAudio?.emit('ui-hover'); });
  c.on('pointerout', () => { bg.clearTint(); settle(1); });
  c.on('pointerdown', () => { settle(0.95, 70); markUi && markUi(); });
  c.on('pointerup', () => {
    settle(1.02, 90);
    audio?.emit('ui-click');
    onClick && onClick();
  });
  c.labelText = txt;
  c.bg = bg;
  return c;
}

/* ------------------------------------------------------------------ */
/* The HUD                                                             */
/* ------------------------------------------------------------------ */
export class GameHUD {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} actions gameplay callbacks:
   *   onPause, onResume, onRestartQuestion, onRestartLevel, onExitToLevels,
   *   onToggleSound, onToggleMusic, onToggleSfx, onToggleReducedMotion
   * @param {object} opts { markUi() -> flags UI pointerdown for the scene,
   *                        save (settings reader), audio (event bus) }
   */
  constructor(scene, actions = {}, opts = {}) {
    this.scene = scene;
    this.actions = actions;
    this.markUi = opts.markUi || (() => {});
    this.save = opts.save || null;
    // Fix #22 — audio bus for click/hover polish (falls back to the
    // registry copy; optional so headless HUD tests keep working)
    this.audio = opts.audio || (scene.registry ? scene.registry.get('audio') : null) || null;
    this.isDesktop = (scene.registry.get('device') || { type: 'desktop' }).type === 'desktop';

    ensureHudTextures(scene);
    const missing = ensureAllHudArt(scene);
    if (missing.length) {
      console.warn('[HUD] artwork missing — procedural stand-ins used for: ' + missing.join(', '));
    }

    const device = scene.registry.get('device') || { type: 'desktop' };
    this.layout = computeHudLayout(device.type);

    // presentation-only caches
    this.displayScore = 0;
    this.scoreTarget = 0;
    this.lastTimerText = '';
    this.timerLowActive = false;
    this.starLit = [false, false, false];
    this.star1Progress = -1;
    this.heartAnim = null;         // { index, until }
    this.lastShotsLeft = -1;       // shots-decrease pulse guard
    this.pauseOpenState = false;

    this.root = scene.add.container(0, 0).setDepth(HUD_DEPTH.BAR);
    this.buildBar();
    this.buildPauseMenu();
    this.setupUiCamera();

    scene.events.once('shutdown', () => this.destroy());
  }

  get reducedMotion() {
    return !!(this.save && this.save.data && this.save.data.settings && this.save.data.settings.reducedMotion);
  }

  /** Lowest world-y the HUD artwork reaches (question-card dock queries it). */
  get barBottom() {
    return this.layout.bandBottom;
  }

  /* ---------------------------------------------------------------- */
  /* Top bar                                                           */
  /* ---------------------------------------------------------------- */
  buildBar() {
    const s = this.scene;
    const L = this.layout;
    const E = L.elements;
    const TY = L.type;

    /* LEFT — round pause button ------------------------------------- */
    this.pauseBtn = s.add.container(E.pause.x, E.pause.y);
    const pauseBg = s.add.image(0, 0, HUD_ART.pauseBtn.key)
      .setDisplaySize(E.pause.w, E.pause.h);
    const pauseIco = s.add.image(0, 0, TEX.pauseIcon)
      .setDisplaySize(E.pause.w * HUD_ART.pauseBtn.iconDisk * 0.82,
        E.pause.h * HUD_ART.pauseBtn.iconDisk * 0.82);
    this.pauseBtn.add([pauseBg, pauseIco]);
    this.pauseBtn.bg = pauseBg;
    this.pauseBtn.setSize(E.pause.hit, E.pause.hit).setInteractive({ useHandCursor: true });
    this.pauseBtn.on('pointerover', () => { pauseBg.setTint(0xfff1d6); if (this.isDesktop) this.audio?.emit('ui-hover'); });
    this.pauseBtn.on('pointerout', () => { pauseBg.clearTint(); this.pauseBtn.setScale(1); });
    this.pauseBtn.on('pointerdown', () => { this.pauseBtn.setScale(0.94); this.markUi(); });
    this.pauseBtn.on('pointerup', () => {
      this.pauseBtn.setScale(1);
      this.actions.onPause && this.actions.onPause();
    });

    /* LEVEL plaque --------------------------------------------------- */
    this.levelPanel = s.add.image(E.level.x, E.level.y, HUD_ART.level.key)
      .setDisplaySize(E.level.w, E.level.h);
    const li = HUD_ART.level.inner;
    const lx0 = E.level.x - E.level.w / 2 + li.x0 * E.level.w;
    const lx1 = E.level.x - E.level.w / 2 + li.x1 * E.level.w;
    const ly0 = E.level.y - E.level.h / 2 + li.y0 * E.level.h;
    const ly1 = E.level.y + E.level.h / 2 - (1 - li.y1) * E.level.h;
    const lMidX = (lx0 + lx1) / 2;
    const lWinH = ly1 - ly0;
    if (TY.levelShort) {
      this.levelTitle = inkText(s, lMidX, E.level.y, 'LV 1', TY.levelMain).setOrigin(0.5);
      this.levelName = s.add.text(0, -40, '', { fontSize: '1px' }).setVisible(false);
    } else {
      // two lines share the measured parchment window with tight leading
      this.levelTitle = inkText(s, lMidX, E.level.y - lWinH * 0.21, 'LEVEL 1', TY.levelMain)
        .setOrigin(0.5);
      this.levelName = inkText(s, lMidX, E.level.y + lWinH * 0.25, '', TY.levelTitle, '#6b4a26')
        .setOrigin(0.5);
    }
    this.levelTitleMaxW = (lx1 - lx0) - 6;

    /* CENTER — Q | clock MM:SS | stars ------------------------------- */
    this.progressPanel = s.add.image(E.progress.x, E.progress.y, HUD_ART.progress.key)
      .setDisplaySize(E.progress.w, E.progress.h);

    const qc = L.cells.question;
    this.questionText = inkText(s, qc.cx, qc.cy, 'Q 1/4', TY.question).setOrigin(0.5);

    const tc = L.cells.timer;
    const clock = s.add.image(tc.x0 + TY.timerIcon / 2 + 1, tc.cy, TEX.clock)
      .setDisplaySize(TY.timerIcon, TY.timerIcon);
    this.timerText = inkText(s, tc.x0 + TY.timerIcon + 5, tc.cy, '00:00', TY.timer)
      .setOrigin(0, 0.5);
    // reserve the full MM:SS width so the ticking clock never shifts the HUD
    this.timerText.setFixedSize(Math.ceil(TY.timer * 0.62 * 5) + 4, Math.ceil(TY.timer * 1.25));
    this.timerGroup = s.add.container(0, 0, [clock, this.timerText]);

    const sc = L.cells.stars;
    this.starIcons = [];
    const starN = TY.starCount;
    if (starN === 1) {
      // phone: one summary star doubles as the question-progress dial
      const empty = s.add.image(0, 0, TEX.starEmpty).setDisplaySize(TY.stars, TY.stars);
      const full = s.add.image(0, 0, TEX.star).setDisplaySize(TY.stars, TY.stars).setVisible(false);
      const g = s.add.container(sc.cx, sc.cy, [empty, full]);
      this.starIcons.push({ empty, full, group: g });
    } else {
      const gap = Math.max(1, (sc.w - starN * TY.stars) / (starN - 1));
      const total = starN * TY.stars + (starN - 1) * gap;
      for (let i = 0; i < starN; i++) {
        const empty = s.add.image(0, 0, TEX.starEmpty).setDisplaySize(TY.stars, TY.stars);
        const full = s.add.image(0, 0, TEX.star).setDisplaySize(TY.stars, TY.stars).setVisible(false);
        const g = s.add.container(sc.cx - total / 2 + TY.stars / 2 + i * (TY.stars + gap), sc.cy,
          [empty, full]);
        this.starIcons.push({ empty, full, group: g });
      }
    }

    /* RIGHT — hearts | shots | score | sound -------------------------- */
    this.heartsPanel = s.add.image(E.hearts.x, E.hearts.y, HUD_ART.hearts.key)
      .setDisplaySize(E.hearts.w, E.hearts.h);
    const hi = HUD_ART.hearts.inner;
    const hx0 = E.hearts.x - E.hearts.w / 2 + hi.x0 * E.hearts.w;
    const hx1 = E.hearts.x - E.hearts.w / 2 + hi.x1 * E.hearts.w;
    this.heartIcons = [];
    const hGap = Math.max(4, (hx1 - hx0 - 3 * TY.hearts) / 4);
    for (let i = 0; i < 3; i++) {
      this.heartIcons.push(
        s.add.image(hx0 + hGap + TY.hearts / 2 + i * (TY.hearts + hGap), E.hearts.y, TEX.heart)
          .setDisplaySize(TY.hearts, TY.hearts)
      );
    }

    this.shotsPanel = s.add.image(E.shots.x, E.shots.y, HUD_ART.shots.key)
      .setDisplaySize(E.shots.w, E.shots.h);
    const si = HUD_ART.shots.inner;
    const sx0 = E.shots.x - E.shots.w / 2 + si.x0 * E.shots.w;
    const sx1 = E.shots.x - E.shots.w / 2 + si.x1 * E.shots.w;
    this.shotsBird = s.add.image(sx0 + TY.shotsIcon / 2 + 2, E.shots.y, TEX.coin);
    this.shotsText = inkText(s, sx0 + TY.shotsIcon + 6, E.shots.y, '×0', TY.shots)
      .setOrigin(0, 0.5);
    this.shotsMaxX = sx1;

    this.scorePanel = s.add.image(E.score.x, E.score.y, HUD_ART.score.key)
      .setDisplaySize(E.score.w, E.score.h);
    const ci = HUD_ART.score.inner;
    const cx0 = E.score.x - E.score.w / 2 + ci.x0 * E.score.w;
    this.scoreCoin = s.add.image(cx0 + TY.scoreIcon / 2 + 2, E.score.y, TEX.coin)
      .setDisplaySize(TY.scoreIcon, TY.scoreIcon);
    this.scoreText = chunkyText(s, cx0 + TY.scoreIcon + 6, E.score.y, '0', TY.score,
      '#ffe9b3', 0x3a2410, 2.5).setOrigin(0, 0.5);
    // reserve the widest live score ("888,888") so counting never jiggles
    // (0.6 em/char — measured Arial bold digits, fits the enlarged counter
    // panels' inner window without touching the carved frame)
    this.scoreText.setFixedSize(Math.ceil(TY.score * 0.6 * 7) + 4, Math.ceil(TY.score * 1.3));

    this.soundBtn = s.add.container(E.sound.x, E.sound.y);
    this.soundBg = s.add.image(0, 0, HUD_ART.soundBtn.key)
      .setDisplaySize(E.sound.w, E.sound.h);
    this.soundIco = s.add.image(0, 0, TEX.soundOn)
      .setDisplaySize(E.sound.w * HUD_ART.soundBtn.iconDisk * 0.88,
        E.sound.h * HUD_ART.soundBtn.iconDisk * 0.88);
    this.soundBtn.add([this.soundBg, this.soundIco]);
    this.soundBtn.setSize(E.sound.hit, E.sound.hit).setInteractive({ useHandCursor: true });
    this.soundBtn.on('pointerover', () => this.soundBg.setTint(0xfff1d6));
    this.soundBtn.on('pointerout', () => { this.soundBg.clearTint(); this.soundBtn.setScale(1); });
    this.soundBtn.on('pointerdown', () => { this.soundBtn.setScale(0.94); this.markUi(); });
    this.soundBtn.on('pointerup', () => {
      this.soundBtn.setScale(1);
      this.actions.onToggleSound && this.actions.onToggleSound();
    });

    /* dev-only state chip (never shown to players) */
    this.stateChip = s.add.text(WORLD.WIDTH / 2 + 50, L.bandBottom + 4, '', {
      fontFamily: 'monospace', fontSize: '13px', color: 'rgba(255,255,255,0.65)'
    });
    this.stateChip.setVisible(DebugLog.enabled);

    this.root.add([
      this.pauseBtn,
      this.levelPanel, this.levelTitle, this.levelName,
      this.progressPanel, this.questionText, this.timerGroup,
      ...this.starIcons.map((x) => x.group),
      this.heartsPanel, ...this.heartIcons,
      this.shotsPanel, this.shotsBird, this.shotsText,
      this.scorePanel, this.scoreCoin, this.scoreText,
      this.soundBtn,
      this.stateChip
    ]);
  }

  /* ---------------------------------------------------------------- */
  /* UI camera — the HUD never shakes with the gameplay camera          */
  /* ---------------------------------------------------------------- */
  setupUiCamera() {
    const s = this.scene;
    this.uiCam = s.cameras.add(0, 0, s.scale.width, s.scale.height);
    // gameplay camera: never render the HUD tree (shake/flash stay outside)
    s.cameras.main.ignore(this.root);
    s.cameras.main.ignore(this.menu);
    // UI camera: render ONLY the HUD tree — hide everything already on the
    // display list and everything added later (birds, towers, overlays…).
    const uiOwn = new Set([this.root, this.menu]);
    s.children.each((child) => {
      if (!uiOwn.has(child)) this.uiCam.ignore(child);
    });
    this.onUiChildAdded = (child) => {
      if (!uiOwn.has(child)) this.uiCam.ignore(child);
    };
    // DisplayList is NOT an EventEmitter — adds are announced on the scene's
    // own event bus as 'addedtoscene'
    s.events.on('addedtoscene', this.onUiChildAdded);
    this.onUiScaleResize = () => this.reframeUiCamera();
    s.scale.on('resize', this.onUiScaleResize);
    this.reframeUiCamera();
  }

  /** Mirror the gameplay camera's whole-world fit framing (no shake). */
  reframeUiCamera() {
    if (!this.uiCam) return;
    const s = this.scene;
    const view = computeFitView(s.scale.gameSize.width, s.scale.gameSize.height);
    this.uiCam.setSize(s.scale.width, s.scale.height);
    this.uiCam.setZoom(view.zoom);
    this.uiCam.centerOn(WORLD.WIDTH / 2, WORLD.HEIGHT / 2);
  }

  /* ---------------------------------------------------------------- */
  /* Pause overlay (final redesign: reference look — dark + blurred    */
  /* frozen gameplay, central wooden PLAY, three clean controls)       */
  /* ---------------------------------------------------------------- */
  /**
   * The old settings-list pause menu is gone. Pausing now FREEZES the
   * gameplay (the scene already pauses physics, timers and input), keeps
   * the scenery's COLORS under a dark scrim + subtle blur (gameplay camera
   * only — this HUD camera stays sharp), and shows:
   *
   *   1. ONE large round wooden PLAY button dead-center — supplied
   *      carved-plank artwork (metal rim, rivets, leaves) with a golden
   *      triangle, soft golden glow and gentle hover/tap scaling. Both it
   *      and RESUME resume the game.
   *   2. Three controls stacked beneath: RESUME (warm light wood, the
   *      largest), RESTART LEVEL (restart icon) and EXIT TO LEVELS (home
   *      icon, darker wood — confirmed before in-level progress is lost).
   *
   * No PAUSED heading, no sound/music/fx settings, no reduced-motion
   * toggle, no instructions. The only additional control is a small
   * corner EXIT FULLSCREEN button that exists solely while the document
   * is fullscreen (never part of the reference stack).
   */
  buildPauseMenu() {
    const s = this.scene;
    this.menu = s.add.container(WORLD.WIDTH / 2, WORLD.HEIGHT / 2).setDepth(HUD_DEPTH.MENU).setVisible(false);

    // dark transparent overlay over the frozen, softly blurred scenery.
    // Object alpha animates 0→1 on open; the FILL alpha is the darkness
    // level (deepened when Canvas rendering cannot blur at all).
    this.scrim = s.add.rectangle(0, 0, WORLD.WIDTH, WORLD.HEIGHT, PAUSE_UI.SCRIM, PAUSE_UI.SCRIM_ALPHA)
      .setAlpha(0)
      .setInteractive({ useHandCursor: false }); // swallows gameplay taps
    this.scrim.on('pointerdown', () => this.markUi());

    /* the centered stack: play button above the three controls --------- */
    const compact = (s.registry.get('device') || { type: 'desktop' }).type === 'mobile';
    this.pauseCol = s.add.container(0, compact ? PAUSE_UI.PHONE_DY : 0);
    if (compact) this.pauseCol.setScale(PAUSE_UI.PHONE_SCALE);

    // THE control: one large circular wooden play button, dead center
    const R = PAUSE_UI.PLAY_R;
    this.resumeBtn = s.add.container(0, PAUSE_UI.PLAY_Y);
    this.resumeGlow = s.add.circle(0, 0, R * 1.34, 0xffd257, 0.13)
      .setBlendMode(Phaser.BlendModes.ADD);
    const glowCore = s.add.circle(0, 0, R * 1.1, 0xffe9a8, 0.10)
      .setBlendMode(Phaser.BlendModes.ADD);
    const shadow = s.add.circle(7, 15, R * 1.02, 0x000000, 0.34);
    this.resumeDisk = s.add.image(0, 0, HUD_ART.pauseBtn.key)
      .setDisplaySize(R * 2, R * 2);
    const triangle = s.add.image(6, 0, TEX.playIcon).setDisplaySize(R * 0.95, R * 0.95);
    this.resumeBtn.add([this.resumeGlow, glowCore, shadow, this.resumeDisk, triangle]);
    this.resumeBtn.setSize(R * 2, R * 2).setInteractive({ useHandCursor: true });
    this.resumeBtn.on('pointerover', () => {
      this.resumeDisk.setTint(0xfff1d6);
      this._scaleResume(this.reducedMotion ? 1 : 1.05);
      if (this.isDesktop) this.audio?.emit('ui-hover');
    });
    this.resumeBtn.on('pointerout', () => {
      this.resumeDisk.clearTint();
      this._scaleResume(1);
    });
    this.resumeBtn.on('pointerdown', () => {
      this._scaleResume(0.93, 80);
      this.markUi();
    });
    this.resumeBtn.on('pointerup', () => {
      this._scaleResume(1, 90);
      this.audio?.emit('ui-click'); // subtle click, then the state machine resumes
      this.actions.onResume && this.actions.onResume();
    });

    // the three clean controls beneath (same wood family, descending size)
    const mk = (opts) => pauseMenuButton(s, {
      markUi: () => this.markUi(),
      audio: this.audio,
      hoverAudio: this.isDesktop ? this.audio : null,
      hitPad: compact ? 16 : 10,
      ...opts
    });
    this.resumeMenuBtn = mk({
      x: 0, y: PAUSE_UI.RESUME.y, w: PAUSE_UI.RESUME.w, h: PAUSE_UI.RESUME.h,
      label: 'RESUME', tile: TEX.pauseWoodLight, size: PAUSE_UI.RESUME.size,
      onClick: () => this.actions.onResume && this.actions.onResume()
    });
    this.restartBtn = mk({
      x: 0, y: PAUSE_UI.RESTART.y, w: PAUSE_UI.RESTART.w, h: PAUSE_UI.RESTART.h,
      label: 'RESTART LEVEL', tile: TEX.pauseWoodMed, icon: TEX.restartIcon,
      size: PAUSE_UI.RESTART.size,
      onClick: () => this.actions.onRestartLevel && this.actions.onRestartLevel()
    });
    this.exitBtn = mk({
      x: 0, y: PAUSE_UI.EXIT.y, w: PAUSE_UI.EXIT.w, h: PAUSE_UI.EXIT.h,
      label: 'EXIT TO LEVELS', tile: TEX.pauseWoodDark, icon: TEX.homeIcon,
      size: PAUSE_UI.EXIT.size,
      onClick: () => this.confirm(
        'EXIT LEVEL?', 'Your progress in this level will be lost.',
        'YES, EXIT', 'red', () => this.actions.onExitToLevels && this.actions.onExitToLevels()
      )
    });

    this.pauseCol.add([this.resumeBtn, this.resumeMenuBtn, this.restartBtn, this.exitBtn]);
    // entrance-stagger anchors (buttons rise up into their spot on open)
    this.pauseStack = [this.resumeBtn, this.resumeMenuBtn, this.restartBtn, this.exitBtn];
    for (const b of this.pauseStack) b.baseY = b.y;

    // Exit-fullscreen control — ONLY while the document is actually
    // fullscreen (the FullscreenController in the game registry owns the
    // state; syncFullscreen flips visibility). Kept out of the reference
    // stack as a small corner control; exiting must never touch the pause
    // itself: the game stays frozen until PLAY/RESUME.
    this.fsBtn = woodButton(s, {
      x: -WORLD.WIDTH / 2 + 104, y: WORLD.HEIGHT / 2 - 54, w: 168, h: 40,
      label: 'EXIT FULLSCREEN', color: 'slate', size: 13,
      onClick: () => {
        this.audio?.emit('ui-click');
        this.actions.onExitFullscreen && this.actions.onExitFullscreen();
      },
      markUi: () => this.markUi()
    });
    this.fsBtn.setAlpha(0.88).setVisible(false);

    /* confirmation card (hidden until EXIT TO LEVELS asks for it) */
    this.confirmCard = s.add.container(0, 0).setVisible(false);
    // interactive blocker slightly larger than the card: a tap on the
    // card's parchment (not on YES/CANCEL) must never fall through to the
    // PLAY button underneath.
    const cBlocker = s.add.rectangle(0, 0, 424, 274, 0x000000, 0.001)
      .setInteractive({ useHandCursor: false });
    cBlocker.on('pointerdown', () => this.markUi());
    const cCard = woodPanel(s, 0, 0, 400, 250);
    const cInner = woodPanel(s, 0, 0, 368, 216, 'parch');
    this.confirmTitle = chunkyText(s, 0, -74, '', 26, '#a4323f', 0xffffff, 0).setOrigin(0.5);
    this.confirmBody = s.add.text(0, -20, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '17px',
      color: '#5c3a1e', align: 'center', wordWrap: { width: 330 }
    }).setOrigin(0.5);
    this.confirmYes = woodButton(s, {
      x: -92, y: 72, w: 168, h: 54, label: 'YES', color: 'red', size: 19,
      onClick: () => this.runConfirm(), markUi: () => this.markUi()
    });
    this.confirmNo = woodButton(s, {
      x: 92, y: 72, w: 168, h: 54, label: 'CANCEL', color: 'green', size: 19,
      onClick: () => this.hideConfirm(), markUi: () => this.markUi()
    });
    this.confirmCard.add([cBlocker, cCard, cInner, this.confirmTitle, this.confirmBody,
      this.confirmYes, this.confirmNo]);

    this.menu.add([this.scrim, this.pauseCol, this.fsBtn, this.confirmCard]);

    // Fix #22 — subtle desktop-only hover ticks on the interactive targets
    for (const b of [this.fsBtn, this.confirmYes, this.confirmNo]) {
      this.wireHover(b);
    }

    // Fullscreen state wiring: the corner control mirrors the real document
    // state (never a stale guess). Headless/test envs without the registry
    // controller simply keep it hidden.
    this.fsController = this.scene.registry.get('fullscreen') || null;
    if (this.fsController) {
      this.onFsState = (next) => this.syncFullscreen(next === 'active');
      this.offFsState = this.fsController.onChange(this.onFsState);
      this.syncFullscreen(this.fsController.isFullscreen);
    }
  }

  /**
   * Show/hide the pause-menu EXIT FULLSCREEN control. Pure presentation —
   * the state comes from the FullscreenController; exiting resizes the
   * canvas via the existing fullscreenchange → ViewportController path.
   */
  syncFullscreen(active) {
    this.fsBtn?.setVisible(!!active);
  }

  _scaleResume(to, duration = 110) {
    this.scene.tweens.add({
      targets: this.resumeBtn, scale: to, duration, ease: 'Sine.easeOut', overwrite: true
    });
  }

  /** True while the pause overlay's exit confirmation card is on screen. */
  get confirmVisible() {
    return !!(this.confirmCard && this.confirmCard.visible);
  }

  /**
   * SUBTLE BLUR on the GAMEPLAY camera only — the scenery KEEPS ITS COLORS
   * (no grayscale: the frozen world stays recognizable behind the dark
   * scrim, matching the reference). The HUD renders through its own camera
   * and stays sharp and colored. Mobile uses the cheaper blur tier;
   * Canvas-rendered sessions fall back to a deeper dim (graceful, still
   * clearly paused, still colorful). Applied once per pause — the scene is
   * frozen behind it, nothing re-renders beyond the camera quad.
   */
  applyPauseFx() {
    const s = this.scene;
    const webgl = s.game.renderer && s.game.renderer.type === Phaser.WEBGL;
    const cam = s.cameras.main;
    if (!webgl || !cam || !cam.postFX) {
      this.scrim?.setFillStyle(PAUSE_UI.SCRIM, PAUSE_UI.SCRIM_ALPHA_FLAT);
      return;
    }
    const mobile = (s.registry.get('device') || { type: 'desktop' }).type === 'mobile';
    try {
      this.pauseBlur = cam.postFX.addBlur(
        1, 0, 0, mobile ? 0.6 : 0.85, 0xffffff, mobile ? 2 : 3
      );
    } catch (e) {
      DebugLog.warn('pause post-fx unavailable: ' + (e.message || e));
      this.pauseBlur = null;
      this.scrim?.setFillStyle(PAUSE_UI.SCRIM, PAUSE_UI.SCRIM_ALPHA_FLAT);
    }
  }

  /** Ease the blur out alongside the menu fade (then detach the fx). */
  fadePauseFx() {
    const cam = this.scene.cameras && this.scene.cameras.main;
    if (!this.pauseBlur || !cam || !cam.postFX) return;
    const blur = this.pauseBlur;
    if (this.reducedMotion) {
      cam.postFX.remove(blur);
      this.pauseBlur = null;
      return;
    }
    this.scene.tweens.add({
      targets: blur, strength: 0, duration: 260, ease: 'Sine.easeOut',
      onComplete: () => {
        this.pauseBlur = null;
        try { cam.postFX && cam.postFX.remove(blur); } catch (e) { /* camera gone */ }
      }
    });
  }

  /** Restore the normal colorful gameplay presentation immediately. */
  removePauseFx() {
    const cam = this.scene.cameras && this.scene.cameras.main;
    try {
      if (cam && cam.postFX) {
        if (this.pauseBlur) {
          this.scene.tweens.killTweensOf(this.pauseBlur);
          cam.postFX.remove(this.pauseBlur);
        }
      }
    } catch (e) { /* camera already gone (scene restarting) */ }
    this.pauseBlur = null;
    this.scrim?.setFillStyle(PAUSE_UI.SCRIM, PAUSE_UI.SCRIM_ALPHA);
  }

  /** Very soft breathing glow around the play button (open → close). */
  startGlowPulse() {
    if (this.reducedMotion || !this.resumeGlow) return;
    this.scene.tweens.add({
      targets: this.resumeGlow,
      alpha: { from: 0.09, to: 0.17 },
      duration: 1300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut'
    });
  }

  stopGlowPulse() {
    if (!this.resumeGlow) return;
    this.scene.tweens.killTweensOf(this.resumeGlow);
    this.resumeGlow.setAlpha(0.13);
  }

  /**
   * Gate every pause control's input. Disabled the moment closing starts,
   * so the exit animation can never be tapped into a second resume/pause
   * flip; re-armed on the next open.
   */
  setPauseInputEnabled(on) {
    for (const b of this.pauseStack || []) {
      if (!b) continue;
      if (on) {
        if (!b.input) b.setInteractive({ useHandCursor: true });
      } else if (b.input) {
        b.disableInteractive();
      }
    }
  }

  /** Very soft hover tick — desktop pointers only (Fix #22). */
  wireHover(btn) {
    if (!btn || !this.isDesktop) return;
    btn.on('pointerover', () => this.audio?.emit('ui-hover'));
  }

  confirm(title, body, yesLabel, yesColor, action) {
    this.confirmTitle.setText(title);
    this.confirmBody.setText(body);
    this.confirmYes.labelText.setText(yesLabel);
    this.confirmYes.bg.setTexture(btnTex(yesColor));
    this.pendingConfirm = action;
    this.confirmCard.setVisible(true);
  }

  hideConfirm() {
    this.pendingConfirm = null;
    this.confirmCard.setVisible(false);
  }

  runConfirm() {
    const action = this.pendingConfirm;
    this.hideConfirm();
    if (action) action();
  }

  /* ---------------------------------------------------------------- */
  /* State sync (single funnel from GameScene.refreshHUD)              */
  /* ---------------------------------------------------------------- */

  /**
   * @param {object} snap {
   *   levelId, levelName, questionIndex, questionTotal, shotsLeft,
   *   projectileKey, score, heartsRemaining, questionsCompleted,
   *   starThresholds:{two,three}, state, soundOn
   * }
   */
  sync(snap) {
    this.setLevelTexts(snap.levelId, snap.levelName);

    this.questionText.setText(`Q ${snap.questionIndex + 1}/${snap.questionTotal}`);

    // shots — live bird artwork of the selected projectile, aspect kept
    this.shotsText.setText(`×${snap.shotsLeft}`);
    const visual = projectileVisual(snap.projectileKey, this.scene.textures, 15);
    if (this.shotsBird.texture.key !== visual.texture) this.shotsBird.setTexture(visual.texture);
    const frame = this.scene.textures.getFrame(visual.texture);
    const win = HUD_ART.shots.inner;
    const winH = (win.y1 - win.y0 - 0.03) * this.layout.elements.shots.h;
    const boxW = this.shotsMaxX - this.shotsText.x;
    const k = Math.min(this.layout.type.shotsIcon / frame.height, winH / frame.height,
      boxW / frame.width);
    this.shotsBird.setDisplaySize(frame.width * k, frame.height * k);
    if (snap.shotsLeft < this.lastShotsLeft && this.lastShotsLeft >= 0) this.pulseShots();
    this.lastShotsLeft = snap.shotsLeft;

    // hearts (skip the one mid loss-animation — it swaps itself)
    for (let i = 0; i < this.heartIcons.length; i++) {
      if (this.heartAnim && this.heartAnim.index === i) {
        if (this.scene.time.now >= this.heartAnim.until) this.heartAnim = null;
        else continue;
      }
      const full = i < snap.heartsRemaining;
      this.heartIcons[i].setTexture(full ? TEX.heart : TEX.heartEmpty);
    }

    // score — count up to the authoritative value (display-only)
    this.setScore(snap.score);

    // stars — live progress toward the real thresholds
    const lit = [
      snap.questionsCompleted >= snap.questionTotal,          // 1 star = all questions
      snap.score >= (snap.starThresholds?.two ?? Infinity),  // 2 stars = two-threshold
      snap.score >= (snap.starThresholds?.three ?? Infinity) // 3 stars = three-threshold
    ];
    this.setStars(lit, snap.questionsCompleted / snap.questionTotal);

    // sound icon (the pause overlay no longer carries settings toggles —
    // the top-bar sound button is the existing authorized interface)
    this.soundIco.setTexture(snap.soundOn ? TEX.soundOn : TEX.soundOff);

    this.stateChip.setText(`STATE ${snap.state}`).setVisible(DebugLog.enabled);
  }

  /** LEVEL label + title, shrunk to the plaque's measured window. */
  setLevelTexts(levelId, name) {
    const short = this.layout.type.levelShort;
    this.levelTitle.setText(short ? `LV ${levelId}` : `LEVEL ${levelId}`);
    if (short) return;
    const t = this.levelName;
    let size = this.layout.type.levelTitle;
    const maxW = this.levelTitleMaxW;
    for (;;) {
      t.setStyle({ fontSize: `${size}px` });
      t.setText(name || '');
      if (t.width <= maxW || size <= 8.5) break;
      size -= 0.5;
    }
  }

  setScore(target) {
    this.scoreTarget = target;
    if (this.reducedMotion) {
      this.displayScore = target;
      this.scoreText.setText(formatScore(target));
      return;
    }
    if (target === this.displayScore) return;
    const from = this.displayScore;
    this.scene.tweens.killTweensOf(this.scoreTweenObj || (this.scoreTweenObj = { v: from }));
    const tween = this.scoreTweenObj;
    tween.v = from;
    this.scene.tweens.add({
      targets: tween,
      v: target,
      duration: Math.min(900, 220 + Math.abs(target - from) * 0.35),
      ease: 'Cubic.out',
      onUpdate: () => {
        this.displayScore = tween.v;
        this.scoreText.setText(formatScore(tween.v));
      },
      onComplete: () => {
        // never restore an outdated value if a newer target arrived mid-tween
        this.displayScore = this.scoreTarget;
        this.scoreText.setText(formatScore(this.scoreTarget));
      }
    });
  }

  setStars(lit, q1Progress) {
    const shown = this.starIcons.length;
    for (let i = 0; i < shown; i++) {
      const was = this.starLit[i];
      const now = !!lit[i];
      this.starIcons[i].full.setVisible(now);
      if (now && !was && !this.reducedMotion) {
        const g = this.starIcons[i].group;
        this.scene.tweens.killTweensOf(g);
        this.scene.tweens.add({
          targets: g, scale: 1.45, duration: 160, yoyo: true, ease: 'Quad.out'
        });
      }
      this.starLit[i] = now;
    }
    // star 1 doubles as a question-progress dial while the level runs
    // (the phone's single star IS this dial)
    const p = Math.max(0, Math.min(1, q1Progress));
    if (p !== this.star1Progress) {
      this.star1Progress = p;
      const fill = lit[0] ? 1 : p;            // fills bottom-up with progress
      this.starIcons[0].full.setCrop(0, 56 * (1 - fill), 56, 56 * fill);
      if (!lit[0]) this.starIcons[0].full.setVisible(p > 0.02);
    }
  }

  /** Per-frame countdown refresh (cheap: only redraws on text change). */
  setTimer(remainingMs) {
    const total = Math.max(0, remainingMs);
    const secs = Math.ceil(total / 1000);
    const text = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      this.timerText.setText(text);
    }
    const low = total <= HUD.LOW_TIME_MS;
    if (low !== this.timerLowActive) {
      this.timerLowActive = low;
      this.timerText.setColor(low ? '#c1121f' : PAL.textDark);
      this.scene.tweens.killTweensOf(this.timerText);
      this.timerText.setScale(1);
      if (low && !this.reducedMotion) {
        this.scene.tweens.add({
          targets: this.timerText, scaleX: 1.07, scaleY: 1.07, duration: 480,
          yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });
      }
    }
  }

  /** Brief pulse of the shots counter right after a launch. */
  pulseShots() {
    if (this.reducedMotion) return;
    this.scene.tweens.killTweensOf(this.shotsText);
    this.shotsText.setScale(1);
    this.scene.tweens.add({
      targets: this.shotsText, scaleX: 1.3, scaleY: 1.3, duration: 110,
      yoyo: true, ease: 'Quad.out'
    });
  }

  /** Animate one heart being lost (the authoritative value already moved). */
  onHeartLost(index) {
    const icon = this.heartIcons[index];
    if (!icon) return;
    this.heartAnim = { index, until: this.scene.time.now + 700 };
    if (this.reducedMotion) {
      icon.setTexture(TEX.heartEmpty);
      return;
    }
    this.scene.tweens.killTweensOf(icon);
    this.scene.tweens.add({
      targets: icon, scale: 1.5, duration: 170, yoyo: false, ease: 'Quad.out',
      onComplete: () => {
        icon.setTexture(TEX.heartEmpty);
        this.scene.tweens.add({
          targets: icon, scale: 0.55, duration: 200, ease: 'Back.out',
          onComplete: () => icon.setScale(1)
        });
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Pause menu open/close                                             */
  /* ---------------------------------------------------------------- */
  get pauseOpen() {
    return this.pauseOpenState;
  }

  /**
   * Open choreography (≈340ms total, no bounce-fests):
   *   1. the frozen scenery darkens under the scrim (240ms fade-in)
   *   2. the wooden PLAY button fades in with a gentle dimensional pop
   *   3. the three controls rise in beneath it, staggered 80ms apart
   */
  openPause() {
    if (this.pauseOpenState) return;
    this.pauseOpenState = true;
    this.hideConfirm();
    this.applyPauseFx(); // subtle color-keeping blur, once per pause
    const s = this.scene;
    const items = [this.scrim, ...this.pauseStack];
    s.tweens.killTweensOf(items);
    this.menu.setVisible(true);
    this.setPauseInputEnabled(true);
    // resting transforms (also the reduced-motion end state)
    this.scrim.setAlpha(1);
    for (const b of this.pauseStack) {
      b.setAlpha(1);
      b.setScale(1);
      b.y = b.baseY;
    }
    if (this.reducedMotion) return;

    // 1) darken the frozen scenery
    this.scrim.setAlpha(0);
    s.tweens.add({
      targets: this.scrim, alpha: 1, duration: 240, ease: 'Sine.easeOut'
    });
    // 2) the play button appears — fade + soft overshoot to full size
    this.resumeBtn.setAlpha(0).setScale(0.7);
    s.tweens.add({
      targets: this.resumeBtn, alpha: 1, duration: 200, ease: 'Sine.easeOut'
    });
    s.tweens.add({
      targets: this.resumeBtn, scale: 1, duration: 340, delay: 30, ease: 'Back.easeOut'
    });
    // 3) the three controls appear smoothly beneath it
    for (let i = 0; i < 3; i++) {
      const btn = this.pauseStack[i + 1];
      btn.setAlpha(0);
      btn.y = btn.baseY - 16;
      const delay = 150 + i * PAUSE_UI.STAGGER_MS;
      s.tweens.add({
        targets: btn, alpha: 1, duration: 250, delay, ease: 'Sine.easeOut'
      });
      s.tweens.add({
        targets: btn, y: btn.baseY, duration: 320, delay, ease: 'Cubic.easeOut'
      });
    }
    this.startGlowPulse();
  }

  /**
   * Close choreography: input dies FIRST (a mid-animation tap can never
   * re-pause the just-resumed game), then the controls and scrim fade out
   * (~200ms) while the blur eases back to zero — the colorful gameplay
   * returns exactly where it was frozen.
   */
  closePause() {
    if (!this.pauseOpenState) return;
    this.pauseOpenState = false;
    this.hideConfirm();
    this.setPauseInputEnabled(false);
    this.stopGlowPulse();
    this.fadePauseFx();
    const s = this.scene;
    const items = [this.scrim, ...this.pauseStack];
    s.tweens.killTweensOf(items);
    if (this.reducedMotion) {
      this.menu.setVisible(false);
      this.scrim.setAlpha(0);
      return;
    }
    s.tweens.add({
      targets: items, alpha: 0, duration: 200, ease: 'Sine.easeIn',
      onComplete: () => this.menu.setVisible(false)
    });
  }

  destroy() {
    const s = this.scene;
    this.stopGlowPulse();
    this.removePauseFx(); // never leave blur on a surviving camera
    if (this.offFsState) this.offFsState(); // drop the fullscreen subscription
    s.tweens.killTweensOf([this.menu, this.scrim,
      ...(this.pauseStack || []), this.timerText, this.shotsText,
      ...this.heartIcons, ...this.starIcons.map((x) => x.group)]);
    if (this.onUiChildAdded) s.events.off('addedtoscene', this.onUiChildAdded);
    if (this.onUiScaleResize) s.scale.off('resize', this.onUiScaleResize);
    if (this.uiCam) s.cameras.remove(this.uiCam);
    this.uiCam = null;
    this.root?.destroy();
    this.menu?.destroy();
    this.root = this.menu = null;
  }
}
