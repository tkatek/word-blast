import { readFileSync, writeFileSync } from 'fs';
const p = 'tests/helpers/headless-game.mjs';
let s = readFileSync(p, 'utf8');
if (!s.includes('predictPath')) {
  s = s.replace(
    "const { solveLaunch } = await import('../../js/systems/Trajectory.js');",
    "const { solveLaunch, predictPath } = await import('../../js/systems/Trajectory.js');"
  );
  const anchor = `    solveLaunch: (tx, ty, opts) => {
      const a = slingAnchor();
      return solveLaunch(a.x, a.y, tx, ty, opts);
    },`;
  const replacement = `${anchor}
    /** Predict an arc from the live anchor (same integrator as the game). */
    predictPath: (vx, vy, opts) => {
      const a = slingAnchor();
      return predictPath(a.x, a.y, vx, vy, opts);
    },`;
  if (!s.includes(anchor)) { console.error('anchor not found'); process.exit(1); }
  s = s.replace(anchor, replacement);
  writeFileSync(p, s);
  console.log('predictPath added to harness');
} else {
  console.log('already present');
}
