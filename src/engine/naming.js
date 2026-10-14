// Output naming. FLAC becomes AIFF; WAV stays WAV; AIFF stays AIFF. Filenames are
// sanitised for Windows and use a plain ASCII hyphen, per house conventions.

import { extname } from 'node:path';

// FLAC becomes lossless AIFF. Everything else keeps its own format (the tags are
// still rewritten and the file is renamed). MP3 and the like stay as they are, since
// converting a lossy file to AIFF only wastes space without improving quality.
export function outputExtFor(inputExt) {
  const ext = inputExt.toLowerCase();
  if (ext === '.flac' || ext === '.aif') return '.aiff';
  return ext;
}

// Characters Windows forbids in a filename. Spaces and the hyphen are kept on
// purpose so the "Artist - Title" form survives sanitising.
const FORBIDDEN = new Set('<>:"/\\|?*'.split(''));
const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// Leaves headroom so dir + "\processed\" + name + ext stays under the 260 limit.
const MAX_STEM = 200;

// Cleans one component (an artist or a title). Returns '' if nothing usable remains,
// so the caller can flag the file rather than write a malformed name.
function sanitizeComponent(name) {
  let out = '';
  for (const ch of String(name)) {
    if (ch.charCodeAt(0) < 32) { out += ' '; continue; } // control characters
    out += FORBIDDEN.has(ch) ? ' ' : ch;
  }
  return out.replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
}

// Public helper that always yields a usable string (used for display, not naming).
export function sanitizeName(name) {
  return sanitizeComponent(name) || 'untitled';
}

// Builds "Artist - Title.ext". Returns null when the artist or title is empty or
// invalid as a Windows filename, which the caller turns into a flagged file.
export function buildFilename(artist, title, ext) {
  const cleanArtist = sanitizeComponent(artist);
  let cleanTitle = sanitizeComponent(title);
  if (!cleanArtist || !cleanTitle) return null;

  let stem = `${cleanArtist} - ${cleanTitle}`;
  if (stem.length > MAX_STEM) {
    const room = MAX_STEM - (cleanArtist.length + 3); // 3 for " - "
    if (room < 8) return null; // artist alone is too long to name safely
    cleanTitle = cleanTitle.slice(0, room).trim().replace(/[. ]+$/, '');
    stem = `${cleanArtist} - ${cleanTitle}`;
  }

  if (RESERVED_NAMES.test(stem)) stem = `_${stem}`;
  stem = stem.replace(/[. ]+$/, '');
  return `${stem}${ext}`;
}

export function isAudioFile(path) {
  return ['.flac', '.wav', '.aif', '.aiff', '.mp3', '.m4a', '.aac', '.ogg'].includes(extname(path).toLowerCase());
}
