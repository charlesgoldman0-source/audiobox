// Spotify playlist reader.
//
// Reads the user's own playlists (including private) and returns each track as a
// clean "Artist - Title" line for a manual Soulseek search. It never downloads audio.
//
// Auth is the Authorization Code flow with PKCE, so only a Client ID is needed (no
// secret to manage). The Client ID and the resulting tokens live in a local,
// gitignored JSON file. The redirect URI must be registered in the Spotify app
// dashboard exactly as REDIRECT_URI below (Spotify requires the 127.0.0.1 loopback,
// not localhost, for an http redirect).

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { dropBracketCredits } from '../engine/clean.js';

const here = dirname(fileURLToPath(import.meta.url));
// Same rule as the library settings: the desktop app's data folder when set, else beside the code.
const STORE = join(process.env.AUDIOBOX_DATA_DIR || join(here, '..', '..'), '.audiobox-spotify.json');

export const REDIRECT_URI = 'http://127.0.0.1:4848/api/spotify/callback';
// Read scopes for the search list, plus the one write the app ever makes: creating a private
// playlist from the current list when the user asks for it. Someone who signed in before that
// scope existed is asked to reconnect once; getState().canWrite says whether it is held.
const SCOPES = 'playlist-read-private playlist-read-collaborative playlist-modify-private';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let pending = null; // { verifier, state } for the in-flight auth attempt

function load() {
  try { return JSON.parse(readFileSync(STORE, 'utf8')); }
  catch { return {}; }
}

function save(data) {
  writeFileSync(STORE, JSON.stringify(data, null, 2));
}

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getState() {
  const data = load();
  return {
    configured: Boolean(data.clientId),
    connected: Boolean(data.refreshToken),
    canWrite: /playlist-modify-private/.test(data.scope || ''),
  };
}

export function setClientId(clientId) {
  const data = load();
  data.clientId = String(clientId || '').trim();
  save(data);
}

export function disconnect() {
  const data = load();
  delete data.accessToken;
  delete data.refreshToken;
  delete data.expiresAt;
  save(data);
}

export function buildAuthUrl() {
  const data = load();
  if (!data.clientId) throw new Error('Set your Spotify Client ID first.');
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  pending = { verifier, state };
  const params = new URLSearchParams({
    client_id: data.clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES,
  });
  return `https://accounts.spotify.com/authorize?${params.toString()}`;
}

