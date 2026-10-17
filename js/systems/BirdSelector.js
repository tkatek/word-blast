/**
 * BirdSelector — the bird-selection card row (Fix #19).
 *
 * Five polished cartoon cards along the bottom-left of the gameplay screen
 * (matching the supplied reference): real bird artwork, gold quantity
 * badge, glowing selected state, dimmed unavailable state, soft shadows.
 *
 * Design contract (mirrors GameHUD):
 *   - the selector OWNS NO gameplay state: sync() receives one snapshot
 *     (roster, ammo counts, selected key, armed flag) from the scene's
 *     refreshHUD() funnel and only renders it; clicks call back out
 *   - all frames/badges are procedural textures generated once and reused
 *     across scene restarts (guarded by textures.exists)
 *   - layout lives in the fixed 1280×720 world; the whole world is always
 *     framed on every device (Viewport), and the CSS shell already insets
 *     the canvas by the safe-area, so the row is never under a notch
 *   - the row sits BELOW the slingshot aiming zone (pouch drag is clamped
 *     above GROUND_Y − 14 = 457; cards start at y ≈ 586) and left of the
 *     answer towers — it can never eat an aiming drag or cover a target
 *   - every card flags its pointerdown through markUi() so the scene's
 *     tap-to-activate-ability handler ignores card taps
 *
 * Also exports AbilityButton — the mid-flight ability trigger shown while
 * the active bird is flying (bottom-right, far from the cards).
 */
import Phaser from 'phaser';
import { PROJECTILE_TYPES } from '../config.js';
import { birdForProjectile, projectileVisual } from '../data/birds.js';

/* Canonical card order: RED, BLUE, YELLOW, BLACK, PURPLE (spec §1). */
export const SELECTOR_ORDER = ['basic', 'speed', 'split', 'bomb', 'ice'];

const SELECTOR_DEPTH = 50; // same band as the top HUD; overlays sit higher

const CARD = {
  W: 82,            // frame texture size (includes glow margin)
  BODY: 64,         // visible card body (rounded square)
  GAP: 10,
  X0: 36,           // left edge of the first card (world px)
  Y: 630,           // vertical center of the row
  PORTRAIT: 52      // bird artwork display size inside the card
};

const TEX = {
  shadow: 'wbcard-shadow',
  idle: 'wbcard-idle',
  selected: 'wbcard-selected',
  off: 'wbcard-off',
  badge: 'wbcard-badge',
  bolt: 'wbcard-bolt'
};

