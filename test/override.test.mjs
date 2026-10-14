// Proves a matched download is named exactly with the Spotify artist/title, ignoring
// the messy download name. Run: node override.test.mjs
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { detectFfmpeg } from '../src/ffmpeg.js';
import { applyFile } from '../src/engine/process.js';
import { readTags } from '../src/engine/tags.js';
import { defaultConfig } from '../src/engine/config.js';

const { ffmpeg } = detectFfmpeg();
const dir = join(tmpdir(), 'abx-override');
const incoming = join(dir, 'incoming');
const ready = join(dir, 'ready');
rmSync(dir, { recursive: true, force: true });
mkdirSync(incoming, { recursive: true });
mkdirSync(ready, { recursive: true });

// A real FLAC with the messy download name and no tags (so without the override it
// would fall back to that filename).
const src = join(incoming, '08-Upwellings - Slow Lane (Original Mix).flac');
execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', '-ac', '2', '-ar', '44100', '-c:a', 'flac', '-map_metadata', '-1', src]);

const result = await applyFile(src, defaultConfig, ready, () => {}, new Set(), { artist: 'Upwellings', title: 'Slow Lane' });
console.log('output name:', result.newName);
console.log('source label:', result.resolved.source);
const back = await readTags(result.finalPath);
console.log('tags read back:', `${back.artist} / ${back.title}`, '[' + back.tagTypes.join(', ') + ']');

const ok = result.newName === 'Upwellings - Slow Lane.aiff' && back.artist === 'Upwellings' && back.title === 'Slow Lane';
console.log(ok ? '\nPASS: named exactly as Spotify' : '\nFAIL');
process.exit(ok ? 0 : 1);
