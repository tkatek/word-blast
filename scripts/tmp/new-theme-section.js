/* ------------------------------------------------------------------ */
/* Music — cartoon puzzle-adventure theme                               */
/* ------------------------------------------------------------------ */

/** Marimba note: wooden mallet partials (1 : ~3.9 : ~9.2), quick decay,
 *  soft knap transient. Register-tuned decay (higher notes die faster). */
function marimba(m, dur, gain = 1) {
  const f = midi(m);
  const len = Math.min(n(dur + 0.5), n(1.1));
  const out = zeros(len / SR);
  const tau = Math.max(3.6, 5.4 - (m - 72) * 0.045);
  mix(out, 0, damped({ dur: len / SR, freq: f, decay: tau, gain: 1 }), gain);
  mix(out, 0, damped({ dur: (len / SR) * 0.6, freq: f * 3.93, decay: tau * 2.3, gain: 0.27 }), gain);
  mix(out, 0, damped({ dur: (len / SR) * 0.35, freq: f * 9.2, decay: tau * 4.0, gain: 0.09 }), gain);
  mix(out, 0, bp(noiseBuf(0.012), Math.min(2600, f * 4), 1.4), 0.13 * gain); // knap
  return out;
}

/** Xylophone: brighter, shorter, harder mallet (3.0 partial prominent). */
function xylophone(m, dur, gain = 1) {
  const f = midi(m);
  const len = Math.min(n(dur + 0.28), n(0.8));
  const out = zeros(len / SR);
  const tau = Math.max(5.5, 8.5 - (m - 72) * 0.05);
  mix(out, 0, damped({ dur: len / SR, freq: f, decay: tau, gain: 1 }), gain);
  mix(out, 0, damped({ dur: (len / SR) * 0.5, freq: f * 3.0, decay: tau * 2.6, gain: 0.38 }), gain);
  mix(out, 0, damped({ dur: (len / SR) * 0.3, freq: f * 6.3, decay: tau * 4.5, gain: 0.12 }), gain);
  mix(out, 0, bp(noiseBuf(0.01), Math.min(4200, f * 6), 1.6), 0.16 * gain);
  return out;
}

/** Glockenspiel: pure long ring + shimmer partial, soft mallet (no click). */
function glock(m, dur, gain = 1) {
  const f = midi(m);
  const len = Math.min(n(dur + 1.0), n(1.9));
  const out = zeros(len / SR);
  mix(out, 0, damped({ dur: len / SR, freq: f, decay: 2.6, gain: 1, attack: 0.004 }), gain);
  mix(out, 0, damped({ dur: (len / SR) * 0.5, freq: f * 2.76, decay: 5.5, gain: 0.16 }), gain);
  return out;
}

/** Pizzicato string stab: two detuned triangles, fast exponential
 *  pull-off — the bouncy cartoon-orchestra "pah". */
function pizz(m, gain = 1) {
  const f = midi(m);
  const out = zeros(0.34);
  const a = tone({ dur: 0.34, freq: f, wave: 'tri', gain: 0.9, attack: 0.003, release: 0.28 });
  const b = tone({ dur: 0.34, freq: f * 1.006, wave: 'tri', gain: 0.7, attack: 0.003, release: 0.28 });
  for (let i = 0; i < out.length; i++) {
    out[i] = (a[i] + b[i]) * Math.exp(-(i / SR) * 17);
  }
  const v = lp(out, 2100);
  fadeEdges(v, 1, 60);
  for (let i = 0; i < v.length; i++) v[i] *= gain;
  return v;
}

/** Bouncy pizzicato bass: sine body + octave grain + finger thump. */
function bassPizz(m, gain = 1) {
  const f = midi(m);
  const out = zeros(0.5);
  mix(out, 0, damped({ dur: 0.5, freq: f, decay: 6.5, gain: 1 }), gain);
  mix(out, 0, damped({ dur: 0.3, freq: f * 2.02, decay: 13, gain: 0.3 }), gain);
  mix(out, 0, lp(noiseBuf(0.03), 300), 0.22 * gain);
  const v = lp(out, 520);
  fadeEdges(v, 1, 90);
  return v;
}

