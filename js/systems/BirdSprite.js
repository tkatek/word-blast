/**
 * BirdSprite — the VISUAL layer of a bird projectile (Fix #6).
 *
 * The Matter.js body created by ObjectFactory.createProjectile stays the
 * single source of truth for position, rotation and collisions; this class
 * owns a plain Phaser image ("skin") that is synchronized to that body
 * every frame and adds restrained, purely cosmetic animation:
 *
 *   - while flying fast the bird FACES ITS VELOCITY (classic slingshot
 *     read; the body itself may carry the launch angular velocity, which
 *     would otherwise spin the face around)
 *   - once slow (rolling / resting) the skin follows the physical body
 *     angle, so ground contact tumbles naturally
 *   - a subtle wing-breathing scale while in clean flight
 *   - a short squash on first impact, a stretch pulse + spark trail on
 *     boost, an icy tint on freeze
 *
 * None of this touches physics: no tweens on Matter bodies, no world
 * position changes — the skin only reads host.x / host.y / host.angle.
 */
import { BIRDS } from '../data/birds.js';

const FACE_SPEED_MIN = 3.0;      // px/step: above this the bird faces its velocity
const TURN_RATE = 0.25;          // per-frame angular lerp toward the target angle
const REST_SPEED = 0.6;          // px/step below which a bird counts as at rest
const UPRIGHT_RATE = 0.12;       // per-frame ease toward the upright pose at rest
const DAMP_TURN_RATE = 0.35;     // post-impact follow: fraction of remaining angle
const DAMP_MAX_STEP = 0.045;     // post-impact follow: rad/frame cap (≈2.7 rad/s)
const FLAP_AMPLITUDE = 0.03;     // ±3% cross-axis breathing during flight
const FLAP_CYCLES_PER_S = 5.0;
const SQUASH_MS = 220;           // impact squash envelope length
const SQUASH_X = 0.14;           // +14% along the facing axis at the peak
const SQUASH_Y = 0.12;           // −12% across
const BOOST_STRETCH = 0.22;      // momentary stretch on boost activation
const BOOST_MS = 260;
const TRAIL_MS = 520;            // boost spark-trail duration
const ICE_TINT = 0x9fd8ff;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Shortest signed delta between two angles, in (−π, π]. */
function angleDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export class BirdSprite {
  /**
   * @param {Phaser.Scene} scene
   * @param {Phaser.Physics.Matter.Image} host the physics projectile (its
   *        own sprite is hidden — the skin is the only visible part)
   * @param {object} bird BIRDS entry (js/data/birds.js)
   * @param {number} display square display size in world px
   * @param {object|null} fx EffectsSystem (optional — ability effects are
   *        skipped without it)
   */
  constructor(scene, host, bird, display, fx = null) {
    this.scene = scene;
    this.host = host;
    this.bird = bird;
    this.fx = fx;
    this.dead = false;

    this.skin = scene.add.image(host.x, host.y, bird.texture)
      .setDisplaySize(display, display)
      .setDepth(host.depth);
    this.baseScale = this.skin.scaleX;

    this.angle = host.angle;
    this.lastImpact = false;
    this.lastAbilityUsed = false;
    this.squashAt = -1;
    this.boostAt = -1;
    this.trail = null;
    this.iceTinted = false;
    this.fading = false;
  }

  /**
   * Time-limited landing animation (Fix #6B): freeze the pose, fade the
   * artwork out and destroy the skin. The physics host is untouched.
   * Safe to call repeatedly — only the first call runs.
   * @param {number} ms fade duration
   */
  beginFade(ms = 300) {
    if (this.dead || this.fading) return;
    this.fading = true;
    if (this.trail) {
      this.trail.stop();
      this.trail = null;
    }
    this.scene.tweens.add({
      targets: this.skin,
      alpha: 0,
      duration: ms,
      ease: 'Sine.out',
      onComplete: () => this.destroy()
    });
  }

  /** True while the underlying projectile is alive and moving fast. */
  get isFlying() {
    const v = this.host.body.velocity;
    return Math.hypot(v.x, v.y) > FACE_SPEED_MIN;
  }

  /**
   * Per-frame sync (called from ObjectFactory.update — never while
   * paused). Returns false once the sprite is dead.
   * @param {number} now scene.time.now
   */
  sync(now) {
    if (this.dead) return false;
    const host = this.host;
    if (!host.active || !host.body) {
      this.destroy();
      return false;
    }

    const skin = this.skin;
    skin.setPosition(host.x, host.y);

    // ---- rotation policy (Fix #6B — no flips, no face-down rest poses):
    //   clean flight  → face the velocity vector (classic slingshot read)
    //   after impact  → follow the physical body angle, but rate-DAMPED so
    //                   a fast-tumbling body never whips the artwork around
    //   at rest       → ease upright so a landed bird never lies on its head
    const wb = host.wb;
    const v = host.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    if (!wb.firstImpactDone && speed > FACE_SPEED_MIN) {
      this.angle += angleDelta(this.angle, Math.atan2(v.y, v.x)) * TURN_RATE;
    } else if (this.fading) {
      // keep the last pose while fading out
    } else if (speed < REST_SPEED || host.body.isSleeping) {
      this.angle += angleDelta(this.angle, 0) * UPRIGHT_RATE;
    } else {
      const d = angleDelta(this.angle, host.angle) * DAMP_TURN_RATE;
      this.angle += clamp(d, -DAMP_MAX_STEP, DAMP_MAX_STEP);
    }
    skin.setRotation(this.angle);

    // ---- cosmetic scale: breathing in flight, impact squash, boost stretch
    let sx = 1;
    let sy = 1;
    if (!this.fading && !wb.firstImpactDone && speed > 4) {
      const flap = 1 + Math.sin(now * 0.001 * FLAP_CYCLES_PER_S * Math.PI * 2) * FLAP_AMPLITUDE;
      sy = flap;
      sx = 2 - flap;
    }
    if (this.squashAt >= 0) {
      const t = (now - this.squashAt) / SQUASH_MS;
      if (t >= 1) this.squashAt = -1;
      else {
        const k = Math.sin((1 - t) * Math.PI);
        sx *= 1 + SQUASH_X * k;
        sy *= 1 - SQUASH_Y * k;
      }
    }
    if (this.boostAt >= 0) {
      const t = (now - this.boostAt) / BOOST_MS;
      if (t >= 1) this.boostAt = -1;
      else {
        const k = Math.sin((1 - t) * Math.PI);
        sx *= 1 + BOOST_STRETCH * k;
        sy *= 1 - (BOOST_STRETCH * 0.6) * k;
      }
    }
    skin.setScale(this.baseScale * sx, this.baseScale * sy);

    // ---- ability / impact transitions (edge-detected from the wb flags
    //      the gameplay code already maintains — no new state, no physics)
    if (wb.firstImpactDone && !this.lastImpact) {
      this.lastImpact = true;
      this.squashAt = now;
      if (wb.typeKey === 'ice' && !this.iceTinted) {
        this.iceTinted = true;
        skin.setTint(ICE_TINT);
        this.scene.time.delayedCall(900, () => {
          if (!this.dead) this.skin.clearTint();
        });
      }
    }
    if (wb.abilityUsed && !this.lastAbilityUsed) {
      this.lastAbilityUsed = true;
      if (wb.typeKey === 'speed') {
        this.boostAt = now;
        this.startTrail(now);
      }
    }

    // ---- boost trail emitter lifecycle
    if (this.trail) {
      if (now - this.trailStartedAt > TRAIL_MS) {
        this.trail.stop();
        this.trail = null;
      } else {
        this.trail.setPosition(host.x, host.y);
      }
    }
    return true;
  }

  /** Bounded spark trail behind the bird while the boost plays out. */
  startTrail(now) {
    if (!this.fx || this.fx.reducedMotion) return;
    // Fix #19: the speed bird is the BLUE bird — icy blue streaks
    const emitter = this.fx.makeEmitter('p-spark', {
      lifespan: { min: 220, max: 380 },
      speed: { min: 12, max: 46 },
      gravityY: 90,
      scale: { start: 0.55, end: 0.05 },
      alpha: { start: 0.9, end: 0 },
      tint: [0x4fc3f7, 0x90caf9, 0xbde0fe],
      frequency: 26,
      quantity: 1
    });
    if (!emitter) return;
    emitter.setPosition(this.host.x, this.host.y);
    this.trail = emitter;
    this.trailStartedAt = now;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.scene.tweens.killTweensOf(this.skin);
    if (this.trail) {
      this.trail.stop();
      this.trail = null;
    }
    this.skin.destroy();
  }
}