/* ------------------------------------------------------------------ */
/* Procedural textures (generated once; survive scene restarts)        */
/* ------------------------------------------------------------------ */
export function ensureCardTextures(scene) {
  const T = scene.textures;
  if (T.exists(TEX.idle)) return;
  const g = scene.add.graphics();
  const S = CARD.W;           // texture square
  const c = S / 2;            // center
  const m = (S - CARD.BODY) / 2; // glow margin around the body

  /* soft drop shadow (offset down-right) */
  g.clear();
  g.fillStyle(0x1a1208, 0.34);
  g.fillRoundedRect(m + 2, m + 4, CARD.BODY, CARD.BODY, 14);
  g.generateTexture(TEX.shadow, S, S);

  /* idle: parchment body + warm wood border + top sheen */
  g.clear();
  g.fillStyle(0x6e4a22, 1);                                   // outer border
  g.fillRoundedRect(m, m, CARD.BODY, CARD.BODY, 13);
  g.fillStyle(0xf7e8c9, 1);                                   // parchment
  g.fillRoundedRect(m + 3, m + 3, CARD.BODY - 6, CARD.BODY - 6, 10);
  g.fillStyle(0xfff7e0, 0.8);                                 // sheen
  g.fillRoundedRect(m + 7, m + 6, CARD.BODY - 14, 14, 7);
  g.fillStyle(0xdfc68f, 0.55);                                // lower shade
  g.fillRoundedRect(m + 7, m + CARD.BODY - 18, CARD.BODY - 14, 11, 6);
  g.generateTexture(TEX.idle, S, S);

  /* selected: brighter body + double gold border + soft outer glow */
  g.clear();
  for (let i = 3; i >= 1; i--) {                              // glow rings
    g.lineStyle(5 + i * 3, 0xffd166, 0.16 / i * 2);
    g.strokeRoundedRect(m - i * 3.5, m - i * 3.5, CARD.BODY + i * 7, CARD.BODY + i * 7, 14 + i * 2);
  }
  g.fillStyle(0x9c6b1f, 1);                                   // gold edge
  g.fillRoundedRect(m - 2, m - 2, CARD.BODY + 4, CARD.BODY + 4, 15);
  g.fillStyle(0xfff7e0, 1);                                   // bright body
  g.fillRoundedRect(m + 1, m + 1, CARD.BODY - 2, CARD.BODY - 2, 12);
  g.fillStyle(0xffe9a8, 0.9);                                 // warm sheen
  g.fillRoundedRect(m + 5, m + 4, CARD.BODY - 10, 13, 7);
  g.fillStyle(0xecd9a3, 0.6);                                 // lower shade
  g.fillRoundedRect(m + 5, m + CARD.BODY - 16, CARD.BODY - 10, 11, 6);
  g.generateTexture(TEX.selected, S, S);

  /* off (unavailable): dark desaturated frame */
  g.clear();
  g.fillStyle(0x40382c, 1);
  g.fillRoundedRect(m, m, CARD.BODY, CARD.BODY, 13);
  g.fillStyle(0x8d8272, 1);
  g.fillRoundedRect(m + 3, m + 3, CARD.BODY - 6, CARD.BODY - 6, 10);
  g.fillStyle(0xa89b88, 0.6);
  g.fillRoundedRect(m + 7, m + 6, CARD.BODY - 14, 12, 6);
  g.generateTexture(TEX.off, S, S);

  /* gold quantity badge (rim + body; number drawn as text on top) */
  g.clear();
  g.fillStyle(0x9c6b1f, 1); g.fillCircle(16, 16, 15);
  g.fillStyle(0xe09f3e, 1); g.fillCircle(16, 16, 12.5);
  g.fillStyle(0xffd166, 1); g.fillCircle(16, 16, 10.5);
  g.fillStyle(0xffffff, 0.5); g.fillEllipse(12, 11, 9, 6);
  g.generateTexture(TEX.badge, 32, 32);

  /* lightning bolt (ability button icon) */
  g.clear();
  g.fillStyle(0x4d3218, 1);
  g.fillPoints([
    new Phaser.Geom.Point(29, 4), new Phaser.Geom.Point(11, 34),
    new Phaser.Geom.Point(22, 34), new Phaser.Geom.Point(17, 58),
    new Phaser.Geom.Point(39, 26), new Phaser.Geom.Point(27, 26)
  ], true);
  g.fillStyle(0xffd60a, 1);
  g.fillPoints([
    new Phaser.Geom.Point(29, 9), new Phaser.Geom.Point(16, 32),
    new Phaser.Geom.Point(23, 32), new Phaser.Geom.Point(20, 51),
    new Phaser.Geom.Point(35, 28), new Phaser.Geom.Point(27, 28)
  ], true);
  g.generateTexture(TEX.bolt, 44, 62);

  g.destroy();
}

