// Metadata cleaning.
//
// Two jobs: clean a Title (strip junk, keep mix/remix descriptors, pull "feat. X"
// out) and clean an Artist (normalise multiple artists to a comma-separated list).
// The app never invents data: if embedded tags are blank, it parses the filename
// only when the filename clearly reads "Artist - Title", otherwise it flags the file.
//
// Cleaning rule learned the hard way: ambiguous words (preview, exclusive, v2,
// lossless) are only junk when bracketed. Stripping them as bare words mangles real
// titles ("Exclusive Beach Resort"), so bare-word stripping is reserved for the few
// phrases that are never part of a real title ("free download").

// Placeholder tokens (built at runtime so the source carries no odd escapes).
const T_OPEN = String.fromCharCode(0xe000);
const T_CLOSE = String.fromCharCode(0xe001);

// URLs. With an http(s):// or www. prefix we take the whole token. A bare domain is
// only stripped for non-word-like TLDs, so a title like "Going.to The Store" survives.
const URL_SCHEME_RE = /(?:https?:\/\/|www\.)[^\s\]\)\}]+/gi;
const URL_BARE_RE = /\b[a-z0-9-]+\.(?:com|net|org|ru|info|biz|club|live|xyz)\b(?:\/[^\s\]\)]*)?/gi;

// Quality tags. Format-shaped tokens (320kbps, 48khz, 24bit) almost never collide
// with real words, so they may be unbracketed. Word-like tokens (v0, v2, lossless,
// hi-res, the format names) are only stripped inside brackets.
const QUALITY_FORMAT_RE = /[\[\(\{]?\s*(?:320\s?k(?:bps)?|256\s?k(?:bps)?|192\s?k(?:bps)?|128\s?k(?:bps)?|24\s?bit|16\s?bit|44\.?1\s?khz|48\s?khz)\s*[\]\)\}]?/gi;
const QUALITY_WORD_RE = /[\[\(\{]\s*(?:cbr|vbr|v0|v2|lossless|hi-?res|hq|flac|wav|aiff|aac|mp3)\s*[\]\)\}]/gi;

// Promo junk. Ambiguous words only count when bracketed; only "free download" and
// its variants are stripped bare, because they never appear in a real title.
const PROMO_BRACKET_RE = /[\[\(\{]\s*(?:preview|teaser|exclusive|premiere|snippet|clip|out\s*now|buy\s*now|free\s*(?:dl|download)|freedl|f\.?d\.?l\.?|support(?:ed)?(?:\s*by[^\]\)\}]*)?)\s*[\]\)\}]/gi;
const PROMO_PHRASE_RE = /\b(?:free\s*(?:dl|download)|freedl)\b/gi;

const SCENE_RE = /[\[\(\{]\s*(?:WEB|VINYL|PROMO|RIP|SCENE|RETAIL|REPACK|REISSUE|REMASTER(?:ED)?|[12][09][0-9]{2})\s*[\]\)\}]/gi;
const CATALOG_RE = /[\[\(\{]\s*[A-Z]{2,6}[\s-]?[0-9]{2,4}(?:[A-Z])?\s*[\]\)\}]/g;
// A leading track number: digits (optionally a vinyl side letter) followed by a
// punctuation separator like "08-", "08.", "A1)", or a zero-padded number then a
// space like "08 ". Deliberately does not strip "2 Unlimited" or "50 Cent".
const LEADING_TRACKNO_RE = /^\s*(?:[A-D]?\d{1,3}\s*[.\-_)]\s*|0\d\s+)(?=\S)/i;

// "(Original Mix)" and friends are the redundant default and are dropped from titles.
const ORIGINAL_MIX_RE = /\s*[\(\[]\s*original(?:\s+(?:mix|version|edit))?\s*[\)\]]/gi;
const EMPTY_BRACKETS_RE = /[\[\(\{]\s*[\]\)\}]/g;
const TRIM_SEP_RE = /^[\s\-_.,;|]+|[\s\-_.,;|]+$/g;
const ZEROWIDTH_RE = /[​-‍⁠﻿]/g;

