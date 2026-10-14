// Diagnostic v2: read headers and try variations to pin down the 403.
// Run with: node --use-system-ca test/spotify-debug.mjs   (server must be running)
import { readFileSync } from 'node:fs';

const FILE = new URL('../.audiobox-spotify.json', import.meta.url);
await fetch('http://localhost:4848/api/spotify/playlists'); // refresh token
const token = JSON.parse(readFileSync(FILE, 'utf8')).accessToken;

async function probe(label, path) {
  const r = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  let body;
  try { body = await r.json(); } catch { body = await r.text(); }
  const wwwAuth = r.headers.get('www-authenticate');
  console.log(`\n[${label}] ${r.status}  ${path}`);
  if (wwwAuth) console.log('   www-authenticate:', wwwAuth);
  console.log('   body:', JSON.stringify(body).slice(0, 300));
  return { status: r.status, body };
}

const mp = await fetch('https://api.spotify.com/v1/me/playlists?limit=10', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const items = (mp.items || []).filter(Boolean);
console.log('first playlist raw item:', JSON.stringify(items[0]).slice(0, 600));

const id = items[0].id;
await probe('tracks plain', `/playlists/${id}/tracks?limit=5`);
await probe('tracks market', `/playlists/${id}/tracks?market=US&limit=5`);
await probe('tracks fields', `/playlists/${id}/tracks?fields=total,items(track(name))&limit=5`);
await probe('playlist fields total', `/playlists/${id}?fields=name,tracks.total`);
await probe('saved tracks', '/me/tracks?limit=1');

// A second user-owned playlist, in case the first is special.
const second = items.find((p) => p.owner && p.owner.id === mp.items[0].owner.id && p.id !== id);
if (second) await probe('second owned tracks', `/playlists/${second.id}/tracks?limit=5`);
