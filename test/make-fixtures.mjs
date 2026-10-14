// Generates synthetic test tracks that exercise every path of the engine:
// clean FLAC, messy 24-bit FLAC, feat handling, multi-artist delimiters, blank tags
// with a clean filename (parsed), blank tags with a messy filename (flagged), a WAV,
// and an AIFF. Audio is short sine tones, so the files are tiny but genuinely valid.
//
// Run: node test/make-fixtures.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectFfmpeg } from '../src/ffmpeg.js';

const here = dirname(fileURLToPath(import.meta.url));
const inDir = join(here, 'fixtures', 'in');
const { ffmpeg, ffprobe } = detectFfmpeg();

function ff(args) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

function sineArgs(freq, dur) {
  return ['-f', 'lavfi', '-i', `sine=frequency=${freq}:duration=${dur}`, '-ac', '2'];
}

if (existsSync(inDir)) rmSync(inDir, { recursive: true, force: true });
mkdirSync(inDir, { recursive: true });
const out = (name) => join(inDir, name);

// 1. Clean 16-bit FLAC.
ff([...sineArgs(220, 1), '-ar', '44100', '-c:a', 'flac', '-sample_fmt', 's16',
  '-metadata', 'artist=Rhadoo', '-metadata', 'title=Bemolas', out('rhadoo.flac')]);

// 2. Messy tags, genuine 24-bit FLAC (made via a 24-bit WAV so the depth is real).
const tmp24 = out('_tmp24.wav');
ff([...sineArgs(330, 1), '-ar', '48000', '-c:a', 'pcm_s24le', tmp24]);
ff(['-i', tmp24, '-c:a', 'flac',
  '-metadata', 'artist=Petre Inspirescu', '-metadata', 'title=Vis [320kbps] www.site.com',
  out('petre.flac')]);
rmSync(tmp24, { force: true });

// 3. feat. in the title (should move into the Artist field).
ff([...sineArgs(247, 1), '-ar', '44100', '-c:a', 'flac', '-sample_fmt', 's16',
  '-metadata', 'artist=Blawan', '-metadata', 'title=Tasser feat. Pariah', out('blawan.flac')]);

// 4. Multiple artists with mixed delimiters (should become comma separated).
ff([...sineArgs(196, 1), '-ar', '44100', '-c:a', 'flac', '-sample_fmt', 's16',
  '-metadata', 'artist=Raresh / Rhadoo & Petre Inspirescu', '-metadata', 'title=Pana Maine',
  out('trio.flac')]);

// 5. Blank tags, clean filename (should be parsed from the filename).
ff([...sineArgs(174, 1), '-ar', '44100', '-c:a', 'flac', '-map_metadata', '-1',
  out('Dan Andrei - Nightfall.flac')]);

// 6. Blank tags, messy filename (should be flagged for manual fixing).
ff([...sineArgs(160, 1), '-ar', '44100', '-c:a', 'flac', '-map_metadata', '-1',
  out('track01_64kbps_dl.flac')]);

// 7. WAV with messy tags (passthrough audio, but tags must be cleaned in RIFF INFO).
ff([...sineArgs(293, 1), '-ar', '44100', '-c:a', 'pcm_s16le',
  '-metadata', 'artist=Bambook', '-metadata', 'title=Acaba [WEB] www.bambook.com', out('bambook.wav')]);

// 8. AIFF with messy tags (passthrough audio, but tags must be cleaned in ID3).
ff([...sineArgs(311, 1), '-ar', '44100', '-c:a', 'pcm_s16be', '-write_id3v2', '1', '-id3v2_version', '3',
  '-metadata', 'artist=Praslesh', '-metadata', 'title=Manjego (Original Mix) [320kbps]', out('praslesh.aiff')]);

// 9. A duplicate of #1 (same tags) to prove collision handling: it must be saved
// as "Rhadoo - Bemolas (2).aiff" rather than overwriting the first output.
ff([...sineArgs(440, 1), '-ar', '44100', '-c:a', 'flac', '-sample_fmt', 's16',
  '-metadata', 'artist=Rhadoo', '-metadata', 'title=Bemolas', out('rhadoo_again.flac')]);

// Report what was generated, with real bit depth, so we can confirm 16 vs 24.
console.log(`Generated fixtures in ${inDir}\n`);
for (const name of readdirSync(inDir)) {
  const info = execFileSync(ffprobe, [
    '-v', 'error', '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,bits_per_raw_sample,sample_fmt',
    '-of', 'default=noprint_wrappers=1:nokey=1', out(name),
  ], { encoding: 'utf8' }).trim().split(/\r?\n/).join('  ');
  console.log(`  ${name.padEnd(34)} ${info}`);
}
