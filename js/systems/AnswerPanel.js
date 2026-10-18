/**
 * ANSWER PANEL — measurement-driven panel formatting + typography for the
 * parchment answer plaques (the reusable component behind every one of the
 * 180 answer choices).
 *
 * Pipeline (per question):
 *   1. planQuestion() measures every choice text with REAL Phaser text
 *      metrics (a scratch Text object, advanced word wrap) inside each
 *      format's writing box.
 *   2. Each choice's NEEDED format = the smallest panel whose box holds the
 *      text at a font size >= that format's minimum.
 *   3. The QUESTION format = the largest needed format among the three
 *      choices — all three answers of one question always share one panel
 *      format and one font size (no visual advantage for any choice, and
 *      nothing about the correct answer stands out).
 *   4. buildVisual() paints the badge + fitted text for one panel, centered
 *      inside the parchment writing box, and returns the game objects so the
 *      physics factory can glue them to the Matter body's transform.
 *
 * Writing boxes are measured from the actual panel artwork (parchment
 * extents), so text never touches the wooden frame, the corner bolts or the
 * decorative rivets — see PANEL_FORMATS below.
 *
 * Pure geometry helpers (formatFor/boxFor) avoid Phaser so Node-side audits
 * can run against the same constants.
 */
import { TARGETS } from '../config.js';

/**
 * Panel formats. `box` = parchment writing box in panel-local px, centered on
 * the panel origin (x from left edge, y from top edge), measured from the
 * shipped artwork:
 *   - S/M/L: parchment extents of the three baked variants
 *   - XL: the newly uploaded wide parchment artwork (scripts/build-answer-panel-xl.mjs
 *     reports the fractions — x 0.083..0.864, y 0.245..0.797 of 300×97)
 * `size` must match TOWER_ASSETS[key].size (physics collider + display size).
 */
export const PANEL_FORMATS = {
  S: {
    key: 'answer_panel_s', size: [116, 80],
    box: { x: 31, y: 22, w: 54, h: 32 },
    font: { max: 24, min: 15 }
  },
  M: {
    key: 'answer_panel_m', size: [142, 80],
    box: { x: 31, y: 21, w: 80, h: 35 },
    font: { max: 24, min: 15 }
  },
  L: {
    key: 'answer_panel_l', size: [170, 80],
    box: { x: 31, y: 22, w: 108, h: 34 },
    font: { max: 24, min: 15 }
  },
  XL: {
    key: 'answer_panel_xl', size: [300, 97],
    box: { x: 31, y: 30, w: 222, h: 41 },
    font: { max: 19, min: 15 }
  }
};

/** Escalation order used when measuring which panel a text needs. */
export const FORMAT_ORDER = ['S', 'M', 'L', 'XL'];

/** Badge (A/B/C circular letter medallion) geometry per format. */
export function badgeSpec(formatName) {
  // The badge rides the top-left frame corner; its radius grows a little on
  // the big panel so it stays legible at gameplay distance.
  return formatName === 'XL'
    ? { radius: 13, offset: 17, fontSize: 18 }
    : { radius: 12, offset: 16, fontSize: 16 };
}

/* ------------------------------------------------------------------ */
/* Pure helpers (Node-safe)                                            */
/* ------------------------------------------------------------------ */

export function formatByName(name) {
  return PANEL_FORMATS[name] || PANEL_FORMATS.L;
}

/** Panel-local writing box centered on the panel origin. */
export function centeredBox(formatName) {
  const f = formatByName(formatName);
  const { size, box } = f;
  return {
    x0: box.x - size[0] / 2,
    x1: box.x + box.w - size[0] / 2,
    y0: box.y - size[1] / 2,
    y1: box.y + box.h - size[1] / 2
  };
}

/**
 * Y center of a panel whose BOTTOM rests on the slot surface.
 * Level layouts bake slot y = surfaceTop − 40 (the historical 80px-plaque
 * center); this generalizes to any panel height without touching level data:
 *   bottom = slotY + 40   →   centerY = slotY + 40 − height/2
 */
export function panelCenterYForSlot(slotY, formatName) {
  return slotY + 40 - formatByName(formatName).size[1] / 2;
}

/* ------------------------------------------------------------------ */
/* Text measurement (Phaser)                                           */
/* ------------------------------------------------------------------ */

const measureStyle = (fontSize) => ({
  fontFamily: TARGETS.TEXT.FONT,
  fontSize: `${fontSize}px`,
  fontStyle: 'bold',
  color: TARGETS.TEXT.COLOR,
  align: 'center',
  wordWrap: { width: 4096, useAdvancedWrap: true } // width set per call
});

/**
 * Measure `text` wrapped to `maxWidth` at `fontSize` with the real canvas
 * metrics Phaser uses (Arial bold). Returns { width, height } of the wrapped
 * block. The scratch Text is cached on the scene and reused.
 */
