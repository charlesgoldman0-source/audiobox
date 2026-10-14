// Audiobox front-of-house.
//
// Choose a folder (native Windows dialog), preview what each track will become,
// then process: the signal chain advances per real engine event and the screen
// lights up with the real conversion facts. Audio analysis (BPM, key, energy) is
// the next step, so its station and readout are marked as coming.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const el = (id) => document.getElementById(id);
const stations = () => Array.from(document.querySelectorAll('.station'));

const REAL_STEPS = ['convert', 'tag', 'rename'];
const BAR_COUNT = 56;

let currentFolder = null;
let queueRows = new Map(); // file name -> <li> in the queue

// ---- Engine status ----

async function refreshEngineStatus() {
  const engine = el('engine');
  const text = el('engineText');
  try {
    const data = await (await fetch('/api/status')).json();
    if (data.ffmpeg && data.ffmpeg.ready) {
      engine.setAttribute('data-state', 'ready');
      text.textContent = `FFmpeg ${data.ffmpeg.version} ready`;
    } else {
      engine.setAttribute('data-state', 'missing');
      text.textContent = 'FFmpeg not found';
    }
  } catch {
    engine.setAttribute('data-state', 'missing');
    text.textContent = 'Engine offline';
  }
}

// ---- Waveform ----

function buildWaveform() {
  const wave = el('waveform');
  wave.innerHTML = '';
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const bar = document.createElement('span');
    bar.className = 'waveform__bar';
    wave.appendChild(bar);
  }
}

function waveHeights(seed) {
  const heights = [];
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const t = i / BAR_COUNT;
    const swell = 0.5 + 0.4 * Math.sin(t * Math.PI * 2 + seed);
    const detail = 0.18 * Math.sin(t * Math.PI * 11 + seed * 3);
    const grain = 0.12 * Math.sin(i * 12.9898 + seed * 78.233);
    heights.push(Math.max(0.2, Math.min(1, swell + detail + grain)));
  }
  return heights;
}

function setWaveform(lit, heights) {
  Array.from(document.querySelectorAll('.waveform__bar')).forEach((bar, i) => {
    if (lit) {
      bar.style.transitionDelay = reduceMotion ? '0ms' : `${i * 8}ms`;
      bar.style.transform = `scaleY(${heights[i].toFixed(3)})`;
    } else {
      bar.style.transitionDelay = '0ms';
      bar.style.transform = '';
    }
  });
}

// ---- Signal chain ----

function setChain(activeStage) {
  const activeIndex = REAL_STEPS.indexOf(activeStage);
  stations().forEach((node) => {
    const step = node.dataset.step;
    if (step === 'analyse') { node.setAttribute('data-status', 'soon'); return; }
    const stepIndex = REAL_STEPS.indexOf(step);
    if (activeStage === 'done') node.setAttribute('data-status', 'done');
    else if (activeStage === 'idle') node.removeAttribute('data-status');
    else if (stepIndex < activeIndex) node.setAttribute('data-status', 'done');
    else if (stepIndex === activeIndex) node.setAttribute('data-status', 'active');
    else node.removeAttribute('data-status');
  });
}

function clearScreen() {
  el('screen').setAttribute('data-lit', 'false');
  setWaveform(false, []);
  ['mFormat', 'mAudio', 'mVerify', 'mArtist', 'mTitle', 'mSaved'].forEach((id) => { el(id).textContent = '--'; });
}

function lightScreen(result) {
  el('screen').setAttribute('data-lit', 'true');
  el('mFormat').textContent = (result.newName.split('.').pop() || '').toUpperCase();
  el('mAudio').textContent = result.audio ? result.audio.label : '--';
  el('mVerify').textContent = result.verifyOk === true ? 'lossless, ok'
    : (result.verifyOk === false ? 'needs a look' : 'ok');
  el('mArtist').textContent = result.artist || '--';
  el('mTitle').textContent = result.title || '--';
  el('mSaved').textContent = result.newName || '--';
  setWaveform(true, waveHeights((result.newName || '').length + 3));
}

// ---- Lists ----

function fmtChip(ext) {
  const e = (ext || '').toLowerCase();
  return `<span class="track__fmt track__fmt--${e}">${e || 'aud'}</span>`;
}

