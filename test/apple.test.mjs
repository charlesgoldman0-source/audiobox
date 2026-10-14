// Tests the Apple Music link parser and page parser on synthetic markup. No network.
import assert from 'node:assert/strict';
import { playlistRefFrom, tracksFromPage } from '../src/server/apple.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const page = (sections, schema) => {
  const ssd = JSON.stringify({ data: [{ intent: {}, data: { sections } }], userTokenHash: 'x' });
  const ld = schema ? `<script id="schema:music-playlist" type="application/ld+json">${JSON.stringify(schema)}</script>` : '';
  return `<html><head><title>x</title>${ld}</head><body><script type="application/json" id="serialized-server-data">${ssd}</script></body></html>`;
};
const header = (title) => ({ itemKind: 'containerDetailHeaderLockup', items: [{ title }] });
const tracks = (items) => ({ itemKind: 'trackLockup', items });

test('reads user-made, editorial, slug-less and bare playlist references', () => {
  assert.deepEqual(playlistRefFrom('https://music.apple.com/za/playlist/late-night/pl.u-AbCd123'), { storefront: 'za', id: 'pl.u-AbCd123' });
  assert.deepEqual(playlistRefFrom('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'), { storefront: 'us', id: 'pl.f4d106fed2bd41149aaacabb233eb5eb' });
  assert.deepEqual(playlistRefFrom('https://music.apple.com/gb/playlist/pl.abc?l=en-GB'), { storefront: 'gb', id: 'pl.abc' });
  assert.deepEqual(playlistRefFrom('pl.u-xyz'), { storefront: 'us', id: 'pl.u-xyz' });
  assert.equal(playlistRefFrom('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M'), null);
  assert.equal(playlistRefFrom('https://music.apple.com/za/album/x/123'), null);
});

test('builds Artist - Title lines from the track section, one link per artist', () => {
  const html = page([header('My Set'), tracks([
    { title: 'Solar Eclipse', artistName: 'Drake & Don Toliver', subtitleLinks: [{ title: 'Drake' }, { title: 'Don Toliver' }] },
    { title: 'Envelope Depth (Liuos Remodel)', artistName: 'Davor Tosovic & Liuos', subtitleLinks: [{ title: 'Davor Tosovic' }, { title: 'Liuos' }] },
    { title: 'Deep Water (Original Mix)', artistName: 'Solo Act' },
  ])], { '@type': 'MusicPlaylist', name: 'My Set', numTracks: 3 });
  const out = tracksFromPage(html);
  assert.equal(out.name, 'My Set');
  assert.deepEqual(out.tracks.map((t) => t.line), [
    'Drake, Don Toliver - Solar Eclipse',
    'Davor Tosovic - Envelope Depth (Liuos Remodel)',
    'Solo Act - Deep Water',
  ]);
});

test('falls back to the header title when there is no schema block', () => {
  const html = page([header('Header Name'), tracks([{ title: 'A', artistName: 'B' }])]);
  assert.equal(tracksFromPage(html).name, 'Header Name');
});

test('strips invisible direction marks from names', () => {
  const html = page([tracks([{ title: '‎Song', artistName: 'Act‎' }])], { name: '‎Marked Name' });
  const out = tracksFromPage(html);
  assert.equal(out.name, 'Marked Name');
  assert.equal(out.tracks[0].line, 'Act - Song');
});

test('refuses a page without a track list rather than guessing', () => {
  assert.throws(() => tracksFromPage(page([header('Empty')])), /No track list was found/);
  assert.throws(() => tracksFromPage('<html>nothing here</html>'), /Could not read that Apple Music page/);
});

console.log(`\n${passed} apple tests passed`);
