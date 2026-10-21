/**
 * GameScene — orchestrates one level: question flow, slingshot launches,
 * collision routing, answer validation, scoring, failure/retry, pause and
 * victory. All heavy lifting is delegated to the systems; this scene is the
 * coordination layer only.
 */
import Phaser from 'phaser';
import {
  STATES, WORLD, COLORS, PHYSICS, SLINGSHOT, PROJECTILE_TYPES, TARGETS, SCORING, FEEDBACK, HUD,
  QUESTION_CARD, slingshotAnchor
} from '../config.js';
import { GameStateMachine } from '../systems/GameStateMachine.js';
import { ObjectFactory } from '../systems/PhysicsObjects.js';
import { Slingshot } from '../systems/Slingshot.js';
import { ScoringSystem } from '../systems/ScoringSystem.js';
import { solveLaunch, predictPath } from '../systems/Trajectory.js';
import { BackgroundManager } from '../systems/BackgroundManager.js';
import { EffectsSystem } from '../systems/EffectsSystem.js';
import { deviceInfo, requiresLandscape } from '../systems/Device.js';
import { attachViewport } from '../systems/Viewport.js';
import { DebugLog } from '../systems/DebugLog.js';
import { GameHUD, woodPanel, woodButton, chunkyText } from '../systems/GameHUD.js';
import { LevelTimer } from '../systems/LevelTimer.js';
import { HeartsSystem } from '../systems/HeartsSystem.js';
import { QuestionCard } from '../systems/QuestionCard.js';
import { BirdInventory } from '../systems/BirdInventory.js';
import { BirdSelector, AbilityButton, SELECTOR_ORDER, SELECTOR_LAYOUT } from '../systems/BirdSelector.js';
import { planQuestion } from '../systems/AnswerPanel.js';
import { AnswerPeek } from '../systems/AnswerPeek.js';
import { FeedbackCard } from '../systems/FeedbackCard.js';

