// Audiobox engine CLI (step one). Point it at a folder.
//   node src/cli/run.js <folder>           dry run: show the plan, change nothing
//   node src/cli/run.js <folder> --apply    write converted, tagged, renamed copies
//                                           into <folder>\processed, sources untouched

import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { detectFfmpeg } from '../ffmpeg.js';
import { planFile, applyFile, sweepTempFiles } from '../engine/process.js';
import { isAudioFile } from '../engine/naming.js';
import { defaultConfig } from '../engine/config.js';

function printResult(r, apply) {
  if (r.resolved.status === 'flagged') {
    console.log(`  [flagged] ${r.name}`);
    console.log(`            reason: ${r.resolved.reason}`);
    return;
  }
  const tag = r.resolved.status === 'parsed' ? 'parsed ' : 'tagged ';
  console.log(`  [${tag}] ${r.newName}`);
  console.log(`            from:   ${r.name}`);
  console.log(`            artist: ${r.resolved.artist}`);
  console.log(`            title:  ${r.resolved.title}`);
  if (r.resolved.status === 'parsed') {
    console.log('            note:   tags were blank, parsed from the filename');
  }
  if (apply && r.renamed) {
    console.log('            note:   a file with that name already existed, saved with a number suffix');
  }
  if (apply && r.conversion) {
    const c = r.conversion;
    const how = c.mode === 'convert'
      ? `converted to AIFF ${c.bits}-bit ${c.sampleRate}Hz (${c.encoder})`
      : 'passed through (audio untouched)';
    console.log(`            audio:  ${how}`);
    const v = r.verification;
    console.log(`            verify: ${v.ok ? 'ok' : 'PROBLEM - ' + v.problems.join('; ')}`
      + (v.tagTypes.length ? ` [${v.tagTypes.join(', ')}]` : ''));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const folder = argv.find((a) => !a.startsWith('--'));

  if (!folder) {
    console.error('Usage: node src/cli/run.js <folder> [--apply]');
    process.exit(2);
  }
  if (!existsSync(folder)) {
    console.error(`Folder not found: ${folder}`);
    process.exit(2);
  }

  try {
    const { version } = detectFfmpeg();
    console.log(version);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const files = readdirSync(folder).filter(isAudioFile).map((f) => join(folder, f));
  if (!files.length) {
    console.log('No audio files found in that folder.');
    return;
  }

  const outDir = join(folder, 'processed');
  if (apply && !existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  if (apply) sweepTempFiles(outDir);

  console.log(`\n${apply ? 'Processing' : 'Preview (dry run, nothing changes)'}: ${files.length} file(s)\n`);

  const claimed = new Set();
  let processed = 0;
  let flagged = 0;
  let problems = 0;

  for (const file of files) {
    try {
      const r = apply
        ? await applyFile(file, defaultConfig, outDir, () => {}, claimed)
        : await planFile(file, defaultConfig);
      printResult(r, apply);
      if (r.resolved.status === 'flagged') flagged += 1;
      else if (apply) {
        processed += 1;
        if (r.verification && !r.verification.ok) problems += 1;
      }
    } catch (err) {
      console.log(`  [error]   ${file}`);
      console.log(`            ${err.message}`);
      problems += 1;
    }
    console.log('');
  }

  console.log(`Done. ${apply ? `${processed} processed, ` : ''}${flagged} flagged${apply ? `, ${problems} with problems` : ''}.`);
  if (apply) console.log(`Output folder: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
