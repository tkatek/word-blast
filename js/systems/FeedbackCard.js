/**
 * FeedbackCard — the wooden-parchment answer-feedback card (correct /
 * wrong), replacing the old plain dark-blue rectangle.
 *
 * ONE reusable component on the blank parchment artwork
 * (assets/images/ui/feedback-card.png, baked by scripts/build-feedback-card.mjs):
 *
 *   ┌──────────────────────────────────────┐
 *   │      [✓]  GREEN / RED HEADER         │  gradient banner + gold trim +
 *   │──────────────────────────────────────│  circular badge straddling its edge
 *   │   Correct answer: C — "dog"          │  bold ink highlight line
 *   │                                      │
 *   │   A dog is an animal. A spoon is     │  measured, wrapped explanation
 *   │   an object, and red is a color.     │  (from the real question data)
 *   │                                      │
 *   │           [ CONTINUE ]               │  wooden pill button (green/red)
 *   └──────────────────────────────────────┘
 *
 * Everything except the blank parchment is drawn dynamically (header
 * gradient, badge, texts, button) — the PNG never bakes answer text.
 *
 * Reliability contract (mirrors QuestionCard):
 *   - show() is one-shot per answer: a repeated call for the SAME token is
 *     ignored, so duplicate collision events can never stack cards;
 *   - all tweens are tracked and killed on re-show / hide / destroy;
 *   - the action button starts DISABLED and is armed exactly once by the
 *     scene (setActionEnabled) when the physics settle watcher allows the
 *     transition — the card may appear while the tower is collapsing, but
 *     the state change only happens through the button;
 *   - one action per card (acted flag); double-clicks are swallowed;
 *   - pause()/resume() freeze the visual tweens; the scene gates the game
 *     logic itself;
 *   - pure UI: never consumes shots, never touches score/timer/save.
 *
 * Text fitting: all bodies are measured with REAL Phaser text metrics
 * (including lineSpacing). Long explanations first shrink the font to a
 * readability floor; if that is still not enough the CARD grows on screen
 * (root scale up to MAX_SCALE with the local font divided by the same
 * factor, so the writing area gains real pixels while the display font
 * size stays readable). Educational text is never truncated.
 */
import Phaser from 'phaser';
import { WORLD } from '../config.js';
import { DebugLog } from './DebugLog.js';
import { woodButton } from './GameHUD.js';

/** Texture keys (blank parchment artwork + runtime-drawn header banners). */
export const FEEDBACK_CARD = {
  TEXTURE: 'ui-feedback-card',
  /** Card size in world px at scale 1 (artwork is 2× — stays crisp enlarged). */
  WIDTH: 560,
  HEIGHT: 400,
  ART: 'assets/images/ui/feedback-card.png'
};

/** Card layout (card-local px, origin = card center, scale-1 card). */
const L = {
  frame: 32,                            // parchment frame visual thickness
  header: { w: 476, h: 108, top: 14 },  // banner inset from the card top
  badge: { d: 66 },
  answerY: -54,                         // answer line top
  explainBottom: 114,                   // explanation box bottom (button top 124)
  button: { w: 240, h: 56, y: 152 }
};

/** Header palettes (from the supplied reference). */
const THEMES = {
  correct: {
    bannerTex: 'wbfeedback-banner-green',
    grad: ['#4caf50', '#2e7d32', '#1b5e20'],
    title: '✓ CORRECT ANSWER!',
    badgeFill: 0x1b5e20,
    button: 'green',
    buttonText: 'CONTINUE'
  },
  wrong: {
    bannerTex: 'wbfeedback-banner-red',
    grad: ['#ef5350', '#c62828', '#8e1c26'],
    title: '✕ WRONG ANSWER',
    badgeFill: 0x8e1c26,
    button: 'red',
    buttonText: 'TRY AGAIN'
  }
};

/** DISPLAY font targets (world px after the card scale is applied). */
const FONT = { title: 30, answer: 22, explain: { max: 21, min: 15 } };
const LINE_SPACING = 0.34;   // × font
const MAX_SCALE = 1.22;      // card may grow up to ~683×488 world px

/** Entrance / exit pacing (ms) — restrained, reduced-motion aware. */
const TIMING = { enter: 340, settle: 130, stagger: 110, exit: 290, backdrop: 0.52 };

