/**
 * Physics object factory — the only place Matter bodies are created.
 * Owns: ground, destructible blocks (wood/glass/stone/explosive), static
 * answer targets, moving obstacles, and projectiles (5 types + split children).
 * Also owns damage, destruction, explosions, freezing and safe removal.
 */
import Phaser from 'phaser';
import { MATERIALS, DAMAGE, EXPLOSION, ICE, PROJECTILE_TYPES, SPLIT_CHILD, BOOST, TARGETS, WORLD, COLORS } from '../config.js';

const MatterLib = Phaser.Physics.Matter.Matter;

export class ObjectFactory {
  constructor(scene) {
    this.scene = scene;
    this.ground = null;
    this.blocks = [];       // active destructible blocks
    this.targets = [];      // active answer targets
    this.movers = [];       // moving obstacles ({ go, baseX, baseY, axis, range, speed })
    this.projectiles = [];  // active projectiles of the current shot
    this.removalQueue = []; // bodies to destroy after the physics step
    this.explosionQueue = [];
    this.collisionHandlers = [];
  }

  /* ------------------------------------------------------------------ */
  /* World                                                               */
  /* ------------------------------------------------------------------ */

  createGround() {
    const y = WORLD.GROUND_Y + WORLD.GROUND_THICKNESS / 2;
    const go = this.scene.matter.add.image(WORLD.WIDTH / 2, y, 'tex-ground', undefined, {
      shape: { type: 'rectangle', width: WORLD.WIDTH + 800, height: WORLD.GROUND_THICKNESS },
      isStatic: true,
      friction: 0.9,
      label: 'ground'
    });
    go.setDisplaySize(WORLD.WIDTH + 800, WORLD.GROUND_THICKNESS);
    go.wb = { kind: 'ground' };
    this.ground = go;
    return go;
  }

  /* ------------------------------------------------------------------ */
  /* Question-scoped objects                                             */
  /* ------------------------------------------------------------------ */

  /** Build all objects for one question layout. */
  buildLayout(layout) {
    this.clearQuestionObjects();
    for (const def of layout.blocks || []) this.createBlock(def);
    for (const def of layout.moving || []) this.createMover(def);
    return this;
  }

  createBlock(def) {
    const mat = MATERIALS[def.m];
    const texture = `tex-${def.m}`;
    const go = this.scene.matter.add.image(def.x, def.y, texture, undefined, {
      shape: { type: 'rectangle', width: def.w, height: def.h },
      friction: mat.friction,
      restitution: mat.restitution,
      density: mat.density,
      frictionAir: 0.002,
      label: 'block'
    });
    go.setDisplaySize(def.w, def.h);
    go.setDepth(5);
    go.wb = {
      kind: 'block',
      material: def.m,
      hp: mat.hp,
      maxHp: mat.hp,
      frozenUntil: 0,
      removed: false
    };
    this.blocks.push(go);
    return go;
  }

  createMover(def) {
    const texture = `tex-${def.material || 'stone'}`;
    const go = this.scene.matter.add.image(def.x, def.y, texture, undefined, {
      shape: { type: 'rectangle', width: def.w, height: def.h },
      isStatic: true,
      label: 'mover'
    });
    go.setDisplaySize(def.w, def.h);
    go.setDepth(4);
    go.wb = { kind: 'mover' };
    const mover = {
      go,
      baseX: def.x,
      baseY: def.y,
      axis: def.axis,
      range: def.range,
      speed: def.speed,
      phase: def.phase || 0
    };
    this.movers.push(mover);
    return mover;
  }