function renderLists(files) {
  const queueList = el('queueList');
  const flaggedList = el('flaggedList');
  queueList.innerHTML = '';
  flaggedList.innerHTML = '';
  queueRows = new Map();

  let queued = 0;
  let flagged = 0;

  for (const f of files) {
    if (f.status === 'flagged' || f.status === 'error') {
      const li = document.createElement('li');
      li.className = 'track';
      li.innerHTML = `<span class="track__name">${f.name}</span>
        <span class="track__warn" aria-label="Needs a manual fix">&#9888;</span>`;
      li.title = f.reason || '';
      flaggedList.appendChild(li);
      flagged += 1;
    } else {
      const li = document.createElement('li');
      li.className = 'track';
      li.dataset.name = f.name;
      li.innerHTML = `${fmtChip(f.ext)}
        <span class="track__name">${f.newName || f.name}</span>
        <span class="track__state" aria-hidden="true"></span>`;
      queueList.appendChild(li);
      queueRows.set(f.name, li);
      queued += 1;
    }
  }

  el('queueCount').textContent = String(queued);
  el('flaggedCount').textContent = String(flagged);
  el('queueHint').textContent = queued
    ? `${queued} ready. ${flagged} flagged for a manual fix.`
    : 'No tracks with usable tags were found.';

  // Preview the first track in the nameplate.
  const first = files.find((f) => f.status !== 'flagged' && f.status !== 'error');
  if (first) {
    el('trackFrom').textContent = first.name;
    el('trackTo').textContent = first.newName;
    el('trackTo').style.opacity = '1';
  }
  return queued;
}

function markRow(name, state) {
  const li = queueRows.get(name);
  if (li) li.setAttribute('data-row', state);
}

// ---- Actions ----

async function chooseFolder() {
  const btn = el('chooseBtn');
  btn.disabled = true;
  el('stageState').textContent = 'Opening folder picker';
  try {
    const { folder } = await (await fetch('/api/pick-folder', { method: 'POST' })).json();
    if (!folder) { el('stageState').textContent = currentFolder ? 'Ready' : 'Idle'; return; }
    currentFolder = folder;
    el('sourcePath').textContent = folder;
    el('stageState').textContent = 'Scanning';
    clearScreen();
    setChain('idle');
    const { files, error } = await (await fetch('/api/scan', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }),
    })).json();
    if (error) { el('stageState').textContent = 'Idle'; el('queueHint').textContent = error; return; }
    const queued = renderLists(files);
    el('stageState').textContent = 'Ready';
    el('processBtn').disabled = queued === 0;
    el('processBtn').textContent = queued ? `Process ${queued}` : 'Process';
  } finally {
    btn.disabled = false;
  }
}

function attachProcessStream(source, onFinish) {
  const finish = (label) => {
    el('stageState').textContent = label;
    el('chooseBtn').disabled = false;
    el('processBtn').disabled = false;
    source.close();
    if (onFinish) onFinish();
  };

  source.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'file-start') {
      el('trackFrom').textContent = msg.name;
      el('trackTo').textContent = '';
      clearScreen();
      setChain('convert');
      markRow(msg.name, 'active');
    } else if (msg.type === 'stage') {
      setChain(msg.stage);
    } else if (msg.type === 'file-done') {
      if (!msg.result || !msg.result.newName) return;
      setChain('done');
      el('trackTo').textContent = msg.result.newName;
      el('trackTo').style.opacity = '1';
      lightScreen(msg.result);
      markRow(msg.name, 'done');
    } else if (msg.type === 'file-flagged') {
      // Already shown in the Flagged list; nothing to animate.
    } else if (msg.type === 'file-error') {
      markRow(msg.name, 'error');
    } else if (msg.type === 'done') {
      finish('Done');
    } else if (msg.type === 'fatal') {
      el('queueHint').textContent = msg.message;
      finish('Stopped');
    }
  };

  source.onerror = () => finish('Done');
}

function processFolder() {
  if (!currentFolder) return;
  el('processBtn').disabled = true;
  el('chooseBtn').disabled = true;
  el('stageState').textContent = 'Processing';
  attachProcessStream(new EventSource(`/api/process?folder=${encodeURIComponent(currentFolder)}`));
}

// ---- Boot ----

buildWaveform();
refreshEngineStatus();
el('chooseBtn').addEventListener('click', chooseFolder);
el('processBtn').addEventListener('click', processFolder);

// ---- Spotify: playlist to copy-paste search list ----

const sp = {
  state: el('spotifyState'),
  setup: el('spotifySetup'),
  connect: el('spotifyConnect'),
  browse: el('spotifyBrowse'),
  msg: el('spotifyMsg'),
  clientInput: el('clientIdInput'),
  select: el('playlistSelect'),
  list: el('searchList'),
  tracksHead: el('tracksHead'),
  tracksCount: el('tracksCount'),
  link: el('playlistLink'),
  signin: el('signin'),
  // Target this panel by label: the Folders panel is also a .crate and comes first.
  crate: document.querySelector('[aria-label="Spotify playlist to search list"]'),
};

