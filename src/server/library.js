// Library: pulls finished Soulseek downloads into the app, matches them against the
// loaded playlist (the checklist), and tracks what is got versus still needed.
//
// Safety: a download folder is only pulled once it has been still for a few seconds
// (so a folder still receiving files is left alone), audio is moved out, and only then
// is the original folder sent to the Recycle Bin (recoverable), never hard-deleted.

import {
  existsSync, mkdirSync, readdirSync, statSync, renameSync, rmSync,
  copyFileSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, extname, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readTags } from '../engine/tags.js';
import { resolveMetadata } from '../engine/clean.js';
import { defaultConfig } from '../engine/config.js';
import { isAudioFile, sanitizeName } from '../engine/naming.js';
import { composeTitle } from '../engine/process.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The desktop app keeps settings in its own data folder (AUDIOBOX_DATA_DIR); from source they
// sit beside the code, gitignored.
const STORE = join(process.env.AUDIOBOX_DATA_DIR || ROOT, '.audiobox-library.json');
const DOCS = join(homedir(), 'Documents');

// Soulseek's download folder differs by install and platform. The first candidate that
// exists wins. AUDIOBOX_SOULSEEK, AUDIOBOX_INCOMING and AUDIOBOX_READY override any path.
function defaultSoulseek() {
  const home = homedir();
  const candidates = [
    join(DOCS, 'Soulseek Downloads', 'complete'),
    join(home, 'Soulseek Downloads', 'complete'),
    join(home, 'Downloads', 'Soulseek Downloads', 'complete'),
  ];
  return candidates.find((p) => existsSync(p)) || candidates[0];
}

const DEFAULTS = {
  soulseekComplete: defaultSoulseek(),
  incoming: join(DOCS, 'Audiobox', 'incoming'),
  ready: join(DOCS, 'Audiobox', 'ready'),
  autoPull: false,
  checklist: [],
  activePlaylist: null,
  vinyl: [],
};

// Each playlist gets its own subfolder, so its pulled files and counts are isolated.
// Both the name and the ID are sanitised: they arrive from the client, and anything with a
// separator in it would escape the staging folder and write somewhere unintended.
function activeFolder(cfg) {
  const p = cfg.activePlaylist;
  if (!p || !p.id) return null;
  const base = sanitizeName(p.name || '');
  if (base && base !== 'untitled') return base;
  const fromId = String(p.id).replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64);
  return fromId || null;
}

function incomingDirOf(cfg) {
  const folder = activeFolder(cfg);
  return folder ? join(cfg.incoming, folder) : cfg.incoming;
}

function readyDirOf(cfg) {
  const folder = activeFolder(cfg);
  return folder ? join(cfg.ready, folder) : cfg.ready;
}

export function getIncomingDir() { return incomingDirOf(getConfig()); }
export function getReadyDir() { return readyDirOf(getConfig()); }

const STABLE_MS = 8000; // a folder must be untouched this long before it is pulled

// ---- config persistence ----

export function getConfig() {
  let saved = {};
  try { saved = JSON.parse(readFileSync(STORE, 'utf8')); } catch { /* first run */ }
  const env = {};
  if (process.env.AUDIOBOX_SOULSEEK) env.soulseekComplete = process.env.AUDIOBOX_SOULSEEK;
  if (process.env.AUDIOBOX_INCOMING) env.incoming = process.env.AUDIOBOX_INCOMING;
  if (process.env.AUDIOBOX_READY) env.ready = process.env.AUDIOBOX_READY;
  return { ...DEFAULTS, ...saved, ...env };
}

function saveConfig(patch) {
  const next = { ...getConfig(), ...patch };
  writeFileSync(STORE, JSON.stringify(next, null, 2));
  return next;
}

export function setPaths(patch) {
  const clean = {};
  for (const key of ['soulseekComplete', 'incoming', 'ready']) {
    if (typeof patch[key] === 'string' && patch[key].trim()) clean[key] = patch[key].trim();
  }
  return saveConfig(clean);
}

export function setAutoPull(on) { return saveConfig({ autoPull: Boolean(on) }); }