export class FeedbackCard {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   *   markUi()         flags UI pointerdown (scene input guard)
   *   reducedMotion()  -> boolean (save settings)
   *   depth            card depth (default 100 = OVERLAY)
   */
  constructor(scene, { markUi, reducedMotion, depth = 100 } = {}) {
    this.scene = scene;
    this.opts = { markUi, reducedMotion, depth };
    this.token = -1;        // monotonic show() token — invalidates stale work
    this.visible = false;
    this.acted = false;
    this.actionEnabled = false;
    this.busy = false;      // entrance in flight
    this.kind = null;
    this.fit = null;        // last measured layout (debug/tests)
    this.tweens = [];

    // dimmed modal backdrop — swallows stray input so no bird can launch
    this.backdrop = scene.add.rectangle(
      WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH + 4, WORLD.HEIGHT + 4, 0x08131f, 0
    ).setDepth(depth - 1).setInteractive({ useHandCursor: false });
    this.backdrop.on('pointerdown', () => { if (this.opts.markUi) this.opts.markUi(); });
    this.backdrop.setVisible(false);

    // card root
    this.root = scene.add.container(WORLD.WIDTH / 2, 336).setDepth(depth);
    this.root.setVisible(false);

    // blank parchment artwork (or the procedural fallback)
    this.skin = scene.add.image(0, 0, this.ensureTexture())
      .setDisplaySize(FEEDBACK_CARD.WIDTH, FEEDBACK_CARD.HEIGHT);
    this.root.add(this.skin);

    scene.events.once('shutdown', () => this.destroy());
  }

  /* ------------------------------------------------------------------ */
  /* Textures                                                            */
  /* ------------------------------------------------------------------ */

  /** Blank parchment artwork with a procedural stand-in when the PNG is
   *  unreachable (headless test environments — same contract as the
   *  question card / HUD art fallbacks). */
  ensureTexture() {
    const T = this.scene.textures;
    if (T.exists(FEEDBACK_CARD.TEXTURE)) return FEEDBACK_CARD.TEXTURE;
    const g = this.scene.add.graphics();
    const W = 280, H = 200, r = 22, f = 16;
    g.fillStyle(0x5d3a1a, 1); g.fillRoundedRect(0, 0, W, H, r);
    g.fillStyle(0xa06e3f, 1); g.fillRoundedRect(3, 3, W - 6, H - 6, r - 3);
    g.fillStyle(0xb98b5e, 0.7); g.fillRoundedRect(6, 6, W - 12, f - 6, 8);
    g.fillStyle(0xb98b5e, 0.7); g.fillRoundedRect(6, H - f, W - 12, f - 6, 8);
    g.fillStyle(0xf9eac5, 1); g.fillRoundedRect(f, f, W - 2 * f, H - 2 * f, 14);
    for (const [bx, by] of [[f / 2 + 7, f / 2 + 7], [W - f / 2 - 7, f / 2 + 7], [f / 2 + 7, H - f / 2 - 7], [W - f / 2 - 7, H - f / 2 - 7]]) {
      g.fillStyle(0x8d8d99, 1); g.fillCircle(bx, by, 7);
      g.fillStyle(0x5a5a66, 1); g.fillCircle(bx, by, 4);
    }
    g.generateTexture(FEEDBACK_CARD.TEXTURE, W, H);
    g.destroy();
    return FEEDBACK_CARD.TEXTURE;
  }

