// Tests the checklist-to-file matcher. Pure function, no folders touched.
// Guards the case where two songs share an artist and only one has a file: the file
// must go to the song it actually is, not to whichever song comes first in the list.
import assert from 'node:assert/strict';
import { matchChecklist, tokens } from '../src/server/library.js';

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`  ok  ${name}`); };
const song = (artist, title) => ({ artist, title, line: `${artist} - ${title}`, got: false, file: null });
const file = (name, artist, title) => ({ name, artist, title, tokens: tokens(artist || title ? `${artist} ${title}` : name) });

test('a shared-artist file goes to the song it really is, not the first song listed', () => {
  const checklist = [song('Daniel Meister', '93'), song('Daniel Meister', 'Girls (Frink Remix)')];
  const files = [file('03 - Daniel Meister - Girls (Frink Remix).flac', 'Daniel Meister', 'Girls (Frink Remix)')];
  matchChecklist(checklist, files);
  assert.equal(checklist[0].got, false);
  assert.equal(checklist[1].got, true);
  assert.equal(checklist[1].file, files[0].name);
});

test('each file is claimed once and each song at most once', () => {
  const checklist = [song('Arkady Antsyrev', 'Tonight'), song('Arkady Antsyrev, Legit Trip', 'My Own')];
  const files = [
    file('02 - Arkady Antsyrev, Legit Trip - My Own.flac', 'Arkady Antsyrev, Legit Trip', 'My Own'),
    file('02 - Arkady Antsyrev - Tonight.flac', 'Arkady Antsyrev', 'Tonight'),
  ];
  const used = matchChecklist(checklist, files);
  assert.equal(used.size, 2);
  assert.equal(checklist[0].file, files[1].name);
  assert.equal(checklist[1].file, files[0].name);
});

test('a song with no file stays unmatched rather than taking a weak lookalike', () => {
  const checklist = [song('Jack Swift', 'Tonight')];
  const files = [file('02 - Arkady Antsyrev - Tonight.flac', 'Arkady Antsyrev', 'Tonight')];
  matchChecklist(checklist, files);
  assert.equal(checklist[0].got, false);
});

test('savedLine keeps the downloaded version descriptor', () => {
  const checklist = [song('Daniel Meister', 'Girls (Frink Remix)')];
  const files = [file('03 - Daniel Meister - Girls (Frink Remix).flac', 'Daniel Meister', 'Girls (Frink Remix)')];
  matchChecklist(checklist, files);
  assert.equal(checklist[0].savedLine, 'Daniel Meister - Girls (Frink Remix)');
});

console.log(`\n${passed} library match tests passed`);
