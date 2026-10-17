import { createHeadlessGame } from '../../tests/helpers/headless-game.mjs';

const h = await createHeadlessGame();
await h.gotoLevel(10);
await h.waitForState('AIMING');
const s = h.scene();
s.selectProjectile('split');
console.log('loadedType:', s.slingshot.loadedType);
console.log('before fire, projectiles:', s.factory.projectiles.map(p => ({ t: p.wb.typeKey, shot: p.wb.shotId, c: p.wb.consumed })));
const ok = h.fire(15, -6);
console.log('fire:', ok, 'shot id:', s.currentShot && s.currentShot.id);
await h.waitFor(() => h.state() === 'PROJECTILE_FLYING', 8000);
console.log('after FLYING, projectiles:', s.factory.projectiles.map(p => ({ t: p.wb.typeKey, shot: p.wb.shotId, c: p.wb.consumed, used: p.wb.abilityUsed })));
s.tryActivateAbilities();
console.log('after tap1:', s.factory.projectiles.map(p => ({ t: p.wb.typeKey, shot: p.wb.shotId, c: p.wb.consumed })));
s.tryActivateAbilities();
console.log('after tap2:', s.factory.projectiles.map(p => ({ t: p.wb.typeKey, shot: p.wb.shotId, c: p.wb.consumed })));
process.exit(0);
