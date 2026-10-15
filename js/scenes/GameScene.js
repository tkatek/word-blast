/**
 * GameScene — orchestrates one level: question flow, slingshot launches,
 * collision routing, answer validation, scoring, failure/retry, pause and
 * victory. All heavy lifting is delegated to the systems; this scene is the
 * coordination layer only.
 */
import Phaser from 'phaser';
import {
  STATES, WORLD, COLORS, PHYSICS, SLINGSHOT, PROJECTILE_TYPES, TARGETS, SCORING, slingshotAnchor
} from '../config.js';
import { GameStateMachine } from '../systems/GameStateMachine.js';
import { ObjectFactory } from '../systems/PhysicsObjects.js';
import { Slingshot } from '../systems/Slingshot.js';
import { ScoringSystem } from '../systems/ScoringSystem.js';
import { solveLaunch } from '../systems/Trajectory.js';
import { BackgroundManager } from '../systems/BackgroundManager.js';
import { deviceInfo, requiresLandscape, DEVICE_TYPES } from '../systems/Device.js';
import { DebugLog } from '../systems/DebugLog.js';

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
    this.hudLevel = this.hudQuestion = this.hudShots = this.hudScore = this.hudState = null;
    this.questionText = this.choicesText = null;
    this.projectileButtons = [];
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

    this.buildWorld();
    this.buildHUD();
    this.buildOverlays();

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
    this.input.on('pointerdown', (pointer) => {
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
    // distant ground strip for visual grounding
    this.add.rectangle(WORLD.WIDTH / 2, WORLD.GROUND_Y + 40, WORLD.WIDTH, 80, 0x74a892).setDepth(1);
    this.factory.createGround();
    // device background sits behind everything (depth -100)
    this.device = this.registry.get('device') || deviceInfo();
    this.background = new BackgroundManager(this);
    this.background.apply(this.device.type);
  }

  buildHUD() {
    const bg = this.add.rectangle(WORLD.WIDTH / 2, 26, WORLD.WIDTH - 20, 44, COLORS.HUD_BACKGROUND, 0.85)
      .setDepth(DEPTH.HUD);
    this.hudLevel = this.add.text(24, 12, '', { fontFamily: 'Arial', fontSize: '18px', color: COLORS.HUD_TEXT }).setDepth(DEPTH.HUD);
    this.hudQuestion = this.add.text(330, 12, '', { fontFamily: 'Arial', fontSize: '18px', color: COLORS.HUD_TEXT }).setDepth(DEPTH.HUD);
    this.hudShots = this.add.text(560, 12, '', { fontFamily: 'Arial', fontSize: '18px', color: '#ffd60a' }).setDepth(DEPTH.HUD);
    this.hudScore = this.add.text(730, 12, '', { fontFamily: 'Arial', fontSize: '18px', color: '#90be6d' }).setDepth(DEPTH.HUD);
    this.hudState = this.add.text(940, 12, '', { fontFamily: 'monospace', fontSize: '15px', color: '#a8dadc' }).setDepth(DEPTH.HUD);

    const pauseBtn = this.add.text(WORLD.WIDTH - 30, 26, '⏸', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffffff', backgroundColor: '#457b9d', padding: { x: 10, y: 4 }
    }).setOrigin(0.5).setDepth(DEPTH.HUD).setInteractive({ useHandCursor: true });
    pauseBtn.on('pointerdown', () => this.togglePause());

    const restartBtn = this.add.text(WORLD.WIDTH - 105, 26, '⟳', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffffff', backgroundColor: '#457b9d', padding: { x: 10, y: 4 }
    }).setOrigin(0.5).setDepth(DEPTH.HUD).setInteractive({ useHandCursor: true });
    restartBtn.on('pointerdown', () => this.restartLevel());

    const menuBtn = this.add.text(WORLD.WIDTH - 180, 26, '☰', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffffff', backgroundColor: '#457b9d', padding: { x: 10, y: 4 }
    }).setOrigin(0.5).setDepth(DEPTH.HUD).setInteractive({ useHandCursor: true });
    menuBtn.on('pointerdown', () => this.exitToMenu());

    // question panel
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
      btn.on('pointerdown', () => this.selectProjectile(key));
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

    // pause overlay
    this.pauseOverlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setVisible(false);
    this.pauseOverlay.add(this.add.rectangle(WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x000000, 0.6));
    this.pauseOverlay.add(this.add.text(WORLD.WIDTH / 2, 200, 'PAUSED', {
      fontFamily: 'Arial', fontSize: '56px', fontStyle: 'bold', color: '#ffd60a'
    }).setOrigin(0.5));
    this.overlayButton(this.pauseOverlay, 'RESUME', 320, () => this.togglePause());
    this.overlayButton(this.pauseOverlay, 'RESTART LEVEL', 390, () => this.restartLevel());
    this.overlayButton(this.pauseOverlay, 'EXIT TO MENU', 460, () => this.exitToMenu());

    // fail overlay
    this.failOverlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setVisible(false);
    this.failOverlay.add(this.add.rectangle(WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x000000, 0.65));
    this.failOverlay.add(this.add.text(WORLD.WIDTH / 2, 180, 'OUT OF SHOTS', {
      fontFamily: 'Arial', fontSize: '46px', fontStyle: 'bold', color: '#e63946'
    }).setOrigin(0.5));
    this.overlayButton(this.failOverlay, 'RETRY QUESTION', 300, () => this.retryQuestion());
    this.overlayButton(this.failOverlay, 'RESTART LEVEL', 370, () => this.restartLevel());
    this.overlayButton(this.failOverlay, 'MENU', 440, () => this.exitToMenu());

    // victory overlay
    this.winOverlay = this.add.container(0, 0).setDepth(DEPTH.OVERLAY).setVisible(false);
    this.winOverlay.add(this.add.rectangle(WORLD.WIDTH / 2, WORLD.HEIGHT / 2, WORLD.WIDTH, WORLD.HEIGHT, 0x000000, 0.65));
    this.winTitle = this.add.text(WORLD.WIDTH / 2, 150, 'LEVEL COMPLETE!', {
      fontFamily: 'Arial', fontSize: '46px', fontStyle: 'bold', color: '#90be6d'
    }).setOrigin(0.5);
    this.winStars = this.add.text(WORLD.WIDTH / 2, 225, '', {
      fontFamily: 'Arial', fontSize: '54px', color: '#ffd60a'
    }).setOrigin(0.5);
    this.winScore = this.add.text(WORLD.WIDTH / 2, 290, '', {
      fontFamily: 'Arial', fontSize: '24px', color: '#ffffff'
    }).setOrigin(0.5);
    this.winOverlay.add([this.winTitle, this.winStars, this.winScore]);
    this.overlayButton(this.winOverlay, 'NEXT LEVEL ▶', 360, () => this.goNextLevel());
    this.overlayButton(this.winOverlay, 'REPLAY', 425, () => this.restartLevel());
    this.overlayButton(this.winOverlay, 'MENU', 490, () => this.exitToMenu());

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

    // tutorial hint (next to the slingshot on its cliff)
    if (this.levelId === 1 && !this.save.data.tutorialDone) {
      const a = slingshotAnchor(this.device.type);
      this.tutorialHint = this.add.text(a.x + 42, a.y - 66,
        'Drag the ball back and release\nto hit the correct answer!', {
          fontFamily: 'Arial', fontSize: '16px', color: '#1d3557', backgroundColor: '#ffffffcc', padding: { x: 8, y: 6 }
        }).setDepth(DEPTH.HUD);
    }
  }

  overlayButton(container, label, y, onClick) {
    const btn = this.add.text(WORLD.WIDTH / 2, y, label, {
      fontFamily: 'Arial', fontSize: '26px', color: '#ffffff', backgroundColor: '#1d3557',
      padding: { x: 24, y: 10 }
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', onClick);
    btn.on('pointerover', () => btn.setStyle({ color: '#ffd60a' }));
    btn.on('pointerout', () => btn.setStyle({ color: '#ffffff' }));
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

    const entry = this.levels.getQuestionEntry(this.levelId, index);
    const question = this.questions.getQuestion(entry.questionId);
    this.prepared = this.questions.prepare(question);

    const layout = this.levels.getLayout(this.levelId, index);
    this.factory.buildLayout(layout);
    layout.targets.forEach((t, i) => {
      const meta = this.prepared.targets[i];
      this.factory.createTarget(t, { choiceId: meta.choiceId, label: meta.label, text: meta.text, questionIndex: index });
    });

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

  launchProjectile(vx, vy, typeKey) {
    if (!this.stateMachine.is(STATES.AIMING)) return false;
    if (this.shotsLeft <= 0) return false;
    if (!this.levels.isProjectileAvailable(this.levelId, typeKey)) return false;

    const shotId = (this.currentShot?.id || 0) + 1;
    this.currentShot = { id: shotId, launched: true, answered: false, resolvedHandled: false, startedAt: this.time.now };
    this.scoring.recordShot();
    this.shotsLeft--;
    this.slowFrames = 0;

    const p = this.factory.createProjectile(typeKey, WORLD.SLING_X, WORLD.SLING_Y, shotId);
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
    this.factory.update(time, delta, this.elapsedMs);

    const s = this.stateMachine.current;
    if (s === STATES.PROJECTILE_FLYING || s === STATES.PHYSICS_RESOLVING) {
      this.updateShotResolution();
    }
    if (s === STATES.ANSWER_FEEDBACK) {
      this.updateAnswerSettle();
    }
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
      this.levelFailed('No shots left');
    }
  }

  armAfterShot() {
    this.slingshot.load(this.selectedProjectile);
    this.slingshot.setEnabled(true);
    this.refreshHUD();
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — READY slingshot re-armed (AIMING, shots left: ${this.shotsLeft})`);
  }

  updateAnswerSettle() {
    const settled = this.factory.isSettled();
    this.settleFrames = settled ? this.settleFrames + 1 : 0;
    const timedOut = this.time.now - this.settleStartedAt > PHYSICS.SETTLE_TIMEOUT_MS;
    if (this.settleFrames >= PHYSICS.SETTLE_FRAMES || timedOut) {
      this.settleFrames = 0;
      DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — PHYSICS feedback settle completed (${timedOut ? 'settle timeout' : 'settled'})`);
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
      if (this.shotsLeft > 0) {
        this.stateMachine.set(STATES.AIMING);
        this.armAfterShot();
      } else {
        this.levelFailed('No shots left');
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
    const score = this.scoring.computeScore();
    const stars = this.scoring.computeStars(this.level.starThresholds);
    this.save.recordLevelResult(this.levelId, score, stars);
    this.stateMachine.set(STATES.LEVEL_COMPLETE);

    this.winStars.setText('★'.repeat(stars) + '☆'.repeat(3 - stars));
    this.winScore.setText(`Score: ${score}`);
    const nextBtn = this.winOverlay.list.find((t) => t.text === 'NEXT LEVEL ▶');
    if (nextBtn) nextBtn.setVisible(this.levelId < 15);
    if (this.levelId === 15 && this.save.allCompleted) {
      this.stateMachine.set(STATES.GAME_COMPLETE);
      this.winTitle.setText('🏆 ALL 15 LEVELS COMPLETE!');
    }
    this.winOverlay.setVisible(true);
    this.audio.emit('level-complete');
    this.refreshHUD();
  }

  levelFailed(reason) {
    this.stateMachine.set(STATES.LEVEL_FAILED);
    this.failOverlay.setVisible(true);
    this.audio.emit('level-failed');
    DebugLog.info(`L${this.levelId} / Question ${this.questionIndex + 1} — LEVEL_FAILED (${reason})`);
    this.refreshHUD();
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

  restartLevel() {
    if (this.pauseOverlay.visible) {
      this.matter.world.resume();
      this.pauseOverlay.setVisible(false);
    }
    this.scene.restart({ levelId: this.levelId });
  }

  exitToMenu() {
    this.scene.start('MenuScene');
  }

  /* ------------------------------------------------------------------ */
  /* Orientation (phones are landscape-only)                             */
  /* ------------------------------------------------------------------ */

  setupOrientation() {
    this.rotationPaused = false;
    this.pausedForRotation = false;
    this.onOrientationChange = () => {
      this.background?.refreshFromViewport();
      this.updateOrientationState();
    };
    this.scale.on('resize', this.onOrientationChange);
    this.scale.on('orientationchange', this.onOrientationChange);
    if (window.matchMedia) {
      this.portraitQuery = window.matchMedia('(orientation: portrait)');
      this.portraitQuery.addEventListener?.('change', this.onOrientationChange);
    }
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onOrientationChange);
      this.scale.off('orientationchange', this.onOrientationChange);
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
      this.matter.world.resume();
      this.pauseOverlay.setVisible(false);
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
    this.pauseOverlay.setVisible(true);
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

  refreshHUD() {
    if (!this.hudLevel) return; // transitions can fire before the HUD exists
    this.hudLevel.setText(`Lv ${this.levelId} ${this.level.name}`);
    this.hudQuestion.setText(`Question ${this.questionIndex + 1}/4 — ${this.prepared?.question.cefr || ''}`);
    this.hudShots.setText(`Shots: ${this.shotsLeft}`);
    this.hudScore.setText(`Score: ${this.scoring.liveScore()}`);
    this.hudState.setText(`${this.stateMachine.current}`);
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
    const sol = solveLaunch(WORLD.SLING_X, WORLD.SLING_Y, target.x, target.y, { angleDeg: -14 });
    if (!sol) return null;
    this.debugLaunch(sol.vx, sol.vy, this.selectedProjectile);
    return sol;
  }
}
