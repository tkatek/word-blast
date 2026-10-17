/**
 * GameScene — orchestrates one level: question flow, slingshot launches,
 * collision routing, answer validation, scoring, failure/retry, pause and
 * victory. All heavy lifting is delegated to the systems; this scene is the
 * coordination layer only.
 */
import Phaser from 'phaser';
import {
  STATES, WORLD, COLORS, PHYSICS, SLINGSHOT, PROJECTILE_TYPES, TARGETS, SCORING, FEEDBACK, HUD,
  slingshotAnchor
} from '../config.js';
import { GameStateMachine } from '../systems/GameStateMachine.js';
import { ObjectFactory } from '../systems/PhysicsObjects.js';
import { Slingshot } from '../systems/Slingshot.js';
import { ScoringSystem } from '../systems/ScoringSystem.js';
import { solveLaunch, predictPath } from '../systems/Trajectory.js';
import { BackgroundManager } from '../systems/BackgroundManager.js';
import { EffectsSystem } from '../systems/EffectsSystem.js';
import { deviceInfo, requiresLandscape, DEVICE_TYPES } from '../systems/Device.js';
import { attachViewport } from '../systems/Viewport.js';
import { DebugLog } from '../systems/DebugLog.js';
import { GameHUD, woodPanel, woodButton, chunkyText } from '../systems/GameHUD.js';
import { LevelTimer } from '../systems/LevelTimer.js';
import { HeartsSystem } from '../systems/HeartsSystem.js';

