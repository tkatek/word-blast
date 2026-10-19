/**
 * WORD BLAST main menu (Fix #21) — the polished cartoon first page.
 *
 * Presentation layers (each independent, all cleaned up on shutdown):
 *   1. the official fantasy background (red bird painted in the art, never
 *      duplicated) cover-fitted to the visible view — no distortion, crop
 *      biased to keep the foreground bird and grass on wide screens;
 *   2. the official transparent WORD BLAST logo, upper centre, aspect
 *      preserved, one-time entrance (fade + 90%→100% scale with a small
 *      overshoot);
 *   3. a parchment subtitle ribbon ("Physics-Based English Learning");
 *   4. a live progress panel — completed levels / total and stars / max,
 *      read from the SaveManager (never hardcoded), with a short count
 *      animation only when the values genuinely changed since the last
 *      visit;
 *   5. a large wooden PLAY button (fade transition into LevelSelectScene,
 *      rapid-click guarded) and a smaller RESET SAVE button behind a
 *      confirmation popup (Cancel preserves progress; only the confirmed
 *      action calls the existing SaveManager.reset()).
 *
 * Decorative motion (logo sparkles, scenery dust, button shine) is skipped
 * entirely when the player has Reduced Motion enabled in the save settings.
 *
 * All remaining diagnostics are exposed ONLY through the developer debug
 * API (window.__WB__.menu()) — nothing developer-facing is drawn on screen.
 */
import Phaser from 'phaser';
import { SAVE, WORLD } from '../config.js';
import { attachViewport } from '../systems/Viewport.js';
import {
  MENU_ART, menuPreloadList, ensureMenuArtFallback, isFallbackTexture,
  WoodButton, ArtButton, ConfirmDialog, PALETTE,
  drawParchment, drawRibbon, drawStar, drawCheckBadge, menuText
} from '../systems/MenuUI.js';

/** Registry key: the progress values the menu last displayed (drives the
 *  values-changed animation across scene re-entries). */
const SNAPSHOT_KEY = 'menuProgressSnapshot';

/** Fixed-world layout (1280×720 world coords; the camera always shows the
 *  whole world, so this column is centred on every device). The red bird
 *  lives in the lower-left of the background art — the centre column never
 *  touches it. */
