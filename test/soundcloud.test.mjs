// Tests the SoundCloud link parser, page parser and naming rule on synthetic data. No network.
import assert from 'node:assert/strict';
import { setRefFrom, playlistFromPage, trackToLine, trackRefFrom, soundFromPage } from '../src/server/soundcloud.js';

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
  assert.equal(trackToLine({ title: 'Rossi. – Little Man' }).line, 'Rossi - Little Man');
  assert.equal(trackToLine({ title: 'SOSA — Funkboy' }).line, 'SOSA - Funkboy');
});

test('strips promo wording and falls back to the uploader only when it looks like an artist', () => {
  assert.equal(trackToLine({ title: 'PREMIERE: Deep Water (Original Mix)' }).line, 'Deep Water');
  assert.equal(trackToLine({ title: 'Solo Track' }).artist, '');
  assert.equal(trackToLine({ title: 'Subconscious', user: { username: 'MANT' } }).line, 'MANT - Subconscious');
  assert.equal(trackToLine({ title: 'Neem De Tijd', user: { username: 'Across Boundaries' } }).line, 'Across Boundaries - Neem De Tijd');
  assert.equal(trackToLine({ title: 'Night Drive', user: { username: 'Solid Grooves Records' } }).artist, '');
  assert.equal(trackToLine({ title: 'Gaskin - Closer', user: { username: 'Some Label Records' } }).line, 'Gaskin - Closer');
  assert.equal(trackToLine({ title: 'Niclas, lerg - Ground Zero (Fedo Remix)', publisher_metadata: { artist: 'Junjo Records' } }).line, 'Niclas, lerg - Ground Zero (Fedo Remix)');
  assert.equal(trackToLine({ title: 'Ground Zero (Fedo Remix)', publisher_metadata: { artist: 'Junjo Records' }, user: { username: 'Junjo Records' } }).artist, '');
  assert.equal(trackToLine({ title: 'My Paradise **FREE DL**', publisher_metadata: { artist: 'The Trip' } }).line, 'The Trip - My Paradise');
  assert.equal(trackToLine({ title: 'Night Drive (Out Now on Solid Grooves)', publisher_metadata: { artist: 'Someone' } }).line, 'Someone - Night Drive');
});

test('accepts single track links and keeps set links apart', () => {
  assert.deepEqual(trackRefFrom('https://soundcloud.com/apexfaction/dan-white-mesmerise?in=x'), { url: 'https://soundcloud.com/apexfaction/dan-white-mesmerise' });
  assert.deepEqual(trackRefFrom('https://m.soundcloud.com/user_1/secret-track/s-AbC12'), { url: 'https://soundcloud.com/user_1/secret-track/s-AbC12' });
  assert.equal(trackRefFrom('https://soundcloud.com/apexfaction/sets/my-set'), null);
  assert.equal(trackRefFrom('https://soundcloud.com/apexfaction/sets'), null);
});

test('reads one track out of a track page', () => {
  const html = page([{ hydratable: 'sound', data: { id: 7, title: 'Dan White & Aleya Mae - Mesmerise', publisher_metadata: { artist: 'Dan White, Aleya Mae' } } }]);
  assert.equal(soundFromPage(html).id, 7);
  assert.equal(trackToLine(soundFromPage(html)).line, 'Dan White, Aleya Mae - Mesmerise');
  assert.throws(() => soundFromPage(page([{ hydratable: 'user', data: {} }])), /did not open as a track/);
});

console.log(`\n${passed} soundcloud tests passed`);
