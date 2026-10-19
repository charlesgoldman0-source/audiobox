// Tests the Spotify link parsers. Pure functions, no network and no account.
import assert from 'node:assert/strict';
import { playlistIdFrom, trackIdFrom, matchesTrack } from '../src/server/spotify.js';

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

test('a search result counts only when both the title and the artist share words', () => {
  assert.equal(matchesTrack({ artist: 'Daft Punk', title: 'Around the World' }, { name: "Around the World", artists: [{ name: "Daft Punk" }] }), true);
  assert.equal(matchesTrack({ artist: 'Ricardo Villalobos', title: 'Dexter' }, { name: "Dexter", artists: [{ name: "Someone Else" }] }), false);
  assert.equal(matchesTrack({ artist: 'Daft Punk', title: 'Around the World' }, { name: "Around the World (Radio Edit)", artists: [{ name: "Daft Punk" }] }), true);
  assert.equal(matchesTrack({ artist: 'Dan White, Aleya Mae', title: 'Mesmerise' }, { name: "Mesmerise (Extended Mix)", artists: [{ name: "Dan White (UK)" }, { name: "Aleya Mae" }] }), true);
});

test('accents are ignored and a blank artist needs the title to match almost completely', () => {
  assert.equal(matchesTrack({ artist: 'ADÉLA', title: 'Nicole Kidman' }, { name: "Nicole Kidman", artists: [{ name: "Adela" }] }), true);
  assert.equal(matchesTrack({ artist: '', title: 'Mesmerise' }, { name: "Mesmerise (Extended Mix)", artists: [{ name: "Dan White" }] }), true);
  assert.equal(matchesTrack({ artist: '', title: 'Mesmerise' }, { name: "Mesmerise Me Tonight Forever", artists: [{ name: "Nobody" }] }), false);
});

console.log(`\n${passed} spotify tests passed`);