export function setChecklist({ id, name, tracks }) {
  const checklist = (tracks || []).map((t) => ({ artist: t.artist || '', title: t.title || '', line: t.line || '' }));
  return saveConfig({ checklist, activePlaylist: { id: id || '', name: name || '' } });
}

// Adds single tracks to the current checklist without replacing it, skipping lines already
// there. With no playlist active, the additions start a list of their own named
// "Single tracks", which also names their folders. Returns how many were added.
export function addToChecklist(tracks) {
  const cfg = getConfig();
  const existing = cfg.checklist || [];
  const seen = new Set(existing.map((t) => String(t.line || '').toLowerCase()));
  const added = [];
  for (const t of tracks || []) {
    const line = String(t.line || '').trim();
    if (!line || seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    added.push({ artist: t.artist || '', title: t.title || '', line });
  }
  const active = (cfg.activePlaylist && cfg.activePlaylist.id)
    ? cfg.activePlaylist
    : { id: 'single-tracks', name: 'Single tracks' };
  saveConfig({ checklist: [...existing, ...added], activePlaylist: active });
  return added.length;
}

// Marks a checklist line as vinyl only (cannot be downloaded), so it stops counting
// as missing. Keyed by the line text, so it survives re-loading the playlist.
export function setVinyl(line, on) {
  const set = new Set(getConfig().vinyl || []);
  if (on) set.add(line); else set.delete(line);
  return saveConfig({ vinyl: [...set] });
}

// ---- helpers ----

function ensureDir(dir) { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }); }

function moveFile(src, dest) {
  try {
    renameSync(src, dest);
  } catch (err) {
    if (err.code === 'EXDEV') { copyFileSync(src, dest); rmSync(src, { force: true }); }
    else throw err;
  }
}

function freeDest(dir, name) {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let n = 2;
  while (existsSync(join(dir, candidate))) { candidate = `${stem} (${n})${ext}`; n += 1; }
  return join(dir, candidate);
}

function collectAudio(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectAudio(full));
    else if (isAudioFile(entry.name)) out.push(full);
  }
  return out;
}

function latestMtime(dir) {
  let latest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    try {
      const st = statSync(full);
      latest = Math.max(latest, st.mtimeMs);
      if (entry.isDirectory()) latest = Math.max(latest, latestMtime(full));
    } catch { /* vanished mid-scan */ }
  }
  return latest;
}

// Sends a folder to the Recycle Bin (Windows) or the Trash (macOS) so it stays recoverable.
// Anywhere else, or if that fails, the folder is left where it is; nothing is hard-deleted.
function recycle(targetPath) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const safe = targetPath.replace(/'/g, "''");
      const ps = 'Add-Type -AssemblyName Microsoft.VisualBasic; '
        + `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${safe}', 'OnlyErrorDialogs', 'SendToRecycleBin')`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], (err) => resolve(!err));
      return;
    }
    if (process.platform === 'darwin') {
      const trash = join(homedir(), '.Trash');
      let dest = join(trash, basename(targetPath));
      if (existsSync(dest)) dest = join(trash, basename(targetPath) + ' ' + Date.now());
      try { renameSync(targetPath, dest); resolve(true); } catch { resolve(false); }
      return;
    }
    resolve(false);
  });
}

// ---- ingest ----

export async function ingestOnce() {
  const cfg = getConfig();
  if (!existsSync(cfg.soulseekComplete)) return { moved: [], removed: [], error: 'Soulseek folder not found' };
  const target = incomingDirOf(cfg);
  ensureDir(target);

  const moved = [];
  const removed = [];
  const now = Date.now();

  for (const entry of readdirSync(cfg.soulseekComplete, { withFileTypes: true })) {
    const full = join(cfg.soulseekComplete, entry.name);

    if (!entry.isDirectory()) {
      if (!isAudioFile(entry.name)) continue;
      try {
        if (now - statSync(full).mtimeMs < STABLE_MS) continue;
        const dest = freeDest(target, entry.name);
        moveFile(full, dest);
        moved.push(basename(dest));
      } catch { /* skip locked file */ }
      continue;
    }

    let latest;
    try { latest = latestMtime(full); } catch { continue; }
    if (now - latest < STABLE_MS) continue; // still downloading

    const audio = collectAudio(full);
    if (!audio.length) continue; // nothing to take; leave the folder

    let allMoved = true;
    for (const file of audio) {
      try {
        const dest = freeDest(target, basename(file));
        moveFile(file, dest);
        moved.push(basename(dest));
      } catch { allMoved = false; }
    }
    if (allMoved) {
      const ok = await recycle(full);
      if (ok) removed.push(entry.name);
    }
  }

  return { moved, removed };
}

