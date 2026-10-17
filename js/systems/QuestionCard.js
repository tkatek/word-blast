/**
 * QuestionCard (Fix #9) — the animated English question presentation.
 *
 * ONE parchment card per question, driven through explicit presentation
 * phases (UI sub-states; the global GameStateMachine is untouched — it
 * stays in QUESTION_READY for the whole introduction):
 *
 *   IDLE → ENTERING (fade + 0.9→1 scale, centered)
 *        → READING  (mandatory readingMs of ACTIVE time; frame-driven via
 *                    tick(delta), so pause/portrait/auto-pause freeze it)
 *        → MOVING_TO_TOP (the SAME container tweens to its resting spot)
 *        → READY_TOP (parchment tappable for the enlarged "peek" view;
 *                     the scene arms AIMING exactly now)
 *        → EXITING (brief fade) → IDLE
 *
 * Reliability contract (this game has a history of transition freezes):
 *   - a monotonically increasing question token invalidates every stale
 *     tween completion / utterance callback of a previous question;
 *   - all tweens are tracked and killed on re-present / destroy — no
 *     overlapping tweens, no duplicate cards, no stale callbacks;
 *   - pause()/resume() freeze the visual tweens; the reading countdown
 *     already lives in the scene's pause-gated update();
 *   - the card is pure UI: it never consumes shots, never touches the
 *     timer/score and blocks gameplay input only through the scene's
 *     existing markUi() + slingshot enable flags.
 *
 * Audio: the blue medallion is a real button. Prerecorded per-question
 * audio does not exist in this project, so the ONLY honest playback is
 * the browser's Web Speech API — used strictly behind a voice-availability
 * check. When no speech engine/voices exist the button renders dimmed and
 * inert (never a fake click).
 */
import Phaser from 'phaser';
import { WORLD, QUESTION_CARD } from '../config.js';
import { DebugLog } from './DebugLog.js';

export const CARD_PHASES = {
  IDLE: 'IDLE',
  ENTERING: 'ENTERING',
  READING: 'READING',
  MOVING_TO_TOP: 'MOVING_TO_TOP',
  READY_TOP: 'READY_TOP',
  PEEK: 'PEEK',
  EXITING: 'EXITING'
};

/** True while the mandatory introduction owns the screen (timer frozen). */
const INTRO_PHASES = [CARD_PHASES.ENTERING, CARD_PHASES.READING, CARD_PHASES.MOVING_TO_TOP];

/** White speaker icon texture key (generated once, reused across restarts). */
const SPEAKER_TEX = 'wbqcard-speaker';

/* ------------------------------------------------------------------ */
/* Procedural fallbacks                                                */
/* ------------------------------------------------------------------ */

/**
 * Parchment-banner stand-in with the SAME geometry ratios as the supplied
 * artwork, drawn procedurally. Used when the PNG cannot be fetched
 * (headless test environments) so the card keeps working everywhere.
 */
export function ensureQuestionCardTexture(scene) {
  const T = scene.textures;
  if (T.exists(QUESTION_CARD.TEXTURE)) return;
  const W = 1041, H = Math.round(W * QUESTION_CARD.ART.ASPECT); // half-res
  const g = scene.add.graphics();
  // wooden frame
  g.fillStyle(0x4d3218, 1); g.fillRoundedRect(0, 0, W, H, 34);
  g.fillStyle(0x7f5539, 1); g.fillRoundedRect(8, 8, W - 16, H - 16, 28);
  g.fillStyle(0xc8905a, 1); g.fillRoundedRect(16, 14, W - 32, H - 30, 24);
  // parchment field
  const t = QUESTION_CARD.ART.TEXT;
  g.fillStyle(0xb98b4e, 1); g.fillRoundedRect(t.x0 * W, t.y0 * H, (t.x1 - t.x0) * W, (t.y1 - t.y0) * H, 26);
  g.fillStyle(0xf7e8c9, 1); g.fillRoundedRect(t.x0 * W + 6, t.y0 * H + 6, (t.x1 - t.x0) * W - 12, (t.y1 - t.y0) * H - 12, 22);
  // blue medallion + gold ring
  const s = QUESTION_CARD.ART.SPEAKER;
  const scx = s.x * W, scy = s.y * H, sr = s.r * W;
  g.fillStyle(0xe09f3e, 1); g.fillCircle(scx, scy, sr + 10);
  g.fillStyle(0x3d628f, 1); g.fillCircle(scx, scy, sr);
  g.fillStyle(0x2c4a70, 1); g.fillCircle(scx, scy, sr * 0.82);
  g.generateTexture(QUESTION_CARD.TEXTURE, W, H);
  g.destroy();
}

