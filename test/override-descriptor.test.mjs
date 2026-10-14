// Proves the version descriptor comes from the downloaded file, not from Spotify.
// Spotify has "Poverty Point (Mixed)". If you download the plain version it stays
// "Poverty Point"; if you download the "(Mixed)" version it keeps "(Mixed)".
// Run: node override-descriptor.test.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { detectFfmpeg } from '../src/ffmpeg.js';
import { applyFile } from '../src/engine/process.js';
import { defaultConfig } from '../src/engine/config.js';

const { ffmpeg } = detectFfmpeg();
const dir = join(tmpdir(), 'abx-desc');
const inc = join(dir, 'in');
const out = join(dir, 'out');
rmSync(dir, { recursive: true, force: true });
mkdirSync(inc, { recursive: true });
mkdirSync(out, { recursive: true });

function makeFlac(name) {
  const p = join(inc, name);
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=200:duration=1',
    '-ac', '2', '-ar', '44100', '-c:a', 'flac', '-map_metadata', '-1', p]);
  return p;
}

const spotifyOverride = { artist: 'Ludowick', title: 'Poverty Point (Mixed)' };
let pass = 0;
let fail = 0;
function check(label, got, want) {
  if (got === want) { pass += 1; console.log(`  ok   ${label}: ${got}`); }
  else { fail += 1; console.log(`  FAIL ${label}\n        got:  ${got}\n        want: ${want}`); }
}

const plain = await applyFile(makeFlac('Ludowick - Poverty Point.flac'), defaultConfig, out, () => {}, new Set(), spotifyOverride);
check('plain download keeps no descriptor', plain.newName, 'Ludowick - Poverty Point.aiff');

const mixed = await applyFile(makeFlac('Ludowick - Poverty Point (Mixed).flac'), defaultConfig, out, () => {}, new Set(), spotifyOverride);
check('mixed download keeps (Mixed)', mixed.newName, 'Ludowick - Poverty Point (Mixed).aiff');

// A remix file with a messy name still keeps the clean Spotify descriptor, because the
// file name contains the remixer (Kanedo).
const remixOverride = { artist: 'Riccicomoto, Bryant Goodman', title: 'Robot Man (Kanedo Remix)' };
const remix = await applyFile(makeFlac('05-Riccicomoto - Robot Man (feat Bryant Goodman - Kanedo remix).flac'), defaultConfig, out, () => {}, new Set(), remixOverride);
check('messy remix keeps clean descriptor', remix.newName, 'Riccicomoto, Bryant Goodman - Robot Man (Kanedo Remix).aiff');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
