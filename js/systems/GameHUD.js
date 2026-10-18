/**
 * GameHUD — the top gameplay interface over the supplied wooden artwork.
 *
 *   LEFT    round pause button + level plaque (LEVEL n + name, "LV n" on phones)
 *   CENTER  three-compartment panel: Q n/total | clock + MM:SS | stars
 *   RIGHT   hearts panel | shots panel (bird portrait + ×N) | score | sound
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
  soundOn: 'wbhud-sound-on',
  soundOff: 'wbhud-sound-off',
  coin: 'wbhud-coin',
  round: 'wbhud-round-btn'
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

/* ------------------------------------------------------------------ */
/* The HUD                                                             */
/* ------------------------------------------------------------------ */
export class GameHUD {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} actions gameplay callbacks:
   *   onPause, onResume, onRestartQuestion, onRestartLevel, onExitToLevels,
   *   onToggleSound, onToggleReducedMotion
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
    this.scoreText.setFixedSize(Math.ceil(TY.score * 0.64 * 7) + 4, Math.ceil(TY.score * 1.3));

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
  /* Pause menu                                                        */
  /* ---------------------------------------------------------------- */
  buildPauseMenu() {
    const s = this.scene;
    this.menu = s.add.container(WORLD.WIDTH / 2, WORLD.HEIGHT / 2).setDepth(HUD_DEPTH.MENU).setVisible(false);

    const scrim = s.add.rectangle(0, 0, WORLD.WIDTH, WORLD.HEIGHT, 0x08131f, 0.62)
      .setInteractive({ useHandCursor: false }); // swallows gameplay taps
    scrim.on('pointerdown', () => this.markUi());

    const card = woodPanel(s, 0, 0, 470, 560);
    const inner = woodPanel(s, 0, 0, 436, 526, 'parch');
    const title = chunkyText(s, 0, -232, 'PAUSED', 42, PAL.textLight, 0x3a2410, 6).setOrigin(0.5);

    const mk = (color, label, y, onClick) => woodButton(s, {
      x: 0, y, w: 330, h: 58, label, color, size: 21,
      onClick: () => {
        this.audio?.emit('ui-click'); // Fix #22 — click polish
        onClick();
      },
      markUi: () => this.markUi()
    });

    this.resumeBtn = mk('green', 'RESUME', -150, () => this.actions.onResume && this.actions.onResume());
    this.restartQBtn = mk('blue', 'RESTART QUESTION', -82, () => this.actions.onRestartQuestion && this.actions.onRestartQuestion());
    this.restartLBtn = mk('orange', 'RESTART LEVEL', -14, () => this.confirm(
      'RESTART LEVEL?', 'All progress in this level will be lost.',
      'YES, RESTART', 'red', () => this.actions.onRestartLevel && this.actions.onRestartLevel()
    ));
    // Fix #22 — audio settings row: three compact toggles (master gate,
    // music channel, effects channel) replacing the single SOUND button.
    const toggle = (x, label, action) => woodButton(s, {
      x, y: 54, w: 132, h: 46, label, color: 'teal', size: 14,
      // the GameScene toggle handlers emit their own ui-click — no double
      onClick: action, markUi: () => this.markUi()
    });
    this.soundMenuBtn = toggle(-138, 'SOUND ON', () => this.actions.onToggleSound && this.actions.onToggleSound());
    this.musicMenuBtn = toggle(0, 'MUSIC ON', () => this.actions.onToggleMusic && this.actions.onToggleMusic());
    this.sfxMenuBtn = toggle(138, 'FX ON', () => this.actions.onToggleSfx && this.actions.onToggleSfx());
    this.exitBtn = mk('slate', 'EXIT TO LEVELS', 122, () => this.confirm(
      'EXIT LEVEL?', 'Your progress in this level will be lost.',
      'YES, EXIT', 'red', () => this.actions.onExitToLevels && this.actions.onExitToLevels()
    ));
    this.motionBtn = woodButton(s, {
      x: 0, y: 190, w: 330, h: 42, label: 'REDUCED MOTION: OFF', color: 'slate', size: 15,
      onClick: () => this.actions.onToggleReducedMotion && this.actions.onToggleReducedMotion(),
      markUi: () => this.markUi()
    });

    const hint = s.add.text(0, 236, 'Press P to pause / resume', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '14px',
      color: '#7a5c33'
    }).setOrigin(0.5);

    /* confirmation card (hidden until asked for) */
    this.confirmCard = s.add.container(0, 0).setVisible(false);
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
    this.confirmCard.add([cCard, cInner, this.confirmTitle, this.confirmBody, this.confirmYes, this.confirmNo]);

    this.menu.add([scrim, card, inner, title, this.resumeBtn, this.restartQBtn,
      this.restartLBtn, this.soundMenuBtn, this.musicMenuBtn, this.sfxMenuBtn,
      this.exitBtn, this.motionBtn, hint, this.confirmCard]);
    this.menu.setScale(0.92).setAlpha(0);

    // Fix #22 — subtle desktop-only hover ticks on the interactive targets
    for (const b of [this.resumeBtn, this.restartQBtn, this.restartLBtn,
      this.soundMenuBtn, this.musicMenuBtn, this.sfxMenuBtn, this.exitBtn,
      this.motionBtn, this.confirmYes, this.confirmNo]) {
      this.wireHover(b);
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

    // sound icon + Fix #22 audio toggles (music defaults ON for old saves)
    this.soundIco.setTexture(snap.soundOn ? TEX.soundOn : TEX.soundOff);
    this.soundMenuBtn.labelText.setText(snap.soundOn ? 'SOUND ON' : 'SOUND OFF');
    const musicOn = snap.musicOn !== false;
    const sfxOn = snap.sfxOn !== false;
    this.musicMenuBtn.labelText.setText(musicOn ? 'MUSIC ON' : 'MUSIC OFF');
    this.sfxMenuBtn.labelText.setText(sfxOn ? 'FX ON' : 'FX OFF');
    this.musicMenuBtn.setAlpha(musicOn && snap.soundOn ? 1 : 0.75);
    this.sfxMenuBtn.setAlpha(sfxOn && snap.soundOn ? 1 : 0.75);
    this.motionBtn.labelText.setText(this.reducedMotion ? 'REDUCED MOTION: ON' : 'REDUCED MOTION: OFF');

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

  openPause() {
    if (this.pauseOpenState) return;
    this.pauseOpenState = true;
    this.hideConfirm();
    this.menu.setVisible(true);
    this.scene.tweens.killTweensOf(this.menu);
    if (this.reducedMotion) {
      this.menu.setAlpha(1).setScale(1);
      return;
    }
    this.menu.setAlpha(0).setScale(0.92);
    this.scene.tweens.add({
      targets: this.menu, alpha: 1, scale: 1, duration: 190, ease: 'Back.out'
    });
  }

  closePause() {
    if (!this.pauseOpenState) return;
    this.pauseOpenState = false;
    this.hideConfirm();
    this.scene.tweens.killTweensOf(this.menu);
    if (this.reducedMotion) {
      this.menu.setVisible(false).setAlpha(1).setScale(1);
      return;
    }
    this.scene.tweens.add({
      targets: this.menu, alpha: 0, scale: 0.94, duration: 130,
      onComplete: () => this.menu.setVisible(false)
    });
  }

  destroy() {
    const s = this.scene;
    s.tweens.killTweensOf([this.menu, this.timerText, this.shotsText, ...this.heartIcons,
      ...this.starIcons.map((x) => x.group)]);
    if (this.onUiChildAdded) s.events.off('addedtoscene', this.onUiChildAdded);
    if (this.onUiScaleResize) s.scale.off('resize', this.onUiScaleResize);
    if (this.uiCam) s.cameras.remove(this.uiCam);
    this.uiCam = null;
    this.root?.destroy();
    this.menu?.destroy();
    this.root = this.menu = null;
  }
}