// A bracketed group that names a mix, remix, edit, or version is meaningful and
// must be preserved through the junk strips.
const MIX_GROUP_RE = /[\(\[][^\)\]]*\b(?:mix|remix|edit|version|dub|vip|rework|refix|bootleg|instrumental|acapella|vocal|extended|original|radio|club|dubplate)\b[^\)\]]*[\)\]]/gi;

// A trailing "feat. X" block, optionally bracketed, optionally followed by a
// bracketed descriptor. The featured names are captured.
const FEAT_RE = /[\(\[]?\s*(?:feat\.?|ft\.?|featuring)\s+([^\)\]\(\[]+?)\s*[\)\]]?(?=\s*[\(\[]|\s*$)/i;

// Artist delimiters. Deliberately conservative: bare "/" (AC/DC) and " x " (any two
// words) over-split real names, so they are never used. The base set always splits;
// the connector set (&, +, vs) is gated behind a config toggle.
const ARTIST_SPLIT_BASE = ',|;|\\s/\\s|\\sfeat\\.?\\s|\\sft\\.?\\s|\\sfeaturing\\s';
const ARTIST_SPLIT_CONNECTORS = '\\s&\\s|\\s\\+\\s|\\svs\\.?\\s|\\sversus\\s';

const DESCRIPTOR_WORDS = new Set([
  'original', 'extended', 'club', 'radio', 'dub', 'instrumental', 'acapella',
  'vocal', 'vip', 'rework', 'reedit', 'bootleg', 'mix', 'remix', 'edit',
  'version', 'refix', 'dubplate',
]);

const BLANK_VALUES = new Set([
  '', 'unknown', 'unknown artist', 'untitled', 'track', 'va', 'various',
  'various artists', 'no artist', 'none',
]);

function hygiene(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(ZEROWIDTH_RE, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBlank(value) {
  return BLANK_VALUES.has(hygiene(value).toLowerCase());
}

function stripJunk(value) {
  return value
    .replace(URL_SCHEME_RE, ' ')
    .replace(URL_BARE_RE, ' ')
    .replace(QUALITY_FORMAT_RE, ' ')
    .replace(QUALITY_WORD_RE, ' ')
    .replace(PROMO_BRACKET_RE, ' ')
    .replace(PROMO_PHRASE_RE, ' ')
    .replace(SCENE_RE, ' ')
    .replace(CATALOG_RE, ' ')
    .replace(EMPTY_BRACKETS_RE, ' ');
}

function protect(value, regex, store) {
  return value.replace(regex, (match) => {
    const token = `${T_OPEN}${store.length}${T_CLOSE}`;
    store.push(match);
    return token;
  });
}

function restore(value, store) {
  return value.replace(new RegExp(`${T_OPEN}(\\d+)${T_CLOSE}`, 'g'), (_, i) => store[Number(i)]);
}

// Title-cases only recognised descriptor words, leaving stylised names and the
// label's own bracket style untouched.
function normaliseDescriptors(value) {
  return value.replace(/([\(\[])([^\)\]]+)([\)\]])/g, (match, open, inner, close) => {
    const words = inner.trim().split(/\s+/);
    if (!words.some((w) => DESCRIPTOR_WORDS.has(w.toLowerCase()))) return match;
    const cased = words
      .map((w) => (DESCRIPTOR_WORDS.has(w.toLowerCase())
        ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
        : w))
      .join(' ');
    return `${open}${cased}${close}`;
  });
}

export function cleanTitle(raw) {
  let value = hygiene(raw);

  const feats = [];
  value = value.replace(FEAT_RE, (_, names) => {
    feats.push(names.trim());
    return ' ';
  });

  const store = [];
  value = protect(value, MIX_GROUP_RE, store);
  value = stripJunk(value);
  value = restore(value, store);
  value = value.replace(ORIGINAL_MIX_RE, ' ');

  value = value.replace(/\s+/g, ' ').replace(TRIM_SEP_RE, '').trim();
  value = normaliseDescriptors(value);
  return { title: value, feats };
}

export function cleanArtist(raw, extraFeats = [], config = {}) {
  const splitConnectors = config.splitArtistConnectors !== false;
  let value = hygiene(raw);
  value = stripJunk(value).replace(LEADING_TRACKNO_RE, '');

  const parts = splitArtists(value, splitConnectors);
  for (const feat of extraFeats) parts.push(...splitArtists(feat, splitConnectors));

  const seen = new Set();
  const out = [];
  for (let part of parts) {
    part = part.replace(TRIM_SEP_RE, '').trim();
    if (!part) continue;
    const key = part.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(part);
  }
  return out.join(', ');
}

function splitArtists(value, splitConnectors = true) {
  const pattern = splitConnectors
    ? `${ARTIST_SPLIT_BASE}|${ARTIST_SPLIT_CONNECTORS}`
    : ARTIST_SPLIT_BASE;
  return value
    .split(new RegExp(`\\s*(?:${pattern})\\s*`, 'gi'))
    .map((p) => p.trim())
    .filter(Boolean);
}

// If an artist is also named inside the title's brackets (a remix, edit, version, or
// "remodel" credit), they belong in the title, not the artist field. So
// "Davor Tosovic, Liuos - Envelope Depth (Liuos Remodel)" becomes
// "Davor Tosovic - Envelope Depth (Liuos Remodel)". Never drop the only artist, and leave
// "feat." brackets alone (a featured artist is a different relationship).
export function dropBracketCredits(artistStr, title) {
  const artists = String(artistStr || '').split(',').map((a) => a.trim()).filter(Boolean);
  if (artists.length < 2) return artistStr;
  const credits = creditBracketText(title);
  if (!credits) return artistStr;
  const kept = artists.filter((a) => !nameAppearsIn(a, credits));
  return (kept.length ? kept : artists).join(', ');
}

function creditBracketText(title) {
  const groups = String(title || '').match(/[\(\[][^\)\]]*[\)\]]/g) || [];
  return groups
    .map((g) => g.replace(/^[\(\[]\s*|\s*[\)\]]$/g, '').trim())
    .filter((inner) => !/^(?:feat\.?|ft\.?|featuring)\b/i.test(inner))
    .join(' ')
    .toLowerCase();
}