/* ------------------------------------------------------------------ */
/* The card row                                                        */
/* ------------------------------------------------------------------ */
export class BirdSelector {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} handlers {
   *   onSelect(key) — card clicked (scene gates availability),
   *   markUi()      — flags the pointerdown as UI (never an ability tap),
   *   audio         — event bus (optional 'ui-click')
   * }
   */
  constructor(scene, handlers = {}) {
    this.scene = scene;
    this.onSelect = handlers.onSelect || (() => {});
    this.markUi = handlers.markUi || (() => {});
    this.audio = handlers.audio || null;

    ensureCardTextures(scene);

    this.root = scene.add.container(0, 0).setDepth(SELECTOR_DEPTH);
    this.cards = new Map();   // projectile key -> card record
    this.prevAmmo = {};       // for decrease-pulse detection
    this.prevSelected = null;
    this.enabled = true;      // false hides the row (terminal overlays)

    for (let i = 0; i < SELECTOR_ORDER.length; i++) {
      this.cards.set(SELECTOR_ORDER[i], this.buildCard(SELECTOR_ORDER[i], i));
    }
    scene.events.once('shutdown', () => this.destroy());
  }

  get reducedMotion() {
    const save = this.scene.registry.get('save');
    return !!(save && save.data && save.data.settings && save.data.settings.reducedMotion);
  }

  /** Build one card container at its slot. */
  buildCard(key, index) {
    const s = this.scene;
    const x = CARD.X0 + CARD.W / 2 + index * (CARD.W + CARD.GAP);
    const card = s.add.container(x, CARD.Y);
    this.root.add(card);

    const shadow = s.add.image(0, 0, TEX.shadow);
    const frame = s.add.image(0, 0, TEX.idle);
    // real bird artwork when loaded; legacy circle texture otherwise
    const visual = projectileVisual(key, s.textures, PROJECTILE_TYPES[key].radius);
    const portrait = s.add.image(0, 0, visual.texture).setDisplaySize(CARD.PORTRAIT, CARD.PORTRAIT);
    const hotkey = s.add.text(-CARD.BODY / 2 + 5, CARD.BODY / 2 - 5, String(index + 1), {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '12px', fontStyle: 'bold',
      color: '#fff6e5'
    }).setOrigin(0.5).setAlpha(0.9);
    hotkey.setStroke('#4d3218', 3);
    const badge = s.add.image(CARD.BODY / 2 - 2, -CARD.BODY / 2 + 2, TEX.badge).setDisplaySize(27, 27);
    const badgeNum = s.add.text(CARD.BODY / 2 - 2, -CARD.BODY / 2 + 1.5, '0', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '14px', fontStyle: 'bold',
      color: '#5c3a1e'
    }).setOrigin(0.5);
    card.add([shadow, frame, portrait, hotkey, badge, badgeNum]);

    card.setSize(CARD.BODY, CARD.BODY);
    card.setInteractive({ useHandCursor: true });
    card.on('pointerover', () => { if (this.enabled) card.y = CARD.Y - 3; });
    card.on('pointerout', () => { card.y = CARD.Y; });
    card.on('pointerdown', () => {
      this.markUi();
      if (!this.enabled) return;
      this.audio?.emit('ui-click');
      this.popCard(card, 0.94);
      this.onSelect(key);
    });

    return {
      key, card, frame, portrait, badge, badgeNum, hotkey,
      glowPulse: null,
      birdName: birdForProjectile(key)?.name || PROJECTILE_TYPES[key].name
    };
  }

  /** Small scale pop (selection feedback / press feedback). */
  popCard(card, peak = 1.14) {
    if (this.reducedMotion) return;
    this.scene.tweens.killTweensOf(card);
    this.scene.tweens.add({
      targets: card, scale: peak, duration: 110, yoyo: true, ease: 'Quad.out',
      onComplete: () => card.setScale(1)
    });
  }

  /**
   * One snapshot render. snap = {
   *   roster: string[],       projectile keys usable this level
   *   ammo: {key: count},     remaining ammunition
   *   selected: string,       currently selected key
   *   enabled: boolean        row interactive/visible (true during play)
   * }
   */
  sync(snap = {}) {
    const roster = snap.roster || [];
    const ammo = snap.ammo || {};
    const selected = snap.selected || null;
    this.enabled = snap.enabled !== false;

    for (const [key, rec] of this.cards) {
      const inRoster = roster.includes(key);
      const count = Math.max(0, ammo[key] ?? 0);
      const available = inRoster && count > 0;
      const isSelected = key === selected && available;

      rec.frame.setTexture(isSelected ? TEX.selected : available ? TEX.idle : TEX.off);
      rec.portrait.setTint(available ? 0xffffff : 0x8a8a8a);
      rec.portrait.setAlpha(available ? 1 : 0.5);
      rec.badgeNum.setText(String(count));
      rec.badge.setAlpha(available || inRoster ? 1 : 0.5);
      rec.card.setAlpha(this.enabled ? 1 : 0.65);
      rec.portrait.setScale(isSelected ? 1.12 : 1);

      // gentle breathing pulse on the selected card's glow (skipped in
      // reduced motion)
      if (isSelected && !this.reducedMotion && !rec.glowPulse) {
        rec.glowPulse = this.scene.tweens.add({
          targets: rec.card, scale: 1.05, duration: 620, yoyo: true,
          repeat: -1, ease: 'Sine.inOut'
        });
      } else if ((!isSelected || this.reducedMotion) && rec.glowPulse) {
        rec.glowPulse.stop();
        rec.glowPulse = null;
        rec.card.setScale(1);
      }

      // ammunition decreased → badge pulse
      const prev = this.prevAmmo[key];
      if (prev !== undefined && count < prev) this.pulseBadge(rec);
      this.prevAmmo[key] = count;

      // selection change → pop animation
      if (isSelected && this.prevSelected !== key) this.popCard(rec.card, 1.16);
    }
    this.prevSelected = selected && (ammo[selected] ?? 0) > 0 ? selected : null;
  }

  /** Quantity badge briefly pulses when its count drops. */
  pulseBadge(rec) {
    if (this.reducedMotion) return;
    this.scene.tweens.killTweensOf([rec.badge, rec.badgeNum]);
    this.scene.tweens.add({
      targets: [rec.badge, rec.badgeNum], scale: 1.4, duration: 130, yoyo: true,
      ease: 'Quad.out', onComplete: () => {
        rec.badge.setScale(1);
        rec.badgeNum.setScale(1);
      }
    });
  }

  destroy() {
    for (const rec of this.cards.values()) {
      if (rec.glowPulse) rec.glowPulse.stop();
      this.scene.tweens.killTweensOf([rec.card, rec.badge, rec.badgeNum]);
    }
    this.cards.clear();
    this.root?.destroy();
    this.root = null;
  }
}

