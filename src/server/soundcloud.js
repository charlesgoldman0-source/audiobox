// SoundCloud playlist reader (public sets, and private sets through their share link).
//
// Reads a set's track names and returns each as a clean "Artist - Title" line for a manual
// Soulseek search. It never downloads audio. SoundCloud stopped issuing API keys years ago,
// so there is no sign-in: the reader uses the set's public page, which embeds the first
// few tracks in full and the rest as IDs, and then the same metadata call the page itself
// makes to fill the IDs in, with the client id the page ships in its own scripts.
//
// SoundCloud titles are free text typed by uploaders, so naming is best effort and never
// invented: the label's publisher metadata wins when present, then an "Artist - Title"
// split of the title, else the title alone with the artist left blank.

import { cleanTitle, cleanArtist, dropBracketCredits } from '../engine/clean.js';
import { defaultConfig } from '../engine/config.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const API = 'https://api-v2.soundcloud.com';
const BATCH = 50; // the tracks call accepts up to 50 ids
const PAUSE_MS = 150; // between batches, so a 500-track set is not a burst

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function get(url) {
  return fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
}

// Accepts a set link and returns { url, short }, or null. A set link looks like
// https://soundcloud.com/<user>/sets/<slug>, optionally followed by /s-<token> for a private
// set's share link. Short on.soundcloud.com links are followed to their target in listTracks.
export function setRefFrom(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const short = raw.match(/^https?:\/\/on\.soundcloud\.com\/[a-zA-Z0-9]+/);
  if (short) return { url: short[0], short: true };
  const m = raw.match(/^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([a-z0-9_-]+)\/sets\/([a-z0-9_-]+)(\/s-[a-zA-Z0-9]+)?/i);
  if (!m) return null;
  const token = m[3] || '';
  return { url: 'https://soundcloud.com/' + m[1] + '/sets/' + m[2] + token, short: false };
}

// A single track link: https://soundcloud.com/<user>/<slug> where the slug is not "sets",
// optionally followed by /s-<token> for a private track. Profile sections such as /likes
// match this shape too; their page carries no track, which listTracks reports plainly.
export function trackRefFrom(input) {
  const raw = String(input || '').trim();
  const m = raw.match(/^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([a-z0-9_-]+)\/(?!sets(?:\/|$))([a-z0-9_-]+)(\/s-[a-zA-Z0-9]+)?/i);
  if (!m) return null;
  return { url: 'https://soundcloud.com/' + m[1] + '/' + m[2] + (m[3] || '') };
}

// A catalogue code such as SGR087, uts20 or VOY-012: letters and digits, no spaces.
const CATALOGUE_RE = /^[a-z]{1,8}[-_ ]?\d{1,4}[a-z]?$/i;
const DASH_SPLIT_RE = /\s+-\s*|\s*-\s+/;
// Uploader promo wording the generic cleaner does not know about: a shouted prefix, a
// bracketed "out now on ..." note, and decorative asterisks.
const SC_PREFIX_RE = /^\s*(?:premiere|out now|free download|free dl)\s*[:|-]?\s*/i;
const SC_BRACKET_RE = /\s*[(\[]\s*(?:out now|forthcoming|free download|free dl|premiere|snippet|preview)[^)\]]*[)\]]/gi;