  /**
   * Static answer target. Targets are never damaged and never moved —
   * only a direct hit from an eligible player projectile validates them.
   */
  createTarget(def, meta) {
    const go = this.scene.matter.add.image(def.x, def.y, 'tex-target', undefined, {
      shape: { type: 'rectangle', width: TARGETS.WIDTH, height: TARGETS.HEIGHT },
      isStatic: true,
      restitution: TARGETS.RESTITUTION,
      label: 'target'
    });
    go.setDisplaySize(TARGETS.WIDTH, TARGETS.HEIGHT);
    go.setDepth(6);
    go.wb = { kind: 'target', choiceId: meta.choiceId, questionIndex: meta.questionIndex, hit: false };

    const label = this.scene.add.text(def.x, def.y - 6, meta.label, {
      fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#1d3557'
    }).setOrigin(0.5).setDepth(8);
    const clip = meta.text.length > 16 ? meta.text.slice(0, 15) + '…' : meta.text;
    const body = this.scene.add.text(def.x, def.y + 15, clip, {
      fontFamily: 'Arial', fontSize: '12px', color: '#1d3557'
    }).setOrigin(0.5).setDepth(8);
    go.wb.labels = [label, body];

    this.targets.push(go);
    return go;
  }

  /* ------------------------------------------------------------------ */
  /* Projectiles                                                         */
  /* ------------------------------------------------------------------ */

  createProjectile(typeKey, x, y, shotId, opts = {}) {
    const type = opts.child ? { ...PROJECTILE_TYPES[typeKey], radius: SPLIT_CHILD.radius, density: SPLIT_CHILD.density, restitution: SPLIT_CHILD.restitution, frictionAir: SPLIT_CHILD.frictionAir, ability: null } : PROJECTILE_TYPES[typeKey];
    const texture = opts.child ? 'proj-split-child' : `proj-${typeKey}`;
    const d = type.radius * 2;
    const go = this.scene.matter.add.image(x, y, texture, undefined, {
      shape: { type: 'circle', radius: type.radius },
      density: type.density,
      restitution: type.restitution,
      frictionAir: type.frictionAir,
      friction: 0.6,
      label: 'projectile'
    });
    go.setDisplaySize(d, d);
    go.setDepth(9);
    go.wb = {
      kind: 'projectile',
      typeKey: opts.child ? `${typeKey}-child` : typeKey,
      shotId,
      ability: type.ability,
      abilityUsed: false,
      firstImpactDone: false,
      consumed: false
    };
    this.projectiles.push(go);
    return go;
  }

  /** All projectiles belonging to a shot id. */
  projectilesOfShot(shotId) {
    return this.projectiles.filter((p) => !p.wb.consumed && p.wb.shotId === shotId);
  }

  /** One-shot mid-flight ability (boost / split). Returns true if activated. */
  tryActivateAbility(projectile) {
    if (projectile.wb.consumed || projectile.wb.abilityUsed) return false;
    const ability = projectile.wb.ability;
    if (ability === 'boost') {
      projectile.wb.abilityUsed = true;
      const v = projectile.body.velocity;
      projectile.setVelocity(v.x * BOOST.MULTIPLIER, v.y * BOOST.MULTIPLIER);
      this.scene.audio.emit('boost');
      return true;
    }
    if (ability === 'split') {
      projectile.wb.abilityUsed = true;
      const v = projectile.body.velocity;
      const spread = (SPLIT_CHILD.spreadAngleDeg * Math.PI) / 180;
      const shotId = projectile.wb.shotId;
      for (const sign of [-1, 1]) {
        const cos = Math.cos(spread * sign);
        const sin = Math.sin(spread * sign);
        const nvx = v.x * cos - v.y * sin;
        const nvy = v.x * sin + v.y * cos;
        const child = this.createProjectile('split', projectile.x, projectile.y, shotId, { child: true });
        child.setVelocity(nvx, nvy);
      }
      this.scene.audio.emit('split');
      return true;
    }
    return false;
  }