// ---- matching ----

// Artist aliases: different names for the same artist are treated as the same when
// matching downloads to playlist tracks. The saved name still uses whatever alias
// Spotify lists for that track. Add a group here when two names are the same person.
const ALIASES = [
  ['Kolter', 'Djoko'],
];

function buildAliasMap(groups) {
  const map = {};
  for (const group of groups) {
    const canonical = String(group[0]).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const name of group) {
      const key = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
      if (key) map[key] = canonical;
    }
  }
  return map;
}

const ALIAS_MAP = buildAliasMap(ALIASES);

export function tokens(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(?:feat|ft|featuring)\.?\b.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean)
    .map((t) => ALIAS_MAP[t] || t);
}

function jaccard(a, b) {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let inter = 0;
  for (const x of new Set(a)) if (setB.has(x)) inter += 1;
  return inter / (new Set(a).size + setB.size - inter);
}

async function incomingFiles(dir) {
  ensureDir(dir);
  const names = readdirSync(dir).filter(isAudioFile);
  const files = [];
  for (const name of names) {
    const full = join(dir, name);
    let artist = '';
    let title = '';
    try {
      const src = await readTags(full);
      const resolved = resolveMetadata(src, basename(name, extname(name)), defaultConfig);
      if (resolved.status !== 'flagged') { artist = resolved.artist; title = resolved.title; }
    } catch { /* fall back to filename below */ }
    const basis = artist || title ? `${artist} ${title}` : basename(name, extname(name));
    files.push({ name, artist, title, tokens: tokens(basis) });
  }
  return files;
}

// Sorts loose files in the incoming root into the active playlist folder (if they
// match it) or an _unsorted folder, so each playlist's view is clean. New pulls land
// straight in the active folder, so this becomes a no-op once the root is drained.
async function migrateLoose(cfg, activeDir) {
  let entries;
  try { entries = readdirSync(cfg.incoming, { withFileTypes: true }); } catch { return; }
  const loose = entries.filter((e) => e.isFile() && isAudioFile(e.name)).map((e) => e.name);
  if (!loose.length) return;

  const trackTokens = cfg.checklist.map((t) => tokens(`${t.artist} ${t.title}`));
  const unsortedDir = join(cfg.incoming, '_unsorted');

  for (const name of loose) {
    const full = join(cfg.incoming, name);
    let basis = basename(name, extname(name));
    try {
      const src = await readTags(full);
      const resolved = resolveMetadata(src, basename(name, extname(name)), defaultConfig);
      if (resolved.status !== 'flagged') basis = `${resolved.artist} ${resolved.title}`;
    } catch { /* use the filename */ }
    const fileTok = tokens(basis);
    const matched = trackTokens.some((tt) => jaccard(tt, fileTok) >= 0.45);
    const destDir = matched ? activeDir : unsortedDir;
    ensureDir(destDir);
    try { moveFile(full, freeDest(destDir, name)); } catch { /* skip locked */ }
  }
}

// Pairs each checklist song with the incoming file it most resembles. Every song is
// scored against every file and the strongest pairs are claimed first. Claiming in list
// order let a song higher up take a file that belonged to a song lower down (for example
// "93" taking the "Girls (Frink Remix)" file, since both share the artist), which the
// converter would then have tagged and renamed wrongly. Mutates the checklist entries.
const MIN_MATCH_SCORE = 0.45;

