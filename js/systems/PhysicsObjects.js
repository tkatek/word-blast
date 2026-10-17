/**
 * Physics object factory — the only place Matter bodies are created.
 * Owns: the flat ground collider, tower pieces built from the sprite
 * manifest (wood / glass / stone / TNT / pigs), dynamic answer plaques,
 * moving obstacles and projectiles (5 types + split children).
 *
 * Damage model (v2):
 *   - closing speed uses PRE-step velocities captured on 'beforeUpdate',
 *     projected on the contact normal — resting contact never damages
 *   - per-pair cooldowns dedupe sustained contact
 *   - destruction is idempotent; fragments inherit parent motion; support
 *     removal wakes exactly the pieces that rested on it (bounded region)
 *
 * Phaser body/sprite sync: bodies are created at texture size and
 * setDisplaySize scales body + visual together (never pass final-size
 * shapes AND setDisplaySize — double-scaling bug).
 */
import Phaser from 'phaser';
import {
  MATERIALS, DAMAGE, EXPLOSION, ICE, PROJECTILE_TYPES, SPLIT_CHILD, BOOST,
  TARGETS, WORLD, TUNNELING, BUDGETS, COLORS, PHYSICS
} from '../config.js';
import { TOWER_ASSETS } from '../data/tower-assets.js';
import { projectileVisual } from '../data/birds.js';
import { BirdSprite } from './BirdSprite.js';

const MatterLib = Phaser.Physics.Matter.Matter;

export class ObjectFactory {
  constructor(scene) {
    this.scene = scene;
    this.terrain = [];      // the single static ground collider
    this.blocks = [];       // active destructible pieces + pigs
    this.targets = [];      // active answer plaques
    this.movers = [];       // moving obstacles ({ go, baseX, baseY, axis, range, speed })
    this.projectiles = [];  // active projectiles of the current shot
    this.fragments = [];    // short-lived physical debris
    this.removalQueue = []; // bodies to destroy after the physics step
    this.explosionQueue = [];
    this.respawnQueue = []; // answer plaques that fell out of the world
    this.settling = false;  // true during the silent build-time settle phase
    this.prevVel = new Map(); // body.id -> velocity before the last step
    this.birdSkins = [];    // BirdSprite visual layers for bird projectiles

    this.scene.matter.world.on('beforeupdate', this.captureVelocities, this);
    this.scene.events.once('shutdown', () => {
      // on scene restart the physics world can already be torn down
      const w = this.scene.matter && this.scene.matter.world;
      if (w) w.off('beforeupdate', this.captureVelocities, this);
    });
  }

