/**
 * Level select (Fix #23) — the cartoon adventure level-selection page.
 *
 * Presentation (matching the supplied reference as closely as the game's
 * own art system allows, every element an independent Phaser object —
 * nothing is baked into the background):
 *   1. the official fantasy landscape (same art family as the main menu:
 *      bright sky, snowy mountains, waterfalls, cliff village, lake,
 *      grass/flowers, the painted red bird lower-left), cover-fitted,
 *      never stretched, plus a soft warm haze behind the grid so the cards
 *      read clearly without darkening the scenery;
 *   2. a large wooden hanging SELECT LEVEL sign — ropes from above,
 *      golden lettering, leaves, metal bolts — entering with a gentle
 *      slide + settling swing (once, never looping);
 *   3. a wooden MENU button (golden back arrow + leaves) upper-left;
 *   4. exactly 15 LevelCard components in the classic 5×3 grid, generated
 *      from LevelManager data + SaveManager progress (numbers, names and
 *      stars are never hardcoded; locked levels wear a metallic padlock);
 *   5. a soft golden highlight on the next playable level;
 *   6. a one-time celebratory reveal for a GENUINELY newly unlocked level
 *      (registry snapshot — the same unlock is never replayed).
 *
 * Behaviour contracts are unchanged: sequential unlocking via the existing
 * SaveManager, ui-click sounds, GameScene { levelId } starts, MENU returns
 * without a page reload, and rapid clicks can never double-transition.
 * Reduced Motion swaps every animation for instant presentation.
 */
import Phaser from 'phaser';
import { SAVE, WORLD } from '../config.js';
import { attachViewport } from '../systems/Viewport.js';
import { PALETTE, menuText, drawWoodSlab, drawParchment, drawLeaf } from '../systems/MenuUI.js';
import { LevelCard, ensureLevelCardTextures, paintBolt, CARD_ART } from '../systems/LevelCard.js';
import { computeLevelGrid } from '../systems/LevelGridLayout.js';
import {
  LEVEL_SELECT_ART, levelSelectPreloadList, ensureLevelSelectArtFallback,
  isLevelSelectFallbackTexture, LevelSelectBackground, buildLevelSelectAtmosphere
} from '../systems/LevelSelectBackground.js';
import { playLevelUnlock } from '../systems/LevelUnlockAnimation.js';

/** Registry key: highest unlocked level this game instance has already
 *  displayed (drives the one-time unlock celebration). */
const SEEN_KEY = 'lvlselSeenUnlocked';

/** Fixed-world layout (1280×720; the camera always shows the whole world). */
const LAYOUT = {
  title: { x: WORLD.WIDTH / 2, y: 116, w: 540, h: 104 },
  back: { x: 110, y: 54, w: 142, h: 60 },
  toastY: 188
};

export class LevelSelectScene extends Phaser.Scene {
  constructor() {
    super('LevelSelectScene');
  }

  preload() {
    // Same official landscape the menu uses (clean of any UI elements);
    // a procedural stand-in under the same key keeps headless envs alive.
    const BASE = ((import.meta.env && import.meta.env.BASE_URL) || '/') + 'assets/images/menu/';
    for (const { key, file } of levelSelectPreloadList()) {
      this.load.image(key, BASE + file);
    }
    this.load.on('loaderror', (file) => ensureLevelSelectArtFallback(this, file.key));
  }

  create() {
    const save = this.registry.get('save');
    const levels = this.registry.get('levels');
    this.audio = this.registry.get('audio');
    this.save = save;
    this.levels = levels;
    this.transitioning = false;
    this.reducedMotion = !!(save && save.data && save.data.settings && save.data.settings.reducedMotion);

    // Decorative card artwork — generated once, cached game-wide.
    ensureLevelCardTextures(this);

    // Grid geometry first (pure) — the atmosphere centres on it.
    this.grid = computeLevelGrid(WORLD.WIDTH, WORLD.HEIGHT, SAVE.MAX_LEVELS);

    // A genuinely-new unlock renders in its LOCKED look first so the
    // celebration has something to reveal (snapshot updates immediately).
    this.celebrationId = this.computeCelebrationId();
    this.highlightId = this.computeHighlightId();

    // 1) scenery + atmospheric separation
    this.background = new LevelSelectBackground(this);
    this.atmosphere = buildLevelSelectAtmosphere(this, {
      x: this.grid.positions[0].x - this.grid.cardW / 2,
      y: this.grid.positions[0].y - this.grid.cardH / 2,
      width: (this.grid.cols - 1) * (this.grid.cardW + this.grid.gapX) + this.grid.cardW,
      height: (this.grid.rows - 1) * (this.grid.cardH + this.grid.gapY) + this.grid.cardH
    });
    this.viewport = attachViewport(this, (view) => this.background.fit(view));
    this.background.fit(this.viewport.view);

    // 2–4) the UI
    this.buildTitleSign();
    this.buildBackButton();
    this.buildCards();

    // 5) golden next-playable highlight
    this.applyHighlight();
    this.buildAllCompleteRibbon();

    this.playEntrance();
    this.events.once('shutdown', () => this.cleanup());
  }

