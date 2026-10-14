// Apple Music playlist reader (public playlists only).
//
// Reads a playlist's track names from its public page on music.apple.com and returns each
// track as a clean "Artist - Title" line for a manual Soulseek search. It never downloads
// audio and needs no account or key.
//
// There is deliberately no sign-in. Apple's API wants a developer token signed with a
// MusicKit private key, which Apple issues only to paid Apple Developer Program members, so
// no listener cloning the app could use it. A playlist someone made themselves has to be
// shared publicly in Apple Music before its page exists. See CLAUDE.md.
//
// The page carries two machine-readable blocks: a `serialized-server-data` JSON block whose
// "trackLockup" section lists every track with its title and one link per artist, and a
// `schema:music-playlist` ld+json block with the playlist name and track count.

import { dropBracketCredits } from '../engine/clean.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

// "(Original Mix)" and friends are the redundant default and are dropped, as for Spotify.
const ORIGINAL_MIX_RE = /\s*[(\[]\s*original(?:\s+(?:mix|version|edit))?\s*[)\]]/gi;
// Apple pads page titles with direction marks; they are invisible and break folder names.
// Built from code points rather than escapes so the source stays plain ASCII.
const INVISIBLE_RE = new RegExp('[' + String.fromCharCode(0x200b) + '-' + String.fromCharCode(0x200f) + String.fromCharCode(0x2028) + String.fromCharCode(0x2029) + String.fromCharCode(0xfeff) + ']', 'g');

// Accepts an Apple Music playlist link and returns { storefront, id }, or null. Links look
// like https://music.apple.com/za/playlist/<slug>/pl.u-<id> for a user-made playlist (the
// slug is optional) or .../pl.<hex> for an editorial one. The storefront is kept because a
// playlist can be missing from another country's catalogue. A bare "pl." ID is accepted too.
export function playlistRefFrom(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const linked = raw.match(/music\.apple\.com\/([a-z]{2})\/playlist\/(?:[^/?#]+\/)?(pl\.[a-zA-Z0-9._-]+)/i);
  if (linked) return { storefront: linked[1].toLowerCase(), id: linked[2] };
  const bare = raw.match(/^(pl\.[a-zA-Z0-9._-]+)$/);
  return bare ? { storefront: 'us', id: bare[1] } : null;
}

// Only used when the page gives one combined artist string instead of one link per artist.
// Apple joins names with " & ", so that is the split; a single act whose name contains an
// ampersand would be over-split here, which is why the per-artist links are preferred.
function splitArtistName(value) {
  return String(value || '').split(/\s*,\s*|\s+&\s+/).map((a) => a.trim()).filter(Boolean);
}

function toLine(artistNames, rawTitle) {
  const title = String(rawTitle || '').replace(INVISIBLE_RE, '').replace(ORIGINAL_MIX_RE, ' ').replace(/\s+/g, ' ').trim();
  const artist = dropBracketCredits(artistNames.map((a) => a.replace(INVISIBLE_RE, '').trim()).filter(Boolean).join(', '), title);
  return { artist, title, line: `${artist} - ${title}`.replace(/^ - | - $/g, '').trim() };
}

function tidyName(value) {
  return String(value || '').replace(INVISIBLE_RE, '').replace(/\s+/g, ' ').trim();
}

// Parses a playlist page. Exported so it can be tested on saved markup without the network.
export function tracksFromPage(html) {
  const block = String(html || '').match(/<script[^>]*id="serialized-server-data"[^>]*>(.+?)<\/script>/s);
  if (!block) {
    throw new Error('Could not read that Apple Music page. Check that the link is to a playlist that is shared publicly.');
  }
  let data;
  try { data = JSON.parse(block[1]); } catch { throw new Error('Could not read the track names on that Apple Music page.'); }

  const pages = Array.isArray(data.data) ? data.data : [data];
  let trackSection = null;
  let headerTitle = '';
  for (const page of pages) {
    const sections = (page && page.data && page.data.sections) || (page && page.sections) || [];
    for (const section of sections) {
      if (!trackSection && section.itemKind === 'trackLockup' && Array.isArray(section.items)) trackSection = section;
      if (!headerTitle && section.itemKind === 'containerDetailHeaderLockup' && section.items && section.items[0]) {
        headerTitle = section.items[0].title || '';
      }
    }
  }
  if (!trackSection) {
    throw new Error('No track list was found on that page. Make sure the link is to a playlist that is shared publicly.');
  }

  const tracks = trackSection.items
    .map((item) => {
      const linked = (item.subtitleLinks || []).map((l) => l && l.title).filter(Boolean);
      return toLine(linked.length ? linked : splitArtistName(item.artistName), item.title);
    })
    .filter((t) => t.title);

  // The ld+json block is the cleaner source for the name; the header lockup is the fallback.
  let name = headerTitle;
  const ld = String(html).match(/<script[^>]*type="application\/ld\+json"[^>]*>(.+?)<\/script>/s);
  if (ld) {
    try {
      const schema = JSON.parse(ld[1]);
      if (schema && schema.name) name = schema.name;
      if (Number.isInteger(schema.numTracks) && schema.numTracks !== tracks.length) {
        console.warn(`[apple] page lists ${tracks.length} tracks but the schema block says ${schema.numTracks}`);
      }
    } catch { /* the name is optional */ }
  }

  return { name: tidyName(name), tracks };
}

// Returns { id, name, tracks } in the same shape as the Spotify reader, so the client and
// the checklist treat both services alike.
export async function listTracks(input) {
  const ref = playlistRefFrom(input);
  if (!ref) {
    throw new Error('That is not an Apple Music playlist link. In Apple Music open the playlist, choose Share, then Copy Link.');
  }
  const pageUrl = `https://music.apple.com/${ref.storefront}/playlist/${ref.id}`;
  const res = await fetch(pageUrl, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
  if (res.status === 404) {
    throw new Error('Apple Music has no public page for that playlist. If it is yours, share it publicly in Apple Music, then copy the link again.');
  }
  if (!res.ok) throw new Error(`Could not open that Apple Music playlist (${res.status}).`);

  const { name, tracks } = tracksFromPage(await res.text());
  if (!tracks.length) throw new Error('No track names came back from that playlist.');
  return { id: ref.id, name, tracks };
}
