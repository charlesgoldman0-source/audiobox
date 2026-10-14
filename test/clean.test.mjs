// Cleaning and naming regression tests. Run: node test/clean.test.mjs
import { cleanTitle, cleanArtist, resolveMetadata, isBlank, dropBracketCredits } from '../src/engine/clean.js';
import { buildFilename } from '../src/engine/naming.js';
import { defaultConfig } from '../src/engine/config.js';
import { normalizeSpotifyTrack } from '../src/server/spotify.js';

let pass = 0;
let fail = 0;

function eq(label, got, want) {
  if (got === want) { pass += 1; console.log(`  ok   ${label}`); }
  else { fail += 1; console.log(`  FAIL ${label}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`); }
}

console.log('cleanTitle: basics');
eq('clean stays clean', cleanTitle('Bemolas').title, 'Bemolas');
eq('strips bitrate + url', cleanTitle('Vis [320kbps] www.site.com').title, 'Vis');
eq('strips original mix', cleanTitle('Arpeggio (Original Mix)').title, 'Arpeggio');
eq('keeps remix', cleanTitle('Kalimba (Bardo Remix)').title, 'Kalimba (Bardo Remix)');
eq('keeps extended mix', cleanTitle('Kalimba (Extended Mix)').title, 'Kalimba (Extended Mix)');
eq('strips bracketed free download', cleanTitle('Inta [FREE DOWNLOAD]').title, 'Inta');
eq('feat pulled out', cleanTitle('Tasser feat. Pariah').title, 'Tasser');
eq('feat captured', cleanTitle('Tasser feat. Pariah').feats.join('|'), 'Pariah');
eq('feat before mix, original stripped', cleanTitle('Tasser feat. Pariah (Original Mix)').title, 'Tasser');

console.log('cleanTitle: regressions from review');
eq('bare promo word kept', cleanTitle('Exclusive Beach Resort').title, 'Exclusive Beach Resort');
eq('bare out now kept', cleanTitle('Out Now Or Never').title, 'Out Now Or Never');
eq('bracketed promo stripped', cleanTitle('Track (Out Now)').title, 'Track');
eq('v2 suffix kept', cleanTitle('Acid Trip V2').title, 'Acid Trip V2');
eq('bracketed v2 stripped', cleanTitle('Track [V2]').title, 'Track');
eq('bracketed bitrate stripped', cleanTitle('Track (320kbps)').title, 'Track');
eq('word-like tld kept', cleanTitle('Going.to The Store').title, 'Going.to The Store');
eq('real domain stripped', cleanTitle('Mix at label.com').title, 'Mix at');
eq('square bracket style kept', cleanTitle('Windowlicker [Dub Mix]').title, 'Windowlicker [Dub Mix]');

console.log('cleanArtist');
eq('single artist', cleanArtist('Rhadoo'), 'Rhadoo');
eq('slash and ampersand', cleanArtist('Raresh / Rhadoo & Petre Inspirescu'), 'Raresh, Rhadoo, Petre Inspirescu');
eq('comma dedupes', cleanArtist('Sit, Sit, Cristi Cons'), 'Sit, Cristi Cons');
eq('feat folded in', cleanArtist('Blawan', ['Pariah']), 'Blawan, Pariah');
eq('bare slash name kept', cleanArtist('AC/DC'), 'AC/DC');
eq('ampersand split on by default', cleanArtist('Simon & Garfunkel'), 'Simon, Garfunkel');
eq('ampersand split can be off', cleanArtist('Simon & Garfunkel', [], { splitArtistConnectors: false }), 'Simon & Garfunkel');
eq('strips 08- track number', cleanArtist('08-Upwellings'), 'Upwellings');
eq('strips 08. track number', cleanArtist('08. Upwellings'), 'Upwellings');
eq('keeps number-led name', cleanArtist('2 Unlimited'), '2 Unlimited');
eq('keeps 50 cent', cleanArtist('50 Cent'), '50 Cent');

console.log('isBlank');
eq('empty is blank', isBlank(''), true);
eq('unknown is blank', isBlank('Unknown Artist'), true);
eq('real name not blank', isBlank('Rhadoo'), false);

console.log('resolveMetadata');
eq('tagged', resolveMetadata({ artist: 'Petre Inspirescu', title: 'Vis [320kbps]' }, 'x', defaultConfig).status, 'tagged');
const r2 = resolveMetadata({ artist: '', title: '' }, 'Dan Andrei - Nightfall', defaultConfig);
eq('parsed status', r2.status, 'parsed');
eq('parsed artist', r2.artist, 'Dan Andrei');
eq('flagged messy filename', resolveMetadata({ artist: '', title: '' }, 'track01_64kbps_dl', defaultConfig).status, 'flagged');
eq('flagged ambiguous filename', resolveMetadata({ artist: '', title: '' }, 'Label - Artist - Title', defaultConfig).status, 'flagged');
const r3 = resolveMetadata({ artist: 'Blawan', title: 'Tasser feat. Pariah' }, 'x', defaultConfig);
eq('feat moves to artist', r3.artist, 'Blawan, Pariah');
eq('feat removed from title', r3.title, 'Tasser');
const r5 = resolveMetadata({ artist: '', title: '' }, '08-Upwellings - Slow Lane (Original Mix)', defaultConfig);
eq('filename 08 and original stripped: artist', r5.artist, 'Upwellings');
eq('filename 08 and original stripped: title', r5.title, 'Slow Lane');

const keep = { ...defaultConfig, featMode: 'keep-in-title' };
const r4 = resolveMetadata({ artist: 'Main', title: 'Song feat. Guest' }, 'x', keep);
eq('keep-in-title keeps artist', r4.artist, 'Main');
eq('keep-in-title keeps feat in title', r4.title, 'Song (feat. Guest)');

console.log('dropBracketCredits: a remixer named in the title leaves the artist field');
eq('remodel remixer dropped', dropBracketCredits('Davor Tosovic, Liuos', 'Envelope Depth (Liuos Remodel)'), 'Davor Tosovic');
eq('remix remixer dropped', dropBracketCredits('Riccicomoto, Klartraum', 'Get Ready (Klartraum Remix)'), 'Riccicomoto');
eq('non-credited artists kept', dropBracketCredits('Davor Tosovic, Liuos', 'Envelope Depth'), 'Davor Tosovic, Liuos');
eq('sole artist never dropped', dropBracketCredits('Liuos', 'Envelope Depth (Liuos Remodel)'), 'Liuos');
eq('feat bracket left alone', dropBracketCredits('Main, Guest', 'Song (feat. Guest)'), 'Main, Guest');

const rmod = resolveMetadata({ artist: 'Davor Tosovic, Liuos', title: 'Envelope Depth (Liuos Remodel)' }, 'x', defaultConfig);
eq('engine drops bracket-credited artist', rmod.artist, 'Davor Tosovic');
eq('engine keeps the title intact', rmod.title, 'Envelope Depth (Liuos Remodel)');

console.log('normalizeSpotifyTrack: Spotify "Title - Remixer Remodel" form');
const sp = normalizeSpotifyTrack('Davor Tosovic, Liuos', 'Envelope Depth - Liuos Remodel');
eq('spotify artist drops remixer', sp.artist, 'Davor Tosovic');
eq('spotify descriptor bracketed', sp.title, 'Envelope Depth (Liuos Remodel)');

console.log('buildFilename');
eq('normal name', buildFilename('Artist', 'Title', '.aiff'), 'Artist - Title.aiff');
eq('forbidden-only title flags', buildFilename('Artist', '???', '.aiff'), null);
eq('empty artist flags', buildFilename('', 'Title', '.aiff'), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