export function measureWrapped(scene, text, fontSize, maxWidth) {
  const scratch = ensureScratch(scene);
  scratch.setStyle({ ...measureStyle(fontSize), wordWrap: { width: maxWidth, useAdvancedWrap: true } });
  scratch.setText(text);
  return { width: scratch.width, height: scratch.height };
}

function ensureScratch(scene) {
  if (!scene.__wbPanelScratch || !scene.__wbPanelScratch.active) {
    scene.__wbPanelScratch = scene.add.text(0, 0, '', measureStyle(16)).setVisible(false);
    scene.events.once('shutdown', () => {
      if (scene.__wbPanelScratch) scene.__wbPanelScratch.destroy();
      scene.__wbPanelScratch = null;
    });
  }
  return scene.__wbPanelScratch;
}

/**
 * Largest font size in [min..max] whose wrapped block fits the box, or null.
 * Integer steps downward — one font px at a time near the limit.
 */
export function fitFontSize(scene, text, box, { max, min }) {
  for (let size = max; size >= min; size--) {
    const m = measureWrapped(scene, text, size, box.w);
    if (m.width <= box.w && m.height <= box.h) return size;
  }
  return null;
}

/**
 * Smallest panel format that holds `text` at a readable size.
 * Returns { format, fontSize } (fontSize null when even XL cannot fit —
 * callers fall back to XL at its min size with the legacy width clamp).
 */
export function formatForText(scene, text) {
  for (const name of FORMAT_ORDER) {
    const f = PANEL_FORMATS[name];
    const size = fitFontSize(scene, text, f.box, f.font);
    if (size !== null) return { format: name, fontSize: size };
  }
  const xl = PANEL_FORMATS.XL;
  return { format: 'XL', fontSize: null };
}

/**
 * Plan all panels of ONE question: shared format + shared font size so the
 * three answers are visually identical apart from their ink.
 *
 * @param {Phaser.Scene} scene
 * @param {{text:string}[]} choices  the question's answer choices
 * @returns {{format:string, font:number, minFont:number, entries:{
 *   format:string, fontSize:number, clamped:boolean }[]}}
 */
export function planQuestion(scene, choices) {
  const needs = choices.map((c) => formatForText(scene, c.text));
  let format = 'S';
  for (const n of needs) if (FORMAT_ORDER.indexOf(n.format) > FORMAT_ORDER.indexOf(format)) format = n.format;

  const f = PANEL_FORMATS[format];
  // Shared font = the smallest fit among the choices at the shared format
  // (every answer renders at the same size; long text sets the pace).
  let font = f.font.max;
  let minFont = f.font.max;
  const entries = needs.map((n, i) => {
    const fit = fitFontSize(scene, choices[i].text, f.box, f.font);
    const fontSize = fit ?? f.font.min;
    const clamped = fit === null;
    minFont = Math.min(minFont, fontSize);
    return { format, fontSize, clamped };
  });
  font = minFont;
  return { format, font, minFont, entries };
}

/* ------------------------------------------------------------------ */
/* Visual construction                                                 */
/* ------------------------------------------------------------------ */

/**
 * Paint one answer panel's label layer (badge + text), positioned for a
 * panel centered at the parent body's origin. Returns the created game
 * objects (caller adds them to a container synced with the physics body).
 *
 * @param {Phaser.Scene} scene
 * @param {{text:string, label:string}} meta  answer text + A/B/C label
 * @param {string} formatName
 * @param {number} fontSize  shared question font size (>= format min)
 */
export function buildVisual(scene, meta, formatName, fontSize) {
  const T = TARGETS.TEXT;
  const f = formatByName(formatName);
  const { size } = f;
  const spec = badgeSpec(formatName);

  const badge = scene.add.circle(
    -size[0] / 2 + spec.offset, -size[1] / 2 + spec.offset,
    spec.radius, T.BADGE_FILL
  ).setStrokeStyle(2.5, 0x5d3a17);
  const badgeText = scene.add.text(badge.x, badge.y, meta.label, {
    fontFamily: T.FONT, fontSize: `${spec.fontSize}px`, fontStyle: 'bold', color: T.BADGE_TEXT
  }).setOrigin(0.5);

  const box = centeredBox(formatName);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const wordText = scene.add.text(cx, cy, meta.text, {
    fontFamily: T.FONT, fontSize: `${fontSize}px`, fontStyle: 'bold', color: T.COLOR,
    align: 'center',
    wordWrap: { width: box.x1 - box.x0, useAdvancedWrap: true }
  }).setOrigin(0.5);

  // Safety net (unbreakable token wider than the box at min size): shrink
  // horizontally only — never stretch, never clip.
  const maxW = box.x1 - box.x0;
  const maxH = box.y1 - box.y0;
  if (wordText.width > maxW) wordText.setScale(Math.min(1, maxW / wordText.width));
  if (wordText.height * wordText.scaleY > maxH) {
    wordText.setScale(Math.min(wordText.scaleX, maxH / wordText.height));
  }

  return { badge, badgeText, wordText };
}
