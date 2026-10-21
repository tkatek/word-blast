/**
 * Data validators for questions and levels.
 * Pure module — runs at boot AND in the Node test suite, so a broken data
 * file can never silently reach players.
 */
import { SAVE, CEFR_ORDER, WORLD, MATERIALS, PROJECTILE_TYPES, SLINGSHOT, BUDGETS } from '../config.js';
import { TOWER_ASSETS } from '../data/tower-assets.js';

const TOWER_ASSET_KEYS = Object.keys(TOWER_ASSETS);

const cefrRank = (cefr) => {
  const i = CEFR_ORDER.indexOf(cefr);
  return i === -1 ? Infinity : i;
};

/**
 * Validate the full question bank.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateQuestions(questions) {
  const errors = [];
  const warnings = [];

  if (!Array.isArray(questions)) {
    return { ok: false, errors: ['questions.json: root must be an array'], warnings };
  }

  if (questions.length !== SAVE.TOTAL_QUESTIONS) {
    errors.push(`questions: expected exactly ${SAVE.TOTAL_QUESTIONS} questions, found ${questions.length}`);
  }

  const ids = new Set();
  const texts = new Set();

  for (const q of questions) {
    const where = q && q.id ? `question ${q.id}` : 'question (missing id)';
    if (!q || typeof q !== 'object') {
      errors.push(`${where}: not an object`);
      continue;
    }
    if (!q.id || typeof q.id !== 'string') {
      errors.push(`${where}: missing string id`);
      continue;
    }
    if (ids.has(q.id)) errors.push(`${where}: duplicate id`);
    ids.add(q.id);

    if (!Number.isInteger(q.levelId) || q.levelId < 1 || q.levelId > SAVE.MAX_LEVELS) {
      errors.push(`${where}: levelId ${q.levelId} out of range 1..${SAVE.MAX_LEVELS}`);
    }
    if (cefrRank(q.cefr) === Infinity) {
      errors.push(`${where}: unknown CEFR level "${q.cefr}" (allowed: ${CEFR_ORDER.join(', ')})`);
    }
    if (!q.category || typeof q.category !== 'string') {
      errors.push(`${where}: missing category`);
    }
    if (!q.text || typeof q.text !== 'string' || q.text.trim().length < 5) {
      errors.push(`${where}: missing or too-short question text`);
    } else if (texts.has(q.text.trim().toLowerCase())) {
      errors.push(`${where}: duplicate question text`);
    }
    texts.add(q.text.trim().toLowerCase());

    if (!Array.isArray(q.choices) || q.choices.length !== SAVE.CHOICES_PER_QUESTION) {
      errors.push(`${where}: expected exactly ${SAVE.CHOICES_PER_QUESTION} choices`);
      continue;
    }
    const choiceIds = new Set();
    for (const c of q.choices) {
      if (!c || typeof c.id !== 'string' || !c.text || typeof c.text !== 'string') {
        errors.push(`${where}: malformed choice entry`);
        continue;
      }
      if (choiceIds.has(c.id)) errors.push(`${where}: duplicate choice id "${c.id}"`);
      choiceIds.add(c.id);
    }
    if (choiceIds.size !== q.choices.length) continue;

    const correct = q.choices.find((c) => c && c.id === q.correctAnswerId);
    if (!correct) {
      errors.push(`${where}: correctAnswerId "${q.correctAnswerId}" does not match any choice id`);
    }
    if (q.correctAnswerId !== undefined && q.choices.filter((c) => c && c.id === q.correctAnswerId).length > 1) {
      errors.push(`${where}: more than one choice matches correctAnswerId`);
    }
    if (!q.explanation || typeof q.explanation !== 'string' || q.explanation.trim().length < 10) {
      errors.push(`${where}: missing or too-short explanation`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validate the full level set, cross-referenced against the question bank.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}}
 */
