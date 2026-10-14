// Proves an MP3 is pulled in, kept as MP3, tagged cleanly, and renamed.
// Run: node mp3.test.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { detectFfmpeg } from '../src/ffmpeg.js';
import { applyFile } from '../src/engine/process.js';
import { readTags } from '../src/engine/tags.js';
import { defaultConfig } from '../src/engine/config.js';

const { ffmpeg } = detectFfmpeg();
const dir = join(tmpdir(), 'abx-mp3');
const inc = join(dir, 'in');
const out = join(dir, 'out');
rmSync(dir, { recursive: true, force: true });
mkdirSync(inc, { recursive: true });
mkdirSync(out, { recursive: true });

const src = join(inc, 'Deep Sector - Come Back to Me.mp3');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1',
  '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame',
  '-metadata', 'artist=Deep Sector', '-metadata', 'title=Come Back to Me [320kbps]', src]);

const r = await applyFile(src, defaultConfig, out, () => {}, new Set());
console.log('mode:', r.conversion.mode, ' output:', r.newName);
const back = await readTags(r.finalPath);
console.log('tags:', `${back.artist} / ${back.title}`, '[' + back.tagTypes.join(', ') + ']', 'codec:', back.codec);

const ok = r.newName === 'Deep Sector - Come Back to Me.mp3'
  && back.artist === 'Deep Sector' && back.title === 'Come Back to Me'
  && back.tagTypes.some((t) => /ID3v2\.3/i.test(t));
console.log(ok ? '\nPASS: MP3 kept, cleaned, renamed' : '\nFAIL');
process.exit(ok ? 0 : 1);