/** WORD BLAST THEME — playful cartoon puzzle-adventure game loop.
 *
 *  C major, 124 BPM, 4/4, STRAIGHT eighths (no swing), 32 bars ≈ 62 s,
 *  form A / A' / B / A'':
 *    A  (bars 1-8)  marimba melody, pizzicato bass, light shaker
 *    A' (9-16)      theme + xylophone octave double, woodblock backbeat
 *    B  (17-24)     glockenspiel/xylophone call-and-response bridge
 *    A''(25-32)     full ensemble; the final bar cadences onto a rising
 *                   pickup (G5-A5-B5) that lands back on the opening E5,
 *                   so the loop point is a musical continuation.
 *
 *  Idiom: light cartoon orchestral — bouncy pizzicato strings, mallet
 *  melodies, soft percussion, whimsical adventure harmony. Deliberately
 *  NOT jazz: no swung eighths, no 7th-chord comping, no lounge lead.
 *  One self-terminating loop file; the runtime plays it seamlessly. */
function buildCartoonTheme() {
  const bpm = 124;
  const beat = 60 / bpm;
  const e8 = beat / 2;
  const bar = beat * 4;
  const bars = 32;
  const loopSec = bars * bar;
  const out = zeros(loopSec + 1.4); // reverb-tail room (folded back by loopify)

  // Chord palette — one chord per bar: [bassRoot, pizz stab voicing]
  const CH = {
    C: { bass: 36, stab: [60, 64, 67] },
    F: { bass: 41, stab: [57, 60, 65] },
    G: { bass: 43, stab: [55, 59, 62] },
    Am: { bass: 45, stab: [57, 60, 64] },
    Dm: { bass: 38, stab: [62, 65, 69] }
  };
  const chart = [
    ...'C F C G F C G C'.split(' '),      // A
    ...'C F C G F G C C'.split(' '),      // A'
    ...'Am F C G Am F Dm G'.split(' '),   // B
    ...'C F C G F G C C'.split(' ')       // A''
  ];

  // Theme melody [midi, eighth (0..63 in-section), length in eighths].
  // Question-rise bars 1-4, answer-settle bars 5-8.
  const THEME = [
    [76, 0, 2], [79, 2, 2], [81, 4, 1], [79, 5, 1], [76, 6, 2],
    [77, 8, 3], [76, 11, 1], [74, 12, 2], [72, 14, 2],
    [69, 16, 2], [72, 18, 2], [76, 20, 2], [79, 22, 2],
    [81, 24, 2], [79, 26, 1], [76, 27, 1], [74, 28, 4],
    [72, 32, 2], [74, 34, 2], [77, 36, 2], [81, 38, 2],
    [79, 40, 3], [76, 43, 1], [72, 44, 4],
    [74, 48, 1], [76, 49, 1], [77, 50, 1], [79, 51, 1], [81, 52, 2], [79, 54, 2],
    [76, 56, 2], [74, 58, 2], [72, 60, 4]
  ];
  // Final-bar variant (used in A''): same cadence start, then the G5-A5-B5
  // rising pickup that pulls the seam back to the opening E5.
  const THEME_PICKUP_END = [
    [76, 56, 2], [74, 58, 2], [79, 60, 1], [81, 61, 1], [83, 62, 2]
  ];

  // Bridge — glockenspiel calls (odd bars) answered by xylophone (even).
  const BRIDGE_G = [
    [76, 0, 2], [81, 2, 2], [84, 4, 4],
    [79, 16, 2], [76, 18, 2], [84, 20, 4],
    [81, 32, 2], [76, 34, 2], [84, 36, 2], [88, 38, 2],
    [83, 56, 2], [86, 58, 2], [79, 60, 4]
  ];
  const BRIDGE_X = [
    [72, 8, 2], [77, 10, 2], [81, 12, 4],
    [71, 24, 2], [74, 26, 2], [79, 28, 4],
    [77, 40, 2], [81, 42, 2], [84, 44, 4],
    [71, 56, 2], [74, 58, 2], [67, 60, 4]
  ];
  const BRIDGE_BOTH = [           // bar 7 of B: both mallets climb together
    [74, 48, 2], [77, 50, 2], [81, 52, 2], [86, 54, 2]
  ];

  // Glockenspiel sparkle fills (eighth index within the section)
  const FILL_A_PRIME = [
    [84, 56, 1], [88, 57, 1], [91, 58, 2],
    [79, 60, 1], [84, 61, 1], [88, 62, 2]
  ];
  const FILL_A_DOUBLE = [
    [84, 40, 1], [88, 41, 1], [91, 42, 2],
    [88, 44, 1], [84, 45, 1], [79, 46, 2]
  ];

  const secT = (sec, eighth) => sec * 8 * bar + eighth * e8;

  // ---- A (bars 1-8): marimba theme, single offbeat stab, light shaker ---
  renderNotes(out, THEME.map(([m, e, l]) => [m, secT(0, e), l * e8, 1]),
    (m, d) => marimba(m, d, 0.46));
  for (let b = 0; b < 8; b++) {
    const ch = CH[chart[b]];
    mix(out, secT(0, b * 8), bassPizz(ch.bass, 0.4));
    mix(out, secT(0, b * 8 + 4), bassPizz(ch.bass + 7, 0.3));
    for (const m of ch.stab) mix(out, secT(0, b * 8 + 3), pizz(m, 0.13));
  }

  // ---- A' (bars 9-16): theme doubled by xylophone, woodblock backbeat ---
  const themeAP = THEME.map(([m, e, l]) => [m, e, l]);
  renderNotes(out, themeAP.map(([m, e, l]) => [m, secT(1, e), l * e8, 1]),
    (m, d) => marimba(m, d, 0.48));
  renderNotes(out, themeAP.map(([m, e, l]) => [m + 12, secT(1, e), l * e8, 1]),
    (m, d) => xylophone(m, d, 0.17));
  renderNotes(out, FILL_A_PRIME.map(([m, e, l]) => [m, secT(1, e), l * e8, 1]),
    (m, d) => glock(m, d, 0.11));
  for (let b = 0; b < 8; b++) {
    const ch = CH[chart[8 + b]];
    mix(out, secT(1, b * 8), bassPizz(ch.bass, 0.42));
    mix(out, secT(1, b * 8 + 4), bassPizz(ch.bass + 7, 0.32));
    for (const m of ch.stab) {
      mix(out, secT(1, b * 8 + 3), pizz(m, 0.15));
      mix(out, secT(1, b * 8 + 7), pizz(m, 0.13));
    }
    // woodblock on beats 2 & 4
    mix(out, secT(1, b * 8 + 2), damped({ dur: 0.07, freq: 1150, decay: 40, gain: 0.5 }), 0.24);
    mix(out, secT(1, b * 8 + 6), damped({ dur: 0.07, freq: 1080, decay: 40, gain: 0.5 }), 0.2);
  }

  // ---- B (bars 17-24): glock/xylo call-and-response over Am-F-C-G ------
  renderNotes(out, BRIDGE_G.map(([m, e, l]) => [m, secT(2, e), l * e8, 1]),
    (m, d) => glock(m, d, 0.27));
  renderNotes(out, BRIDGE_X.map(([m, e, l]) => [m, secT(2, e), l * e8, 1]),
    (m, d) => xylophone(m, d, 0.3));
  renderNotes(out, BRIDGE_BOTH.map(([m, e, l]) => [m, secT(2, e), l * e8, 1]),
    (m, d) => marimba(m, d, 0.4));
  for (let b = 0; b < 8; b++) {
    const ch = CH[chart[16 + b]];
    mix(out, secT(2, b * 8), bassPizz(ch.bass, 0.44));
    mix(out, secT(2, b * 8 + 4), bassPizz(ch.bass + 7, 0.34));
    for (const m of ch.stab) {
      mix(out, secT(2, b * 8 + 3), pizz(m, 0.15));
      mix(out, secT(2, b * 8 + 7), pizz(m, 0.13));
    }
    mix(out, secT(2, b * 8 + 2), damped({ dur: 0.07, freq: 1150, decay: 40, gain: 0.5 }), 0.24);
    mix(out, secT(2, b * 8 + 6), damped({ dur: 0.07, freq: 1080, decay: 40, gain: 0.5 }), 0.2);
    // soft thud on the downbeat keeps the bridge grounded
    mix(out, secT(2, b * 8), damped({ dur: 0.3, freq: 72, decay: 7, gain: 0.5 }), 0.5);
  }

  // ---- A'' (bars 25-32): full band + pickup ending into the loop seam --
  const themeAD = THEME.slice(0, 30).concat(THEME_PICKUP_END);
  renderNotes(out, themeAD.map(([m, e, l]) => [m, secT(3, e), l * e8, 1]),
    (m, d) => marimba(m, d, 0.5));
  renderNotes(out, themeAD.map(([m, e, l]) => [m + 12, secT(3, e), l * e8, 1]),
    (m, d) => xylophone(m, d, 0.19));
  renderNotes(out, FILL_A_DOUBLE.map(([m, e, l]) => [m, secT(3, e), l * e8, 1]),
    (m, d) => glock(m, d, 0.12));
  for (let b = 0; b < 8; b++) {
    const ch = CH[chart[24 + b]];
    mix(out, secT(3, b * 8), bassPizz(ch.bass, 0.46));
    mix(out, secT(3, b * 8 + 4), bassPizz(ch.bass + 7, 0.35));
    for (const m of ch.stab) {
      mix(out, secT(3, b * 8 + 3), pizz(m, 0.16));
      mix(out, secT(3, b * 8 + 7), pizz(m, 0.14));
    }
    mix(out, secT(3, b * 8 + 2), damped({ dur: 0.07, freq: 1150, decay: 40, gain: 0.5 }), 0.26);
    mix(out, secT(3, b * 8 + 6), damped({ dur: 0.07, freq: 1080, decay: 40, gain: 0.5 }), 0.22);
    mix(out, secT(3, b * 8), damped({ dur: 0.3, freq: 72, decay: 7, gain: 0.5 }), 0.55);
    // whispered brush on the "and" of 2 and 4 — air, not a drum kit
    mix(out, secT(3, b * 8 + 3), bp(noiseBuf(0.03), 2000, 0.6), 0.05);
    mix(out, secT(3, b * 8 + 7), bp(noiseBuf(0.03), 2000, 0.6), 0.045);
  }

  // ---- shaker — straight eighths everywhere, offbeat accents ----------
  for (let e = 0; e < bars * 8; e++) {
    const sec = Math.floor(e / 64);
    const acc = e % 2 === 1;
    const g = (sec === 0 ? 0.085 : 0.105) * (acc ? 1.65 : 1);
    mix(out, e * e8, hp(noiseBuf(0.045), 6500, 0.7), g);
  }

  // ---- glue + seamless loop -------------------------------------------
  const rev = reverb(out, 0.11);
  const loopBuf = rev.subarray(0, n(loopSec));
  loopify(loopBuf, 420);        // fold the reverb tail into the loop head
  softclip(loopBuf, 1.15);
  rmsTo(loopBuf, -19.5, -3);
  fadeEdges(loopBuf, 3, 3);
  return [['music/word-blast-theme.wav', loopBuf, true]];
}

/* ================================================================== */
/* MAIN                                                                */
/* ================================================================== */

const ALL = [
  ...buildSlingshot(),
  ...buildWood(),
  ...buildGlass(),
  ...buildStone(),
  ...buildAbilities(),
  ...buildBirds(),
  ...buildUi(),
  ...buildCartoonTheme()
];