function nameAppearsIn(name, haystack) {
  const n = name.trim().toLowerCase();
  if (n.length < 2) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(haystack);
}

function buildResolved(artist, rawTitle, feats, config, sourceLabel) {
  const moveFeat = config.featMode === 'move-to-artist';
  const finalTitle = (!moveFeat && feats.length)
    ? `${rawTitle} (feat. ${feats.join(', ')})`
    : rawTitle;
  const finalArtist = dropBracketCredits(cleanArtist(artist, moveFeat ? feats : [], config), finalTitle);
  if (finalArtist && finalTitle) {
    return { status: sourceLabel === 'filename' ? 'parsed' : 'tagged', artist: finalArtist, title: finalTitle, source: sourceLabel };
  }
  return null;
}

// Decides the final Artist and Title for a file, and whether it must be flagged.
export function resolveMetadata(source, baseName, config) {
  const artistBlank = isBlank(source.artist);
  const titleBlank = isBlank(source.title);

  if (!artistBlank && !titleBlank) {
    const { title, feats } = cleanTitle(source.title);
    const resolved = buildResolved(source.artist, title, feats, config, 'embedded tags');
    return resolved || { status: 'flagged', reason: 'tags are present but empty after cleaning' };
  }

  if (config.filenameFallback) {
    const separators = baseName.match(/\s+[-–—]\s+/g) || [];
    if (separators.length === 0) {
      return { status: 'flagged', reason: 'blank tags and the filename is not in "Artist - Title" form' };
    }
    const idx = baseName.search(/\s+[-–—]\s+/);
    const left = baseName.slice(0, idx);
    const right = baseName.slice(idx + separators[0].length);
    const { title, feats } = cleanTitle(right);
    // Two or more separators is ambiguous (for example "Label - Artist - Title")
    // unless the extra part is a mix descriptor; flag rather than guess.
    if (separators.length > 1 && !/[\(\[][^\)\]]*\b(?:mix|remix|edit|version|dub|vip)\b/i.test(right)) {
      return { status: 'flagged', reason: 'the filename has an ambiguous "Artist - Title" form' };
    }
    const resolved = buildResolved(left, title, feats, config, 'filename');
    return resolved || { status: 'flagged', reason: 'the filename did not yield a clean artist and title' };
  }

  return { status: 'flagged', reason: 'blank or unclear tags' };
}