export async function handleCallback(code, state) {
  if (!pending || state !== pending.state) {
    throw new Error('The Spotify sign-in could not be matched. Connect again.');
  }
  const data = load();
  const body = new URLSearchParams({
    client_id: data.clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: pending.verifier,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Spotify sign-in failed (${res.status}). Check the Client ID and redirect URI.`);
  const token = await res.json();
  data.accessToken = token.access_token;
  data.refreshToken = token.refresh_token;
  data.scope = token.scope || '';
  data.expiresAt = Date.now() + token.expires_in * 1000 - 30000;
  save(data);
  pending = null;
}

async function accessToken() {
  const data = load();
  if (!data.refreshToken) throw new Error('Connect your Spotify account first.');
  if (data.accessToken && Date.now() < data.expiresAt) return data.accessToken;

  const body = new URLSearchParams({
    client_id: data.clientId,
    grant_type: 'refresh_token',
    refresh_token: data.refreshToken,
  });
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error('Spotify session expired. Connect again.');
  const token = await res.json();
  data.accessToken = token.access_token;
  if (token.refresh_token) data.refreshToken = token.refresh_token;
  if (token.scope) data.scope = token.scope;
  data.expiresAt = Date.now() + token.expires_in * 1000 - 30000;
  save(data);
  return data.accessToken;
}

// Turns a failed Spotify response into an error that carries Spotify's own reason, and logs
// it on the server, so a refusal is never reported as a vague "failed".
async function failure(res, method, path) {
  let reason = '';
  try {
    const text = await res.text();
    try { reason = JSON.parse(text).error.message || ''; } catch { reason = text.slice(0, 120); }
  } catch { /* no body */ }
  console.error(`[spotify] ${method} ${path} -> ${res.status}${reason ? ` ${reason}` : ''}`);
  if (res.status === 401) return new Error('Spotify session expired. Connect again.');
  const detail = reason ? ` (${res.status}, ${reason})` : ` (${res.status})`;
  if (res.status === 403) return new Error(`Spotify refused that request${detail}.`);
  if (res.status === 429) return new Error(`Spotify is rate limiting${detail}. Wait a minute and try again.`);
  return new Error(`Spotify request failed${detail}.`);
}

async function api(path, attempt = 0) {
  const token = await accessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // A long list means many searches in a row; honour Spotify's pause instead of failing.
  if (res.status === 429 && attempt < 2) {
    const wait = Math.min(Number(res.headers.get('retry-after') || 2), 15);
    await sleep(wait * 1000);
    return api(path, attempt + 1);
  }
  if (!res.ok) throw await failure(res, 'GET', path);
  return res.json();
}

async function apiSend(method, path, body) {
  const token = await accessToken();
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await failure(res, method, path);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

function nextPath(next) {
  return next ? next.replace('https://api.spotify.com/v1', '') : null;
}

// Spotify formats a version as "Title - Descriptor" and lists the remixer among the
// artists. Convert to "Title (Descriptor)", drop a redundant "Original Mix", and take any
// artist named in the bracket out of the artist field (it belongs in the title). Keying on
// the name in the bracket, not a keyword list, also catches unusual wording like "Remodel".
export function normalizeSpotifyTrack(artistStr, rawTitle) {
  const artists = String(artistStr || '').split(',').map((a) => a.trim()).filter(Boolean);
  let title = String(rawTitle || '').trim();

  const idx = title.lastIndexOf(' - ');
  if (idx > 0) {
    const base = title.slice(0, idx).trim();
    const descriptor = title.slice(idx + 3).trim();
    title = /^original(\s+(?:mix|version))?$/i.test(descriptor) ? base : `${base} (${descriptor})`;
  }

  return { artist: dropBracketCredits(artists.join(', '), title), title };
}

// ---- Playlist creation: the one write the app makes ----

// Accents are split off by NFKD and then deleted (not replaced), so "ADÉLA" becomes
// "adela" rather than "ade la". The combining-mark range is built from code points to keep
// the source plain ASCII.
const COMBINING_MARKS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');

function tokenize(value) {
  return new Set(String(value || '').toLowerCase().normalize('NFKD').replace(COMBINING_MARKS_RE, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 1));
}

function titleTokens(value) {
  return tokenize(String(value || '').replace(/\s*[(\[][^)\]]*[)\]]/g, ' '));
}

function overlap(a, b, denominator) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / denominator(a.size, b.size);
}

// Decides whether a search result is the track on the list. Both the title and the artist
// have to share words, so Spotify's "best guess" for an underground title cannot slip in as a
// different record. A line with no artist (some SoundCloud uploads) needs the title alone to
// match almost completely. Exported for tests.
export function matchesTrack(track, item) {
  const title = titleTokens(track && track.title);
  const candidate = titleTokens(item && item.name);
  const artist = String((track && track.artist) || '').trim();
  if (!artist) return overlap(title, candidate, Math.max) >= 0.6;
  if (overlap(title, candidate, Math.min) < 0.5) return false;
  const names = ((item && item.artists) || []).map((a) => a && a.name).filter(Boolean).join(' ');
  return overlap(tokenize(artist), tokenize(names), Math.min) >= 0.5;
}

async function findTrackUri(track) {
  const query = [track.artist, track.title].map((v) => String(v || '').trim()).filter(Boolean).join(' ');
  if (!query) return null;
  const data = await api(`/search?q=${encodeURIComponent(query)}&type=track&limit=5`);
  const items = (data.tracks && data.tracks.items) || [];
  const hit = items.find((item) => matchesTrack(track, item));
  return hit ? hit.uri : null;
}

// Creates a private playlist on the signed-in account from the current list. Tracks that
// are not on Spotify are reported by line so they can still be searched by hand; nothing is
// guessed. Uses /me/playlists and /playlists/{id}/items, the routes Spotify kept for
// Development Mode apps (the older /users/{id}/playlists and /tracks forms return 403).
export async function createPlaylistFromTracks(name, tracks) {
  if (!getState().canWrite) throw new Error('Spotify needs one more permission to create playlists. Reconnect Spotify, then try again.');
  const uris = [];
  const seen = new Set();
  const missing = [];
  for (const track of tracks) {
    let uri = null;
    try { uri = await findTrackUri(track); } catch (error) {
      console.error(`[spotify] search failed for "${track.line || track.title}": ${error.message}`);
    }
    if (uri && !seen.has(uri)) { seen.add(uri); uris.push(uri); }
    else if (!uri) missing.push(track.line || `${track.artist} - ${track.title}`.trim());
  }
  if (!uris.length) throw new Error('None of these tracks were found on Spotify, so no playlist was made.');

  const playlist = await apiSend('POST', '/me/playlists', {
    name: String(name || '').trim() || 'Audiobox list',
    public: false,
    description: 'Made by Audiobox from a search list. Tracks not on Spotify were left out.',
  });
  for (let i = 0; i < uris.length; i += 100) {
    await apiSend('POST', `/playlists/${playlist.id}/items`, { uris: uris.slice(i, i + 100) });
  }
  return {
    url: (playlist.external_urls && playlist.external_urls.spotify) || '',
    name: playlist.name,
    matched: uris.length,
    total: tracks.length,
    missing,
  };
}

export async function listPlaylists() {
  const out = [];
  let path = '/me/playlists?limit=50';
  while (path) {
    const data = await api(path);
    for (const p of data.items || []) {
      if (!p) continue;
      out.push({ id: p.id, name: p.name, owner: p.owner ? p.owner.display_name : '', public: p.public !== false });
    }
    path = nextPath(data.next);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// Accepts a playlist link, a spotify: URI, or a bare ID and returns the ID. Lets someone
// paste straight from the Spotify share menu without signing in at all.
export function playlistIdFrom(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const match = raw.match(/(?:open\.spotify\.com\/(?:[a-z-]{2,12}\/)?playlist\/|spotify:playlist:)([a-zA-Z0-9]+)/);
  if (match) return match[1];
  return /^[a-zA-Z0-9]{16,40}$/.test(raw) ? raw : '';
}

// Accepts a track link or a spotify:track: URI and returns the track ID, else ''.
export function trackIdFrom(input) {
  const raw = String(input || '').trim();
  const match = raw.match(/(?:open\.spotify\.com\/(?:[a-z-]{2,12}\/)?track\/|spotify:track:)([a-zA-Z0-9]+)/);
  return match ? match[1] : '';
}

function toLine(artist, title) {
  return { artist, title, line: `${artist} - ${title}`.replace(/^ - | - $/g, '').trim() };
}

// Reads a playlist through the Web API. Development Mode apps keep access to
// GET /playlists/{id}/items, but Spotify only returns `items` for playlists the signed-in
// user owns or collaborates on; for anything else the field is absent. Verified against
// Spotify's February 2026 migration guide. Returns null when there is no usable items
// field, so the caller can fall back to the public page.
async function tracksViaApi(playlistId) {
  const out = [];
  let path = `/playlists/${playlistId}/items?limit=100`;
  let sawItemsField = false;
  while (path) {
    const data = await api(path);
    if (!Array.isArray(data.items)) break;
    sawItemsField = true;
    for (const entry of data.items) {
      const track = entry && entry.track;
      if (!track || !track.name) continue;
      const artistStr = (track.artists || []).map((a) => a.name).join(', ');
      const { artist, title } = normalizeSpotifyTrack(artistStr, track.name);
      out.push(toLine(artist, title));
    }
    path = nextPath(data.next);
  }
  if (!sawItemsField) return null;

  // The name is only used to label the folder, so a failure here is not worth failing the
  // read over. The caller falls back to the playlist ID.
  let name = '';
  try {
    const meta = await api(`/playlists/${playlistId}`);
    name = (meta && meta.name) || '';
  } catch { /* metadata is optional */ }

  return { name, tracks: out };
}

// Reads a playlist's track names from Spotify's public embed page. This needs no account
// and no Client ID, which is how someone can use Audiobox with nothing set up, but it only
// works for public playlists and depends on the page's own markup.
async function tracksViaPublicPage(playlistId) {
  const res = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (!res.ok) throw new Error(`Could not open that playlist (${res.status}).`);

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!match) {
    throw new Error('Could not read the track names. If this playlist is private, sign in to Spotify in Audiobox, or make the playlist public.');
  }

  let trackList = [];
  let name = '';
  try {
    const data = JSON.parse(match[1]);
    const pageProps = (data.props && data.props.pageProps) || {};
    const entity = (pageProps.state && pageProps.state.data && pageProps.state.data.entity) || pageProps.entity || {};
    trackList = entity.trackList || [];
    name = entity.name || entity.title || '';
  } catch {
    throw new Error('Could not read the track names for that playlist.');
  }

  if (!trackList.length) {
    throw new Error('No track names came back. If this playlist is private, sign in to Spotify in Audiobox, or make the playlist public.');
  }

  return {
    name,
    tracks: trackList.map((t) => {
      const { artist, title } = normalizeSpotifyTrack(t.subtitle, t.title);
      return toLine(artist, title);
    }),
  };
}

async function trackViaApi(trackId) {
  const track = await api(`/tracks/${trackId}`);
  const artistStr = (track.artists || []).map((a) => a.name).join(', ');
  const { artist, title } = normalizeSpotifyTrack(artistStr, track.name);
  return toLine(artist, title);
}

// One track from its public embed page, which needs no account.
async function trackViaPublicPage(trackId) {
  const res = await fetch(`https://open.spotify.com/embed/track/${trackId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (!res.ok) throw new Error(`Could not open that Spotify track (${res.status}).`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!match) throw new Error('Could not read that Spotify track. Check the link.');
  let entity = {};
  try {
    const data = JSON.parse(match[1]);
    const pageProps = (data.props && data.props.pageProps) || {};
    entity = (pageProps.state && pageProps.state.data && pageProps.state.data.entity) || pageProps.entity || {};
  } catch { throw new Error('Could not read that Spotify track.'); }
  const name = entity.name || entity.title || '';
  if (!name) throw new Error('No track name came back for that Spotify link.');
  const artistStr = Array.isArray(entity.artists) ? entity.artists.map((a) => a && a.name).filter(Boolean).join(', ') : String(entity.subtitle || '');
  const { artist, title } = normalizeSpotifyTrack(artistStr, name);
  return toLine(artist, title);
}

// Reads one track, through the Web API when signed in and the public page otherwise.
export async function readTrack(trackId) {
  if (getState().connected) {
    try { return await trackViaApi(trackId); } catch (error) {
      console.error(`[spotify] API read of track ${trackId} failed, trying the public page: ${error.message}`);
    }
  }
  return trackViaPublicPage(trackId);
}

// Reads a playlist's tracks. Prefers the Web API when the user is signed in, because that
// is the only way to read their private playlists. Falls back to the public page when they
// are not signed in, or when the playlist is not one of theirs.
//
// Returns { id, name, tracks }. The resolved ID matters: the caller stores it and names a
// folder from it, so a pasted URL must never be passed along as an identifier.
export async function listTracks(input) {
  // A single track link adds one line; the caller appends it to the current list.
  const trackId = trackIdFrom(input);
  if (trackId) {
    return { id: `track-${trackId}`, name: '', single: true, tracks: [await readTrack(trackId)] };
  }

  const id = playlistIdFrom(input);
  if (!id) {
    throw new Error('That is not a Spotify playlist or track link. Copy the link from Spotify’s Share menu.');
  }

  if (getState().connected) {
    try {
      const viaApi = await tracksViaApi(id);
      if (viaApi && viaApi.tracks.length) return { id, ...viaApi };
    } catch (error) {
      // A playlist the user does not own, or an expired session, should still fall through
      // to the public page rather than dead-end. The reason is logged for diagnosis.
      console.error(`[spotify] API read of ${id} failed, trying the public page: ${error.message}`);
    }
  }

  return { id, ...(await tracksViaPublicPage(id)) };
}