const LAYOUT = {
  centerX: WORLD.WIDTH / 2,
  logo: { y: 146, width: 530 },
  subtitle: { y: 308, height: 46 },
  panel: { y: 378, height: 66, font: '22px' },
  // PLAY is the hero action — the supplied square wooden plate (the art
  // carries its own PLAY lettering + golden triangle + leaves). Its
  // visible content is sized by HEIGHT (≈208 → width ≈237 from the art's
  // 1194×1048 trim) so the hero sits clear of the progress panel above
  // and the quiet reset below on the 720-tall world.
  play: { y: 534, height: 208 },  // width follows the button art's aspect
  reset: { y: 680, width: 190, height: 38 }
};

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  preload() {
    const BASE = ((import.meta.env && import.meta.env.BASE_URL) || '/') + 'assets/images/menu/';
    for (const { key, file } of menuPreloadList()) {
      this.load.image(key, BASE + file);
    }
    // Headless test envs cannot fetch the artwork — procedural stand-ins
    // under the same keys keep the scene fully renderable (project pattern).
    this.load.on('loaderror', (file) => ensureMenuArtFallback(this, file.key));
  }

  create() {
    const save = this.registry.get('save');
    this.save = save;
    this.transitioning = false;
    this.dialog = null;
    this.reducedMotion = !!(save.data && save.data.settings && save.data.settings.reducedMotion);

    // Audio-repair — silence-first configuration: no menu music. The menu
    // is silent apart from button clicks; nothing starts automatically.
    this.buildBackground();
    this.buildLogo();
    this.buildSubtitle();
    this.buildProgressPanel();
    this.buildButtons();
    if (!this.reducedMotion) this.buildAmbientEffects();

    this.playEntrance();

    // Returning players: animate the numbers only when they truly changed.
    const { completed, stars } = this.readProgress();
    const prev = this.registry.get(SNAPSHOT_KEY);
    this.registry.set(SNAPSHOT_KEY, { completed, stars });
    if (prev && !this.reducedMotion && (prev.completed !== completed || prev.stars !== stars)) {
      this.time.delayedCall(1050, () => this.refreshProgress(true));
    }

    this.events.once('shutdown', () => this.cleanup());
  }

  /* ---------------------------------------------------------------- */
  /* Background                                                        */
  /* ---------------------------------------------------------------- */

  buildBackground() {
    this.bgImage = this.add.image(0, 0, MENU_ART.background.key)
      .setOrigin(0.5, 0.5)
      .setDepth(-100);
    // The fit callback re-runs on every resize (attachViewport owns the
    // camera framing — same responsive system as gameplay).
    this.viewport = attachViewport(this, (view) => {
      this.fitBackground(view);
      if (this.dialog) this.dialog.fitView(view);
    });
    this.fitBackground(this.viewport.view);
  }

  /**
   * Cover-fit the background to the VISIBLE view: one uniform scale, never
   * stretched, never tiled — the painted bird is never duplicated. Two crop
   * biases keep the art's hero elements safe: horizontal crops (taller
   * views, 4:3 tablets) keep only 8% of the excess off the LEFT so the
   * painted red bird's tail stays clear of the edge (the tail begins at
   * ~2.6% of the art width, verified visually on the iPad-landscape shot);
   * vertical crops (wider views) keep slightly more of the foreground
   * (42% off the top) so the bird, grass and lake survive.
   */
  fitBackground(view) {
    if (!this.bgImage) return;
    const src = this.bgImage.texture.getSourceImage();
    const scale = Math.max(view.width / src.width, view.height / src.height);
    const dw = src.width * scale;
    const dh = src.height * scale;
    const leftCut = Math.max(0, dw - view.width) * 0.08;
    const topCut = Math.max(0, dh - view.height) * 0.42;
    this.bgImage.setScale(scale);
    this.bgImage.setPosition(view.x - leftCut + dw / 2, view.y - topCut + dh / 2);
  }

  /* ---------------------------------------------------------------- */
  /* Logo + subtitle                                                   */
  /* ---------------------------------------------------------------- */

  buildLogo() {
    const key = MENU_ART.logo.key;
    const src = this.textures.get(key).getSourceImage();
    const scale = LAYOUT.logo.width / src.width; // aspect preserved, uniform

    this.logo = this.add.container(LAYOUT.centerX, LAYOUT.logo.y).setDepth(1);
    this.logoArt = this.add.image(0, 0, key); // transparent official artwork
    this.logo.add(this.logoArt);
    this.logoScale = scale;

    if (isFallbackTexture(key)) {
      // Official art unreachable (headless env): the procedural plaque gets
      // a text title so the scene still reads as the game's front page.
      // NEVER rendered when the real logo is present — no duplicate text.
      this.logo.add(menuText(this, 0, 0, 'WORD BLAST', {
        fontFamily: '"Arial Black", Arial, sans-serif', fontSize: '96px',
        color: PALETTE.cream, stroke: PALETTE.creamStroke, strokeThickness: 10
      }));
    }
  }

  buildSubtitle() {
    const label = 'Physics-Based English Learning';
    const probe = menuText(this, 0, 0, label, {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '23px', color: PALETTE.ink
    });
    const textW = probe.width;
    probe.destroy();

    this.subtitle = this.add.container(LAYOUT.centerX, LAYOUT.subtitle.y).setDepth(1);
    const g = this.add.graphics();
    drawRibbon(g, textW + 86, LAYOUT.subtitle.height);
    this.subtitle.add(g);
    this.subtitle.add(menuText(this, 0, 1, label, {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: '23px', color: PALETTE.ink
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Progress panel                                                    */
  /* ---------------------------------------------------------------- */

  /** Live values from the SaveManager — never hardcoded. */
  readProgress() {
    const completed = Object.values(this.save.data.levels)
      .filter((l) => l.completed).length;
    return {
      completed,
      totalLevels: SAVE.MAX_LEVELS,
      stars: this.save.totalStars,
      maxStars: SAVE.MAX_LEVELS * 3
    };
  }

  buildProgressPanel() {
    const p = this.readProgress();
    const t1 = `Progress: ${p.completed}/${p.totalLevels} Levels`;
    const t2 = `Stars: ${p.stars}/${p.maxStars}`;
    const style = {
      fontFamily: 'Arial, sans-serif', fontStyle: 'bold', fontSize: LAYOUT.panel.font,
      color: PALETTE.ink
    };
    const probe1 = menuText(this, 0, 0, t1, style);
    const probe2 = menuText(this, 0, 0, t2, style);
    const w1 = probe1.width, w2 = probe2.width;
    probe1.destroy();
    probe2.destroy();

    const padX = 24, iconR = 15, iconGap = 12, cellGap = 26, dividerGap = 30;
    const w = Math.min(640,
      padX + iconR * 2 + iconGap + w1 + cellGap + dividerGap + cellGap + iconR * 2 + iconGap + w2 + padX);

    this.progressPanel = this.add.container(LAYOUT.centerX, LAYOUT.panel.y).setDepth(1);
    const g = this.add.graphics();
    drawParchment(g, w, LAYOUT.panel.height, 17);
    this.progressPanel.add(g);

    let x = -w / 2 + padX;
    const badge = this.add.graphics();
    drawCheckBadge(badge, x + iconR, 0, iconR);
    this.progressPanel.add(badge);
    x += iconR * 2 + iconGap;
    this.progressLevelsText = menuText(this, x, 1, t1, style, [0, 0.5]);
    this.progressPanel.add(this.progressLevelsText);
    x += w1 + cellGap;

    const div = this.add.graphics();
    div.fillStyle(PALETTE.parchmentEdge, 0.55);
    div.fillRoundedRect(x + dividerGap / 2 - 2, -LAYOUT.panel.height / 2 + 12, 4, LAYOUT.panel.height - 24, 2);
    this.progressPanel.add(div);
    x += dividerGap + cellGap;

    const star = this.add.graphics();
    drawStar(star, x + iconR - 2, 0, iconR + 2);
    this.progressPanel.add(star);
    this.progressStarIcon = star;
    x += iconR * 2 + iconGap;
    this.progressStarsText = menuText(this, x, 1, t2, style, [0, 0.5]);
    this.progressPanel.add(this.progressStarsText);

    this.displayedProgress = { completed: p.completed, stars: p.stars };
  }

  /** Re-read the save and refresh the panel; `animate` adds the short
   *  values-changed count (used when progress genuinely changed). */
  refreshProgress(animate) {
    if (!this.progressLevelsText) return;
    const p = this.readProgress();
    this.registry.set(SNAPSHOT_KEY, { completed: p.completed, stars: p.stars });

    const set = (c, s) => {
      this.progressLevelsText.setText(`Progress: ${c}/${p.totalLevels} Levels`);
      this.progressStarsText.setText(`Stars: ${s}/${p.maxStars}`);
    };

    if (!animate || this.reducedMotion) {
      set(p.completed, p.stars);
    } else {
      const state = { c: this.displayedProgress.completed, s: this.displayedProgress.stars };
      this.tweens.add({
        targets: state, c: p.completed, s: p.stars,
        duration: 550, ease: 'Sine.easeOut',
        onUpdate: () => set(Math.round(state.c), Math.round(state.s)),
        onComplete: () => set(p.completed, p.stars)
      });
      this.tweens.add({
        targets: this.progressPanel, scale: { from: 1, to: 1.05 },
        duration: 130, yoyo: true, ease: 'Sine.easeInOut'
      });
      if (this.progressStarIcon) {
        this.tweens.add({
          targets: this.progressStarIcon, angle: { from: 0, to: 360 },
          duration: 620, ease: 'Cubic.easeOut'
        });
      }
    }
    this.displayedProgress = { completed: p.completed, stars: p.stars };
  }

  /* ---------------------------------------------------------------- */
  /* Buttons                                                           */
  /* ---------------------------------------------------------------- */

  buildButtons() {
    // PLAY wears the supplied wooden-bar element (user follow-up): the
    // art's aspect sets the height (440 / 4.39 ≈ 100) — scaled uniformly,
    // never stretched, drawn at full source resolution (the GPU upscales
    // smoothly on large-DPI screens). Final polish: the wide hero bar with
    // a GOLDEN play symbol (cream text keeps the contrast). A missing
    // texture (headless env) falls back to the procedural face under the
    // same key.
    this.playButton = new WoodButton(this, {
      x: LAYOUT.centerX, y: LAYOUT.play.y,
      width: LAYOUT.play.width,
      label: 'PLAY', variant: 'primary', icon: 'play', leaves: true,
      iconColors: PLAY_ICON_GOLD,
      bgTexture: MENU_ART.playButton.key,
      shine: !this.reducedMotion,
      onClick: () => this.startPlay()
    });
    this.playButton.setEnabled(false); // armed after the entrance (≈0.9 s)

    // Reset stays reachable but deliberately quiet: small, dark secondary
    // wood at reduced opacity, still confirmed before anything is erased.
    this.resetButton = new WoodButton(this, {
      x: LAYOUT.centerX, y: LAYOUT.reset.y,
      width: LAYOUT.reset.width, height: LAYOUT.reset.height,
      label: 'RESET SAVE', variant: 'secondary', icon: 'reset',
      fontSize: '18px',
      onClick: () => this.openResetDialog()
    });
    this.resetButton.container.setAlpha(0.82);
    this.resetButton.setEnabled(false);
  }

  /** PLAY → existing level-select flow. Rapid clicks can never double-fire:
   *  the first click raises the transitioning guard and disables input. */
  startPlay() {
    if (this.transitioning) return;
    this.transitioning = true;
    this.playButton.setEnabled(false);
    this.resetButton.setEnabled(false);
    this.registry.get('audio').emit('ui-click');
    const go = () => this.scene.start('LevelSelectScene');
    if (this.reducedMotion) {
      go();
    } else {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', go);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Reset confirmation                                                */
  /* ---------------------------------------------------------------- */

  openResetDialog() {
    if (this.dialog || this.transitioning) return;
    this.registry.get('audio').emit('ui-click');
    this.playButton.setEnabled(false);
    this.resetButton.setEnabled(false);
    this.dialog = new ConfirmDialog(this, {
      view: this.viewport.view,
      title: 'Reset Progress?',
      body: 'This will erase your completed levels, stars, and saved progress.',
      confirmLabel: 'RESET PROGRESS', cancelLabel: 'CANCEL',
      onConfirm: () => this.confirmReset(),
      onCancel: () => this.closeDialog(),
      reducedMotion: this.reducedMotion
    });
  }

  /** The ONLY path that erases data — the existing SaveManager action. */
  confirmReset() {
    this.save.reset();
    this.closeDialog();
    this.refreshProgress(true); // panel animates down to 0/15 · 0/45
  }

  closeDialog() {
    const d = this.dialog;
    this.dialog = null;
    const restore = () => {
      if (this.transitioning) return;
      this.playButton.setEnabled(true);
      this.resetButton.setEnabled(true);
    };
    if (d) d.close(restore);
    else restore();
  }

  /* ---------------------------------------------------------------- */
  /* Ambient decoration + entrance choreography                        */
  /* ---------------------------------------------------------------- */

  /** Lightweight life: a few twinkles around the logo and gentle pollen
   *  over the scenery (~10 motes, ONE emitter). Skipped under Reduced
   *  Motion; the painted background itself is never animated. */
  buildAmbientEffects() {
    // pollen / dust motes drifting up over the scenery
    this.dust = this.add.particles(0, 0, 'p-dust', {
      x: { min: 40, max: WORLD.WIDTH - 40 },
      y: { min: 300, max: WORLD.HEIGHT - 30 },
      lifespan: 6500,
      speedX: { min: -8, max: 8 },
      speedY: { min: -16, max: -6 },
      scale: { start: 0.5, end: 0.12 },
      alpha: { start: 0.3, end: 0 },
      quantity: 1, frequency: 680,
      tint: 0xfff3c0
    }).setDepth(-50);

    // sparkles around (never on) the logo
    const halfW = LAYOUT.logo.width / 2;
    const halfH = (LAYOUT.logo.width * (this.logoArt.height / this.logoArt.width)) / 2;
    const zone = new Phaser.Geom.Rectangle(-halfW + 26, -halfH + 26, halfW * 2 - 52, halfH * 2 - 52);
    for (let i = 0; i < 7; i++) {
      // Phaser 3 API: Rectangle.Random(rect) returns a random Point inside it
      const p = Phaser.Geom.Rectangle.Random(zone);
      const s = this.add.image(p.x, p.y, 'p-spark')
        .setDepth(2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(0xfff8dc)
        .setAlpha(0)
        .setScale(0.25);
      this.logo.add(s);
      const dur = Phaser.Math.Between(750, 1250);
      const delay = Phaser.Math.Between(0, 1700);
      this.tweens.add({
        targets: s, alpha: 0.85, duration: dur / 2, yoyo: true,
        repeat: -1, delay, ease: 'Sine.easeInOut'
      });
      this.tweens.add({
        targets: s, scale: 1, duration: dur / 2, yoyo: true,
        repeat: -1, delay, ease: 'Sine.easeInOut'
      });
    }
  }

  /**
   * Coordinated entrance (≈0.95 s to a clickable PLAY — the sequence never
   * gates access longer than that): background camera fade-in → logo fade +
   * 90%→100% scale with a restrained overshoot → subtitle → progress panel
   * → PLAY pop → RESET. Under Reduced Motion everything appears instantly.
   */
  playEntrance() {
    const elements = [this.logo, this.subtitle, this.progressPanel,
      this.playButton.container, this.resetButton.container];
    if (this.reducedMotion) {
      this.playButton.setEnabled(true);
      this.resetButton.setEnabled(true);
      return;
    }

    for (const el of elements) el.setAlpha(0);
    this.cameras.main.fadeIn(260, 0, 0, 0);

    // logo: fade + gentle overshoot around the final uniform scale
    this.logo.setScale(this.logoScale * 0.9);
    this.tweens.add({ targets: this.logo, alpha: 1, duration: 220, delay: 100 });
    this.tweens.chain({
      targets: this.logo,
      tweens: [
        { scale: this.logoScale * 1.035, duration: 420, ease: 'Sine.easeOut' },
        { scale: this.logoScale, duration: 260, ease: 'Sine.easeInOut' }
      ],
      delay: 100
    });

    this.tweens.add({ targets: this.subtitle, alpha: 1, duration: 300, delay: 380 });

    this.progressPanel.setScale(0.94);
    this.tweens.add({
      targets: this.progressPanel, alpha: 1, scale: 1,
      duration: 280, delay: 470, ease: 'Sine.easeOut'
    });

    const play = this.playButton.container;
    play.setScale(0.6);
    this.tweens.add({
      targets: play, alpha: 1, scale: 1, duration: 360, delay: 560, ease: 'Back.easeOut',
      onComplete: () => {
        if (!this.transitioning && !this.dialog) this.playButton.setEnabled(true);
      }
    });

    this.tweens.add({ targets: this.resetButton.container, alpha: 1, duration: 260, delay: 700 });
    this.time.delayedCall(760, () => {
      if (!this.transitioning && !this.dialog) this.resetButton.setEnabled(true);
    });
  }

  /* ---------------------------------------------------------------- */
  /* Hygiene + debug                                                   */
  /* ---------------------------------------------------------------- */

  /** Scene shutdown: tweens/timers/particles are scene-owned and die with
   *  the scene; attachViewport detaches its own resize listener. Here we
   *  only drop references so a restarted menu starts clean. */
  cleanup() {
    this.dialog = null;
    this.viewport = null;
    this.bgImage = null;
    this.logo = null;
    this.progressPanel = null;
    this.playButton = null;
    this.resetButton = null;
    this.dust = null;
  }

  /** Developer/debug-only snapshot (window.__WB__.menu()) — nothing
   *  diagnostic is ever drawn on the menu itself. */
  menuDebugInfo() {
    const p = this.readProgress();
    return {
      active: true,
      ...p,
      transitioning: this.transitioning,
      dialogOpen: !!this.dialog,
      reducedMotion: this.reducedMotion,
      usingBackgroundArt: !isFallbackTexture(MENU_ART.background.key),
      usingLogoArt: !isFallbackTexture(MENU_ART.logo.key)
    };
  }
}