function spotifyShow(which) {
  sp.setup.hidden = which !== 'setup';
  sp.connect.hidden = which !== 'connect';
  sp.browse.hidden = which !== 'browse';
}

function spotifyMessage(text, kind) {
  if (!text) { sp.msg.hidden = true; return; }
  sp.msg.hidden = false;
  sp.msg.textContent = text;
  sp.msg.setAttribute('data-kind', kind || 'warn');
}

async function copyText(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) {
      const original = btn.dataset.label || btn.textContent;
      btn.dataset.label = original;
      btn.setAttribute('data-copied', '1');
      btn.textContent = 'Copied';
      setTimeout(() => { btn.removeAttribute('data-copied'); btn.textContent = original; }, 1200);
    }
  } catch {
    spotifyMessage('Copy did not work. Select the text and copy it by hand.');
  }
}

async function refreshSpotify() {
  let status;
  try { status = await (await fetch('/api/spotify/status')).json(); }
  catch { sp.state.textContent = 'Offline'; return; }

  // Pasting a link always works, so "not signed in" is a normal state, not a problem. The
  // badge says what to do next rather than reporting a failure.
  if (status.connected) {
    sp.state.textContent = 'Signed in';
    sp.crate.classList.add('crate--ready');
    spotifyShow('browse');
    await loadPlaylists();
  } else if (status.configured) {
    sp.state.textContent = 'Ready to sign in';
    sp.crate.classList.remove('crate--ready');
    spotifyShow('connect');
  } else {
    sp.state.textContent = 'Paste a link';
    sp.crate.classList.remove('crate--ready');
    spotifyShow('setup');
  }
}

async function loadPlaylists() {
  try {
    const { playlists, error } = await (await fetch('/api/spotify/playlists')).json();
    if (error) { spotifyMessage(error); return; }
    sp.select.innerHTML = '';
    for (const p of playlists) {
      const opt = document.createElement('option');
      opt.value = p.id;
      // Signing in is what makes a private playlist readable, so it needs no warning.
      opt.textContent = p.public ? p.name : `${p.name}  (private)`;
      sp.select.appendChild(opt);
    }
    spotifyMessage(playlists.length ? '' : 'No playlists were found on your account.');
  } catch { spotifyMessage('Could not load your playlists.'); }
}

// Reads one playlist and makes it the active checklist. `ref` is either a playlist ID or a
// pasted link; the server accepts both. Shared by the link box and the signed-in picker so
// the two paths behave identically from here on.
async function loadPlaylistInto(ref, fallbackName) {
  if (!ref) return;
  spotifyMessage('Reading the playlist.', 'ok');
  try {
    const res = await (await fetch(`/api/spotify/tracks?id=${encodeURIComponent(ref)}`)).json();
    if (res.error) { spotifyMessage(res.error); return; }
    renderTracks(res.tracks);
    spotifyMessage('', 'ok');
    // Store the resolved ID, never the pasted link: the staging and finished folders are
    // named from this, and a URL would not be a usable folder name.
    await fetch('/api/library/checklist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: res.id, name: res.name || fallbackName || '', tracks: res.tracks }),
    });
    el('libBar').hidden = false;
    startLibraryPolling();
  } catch { spotifyMessage('Could not read that playlist.'); }
}

function loadTracks() {
  const option = sp.select.options[sp.select.selectedIndex];
  return loadPlaylistInto(sp.select.value, option ? option.text : '');
}

// The no-setup path: paste a link from Spotify's Share menu and read it straight away.
function loadTracksFromLink() {
  const link = sp.link.value.trim();
  if (!link) { spotifyMessage('Paste a Spotify playlist link first.'); return; }
  // The folder is named after the playlist, and a pasted link carries no name, so the
  // checklist name is left empty and the server falls back to the playlist ID.
  return loadPlaylistInto(link, '');
}

// ---- Downloads checklist (library) ----

let libraryTimer = null;

function startLibraryPolling() {
  pollLibrary();
  if (libraryTimer) return;
  libraryTimer = setInterval(pollLibrary, 3000);
}