const DEPTH = { HUD: 50, PANEL: 80, OVERLAY: 100 };

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.stateChangeHandlers = []; // must exist before the state machine first fires
    this.disableAutoPause = false; // set via debug API for automated runs; survives restarts
    this.peekHooked = false;       // peek listener registered (Fix #9)
  }

  /** Slingshot availability follows the question card's peek state (Fix #9). */
  onCardPeek(open) {
    if (!this.slingshot) return;
    if (open) {
      this.slingshot.cancelDrag();
      this.slingshot.setEnabled(false);
    } else if (this.stateMachine && this.stateMachine.is(STATES.AIMING) && !this.stateMachine.isPaused()) {
      this.slingshot.setEnabled(true);
    }
  }

  init(data) {
    this.levelId = Math.max(1, Math.min(15, data.levelId || 1));
    // Fix #9 — the card's peek (enlarged reading) view must never let a
    // slingshot drag start behind it. Registered once per scene instance
    // (the handler re-reads the live slingshot on every call); init() is
    // the earliest hook where the scene's event emitter exists.
    if (!this.peekHooked && this.events) {
      this.peekHooked = true;
      this.events.on('wb-card-peek', (open) => this.onCardPeek(open));
    }
    // Scene instances are reused across restarts: null out every per-run
    // reference here so create() never touches destroyed objects from a
    // previous lifetime (double-boot protection).
    this.level = null;
    this.stateMachine = null;
    this.factory = null;
    this.scoring = null;
    this.slingshot = null;
    this.background = null;
    this.device = null;
    this.prepared = null;
    this.currentShot = null;
    this.hud = null;              // GameHUD (Fix #17); built in create()
    this.levelTimer = null;       // authoritative countdown (LevelTimer)
    this.hearts = null;           // level-life rules (HeartsSystem)
    this.birdInventory = null;    // bird ammunition (Fix #19)
    this.birdSelector = null;     // bird-selection card row (Fix #19)
    this.abilityButton = null;    // mid-flight ability button (Fix #19)
    this.card = null;             // animated question card (Fix #9)
    this.cardExitPending = null;  // queued next-question hand-off during the card exit (Fix #9)
    this.feedbackCard = null;     // wooden answer-feedback card (correct/wrong)
    this.feedbackArmed = false;   // settle watcher armed the card's action button
    this.feedbackAdvancing = false; // one-shot guard: feedback → transition
    this.leavingLevel = false;    // one-shot guard for restart / exit clicks
    this.uiPointerConsumed = false; // a UI button ate this pointerdown
    this.questionIndex = 0; // known before create() for logging
    this.abilityHint = null;
    this.tutorialHint = null;
  }

  create() {
    // shared systems
    this.questions = this.registry.get('questions');
    this.levels = this.registry.get('levels');
    this.save = this.registry.get('save');
    this.audio = this.registry.get('audio');
    this.level = this.levels.getLevel(this.levelId);

    this.stateMachine = new GameStateMachine((next, prev) => this.onStateChanged(next, prev));
    this.stateMachine.set(STATES.LOADING); // BOOTING -> LOADING while the level builds
    this.factory = new ObjectFactory(this);
    this.scoring = new ScoringSystem();
    this.scoring.configure(this.levels.totalShotsForLevel(this.levelId));
    this.save.markAttempt(this.levelId);

    // runtime state
    this.questionIndex = 0;
    this.prepared = null;
    this.shotsLeft = this.level.shotsPerQuestion;
    this.selectedProjectile = 'basic';
    this.currentShot = null;
    this.answerLock = false;
    // Fix #19 — bird ammunition: counts come from levels.json "birdAmmo"
    // (data-driven, never hardcoded in the UI) and re-initialize at the
    // start of every question (BIRD_AMMO.MODE 'per-question').
    if (!this.level.projectiles.includes(this.selectedProjectile)) {
      this.selectedProjectile = this.level.projectiles[0];
    }
    this.birdInventory = new BirdInventory(
      this.level.projectiles,
      this.levels.getBirdAmmo(this.levelId)
    );
    if (!this.birdInventory.canSelect(this.selectedProjectile)) {
      this.selectedProjectile = this.birdInventory.firstAvailable() || this.selectedProjectile;
    }
    this.elapsedMs = 0;          // pause-aware clock (movers)
    this.settleFrames = 0;
    this.settleStartedAt = 0;
    this.slowFrames = 0;         // consecutive quiet frames for shot resolution
    this.armPending = false;     // re-arm deferred by a pause lands on resume
    this.leavingLevel = false;
    this.uiPointerConsumed = false;

    // Fix #17 — level life + countdown (fresh every create(), so a restart
    // can never inherit a stale timer or a stale heart count)
    this.hearts = new HeartsSystem(HUD.HEARTS_PER_LEVEL);
    this.levelTimer = new LevelTimer(HUD.TIME_LIMIT_MS);

    this.buildWorld();
    this.buildHUD();
    this.buildOverlays();

    // destruction/impact effects (particles, shake) — capped, reduced-motion aware
    this.fx = new EffectsSystem(this);
    this.events.once('shutdown', () => this.fx.destroy());

    this.slingshot = new Slingshot(this, {
      // origin = the pouch position at release, so the physics body spawns
      // exactly where the player saw the projectile leave the slingshot
      onLaunch: (vx, vy, type, origin) => this.launchProjectile(vx, vy, type, origin)
    });

    this.matter.world.on('collisionstart', this.onCollisionStart, this);
    this.input.keyboard.on('keydown-P', () => this.togglePause());
    // Escape pauses/resumes too (final polish): with the exit confirmation
    // card on screen it simply cancels that dialog instead.
    this.input.keyboard.on('keydown-ESC', () => {
      if (this.hud && this.hud.pauseOpen && this.hud.confirmVisible) {
        this.hud.hideConfirm();
        return;
      }
      this.togglePause();
    });
    this.input.keyboard.on('keydown-R', () => this.restartLevel());
    this.input.keyboard.on('keydown-M', () => this.exitToMenu());
    // Fix #19 — Space activates the flying bird's ability (desktop). The
    // same state gates as tap-activation apply (flight only, never paused).
    this.input.keyboard.on('keydown-SPACE', () => this.tryActivateAbilities());
    for (let i = 1; i <= 5; i++) {
      this.input.keyboard.on(`keydown-${i}`, () => this.selectProjectileByIndex(i - 1));
    }
    this.input.on('pointerdown', () => {
      // UI buttons flag their own pointerdown (Phaser emits GameObject
      // events before scene-level ones), so a tap on the pause button, a
      // bird card or a menu entry can never accidentally trigger the
      // loaded bird's ability.
      const uiTap = this.uiPointerConsumed;
      this.uiPointerConsumed = false;
      if (uiTap) return;
      if (this.stateMachine.is(STATES.PROJECTILE_FLYING)) this.tryActivateAbilities();
    });

    this.setupLifecycle();
    this.setupOrientation();

    // Audio: no ambience loops, no per-scene music startup. The background
    // track is manager-owned (started by the PLAY press) and simply keeps
    // playing across questions, levels and scene restarts — it is never
    // restarted here. The single movement voice (leather stretch) is
    // stopped on shutdown so nothing survives a level change or restart.
    this.events.once('shutdown', () => {
      this.audio?.stopSlingMotion(0);
    });

    // go
    this.stateMachine.set(STATES.LEVEL_READY);
    this.showToast(`LEVEL ${this.levelId} — ${this.level.name}`);
    this.loadQuestion(0);
    this.events.emit('wb-ready', this);
  }

  /* ------------------------------------------------------------------ */
  /* World + HUD                                                         */
  /* ------------------------------------------------------------------ */

  buildWorld() {
    this.cameras.main.setBackgroundColor(COLORS.SKY);
    // The official background (depth -100) is the ONLY visible terrain: its
    // painted grass line is pinned to WORLD.GROUND_Y, and the gameplay
    // surface is the single invisible static collider at that same line.
    // One ground for every device — desktop, tablet and phone alike.
    this.device = deviceInfo();
    this.factory.createTerrain();
    this.background = new BackgroundManager(this);
    this.background.apply();
  }

  buildHUD() {
    // Top game HUD (Fix #17): cartoon wooden bar with pause button, level
    // plaque, timer / question / stars, hearts, shots, score and sound.
    // The HUD owns no gameplay state — it renders whatever refreshHUD()
    // pushes and calls back into this scene through `actions`.
    this.hud = new GameHUD(this, {
      onPause: () => this.doPause(),
      onResume: () => this.togglePause(),
      onRestartQuestion: () => this.restartQuestionFromMenu(),
      onRestartLevel: () => this.restartLevel(),
      onExitToLevels: () => this.exitToLevelSelect(),
      // Leave fullscreen from the pause menu: only the document state
      // changes — the game stays paused exactly as the player left it, and
      // the fullscreenchange → ViewportController path resizes the canvas.
      onExitFullscreen: () => this.registry.get('fullscreen')?.exit(),
      onToggleSound: () => this.toggleSound(),
      onToggleMusic: () => this.toggleMusic(),
      onToggleSfx: () => this.toggleSfx(),
      onToggleReducedMotion: () => this.toggleReducedMotion()
    }, {
      markUi: () => { this.uiPointerConsumed = true; },
      save: this.save
    });
    this.hud.setTimer(HUD.TIME_LIMIT_MS);

    // Fix #9 — the animated wooden parchment question card (replaces the
    // old plain-text question/choices strips). It presents each question
    // center-screen for a mandatory reading window, then glides to its
    // upper-left dock and arms gameplay. The card owns no gameplay state.
    // Fix #21 — tapping the docked card opens the enlarged reading view;
    // the scene allows that ONLY in safe states (never mid-shot).
    this.card = new QuestionCard(this, {
      markUi: () => { this.uiPointerConsumed = true; },
      reducedMotion: () => !!(this.save && this.save.data.settings.reducedMotion),
      canExpand: () => {
        if (!this.stateMachine || this.stateMachine.isPaused()) return false;
        const s = this.stateMachine.current;
        return s === STATES.QUESTION_READY || s === STATES.AIMING;
      },
      depth: DEPTH.PANEL,
      scrimDepth: DEPTH.HUD - 1 // peek scrim dims gameplay but not the HUD
    });

    // Fix #19 — bird-selection card row: five blue-gradient cards in one
    // shared tray at the bottom-center; the selector owns no state, it
    // renders what refreshHUD() pushes and clicks route back through
    // selectProjectile() with the same availability gates.
    this.birdSelector = new BirdSelector(this, {
      onSelect: (key) => this.selectProjectile(key),
      markUi: () => { this.uiPointerConsumed = true; },
      audio: this.audio
    });

    // small unobtrusive ability hint for the selected bird (left-aligned
    // directly above the selector tray — anchored to the shared layout)
    this.abilityHint = this.add.text(
      SELECTOR_LAYOUT.leftX + 4, SELECTOR_LAYOUT.topY - 6, '', {
        fontFamily: 'Arial', fontSize: '13px', color: '#eaf4ff'
      }).setOrigin(0, 1).setDepth(DEPTH.HUD).setShadow(0, 2, 'rgba(10,18,38,0.8)', 2, false, true);

    // mid-flight ability button (mobile + desktop), bottom-right — far
    // from the cards and outside the slingshot aiming zone
    this.abilityButton = new AbilityButton(this, {
      onActivate: () => this.tryActivateAbilities(),
      markUi: () => { this.uiPointerConsumed = true; }
    });

    this.refreshHUD();
  }

  buildOverlays() {
    // Wooden parchment answer-feedback card (correct / wrong) — replaces
    // the old plain dark-blue rectangle. Pure UI: the card renders the
    // validated answer + the question's real explanation and hands control
    // back through ONE action button; the button is armed by the physics
    // settle watcher, so the transition below it is always safe.
    this.feedbackCard = new FeedbackCard(this, {
      markUi: () => { this.uiPointerConsumed = true; },
      reducedMotion: () => !!(this.save && this.save.data.settings.reducedMotion),
      depth: DEPTH.OVERLAY
    });

    // The pause menu lives in the GameHUD (Fix #17) — nothing to build here.

    // fail overlay (out of shots / out of hearts / time up)
    const fx = WORLD.WIDTH / 2;
    this.failOverlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setVisible(false);
    const failScrim = this.add.rectangle(fx, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x08131f, 0.66)
      .setInteractive({ useHandCursor: false }); // swallows taps while shown
    failScrim.on('pointerdown', () => { this.uiPointerConsumed = true; });
    const failCard = woodPanel(this, fx, 295, 480, 390);
    const failInner = woodPanel(this, fx, 295, 446, 356, 'parch');
    this.failTitle = chunkyText(this, fx, 158, 'OUT OF SHOTS!', 38, '#a4323f').setOrigin(0.5);
    this.failBody = this.add.text(fx, 205, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#5c3a1e', align: 'center', wordWrap: { width: 400 }
    }).setOrigin(0.5, 0);
    this.failOverlay.add([failScrim, failCard, failInner, this.failTitle, this.failBody]);
    this.failRetryBtn = this.overlayButton(this.failOverlay, 'RETRY QUESTION', 322, () => this.retryQuestion(), 'green');
    this.overlayButton(this.failOverlay, 'RESTART LEVEL', 390, () => this.restartLevel(), 'orange');
    this.overlayButton(this.failOverlay, 'LEVELS', 458, () => this.exitToLevelSelect(), 'slate');

    // victory overlay — same wooden/parchment system as every other panel
    // (final polish: was plain white text on a black scrim)
    this.winOverlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setVisible(false);
    this.winOverlay.add(this.add.rectangle(fx, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x08131f, 0.62));
    const winCard = woodPanel(this, fx, 296, 500, 420);
    const winInner = woodPanel(this, fx, 296, 462, 382, 'parch');
    this.winTitle = chunkyText(this, fx, 158, 'LEVEL COMPLETE!', 40, '#4f9d69', 0x2c4a1e, 0).setOrigin(0.5);
    // three DRAWN stars (earned gold / unearned dark), popped in per result
    this.winStarIcons = [-1, 0, 1].map((i) => {
      const empty = this.add.image(fx + i * 78, 238, 'wbhud-star-empty').setDisplaySize(62, 62);
      const full = this.add.image(fx + i * 78, 238, 'wbhud-star').setDisplaySize(62, 62).setVisible(false);
      return { empty, full };
    });
    this.winScore = this.add.text(fx, 302, '', {
      fontFamily: 'Arial', fontSize: '24px', fontStyle: 'bold', color: '#5c3a1e'
    }).setOrigin(0.5);
    this.winOverlay.add([winCard, winInner, this.winTitle, ...this.winStarIcons.map((p) => p.empty),
      ...this.winStarIcons.map((p) => p.full), this.winScore]);
    this.overlayButton(this.winOverlay, 'NEXT LEVEL ▶', 346, () => this.goNextLevel(), 'green');
    this.overlayButton(this.winOverlay, 'REPLAY', 408, () => this.restartLevel(), 'blue');
    this.overlayButton(this.winOverlay, 'MENU', 470, () => this.exitToMenu(), 'slate');

    // rotate-device overlay (phones in portrait — gameplay is frozen behind it)
    this.rotateOverlay = this.add.container(WORLD.WIDTH / 2, WORLD.HEIGHT / 2).setDepth(200).setVisible(false);
    const rotateShade = this.add.rectangle(0, 0, WORLD.WIDTH, WORLD.HEIGHT, 0x081c15, 0.96)
      .setPosition(0, 0)
      .setInteractive({ useHandCursor: false }); // swallows all input while shown
    const rotateIcon = this.add.graphics();
    rotateIcon.lineStyle(7, 0xffd60a, 1);
    rotateIcon.strokeRoundedRect(-30, -78, 60, 116, 12); // phone body
    rotateIcon.lineStyle(4, 0xffd60a, 1);
    rotateIcon.strokeRoundedRect(-18, -66, 36, 60, 4);   // screen
    rotateIcon.fillStyle(0xffd60a, 1);
    rotateIcon.fillRoundedRect(-9, 20, 18, 4, 2);        // home button
    rotateIcon.lineStyle(6, 0xffffff, 1);
    rotateIcon.beginPath();
    rotateIcon.arc(0, -12, 92, Phaser.Math.DegToRad(-35), Phaser.Math.DegToRad(195));
    rotateIcon.strokePath();                              // rotation arc
    rotateIcon.fillTriangle(72, -56, 96, -46, 70, -32);   // arrow head
    const rotateTitle = this.add.text(0, 80, 'Rotate Your Phone', {
      fontFamily: 'Arial', fontSize: '34px', fontStyle: 'bold', color: '#ffd60a'
    }).setOrigin(0.5);
    const rotateSub = this.add.text(0, 122, 'WORD BLAST is played in landscape.\nTurn your phone sideways to continue.', {
      fontFamily: 'Arial', fontSize: '17px', color: '#ffffff', align: 'center'
    }).setOrigin(0.5);
    this.rotateOverlay.add([rotateShade, rotateIcon, rotateTitle, rotateSub]);

    // toast
    this.toastText = this.add.text(WORLD.WIDTH / 2, 560, '', {
      fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#ffffff',
      backgroundColor: '#14213dcc', padding: { x: 16, y: 8 }
    }).setOrigin(0.5).setDepth(DEPTH.OVERLAY).setAlpha(0);

    // tutorial hint (next to the slingshot)
    if (this.levelId === 1 && !this.save.data.tutorialDone) {
      const a = slingshotAnchor();
      this.tutorialHint = this.add.text(a.x + 42, a.y - 66,
        'Drag the ball back and release\nto hit the correct answer!', {
          fontFamily: 'Arial', fontSize: '16px', color: '#1d3557', backgroundColor: '#ffffffcc', padding: { x: 8, y: 6 }
        }).setDepth(DEPTH.HUD);
    }
  }

  /** Wooden cartoon button for the full-screen overlays. */
  overlayButton(container, label, y, onClick, color = 'green', w = 330) {
    const btn = woodButton(this, {
      x: WORLD.WIDTH / 2, y, w, h: 58, label, color, size: 21,
      onClick: () => {
        this.audio?.emit('ui-click'); // Fix #22 — polished click on every overlay action
        onClick();
      },
      markUi: () => { this.uiPointerConsumed = true; }
    });
    container.add(btn);
    return btn;
  }

  setupLifecycle() {
    this.onVisibilityChange = () => {
      if (document.hidden) this.autoPause();
    };
    this.onBlur = () => this.autoPause();
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('blur', this.onBlur);
    // once(): scene instances are REUSED across restarts and Phaser's
    // Systems.shutdown() does NOT clear the events emitter — a plain on()
    // here accumulated one stale closure per restart (slow listener leak).
    this.events.once('shutdown', () => {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      window.removeEventListener('blur', this.onBlur);
      this.stateChangeHandlers.length = 0;
      this.events.emit('wb-shutdown');
    });
  }

  /* ------------------------------------------------------------------ */
  /* Question flow                                                       */
  /* ------------------------------------------------------------------ */

  loadQuestion(index) {
    DebugLog.info(`L${this.levelId} / Question ${index + 1} — cleaning question ${this.questionIndex + 1}`);
    this.questionIndex = index;
    // Any feedback card still on screen (restart / retry during feedback)
    // is cancelled WITHOUT running its action — the reload owns the state.
    this.feedbackCard?.cancel();
    this.feedbackArmed = false;
    this.feedbackAdvancing = false;
    this.factory.clearQuestionObjects();
    this.answerLock = false;
    this.currentShot = null;
    this.shotsLeft = this.level.shotsPerQuestion;
    // Fix #19 — fresh bird ammunition for every question attempt (the
    // enabled 'per-question' mode; retry/restart therefore also re-arms a
    // full inventory — consistent ammunition across pause/retry/restart).
    this.birdInventory.resetForQuestion();
    this.settleFrames = 0;
    this.slowFrames = 0;
    this.hearts?.clearCharge(); // a fresh attempt may be charged again on failure

    const entry = this.levels.getQuestionEntry(this.levelId, index);
    const question = this.questions.getQuestion(entry.questionId);
    this.prepared = this.questions.prepare(question);

    // layouts are baked against the canonical ground line and rigidly
    // translated onto the live flat ground (LevelManager)
    const layout = this.levels.getLayout(this.levelId, index);
    this.factory.buildLayout(layout);

    // Answer panel plan: measure every choice with real Phaser text metrics
    // and pick ONE shared format + font for the whole question (short words
    // → compact S/M/L plaque, sentences → the wide XL parchment panel).
    this.answerPlan = planQuestion(this, this.prepared.targets);
    layout.targets.forEach((t, i) => {
      const meta = this.prepared.targets[i];
      this.factory.createTarget(t, {
        choiceId: meta.choiceId, label: meta.label, text: meta.text,
        questionIndex: index, plan: this.answerPlan
      });
    });

    // Sentence questions get the enlarged reading view (hold a panel / press
    // Z while AIMING) — the phone-scale fallback that keeps the ink readable
    // without shrinking the panels any further.
    if (this.answerPeek) { this.answerPeek.destroy(); this.answerPeek = null; }
    if (this.answerPlan.format === 'XL') {
      this.answerPeek = new AnswerPeek(this, this.prepared.targets);
    }

    // Build-time settle: silent fixed steps with damage suppressed, then
    // everything sleeps. Towers are therefore at rest before the first
    // possible input; drift beyond SETTLE_MAX_DRIFT means the layout was
    // unstable (the generator battery guarantees this never ships).
    // PERF: the steps are AMORTIZED across frames in update() (≈6/frame)
    // — the old one-shot 75-step burst inside this call was a visible
    // hitch at every question transition, especially on phones. The card
    // intro covers the settle; arming waits for its completion either way.
    this.factory.beginSettle(PHYSICS.SETTLE_STEPS);

    // Fix #9 — the parchment card now presents the question: ENTERING →
    // READING (4s mandatory, timer frozen) → MOVING_TO_TOP → onArmed fires
    // armAiming exactly when the card reaches its resting spot. Any queued
    // NEXT_QUESTION hand-off is invalidated by this fresh load.
    this.cardExitPending = null;
    this.stateMachine.set(STATES.QUESTION_READY);
    this.refreshHUD();
    this.slingshot.setEnabled(false); // no aiming during the introduction
    this.audio.emit('question-ready', { index }); // Fix #22 — soft card whoosh
    this.card.present({
      index,
      total: this.level.questions.length,
      cefr: question.cefr,
      text: question.text
    }, () => this.armAiming());
    DebugLog.info(`L${this.levelId} / Question ${index + 1} — loaded "${question.text}"`);
  }

  armAiming() {
    if (this.stateMachine.isPaused()) {
      // The delayed call is consumed while paused — remember it and arm on
      // resume, otherwise the game would sit in QUESTION_READY forever.
      this.armPending = true;
      DebugLog.info('arming deferred: game paused');
      return;
    }
    // The amortized build-settle must finish before the slingshot can arm
    // (towers must be at rest). Same deferral path as pause: update()
    // re-invokes armAiming the moment the settle completes.
    if (this.factory.settling) {
      if (typeof process !== 'undefined' && process.env.WB_TRACE) console.log('[trace] armAiming deferred by settle');
      this.armPending = true;
      return;
    }
    if (!this.stateMachine.is(STATES.QUESTION_READY) && !this.stateMachine.is(STATES.PHYSICS_RESOLVING)
      && !this.stateMachine.is(STATES.ANSWER_FEEDBACK)) return;
    this.armPending = false;
    // Fix #19 — the next valid loading opportunity: keep the selection if
    // it still has ammunition, otherwise auto-select the next available
    // bird; with no birds left the existing failure/retry rules apply.
    if (!this.ensureBirdReady()) return;
    this.stateMachine.set(STATES.AIMING);
    this.slingshot.load(this.selectedProjectile);
    this.slingshot.setEnabled(true);
    this.refreshHUD();
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — READY Question ${this.questionIndex + 1}/4 (AIMING, shots: ${this.shotsLeft}, bird: ${this.selectedProjectile} ×${this.birdInventory.count(this.selectedProjectile)})`);
  }

  /**
   * Fix #19 — selection/ammo reconciliation at load time. Returns false
   * when no bird can be loaded (the failure flow already ran).
   */
  ensureBirdReady() {
    if (this.birdInventory.canSelect(this.selectedProjectile)) return true;
    const next = this.birdInventory.firstAvailable();
    if (next) {
      DebugLog.info(`L${this.levelId} — bird ${this.selectedProjectile} out of ammo; auto-selecting ${next}`);
      this.selectedProjectile = next;
      return true;
    }
    // No ammunition at all while shots remain → the existing failure and
    // retry rules (heart charged, retry re-arms a full inventory).
    if (this.shotsLeft > 0) {
      this.failQuestionAttempt('No birds left');
    }
    return false;
  }

  /* ------------------------------------------------------------------ */
  /* Shooting                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * @param {number} vx      launch velocity (px/step, Matter convention)
   * @param {number} vy
   * @param {string} typeKey projectile type
   * @param {{x:number,y:number}} [origin] pouch position at release — the
   *        physics body spawns exactly there (defaults to the anchor)
   */
  launchProjectile(vx, vy, typeKey, origin) {
    if (!this.stateMachine.is(STATES.AIMING)) return false;
    if (this.shotsLeft <= 0) return false;
    if (!this.levels.isProjectileAvailable(this.levelId, typeKey)) return false;
    // Fix #19 — firing consumes EXACTLY one ammunition unit (selection and
    // abilities never do). A rejected consume (empty type) refuses the
    // launch before any shot state exists — inventory can never go negative.
    if (!this.birdInventory.consume(typeKey)) {
      DebugLog.warn(`L${this.levelId} — launch of ${typeKey} refused: no ammunition left`);
      return false;
    }

    // Lifecycle (Fix #6B): the previous shot's late-answer window closes
    // the moment this new shot exists (the shotId guard in
    // routeProjectileImpact), so its leftover bodies are pure litter —
    // destroy them BEFORE the new bird spawns so nothing accumulates.
    this.factory.sweepProjectiles();

    const shotId = (this.currentShot?.id || 0) + 1;
    this.currentShot = {
      id: shotId, launched: true, answered: false, resolvedHandled: false,
      startedAt: this.time.now, typeKey
    };
    this.scoring.recordShot();
    this.shotsLeft--;
    this.slowFrames = 0;

    const o = origin || this.slingshot.anchor;
    const p = this.factory.createProjectile(typeKey, o.x, o.y, shotId);
    p.setVelocity(vx, vy);
    p.setAngularVelocity(0.08);

    this.stateMachine.set(STATES.PROJECTILE_FLYING);
    // Fix #22 — audio hook: power 0..1 scales the release snap + bird cry.
    this.audio.emit('launch', {
      power: Math.min(1, Math.hypot(vx, vy) / SLINGSHOT.MAX_SPEED),
      typeKey, x: o.x, y: o.y
    });
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — SHOT #${shotId} launched (${typeKey}, v ${vx.toFixed(1)}/${vy.toFixed(1)}), shots left: ${this.shotsLeft}, ${typeKey} ammo left: ${this.birdInventory.count(typeKey)}`);
    if (this.tutorialHint && !this.save.data.tutorialDone) {
      this.save.setTutorialDone(true);
      this.tutorialHint.destroy();
      this.tutorialHint = null;
    }
    this.refreshHUD();
    return true;
  }

  /**
   * Fix #19 — one funnel for every ability trigger (screen tap, SPACE key,
   * on-screen TAP button). Activation is only legal for the active
   * projectile in a valid flight state: never before launch, never after
   * the shot resolves, never while paused or during feedback. The factory's
   * abilityUsed/consumed guards make double activation impossible.
   */
  tryActivateAbilities() {
    if (!this.currentShot) return;
    if (this.stateMachine.isPaused()) return;
    if (!this.stateMachine.is(STATES.PROJECTILE_FLYING)) return;
    for (const p of this.factory.projectilesOfShot(this.currentShot.id)) {
      if (this.factory.tryActivateAbility(p)) break;
    }
  }

  /**
   * Fix #19 — card/keyboard selection. Selecting is FREE (no ammunition is
   * consumed) but only legal for a bird with remaining ammunition, and
   * never while a shot is in flight or resolving (the next valid loading
   * opportunity is the re-arm).
   */
  selectProjectile(key) {
    if (!this.levels.isProjectileAvailable(this.levelId, key)) return false;
    if (!this.birdInventory.canSelect(key)) return false;
    const s = this.stateMachine.current;
    if (s !== STATES.AIMING && s !== STATES.QUESTION_READY) return false;
    if (this.selectedProjectile === key) return true;
    this.selectedProjectile = key;
    this.audio?.emit('bird-selected', { key }); // Fix #22 — card/keyboard selection pop
    if (this.stateMachine.is(STATES.AIMING)) this.slingshot.load(key);
    this.refreshHUD();
    return true;
  }

  selectProjectileByIndex(i) {
    // Fix #19 — hotkeys 1..5 follow the VISIBLE card order (the canonical
    // selector order), not the level roster's compacted ordering
    const key = SELECTOR_ORDER[i];
    if (key) this.selectProjectile(key);
  }

  /* ------------------------------------------------------------------ */
  /* Collisions + answers                                                */
  /* ------------------------------------------------------------------ */

  onCollisionStart(event) {
    if (this.stateMachine.isPaused()) return;
    for (const pair of event.pairs) {
      const a = pair.bodyA;
      const b = pair.bodyB;
      this.factory.handleImpact(a, b);
      this.routeProjectileImpact(a, b);
      this.routeProjectileImpact(b, a);
    }
  }

  routeProjectileImpact(projBody, otherBody) {
    const go = projBody.gameObject;
    if (!go || !go.wb || go.wb.kind !== 'projectile' || go.wb.consumed) return;
    if (!this.currentShot || go.wb.shotId !== this.currentShot.id) return;
    // At most ONE answer selection per launch (spec §8). Split children share
    // the shot identity and this same guard.
    // NOTE: a shot that merely RESOLVED (miss → re-armed) must NOT be excluded
    // here: its projectile can still physically reach an answer target a
    // moment later (creeping ball, debris or a moving obstacle shoving the
    // resting ball). Discarding that touch is exactly how the reported
    // "hit the correct answer → game stuck" bug felt to players. Such late
    // contacts stay routable — canAcceptAnswer() + the state machine now
    // carry them safely into ANSWER_FEEDBACK instead of freezing.
    if (this.currentShot.answered) return;

    this.factory.onProjectileFirstImpact(go, otherBody);

    const targetGo = otherBody.gameObject;
    if (targetGo && targetGo.wb && targetGo.wb.kind === 'target'
      && targetGo.wb.questionIndex === this.questionIndex
      && !targetGo.wb.hit && !this.answerLock
      && this.canAcceptAnswer()) {
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — COLLISION answer target ${targetGo.wb.choiceId}`);
      this.tryAnswer(go, targetGo);
    }
  }

  /**
   * Answers are only routable from the live-shot states. AIMING is included:
   * a projectile of the CURRENT shot may still touch a target after the shot
   * resolved and the slingshot re-armed (creeping ball, debris or a moving
   * obstacle shoving the resting ball). Any other state (a new question is
   * loading, level over, …) must ignore the collision entirely.
   */
  canAcceptAnswer() {
    const s = this.stateMachine.current;
    return s === STATES.PROJECTILE_FLYING || s === STATES.PHYSICS_RESOLVING || s === STATES.AIMING;
  }

  /**
   * Strict answer validation: only eligible player projectiles of the
   * current shot directly touching the target count. Debris never lands
   * here (blocks have kind 'block'), and explosions never call this.
   * The ANSWER_FEEDBACK transition is attempted FIRST and its result is
   * honored: if the state machine refuses it, nothing is consumed, so an
   * answer can never be "counted" into a state that has no watcher running
   * for it (the historical freeze).
   */
  tryAnswer(projectile, targetGo) {
    targetGo.wb.hit = true;
    const result = this.questions.checkAnswer(this.prepared, targetGo.wb.choiceId);
    if (!result.valid) return;

    if (!this.stateMachine.set(STATES.ANSWER_FEEDBACK)) {
      // Cannot present feedback from this state — reject the event without
      // consuming the question. (Unreachable in practice: routing already
      // gates on canAcceptAnswer; kept as a hard guard.)
      DebugLog.warn(`ANSWER dropped: transition ${this.stateMachine.current} -> ANSWER_FEEDBACK refused`);
      return;
    }

    this.currentShot.answered = true;

    // The wooden feedback card presents the validated answer. It appears
    // immediately (the tower may still be collapsing behind it) but its
    // action button stays disabled until the settle watcher below arms it;
    // the actual question transition happens ONLY through that button.
    const correct = this.prepared.targets.find((t) => t.choiceId === result.correctChoiceId);
    const answerLine = `Correct answer: ${correct.label} — “${correct.text}”`;
    this.feedbackArmed = false;
    this.feedbackAdvancing = false;
    this.slingshot.cancelDrag();
    this.slingshot.setEnabled(false);

    if (result.correct) {
      this.answerLock = true; // lock until the next question
      this.scoring.recordCorrect(this.prepared.attempt);
      this.flashTarget(targetGo, COLORS.TARGET_CORRECT_FLASH);
      this.audio.emit('answer-correct');
      const pts = SCORING.BASE_BY_ATTEMPT[Math.min(this.prepared.attempt, SCORING.BASE_BY_ATTEMPT.length) - 1];
      this.feedbackCard.show({
        token: this.questionIndex,
        kind: 'correct',
        answerLine,
        explanation: result.explanation,
        hint: `+${pts} points!`,
        buttonText: 'CONTINUE',
        onAction: () => this.onFeedbackAction()
      });
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — ANSWER correct (attempt ${this.prepared.attempt}, +${pts} pts)`);
      this.settleStartedAt = this.time.now;
    } else {
      this.flashTarget(targetGo, COLORS.TARGET_WRONG_FLASH);
      this.scoring.recordWrongHit();
      this.audio.emit('answer-wrong');
      this.feedbackCard.show({
        token: this.questionIndex,
        kind: 'wrong',
        answerLine,
        explanation: result.explanation,
        hint: this.shotsLeft > 0
          ? 'Nice try! Aim carefully and take another shot.'
          : 'Take a breath — you can retry this question.',
        buttonText: 'TRY AGAIN',
        onAction: () => this.onFeedbackAction()
      });
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — ANSWER wrong (penalty, shots left: ${this.shotsLeft})`);
      this.settleStartedAt = this.time.now;
    }
    this.refreshHUD();
  }

  flashTarget(targetGo, color) {
    // Hit feedback is TINT-ONLY: answer plaques must never change scale.
    // The XL parchment renders at HALF its texture size (setDisplaySize
    // 300×97 on a 600×194 canvas → native scale 0.5, while S/M/L sit at 1),
    // so any absolute setScale() — even tweening "back" to 1 — permanently
    // doubles the card AND its Matter body. A scale pop is therefore
    // structurally off-limits here; the tint flash carries the feedback.
    targetGo.setTintFill(color);
    const qToken = this.questionIndex;
    this.time.delayedCall(420, () => {
      // the target is destroyed when the question changes — never touch it then
      if (this.questionIndex !== qToken || !targetGo.active) return;
      targetGo.clearTint();
    });
  }

  /* ------------------------------------------------------------------ */
  /* Frame update                                                        */
  /* ------------------------------------------------------------------ */

  update(time, delta) {
    if (this.stateMachine.isPaused()) return;
    this.elapsedMs += delta;
    this.card?.tick(delta); // Fix #9 — question-card reading countdown (pause-gated here)
    this.updateLevelTimer(delta);
    // amortized build-time settle (was a synchronous hitch — see loadQuestion)
    if (this.factory.settling) {
      const r = this.factory.stepSettle(6);
      if (r.done) {
        if (typeof process !== 'undefined' && process.env.WB_TRACE) console.log('[trace] settle done, armPending=', this.armPending, 'state=', this.stateMachine.current);
        if (r.drift > PHYSICS.SETTLE_MAX_DRIFT || r.lost > 0) {
          DebugLog.warn(`L${this.levelId}/Q${this.questionIndex + 1} settle drift ${r.drift.toFixed(1)}px, lost ${r.lost}`);
        }
        if (this.armPending) { // arming deferred only by the settle → run it now
          this.armPending = false;
          this.armAiming();
        }
      }
    }
    this.factory.update(time, delta, this.elapsedMs);

    const s = this.stateMachine.current;
    if (s === STATES.PROJECTILE_FLYING || s === STATES.PHYSICS_RESOLVING) {
      this.updateShotResolution();
    }
    // A visible feedback card that has not armed yet must keep arming
    // regardless of the machine's current state: a resolved-miss projectile
    // can still creep into the correct target after the slingshot re-armed
    // (documented late-contact path), and the pending intro card callback or
    // a deferred arm can then move the machine out of ANSWER_FEEDBACK before
    // the settle watcher ran. State-gating the watcher alone would leave the
    // CONTINUE button permanently disabled with the card stuck on screen.
    if (this.feedbackCard?.visible && !this.feedbackArmed) {
      this.updateAnswerSettle();
      // never allow firing while an unanswered feedback card is showing
      this.slingshot?.setEnabled(false);
    } else if (s === STATES.ANSWER_FEEDBACK) {
      this.updateAnswerSettle();
    }
  }

  /**
   * Fix #17 — the level countdown. It only advances while the player is
   * actually playing: the paused early-return above already freezes it for
   * the pause menu, portrait rotation and hidden tabs (auto-pause), and the
   * state filter below additionally freezes it during mandatory answer
   * feedback, question loading and the terminal level states. Delta
   * accumulation inside this guarded frame hook is the same accounting the
   * scene already uses for its movers — no wall-clock reads, no setTimeout.
   */
  updateLevelTimer(delta) {
    if (!this.levelTimer) return;
    const s = this.stateMachine.current;
    // Fix #9 — the mandatory question introduction is presentation time,
    // not playing time: the countdown must not advance while the card is
    // entering / being read / moving to its resting spot.
    // Fix #21 — the enlarged reading view is rereading time, not playing
    // time either: the countdown freezes while the card is expanded and
    // resumes by itself on close (it only ever ran via this frame gate,
    // so nothing else has to be restored).
    const card = this.card;
    const hold = card ? (card.introActive || card.expanded) : false;
    if (!hold && (s === STATES.QUESTION_READY || s === STATES.AIMING
      || s === STATES.PROJECTILE_FLYING || s === STATES.PHYSICS_RESOLVING)) {
      this.levelTimer.tick(delta);
      if (this.levelTimer.expired) this.timeUp();
    }
    this.hud?.setTimer(this.levelTimer.remainingMs);
  }

  /** Countdown reached zero → the existing level-failure flow. */
  timeUp() {
    if (this.leavingLevel) return;
    // Extremely transient states (e.g. NEXT_QUESTION) cannot legally fail
    // yet — the next frame retries as soon as the machine can transition.
    if (!this.stateMachine.can(STATES.LEVEL_FAILED)) return;
    this.levelFailed('time-up');
  }

  updateShotResolution() {
    if (!this.currentShot || this.currentShot.resolvedHandled) return;
    const shot = this.currentShot;
    const live = this.factory.projectilesOfShot(shot.id);

    // first impact → PHYSICS_RESOLVING (state distinction per spec)
    if (this.stateMachine.is(STATES.PROJECTILE_FLYING) && live.every((p) => p.wb.firstImpactDone || p.wb.consumed)) {
      if (live.some((p) => p.wb.firstImpactDone)) {
        this.stateMachine.set(STATES.PHYSICS_RESOLVING);
        DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — PHYSICS resolution start (shot #${shot.id})`);
      }
    }

    const now = this.time.now;
    const timedOut = now - shot.startedAt > PHYSICS.SHOT_TIMEOUT_MS;
    if (timedOut) {
      for (const p of live) this.factory.remove(p);
    }

    // A shot is only over once EVERYTHING dynamic has stayed quiet for a
    // stable interval — projectiles AND blocks. A single slow frame is not
    // enough: a ball can dip below the threshold at a bounce apex and still
    // roll into a target, and falling rubble can push a resting ball.
    const quiet = live.every((p) => p.wb.consumed || p.body.isSleeping || this.speedOf(p) < PHYSICS.PROJECTILE_REST_SPEED)
      && this.factory.blocksQuiet();
    this.slowFrames = quiet ? this.slowFrames + 1 : 0;

    const minFlight = now - shot.startedAt > 350;
    if ((this.slowFrames >= PHYSICS.RESOLVE_STABLE_FRAMES && minFlight) || timedOut) {
      shot.resolvedHandled = true;
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — PHYSICS resolution completed (${timedOut ? 'shot timeout' : `${this.slowFrames} stable frames`})`);
      this.resolveShotOutcome();
    }
  }

  resolveShotOutcome() {
    // No answer event → missed. Wrong answers are handled by the settle
    // watcher below (feedback already shown).
    if (this.currentShot.answered) return;
    this.audio.emit('shot-missed'); // Fix #22 — soft whiff (audio only)

    // Lifecycle (Fix #6B): the miss is decided — play the shot's landing
    // animation and remove its visuals (bodies are swept at the next
    // launch; see launchProjectile).
    this.factory.despawnShotVisuals(this.currentShot.id);

    // controlled recovery: rubble covering the correct target is cleared
    this.recoverBlockedTarget();

    if (this.shotsLeft > 0) {
      if (this.stateMachine.is(STATES.PROJECTILE_FLYING)) {
        this.stateMachine.set(STATES.PHYSICS_RESOLVING);
      }
      this.stateMachine.set(STATES.AIMING);
      this.armAfterShot();
    } else {
      if (this.stateMachine.is(STATES.PROJECTILE_FLYING)) {
        this.stateMachine.set(STATES.PHYSICS_RESOLVING);
      }
      this.failQuestionAttempt('No shots left');
    }
  }

  armAfterShot() {
    // Fix #19 — re-arm is the "next valid loading opportunity": the just-
    // launched bird may have hit zero ammunition, so reconcile the
    // selection (auto-select the next available bird) before loading.
    if (!this.ensureBirdReady()) return;
    this.slingshot.load(this.selectedProjectile);
    this.slingshot.setEnabled(true);
    this.refreshHUD();
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — READY slingshot re-armed (AIMING, shots left: ${this.shotsLeft}, bird: ${this.selectedProjectile} ×${this.birdInventory.count(this.selectedProjectile)})`);
  }

  /**
   * Feedback pacing: the wooden card is already on screen while the tower
   * finishes collapsing; once the world has genuinely settled for a short
   * run of frames (or the hard cap ends the wait), the card's action
   * button is ARMED — the question transition itself happens only when the
   * player clicks it (onFeedbackAction). Physics can therefore never be
   * interrupted mid-collapse, and the player is never skipped past the
   * educational text.
   */
  updateAnswerSettle() {
    const elapsed = this.time.now - this.settleStartedAt;
    const settled = this.factory.isSettled();
    this.settleFrames = settled ? this.settleFrames + 1 : 0;
    const minVisible = elapsed >= FEEDBACK.MIN_VISIBLE_MS;
    const capped = elapsed >= FEEDBACK.MAX_RESOLVE_MS;
    if ((this.settleFrames >= 12 && minVisible) || capped) {
      this.settleFrames = 0;
      if (!this.feedbackArmed) {
        this.feedbackArmed = true;
        DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — PHYSICS feedback settle completed (${capped ? 'cap reached' : 'settled'}) — CONTINUE armed`);
        this.feedbackCard?.setActionEnabled(true);
      }
    }
  }

  /**
   * ONE valid exit from the feedback card (its button click, after the exit
   * animation finished). Double-clicks and stale tokens are already
   * swallowed by the card; this guard makes the scene-side transition
   * one-shot as well, so the question can never advance twice.
   */
  onFeedbackAction() {
    if (this.feedbackAdvancing) return;
    this.feedbackAdvancing = true;
    this.audio?.emit('ui-click');
    this.advanceAfterFeedback();
  }

  advanceAfterFeedback() {
    const wasCorrect = this.answerLock;
    // the card has already played its exit animation (onFeedbackAction);
    // a stale visible card (restart during feedback) is cancelled by
    // loadQuestion, never here.
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — FEEDBACK completed (${wasCorrect ? 'correct' : 'wrong'})`);
    if (wasCorrect) {
      this.stateMachine.set(STATES.NEXT_QUESTION);
      if (this.questionIndex + 1 >= 4) {
        this.levelComplete();
      } else {
        // Fix #9 — let the completed question's card play its brief exit
        // animation BEFORE the next question loads its own centered card
        // (never two cards, never an instant swap).
        this.queueNextQuestion();
      }
    } else {
      // wrong answer resolved: same reliable cleanup as a miss before the
      // slingshot may arm again (Fix #6B). The question card stays put —
      // no introduction replay for retries.
      this.factory.despawnShotVisuals(this.currentShot.id);
      if (this.shotsLeft > 0) {
        this.stateMachine.set(STATES.AIMING);
        this.armAfterShot();
      } else {
        this.failQuestionAttempt('No shots left');
      }
    }
  }

  /**
   * Fix #9 — one queued hand-off from a completed question to its
   * successor. loadQuestion() invalidates it (a restart/retry must never
   * double-advance), a pause defers it to resume, and the question token
   * guards against stale firings.
   */
  queueNextQuestion() {
    this.card?.dismiss();
    this.cardExitPending = { token: this.questionIndex };
    this.time.delayedCall(QUESTION_CARD.TIMINGS.exitMs + 40, () => this.runQueuedNextQuestion());
  }

  runQueuedNextQuestion() {
    const pending = this.cardExitPending;
    if (!pending) return;
    if (this.questionIndex !== pending.token) {
      // the question changed under us (restart / retry) — do nothing
      this.cardExitPending = null;
      return;
    }
    if (this.stateMachine.isPaused()) return; // retried on resume
    this.cardExitPending = null;
    this.loadQuestion(this.questionIndex + 1);
  }

  /**
   * Controlled recovery: if the correct target got buried by rubble so it
   * can no longer be hit cleanly, remove the covering blocks instead of
   * leaving the player stuck.
   */
  recoverBlockedTarget() {
    const correctChoice = this.prepared.question.correctAnswerId;
    const target = this.factory.targets.find((t) => t.wb.choiceId === correctChoice);
    if (!target) return;
    // live display size — parchment panels vary in width (S/M/L variants)
    const halfW = target.displayWidth / 2 + 6;
    const halfH = target.displayHeight / 2 + 6;
    for (const block of [...this.factory.blocks]) {
      if (block.wb.removed) continue;
      if (Math.abs(block.x - target.x) < halfW && Math.abs(block.y - target.y) < halfH) {
        block.wb.removed = true;
        this.factory.remove(block);
      }
    }
  }

  speedOf(go) {
    const v = go.body.velocity;
    return Math.hypot(v.x, v.y);
  }

  /* ------------------------------------------------------------------ */
  /* Level end states                                                    */
  /* ------------------------------------------------------------------ */

  levelComplete() {
    // Lifecycle (Fix #6B): the final question's transition is to this
    // overlay, not to loadQuestion — sweep the last shot here so no bird
    // lingers under the victory panel (question changes sweep already).
    this.factory.sweepProjectiles();
    this.cardExitPending = null;
    this.card?.dismiss(); // Fix #9 — the last card exits; no new one follows
    const score = this.scoring.computeScore();
    const stars = this.scoring.computeStars(this.level.starThresholds);
    this.save.recordLevelResult(this.levelId, score, stars);
    this.stateMachine.set(STATES.LEVEL_COMPLETE);

    // drawn stars pop in one by one (the audio chimes stagger the same way)
    const reducedWin = !!(this.save && this.save.data.settings && this.save.data.settings.reducedMotion);
    this.winStarIcons.forEach((pair, i) => {
      const lit = i < stars;
      pair.full.setVisible(lit);
      pair.empty.setVisible(!lit);
      pair.full.setScale(1);
      if (lit && !reducedWin) {
        pair.full.setScale(0.1);
        this.tweens.add({
          targets: pair.full, scale: 1, duration: 300,
          delay: 300 + i * 180, ease: 'Back.easeOut'
        });
      }
    });
    this.winScore.setText(`Score: ${score}`);
    const nextBtn = this.winOverlay.list.find((t) => t.labelText && t.labelText.text === 'NEXT LEVEL ▶');
    if (nextBtn) nextBtn.setVisible(this.levelId < 15);
    if (this.levelId === 15 && this.save.allCompleted) {
      this.stateMachine.set(STATES.GAME_COMPLETE);
      this.winTitle.setText('🏆 ALL 15 LEVELS COMPLETE!');
    }
    this.fitWinTitle();
    this.winOverlay.setVisible(true);
    // Fix #22 — audio hook: stars drive the staggered chimes inside
    // AudioManager; the all-levels finish gets its victory sting.
    this.audio.emit('level-complete', {
      stars,
      allCompleted: this.stateMachine.is(STATES.GAME_COMPLETE)
    });
    this.refreshHUD();
  }

  /**
   * Fix #17 — a question attempt failed because its available shots ran
   * out. Charges exactly ONE heart for the whole attempt (never per
   * individual missed or wrong shot, never twice for the same failure —
   * HeartsSystem.charge guards it and loadQuestion clears the guard).
   * With hearts left the failed question may be retried; at zero the
   * existing level-failed state becomes terminal for the level.
   */
  failQuestionAttempt(reason) {
    const consumed = this.hearts.charge();
    if (consumed) {
      this.hud?.onHeartLost(this.hearts.lastLostIndex());
      this.audio.emit('heart-lost');
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — heart lost (${this.hearts.remaining} left)`);
    }
    this.levelFailed(this.hearts.empty ? 'out-of-hearts' : 'out-of-shots', reason);
  }

  /** reason: 'out-of-shots' | 'out-of-hearts' | 'time-up' (HUD variants). */
  levelFailed(reason, detail = '') {
    this.stateMachine.set(STATES.LEVEL_FAILED);
    this.refreshFailOverlay(reason);
    this.failOverlay.setVisible(true);
    this.audio.emit('level-failed');
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — LEVEL_FAILED (${detail || reason})`);
    this.refreshHUD();
  }

  /** Keep the victory title inside the parchment window (long variants). */
  fitWinTitle() {
    let size = 40;
    this.winTitle.setFontSize(size);
    while (this.winTitle.width > 436 && size > 22) {
      size -= 2;
      this.winTitle.setFontSize(size);
    }
  }

  /** Wood-style fail card content per failure kind (Fix #17). */
  refreshFailOverlay(reason) {    if (reason === 'time-up') {
      this.failTitle.setText("TIME'S UP!");
      this.failBody.setText('The clock ran out on this level.\nBlast faster next time!');
      this.failRetryBtn.setVisible(false);
    } else if (reason === 'out-of-hearts') {
      this.failTitle.setText('OUT OF HEARTS!');
      this.failBody.setText('All hearts are gone — the level is over.\nRestart the level for a fresh set of hearts.');
      this.failRetryBtn.setVisible(false);
    } else {
      const n = this.hearts ? this.hearts.remaining : 0;
      this.failTitle.setText('OUT OF SHOTS!');
      this.failBody.setText(`This question failed and cost you one heart.\n${n} ${n === 1 ? 'heart' : 'hearts'} left — take a breath and try again!`);
      this.failRetryBtn.setVisible(true);
    }
  }

  retryQuestion() {
    this.failOverlay.setVisible(false);
    // LEVEL_FAILED → QUESTION_READY is performed by loadQuestion itself
    this.loadQuestion(this.questionIndex);
  }

  goNextLevel() {
    if (this.levelId >= 15) {
      this.exitToMenu();
      return;
    }
    // Fix #7 — level transition starts fresh: destroy the reference line
    // and reset its data (scene shutdown rebuilds the whole slingshot).
    this.slingshot?.clearShotReference();
    this.scene.restart({ levelId: this.levelId + 1 });
  }

  /** Pause-menu "Restart Question": reload the CURRENT question cleanly. */
  restartQuestionFromMenu() {
    if (this.leavingLevel) return;
    this.hud?.closePause();
    if (this.stateMachine.isPaused()) {
      this.matter.world.resume();
      this.stateMachine.resume();
    }
    this.armPending = false; // the reload schedules its own arming delay
    // Every live state may route through LEVEL_FAILED back to
    // QUESTION_READY; where that transition is not legal (transient
    // NEXT_QUESTION) loadQuestion's own QUESTION_READY transition is.
    if (this.stateMachine.can(STATES.LEVEL_FAILED)) {
      this.stateMachine.set(STATES.LEVEL_FAILED);
    }
    this.failOverlay.setVisible(false);
    this.loadQuestion(this.questionIndex);
  }

  restartLevel() {
    if (this.leavingLevel) return;
    this.leavingLevel = true; // one-shot: repeated clicks must not double-restart
    this.hud?.closePause();
    if (this.stateMachine.isPaused()) {
      this.matter.world.resume();
    }
    // Fix #7 — a full restart starts fresh, like a level transition.
    this.slingshot?.clearShotReference();
    this.scene.restart({ levelId: this.levelId });
  }

  /** Pause-menu exit — goes to the level select screen (Fix #17). */
  exitToLevelSelect() {
    if (this.leavingLevel) return;
    this.leavingLevel = true;
    this.slingshot?.clearShotReference(); // Fix #7 — no dots outside gameplay
    this.scene.start('LevelSelectScene');
  }

  exitToMenu() {
    this.slingshot?.clearShotReference(); // Fix #7 — no dots outside gameplay
    this.scene.start('MenuScene');
  }

  /** Sound on/off — persisted setting + engine-wide master gate (Fix #17/#22). */
  toggleSound() {
    const next = !this.save.data.settings.sound;
    if (this.audio && typeof this.audio.setMasterEnabled === 'function') {
      this.audio.setMasterEnabled(next);
    } else if (this.audio) {
      this.audio.enabled = next;
    }
    this.save.setSetting('sound', next);
    this.audio?.emit('ui-click');
    this.refreshHUD();
  }

  /** Fix #22 — pause-menu music toggle (music + ambience channels). */
  toggleMusic() {
    const next = this.save.data.settings.music !== false;
    this.audio?.setMusicEnabled(!next);
    this.audio?.emit('ui-click');
    this.refreshHUD();
  }

  /** Fix #22 — pause-menu effects toggle (impact/ability/bird channels). */
  toggleSfx() {
    const next = this.save.data.settings.sfx !== false;
    this.audio?.setSfxEnabled(!next);
    this.audio?.emit('ui-click');
    this.refreshHUD();
  }

  /** Reduced-motion toggle (was on the old pause overlay; now the menu). */
  toggleReducedMotion() {
    const next = !this.save.data.settings.reducedMotion;
    this.save.setSetting('reducedMotion', next);
    this.refreshHUD();
  }

  /* ------------------------------------------------------------------ */
  /* Orientation (phones are landscape-only)                             */
  /* ------------------------------------------------------------------ */

  setupOrientation() {
    this.rotationPaused = false;
    this.pausedForRotation = false;
    this.onOrientationChange = () => {
      // The background art, ground collider and slingshot anchor are
      // device-independent — only the rotate-device overlay state and the
      // live device snapshot need refreshing on a viewport change.
      this.device = { ...deviceInfo() };
      this.updateOrientationState();
    };
    // Fix #2: full-bleed responsive framing. ONE scale-manager listener
    // (attachViewport) re-frames the camera so the whole 1280×720 world is
    // always visible, extends the scenery beyond it on wide/tall viewports,
    // and re-checks the orientation state. Cleaned up on scene shutdown.
    this.viewport = attachViewport(this, (view) => {
      this.background?.extendTo(view);
      this.onOrientationChange();
    });
    if (window.matchMedia) {
      this.portraitQuery = window.matchMedia('(orientation: portrait)');
      this.portraitQuery.addEventListener?.('change', this.onOrientationChange);
    }
    this.events.once('shutdown', () => {
      this.viewport.detach();
      this.portraitQuery?.removeEventListener?.('change', this.onOrientationChange);
    });
    this.updateOrientationState();
  }

  /**
   * Portrait phone: freeze physics + timers, block input, keep all progress.
   * Landscape: hide the overlay and resume exactly where the player was.
   * Never restarts the level.
   */
  updateOrientationState() {
    if (requiresLandscape()) {
      if (this.rotationPaused) return;
      this.rotationPaused = true;
      this.rotateOverlay.setVisible(true);
      this.slingshot?.cancelDrag();
      this.slingshot?.setEnabled(false);
      if (!this.stateMachine.isPaused()) {
        this.pausedForRotation = true;
        this.stateMachine.pause();   // freezes update(): movers, settle clocks
        this.matter.world.pause();   // freezes the simulation itself
      }
    } else if (this.rotationPaused) {
      this.rotationPaused = false;
      this.rotateOverlay.setVisible(false);
      if (this.pausedForRotation) {
        this.pausedForRotation = false;
        this.matter.world.resume();
        this.stateMachine.resume();
        if (this.stateMachine.is(STATES.AIMING)) this.slingshot.setEnabled(true);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pause                                                               */
  /* ------------------------------------------------------------------ */

  togglePause() {
    if (this.stateMachine.isPaused()) {
      this.hud?.closePause();
      this.matter.world.resume();
      this.stateMachine.resume();
      if (this.stateMachine.is(STATES.AIMING)) this.slingshot.setEnabled(true);
    } else {
      this.doPause();
    }
  }

  doPause() {
    const terminal = [STATES.LEVEL_COMPLETE, STATES.LEVEL_FAILED, STATES.GAME_COMPLETE];
    if (terminal.includes(this.stateMachine.current)) return;
    if (!this.stateMachine.pause()) return;
    this.matter.world.pause();
    this.slingshot.cancelDrag();
    this.slingshot.setEnabled(false);
    this.hud?.openPause();
    this.refreshHUD();
  }

  /** Automatic pause (window blur / tab hidden) — disabled for test runs. */
  autoPause() {
    if (this.disableAutoPause) return;
    this.doPause();
  }

  /* ------------------------------------------------------------------ */
  /* HUD helpers                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * The one funnel through which the authoritative gameplay state reaches
   * the HUD (Fix #17): a plain snapshot is pushed; the HUD keeps no
   * counters of its own. The projectile selector + ability hint (bottom of
   * the screen, not part of the top HUD) refresh here too.
   */
  refreshHUD() {
    if (!this.hud) return; // transitions can fire before the HUD exists
    this.hud.sync({
      levelId: this.levelId,
      levelName: this.level.name,
      questionIndex: this.questionIndex,
      questionTotal: this.level.questions.length,
      shotsLeft: this.shotsLeft,
      projectileKey: this.selectedProjectile,
      score: this.scoring.liveScore(),
      heartsRemaining: this.hearts ? this.hearts.remaining : 0,
      questionsCompleted: this.scoring.questionsCompleted,
      starThresholds: this.level.starThresholds,
      state: this.stateMachine.current,
      soundOn: this.save.data.settings.sound,
      musicOn: this.save.data.settings.music !== false,   // Fix #22
      sfxOn: this.save.data.settings.sfx !== false        // Fix #22
    });
    // Fix #19 — card row: roster + live ammunition + selection. Cards stay
    // interactive through the aiming cycle and dim behind terminal states.
    const terminal = [STATES.LEVEL_COMPLETE, STATES.LEVEL_FAILED, STATES.GAME_COMPLETE]
      .includes(this.stateMachine.current);
    this.birdSelector?.sync({
      roster: this.level.projectiles,
      ammo: this.birdInventory.snapshot(),
      selected: this.selectedProjectile,
      enabled: !terminal && !this.stateMachine.isPaused()
    });
    const type = PROJECTILE_TYPES[this.selectedProjectile];
    this.abilityHint?.setText(type && type.abilityHint ? `▸ ${type.abilityHint}` : '');
    // the TAP button is visible only while the flying bird has an ability
    const flyingAbility = this.stateMachine.is(STATES.PROJECTILE_FLYING)
      && this.currentShot && PROJECTILE_TYPES[this.currentShot.typeKey]
      && !!PROJECTILE_TYPES[this.currentShot.typeKey].ability;
    this.abilityButton?.sync({ visible: !!flyingAbility });
  }

  showToast(msg, ms = 1500) {
    this.toastText.setText(msg).setAlpha(1);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: ms, duration: 400 });
  }

  onStateChanged(next, prev) {
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — STATE ${prev} -> ${next}`);
    // Fix #22 — every pause source (menu, portrait rotation, hidden tab)
    // funnels through this one choke point: audio pauses with the game and
    // resumes with it (movement audio is stopped on pause; a stationary
    // pouch stays silent after resume).
    if (next === STATES.PAUSED) {
      this.audio?.emit('game-pause');
    } else if (prev === STATES.PAUSED) {
      this.audio?.emit('game-resume');
    }
    // Fix #9 — every pause source (menu, portrait rotation, hidden tab)
    // funnels through here: freeze the card's visual timeline on entry and
    // thaw it on resume (the reading countdown is already update()-gated).
    if (next === STATES.PAUSED) {
      this.card?.pause();
      this.feedbackCard?.pause();
    }
    if (prev === STATES.PAUSED && next !== STATES.PAUSED) {
      this.card?.resume();
      this.feedbackCard?.resume();
      // A deferred arming (delayed call fired while paused) lands here on resume.
      if (this.armPending) {
        this.armPending = false;
        this.armAiming();
      }
      // A deferred NEXT_QUESTION hand-off (card exit ran into a pause).
      if (this.cardExitPending) this.runQueuedNextQuestion();
    }
    this.refreshHUD();
    for (const h of this.stateChangeHandlers) {
      try { h(next, prev); } catch (e) { /* isolated */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Debug/test API (used by js/dev/DebugAPI.js and browser tests)        */
  /* ------------------------------------------------------------------ */

  waitForState(target, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      if (this.stateMachine.current === target) return resolve(true);
      const timer = this.time.delayedCall(timeoutMs, () => {
        const i = this.stateChangeHandlers.indexOf(h);
        if (i !== -1) this.stateChangeHandlers.splice(i, 1);
        reject(new Error(`waitForState(${target}) timed out in ${this.stateMachine.current}`));
      });
      const h = (next) => {
        if (next === target) {
          timer.remove();
          const i = this.stateChangeHandlers.indexOf(h);
          if (i !== -1) this.stateChangeHandlers.splice(i, 1);
          resolve(true);
        }
      };
      this.stateChangeHandlers.push(h);
    });
  }

  debugInfo() {
    return {
      levelId: this.levelId,
      questionIndex: this.questionIndex,
      state: this.stateMachine.current,
      cardPhase: this.card ? this.card.phase : null, // Fix #9 (tests/verification)
      feedback: this.feedbackCard ? this.feedbackCard.info() : null,
      shotsLeft: this.shotsLeft,
      score: this.scoring.liveScore(),
      shotsUsed: this.scoring.shotsUsed,
      correctAttempts: [...this.scoring.correctAttempts],
      wrongHits: this.scoring.wrongHits,
      hearts: this.hearts ? this.hearts.remaining : null,
      timeLeftMs: this.levelTimer ? this.levelTimer.remainingMs : null,
      selectedProjectile: this.selectedProjectile,
      availableProjectiles: this.level.projectiles,
      birdAmmo: this.birdInventory ? this.birdInventory.snapshot() : {},
      targets: this.factory.targets.map((t) => ({
        choiceId: t.wb.choiceId, x: t.x, y: t.y,
        correct: t.wb.choiceId === this.prepared?.question.correctAnswerId
      })),
      projectiles: this.factory.projectiles.map((p) => ({ type: p.wb.typeKey, x: p.x, y: p.y })),
      blocks: this.factory.blocks.length
    };
  }

  /** Programmatic launch for automated tests — same path as the slingshot. */
  debugLaunch(vx, vy, typeKey) {
    this.slingshot.firePreview();
    this.slingshot.setEnabled(false);
    const type = typeKey || this.selectedProjectile;
    const a = this.slingshot.anchor;
    const ok = this.launchProjectile(vx, vy, type);
    if (ok) {
      // Fix #7 — capture the same release-time reference a pointer release
      // would, so automated runs observe the kept-dots behavior.
      this.slingshot.captureShotReference(this.slingshot.computeDots(a, vx, vy, type));
    }
    return ok;
  }

  /** Compute and fire a shot at a target (used by integration tests). */
  debugAutoAim(choiceId = null) {
    const wanted = choiceId || this.prepared.question.correctAnswerId;
    const target = this.factory.targets.find((t) => t.wb.choiceId === wanted);
    if (!target) return null;
    const a = this.slingshot.anchor;
    // Sweep launch angles (solveLaunch optimizes power at ONE angle; a
    // single fixed angle cannot reach every plaque height) and prefer a
    // solution whose arc does not clip another plaque or a tower piece in
    // front of the target — otherwise the shot legally answers a DIFFERENT
    // (wrong) plaque on the way.
    const blockers = [];
    for (const t of this.factory.targets) {
      if (t !== target && !t.wb.hit) blockers.push({ x: t.x, y: t.y, w: t.displayWidth, h: t.displayHeight });
    }
    for (const b of this.factory.blocks) {
      if (!b.wb.removed) blockers.push({ x: b.x, y: b.y, w: b.displayWidth, h: b.displayHeight });
    }
    const clearArc = (vx, vy) => {
      const pts = predictPath(a.x, a.y, vx, vy, { steps: 160 });
      for (const p of pts) {
        if (p.x > target.x - 10) break;
        for (const bl of blockers) {
          if (p.x > bl.x - bl.w / 2 - 14 && p.x < bl.x + bl.w / 2 + 14
            && p.y > bl.y - bl.h / 2 - 14 && p.y < bl.y + bl.h / 2 + 14) return false;
        }
      }
      return true;
    };
    let best = null;
    let bestClear = null;
    for (const angleDeg of [-12, -18, -24, -30, -36, -42, -48, -54]) {
      // steps: steep lobs to distant towers take >60 steps; the default
      // path would truncate short of the target
      const sol = solveLaunch(a.x, a.y, target.x, target.y, { angleDeg, steps: 160 });
      if (!sol) continue;
      if (!best || sol.missDistance < best.missDistance) best = sol;
      if (sol.missDistance < 30 && clearArc(sol.vx, sol.vy)) {
        if (!bestClear || sol.missDistance < bestClear.missDistance) bestClear = sol;
      }
      if (bestClear && bestClear.missDistance < 4) break;
    }
    const chosen = bestClear || best;
    if (!chosen) return null;
    this.debugLaunch(chosen.vx, chosen.vy, this.selectedProjectile);
    return chosen;
  }
}
