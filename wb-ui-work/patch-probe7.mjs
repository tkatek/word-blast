import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const old = "// correct answer\nawait page.evaluate(() => !!window.__WB__.autoAim());\nawait waitState('ANSWER_FEEDBACK');\nconsole.log('flow: correct answered');\nawait clickFeedback();\nawait waitState('AIMING');\nconsole.log('flow: continued to question 2, AIMING');";
if (!s.includes(old)) { console.log('anchor missing'); process.exit(1); }
const neu = [
  "// correct answer (with retries — slow software rendering can strand shots)",
  "let correct = false;",
  "for (let attempt = 0; attempt < 4 && !correct; attempt++) {",
  "  const fired = await page.evaluate(() => !!window.__WB__.autoAim());",
  "  if (!fired) { await new Promise((r) => setTimeout(r, 500)); continue; }",
  "  try { await waitState('ANSWER_FEEDBACK', 25000); correct = true; }",
  "  catch (e) { console.log('attempt', attempt, 'missed; retrying'); await waitState('AIMING', 25000); }",
  "}",
  "if (!correct) { console.log('CORRECT ANSWER NEVER LANDED'); process.exit(1); }",
  "console.log('flow: correct answered');",
  "await clickFeedback();",
  "await waitState('AIMING', 30000);",
  "console.log('flow: continued to question 2, AIMING');"
].join('\n');
s = s.replace(old, neu);
writeFileSync(p, s);
console.log('patched8');