/** Clean white speaker + sound arcs, drawn once. */
function ensureSpeakerTexture(scene) {
  const T = scene.textures;
  if (T.exists(SPEAKER_TEX)) return;
  const g = scene.add.graphics();
  const body = (ox, oy, k) => {
    g.fillStyle(0xffffff, 1);
    g.fillPoints([
      new Phaser.Geom.Point(ox + 8 * k, oy + 17 * k),
      new Phaser.Geom.Point(ox + 17 * k, oy + 17 * k),
      new Phaser.Geom.Point(ox + 27 * k, oy + 6 * k),
      new Phaser.Geom.Point(ox + 27 * k, oy + 38 * k),
      new Phaser.Geom.Point(ox + 17 * k, oy + 27 * k),
      new Phaser.Geom.Point(ox + 8 * k, oy + 27 * k)
    ], true);
  };
  body(2, 2, 1);
  g.lineStyle(3.6, 0xffffff, 1);
  g.beginPath(); g.arc(30, 24, 10, -0.95, 0.95); g.strokePath();
  g.beginPath(); g.arc(30, 24, 16.5, -0.8, 0.8); g.strokePath();
  g.generateTexture(SPEAKER_TEX, 52, 52);
  g.destroy();
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

export class QuestionCard {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts {
   *   markUi()        — flags UI pointerdown so gameplay taps stay clean,
   *   reducedMotion() — save-settings reader (animations become instant),
   *   depth           — card depth (GameScene passes its PANEL depth),
   *   scrimDepth      — peek scrim depth (just under the HUD)
   * }
   */
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.markUi = opts.markUi || (() => {});
    this.reducedMotion = opts.reducedMotion || (() => false);
    this.depth = opts.depth ?? 80;
    this.token = 0;               // question-generation guard
    this.phase = CARD_PHASES.IDLE;
    this.readRemainingMs = 0;
    this.readElapsedMs = 0;
    this.tweens = [];             // live card-owned tweens (paused on pause)
    this.question = null;         // last presented payload
    this.speaking = false;

    ensureQuestionCardTexture(scene);
    ensureSpeakerTexture(scene);

    const W = QUESTION_CARD.CENTER.width;
    const H = Math.round(W * QUESTION_CARD.ART.ASPECT);
    this.baseW = W;
    this.baseH = H;
    this.topScale = QUESTION_CARD.TOP.width / QUESTION_CARD.CENTER.width;

    /* peek scrim — dims the playfield, sits just UNDER the HUD so the
       pause button stays reachable; blocks gameplay taps via markUi */
    this.scrim = scene.add.rectangle(
      WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x08131f, 0
    ).setDepth(opts.scrimDepth ?? 49).setVisible(false)
      .setInteractive({ useHandCursor: false });
    this.scrim.on('pointerdown', () => {
      this.markUi();
      this.closePeek();
    });

    /* the card itself — one container, re-presented per question */
    this.root = scene.add.container(QUESTION_CARD.CENTER.x, QUESTION_CARD.CENTER.y)
      .setDepth(this.depth).setVisible(false);
    this.shadow = scene.add.image(0, QUESTION_CARD.SHADOW.dy, QUESTION_CARD.TEXTURE)
      .setTint(0x120b04).setAlpha(QUESTION_CARD.SHADOW.alpha);
    this.art = scene.add.image(0, 0, QUESTION_CARD.TEXTURE);
    this.kicker = scene.add.text(0, 0, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold',
      fontSize: `${QUESTION_CARD.TYPE.KICKER.size}px`, color: QUESTION_CARD.TYPE.KICKER.color
    }).setOrigin(0.5, 0);
    this.main = scene.add.text(0, 0, '', {
      fontFamily: 'Arial, Helvetica, sans-serif', fontStyle: 'bold',
      fontSize: `${QUESTION_CARD.TYPE.MAIN.size}px`, color: QUESTION_CARD.TYPE.MAIN.color,
      align: 'center', wordWrap: { width: 100, useAdvancedWrap: true }
    }).setOrigin(0.5, 0);
    this.root.add([this.shadow, this.art, this.kicker, this.main]);

    /* speaker icon + hit circle pinned to the blue medallion */
    const s = QUESTION_CARD.ART.SPEAKER;
    this.speakerPos = { x: -W / 2 + s.x * W, y: -H / 2 + s.y * H };
    this.speakerR = s.r * W;
    this.speaker = scene.add.image(this.speakerPos.x, this.speakerPos.y, SPEAKER_TEX)
      .setDisplaySize(this.speakerR * 1.15, this.speakerR * 1.15);
    const hitD = this.speakerR * 1.7;
    this.speakerHitArea = new Phaser.Geom.Circle(hitD / 2, hitD / 2, this.speakerR * 0.8);
    this.speakerHit = scene.add.rectangle(this.speakerPos.x, this.speakerPos.y, hitD, hitD, 0xffffff, 0);
    this.setSpeakerInteractive(false);
    this.speakerHit.on('pointerdown', () => { this.markUi(); });
    this.speakerHit.on('pointerup', () => this.trySpeak());
    this.root.add([this.speaker, this.speakerHit]);

    /* parchment tap zone — opens/closes the enlarged reading view */
    const t = QUESTION_CARD.ART.TEXT;
    const zx0 = -W / 2 + t.x0 * W, zx1 = -W / 2 + t.x1 * W;
    const zy0 = -H / 2 + t.y0 * H, zy1 = -H / 2 + t.y1 * H;
    this.zone = { x0: zx0, x1: zx1, y0: zy0, y1: zy1, w: zx1 - zx0, h: zy1 - zy0 };
    this.parchHit = scene.add.rectangle((zx0 + zx1) / 2, (zy0 + zy1) / 2, this.zone.w, this.zone.h, 0xffffff, 0)
      .setInteractive({ useHandCursor: true });
    this.parchHit.on('pointerdown', () => { this.markUi(); });
    this.parchHit.on('pointerup', () => {
      if (this.phase === CARD_PHASES.READY_TOP) this.openPeek();
      else if (this.phase === CARD_PHASES.PEEK) this.closePeek();
    });
    this.root.add(this.parchHit);

    /* tiny "tap to enlarge" affordance (shown only for shrunk text) */
    this.enlargeHint = scene.add.text(
      this.zone.x1 - 4, this.zone.y1 - 4, '⤢ tap to enlarge', {
        fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '13px',
        color: '#8a5a2b', fontStyle: 'bold'
      }
    ).setOrigin(1, 1).setAlpha(0.75);
    this.root.add(this.enlargeHint);

    scene.events.once('shutdown', () => this.destroy());
    this.refreshTtsAvailability();
  }

  /* ---------------------------------------------------------------- */
  /* Presentation                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Begin a question's full introduction. Interrupts and replaces any
   * presentation in flight (restart safety); invalidates old tokens.
   * @param {object} q { index, total, cefr, text }
   * @param {() => void} onArmed fired ONCE when the card reaches its top
   *        resting spot — the scene enables AIMING exactly then.
   */
  present(q, onArmed) {
    const token = ++this.token;
    this.question = { ...q };
    this.onArmed = onArmed || null;
    this.killTweens();
    this.closePeek(true);
    this.layout(q);

    const { CENTER, TIMINGS } = QUESTION_CARD;
    this.root.setPosition(CENTER.x, CENTER.y).setScale(1).setVisible(true);
    this.phase = CARD_PHASES.ENTERING;
    this.readRemainingMs = TIMINGS.readingMs;
    this.readElapsedMs = 0;
    DebugLog.info(`Card — ENTERING question ${q.index + 1}/${q.total} "${q.text.slice(0, 40)}…"`);

    if (this.reducedMotion()) {
      this.root.setAlpha(1);
      this.beginReading(token);
      return;
    }
    this.root.setAlpha(0).setScale(0.9);
    this.track(this.scene.tweens.add({
      targets: this.root, alpha: 1, scaleX: 1, scaleY: 1,
      duration: TIMINGS.enterMs, ease: 'Sine.easeOut',
      onComplete: () => {
        if (token !== this.token) return; // stale
        this.beginReading(token);
      }
    }));
  }

  /** ENTERING finished → hold centered for the mandatory reading time. */
  beginReading(token) {
    if (token !== this.token) return;
    this.phase = CARD_PHASES.READING;
    this.root.setScale(1).setAlpha(1);
    DebugLog.info(`Card — READING (${QUESTION_CARD.TIMINGS.readingMs}ms active time)`);
  }

  /**
   * Frame heartbeat (called from the scene's pause-gated update()):
   * advances ONLY the reading countdown, so pause / portrait rotation /
   * hidden-tab auto-pause freeze the remaining presentation time exactly
   * like the level timer.
   */
  tick(delta) {
    if (this.phase !== CARD_PHASES.READING) return;
    this.readElapsedMs += delta;
    this.readRemainingMs = Math.max(0, this.readRemainingMs - delta);
    if (this.readRemainingMs <= 0) this.moveToTop();
  }

  /** READING done → the SAME container glides to its resting spot. */
  moveToTop() {
    const token = this.token;
    const { TOP, TIMINGS } = QUESTION_CARD;
    this.phase = CARD_PHASES.MOVING_TO_TOP;
    DebugLog.info('Card — MOVING_TO_TOP');
    if (this.reducedMotion()) {
      this.root.setPosition(TOP.x, TOP.y).setScale(this.topScale);
      this.finishMove(token);
      return;
    }
    this.track(this.scene.tweens.add({
      targets: this.root,
      x: TOP.x, y: TOP.y, scaleX: this.topScale, scaleY: this.topScale,
      duration: TIMINGS.moveMs, ease: 'Sine.easeInOut',
      onComplete: () => this.finishMove(token)
    }));
  }

  finishMove(token) {
    if (token !== this.token) return;
    const { TOP } = QUESTION_CARD;
    this.root.setPosition(TOP.x, TOP.y).setScale(this.topScale);
    this.phase = CARD_PHASES.READY_TOP;
    DebugLog.info('Card — READY_TOP (gameplay may arm)');
    if (this.onArmed) {
      const cb = this.onArmed;
      this.onArmed = null; // fire exactly once per presentation
      cb();
    }
  }

  /**
   * Brief exit animation (question completed / level end). The card hides
   * itself; a new present() may interrupt at any moment.
   */
  dismiss() {
    const token = this.token;
    this.onArmed = null;
    this.closePeek(true);
    if (this.phase === CARD_PHASES.IDLE || this.phase === CARD_PHASES.EXITING) return;
    this.phase = CARD_PHASES.EXITING;
    DebugLog.info('Card — EXITING');
    if (this.reducedMotion()) {
      this.root.setVisible(false);
      this.phase = CARD_PHASES.IDLE;
      return;
    }
    const s = this.root.scaleX;
    this.track(this.scene.tweens.add({
      targets: this.root, alpha: 0, scaleX: s * 0.92, scaleY: s * 0.92,
      duration: QUESTION_CARD.TIMINGS.exitMs, ease: 'Sine.easeIn',
      onComplete: () => {
        if (token !== this.token) return;
        this.root.setVisible(false);
        this.phase = CARD_PHASES.IDLE;
      }
    }));
  }

  /** Enlarged reading view (from READY_TOP only) — no projectile fired. */
  openPeek() {
    if (this.phase !== CARD_PHASES.READY_TOP) return;
    const token = this.token;
    this.phase = CARD_PHASES.PEEK;
    DebugLog.info('Card — PEEK open (enlarged reading view)');
    this.scene.events.emit('wb-card-peek', true);
    this.scrim.setVisible(true);
    if (this.reducedMotion()) {
      this.scrim.setAlpha(0.38);
      this.root.setPosition(QUESTION_CARD.CENTER.x, QUESTION_CARD.CENTER.y).setScale(1);
      return;
    }
    this.killTweensOf(this.root); // a rapid toggle never overlaps tweens
    this.track(this.scene.tweens.add({ targets: this.scrim, alpha: 0.38, duration: QUESTION_CARD.TIMINGS.peekMs, ease: 'Sine.easeOut' }));
    this.track(this.scene.tweens.add({
      targets: this.root,
      x: QUESTION_CARD.CENTER.x, y: QUESTION_CARD.CENTER.y, scaleX: 1, scaleY: 1,
      duration: QUESTION_CARD.TIMINGS.peekMs, ease: 'Sine.easeOut',
      onComplete: () => { if (token === this.token) this.root.setScale(1); }
    }));
  }

  /** Back to the resting spot. `instant` skips animation (internal use). */
  closePeek(instant = false) {
    const wasPeek = this.phase === CARD_PHASES.PEEK;
    if (!wasPeek && !instant) return;
    if (wasPeek) this.phase = CARD_PHASES.READY_TOP;
    if (!wasPeek) return;
    this.scene.events.emit('wb-card-peek', false);
    const { TOP, TIMINGS } = QUESTION_CARD;
    if (instant || this.reducedMotion()) {
      this.killTweensOf(this.scrim);
      this.killTweensOf(this.root);
      this.scrim.setVisible(false).setAlpha(0);
      this.root.setPosition(TOP.x, TOP.y).setScale(this.topScale);
      return;
    }
    this.killTweensOf(this.scrim);
    this.killTweensOf(this.root);
    this.track(this.scene.tweens.add({
      targets: this.scrim, alpha: 0, duration: TIMINGS.peekMs, ease: 'Sine.easeIn',
      onComplete: () => this.scrim.setVisible(false)
    }));
    this.track(this.scene.tweens.add({
      targets: this.root,
      x: TOP.x, y: TOP.y, scaleX: this.topScale, scaleY: this.topScale,
      duration: TIMINGS.peekMs, ease: 'Sine.easeInOut'
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Pause (manual menu, portrait rotation, hidden tab)                */
  /* ---------------------------------------------------------------- */

  /** Freeze the visual timeline (reading time already frame-gated). */
  pause() {
    for (const tw of this.tweens) {
      if (tw.isActive()) tw.pause();
    }
  }

  /** Continue exactly where the presentation was frozen. */
  resume() {
    for (const tw of this.tweens) {
      if (tw.isPaused()) tw.resume();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Text layout                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Fit kicker + wrapped question into the parchment zone. Sizing runs
   * against the TOP resting scale (the smallest the card ever gets while
   * readable), so the exact same layout stays legible at the top and the
   * center simply shows it larger — one layout, zero reflow flicker.
   */
  layout(q) {
    const zx = this.zone.w * this.topScale;
    const zy = this.zone.h * this.topScale;

    this.kicker.setText(`QUESTION ${q.index + 1}/${q.total} · ${q.cefr}`);
    let kSize = QUESTION_CARD.TYPE.KICKER.size;
    this.kicker.setStyle({ fontSize: `${kSize}px` });
    while (kSize > QUESTION_CARD.TYPE.KICKER.min && this.kicker.width > zx) {
      kSize -= 1;
      this.kicker.setStyle({ fontSize: `${kSize}px` });
    }

    const gap = 7 * this.topScale + 3;
    const availH = zy - this.kicker.height - gap;
    let size = QUESTION_CARD.TYPE.MAIN.size;
    this.main.setWordWrapWidth(Math.max(80, zx), true);
    this.main.setStyle({ fontSize: `${size}px` });
    this.main.setText(q.text);
    while (size > QUESTION_CARD.TYPE.MAIN.min && this.main.height > availH) {
      size -= 1;
      this.main.setStyle({ fontSize: `${size}px` });
    }

    // vertical centering of the whole text block inside the parchment
    const blockH = this.kicker.height + gap + this.main.height;
    const top = this.zone.y0 + (this.zone.h - blockH) / 2;
    const cx = (this.zone.x0 + this.zone.x1) / 2;
    this.kicker.setPosition(cx, top);
    this.main.setPosition(cx, top + this.kicker.height + gap);

    // shrink affordance: only when the question actually had to shrink
    this.fittedSize = size;
    this.enlargeHint.setVisible(size < QUESTION_CARD.TYPE.MAIN.size - 2);
  }

  /* ---------------------------------------------------------------- */
  /* Audio (Web Speech, availability-checked)                          */
  /* ---------------------------------------------------------------- */

  /** Re-check the speech engine (voices populate asynchronously). */
  refreshTtsAvailability() {
    const synth = (typeof window !== 'undefined' && window.speechSynthesis) ? window.speechSynthesis : null;
    this.synth = synth;
    this.voices = synth ? (synth.getVoices() || []) : [];
    if (synth && !this.voices.length && !this._voicesHooked && typeof synth.addEventListener === 'function') {
      this._voicesHooked = true;
      synth.addEventListener('voiceschanged', () => {
        // the scene/card may be long gone when voices finally arrive
        if (!this.scene || !this.scene.scene) return;
        this.refreshTtsAvailability();
      });
    }
    this.syncSpeakerVisual();
  }

  get ttsAvailable() {
    return !!(this.synth && this.voices && this.voices.length);
  }

  /** Hand cursor only when the button can genuinely speak. */
  setSpeakerInteractive(on) {
    if (on) {
      if (!this.speakerHit.input) {
        this.speakerHit.setInteractive(this.speakerHitArea, Phaser.Geom.Circle.Contains);
        this.speakerHit.input.cursor = 'pointer';
      }
    } else if (this.speakerHit.input) {
      this.speakerHit.disableInteractive();
    }
  }

  syncSpeakerVisual() {
    const ok = this.ttsAvailable;
    this.setSpeakerInteractive(ok);
    if (ok) {
      this.speaker.clearTint().setAlpha(1);
    } else {
      this.speaker.setTint(0x9fb0c4).setAlpha(0.55);
    }
  }

  /**
   * Pronounce the current question. Returns true when speech actually
   * started — never fakes success when no engine/voices exist.
   */
  trySpeak() {
    if (!this.question || this.phase === CARD_PHASES.EXITING || this.phase === CARD_PHASES.IDLE) return false;
    if (!this.ttsAvailable) {
      DebugLog.info('Card — audio requested but no speech voices available (button shows unavailable)');
      return false;
    }
    try {
      const utter = new window.SpeechSynthesisUtterance(this.question.text);
      const voice = this.voices.find((v) => /^en[-_]/i.test(v.lang)) || this.voices[0];
      if (voice) utter.voice = voice;
      utter.lang = voice ? voice.lang : 'en-US';
      utter.rate = 0.92;
      utter.onstart = () => {
        if (!this.speaker.active) return;
        this.speaking = true;
        this.scene.tweens.killTweensOf(this.speaker);
        this.scene.tweens.add({
          targets: this.speaker, scaleX: this.speaker.scaleX * 1.12, scaleY: this.speaker.scaleY * 1.12,
          duration: 220, yoyo: true, ease: 'Sine.easeInOut'
        });
      };
      utter.onend = utter.onerror = () => { this.speaking = false; };
      this.synth.cancel(); // a repeat tap restarts the pronunciation
      this.synth.speak(utter);
      DebugLog.info('Card — speaking question via Web Speech API');
      return true;
    } catch (e) {
      DebugLog.warn(`Card — speech failed: ${e.message}`);
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Bookkeeping                                                       */
  /* ---------------------------------------------------------------- */

  get introActive() {
    return INTRO_PHASES.includes(this.phase);
  }

  track(tw) {
    this.tweens.push(tw);
    return tw;
  }

  killTweensOf(target) {
    this.scene.tweens.killTweensOf(target);
    this.tweens = this.tweens.filter((tw) => tw.targets && !tw.targets.includes(target));
  }

  killTweens() {
    // every card tween targets the root or the scrim — killing those two
    // severs the whole live timeline, whatever phase it was in
    this.scene.tweens.killTweensOf([this.root, this.scrim]);
    this.tweens = [];
    if (this.phase !== CARD_PHASES.PEEK) {
      this.scrim.setVisible(false).setAlpha(0);
    }
  }

  /** Debug/test snapshot. */
  info() {
    return {
      phase: this.phase,
      introActive: this.introActive,
      token: this.token,
      x: +this.root.x.toFixed(1),
      y: +this.root.y.toFixed(1),
      scale: +this.root.scaleX.toFixed(3),
      visible: this.root.visible,
      alpha: +this.root.alpha.toFixed(2),
      readRemainingMs: Math.round(this.readRemainingMs),
      readElapsedMs: Math.round(this.readElapsedMs),
      fittedFontSize: this.fittedSize,
      enlargeHint: this.enlargeHint.visible,
      ttsAvailable: this.ttsAvailable,
      speaking: this.speaking,
      question: this.question ? {
        index: this.question.index,
        text: this.question.text
      } : null
    };
  }

  destroy() {
    this.killTweens();
    this.scene.tweens.killTweensOf(this.speaker);
    try {
      if (this.synth && this.speaking) this.synth.cancel();
    } catch { /* engine may be gone */ }
    this.root?.destroy();
    this.scrim?.destroy();
    this.root = this.scrim = null;
  }
}
