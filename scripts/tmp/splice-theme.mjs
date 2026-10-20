import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../generate-audio.mjs', import.meta.url);
const TMP = new URL('./new-theme-section.js', import.meta.url);

let s = readFileSync(FILE, 'utf8');
const tmp = readFileSync(TMP, 'utf8');

// 1. delete buildAmbience (from its `function` line to the Music header block)
const ambIdx = s.indexOf('function buildAmbience() {');
if (ambIdx < 0) throw new Error('buildAmbience marker not found');
const musicHdrIdx = s.indexOf('/* Music — tiny sequencer');
if (musicHdrIdx < 0) throw new Error('Music header marker not found');
const musicHdrStart = s.lastIndexOf('/* ------', musicHdrIdx);
s = s.slice(0, ambIdx) + s.slice(musicHdrStart);

// 2. retitle the kept sequencer header (renderNotes stays — the theme uses it)
s = s.replace('/* Music — tiny sequencer', '/* Music — instrument voices + the cartoon theme');

// 3. replace menu/gameplay/victory builders + old MAIN/ALL with the new theme
const menuIdx = s.indexOf('/** Build the MENU theme');
if (menuIdx < 0) throw new Error('MENU theme marker not found');
const qcIdx = s.indexOf('/* Write + QC');
if (qcIdx < 0) throw new Error('Write+QC marker not found');
const qcStart = s.lastIndexOf('/* ------', qcIdx);

// temp file: drop its own leading header block (the kept file already has one)
const tmpBody = tmp.slice(tmp.indexOf('/** Marimba note:'));

s = s.slice(0, menuIdx) + tmpBody.trimEnd() + '\n\n' + s.slice(qcStart);

writeFileSync(FILE, s);
console.log('spliced OK');