export function validateLevels(levelsData, questions) {
  const errors = [];
  const warnings = [];

  if (!levelsData || !Array.isArray(levelsData.levels)) {
    return { ok: false, errors: ['levels.json: root object with "levels" array required'], warnings };
  }
  const levels = levelsData.levels;
  if (levels.length !== SAVE.MAX_LEVELS) {
    errors.push(`levels: expected exactly ${SAVE.MAX_LEVELS} levels, found ${levels.length}`);
  }

  const byId = new Map((questions || []).map((q) => [q.id, q]));
  const seenQuestions = new Set();
  const numericIds = [];

  levels.forEach((lvl, idx) => {
    const where = lvl && lvl.id != null ? `level ${lvl.id}` : `level #${idx + 1} (missing id)`;
    if (!lvl || typeof lvl !== 'object') {
      errors.push(`${where}: not an object`);
      return;
    }
    if (!Number.isInteger(lvl.id)) {
      errors.push(`${where}: id must be an integer`);
    } else {
      numericIds.push(lvl.id);
    }
    if (!lvl.name || typeof lvl.name !== 'string') {
      errors.push(`${where}: missing name`);
    }
    if (!Array.isArray(lvl.questions) || lvl.questions.length !== SAVE.QUESTIONS_PER_LEVEL) {
      errors.push(`${where}: expected exactly ${SAVE.QUESTIONS_PER_LEVEL} questions`);
    } else {
      lvl.questions.forEach((entry) => {
        const q = byId.get(entry.questionId);
        if (!q) {
          errors.push(`${where}: unknown questionId "${entry.questionId}"`);
          return;
        }
        if (q.levelId !== lvl.id) {
          errors.push(`${where}: question ${q.id} belongs to level ${q.levelId}, not ${lvl.id}`);
        }
        if (seenQuestions.has(q.id)) {
          errors.push(`${where}: question ${q.id} is used more than once across levels`);
        }
        seenQuestions.add(q.id);
        validateLayout(lvl, entry, where, errors, warnings);
      });
    }
    if (!Number.isInteger(lvl.shotsPerQuestion) || lvl.shotsPerQuestion < 1 || lvl.shotsPerQuestion > 6) {
      errors.push(`${where}: shotsPerQuestion must be an integer 1..6`);
    }
    if (!Array.isArray(lvl.projectiles) || lvl.projectiles.length === 0) {
      errors.push(`${where}: at least one projectile type required`);
    } else {
      for (const p of lvl.projectiles) {
        if (!PROJECTILE_TYPES[p]) errors.push(`${where}: unknown projectile type "${p}"`);
      }
      if (lvl.id > 1) {
        const prev = levels[idx - 1];
        if (prev && Array.isArray(prev.projectiles)) {
          for (const p of prev.projectiles) {
            if (!lvl.projectiles.includes(p)) {
              warnings.push(`${where}: projectile "${p}" available earlier but missing here (unusual)`);
            }
          }
        }
      }
      // Fix #19 — bird ammunition must keep every question completable:
<<<<<<< Updated upstream
      // keys ⊆ roster, non-negative integers, total >= shotsPerQuestion.
=======
      // keys ⊆ roster, positive integers, total >= shotsPerQuestion.
>>>>>>> Stashed changes
      // (levels without "birdAmmo" inherit BIRD_AMMO.DEFAULTS at runtime,
      // which satisfies the same rule for the shipped rosters.)
      if (lvl.birdAmmo != null) {
        if (typeof lvl.birdAmmo !== 'object' || Array.isArray(lvl.birdAmmo)) {
          errors.push(`${where}: birdAmmo must be an object of {type: count}`);
        } else {
          let total = 0;
          for (const [k, n] of Object.entries(lvl.birdAmmo)) {
            if (!lvl.projectiles.includes(k)) {
              errors.push(`${where}: birdAmmo key "${k}" is not in the level roster`);
            } else if (!Number.isInteger(n) || n < 0) {
              errors.push(`${where}: birdAmmo["${k}"] must be a non-negative integer`);
            } else {
              total += n;
            }
          }
          const shots = Number.isInteger(lvl.shotsPerQuestion) ? lvl.shotsPerQuestion : 0;
          if (total < shots) {
            errors.push(`${where}: birdAmmo total ${total} < shotsPerQuestion ${shots} (a question could become unwinnable)`);
          }
        }
      }
    }
    const st = lvl.starThresholds;
    if (!st || !Number.isInteger(st.two) || !Number.isInteger(st.three) || st.two <= 0 || st.three <= st.two) {
      errors.push(`${where}: starThresholds needs integers two>0 and three>two`);
    }
  });

  // exact 1..N ids, no duplicates
  const uniqueIds = new Set(numericIds);
  if (uniqueIds.size !== numericIds.length) errors.push('levels: duplicate level ids');
  for (let i = 1; i <= SAVE.MAX_LEVELS; i++) {
    if (!uniqueIds.has(i)) errors.push(`levels: missing level id ${i}`);
  }

  // every question used exactly once
  const totalQ = questions ? questions.length : 0;
  if (seenQuestions.size !== totalQ) {
    const unused = [...new Set([...byId.keys()].filter((id) => !seenQuestions.has(id)))];
    if (unused.length) errors.push(`levels: questions never referenced: ${unused.join(', ')}`);
  }

  // CEFR progression across levels (non-decreasing)
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    const qA = (a.questions || []).map((e) => byId.get(e.questionId)).filter(Boolean);
    const qB = (b.questions || []).map((e) => byId.get(e.questionId)).filter(Boolean);
    const rankA = Math.max(...qA.map((q) => cefrRank(q.cefr)), 0);
    const rankB = Math.min(...qB.map((q) => cefrRank(q.cefr)), Infinity);
    if (rankB < rankA) {
      warnings.push(`level ${b.id}: CEFR difficulty (${rankB}) lower than previous level (${rankA})`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateLayout(lvl, entry, where, errors, warnings) {
  const layout = entry.layout;
  if (!layout || typeof layout !== 'object') {
    errors.push(`${where}/${entry.questionId}: missing layout`);
    return;
  }
  const layoutName = `${where}/${entry.questionId}`;

  if (!Array.isArray(layout.targets) || layout.targets.length !== SAVE.CHOICES_PER_QUESTION) {
    errors.push(`${layoutName}: layout needs exactly ${SAVE.CHOICES_PER_QUESTION} targets`);
  } else {
    layout.targets.forEach((t, i) => {
      if (!Number.isFinite(t.x) || !Number.isFinite(t.y)) {
        errors.push(`${layoutName}: target ${i} needs numeric x/y`);
        return;
      }
      if (t.x < 60 || t.x > WORLD.WIDTH - 60) {
        errors.push(`${layoutName}: target ${i} x=${t.x} outside playable band`);
      }
      if (t.y < 60 || t.y > WORLD.GROUND_Y - 20) {
        errors.push(`${layoutName}: target ${i} y=${t.y} outside playable band`);
      }
    });
  }

  // tower pieces: manifest assets, world bounds, tunneling minimum,
  // budget. (Support/no-overlap is proven by scripts/check-towers.mjs and
  // the headless stability battery — here we validate the baked data.)
  if (layout.pieces !== undefined) {
    if (!Array.isArray(layout.pieces)) {
      errors.push(`${layoutName}: pieces must be an array`);
    } else {
      const assets = TOWER_ASSET_KEYS;
      layout.pieces.forEach((p, i) => {
        if (!p || !assets.includes(p.a)) {
          errors.push(`${layoutName}: piece ${i} unknown asset "${p && p.a}"`);
          return;
        }
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
          errors.push(`${layoutName}: piece ${i} needs numeric x/y`);
        }
        if (p.rot !== undefined && (p.rot < -90 || p.rot > 90)) {
          errors.push(`${layoutName}: piece ${i} rotation ${p.rot} out of range ±90`);
        }
      });
      if (layout.pieces.length > BUDGETS.MAX_PIECES) {
        errors.push(`${layoutName}: ${layout.pieces.length} pieces exceeds budget ${BUDGETS.MAX_PIECES}`);
      }
    }
  }
  if (layout.pigs !== undefined && !Array.isArray(layout.pigs)) {
    errors.push(`${layoutName}: pigs must be an array`);
  }
  if (layout.pigs && layout.pigs.length > 8) {
    warnings.push(`${layoutName}: ${layout.pigs.length} pigs (performance watch)`);
  }

  // legacy field kept for compatibility: old layouts may still carry blocks
  if (layout.blocks) {
    if (!Array.isArray(layout.blocks)) {
      errors.push(`${layoutName}: blocks must be an array`);
    }
  }

  if (layout.moving) {
    if (!Array.isArray(layout.moving)) {
      errors.push(`${layoutName}: moving must be an array`);
    } else {
      layout.moving.forEach((m, i) => {
        if (!['x', 'y'].includes(m.axis)) errors.push(`${layoutName}: moving ${i} axis must be "x" or "y"`);
        if (!Number.isFinite(m.range) || m.range <= 0 || m.range > 400) {
          errors.push(`${layoutName}: moving ${i} range out of range 1..400`);
        }
        if (!Number.isFinite(m.speed) || m.speed <= 0 || m.speed > 5) {
          errors.push(`${layoutName}: moving ${i} speed out of range 0..5`);
        }
      });
    }
  }
}
