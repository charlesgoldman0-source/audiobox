// Tests ingest on a sandbox: a fake "complete" folder with a nested download folder,
// an audio file, and a non-audio extra. Confirms audio moves to incoming and the
// source folder is recycled. Never touches the real Soulseek folder.
// Run: node test/library-ingest.test.mjs
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setPaths, ingestOnce, getConfig } from '../src/server/library.js';

const sandbox = join(tmpdir(), 'abx-sandbox');
const complete = join(sandbox, 'complete');
const incoming = join(sandbox, 'incoming');

rmSync(sandbox, { recursive: true, force: true });
mkdirSync(join(complete, 'uploader1', 'album'), { recursive: true });
mkdirSync(incoming, { recursive: true });

const audio = join(complete, 'uploader1', 'album', 'Rhadoo - Bemolas.flac');
writeFileSync(audio, 'dummy-audio');
writeFileSync(join(complete, 'uploader1', 'cover.jpg'), 'dummy-art');

// Make everything look "stable" (modified 20s ago) so ingest will pull it.
const past = new Date(Date.now() - 20000);
for (const p of [audio, join(complete, 'uploader1', 'cover.jpg'), join(complete, 'uploader1', 'album'), join(complete, 'uploader1')]) {
  utimesSync(p, past, past);
}

setPaths({ soulseekComplete: complete, incoming });
console.log('soulseek path set to sandbox:', getConfig().soulseekComplete.includes('abx-sandbox'));

const res = await ingestOnce();
console.log('ingest result:', JSON.stringify(res));
console.log('incoming now:', readdirSync(incoming));
console.log('complete subfolders now:', existsSync(complete) ? readdirSync(complete) : '(complete gone)');

// Reset the real config back to defaults (real Soulseek path, auto-pull off, no checklist).
writeFileSync(new URL('../.audiobox-library.json', import.meta.url), '{}\n');
console.log('config reset to defaults; soulseek now:', getConfig().soulseekComplete);