  /** Pre-resolution velocities: the honest measure of impact severity. */
  captureVelocities() {
    if (this.settling) return;
    const bodies = this.scene.matter.world.localWorld.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.isStatic) continue;
      this.prevVel.set(b.id, { x: b.velocity.x, y: b.velocity.y });
    }
    if (this.prevVel.size > 400) this.prevVel.clear(); // bounded
  }

  velocityOf(body) {
    return this.prevVel.get(body.id) || body.velocity || { x: 0, y: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Terrain                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * THE gameplay ground: ONE invisible static collider spanning the whole
   * world at WORLD.GROUND_Y, aligned with the painted grass line of the
   * official background (BackgroundManager pins art and collider to the
   * same line). Flat and continuous — the slingshot on the left and every
   * answer tower center-right stand on this single surface, with no gaps
   * and no platforms. Nothing is drawn: the background art IS the terrain.
   * The collider extends past the side edges and 120px below the world so
   * nothing can slip around or under it.
   */
  createTerrain() {
    const left = -200;
    const right = WORLD.WIDTH + 200;
    const bottom = WORLD.HEIGHT + 120;
    const w = right - left;
    const h = bottom - WORLD.GROUND_Y;
    const body = this.scene.matter.add.rectangle(
      left + w / 2, WORLD.GROUND_Y + h / 2, w, h,
      { isStatic: true, friction: 0.9, label: 'terrain' }
    );
    this.terrain.push(body);
    return body;
  }

  /* ------------------------------------------------------------------ */
  /* Question-scoped objects                                              */
  /* ------------------------------------------------------------------ */

  /** Build all objects for one question layout (pieces + pigs + movers). */
  buildLayout(layout) {
    this.clearQuestionObjects();
    for (const def of layout.pieces || []) this.createPiece(def);
    for (const def of layout.pigs || []) this.createPiece(def);
    for (const def of layout.moving || []) this.createMover(def);
    return this;
  }

  /**
   * One tower piece: sprite from the manifest + collider + material.
   * Dynamic by default — only terrain is static. Rect pieces: body scales
   * with the display size; circle assets (logs, boulders, barrels, pigs)
   * get circle bodies so they roll naturally.
   */
  createPiece(def) {
    const asset = TOWER_ASSETS[def.a];
    if (!asset) {
      console.warn(`[Factory] unknown piece asset "${def.a}" — skipped`);
      return null;
    }
    const mat = MATERIALS[asset.material];
    const [w, h] = asset.size;
    const texKey = `tw-${def.a}`;
    const frame = this.scene.textures.getFrame(texKey);
    const fw = frame ? frame.realWidth : w;
    const fh = frame ? frame.realHeight : h;

    const opts = {
      friction: mat.friction,
      restitution: mat.restitution,
      density: mat.density,
      frictionAir: asset.rolls ? 0.01 : 0.002,
      label: 'block'
    };
    let go;
    if (asset.collider.shape === 'circle') {
      go = this.scene.matter.add.image(def.x, def.y, texKey, undefined, {
        ...opts,
        shape: { type: 'circle', radius: Math.min(fw, fh) / 2 }
      });
    } else {
      go = this.scene.matter.add.image(def.x, def.y, texKey, undefined, opts);
    }
    go.setDisplaySize(w, h);
    go.setDepth(asset.material === 'pig' ? 6 : 5);
    if (def.rot) go.setAngle(def.rot);
    go.wb = {
      kind: asset.material === 'pig' ? 'pig' : 'block',
      asset: def.a,
      pieceId: def.id || null,
      material: asset.material,
      hp: mat.hp,
      maxHp: mat.hp,
      frozenUntil: 0,
      removed: false,
      lastHurt: new Map(), // other body id -> timestamp (pair cooldown)
      startX: def.x,
      startY: def.y
    };
    this.blocks.push(go);
    return go;
  }

  createMover(def) {
    const texture = `tex-${def.m || 'stone'}`;
    const go = this.scene.matter.add.image(def.x, def.y, texture, undefined, {
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

  /* ------------------------------------------------------------------ */
  /* Answer plaques (dynamic targets)                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Dynamic answer plaque on sign_blank_wood: a real body resting on the
   * structure, indestructible, validated only by direct projectile
   * contact. Labels follow the body (position + rotation) via a container,
   * so the text rides the board like paint when the tower tumbles.
   */
  createTarget(def, meta) {
    const [w, h] = TOWER_ASSETS.sign_blank.size;
    const go = this.scene.matter.add.image(def.x, def.y, 'tw-sign_blank', undefined, {
      friction: 0.6,
      restitution: TARGETS.RESTITUTION,
      density: 0.0012,
      frictionAir: 0.004,
      label: 'target'
    });
    go.setDisplaySize(w, h);
    go.setDepth(7);
    go.wb = {
      kind: 'target',
      choiceId: meta.choiceId,
      questionIndex: meta.questionIndex,
      hit: false,
      anchorX: def.x,
      anchorY: def.y,
      respawned: 0,
      labelHolder: null,
      labels: []
    };

    const label = this.scene.add.text(0, -h * 0.26, meta.label, {
      fontFamily: 'Arial', fontSize: '22px', fontStyle: 'bold', color: '#3c2a15'
    }).setOrigin(0.5);
    const clip = meta.text.length > 13 ? meta.text.slice(0, 12) + '…' : meta.text;
    const bodyText = this.scene.add.text(0, h * 0.15, clip, {
      fontFamily: 'Arial', fontSize: '13px', color: '#3c2a15'
    }).setOrigin(0.5);
    const holder = this.scene.add.container(def.x, def.y, [label, bodyText]).setDepth(8);
    go.wb.labelHolder = holder;
    go.wb.labels = [label, bodyText];

    this.targets.push(go);
    return go;
  }

  /** Keep plaque labels glued to their body (position + rotation). */
  syncTargetLabels() {
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const holder = t.wb.labelHolder;
      if (!holder) continue;
      holder.setPosition(t.x, t.y);
      holder.setRotation(t.rotation);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Projectiles                                                          */
  /* ------------------------------------------------------------------ */

  createProjectile(typeKey, x, y, shotId, opts = {}) {
    const child = !!opts.child;
    const base = PROJECTILE_TYPES[typeKey];
    const type = child
      ? { ...base, radius: SPLIT_CHILD.radius, density: SPLIT_CHILD.density, restitution: SPLIT_CHILD.restitution, frictionAir: SPLIT_CHILD.frictionAir, ability: null }
      : base;
    const texture = child ? 'proj-split-child' : `proj-${typeKey}`;
    const d = type.radius * 2;
    // circle body created at the texture's own radius (20 for the 40x40
    // texture); setDisplaySize then scales body + visual together.
    const go = this.scene.matter.add.image(x, y, texture, undefined, {
      shape: { type: 'circle', radius: 20 },
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
      typeKey: child ? `${typeKey}-child` : typeKey,
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

  /**
   * One-shot mid-flight ability (boost / split). Returns true if activated.
   * Speed caps keep every projectile inside the verified anti-tunneling
   * envelope (TUNNELING): boosted <= 24 px/step, split children <= 20.
   */
  tryActivateAbility(projectile) {
    if (projectile.wb.consumed || projectile.wb.abilityUsed) return false;
    const ability = projectile.wb.ability;
    if (ability === 'boost') {
      projectile.wb.abilityUsed = true;
      const v = projectile.body.velocity;
      let nvx = v.x * BOOST.MULTIPLIER;
      let nvy = v.y * BOOST.MULTIPLIER;
      const mag = Math.hypot(nvx, nvy);
      if (mag > TUNNELING.BOOST_SPEED_CAP) {
        nvx = nvx / mag * TUNNELING.BOOST_SPEED_CAP;
        nvy = nvy / mag * TUNNELING.BOOST_SPEED_CAP;
      }
      projectile.setVelocity(nvx, nvy);
      this.scene.audio.emit('boost');
      return true;
    }
    if (ability === 'split') {
      projectile.wb.abilityUsed = true;
      const v = projectile.body.velocity;
      const mag = Math.hypot(v.x, v.y);
      const cap = Math.min(mag, TUNNELING.SPLIT_CHILD_SPEED_CAP);
      const spread = (SPLIT_CHILD.spreadAngleDeg * Math.PI) / 180;
      const shotId = projectile.wb.shotId;
      for (const sign of [-1, 1]) {
        const cos = Math.cos(spread * sign);
        const sin = Math.sin(spread * sign);
        const nvx = (v.x * cos - v.y * sin) / mag * cap;
        const nvy = (v.x * sin + v.y * cos) / mag * cap;
        const childGo = this.createProjectile('split', projectile.x, projectile.y, shotId, { child: true });
        childGo.setVelocity(nvx, nvy);
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
      this.explosionQueue.push(pos);
      this.scene.audio.emit('explode');
    } else if (ability === 'freeze') {
      this.freezeNear(projectile.x, projectile.y);
      this.scene.audio.emit('freeze');
    }
  }

  /* ------------------------------------------------------------------ */
  /* Damage / destruction                                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Impact damage routing for one collision pair. Damage applies to
   * destructible pieces only; plaques/terrain/movers/fragments never take
   * damage. Suppressed entirely during the build-time settle phase.
   */
  handleImpact(bodyA, bodyB) {
    this.impactOneSide(bodyA, bodyB);
    this.impactOneSide(bodyB, bodyA);
  }

  impactOneSide(victimSide, otherSide) {
    if (this.settling) return;
    const victim = victimSide.gameObject;
    if (!victim || !victim.wb) return;
    if (victim.wb.kind !== 'block' && victim.wb.kind !== 'pig') return;
    if (victim.wb.removed) return;

    const other = otherSide.gameObject;
    if (other && other.wb && (other.wb.kind === 'fragment' || other.wb.kind === 'target')) return;

    // closing speed along the contact line, from PRE-step velocities
    const vv = this.velocityOf(victimSide);
    const ov = otherSide.isStatic ? { x: 0, y: 0 } : this.velocityOf(otherSide);
    let nx = otherSide.position.x - victimSide.position.x;
    let ny = otherSide.position.y - victimSide.position.y;
    const len = Math.hypot(nx, ny) || 1;
    nx /= len; ny /= len;
    const relVx = vv.x - ov.x;
    const relVy = vv.y - ov.y;
    const closing = -(relVx * nx + relVy * ny); // > 0 when approaching
    if (closing < DAMAGE.MIN_CLOSING_SPEED) return; // resting / grazing contact

    // pair cooldown — sustained contact damages at most every PAIR_COOLDOWN_MS
    const now = this.scene.time.now;
    const last = victim.wb.lastHurt.get(otherSide.id) || 0;
    if (now - last < DAMAGE.PAIR_COOLDOWN_MS) return;
    victim.wb.lastHurt.set(otherSide.id, now);

    let otherMass = otherSide.isStatic ? DAMAGE.MAX_MASS : otherSide.mass;
    otherMass = Math.max(DAMAGE.MIN_MASS, Math.min(DAMAGE.MAX_MASS, otherMass));
    const dmg = closing * otherMass * DAMAGE.FACTOR * MATERIALS[victim.wb.material].damageScale;
    if (dmg < 4) return;

    this.damageBlock(victim, dmg, 'impact', { x: -nx, y: -ny, closing });
    this.scene.audio.emit(`hit-${victim.wb.material}`);
  }

  damageBlock(block, dmg, source, dir) {
    if (!block.wb || block.wb.removed) return; // idempotent destruction
    const frozen = block.wb.frozenUntil > this.scene.time.now;
    block.wb.hp -= dmg * (frozen ? ICE.DAMAGE_MULTIPLIER : 1);
    this.updateDamageVisual(block);
    if (block.wb.hp > 0) {
      if (dmg >= DAMAGE.STRONG_IMPACT) this.scene.fx?.shakeForImpact(dmg);
      return;
    }
    block.wb.removed = true;
    const mat = block.wb.material;
    const pos = { x: block.x, y: block.y };
    this.remove(block);
    this.scene.audio.emit(`break-${mat}`);
    if (mat === 'pig') {
      this.scene.fx?.pigPop(pos.x, pos.y);
    } else {
      this.spawnFragments(block, dir);
      this.scene.fx?.materialBreak(mat, pos.x, pos.y, Math.min(1, dmg / 70));
      this.scene.fx?.shakeForImpact(dmg);
    }
    if (MATERIALS[mat].isExplosive) {
      this.explosionQueue.push(pos); // chain reaction, processed after the step
    } else {
      this.wakeAbove(pos, block.wb);
    }
  }

  /** Cracks / tint as hp drops (art variants where the pack supplies them). */
  updateDamageVisual(block) {
    const ratio = Math.max(0, block.wb.hp / block.wb.maxHp);
    const swap = (key) => {
      const r = block.rotation;
      block.setTexture(`tw-${key}`);
      block.setDisplaySize(...TOWER_ASSETS[key].size);
      block.setRotation(r);
      block.wb.asset = key;
    };
    if (ratio < 0.5) {
      if (block.wb.asset === 'glass_block_l') swap('glass_block_cracked');
      else if (block.wb.asset === 'stone_block_l') swap('stone_broken');
    }
    block.setAlpha(0.55 + 0.45 * ratio);
  }

  /**
   * When a support breaks, everything that rested on it must fall: wake
   * the sleeping bodies in the bounded column above the removed piece —
   * never the whole world.
   */
  wakeAbove(pos, wb) {
    const w = (TOWER_ASSETS[wb.asset] && TOWER_ASSETS[wb.asset].size[0]) || 60;
    for (const b of this.blocks) {
      if (b.wb.removed) continue;
      const dx = Math.abs(b.x - pos.x);
      const dy = pos.y - b.y; // positive when b is ABOVE the removed piece
      if (dx < w / 2 + 70 && dy > -20 && dy < 260) {
        MatterLib.Sleeping.set(b.body, false);
      }
    }
  }

  /**
   * Physical fragments: a small bounded pool inheriting plausible parent
   * motion + impact direction. Tiny density — never heavier than the
   * parent, never able to damage anything (impact handler skips them).
   */
  spawnFragments(block, dir) {
    const mat = block.wb.material === 'pig' ? 'wood' : block.wb.material;
    const count = Math.min(3, BUDGETS.MAX_FRAGMENTS - this.fragments.length);
    if (count <= 0) return;
    const pv = block.body.velocity;
    for (let i = 0; i < count; i++) {
      const size = 11 + Math.random() * 8;
      const frag = this.scene.matter.add.image(
        block.x + (Math.random() - 0.5) * 30,
        block.y + (Math.random() - 0.5) * 20,
        `frag-${mat}`, undefined,
        {
          shape: { type: 'rectangle', width: 16, height: 16 },
          density: 0.0002,
          friction: 0.4,
          restitution: 0.2,
          frictionAir: 0.02,
          label: 'fragment'
        }
      );
      frag.setDisplaySize(size, size * (0.6 + Math.random() * 0.6));
      frag.setDepth(4);
      frag.wb = { kind: 'fragment', born: this.scene.time.now, material: mat };
      const kick = 1.5 + Math.random() * 2;
      frag.setVelocity(
        pv.x * 0.5 + (dir ? dir.x * kick : 0) + (Math.random() - 0.5) * 2,
        pv.y * 0.5 + (dir ? dir.y * kick : 0) - Math.random() * 2.5
      );
      frag.setAngularVelocity((Math.random() - 0.5) * 0.2);
      this.fragments.push(frag);
    }
  }

  explode(x, y) {
    this.scene.fx?.explosion(x, y);
    for (const block of [...this.blocks]) {
      if (block.wb.removed) continue;
      const dx = block.x - x;
      const dy = block.y - y;
      const d = Math.hypot(dx, dy);
      if (d > EXPLOSION.RADIUS) continue;
      const falloff = 1 - d / EXPLOSION.RADIUS;
      // answer plaques are immune to blast damage; pieces are not
      this.damageBlock(block, EXPLOSION.DAMAGE * falloff, 'explosion',
        { x: d === 0 ? 0 : dx / d, y: d === 0 ? -1 : dy / d });
      if (block.wb.removed) continue;
      const inv = d === 0 ? 0 : 1 / d;
      const body = block.body;
      MatterLib.Sleeping.set(body, false);
      MatterLib.Body.applyForce(body, body.position, {
        x: dx * inv * EXPLOSION.POWER * body.mass,
        y: (dy * inv - 0.35) * EXPLOSION.POWER * body.mass
      });
    }
    // plaques get pushed (visible consequence) but never damaged/validated
    for (const t of this.targets) {
      const dx = t.x - x;
      const dy = t.y - y;
      const d = Math.hypot(dx, dy);
      if (d > EXPLOSION.RADIUS || d === 0) continue;
      const inv = 1 / d;
      MatterLib.Sleeping.set(t.body, false);
      MatterLib.Body.applyForce(t.body, t.body.position, {
        x: dx * inv * EXPLOSION.POWER * 0.7 * t.body.mass,
        y: (dy * inv - 0.3) * EXPLOSION.POWER * 0.7 * t.body.mass
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
  /* Build-time settling                                                  */
  /* ------------------------------------------------------------------ */

  /**
   * Snapshot positions, run `steps` silent physics steps with damage and
   * effects suppressed, then force-sleep everything at rest. Returns the
   * worst drift of any surviving piece (px) and how many were lost:
   * drift <= PHYSICS.SETTLE_MAX_DRIFT with lost === 0 is a normal
   * micro-settle; anything worse means the layout itself was unstable.
   */
  settleLayout(steps) {
    this.settling = true;
    const start = new Map();
    for (const b of this.blocks) start.set(b, { x: b.x, y: b.y });
    let worst = 0;
    let lost = 0;
    for (let i = 0; i < steps; i++) {
      this.scene.matter.world.step(1000 / 60);
      for (const b of this.blocks) {
        if (b.wb.removed) continue;
        if (b.y > WORLD.HEIGHT || b.x < -50 || b.x > WORLD.WIDTH + 50) {
          b.wb.removed = true;
          lost++;
          this.remove(b);
        }
      }
    }
    for (const b of this.blocks) {
      if (b.wb.removed) continue;
      const s = start.get(b);
      worst = Math.max(worst, Math.hypot(b.x - s.x, b.y - s.y));
    }
    for (const b of this.blocks) {
      if (!b.wb.removed) MatterLib.Sleeping.set(b.body, true);
    }
    for (const t of this.targets) MatterLib.Sleeping.set(t.body, true);
    this.settling = false;
    return { drift: worst, lost };
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                            */
  /* ------------------------------------------------------------------ */

  /** Queue a body for safe removal after the current physics step. */
  remove(go) {
    if (!go) return;
    if (go.wb) go.wb.consumed = true;
    if (!this.removalQueue.includes(go)) this.removalQueue.push(go);
  }

  /** Called every frame (not while paused). */
  update(time, delta, elapsed) {
    // process queued explosions (chain reactions land here, rate-bounded)
    if (this.explosionQueue.length) {
      const queue = this.explosionQueue.splice(0, 3);
      for (const pos of queue) this.explode(pos.x, pos.y);
    }

    // safe removal
    while (this.removalQueue.length) {
      const go = this.removalQueue.shift();
      this.detach(go);
      if (go.wb && go.wb.labels) {
        go.wb.labels.forEach((l) => l.destroy());
        if (go.wb.labelHolder) go.wb.labelHolder.destroy();
      }
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

    // fragments: short-lived, fade out, hard budget
    const now = this.scene.time.now;
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      const age = now - f.wb.born;
      if (age > 1500) f.setAlpha(Math.max(0, 1 - (age - 1500) / 500));
      if (age > 2000) {
        this.fragments.splice(i, 1);
        f.destroy();
      }
    }

    // frozen expiry
    for (const block of this.blocks) {
      if (!block.wb.removed && block.wb.frozenUntil && block.wb.frozenUntil < now) {
        block.wb.frozenUntil = 0;
        block.clearTint();
      }
    }

    this.syncTargetLabels();
    this.cleanupOutOfBound();
    this.recoverFallenTargets();
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
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      if (f.y > WORLD.HEIGHT + 40 || f.x < -40 || f.x > WORLD.WIDTH + 40) {
        this.fragments.splice(i, 1);
        f.destroy();
      }
    }
    for (const p of this.projectiles) {
      if (p.wb.consumed) continue;
      if (p.y > WORLD.HEIGHT + m || p.x < -m || p.x > WORLD.WIDTH + m || p.y < -400) {
        this.remove(p);
      }
    }
  }

  /**
   * Controlled recovery: a plaque that fell out of the playable area (pushed
   * off the side edges of the world) reappears at its anchor — never
   * auto-answered, just kept hittable. Bounded to a few respawns per plaque.
   */
  recoverFallenTargets() {
    if (this.settling) return;
    for (const t of this.targets) {
      if (t.wb.hit || t.wb.respawned >= 3) continue;
      const out = t.y > WORLD.HEIGHT - 10
        || t.x < -20
        || t.x > WORLD.WIDTH - 30;
      if (out) this.respawnQueue.push(t);
    }
    while (this.respawnQueue.length) {
      const t = this.respawnQueue.shift();
      if (t.wb.hit || t.wb.removed) continue;
      t.wb.respawned++;
      MatterLib.Sleeping.set(t.body, false);
      MatterLib.Body.setPosition(t.body, { x: t.wb.anchorX, y: t.wb.anchorY - 110 });
      MatterLib.Body.setVelocity(t.body, { x: 0, y: 0 });
      MatterLib.Body.setAngularVelocity(t.body, 0);
      MatterLib.Body.setAngle(t.body, 0);
      this.scene.fx?.respawnPuff(t.wb.anchorX, t.wb.anchorY);
      this.scene.showToast && this.scene.showToast('Answer plaque recovered');
    }
  }

  detach(go) {
    if (!go || !go.wb) return;
    const arrays = { block: this.blocks, pig: this.blocks, target: this.targets, projectile: this.projectiles };
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

  /** Destroy everything belonging to the current question. */
  clearQuestionObjects() {
    this.explosionQueue.length = 0;
    this.respawnQueue.length = 0;
    const all = [
      ...this.blocks, ...this.targets, ...this.projectiles, ...this.fragments,
      ...this.movers.map((m) => m.go)
    ];
    this.removalQueue.length = 0; // superseded — destroying directly below
    this.blocks = [];
    this.targets = [];
    this.projectiles = [];
    this.movers = [];
    this.fragments = [];
    for (const go of all) {
      if (go.wb && go.wb.labels) {
        go.wb.labels.forEach((l) => l.destroy());
        if (go.wb.labelHolder) go.wb.labelHolder.destroy();
      }
      go.destroy();
    }
  }

  /**
   * True when no destructible block is still moving. Moving obstacles are
   * intentionally excluded — they never settle. Used by the shot-resolution
   * watcher so a shot is not declared over while rubble is still falling.
   */
  blocksQuiet() {
    if (this.removalQueue.length || this.explosionQueue.length) return false;
    for (const block of this.blocks) {
      if (block.wb.removed) continue;
      if (!block.body) continue;            // already destroyed (e.g. popped pig)
      if (block.body.isSleeping) continue;
      const v = block.body.velocity;
      if (Math.hypot(v.x, v.y) > PHYSICS.BLOCK_REST_SPEED) return false;
    }
    return true;
  }

  /** True when every dynamic body has settled (for ANSWER_FEEDBACK). */
  isSettled() {
    if (!this.blocksQuiet()) return false;
    for (const p of this.projectiles) {
      if (p.wb.consumed) continue;
      if (p.body.isSleeping) continue;
      const v = p.body.velocity;
      if (Math.hypot(v.x, v.y) > PHYSICS.PROJECTILE_REST_SPEED) return false;
    }
    return true;
  }
}
