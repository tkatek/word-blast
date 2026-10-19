/**
 * LevelUnlockAnimation — the short celebratory reveal when a GENUINELY
 * newly unlocked level card is shown (Fix #23).
 *
 * Purely presentational: the unlock itself always comes from the existing
 * SaveManager data — this animation never writes progress. The scene only
 * invokes it when save.unlockedLevel advanced past the last value this
 * game instance displayed (registry snapshot), so the same unlock is
 * never replayed on every visit.
 *
 * Sequence (≈0.9 s, skipped entirely under Reduced Motion):
 *   the padlock reacts, pops off and fades → the card flips to its
 *   unlocked look with a soft pop → a small golden sparkle burst + a
 *   gentle star chime.
 */
import Phaser from 'phaser';

/**
 * @param {Phaser.Scene} scene
 * @param {import('./LevelCard.js').LevelCard} card rendered in its locked
 *        look; swapped to unlocked by this animation
 * @param {object} [o]
 * @param {boolean} [o.reducedMotion] instant swap, no particles
 * @param {() => void} [o.onDone] fired once the reveal finished
 */
export function playLevelUnlock(scene, card, o = {}) {
  const { reducedMotion = false, onDone = null } = o;
  if (!card) {
    if (onDone) onDone();
    return;
  }
  if (reducedMotion || card.unlocked) {
    card.revealUnlocked(true);
    if (onDone) onDone();
    return;
  }

  const audio = scene.registry.get('audio');
  const x = card.container.x;
  const y = card.container.y;

  // 1) the lock reacts and pops off
  if (card.lock) {
    scene.tweens.add({
      targets: card.lock, scale: '*=1.35', angle: 14,
      duration: 300, ease: 'Cubic.easeIn'
    });
    scene.tweens.add({
      targets: card.lock, alpha: 0, y: '-=34',
      duration: 300, delay: 90, ease: 'Cubic.easeIn'
    });
  }

  // 2) swap to the unlocked look + sparkle burst + gentle chime
  scene.time.delayedCall(430, () => {
    card.revealUnlocked(false);
    spawnUnlockSparkles(scene, x, y);
    try {
      if (audio && typeof audio.play === 'function') audio.play('ui-star', { volume: 0.7 });
    } catch (e) { /* sound is decorative — never block the reveal */ }
  });

  scene.time.delayedCall(580, () => {
    if (onDone) onDone();
  });
}

/**
 * Small golden sparkle burst around the card (a handful of additive glint
 * images with outward tweens — deliberately restrained, no emitters).
 */
function spawnUnlockSparkles(scene, x, y) {
  for (let i = 0; i < 9; i++) {
    const angle = (Math.PI * 2 * i) / 9 + Phaser.Math.FloatBetween(-0.2, 0.2);
    const dist = Phaser.Math.Between(80, 150);
    const s = scene.add.image(x, y, 'p-spark')
      .setDepth(60)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xffe9a0)
      .setScale(0.3)
      .setAlpha(0.95);
    scene.tweens.add({
      targets: s,
      x: x + Math.cos(angle) * dist,
      y: y + Math.sin(angle) * dist - 18,
      scale: Phaser.Math.FloatBetween(0.9, 1.5),
      alpha: 0,
      duration: Phaser.Math.Between(420, 640),
      ease: 'Cubic.easeOut',
      onComplete: () => s.destroy()
    });
  }
}