  /* ---------------------------------------------------------------- */
  /* Title sign                                                        */
  /* ---------------------------------------------------------------- */

  buildTitleSign() {
    const { x, y, w, h } = LAYOUT.title;
    const c = this.add.container(x, y).setDepth(20);
    this.titleSign = c;

    // hanging ropes (drawn to exit the top of ANY aspect's visible view)
    const ropes = this.add.graphics();
    for (const side of [-1, 1]) {
      const x0 = side * (w / 2 - 41), y0 = -h / 2 + 10;
      const x1 = side * 560, y1 = -298;
      ropes.lineStyle(8, 0x6b4a26, 1);
      ropes.beginPath();
      ropes.moveTo(x0, y0);
      ropes.lineTo(x1, y1);
      ropes.strokePath();
      ropes.lineStyle(2.5, 0x93683a, 0.9);
      ropes.beginPath();
      ropes.moveTo(x0 - side * 2, y0 - 2);
      ropes.lineTo(x1 - side * 2, y1 - 2);
      ropes.strokePath();
      // knots where the ropes meet the plank
      ropes.fillStyle(0x000000, 0.2);
      ropes.fillCircle(x0, y0 + 3, 9);
      ropes.fillStyle(0x4d3218, 1);
      ropes.fillCircle(x0, y0, 8);
      ropes.fillStyle(0x8a6238, 1);
      ropes.fillCircle(x0, y0 - 1, 4.5);
    }
    c.add(ropes);

    // carved wooden plank
    const slab = this.add.graphics();
    slab.fillStyle(0x000000, 0.10);
    slab.fillRoundedRect(-w / 2 - 3, -h / 2 + 8, w + 6, h + 3, 34);
    slab.fillStyle(0x000000, 0.22);
    slab.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, 30);
    drawWoodSlab(slab, w, h, 30, 'primary');
    slab.lineStyle(2.5, 0x8a5a2b, 0.7);
    slab.strokeRoundedRect(-w / 2 + 12, -h / 2 + 12, w - 24, h - 24, 22);
    c.add(slab);

    // metal bolts on the corners
    const bolts = this.add.graphics();
    const bx = w / 2 - 30, by = h / 2 - 26;
    paintBolt(bolts, -bx, -by, 9);
    paintBolt(bolts, bx, -by, 9);
    paintBolt(bolts, -bx, by, 9);
    paintBolt(bolts, bx, by, 9);
    c.add(bolts);

    // decorative leaves over the top corners
    const leaves = this.add.graphics();
    drawLeaf(leaves, -w / 2 + 16, -h / 2 + 2, 34, -0.55);
    drawLeaf(leaves, w / 2 - 16, -h / 2 + 2, 34, 0.55);
    drawLeaf(leaves, -w / 2 + 34, h / 2 - 4, 24, 0.6);
    drawLeaf(leaves, w / 2 - 34, h / 2 - 4, 24, -0.6);
    c.add(leaves);