  /** Rounded gradient banner with gold trim, drawn once per theme. */
  ensureBannerTexture(key, [c0, c1, c2]) {
    const T = this.scene.textures;
    if (T.exists(key)) return key;
    const w = 512, h = 116, r = 34;
    const canvas = this.scene.textures.createCanvas(key, w, h);
    const ctx = canvas.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, c0);
    grad.addColorStop(0.55, c1);
    grad.addColorStop(1, c2);
    const rr = (x, y, rw, rh, rad) => {
      ctx.beginPath();
      ctx.moveTo(x + rad, y);
      ctx.arcTo(x + rw, y, x + rw, y + rh, rad);
      ctx.arcTo(x + rw, y + rh, x, y + rh, rad);
      ctx.arcTo(x, y + rh, x, y, rad);
      ctx.arcTo(x, y, x + rw, y, rad);
      ctx.closePath();
    };
    // drop shadow under the banner, then gradient body, gold trim, top gloss
    ctx.shadowColor = 'rgba(20,12,4,0.45)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 5;
    rr(6, 4, w - 12, h - 10, r); ctx.fillStyle = grad; ctx.fill();
    ctx.shadowColor = 'transparent';
    rr(6, 4, w - 12, h - 10, r);
    ctx.lineWidth = 5; ctx.strokeStyle = '#d4a017'; ctx.stroke();
    rr(10, 8, w - 20, h - 18, r - 4);
    ctx.lineWidth = 2; ctx.strokeStyle = '#ffd54f'; ctx.stroke();
    rr(12, 10, w - 24, h * 0.34, r - 8);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fill();
    canvas.refresh();
    return key;
  }

  /* ------------------------------------------------------------------ */
  /* Measurement                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Measure wrapped text with the EXACT rendered style (font, lineSpacing,
   * advanced wrap) — the same real-metrics approach as AnswerPanel, so the
   * fit decision matches what lands on screen. Scratch Text is cached.
   */
  measure(text, fontSize, maxWidth, bold) {
    if (!this._scratch || !this._scratch.active) {
      this._scratch = this.scene.add.text(0, 0, '', {}).setVisible(false);
      this.scene.events.once('shutdown', () => { this._scratch?.destroy(); this._scratch = null; });
    }
    this._scratch.setStyle({
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: `${fontSize}px`,
      fontStyle: bold ? 'bold' : '',
      color: '#000000', align: 'center',
      lineSpacing: Math.round(fontSize * LINE_SPACING),
      wordWrap: { width: maxWidth, useAdvancedWrap: true }
    });
    this._scratch.setText(text);
    return { width: this._scratch.width, height: this._scratch.height };
  }

  /* ------------------------------------------------------------------ */
  /* Presentation                                                        */
  /* ------------------------------------------------------------------ */

  /**
   * Show the card. Repeated calls with the same token are ignored.
   * @param {object} p
   *   token        scene question token (stale shows must not re-fire)
   *   kind         'correct' | 'wrong'
   *   answerLine  e.g. 'Correct answer: C — "dog"' (real question data)
   *   explanation  educational text (real question data)
   *   hint         optional extra encouraging line (wrong answers)
   *   buttonText   override ('CONTINUE' | 'TRY AGAIN')
   *   onAction     called ONCE after the exit animation completes
   */
  show({ token, kind, answerLine, explanation, hint, buttonText, onAction }) {
    if (this.visible && this.token === token) return false; // duplicate event
    this.killTweens();
    this.token = token;
    this.kind = kind;
    this.acted = false;
    this.actionEnabled = false;
    this.busy = true;
    this.onAction = onAction || null;
    this.visible = true;

    const theme = THEMES[kind] || THEMES.correct;
    this.ensureBannerTexture(theme.bannerTex, theme.grad);

    // rebuild content (cheap; keeps tokens safe)
    this.content?.destroy();
    this.content = this.scene.add.container(0, 0);
    this.root.add(this.content);

    /* --- header banner + title + badge ----------------------------- */
    const banner = this.scene.add.image(
      0, -FEEDBACK_CARD.HEIGHT / 2 + L.header.top + L.header.h / 2, theme.bannerTex
    ).setDisplaySize(L.header.w, L.header.h);
    this.title = this.scene.add.text(banner.x, banner.y + 2, theme.title, {
      fontFamily: 'Arial, Helvetica, sans-serif', fontSize: `${FONT.title}px`, fontStyle: 'bold',
      color: '#ffffff', align: 'center'
    }).setOrigin(0.5).setStroke('#123312', 6).setShadow(0, 3, 'rgba(10,20,8,0.5)', 3, false, true);

    // circular status badge straddling the banner's top edge
    const badgeY = -FEEDBACK_CARD.HEIGHT / 2 + L.header.top;
    this.badge = this.scene.add.container(0, badgeY);
    const glow = this.scene.add.circle(0, 0, L.badge.d * 0.78, kind === 'correct' ? 0x66bb6a : 0xef5350, 0.16);
    const ring = this.scene.add.circle(0, 0, L.badge.d / 2, 0xffc107).setStrokeStyle(4, 0x9c6b1f);
    const disc = this.scene.add.circle(0, 1, L.badge.d / 2 - 6, theme.badgeFill);
    const mark = this.scene.add.graphics();
    mark.lineStyle(7, 0xffffff, 1);
    if (kind === 'correct') {
      mark.beginPath();
      mark.moveTo(-11, 1);
      mark.lineTo(-3, 10);
      mark.lineTo(13, -9);
      mark.strokePath();
    } else {
      mark.beginPath();
      mark.moveTo(-9, -9); mark.lineTo(9, 9);
      mark.moveTo(9, -9); mark.lineTo(-9, 9);
      mark.strokePath();
    }
    this.badge.add([glow, ring, disc, mark]);
    this.content.add([banner, this.title, this.badge]);

    /* --- layout: fit answer line + explanation into the parchment --- */
    const boxW = FEEDBACK_CARD.WIDTH - (L.frame + 36) * 2; // writing width, local px
    const body = hint ? `${explanation}\n\n${hint}` : explanation;

    // Card-scale fitting loop. All measurement is in card-LOCAL units; a
    // card scale of s multiplies every displayed size by s, so the display
    // font is localFont × s. Growing the card therefore buys real writing
    // pixels at a constant display font (local font shrinks by 1/s).
    let scale = 1;
    let answerFont = FONT.answer;
    let explainFont = FONT.explain.min;
    let answerH = 0;
    let explainH = 0;
    let explainTop = L.explainBottom; // recomputed below

    for (let s = 1; s <= MAX_SCALE + 0.001; s += 0.11) {
      s = Math.round(s * 1000) / 1000;
      // answer line: fixed display size, may wrap to 2 lines for sentences
      const aFont = FONT.answer / s;
      const am = this.measure(answerLine, aFont, boxW, true);
      const aTop = L.answerY;
      const aH = am.height;
      // explanation box: from below the answer line down to the button zone
      const eTop = aTop + aH + 10;
      const eHmax = L.explainBottom - eTop;
      // display font from max down to min (constant display size)
      const fMax = FONT.explain.max / s;
      const fMin = FONT.explain.min / s;
      let chosen = null;
      for (let f = fMax; f >= fMin - 0.001; f -= 0.5) {
        const m = this.measure(body, f, boxW, false);
        if (m.height <= eHmax) { chosen = f; explainH = m.height; break; }
      }
      if (chosen !== null) {
        scale = s;
        answerFont = aFont;
        explainFont = chosen;
        answerH = aH;
        explainTop = eTop;
        break;
      }
    }
    if (explainTop === L.explainBottom) {
      // even at MAX_SCALE nothing fit: keep the floor font and let the block
      // run tall inside the enlarged card (never truncate education text)
      scale = MAX_SCALE;
      answerFont = FONT.answer / scale;
      const am = this.measure(answerLine, answerFont, boxW, true);
      answerH = am.height;
      explainTop = L.answerY + answerH + 10;
      explainFont = FONT.explain.min / scale;
      explainH = this.measure(body, explainFont, boxW, false).height;
      DebugLog.warn('FeedbackCard: explanation exceeds card even at MAX_SCALE (rendered tall, not truncated)');
    }
    this.fit = {
      scale, displayFont: +(explainFont * scale).toFixed(1),
      answerLines: Math.max(1, Math.round(answerH / (answerFont * 1.35))),
      explainH: Math.round(explainH), boxW
    };

    this.answerText = this.scene.add.text(0, L.answerY, answerLine, {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: `${answerFont}px`, fontStyle: 'bold',
      color: '#3e2723', align: 'center',
      wordWrap: { width: boxW, useAdvancedWrap: true }
    }).setOrigin(0.5, 0);

    this.explainText = this.scene.add.text(0, explainTop, body, {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontSize: `${explainFont}px`,
      color: '#5d4037', align: 'center',
      lineSpacing: Math.round(explainFont * LINE_SPACING),
      wordWrap: { width: boxW, useAdvancedWrap: true }
    }).setOrigin(0.5, 0);
    this.content.add([this.answerText, this.explainText]);

    /* --- action button (starts DISABLED until physics allow) -------- */
    this.button = woodButton(this.scene, {
      x: 0, y: L.button.y, w: L.button.w, h: L.button.h,
      label: buttonText || theme.buttonText, color: theme.button, size: 24,
      onClick: () => this.act(),
      markUi: this.opts.markUi
    });
    this.button.disableInteractive().setAlpha(0.55);
    this.content.add(this.button);

    /* --- entrance animation ----------------------------------------- */
    const reduced = !!(this.opts.reducedMotion && this.opts.reducedMotion());
    this.root.setScale(scale * 0.85).setAlpha(0).setVisible(true);
    this.content.setAlpha(1);
    this.backdrop.setVisible(true).setAlpha(0);

    this.track(this.scene.tweens.add({
      targets: this.backdrop, alpha: TIMING.backdrop,
      duration: reduced ? 0 : 220, ease: 'Sine.easeOut'
    }));
    this.track(this.scene.tweens.add({
      targets: this.root, alpha: 1,
      duration: reduced ? 0 : TIMING.enter, ease: 'Sine.easeOut'
    }));
    this.track(this.scene.tweens.add({
      targets: this.root, scale: scale * 1.03,
      duration: reduced ? 0 : TIMING.enter, ease: 'Cubic.easeOut',
      onComplete: () => {
        if (this.token !== token) return;
        this.track(this.scene.tweens.add({
          targets: this.root, scale,
          duration: reduced ? 0 : TIMING.settle, ease: 'Sine.easeInOut',
          onComplete: () => { this.busy = false; }
        }));
      }
    }));
    // staged content reveal
    this.title.setAlpha(0);
    this.badge.setAlpha(0);
    this.answerText.setAlpha(0);
    this.explainText.setAlpha(0);
    this.track(this.scene.tweens.add({
      targets: [this.title, this.badge], alpha: 1,
      duration: reduced ? 0 : 160, delay: reduced ? 0 : 130
    }));
    this.track(this.scene.tweens.add({
      targets: [this.answerText, this.explainText], alpha: 1,
      duration: reduced ? 0 : 180, delay: reduced ? 0 : 210
    }));

    DebugLog.info(`FeedbackCard: show ${kind} (scale ${scale.toFixed(2)}, display font ${this.fit.displayFont}px, token ${token})`);
    return true;
  }

  /**
   * Arm the action button — the scene calls this exactly when the physics
   * settle watcher (min-visible + settled, or the hard cap) allows the
   * transition. Idempotent per card.
   */
  setActionEnabled(ok) {
    if (!this.visible || this.acted) return;
    this.actionEnabled = ok;
    if (ok) {
      const reduced = !!(this.opts.reducedMotion && this.opts.reducedMotion());
      this.button.setInteractive({ useHandCursor: true });
      this.track(this.scene.tweens.add({
        targets: this.button, alpha: 1,
        duration: reduced ? 0 : 140, ease: 'Sine.easeOut'
      }));
    }
  }

  /** The one valid user exit. Runs the exit animation, then onAction(). */
  act() {
    if (this.acted || !this.visible || !this.actionEnabled) return;
    this.acted = true;
    this.button?.disableInteractive();
    this.hide(() => {
      if (this.onAction) {
        const cb = this.onAction;
        this.onAction = null;
        cb();
      }
    });
  }

  /** Smooth exit; onDone fires only when fully invisible. */
  hide(onDone) {
    if (!this.visible) { if (onDone) onDone(); return; }
    this.killTweens();
    this.visible = false;
    const reduced = !!(this.opts.reducedMotion && this.opts.reducedMotion());
    if (reduced) {
      this.backdrop.setVisible(false).setAlpha(0);
      this.root.setVisible(false).setAlpha(0);
      if (onDone) onDone();
      return;
    }
    const token = this.token;
    this.track(this.scene.tweens.add({
      targets: this.root, alpha: 0, scale: this.root.scaleX * 0.96,
      duration: TIMING.exit, ease: 'Sine.easeIn'
    }));
    this.track(this.scene.tweens.add({
      targets: this.backdrop, alpha: 0,
      duration: TIMING.exit, ease: 'Sine.easeIn',
      onComplete: () => {
        if (this.token !== token) return;
        this.backdrop.setVisible(false);
        this.root.setVisible(false);
        if (onDone) onDone();
      }
    }));
  }

  /** Programmatic close for restarts / level exits — no onAction side effects. */
  cancel() {
    this.onAction = null;
    this.acted = true; // neutralize any in-flight act()
    this.hide();
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle safety                                                    */
  /* ------------------------------------------------------------------ */

  track(t) { this.tweens.push(t); return t; }

  killTweens() {
    for (const t of this.tweens) { if (t.isActive()) t.remove(); }
    this.tweens.length = 0;
  }

  pause() {
    for (const t of this.tweens) t.pause();
  }

  resume() {
    for (const t of this.tweens) t.resume();
  }

  /** Debug/test snapshot. */
  info() {
    return {
      visible: this.visible,
      kind: this.kind,
      actionEnabled: this.actionEnabled,
      acted: this.acted,
      token: this.token,
      scale: this.root ? +this.root.scaleX.toFixed(3) : null,
      fit: this.fit
    };
  }

  destroy() {
    this.killTweens();
    this._scratch?.destroy();
    this._scratch = null;
    this.content?.destroy();
    this.content = null;
    this.backdrop?.destroy();
    this.backdrop = null;
    this.root?.destroy();
    this.root = null;
    this.visible = false;
  }
}