  /** First-impact effects (bomb detonation, ice freeze). */
  onProjectileFirstImpact(projectile, otherBody) {
    if (projectile.wb.firstImpactDone || projectile.wb.consumed) return;
    projectile.wb.firstImpactDone = true;
    const ability = projectile.wb.ability;
    if (ability === 'detonate') {
      const pos = { x: projectile.x, y: projectile.y };
      this.remove(projectile);
      this.explode(pos.x, pos.y);
      this.scene.audio.emit('explode');
    } else if (ability === 'freeze') {
      this.freezeNear(projectile.x, projectile.y);
      this.scene.audio.emit('freeze');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Damage / destruction                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Impact damage routing for one collision pair. Called from the scene's
   * single collisionstart handler. Damage applies to block bodies only;
   * targets/ground/movers are indestructible.
   */
  handleImpact(bodyA, bodyB) {
    this.impactOneSide(bodyA, bodyB);
    this.impactOneSide(bodyB, bodyA);
  }

  impactOneSide(blockSide, otherSide) {
    const block = blockSide.gameObject;
    if (!block || !block.wb || block.wb.kind !== 'block' || block.wb.removed) return;
    const other = otherSide.gameObject;
    if (other && other.wb && other.wb.kind === 'target') return; // soft targets carry no impact

    const vA = blockSide.velocity || { x: 0, y: 0 };
    const vB = otherSide.velocity || { x: 0, y: 0 };
    const relSpeed = Math.hypot(vA.x - vB.x, vA.y - vB.y);
    if (relSpeed < DAMAGE.MIN_REL_SPEED) return;

    let otherMass = otherSide.isStatic ? DAMAGE.MAX_MASS : otherSide.mass;
    otherMass = Math.max(DAMAGE.MIN_MASS, Math.min(DAMAGE.MAX_MASS, otherMass));
    const dmg = relSpeed * otherMass * DAMAGE.FACTOR * MATERIALS[block.wb.material].damageScale;
    if (dmg < 4) return;

    this.damageBlock(block, dmg, 'impact');
    this.scene.audio.emit(`hit-${block.wb.material}`);
  }

  damageBlock(block, dmg, source) {
    if (!block.wb || block.wb.removed) return;
    const frozen = block.wb.frozenUntil > this.scene.time.now;
    block.wb.hp -= dmg * (frozen ? ICE.DAMAGE_MULTIPLIER : 1);
    block.setAlpha(0.55 + 0.45 * Math.max(0, block.wb.hp / block.wb.maxHp));
    if (block.wb.hp <= 0) {
      block.wb.removed = true;
      const mat = block.wb.material;
      const pos = { x: block.x, y: block.y };
      this.remove(block);
      this.scene.audio.emit(`break-${mat}`);
      if (MATERIALS[mat].isExplosive) {
        this.explosionQueue.push(pos); // chain reaction, processed after the step
      }
    }
  }

  explode(x, y) {
    const fx = this.scene.add.circle(x, y, 18, 0xffb703).setDepth(20).setAlpha(0.9);
    this.scene.tweens.add({
      targets: fx, radius: EXPLOSION.RADIUS, alpha: 0, duration: 320, ease: 'Cubic.out',
      onComplete: () => fx.destroy()
    });
    this.scene.cameras.main.shake(140, 0.004);

    for (const block of [...this.blocks]) {
      if (block.wb.removed) continue;
      const dx = block.x - x;
      const dy = block.y - y;
      const d = Math.hypot(dx, dy);
      if (d > EXPLOSION.RADIUS) continue;
      const falloff = 1 - d / EXPLOSION.RADIUS;
      // answer targets are immune to blasts; blocks are not
      this.damageBlock(block, EXPLOSION.DAMAGE * falloff, 'explosion');
      if (block.wb.removed) continue;
      const inv = d === 0 ? 0 : 1 / d;
      const body = block.body;
      MatterLib.Sleeping.set(body, false);
      MatterLib.Body.applyForce(body, body.position, {
        x: dx * inv * EXPLOSION.POWER * body.mass,
        y: (dy * inv - 0.35) * EXPLOSION.POWER * body.mass
      });
    }
  }

  freezeNear(x, y) {
    const now = this.scene.time.now;
    for (const block of this.blocks) {
      if (block.wb.removed) continue;
      if (Math.hypot(block.x - x, block.y - y) <= ICE.RADIUS) {
        block.wb.frozenUntil = now + ICE.DURATION_MS;
        block.setTint(COLORS.FROZEN_TINT);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  /** Queue a body for safe removal after the current physics step. */
  remove(go) {
    if (!go) return;
    if (go.wb) go.wb.consumed = true;
    if (!this.removalQueue.includes(go)) this.removalQueue.push(go);
  }

  /** Called every frame (not while paused). */
  update(time, delta, elapsed) {
    // process queued explosions (chain reactions land here too)
    if (this.explosionQueue.length) {
      const queue = this.explosionQueue.splice(0);
      for (const pos of queue) this.explode(pos.x, pos.y);
    }

    // safe removal
    while (this.removalQueue.length) {
      const go = this.removalQueue.shift();
      this.detach(go);
      if (go.wb && go.wb.labels) go.wb.labels.forEach((l) => l.destroy());
      go.destroy();
    }

    // moving obstacles (own clock, frozen while paused)
    for (const m of this.movers) {
      const offset = Math.sin(elapsed / 1000 * m.speed * Math.PI + m.phase) * m.range;
      const x = m.axis === 'x' ? m.baseX + offset : m.baseX;
      const y = m.axis === 'y' ? m.baseY + offset : m.baseY;
      MatterLib.Body.setPosition(m.go.body, { x, y });
      m.go.setPosition(x, y);
    }

    // frozen expiry
    const now = this.scene.time.now;
    for (const block of this.blocks) {
      if (!block.wb.removed && block.wb.frozenUntil && block.wb.frozenUntil < now) {
        block.wb.frozenUntil = 0;
        block.clearTint();
      }
    }

    // out-of-bounds cleanup
    this.cleanupOutOfBound();
  }

  cleanupOutOfBound() {
    const m = WORLD.KILL_MARGIN;
    for (const block of this.blocks) {
      if (block.wb.removed) continue;
      if (block.y > WORLD.HEIGHT + m || block.x < -m || block.x > WORLD.WIDTH + m) {
        block.wb.removed = true;
        this.remove(block);
      }
    }
    for (const p of this.projectiles) {
      if (p.wb.consumed) continue;
      if (p.y > WORLD.HEIGHT + m || p.x < -m || p.x > WORLD.WIDTH + m || p.y < -400) {
        this.remove(p);
      }
    }
  }

  detach(go) {
    if (!go || !go.wb) return;
    const arrays = { block: this.blocks, target: this.targets, projectile: this.projectiles, mover: this.movers };
    const arr = arrays[go.wb.kind];
    if (arr) {
      const i = arr.indexOf(go);
      if (i !== -1) arr.splice(i, 1);
    }
    if (go.wb.kind === 'mover') {
      const i = this.movers.findIndex((m) => m.go === go);
      if (i !== -1) this.movers.splice(i, 1);
    }
  }

  /** Destroy everything belonging to the current question (targets, blocks, movers, projectiles). */
  clearQuestionObjects() {
    this.explosionQueue.length = 0;
    const all = [
      ...this.blocks, ...this.targets, ...this.projectiles,
      ...this.movers.map((m) => m.go)
    ];
    this.removalQueue.length = 0; // superseded — destroying directly below
    this.blocks = [];
    this.targets = [];
    this.projectiles = [];
    this.movers = [];
    for (const go of all) {
      if (go.wb && go.wb.labels) go.wb.labels.forEach((l) => l.destroy());
      go.destroy();
    }
  }

  /** True when every dynamic body has settled (for PHYSICS_RESOLVING). */
  isSettled() {
    if (this.removalQueue.length || this.explosionQueue.length) return false;
    for (const block of this.blocks) {
      if (block.wb.removed) continue;
      if (block.body.isSleeping) continue;
      const v = block.body.velocity;
      if (Math.hypot(v.x, v.y) > 0.6) return false;
    }
    for (const p of this.projectiles) {
      if (p.wb.consumed) continue;
      if (p.body.isSleeping) continue;
      const v = p.body.velocity;
      if (Math.hypot(v.x, v.y) > 0.4) return false;
    }
    return true;
  }
}