    // golden lettering with a white outline + soft carved shadow
    const label = menuText(this, 0, 2, 'SELECT LEVEL', {
      fontFamily: '"Arial Black", "Segoe UI Black", Arial, sans-serif',
      fontStyle: 'bold', fontSize: '46px', color: '#ffdd55',
      stroke: '#ffffff', strokeThickness: 5
    });
    label.setShadow(0, 4, '#000000', 7, false, true);
    c.add(label);
  }

  /** Entrance: slide down + a short settling swing (once). */
  swingSign() {
    this.tweens.chain({
      targets: this.titleSign,
      tweens: [
        { angle: 2.4, duration: 220, ease: 'Sine.easeInOut' },
        { angle: -1.4, duration: 260, ease: 'Sine.easeInOut' },
        { angle: 0.6, duration: 220, ease: 'Sine.easeInOut' },
        { angle: 0, duration: 180, ease: 'Sine.easeInOut' }
      ]
    });
  }

  /* ---------------------------------------------------------------- */
  /* Back (MENU) button                                                */
  /* ---------------------------------------------------------------- */

  buildBackButton() {
    const { x, y, w, h } = LAYOUT.back;
    const c = this.add.container(x, y).setDepth(20);
    this.backButton = { container: c };

    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.10);
    shadow.fillRoundedRect(-w / 2 - 3, -h / 2 + 7, w + 6, h + 3, 22);
    shadow.fillStyle(0x000000, 0.22);
    shadow.fillRoundedRect(-w / 2, -h / 2 + 5, w, h, 20);
    c.add(shadow);

    const face = this.add.graphics();
    drawWoodSlab(face, w, h, 20, 'primary');
    c.add(face);

    // golden back arrow (dark carved edge + gold core + tail)
    const arrow = this.add.graphics();
    const ax = -26;
    arrow.fillStyle(0x7a4c12, 1);
    arrow.fillPoints([
      { x: ax - 13, y: -13 }, { x: ax + 11, y: 0 }, { x: ax - 13, y: 13 },
      { x: ax - 6, y: 0 }
    ], true);
    arrow.fillStyle(0xffcf4d, 1);
    arrow.fillPoints([
      { x: ax - 10, y: -9 }, { x: ax + 6, y: 0 }, { x: ax - 10, y: 9 },
      { x: ax - 4, y: 0 }
    ], true);
    arrow.fillStyle(0x7a4c12, 1);
    arrow.fillRoundedRect(ax + 4, -4, 15, 8, 3);
    arrow.fillStyle(0xffcf4d, 1);
    arrow.fillRoundedRect(ax + 6, -2.5, 11, 5, 2);
    c.add(arrow);

    const label = menuText(this, 16, 2, 'MENU', {
      fontFamily: '"Arial Black", "Segoe UI Black", Arial, sans-serif',
      fontStyle: 'bold', fontSize: '22px',
      color: PALETTE.cream, stroke: PALETTE.creamStroke, strokeThickness: 4
    });
    c.add(label);

    const leaves = this.add.graphics();
    drawLeaf(leaves, -w / 2 + 10, -h / 2 + 4, 26, -0.5);
    drawLeaf(leaves, w / 2 - 12, h / 2 - 3, 20, -0.6);
    c.add(leaves);

    const hover = this.add.graphics();
    hover.fillStyle(0xffffff, 1);
    hover.fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 16);
    hover.setAlpha(0);
    c.add(hover);

    c.setSize(w, h);
    c.setInteractive({
      hitArea: new Phaser.Geom.Rectangle(0, 0, w, h),
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true
    });
    let hovered = false;
    c.on('pointerover', () => {
      hovered = true;
      if (!this.reducedMotion) this.tweens.add({ targets: c, scale: 1.05, duration: 110, ease: 'Sine.easeOut', overwrite: true });
      this.tweens.add({ targets: hover, alpha: 0.13, duration: 120, overwrite: true });
    });
    c.on('pointerout', () => {
      hovered = false;
      if (!this.reducedMotion) this.tweens.add({ targets: c, scale: 1, duration: 110, ease: 'Sine.easeOut', overwrite: true });
      this.tweens.add({ targets: hover, alpha: 0, duration: 120, overwrite: true });
    });
    c.on('pointerdown', () => {
      this.tweens.add({ targets: c, scale: 0.94, duration: 90, ease: 'Sine.easeOut', overwrite: true });
    });
    c.on('pointerup', () => {
      this.tweens.add({ targets: c, scale: hovered ? 1.05 : 1, duration: 90, ease: 'Sine.easeOut', overwrite: true });
      this.goMenu();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Cards                                                             */
  /* ---------------------------------------------------------------- */

  buildCards() {
    this.cards = new Map();
    this.grid.positions.forEach((pos, i) => {
      const id = i + 1;
      const lvl = this.levels ? this.levels.getLevel(id) : null;
      const entry = this.save ? this.save.getLevelEntry(id) : { bestStars: 0 };
      const unlocked = this.save ? this.save.isLevelUnlocked(id) : id === 1;
      // The celebration card waits in its locked look until the reveal.
      const visualUnlocked = unlocked && id !== this.celebrationId;
      const card = new LevelCard(this, {
        x: pos.x, y: pos.y,
        width: this.grid.cardW, height: this.grid.cardH,
        levelId: id,
        levelName: lvl ? lvl.name : '',
        stars: entry.bestStars,
        unlocked: visualUnlocked,
        reducedMotion: this.reducedMotion,
        onSelect: (c) => this.selectLevel(c.levelId),
        onLockedTap: (c) => this.onLockedCardTap(c)
      });
      this.cards.set(id, card);
    });
  }

  /**
   * Next playable level = first unlocked level the player has not
   * completed. Everything completed → the final level (display only; the
   * save is never touched).
   */
  computeHighlightId() {
    for (let id = 1; id <= SAVE.MAX_LEVELS; id++) {
      if (this.save.isLevelUnlocked(id) && !this.save.getLevelEntry(id).completed) return id;
    }
    return SAVE.MAX_LEVELS;
  }

  /**
   * A level is GENUINELY newly unlocked when the save's unlockedLevel
   * advanced past the highest value this game instance already showed.
   * The snapshot updates immediately, so revisits never re-animate.
   */
  computeCelebrationId() {
    const seen = this.registry.get(SEEN_KEY) || 0;
    const unlocked = this.save.unlockedLevel;
    this.registry.set(SEEN_KEY, Math.max(seen, unlocked));
    return seen > 0 && unlocked > seen ? unlocked : 0;
  }

  applyHighlight() {
    const id = this.highlightId;
    const card = this.cards.get(id);
    if (!card) return;
    if (this.celebrationId && id === this.celebrationId) {
      // the reveal swaps this card from its locked look first; its glow
      // arms together with the content
      card.setInteractionEnabled(false);
      return;
    }
    card.setHighlighted(true);
  }

  /* ---------------------------------------------------------------- */
  /* All-complete ribbon                                               */
  /* ---------------------------------------------------------------- */

  buildAllCompleteRibbon() {
    if (!this.save.allCompleted) return;
    const text = `All ${SAVE.MAX_LEVELS} levels complete — ${this.save.totalStars}/${SAVE.MAX_LEVELS * 3} stars!`;
    const probe = menuText(this, 0, 0, text, {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '17px', color: PALETTE.ink
    });
    const w = probe.width + 78;
    probe.destroy();

    const c = this.add.container(WORLD.WIDTH / 2, LAYOUT.toastY).setDepth(30);
    const g = this.add.graphics();
    drawParchment(g, w, 34, 12);
    c.add(g);
    const star = this.add.image(-w / 2 + 26, 0, CARD_ART.star).setDisplaySize(22, 22);
    c.add(star);
    c.add(menuText(this, 14, 1, text, {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '17px', color: PALETTE.ink
    }, [0, 0.5]));
    this.allCompleteRibbon = c;
  }

  /* ---------------------------------------------------------------- */
  /* Locked feedback toast                                             */
  /* ---------------------------------------------------------------- */

  showLockedToast() {
    const msg = 'Complete the previous level to unlock.';
    if (!this.toast) {
      const c = this.add.container(WORLD.WIDTH / 2, LAYOUT.toastY).setDepth(50);
      const probe = menuText(this, 0, 0, msg, {
        fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '16px', color: PALETTE.ink
      });
      const w = probe.width + 56;
      probe.destroy();
      const g = this.add.graphics();
      drawParchment(g, w, 32, 11);
      c.add(g);
      c.add(menuText(this, 0, 1, msg, {
        fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '16px', color: PALETTE.ink
      }));
      c.setAlpha(0);
      this.toast = c;
    }
    if (this.toastTween) this.toastTween.remove();
    const t = this.toast;
    t.setVisible(true).setAlpha(0);
    if (this.reducedMotion) {
      t.setAlpha(1);
      this.toastTween = this.tweens.add({
        targets: t, alpha: 0, duration: 200, delay: 1400,
        onComplete: () => t.setVisible(false)
      });
      return;
    }
    this.toastTween = this.tweens.add({
      targets: t, alpha: 1, duration: 140, ease: 'Sine.easeOut',
      onComplete: () => {
        this.toastTween = this.tweens.add({
          targets: t, alpha: 0, duration: 260, delay: 1500,
          onComplete: () => t.setVisible(false)
        });
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Interactions + navigation                                         */
  /* ---------------------------------------------------------------- */

  /** Locked cards never launch gameplay: soft chime + shake + hint. */
  onLockedCardTap(card) {
    if (this.transitioning) return;
    try {
      if (this.audio && typeof this.audio.play === 'function') {
        this.audio.play('ui-missed', { volume: 0.55 });
      } else {
        this.audio?.emit('ui-click');
      }
    } catch (e) {
      this.audio?.emit('ui-click');
    }
    card.shakeLocked();
    this.showLockedToast();
  }

  selectLevel(id) {
    if (this.transitioning) return;
    this.transitioning = true;
    this.audio?.emit('ui-click');
    this.lockUI();
    const go = () => this.scene.start('GameScene', { levelId: id });
    if (this.reducedMotion) {
      go();
    } else {
      this.cameras.main.fadeOut(280, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', go);
    }
  }

  goMenu() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.audio?.emit('ui-click');
    this.lockUI();
    const go = () => this.scene.start('MenuScene');
    if (this.reducedMotion) {
      go();
    } else {
      this.cameras.main.fadeOut(260, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', go);
    }
  }

  /** Disable every interactive element (transition / dialog guards). */
  lockUI() {
    this.cards.forEach((card) => card.setInteractionEnabled(false));
    this.backButton?.container.disableInteractive();
  }

  /* ---------------------------------------------------------------- */
  /* Entrance choreography + unlock celebration                        */
  /* ---------------------------------------------------------------- */

  playEntrance() {
    // genuinely-new unlock: reveal right after the cards settle in
    if (this.celebrationId) {
      const id = this.celebrationId;
      const card = this.cards.get(id);
      const reveal = () => {
        playLevelUnlock(this, card, {
          reducedMotion: this.reducedMotion,
          onDone: () => {
            card.setInteractionEnabled(true);
            if (id === this.highlightId) card.setHighlighted(true);
          }
        });
      };
      if (this.reducedMotion) reveal();
      else this.time.delayedCall(1400, reveal);
    }

    if (this.reducedMotion) return;

    this.cameras.main.fadeIn(240, 0, 0, 0);

    // sign slides gently downward, then settles with a short swing
    this.titleSign.setY(LAYOUT.title.y - 240).setAlpha(0);
    this.tweens.add({
      targets: this.titleSign, y: LAYOUT.title.y, alpha: 1,
      duration: 460, delay: 60, ease: 'Cubic.easeOut',
      onComplete: () => this.swingSign()
    });

    this.backButton.container.setAlpha(0);
    this.tweens.add({
      targets: this.backButton.container, alpha: 1,
      duration: 220, delay: 200
    });

    // staggered card pop-in (short — access is never gated long)
    let i = 0;
    this.cards.forEach((card) => {
      card.container.setAlpha(0).setScale(0.72);
      this.tweens.add({
        targets: card.container, alpha: 1, scale: 1,
        duration: 230, delay: 260 + i * 42, ease: 'Back.easeOut'
      });
      i++;
    });
  }

  /* ---------------------------------------------------------------- */
  /* Hygiene + debug                                                   */
  /* ---------------------------------------------------------------- */

  /** Scene shutdown: scene-owned objects die with the scene — only drop
   *  references so a restarted level select starts clean. */
  cleanup() {
    this.viewport = null;
    this.background = null;
    this.atmosphere = null;
    this.titleSign = null;
    this.backButton = null;
    this.cards = null;
    this.toast = null;
    this.toastTween = null;
    this.allCompleteRibbon = null;
  }

  /** Developer/debug-only snapshot (window.__WB__.levelSelect()). */
  levelSelectDebugInfo() {
    return {
      active: true,
      transitioning: this.transitioning,
      reducedMotion: this.reducedMotion,
      usingBackgroundArt: !isLevelSelectFallbackTexture(LEVEL_SELECT_ART.background.key),
      grid: {
        cols: this.grid.cols, rows: this.grid.rows,
        cardW: Math.round(this.grid.cardW), cardH: Math.round(this.grid.cardH),
        gapX: Math.round(this.grid.gapX), gapY: Math.round(this.grid.gapY)
      },
      highlightId: this.highlightId,
      celebrationId: this.celebrationId,
      unlockedLevel: this.save ? this.save.unlockedLevel : 0,
      cards: this.cards ? [...this.cards.values()].map((c) => c.info()) : [],
      toastVisible: !!(this.toast && this.toast.visible && this.toast.alpha > 0.05)
    };
  }
}
