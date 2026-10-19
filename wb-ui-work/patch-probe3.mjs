import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const anchor = "page.on('pageerror', (e) => console.log('PAGEERR', e.message));";
if (!s.includes(anchor)) { console.log('anchor missing'); process.exit(1); }
s = s.replace(anchor, [
  "page.on('pageerror', (e) => console.log('PAGEERR', e.message));",
  "const logs = [];",
  "page.on('console', (m) => logs.push(m.text()));",
  "process.on('exit', () => { const tail = logs.slice(-40); console.log('--- console tail ---'); for (const l of tail) console.log(l); });"
].join('\n'));
// enable the game's own debug logging right after menu is active
const a2 = "await sleep(1200);";
s = s.replace(a2, "await sleep(1200);\nawait page.evaluate(() => window.__WB__.setDebug(true));");
writeFileSync(p, s);
console.log('patched4');
