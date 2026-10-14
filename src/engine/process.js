// Per-file orchestration.
//
// planFile is a dry run: it reads tags, decides the final Artist/Title (or flags the
// file), and works out the new name, changing nothing on disk. applyFile does the
// real work on a copy: convert or pass through, write the clean tags, verify by
// reading back, then rename to match. The source file is never touched, and an
// existing unrelated output is never overwritten.

import { basename, extname, dirname, join } from 'node:path';
import { renameSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { readTags, writeTags } from './tags.js';
import { convertOrPassthrough } from './convert.js';
import { probe } from './probe.js';
import { resolveMetadata } from './clean.js';
import { outputExtFor, buildFilename } from './naming.js';

const TMP_PREFIX = '.audiobox-tmp-';

const GENERIC_DESCRIPTOR_WORDS = new Set(['mix', 'remix', 'edit', 'version', 'vip', 'dub', 're', 'the']);

// The trailing "(...)" or "[...]" descriptor on a title (a mix, remix, or edit), or ''.
function extractDescriptor(title) {
  const match = String(title || '').match(/[\(\[][^\)\]]*[\)\]]\s*$/);
  return match ? match[0].trim() : '';
}

function stripDescriptor(title) {
  return String(title || '').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*$/, '').trim();
}

// Does the downloaded file look like the version named by the Spotify descriptor?
// Checks the file name for the descriptor's distinctive words (the remixer or qualifier),
// so "Robot Man (feat ... Kanedo remix)" matches "(Kanedo Remix)" but a plain
// "Poverty Point" does not match "(Mixed)".
function fileMatchesDescriptor(fileRaw, descriptor) {
  const raw = String(fileRaw || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const words = descriptor.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
  const distinctive = words.filter((w) => w.length >= 3 && !GENERIC_DESCRIPTOR_WORDS.has(w));
  if (distinctive.length) return distinctive.every((w) => raw.includes(w));
  return words.some((w) => raw.includes(w));
}

// Composes the saved title: Spotify's base spelling, plus the descriptor for the
// version actually downloaded. Keeps Spotify's clean descriptor when the file is that
// version; drops it when the file is the plain version; uses the file's own descriptor
// when Spotify has none.
export function composeTitle(spotifyTitle, fileRaw, fileCleanTitle) {
  const base = stripDescriptor(spotifyTitle);
  const spotifyDescriptor = extractDescriptor(spotifyTitle);
  if (spotifyDescriptor && fileMatchesDescriptor(fileRaw, spotifyDescriptor)) {
    return `${base} ${spotifyDescriptor}`;
  }
  const fileDescriptor = extractDescriptor(fileCleanTitle);
  return fileDescriptor ? `${base} ${fileDescriptor}` : base;
}

export async function planFile(path, config, override) {
  const ext = extname(path);
  const source = await readTags(path);
  const fileResolved = resolveMetadata(source, basename(path, ext), config);

  let resolved;
  if (override && override.artist && override.title) {
    const fileClean = fileResolved.status === 'flagged' ? '' : fileResolved.title;
    let title = composeTitle(override.title, basename(path, ext), fileClean);
    if (override.vinyl) title = `${title} VINYL ONLY`;
    resolved = { status: 'matched', artist: override.artist, title, source: 'Spotify' };
  } else {
    resolved = fileResolved;
  }

  const outExt = outputExtFor(ext);

  let newName = null;
  if (resolved.status !== 'flagged') {
    newName = buildFilename(resolved.artist, resolved.title, outExt);
    if (!newName) {
      return {
        path,
        name: basename(path),
        ext,
        source,
        resolved: { status: 'flagged', reason: 'the artist or title has no characters that are valid in a Windows filename' },
        outExt,
        newName: null,
      };
    }
  }
  return { path, name: basename(path), ext, source, resolved, outExt, newName };
}

// Removes leftover temp files from a prior abnormal exit. Safe to call before a run.
export function sweepTempFiles(dir) {
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(TMP_PREFIX)) {
        try { rmSync(join(dir, entry), { force: true }); } catch { /* locked, skip */ }
      }
    }
  } catch { /* dir does not exist yet */ }
}

// Finds a free output path, never colliding with a name already produced this run
// (claimed) or an existing file on disk. Returns { finalPath, name, renamed }.
function reserveOutput(dir, desiredName, ext, claimed) {
  const stem = desiredName.slice(0, desiredName.length - ext.length);
  let candidate = desiredName;
  let n = 2;
  while (claimed.has(candidate.toLowerCase()) || existsSync(join(dir, candidate))) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  claimed.add(candidate.toLowerCase());
  return { finalPath: join(dir, candidate), name: candidate, renamed: candidate !== desiredName };
}

export async function applyFile(path, config, outDir, onStage = () => {}, claimed = new Set(), override) {
  const plan = await planFile(path, config, override);
  if (plan.resolved.status === 'flagged') {
    return { ...plan, applied: false };
  }

  const dir = outDir || dirname(path);
  const reserved = reserveOutput(dir, plan.newName, plan.outExt, claimed);
  const tmpPath = join(dir, `${TMP_PREFIX}${process.pid}-${Date.now()}${plan.outExt}`);

  try {
    onStage('convert');
    const conversion = convertOrPassthrough(path, tmpPath, plan.ext);
    onStage('tag');
    writeTags(tmpPath, plan.resolved, plan.outExt);
    onStage('rename');
    const verification = await verifyOutput(tmpPath, plan);
    renameSync(tmpPath, reserved.finalPath); // reserved name is guaranteed free
    return {
      ...plan,
      applied: true,
      finalPath: reserved.finalPath,
      newName: reserved.name,
      renamed: reserved.renamed,
      conversion,
      verification,
    };
  } catch (err) {
    if (existsSync(tmpPath)) rmSync(tmpPath, { force: true });
    throw err;
  }
}

async function verifyOutput(outputPath, plan) {
  const result = { ok: true, problems: [], tagTypes: [] };
  const back = await readTags(outputPath);
  result.tagTypes = back.tagTypes;

  if (back.title !== plan.resolved.title) {
    result.ok = false;
    result.problems.push(`title read back as "${back.title}"`);
  }
  if (back.artist !== plan.resolved.artist) {
    result.ok = false;
    result.problems.push(`artist read back as "${back.artist}"`);
  }

  if (/\.aiff?$/i.test(plan.outExt)) {
    const info = probe(outputPath);
    if (!/aiff/i.test(info.format_name || '')) {
      result.ok = false;
      result.problems.push(`container is "${info.format_name}", expected aiff`);
    }
    if (!/^pcm_s(16|24)be$/.test(info.codec_name || '')) {
      result.ok = false;
      result.problems.push(`codec is "${info.codec_name}", expected big-endian PCM`);
    }
    if (!back.tagTypes.some((t) => /ID3v2\.3/i.test(t))) {
      result.ok = false;
      result.problems.push(`tag version is "${back.tagTypes.join(', ')}", expected ID3v2.3`);
    }
  }

  return result;
}