const DEPTH = { HUD: 50, PANEL: 80, OVERLAY: 100 };

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene');
    this.stateChangeHandlers = []; // must exist before the state machine first fires
    this.disableAutoPause = false; // set via debug API for automated runs; survives restarts
  }

  init(data) {
    this.levelId = Math.max(1, Math.min(15, data.levelId || 1));
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
    this.leavingLevel = false;    // one-shot guard for restart / exit clicks
    this.uiPointerConsumed = false; // a UI button ate this pointerdown
    this.questionText = this.choicesText = null;
    this.projectileButtons = [];
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
    this.input.keyboard.on('keydown-R', () => this.restartLevel());
    this.input.keyboard.on('keydown-M', () => this.exitToMenu());
    for (let i = 1; i <= 5; i++) {
      this.input.keyboard.on(`keydown-${i}`, () => this.selectProjectileByIndex(i - 1));
    }
    this.input.on('pointerdown', () => {
      // UI buttons flag their own pointerdown (Phaser emits GameObject
      // events before scene-level ones), so a tap on the pause button or a
      // menu entry can never accidentally trigger the loaded bird's ability.
      const uiTap = this.uiPointerConsumed;
      this.uiPointerConsumed = false;
      if (uiTap) return;
      if (this.stateMachine.is(STATES.PROJECTILE_FLYING)) this.tryActivateAbilities();
    });

    this.setupLifecycle();
    this.setupOrientation();
    this.input.once('pointerdown', () => this.tryEnterLandscapeFullscreen());

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
      onToggleSound: () => this.toggleSound(),
      onToggleReducedMotion: () => this.toggleReducedMotion()
    }, {
      markUi: () => { this.uiPointerConsumed = true; },
      save: this.save
    });
    this.hud.setTimer(HUD.TIME_LIMIT_MS);

    // question panel — deliberately separate from the HUD (the question
    // card gets its own redesign later; the HUD reserves the band above it)
    this.questionPanel = this.add.container(0, 0).setDepth(DEPTH.PANEL);
    this.questionText = this.add.text(24, 84, '', {
      fontFamily: 'Arial', fontSize: '17px', color: '#1d3557', backgroundColor: '#ffffffcc',
      padding: { x: 12, y: 8 }, wordWrap: { width: 620 }
    });
    this.choicesText = this.add.text(24, 0, '', {
      fontFamily: 'Arial', fontSize: '14px', color: '#1d3557', backgroundColor: '#ffffffaa',
      padding: { x: 12, y: 6 }
    });
    this.questionPanel.add([this.questionText, this.choicesText]);

    // projectile selector
    this.projectileButtons = [];
    this.level.projectiles.forEach((key, i) => {
      const type = PROJECTILE_TYPES[key];
      const btn = this.add.text(24, WORLD.HEIGHT - 34, `${i + 1} ${type.name}`, {
        fontFamily: 'Arial', fontSize: '15px', color: '#ffffff', backgroundColor: '#457b9d',
        padding: { x: 10, y: 5 }
      }).setDepth(DEPTH.HUD).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => {
        this.uiPointerConsumed = true;
        this.selectProjectile(key);
      });
      this.projectileButtons.push({ key, btn });
      this.time.delayedCall(0, () => btn.x = 24 + this.projectileButtons.reduce((acc, b) => acc + (b.btn === btn ? 0 : b.btn.width + 10), 0));
    });

    this.abilityHint = this.add.text(24, WORLD.HEIGHT - 66, '', {
      fontFamily: 'Arial', fontSize: '13px', color: '#ffee99'
    }).setDepth(DEPTH.HUD);

    this.refreshHUD();
  }

  buildOverlays() {
    // feedback panel (correct / wrong / miss)
    this.feedback = this.add.container(WORLD.WIDTH / 2, 240).setDepth(DEPTH.OVERLAY).setVisible(false);
    this.feedbackBg = this.add.rectangle(0, 0, 560, 190, 0x14213d, 0.95);
    this.feedbackTitle = this.add.text(0, -60, '', { fontFamily: 'Arial', fontSize: '26px', fontStyle: 'bold', color: '#ffd60a' }).setOrigin(0.5);
    this.feedbackBody = this.add.text(0, 0, '', {
      fontFamily: 'Arial', fontSize: '16px', color: '#ffffff', align: 'center', wordWrap: { width: 500 }
    }).setOrigin(0.5);
    this.feedback.add([this.feedbackBg, this.feedbackTitle, this.feedbackBody]);

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

    // victory overlay
    this.winOverlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setVisible(false);
    this.winOverlay.add(this.add.rectangle(fx, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x000000, 0.65));
    this.winTitle = this.add.text(fx, 150, 'LEVEL COMPLETE!', {
      fontFamily: 'Arial', fontSize: '46px', fontStyle: 'bold', color: '#90be6d'
    }).setOrigin(0.5);
    this.winStars = this.add.text(fx, 225, '', {
      fontFamily: 'Arial', fontSize: '54px', color: '#ffd60a'
    }).setOrigin(0.5);
    this.winScore = this.add.text(fx, 290, '', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffffff'
    }).setOrigin(0.5);
    this.winOverlay.add([this.winTitle, this.winStars, this.winScore]);
    this.overlayButton(this.winOverlay, 'NEXT LEVEL ▶', 360, () => this.goNextLevel(), 'green');
    this.overlayButton(this.winOverlay, 'REPLAY', 425, () => this.restartLevel(), 'blue');
    this.overlayButton(this.winOverlay, 'MENU', 490, () => this.exitToMenu(), 'slate');

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
      x: WORLD.WIDTH / 2, y, w, h: 58, label, color, size: 21, onClick,
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
    this.events.on('shutdown', () => {
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
    this.factory.clearQuestionObjects();
    this.answerLock = false;
    this.currentShot = null;
    this.shotsLeft = this.level.shotsPerQuestion;
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
    layout.targets.forEach((t, i) => {
      const meta = this.prepared.targets[i];
      this.factory.createTarget(t, { choiceId: meta.choiceId, label: meta.label, text: meta.text, questionIndex: index });
    });

    // Build-time settle: silent fixed steps with damage suppressed, then
    // everything sleeps. Towers are therefore at rest before the first
    // possible input; drift beyond SETTLE_MAX_DRIFT means the layout was
    // unstable (the generator battery guarantees this never ships).
    const settle = this.factory.settleLayout(PHYSICS.SETTLE_STEPS);
    if (settle.drift > PHYSICS.SETTLE_MAX_DRIFT || settle.lost > 0) {
      DebugLog.warn(`L${this.levelId}/Q${index + 1} settle drift ${settle.drift.toFixed(1)}px, lost ${settle.lost}`);
    }

    this.questionText.setText(`Q${index + 1}/4 [${question.cefr}] ${question.text}`);
    this.choicesText.setText(this.prepared.targets.map((t) => `${t.label}: ${t.text}`).join('    '));
    this.choicesText.y = 84 + this.questionText.height + 8;

    this.stateMachine.set(STATES.QUESTION_READY);
    this.refreshHUD();
    DebugLog.info(`L${this.levelId} / Question ${index + 1} — loaded "${question.text}"`);
    // Question token: if the player restarts / the question changes before
    // the arming delay fires, this callback is stale and must do nothing.
    const qToken = index;
    this.time.delayedCall(250, () => {
      if (this.questionIndex !== qToken) {
        DebugLog.warn(`arm callback dropped: stale question token ${qToken} (now ${this.questionIndex})`);
        return;
      }
      this.armAiming();
    });
  }

  armAiming() {
    if (this.stateMachine.isPaused()) {
      // The delayed call is consumed while paused — remember it and arm on
      // resume, otherwise the game would sit in QUESTION_READY forever.
      this.armPending = true;
      DebugLog.info('arming deferred: game paused');
      return;
    }
    if (!this.stateMachine.is(STATES.QUESTION_READY) && !this.stateMachine.is(STATES.PHYSICS_RESOLVING)
      && !this.stateMachine.is(STATES.ANSWER_FEEDBACK)) return;
    this.armPending = false;
    this.stateMachine.set(STATES.AIMING);
    this.slingshot.load(this.selectedProjectile);
    this.slingshot.setEnabled(true);
    this.refreshHUD();
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — READY Question ${this.questionIndex + 1}/4 (AIMING, shots: ${this.shotsLeft})`);
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

    // Lifecycle (Fix #6B): the previous shot's late-answer window closes
    // the moment this new shot exists (the shotId guard in
    // routeProjectileImpact), so its leftover bodies are pure litter —
    // destroy them BEFORE the new bird spawns so nothing accumulates.
    this.factory.sweepProjectiles();

    const shotId = (this.currentShot?.id || 0) + 1;
    this.currentShot = { id: shotId, launched: true, answered: false, resolvedHandled: false, startedAt: this.time.now };
    this.scoring.recordShot();
    this.shotsLeft--;
    this.slowFrames = 0;

    const o = origin || this.slingshot.anchor;
    const p = this.factory.createProjectile(typeKey, o.x, o.y, shotId);
    p.setVelocity(vx, vy);
    p.setAngularVelocity(0.08);

    this.stateMachine.set(STATES.PROJECTILE_FLYING);
    this.audio.emit('launch');
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — SHOT #${shotId} launched (${typeKey}, v ${vx.toFixed(1)}/${vy.toFixed(1)}), shots left: ${this.shotsLeft}`);
    if (this.tutorialHint && !this.save.data.tutorialDone) {
      this.save.setTutorialDone(true);
      this.tutorialHint.destroy();
      this.tutorialHint = null;
    }
    this.refreshHUD();
    return true;
  }

  tryActivateAbilities() {
    if (!this.currentShot) return;
    for (const p of this.factory.projectilesOfShot(this.currentShot.id)) {
      if (this.factory.tryActivateAbility(p)) break;
    }
  }

  selectProjectile(key) {
    if (!this.levels.isProjectileAvailable(this.levelId, key)) return;
    this.selectedProjectile = key;
    if (this.stateMachine.is(STATES.AIMING)) this.slingshot.load(key);
    this.refreshHUD();
  }

  selectProjectileByIndex(i) {
    const key = this.level.projectiles[i];
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

    if (result.correct) {
      this.answerLock = true; // lock until the next question
      this.scoring.recordCorrect(this.prepared.attempt);
      this.flashTarget(targetGo, COLORS.TARGET_CORRECT_FLASH);
      this.audio.emit('answer-correct');
      const pts = SCORING.BASE_BY_ATTEMPT[Math.min(this.prepared.attempt, SCORING.BASE_BY_ATTEMPT.length) - 1];
      this.showFeedback('✔ CORRECT  +' + pts, result.explanation, '#90be6d');
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — ANSWER correct (attempt ${this.prepared.attempt}, +${pts} pts)`);
      this.settleStartedAt = this.time.now;
    } else {
      this.flashTarget(targetGo, COLORS.TARGET_WRONG_FLASH);
      this.scoring.recordWrongHit();
      this.audio.emit('answer-wrong');
      const correct = this.prepared.targets.find((t) => t.choiceId === result.correctChoiceId);
      this.showFeedback(
        '✘ WRONG ANSWER',
        `Correct answer: ${correct.label} — “${correct.text}”\n\n${result.explanation}`,
        '#e63946'
      );
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — ANSWER wrong (penalty, shots left: ${this.shotsLeft})`);
      this.settleStartedAt = this.time.now;
    }
    this.refreshHUD();
  }

  flashTarget(targetGo, color) {
    targetGo.setTintFill(color);
    this.tweens.add({
      targets: targetGo, scaleX: 1.18, scaleY: 1.18, duration: 130, yoyo: true
    });
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
    this.updateLevelTimer(delta);
    this.factory.update(time, delta, this.elapsedMs);

    const s = this.stateMachine.current;
    if (s === STATES.PROJECTILE_FLYING || s === STATES.PHYSICS_RESOLVING) {
      this.updateShotResolution();
    }
    if (s === STATES.ANSWER_FEEDBACK) {
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
    if (s === STATES.QUESTION_READY || s === STATES.AIMING
      || s === STATES.PROJECTILE_FLYING || s === STATES.PHYSICS_RESOLVING) {
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
    this.slingshot.load(this.selectedProjectile);
    this.slingshot.setEnabled(true);
    this.refreshHUD();
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — READY slingshot re-armed (AIMING, shots left: ${this.shotsLeft})`);
  }

  /**
   * Feedback pacing (spec §9): the panel stays visible at least
   * FEEDBACK.MIN_VISIBLE_MS, then advances once the world has genuinely
   * settled for a short run of frames; a hard cap ends the presentation
   * after a validated answer without ever waiting for perfect stillness.
   */
  updateAnswerSettle() {
    const elapsed = this.time.now - this.settleStartedAt;
    const settled = this.factory.isSettled();
    this.settleFrames = settled ? this.settleFrames + 1 : 0;
    const minVisible = elapsed >= FEEDBACK.MIN_VISIBLE_MS;
    const capped = elapsed >= FEEDBACK.MAX_RESOLVE_MS;
    if ((this.settleFrames >= 12 && minVisible) || capped) {
      this.settleFrames = 0;
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — PHYSICS feedback settle completed (${capped ? 'cap reached' : 'settled'})`);
      this.advanceAfterFeedback();
    }
  }

  advanceAfterFeedback() {
    const wasCorrect = this.answerLock;
    this.hideFeedback();
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — FEEDBACK completed (${wasCorrect ? 'correct' : 'wrong'})`);
    if (wasCorrect) {
      this.stateMachine.set(STATES.NEXT_QUESTION);
      if (this.questionIndex + 1 >= 4) {
        this.levelComplete();
      } else {
        this.loadQuestion(this.questionIndex + 1);
      }
    } else {
      // wrong answer resolved: same reliable cleanup as a miss before the
      // slingshot may arm again (Fix #6B)
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
   * Controlled recovery: if the correct target got buried by rubble so it
   * can no longer be hit cleanly, remove the covering blocks instead of
   * leaving the player stuck.
   */
  recoverBlockedTarget() {
    const correctChoice = this.prepared.question.correctAnswerId;
    const target = this.factory.targets.find((t) => t.wb.choiceId === correctChoice);
    if (!target) return;
    const halfW = TARGETS.WIDTH / 2 + 6;
    const halfH = TARGETS.HEIGHT / 2 + 6;
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
    const score = this.scoring.computeScore();
    const stars = this.scoring.computeStars(this.level.starThresholds);
    this.save.recordLevelResult(this.levelId, score, stars);
    this.stateMachine.set(STATES.LEVEL_COMPLETE);

    this.winStars.setText('★'.repeat(stars) + '☆'.repeat(3 - stars));
    this.winScore.setText(`Score: ${score}`);
    const nextBtn = this.winOverlay.list.find((t) => t.labelText && t.labelText.text === 'NEXT LEVEL ▶');
    if (nextBtn) nextBtn.setVisible(this.levelId < 15);
    if (this.levelId === 15 && this.save.allCompleted) {
      this.stateMachine.set(STATES.GAME_COMPLETE);
      this.winTitle.setText('🏆 ALL 15 LEVELS COMPLETE!');
    }
    this.winOverlay.setVisible(true);
    this.audio.emit('level-complete');
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

  /** Wood-style fail card content per failure kind (Fix #17). */
  refreshFailOverlay(reason) {
    if (reason === 'time-up') {
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
    this.scene.restart({ levelId: this.levelId });
  }

  /** Pause-menu exit — goes to the level select screen (Fix #17). */
  exitToLevelSelect() {
    if (this.leavingLevel) return;
    this.leavingLevel = true;
    this.scene.start('LevelSelectScene');
  }

  exitToMenu() {
    this.scene.start('MenuScene');
  }

  /** Sound on/off — persisted setting + audio bus switch (Fix #17). */
  toggleSound() {
    const next = !this.save.data.settings.sound;
    this.save.setSetting('sound', next);
    if (this.audio) this.audio.enabled = next;
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

  /** One-time, mobile-only: try fullscreen + landscape lock on first tap. */
  tryEnterLandscapeFullscreen() {
    if (this.orientationLockTried) return;
    this.orientationLockTried = true;
    if (this.device.type !== DEVICE_TYPES.MOBILE) return;
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (typeof request !== 'function') return; // rotate overlay is the fallback
    Promise.resolve(request.call(el))
      .then(() => {
        const orientation = screen.orientation;
        if (orientation && typeof orientation.lock === 'function') {
          return orientation.lock('landscape').catch(() => {});
        }
      })
      .catch(() => { /* refused — overlay fallback handles guidance */ });
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
      soundOn: this.save.data.settings.sound
    });
    for (const { key, btn } of this.projectileButtons) {
      btn.setBackgroundColor(key === this.selectedProjectile ? '#e76f51' : '#457b9d');
    }
    const type = PROJECTILE_TYPES[this.selectedProjectile];
    this.abilityHint.setText(type.abilityHint ? `▸ ${type.abilityHint}` : '');
  }

  showFeedback(title, body, color) {
    this.feedbackTitle.setText(title).setColor(color);
    this.feedbackBody.setText(body);
    this.feedback.setVisible(true);
  }

  hideFeedback() {
    this.feedback.setVisible(false);
  }

  showToast(msg, ms = 1500) {
    this.toastText.setText(msg).setAlpha(1);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: ms, duration: 400 });
  }

  onStateChanged(next, prev) {
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — STATE ${prev} -> ${next}`);
    // A deferred arming (delayed call fired while paused) lands here on resume.
    if (prev === STATES.PAUSED && this.armPending && next !== STATES.PAUSED) {
      this.armPending = false;
      this.armAiming();
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
      shotsLeft: this.shotsLeft,
      score: this.scoring.liveScore(),
      shotsUsed: this.scoring.shotsUsed,
      correctAttempts: [...this.scoring.correctAttempts],
      wrongHits: this.scoring.wrongHits,
      hearts: this.hearts ? this.hearts.remaining : null,
      timeLeftMs: this.levelTimer ? this.levelTimer.remainingMs : null,
      selectedProjectile: this.selectedProjectile,
      availableProjectiles: this.level.projectiles,
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
    return this.launchProjectile(vx, vy, typeKey || this.selectedProjectile);
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
      if (t !== target && !t.wb.hit) blockers.push({ x: t.x, y: t.y, w: 116, h: 80 });
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
