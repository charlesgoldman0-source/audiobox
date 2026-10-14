// Tests the Spotify link parsers. Pure functions, no network and no account.
import assert from 'node:assert/strict';
import { playlistIdFrom, trackIdFrom } from '../src/server/spotify.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

test('reads a track id from share links, regional links and URIs', () => {
  assert.equal(trackIdFrom('https://open.spotify.com/track/1pKYYY0dkg23sQQXi0Q5zN?si=abc'), '1pKYYY0dkg23sQQXi0Q5zN');
  assert.equal(trackIdFrom('https://open.spotify.com/intl-de/track/1pKYYY0dkg23sQQXi0Q5zN'), '1pKYYY0dkg23sQQXi0Q5zN');
  assert.equal(trackIdFrom('spotify:track:1pKYYY0dkg23sQQXi0Q5zN'), '1pKYYY0dkg23sQQXi0Q5zN');
  assert.equal(trackIdFrom('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), '');
});

test('a track link is never mistaken for a playlist and the reverse', () => {
  assert.equal(playlistIdFrom('https://open.spotify.com/track/1pKYYY0dkg23sQQXi0Q5zN'), '');
  assert.equal(playlistIdFrom('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x'), '37i9dQZF1DXcBWIGoYBM5M');
  assert.equal(trackIdFrom('37i9dQZF1DXcBWIGoYBM5M'), '');
});

console.log(`\n${passed} spotify link tests passed`);