/* ------------------------------------------------------------------ */
/* The mid-flight ability button (mobile + desktop)                    */
/* ------------------------------------------------------------------ */

/**
 * Round wooden TAP-button shown ONLY while the active bird is flying and
 * has an ability (bottom-right — deliberately far from the card row and
 * from the slingshot's aiming zone). Clicking it flags markUi() and calls
 * onActivate; the scene's own state gates decide whether an ability runs.
 */
export class AbilityButton {
  constructor(scene, { onActivate, markUi } = {}) {
    this.scene = scene;
    ensureCardTextures(scene);

    const s = scene;
    this.root = s.add.container(1216, 626).setDepth(SELECTOR_DEPTH).setVisible(false);
    const ring = s.add.circle(0, 0, 44, 0xffd166, 0.28);
    const disc = s.add.circle(0, 0, 37, 0xe09f3e, 1).setStrokeStyle(4, 0x9c6b1f, 1);
    const inner = s.add.circle(0, -3, 31, 0xffd166, 1);
    const bolt = s.add.image(0, -3, TEX.bolt).setDisplaySize(22, 30);
    const label = s.add.text(0, 26, 'TAP', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px', fontStyle: 'bold',
      color: '#fff6e5'
    }).setOrigin(0.5).setAlpha(0.95);
    label.setStroke('#4d3218', 3);
    this.root.add([ring, disc, inner, bolt, label]);
    this.pulse = null;

    this.root.setSize(88, 88);
    this.root.setInteractive({ useHandCursor: true });
    this.root.on('pointerover', () => this.root.setScale(1.06));
    this.root.on('pointerout', () => this.root.setScale(1));
    this.root.on('pointerdown', () => {
      markUi?.();
      this.root.setScale(0.93);
    });
    this.root.on('pointerup', () => {
      this.root.setScale(1.06);
      onActivate?.();
    });

    scene.events.once('shutdown', () => this.destroy());
  }

  /**
   * Show/hide for the current shot. visible = the shot's bird has an
   * ability AND the state allows activation (the scene passes the flag).
   */
  sync({ visible }) {
    if (this.root.visible === visible) return;
    this.root.setVisible(visible);
    if (visible && !this.pulse) {
      const save = this.scene.registry.get('save');
      const reduced = !!(save && save.data && save.data.settings && save.data.settings.reducedMotion);
      if (!reduced) {
        this.pulse = this.scene.tweens.add({
          targets: this.root, scale: 1.07, duration: 340, yoyo: true,
          repeat: -1, ease: 'Sine.inOut'
        });
      }
    } else if (!visible && this.pulse) {
      this.pulse.stop();
      this.pulse = null;
      this.root.setScale(1);
    }
  }

  destroy() {
    if (this.pulse) this.pulse.stop();
    this.scene.tweens?.killTweensOf(this.root);
    this.root?.destroy();
    this.root = null;
  }
}