function tidy(value) {
  return String(value || '').replace(/\*+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Builds the line from a track record. Exported for tests.
export function trackToLine(track) {
  const pub = (track && track.publisher_metadata) || {};
  let artist = tidy(pub.artist);
  let title = tidy(track && track.title).replace(SC_PREFIX_RE, '').replace(SC_BRACKET_RE, ' ').trim();

  // A dash with a space on at least one side is the uploader's "Artist - Title" separator;
  // "Name- Title" and "Name -Title" count, "Hi-Fi" does not.
  if (DASH_SPLIT_RE.test(title)) {
    const parts = title.split(DASH_SPLIT_RE).map((p) => p.trim()).filter(Boolean);
    // Drop a catalogue code from either end, then the first part is the artist.
    if (parts.length > 2 && CATALOGUE_RE.test(parts[0])) parts.shift();
    if (parts.length > 2 && CATALOGUE_RE.test(parts[parts.length - 1])) parts.pop();
    if (parts.length >= 2) {
      if (!artist) artist = parts[0];
      title = parts.slice(1).join(' - ');
    }
  } else if (artist && pub.release_title) {
    title = tidy(pub.release_title);
  }

  const cleaned = cleanTitle(title);
  const finalTitle = cleaned.title;
  const finalArtist = dropBracketCredits(cleanArtist(artist, cleaned.feats, defaultConfig), finalTitle);
  const line = (finalArtist + ' - ' + finalTitle).replace(/^ - | - $/g, '').trim();
  return { artist: finalArtist, title: finalTitle, line };
}

// Parses a set page. Exported so it can be tested on saved markup without the network.
export function playlistFromPage(html) {
  const block = String(html || '').match(/window\.__sc_hydration\s*=\s*(\[.+?\]);\s*<\/script>/s);
  if (!block) throw new Error('Could not read that SoundCloud page. Check that the link is to a playlist (a set), not a single track.');
  let hydration;
  try { hydration = JSON.parse(block[1]); } catch { throw new Error('Could not read the track names on that SoundCloud page.'); }
  const entry = hydration.find((h) => h && h.hydratable === 'playlist');
  if (!entry || !entry.data) {
    throw new Error('That SoundCloud link did not open as a playlist. Check the link, and if the set is private use its share link from SoundCloud\'s Share menu.');
  }
  const data = entry.data;
  return {
    id: data.id,
    title: tidy(data.title),
    user: (data.user && data.user.permalink) || '',
    permalink: data.permalink || '',
    secretToken: data.secret_token || '',
    tracks: Array.isArray(data.tracks) ? data.tracks : [],
  };
}

// Parses a single track page. Exported for tests.
export function soundFromPage(html) {
  const block = String(html || '').match(/window\.__sc_hydration\s*=\s*(\[.+?\]);\s*<\/script>/s);
  if (!block) throw new Error('Could not read that SoundCloud page. Check the link.');
  let hydration;
  try { hydration = JSON.parse(block[1]); } catch { throw new Error('Could not read that SoundCloud page.'); }
  const entry = hydration.find((h) => h && h.hydratable === 'sound');
  if (!entry || !entry.data || !entry.data.title) {
    throw new Error('That SoundCloud link did not open as a track or a playlist. Open the track or set on SoundCloud, choose Share, then Copy Link.');
  }
  return entry.data;
}

// The client id the page ships in its own scripts. Cached for the process; refreshed when
// SoundCloud rejects it.
let cachedClientId = '';
async function clientIdFromPage(html) {
  if (cachedClientId) return cachedClientId;
  const assets = [...String(html).matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
  for (const asset of assets.reverse()) {
    try {
      const js = await (await get(asset)).text();
      const m = js.match(/client_id\s*[:=]\s*"([a-zA-Z0-9]{32})"/);
      if (m) { cachedClientId = m[1]; return cachedClientId; }
    } catch { /* try the next script */ }
  }
  throw new Error('Could not read the SoundCloud page scripts that the track list depends on. Try again later.');
}

// Fills in tracks the page listed by id only, keeping the set's order.
async function fillTracks(tracks, html, playlist) {
  const byId = new Map(tracks.filter((t) => t && t.title).map((t) => [t.id, t]));
  const missing = tracks.filter((t) => t && !t.title).map((t) => t.id);
  if (missing.length) {
    let clientId = await clientIdFromPage(html);
    for (let i = 0; i < missing.length; i += BATCH) {
      const ids = missing.slice(i, i + BATCH);
      const query = new URLSearchParams({ ids: ids.join(','), client_id: clientId });
      if (playlist.secretToken) {
        query.set('playlistId', String(playlist.id));
        query.set('playlistSecretToken', playlist.secretToken);
      }
      let res = await get(API + '/tracks?' + query.toString());
      if (res.status === 401 || res.status === 403) {
        cachedClientId = '';
        clientId = await clientIdFromPage(html);
        query.set('client_id', clientId);
        res = await get(API + '/tracks?' + query.toString());
      }
      if (!res.ok) throw new Error('SoundCloud refused the track details (' + res.status + '). Try again in a minute.');
      for (const t of await res.json()) if (t && t.id) byId.set(t.id, t);
      if (i + BATCH < missing.length) await sleep(PAUSE_MS);
    }
  }
  return tracks.map((t) => byId.get(t.id)).filter((t) => t && t.title);
}

// Returns { id, name, tracks } in the same shape as the Spotify and Apple readers.
export async function listTracks(input) {
  const setRef = setRefFrom(input);
  const trackRef = setRef ? null : trackRefFrom(input);
  const ref = setRef || trackRef;
  if (!ref) throw new Error('That is not a SoundCloud link. Open the set or track on SoundCloud, choose Share, then Copy Link.');

  const res = await get(ref.url);
  if (res.status === 404) throw new Error('SoundCloud has no page for that link. If it is yours, make it public or use its private share link.');
  if (!res.ok) throw new Error('Could not open that SoundCloud link (' + res.status + ').');
  const html = await res.text();

  // A short link reveals what it is only after the redirect; otherwise the link shape says.
  const isSet = setRef ? (!setRef.short || /\/sets\//.test(res.url || '')) : false;
  if (!isSet) {
    const sound = soundFromPage(html);
    return { id: 'track-' + sound.id, name: '', single: true, tracks: [trackToLine(sound)] };
  }

  const playlist = playlistFromPage(html);
  const full = await fillTracks(playlist.tracks, html, playlist);
  const tracks = full.map(trackToLine).filter((t) => t.title);
  if (!tracks.length) throw new Error('No track names came back from that playlist.');

  const id = (playlist.user + '-' + playlist.permalink).replace(/^-|-$/g, '') || ('sc-' + playlist.id);
  return { id, name: playlist.title, tracks };
}
