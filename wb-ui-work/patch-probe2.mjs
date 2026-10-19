import { readFileSync, writeFileSync } from 'node:fs';
const p = 'wb-ui-work/probe-pause.mjs';
let s = readFileSync(p, 'utf8');
const marker = "const pause = await page.evaluate(() => {";
if (!s.includes(marker)) { console.log('marker missing'); process.exit(1); }
const flow = [
  "// --- reproduce the acceptance flow: wrong answer, then correct, then pause ---",
  "const clickWorldP = async (wx, wy) => {",
  "  const pt = await page.evaluate(({ wx, wy }) => window.__WB__.worldToClient(wx, wy), { wx, wy });",
  "  await page.mouse.click(pt.x, pt.y, { delay: 40 });",
  "};",
  "const waitState = async (target, t = 20000) => {",
  "  const t0 = Date.now();",
  "  for (;;) {",
  "    const st = await page.evaluate(() => window.__WB__.state());",
  "    if (st === target) return;",
  "    if (Date.now() - t0 > t) throw new Error('waitState ' + target + ' failed; now=' + st);",
  "    await new Promise((r) => setTimeout(r, 150));",
  "  }",
  "};",
  "const clickFeedback = async () => {",
  "  const t0 = Date.now();",
  "  for (;;) {",
  "    const f = await page.evaluate(() => window.__WB__.feedbackInfo());",
  "    if (f && f.visible && f.actionEnabled) break;",
  "    if (Date.now() - t0 > 12000) throw new Error('feedback never armed');",
  "    await new Promise((r) => setTimeout(r, 150));",
  "  }",
  "  const pos = await page.evaluate(() => {",
  "    const s = window.__WB__.scene();",
  "    const r = s.feedbackCard.root, b = s.feedbackCard.button;",
  "    return { x: r.x + b.x * r.scaleX, y: r.y + b.y * r.scaleY };",
  "  });",
  "  await new Promise((r) => setTimeout(r, 250));",
  "  await clickWorldP(pos.x, pos.y);",
  "};",
  "// wrong answer",
  "await page.evaluate(() => {",
  "  const s = window.__WB__.scene();",
  "  const wrong = s.factory.targets.find((t) => t.wb.choiceId !== s.prepared.question.correctAnswerId);",
  "  return s.debugAutoAim(wrong.wb.choiceId);",
  "});",
  "await waitState('ANSWER_FEEDBACK');",
  "await clickFeedback();",
  "await waitState('AIMING');",
  "console.log('flow: wrong answered, back to AIMING');",
  "// correct answer",
  "await page.evaluate(() => !!window.__WB__.autoAim());",
  "await waitState('ANSWER_FEEDBACK');",
  "console.log('flow: correct answered');",
  "await clickFeedback();",
  "await waitState('AIMING');",
  "console.log('flow: continued to question 2, AIMING');",
  ""
].join('\n');
s = s.replace(marker, flow + marker);
writeFileSync(p, s);
console.log('patched3');