async function pollLibrary() {
  let state;
  try { state = await (await fetch('/api/library/state')).json(); }
  catch { return; }
  if (state.error) return;

  const rows = Array.from(sp.list.children);
  (state.checklist || []).forEach((track, i) => {
    const row = rows[i];
    if (!row) return;
    row.setAttribute('data-got', track.got ? '1' : '0');
    row.setAttribute('data-vinyl', track.vinyl ? '1' : '0');
    const nameSpan = row.querySelector('.searchrow__text > span:first-child');
    if (nameSpan) nameSpan.textContent = (track.got && track.savedLine) ? track.savedLine : track.line;
  });

  const have = el('haveCount');
  have.textContent = `Have ${state.got} of ${state.total}`;
  const accounted = state.got + (state.vinylCount || 0);
  have.setAttribute('data-full', state.total > 0 && accounted === state.total ? '1' : '0');
  const unmatchedSongs = Math.max(0, state.total - state.got);
  el('libMeta').textContent = `${state.incomingCount} pulled, ${unmatchedSongs} song${unmatchedSongs === 1 ? '' : 's'} unmatched, ${state.readyCount} finished`;
  el('autoPullToggle').checked = Boolean(state.autoPull);
  el('convertBtn').disabled = state.incomingCount === 0;
  el('zipBtn').disabled = state.readyCount === 0;
}

function convertLibrary() {
  el('convertBtn').disabled = true;
  el('processBtn').disabled = true;
  el('chooseBtn').disabled = true;
  el('stageState').textContent = 'Processing';
  attachProcessStream(new EventSource('/api/library/convert'), () => {
    pollLibrary();
  });
}

// Restores the checklist view after a page reload, so progress is not lost.
async function restoreChecklist() {
  try {
    const state = await (await fetch('/api/library/state')).json();
    if (state.checklist && state.checklist.length) {
      renderTracks(state.checklist);
      el('libBar').hidden = false;
      if (state.activePlaylist && state.activePlaylist.id) sp.select.value = state.activePlaylist.id;
      startLibraryPolling();
    }
  } catch { /* nothing to restore */ }
}

function renderTracks(tracks) {
  sp.list.innerHTML = '';
  tracks.forEach((t, i) => {
    const li = document.createElement('li');
    li.className = 'searchrow';
    li.dataset.line = t.line;
    li.setAttribute('data-got', '0');
    li.setAttribute('data-vinyl', t.vinyl ? '1' : '0');
    const dot = document.createElement('span');
    dot.className = 'searchrow__dot';
    dot.setAttribute('aria-hidden', 'true');
    const num = document.createElement('span');
    num.className = 'searchrow__num';
    num.textContent = String(i + 1);
    const text = document.createElement('span');
    text.className = 'searchrow__text';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = t.line;
    const vinylTag = document.createElement('span');
    vinylTag.className = 'searchrow__vinyl';
    vinylTag.textContent = ' VINYL ONLY';
    text.append(nameSpan, vinylTag);
    const copy = document.createElement('button');
    copy.className = 'searchrow__copy';
    copy.type = 'button';
    copy.textContent = 'Copy';
    copy.addEventListener('click', () => copyText(t.line, copy));
    const vbtn = document.createElement('button');
    vbtn.className = 'searchrow__vbtn';
    vbtn.type = 'button';
    vbtn.textContent = 'Vinyl';
    vbtn.title = 'Mark this track as vinyl only';
    vbtn.addEventListener('click', () => toggleVinyl(li));
    li.append(dot, num, text, copy, vbtn);
    sp.list.appendChild(li);
  });
  sp.tracksHead.hidden = tracks.length === 0;
  sp.tracksCount.textContent = `${tracks.length} track${tracks.length === 1 ? '' : 's'}`;
  sp.list.dataset.lines = tracks.map((t) => t.line).join('\n');
}

async function toggleVinyl(li) {
  const line = li.dataset.line;
  const on = li.getAttribute('data-vinyl') !== '1';
  li.setAttribute('data-vinyl', on ? '1' : '0'); // optimistic
  try {
    await fetch('/api/library/vinyl', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line, on }),
    });
  } catch { /* keep the optimistic state */ }
  pollLibrary();
}

el('saveClientBtn').addEventListener('click', async () => {
  const clientId = sp.clientInput.value.trim();
  if (!clientId) { spotifyMessage('Paste your Client ID first.'); return; }
  const res = await fetch('/api/spotify/config', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
  });
  const data = await res.json();
  if (data.error) { spotifyMessage(data.error); return; }
  spotifyMessage('Client ID saved.', 'ok');
  refreshSpotify();
});
el('connectBtn').addEventListener('click', () => { window.location.href = '/api/spotify/login'; });
el('reconfigBtn').addEventListener('click', () => spotifyShow('setup'));
el('disconnectBtn').addEventListener('click', async () => {
  await fetch('/api/spotify/disconnect', { method: 'POST' });
  sp.list.innerHTML = '';
  sp.tracksHead.hidden = true;
  refreshSpotify();
});
el('loadTracksBtn').addEventListener('click', loadTracks);
el('copyAllBtn').addEventListener('click', () => copyText(sp.list.dataset.lines || '', el('copyAllBtn')));
el('copyRedirectBtn').addEventListener('click', () => copyText(el('spotifyRedirect').textContent, el('copyRedirectBtn')));

