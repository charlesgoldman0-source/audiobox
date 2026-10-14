// Proves the FLAC to AIFF conversions are bit-for-bit lossless on the actual FFmpeg
// the app uses: decode the source FLAC and the produced AIFF both to raw s32le PCM
// and compare SHA256. Run after an --apply. Run: node test/verify-lossless.mjs

import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { detectFfmpeg } from '../src/ffmpeg.js';
import { planFile } from '../src/engine/process.js';
import { isAudioFile } from '../src/engine/naming.js';
import { defaultConfig } from '../src/engine/config.js';

const here = dirname(fileURLToPath(import.meta.url));
const inDir = join(here, 'fixtures', 'in');
const outDir = join(inDir, 'processed');
const { ffmpeg } = detectFfmpeg();

function pcmHash(file) {
  const buf = execFileSync(ffmpeg, [
    '-v', 'error', '-i', file, '-map', '0:a:0', '-f', 's32le', '-c:a', 'pcm_s32le', 'pipe:1',
  ], { maxBuffer: 1024 * 1024 * 256 });
  return createHash('sha256').update(buf).digest('hex');
}

let pass = 0;
let fail = 0;

// Mirror the engine's collision suffixing so duplicates map to their real output.
const claimed = new Set();
function reservedName(desired, ext) {
  const stem = desired.slice(0, desired.length - ext.length);
  let candidate = desired;
  let n = 2;
  while (claimed.has(candidate.toLowerCase())) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  claimed.add(candidate.toLowerCase());
  return candidate;
}

for (const name of readdirSync(inDir)) {
  if (!isAudioFile(name)) continue;
  const src = join(inDir, name);
  const plan = await planFile(src, defaultConfig);
  if (plan.resolved.status === 'flagged') {
    console.log(`  skip  ${name} (flagged)`);
    continue;
  }
  const output = join(outDir, reservedName(plan.newName, plan.outExt));
  const a = pcmHash(src);
  const b = pcmHash(output);
  if (a === b) { pass += 1; console.log(`  ok    ${name} -> ${plan.newName}  (PCM identical)`); }
  else { fail += 1; console.log(`  FAIL  ${name}\n        src ${a}\n        out ${b}`); }
}

console.log(`\n${pass} lossless, ${fail} altered`);
process.exit(fail === 0 ? 0 : 1);
