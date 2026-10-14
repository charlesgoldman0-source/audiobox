// Tests the SoundCloud link parser, page parser and naming rule on synthetic data. No network.
import assert from 'node:assert/strict';
import { setRefFrom, playlistFromPage, trackToLine } from '../src/server/soundcloud.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };

const page = (hydration) => `<html><body><script>window.__sc_hydration = ${JSON.stringify(hydration)};</script></body></html>`;

test('accepts set links, private share links, mobile and short links, and nothing else', () => {
  assert.deepEqual(setRefFrom('https://soundcloud.com/danwhitedj/sets/groovy-minimal?ref=x'), { url: 'https://soundcloud.com/danwhitedj/sets/groovy-minimal', short: false });
  assert.deepEqual(setRefFrom('https://m.soundcloud.com/user_1/sets/my-set/s-AbC12'), { url: 'https://soundcloud.com/user_1/sets/my-set/s-AbC12', short: false });
  assert.deepEqual(setRefFrom('https://on.soundcloud.com/Xy12z'), { url: 'https://on.soundcloud.com/Xy12z', short: true });
  assert.equal(setRefFrom('https://soundcloud.com/someone/a-single-track'), null);
  assert.equal(setRefFrom('https://open.spotify.com/playlist/abc'), null);
});

test('reads the playlist out of the page hydration block', () => {
  const html = page([{ hydratable: 'user', data: {} }, { hydratable: 'playlist', data: {
    id: 42, title: '  Late Night  ', permalink: 'late-night', secret_token: null,
    user: { permalink: 'dj-x' }, tracks: [{ id: 1, title: 'A - B' }, { id: 2 }],
  } }]);
  const pl = playlistFromPage(html);
  assert.equal(pl.id, 42);
  assert.equal(pl.title, 'Late Night');
  assert.equal(pl.user, 'dj-x');
  assert.equal(pl.tracks.length, 2);
  assert.throws(() => playlistFromPage(page([{ hydratable: 'sound', data: {} }])), /did not open as a playlist/);
  assert.throws(() => playlistFromPage('<html>no block</html>'), /Could not read that SoundCloud page/);
});

test('label metadata wins over the typed title', () => {
  assert.equal(trackToLine({ title: 'SGR087 - Sidney Charles - No Way Out', publisher_metadata: { artist: 'Sidney Charles' } }).line, 'Sidney Charles - No Way Out');
  assert.equal(trackToLine({ title: 'Jam Is Pumping', publisher_metadata: { artist: 'Josh Baker', release_title: 'Jam Is Pumping' } }).line, 'Josh Baker - Jam Is Pumping');
});

test('splits a typed Artist - Title and drops a catalogue code from either end', () => {
  assert.equal(trackToLine({ title: 'Gaskin - Closer ep - uts20' }).line, 'Gaskin - Closer ep');
  assert.equal(trackToLine({ title: 'VOY012 - Some Act - Night Drive' }).line, 'Some Act - Night Drive');
  assert.equal(trackToLine({ title: 'Josh Baker & Kieran Morgan - Together' }).line, 'Josh Baker, Kieran Morgan - Together');
  assert.equal(trackToLine({ title: 'Julian Fijma- Late Night Schemes' }).line, 'Julian Fijma - Late Night Schemes');
  assert.equal(trackToLine({ title: 'Hi-Fi Lover' }).line, 'Hi-Fi Lover');
});

test('strips promo wording and leaves the artist blank rather than guess', () => {
  assert.equal(trackToLine({ title: 'PREMIERE: Deep Water (Original Mix)' }).line, 'Deep Water');
  assert.equal(trackToLine({ title: 'Solo Track' }).artist, '');
  assert.equal(trackToLine({ title: 'My Paradise **FREE DL**', publisher_metadata: { artist: 'The Trip' } }).line, 'The Trip - My Paradise');
  assert.equal(trackToLine({ title: 'Night Drive (Out Now on Solid Grooves)', publisher_metadata: { artist: 'Someone' } }).line, 'Someone - Night Drive');
});

console.log(`\n${passed} soundcloud tests passed`);