el('autoPullToggle').addEventListener('change', async (event) => {
  await fetch('/api/library/autopull', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: event.target.checked }),
  });
  pollLibrary();
});
el('pullNowBtn').addEventListener('click', async () => {
  const btn = el('pullNowBtn');
  btn.disabled = true;
  btn.textContent = 'Pulling';
  try { await fetch('/api/library/pull', { method: 'POST' }); await pollLibrary(); }
  finally { btn.disabled = false; btn.textContent = 'Pull now'; }
});
el('convertBtn').addEventListener('click', convertLibrary);
el('zipBtn').addEventListener('click', () => { window.location.href = '/api/library/zip'; });

el('loadLinkBtn').addEventListener('click', loadTracksFromLink);
sp.link.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') loadTracksFromLink();
});

// ---- Folders ----
//
// The three folders the library moves tracks through. Each row reads its own path from the
// server, so the panel always shows what the engine will actually use, including a path set
// by an environment variable rather than in here.

const FOLDER_LABELS = {
  soulseekComplete: 'Soulseek finished downloads',
  incoming: 'Staging folder',
  ready: 'Finished tracks',
};

function foldersMessage(text, kind) {
  const node = el('foldersMsg');
  if (!text) { node.hidden = true; return; }
  node.hidden = false;
  node.textContent = text;
  node.setAttribute('data-kind', kind || 'warn');
}

function renderFolders(state) {
  const folders = state.folders || {};
  const exists = state.foldersExist || {};
  const fromEnv = state.foldersFromEnv || {};

  for (const row of document.querySelectorAll('.folder')) {
    const key = row.dataset.key;
    const path = folders[key] || '';
    row.querySelector('[data-path]').textContent = path || 'Not set';

    const note = row.querySelector('[data-note]');
    const pick = row.querySelector('[data-pick]');

    // Only the Soulseek folder has to exist already, because Soulseek is what writes to
    // it. The other two are created when tracks first land in them.
    const missing = key === 'soulseekComplete' && !exists[key];
    row.setAttribute('data-missing', missing ? 'true' : 'false');

    if (fromEnv[key]) {
      note.hidden = false;
      note.textContent = 'Set by an environment variable, which overrides this panel.';
      pick.disabled = true;
    } else if (missing) {
      note.hidden = false;
      note.textContent = 'This folder does not exist yet. Check Soulseek’s download folder in its Options.';
      pick.disabled = false;
    } else {
      note.hidden = true;
      note.textContent = '';
      pick.disabled = false;
    }
  }

  el('foldersState').textContent = exists.soulseekComplete ? 'Ready' : 'Check Soulseek folder';
}

async function refreshFolders() {
  try {
    const state = await (await fetch('/api/library/state')).json();
    if (state.error) { foldersMessage(state.error); return; }
    renderFolders(state);
  } catch {
    el('foldersState').textContent = 'Offline';
    foldersMessage('Could not read the folder settings.');
  }
}

async function changeFolder(key, button) {
  foldersMessage('');
  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Choosing';
  try {
    const picked = await (await fetch('/api/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: `Choose the ${FOLDER_LABELS[key] || 'folder'}` }),
    })).json();

    // A null folder means the dialog was cancelled, or the platform has no native picker.
    if (!picked.folder) {
      foldersMessage('No folder was chosen.', 'ok');
      return;
    }

    const state = await (await fetch('/api/library/paths', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: picked.folder }),
    })).json();

    if (state.error) { foldersMessage(state.error); return; }
    renderFolders(state);
    foldersMessage(`${FOLDER_LABELS[key]} set.`, 'ok');
  } catch {
    foldersMessage('Could not change that folder.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

for (const row of document.querySelectorAll('.folder')) {
  const button = row.querySelector('[data-pick]');
  button.addEventListener('click', () => changeFolder(row.dataset.key, button));
}

(function handleSpotifyReturn() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get('spotify');
  if (result === 'connected') spotifyMessage('Spotify connected.', 'ok');
  else if (result === 'error') spotifyMessage(`Spotify could not connect: ${params.get('msg') || 'try again'}`);
  if (result) {
    params.delete('spotify');
    params.delete('msg');
    const q = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''));
  }
  // A failed sign-in should open the panel that explains how to fix it, rather than
  // leaving the message pointing at a collapsed section.
  if (result === 'error') sp.signin.open = true;
})();

refreshFolders();
refreshSpotify().then(restoreChecklist);