export function matchChecklist(checklist, files, used = new Set()) {
  const pairs = [];
  checklist.forEach((track, ti) => {
    const want = tokens(`${track.artist} ${track.title}`);
    files.forEach((f, fi) => {
      const score = jaccard(want, f.tokens);
      if (score >= MIN_MATCH_SCORE) pairs.push({ ti, fi, score });
    });
  });
  pairs.sort((a, b) => b.score - a.score || a.ti - b.ti || a.fi - b.fi);

  const claimed = new Set();
  for (const { ti, fi } of pairs) {
    if (used.has(fi) || claimed.has(ti)) continue;
    const track = checklist[ti];
    const file = files[fi];
    track.got = true;
    track.file = file.name;
    // The name it will actually be saved as: Spotify base plus the descriptor for the
    // version you downloaded (keeps "(Kanedo Remix)" for the remix, drops "(Mixed)"
    // when you grabbed the plain version).
    track.savedLine = `${track.artist} - ${composeTitle(track.title, file.name, file.title)}`.trim();
    used.add(fi);
    claimed.add(ti);
  }
  return used;
}

export async function getState() {
  const cfg = getConfig();
  const incomingDir = incomingDirOf(cfg);
  const readyDir = readyDirOf(cfg);
  ensureDir(incomingDir);
  if (activeFolder(cfg)) await migrateLoose(cfg, incomingDir);

  const files = await incomingFiles(incomingDir);

  const vinylSet = new Set(cfg.vinyl || []);
  const checklist = cfg.checklist.map((t) => ({ ...t, got: false, file: null, vinyl: vinylSet.has(t.line) }));
  const used = new Set();

  matchChecklist(checklist, files, used);

  const readyCount = existsSync(readyDir) ? readdirSync(readyDir).filter(isAudioFile).length : 0;

  return {
    paths: { soulseekComplete: cfg.soulseekComplete, incoming: incomingDir, ready: readyDir },
    // The folders the user actually sets. `paths.incoming` and `paths.ready` above point at
    // the active playlist's subfolder inside these, so the settings panel edits these.
    folders: {
      soulseekComplete: cfg.soulseekComplete,
      incoming: cfg.incoming,
      ready: cfg.ready,
    },
    // Whether each chosen folder is on disk. The Soulseek folder has to exist already
    // because Soulseek writes to it; the other two are created on demand.
    foldersExist: {
      soulseekComplete: existsSync(cfg.soulseekComplete),
      incoming: existsSync(cfg.incoming),
      ready: existsSync(cfg.ready),
    },
    // True when a path came from an environment variable, which overrides the saved
    // value, so the interface can say why editing the field had no effect.
    foldersFromEnv: {
      soulseekComplete: Boolean(process.env.AUDIOBOX_SOULSEEK),
      incoming: Boolean(process.env.AUDIOBOX_INCOMING),
      ready: Boolean(process.env.AUDIOBOX_READY),
    },
    autoPull: cfg.autoPull,
    activePlaylist: cfg.activePlaylist || null,
    soulseekExists: existsSync(cfg.soulseekComplete),
    incomingCount: files.length,
    readyCount,
    checklist,
    got: checklist.filter((t) => t.got).length,
    vinylCount: checklist.filter((t) => t.vinyl).length,
    total: checklist.length,
    unmatched: files.filter((_, i) => !used.has(i)).map((f) => f.name),
  };
}

// Maps each matched incoming filename to its Spotify artist/title, so the converter
// can name the output exactly as Spotify has it.
export async function getOverrides() {
  const state = await getState();
  const map = {};
  for (const track of state.checklist) {
    if (track.got && track.file && track.artist && track.title) {
      map[track.file] = { artist: track.artist, title: track.title, vinyl: track.vinyl };
    }
  }
  return map;
}

// ---- auto-pull poller ----

let timer = null;

export function startPoller(onChange) {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      if (!getConfig().autoPull) return;
      const res = await ingestOnce();
      if (onChange && (res.moved.length || res.removed.length)) onChange(res);
    } catch { /* keep polling */ }
  }, 4000);
}
