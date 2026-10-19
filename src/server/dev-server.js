// Audiobox local server.
//
// Serves the web/ folder, exposes the real FFmpeg status, lets the user pick a
// folder with the native Windows dialog, previews a folder (dry run), and runs the
// engine while streaming live per-stage progress over Server-Sent Events. It also
// pushes a live-reload signal when a web file changes. No external dependencies.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { watch, readdirSync, existsSync, mkdirSync, createReadStream, rmSync } from 'node:fs';
import { join, extname, normalize, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { detectFfmpeg } from '../ffmpeg.js';
import { planFile, applyFile, sweepTempFiles } from '../engine/process.js';
import { isAudioFile, sanitizeName } from '../engine/naming.js';
import { defaultConfig } from '../engine/config.js';
import * as spotify from './spotify.js';
import * as apple from './apple.js';
import * as soundcloud from './soundcloud.js';
import * as library from './library.js';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..', '..', 'web');
const PORT = process.env.PORT ? Number(process.env.PORT) : 4848;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
};

const LIVERELOAD_SNIPPET = `
<script>
  (function () {
    try {
      var source = new EventSource('/__livereload');
      source.onmessage = function (event) { if (event.data === 'reload') location.reload(); };
    } catch (err) { /* live reload is a convenience, never fatal */ }
  })();
</script>
`;

const sseClients = new Set();

function ffmpegStatus() {
  try {
    const { version } = detectFfmpeg();
    const match = version.match(/ffmpeg version (\S+)/i);
    return { ready: true, version: match ? match[1].split('-')[0] : 'installed' };
  } catch (error) {
    return { ready: false, version: null, help: error.message };
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

// Opens the native folder dialog (Windows Forms on Windows, the Finder chooser on macOS)
// and resolves to the chosen path, or null when cancelled or on a platform without one.
// The prompt tells the user which folder they are choosing, since the app asks for three.
function pickFolder(prompt = 'Choose a folder of downloaded tracks') {
  // The prompt is interpolated into a shell string, so allow plain text only. A quote or
  // a backtick here would break out of the AppleScript or PowerShell literal.
  const safePrompt = String(prompt).replace(/[^\w\s,.()-]/g, '').slice(0, 80)
    || 'Choose a folder';
  return new Promise((resolve) => {
    if (process.platform === 'darwin') {
      const script = `POSIX path of (choose folder with prompt "${safePrompt}")`;
      execFile('osascript', ['-e', script], (err, stdout) => {
        const raw = (stdout || '').trim();
        const path = raw.endsWith('/') && raw.length > 1 ? raw.slice(0, -1) : raw;
        resolve(!err && path ? path : null);
      });
      return;
    }
    if (process.platform !== 'win32') { resolve(null); return; }
    const ps = "Add-Type -AssemblyName System.Windows.Forms; "
      + "$d = New-Object System.Windows.Forms.FolderBrowserDialog; "
      + `$d.Description = '${safePrompt}'; `
      + "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; "
      + "if ($d.ShowDialog($f) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }";
    execFile('powershell', ['-NoProfile', '-STA', '-Command', ps], (err, stdout) => {
      const path = (stdout || '').trim();
      resolve(path || null);
    });
  });
}

function serializePlan(plan) {
  const r = plan.resolved;
  return {
    name: plan.name,
    ext: plan.ext.replace('.', ''),
    status: r.status,
    artist: r.status === 'flagged' ? null : r.artist,
    title: r.status === 'flagged' ? null : r.title,
    newName: plan.newName,
    reason: r.status === 'flagged' ? r.reason : null,
    source: r.source || null,
  };
}

function serializeResult(result) {
  const base = serializePlan(result);
  if (!result.applied) return base;
  const c = result.conversion || {};
  return {
    ...base,
    applied: true,
    audio: c.mode === 'convert'
      ? { mode: 'convert', label: `AIFF ${c.bits}-bit ${c.sampleRate}Hz`, encoder: c.encoder }
      : { mode: 'passthrough', label: 'audio untouched' },
    verifyOk: result.verification ? result.verification.ok : null,
  };
}

async function handleScan(res, folder) {
  if (!folder || !existsSync(folder)) {
    sendJson(res, 400, { error: 'That folder was not found.' });
    return;
  }
  const files = readdirSync(folder).filter(isAudioFile).map((f) => join(folder, f));
  const plans = [];
  for (const file of files) {
    try {
      plans.push(serializePlan(await planFile(file, defaultConfig)));
    } catch (error) {
      plans.push({ name: basename(file), status: 'error', reason: error.message });
    }
  }
  sendJson(res, 200, { folder, files: plans });
}

function handleProcess(res, folder, outDirArg, overrides) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  (async () => {
    try {
      if (!folder || !existsSync(folder)) {
        send({ type: 'fatal', message: 'That folder was not found.' });
        return;
      }
      const files = readdirSync(folder).filter(isAudioFile).map((f) => join(folder, f));
      const outDir = outDirArg || join(folder, 'processed');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      sweepTempFiles(outDir);
      const claimed = new Set();

      send({ type: 'start', total: files.length, outDir });
      for (const file of files) {
        const name = basename(file);
        const override = overrides ? overrides[name] : null;
        try {
          // Flagged files never enter the visual chain; they are reported as flagged.
          const plan = await planFile(file, defaultConfig, override);
          if (plan.resolved.status === 'flagged') {
            send({ type: 'file-flagged', name, reason: plan.resolved.reason });
            continue;
          }
          send({ type: 'file-start', name });
          const result = await applyFile(file, defaultConfig, outDir, (stage) => send({ type: 'stage', name, stage }), claimed, override);
          send({ type: 'file-done', name, result: serializeResult(result) });
        } catch (error) {
          send({ type: 'file-error', name, message: error.message });
        }
      }
      send({ type: 'done', outDir });
    } catch (error) {
      send({ type: 'fatal', message: error.message });
    } finally {
      res.end();
    }
  })();
}

function handleZip(res) {
  const ready = library.getReadyDir();
  if (!existsSync(ready) || readdirSync(ready).filter(isAudioFile).length === 0) {
    sendJson(res, 400, { error: 'No finished tracks yet. Convert the pulled tracks first.' });
    return;
  }
  const cfg = library.getConfig();
  const playlist = (cfg.activePlaylist && cfg.activePlaylist.name) || 'Audiobox';
  const safe = sanitizeName(playlist);
  const asciiSafe = (safe.replace(/[^\x20-\x7e]/g, '').trim()) || 'playlist';
  const zipPath = join(dirname(ready), `${asciiSafe}-${Date.now()}.zip`);
  // Zip the playlist folder itself, so it unpacks into a folder named after the playlist.
  const done = (err) => {
    if (err || !existsSync(zipPath)) {
      sendJson(res, 500, { error: 'Could not build the zip file.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${asciiSafe}.zip"; filename*=UTF-8''${encodeURIComponent(safe)}.zip`,
    });
    const stream = createReadStream(zipPath);
    stream.pipe(res);
    stream.on('close', () => { try { rmSync(zipPath, { force: true }); } catch { /* ignore */ } });
  };
  if (process.platform === 'win32') {
    const ps = `Compress-Archive -Path '${ready.replace(/'/g, "''")}' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`;
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], done);
  } else {
    // macOS and Linux ship a zip command. Run it from the parent folder so the archive
    // unpacks into the playlist folder, the same as on Windows.
    execFile('zip', ['-r', '-q', zipPath, basename(ready)], { cwd: dirname(ready) }, done);
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  if (pathname === '/__livereload') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 1000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (pathname === '/api/status') {
    sendJson(res, 200, { ffmpeg: ffmpegStatus(), platform: process.platform });
    return;
  }

  if (pathname === '/api/pick-folder' && req.method === 'POST') {
    const body = await readBody(req);
    const folder = await pickFolder(body.prompt);
    sendJson(res, 200, { folder });
    return;
  }

  if (pathname === '/api/scan' && req.method === 'POST') {
    const body = await readBody(req);
    await handleScan(res, body.folder);
    return;
  }

  if (pathname === '/api/process') {
    handleProcess(res, url.searchParams.get('folder'));
    return;
  }

  // ---- Spotify: read playlist names only, never audio ----

  if (pathname === '/api/spotify/status') {
    sendJson(res, 200, spotify.getState());
    return;
  }

  if (pathname === '/api/spotify/config' && req.method === 'POST') {
    const body = await readBody(req);
    const clientId = String(body.clientId || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(clientId)) {
      sendJson(res, 400, {
        error: 'That is not a Client ID. It is 32 letters and numbers from your app on the '
          + 'Spotify developer dashboard, not your profile link or username.',
      });
      return;
    }
    spotify.setClientId(clientId);
    sendJson(res, 200, spotify.getState());
    return;
  }

  if (pathname === '/api/spotify/login') {
    try {
      res.writeHead(302, { Location: spotify.buildAuthUrl() });
    } catch (error) {
      res.writeHead(302, { Location: `/?spotify=error&msg=${encodeURIComponent(error.message)}` });
    }
    res.end();
    return;
  }

  if (pathname === '/api/spotify/callback') {
    const home = `http://localhost:${PORT}`;
    const denied = url.searchParams.get('error');
    if (denied) {
      res.writeHead(302, { Location: `${home}/?spotify=error&msg=${encodeURIComponent(denied)}` });
      res.end();
      return;
    }
    try {
      await spotify.handleCallback(url.searchParams.get('code'), url.searchParams.get('state'));
      res.writeHead(302, { Location: `${home}/?spotify=connected` });
    } catch (error) {
      res.writeHead(302, { Location: `${home}/?spotify=error&msg=${encodeURIComponent(error.message)}` });
    }
    res.end();
    return;
  }

  if (pathname === '/api/spotify/playlists') {
    try { sendJson(res, 200, { playlists: await spotify.listPlaylists() }); }
    catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  // `id` accepts a bare playlist ID or a pasted Spotify link. The response carries the
  // resolved ID and the playlist name, which the client stores as the active checklist.
  if (pathname === '/api/spotify/tracks') {
    try { sendJson(res, 200, await spotify.listTracks(url.searchParams.get('id'))); }
    catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  // Apple Music: the public playlist page only. There is no sign-in path, because Apple's
  // API issues tokens only to paid Apple Developer Program members. Same response shape as
  // the Spotify route, so the client treats both alike.
  if (pathname === '/api/apple/tracks') {
    try { sendJson(res, 200, await apple.listTracks(url.searchParams.get('id'))); }
    catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  // SoundCloud: public sets only, read from the set page and the metadata call the page
  // itself makes. SoundCloud stopped issuing API keys, so there is no sign-in path.
  if (pathname === '/api/soundcloud/tracks') {
    try { sendJson(res, 200, await soundcloud.listTracks(url.searchParams.get('id'))); }
    catch (error) { sendJson(res, 400, { error: error.message }); }
    return;
  }

  // Creates a private Spotify playlist from the current list. The app's only write to a
  // Spotify account, and only on the user's click.
  if (pathname === '/api/spotify/playlist' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const tracks = Array.isArray(body.tracks) ? body.tracks : [];
      if (!tracks.length) { sendJson(res, 400, { error: 'Load a list first.' }); return; }
      sendJson(res, 200, await spotify.createPlaylistFromTracks(String(body.name || ''), tracks));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === '/api/spotify/disconnect' && req.method === 'POST') {
    spotify.disconnect();
    sendJson(res, 200, spotify.getState());
    return;
  }

  // ---- Library: pull Soulseek downloads, track the checklist ----

  if (pathname === '/api/library/state') {
    try { sendJson(res, 200, await library.getState()); }
    catch (error) { sendJson(res, 500, { error: error.message }); }
    return;
  }

  // Sets the three folders the library works with: where Soulseek drops finished
  // downloads, where pulled files are staged, and where finished tracks end up. Each is
  // optional, so one row can be changed without resending the others.
  if (pathname === '/api/library/paths' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      library.setPaths(body);
      sendJson(res, 200, await library.getState());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (pathname === '/api/library/autopull' && req.method === 'POST') {
    const body = await readBody(req);
    library.setAutoPull(body.on);
    sendJson(res, 200, await library.getState());
    return;
  }

  if (pathname === '/api/library/pull' && req.method === 'POST') {
    try { sendJson(res, 200, await library.ingestOnce()); }
    catch (error) { sendJson(res, 500, { error: error.message }); }
    return;
  }

  // A single song link adds to the list instead of replacing it.
  if (pathname === '/api/library/checklist/add' && req.method === 'POST') {
    const body = await readBody(req);
    const added = library.addToChecklist(Array.isArray(body.tracks) ? body.tracks : []);
    sendJson(res, 200, { added, ...(await library.getState()) });
    return;
  }

  if (pathname === '/api/library/checklist' && req.method === 'POST') {
    const body = await readBody(req);
    library.setChecklist(body);
    sendJson(res, 200, await library.getState());
    return;
  }

  if (pathname === '/api/library/vinyl' && req.method === 'POST') {
    const body = await readBody(req);
    library.setVinyl(body.line, body.on);
    sendJson(res, 200, await library.getState());
    return;
  }

  if (pathname === '/api/library/convert') {
    const overrides = await library.getOverrides();
    handleProcess(res, library.getIncomingDir(), library.getReadyDir(), overrides);
    return;
  }

  if (pathname === '/api/library/zip') {
    handleZip(res);
    return;
  }

  // Static files.
  let filePathname = decodeURIComponent(pathname);
  if (filePathname === '/') filePathname = '/index.html';
  const filePath = normalize(join(webRoot, filePathname));
  if (!filePath.startsWith(webRoot)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    if (ext === '.html' && url.searchParams.get('noreload') !== '1') {
      res.end(data.toString('utf8').replace('</body>', `${LIVERELOAD_SNIPPET}</body>`));
    } else {
      res.end(data);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. The dev server may already be running at http://localhost:${PORT}`);
    process.exit(1);
  }
  throw error;
});

let debounce = null;
watch(webRoot, { recursive: true }, () => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    for (const client of sseClients) client.write('data: reload\n\n');
  }, 80);
});

server.listen(PORT, () => {
  const status = ffmpegStatus();
  console.log(`Audiobox server running at http://localhost:${PORT}`);
  console.log(`FFmpeg: ${status.ready ? `ready (${status.version})` : 'NOT FOUND'}`);
});

// Background auto-pull. Does nothing until the user turns auto-pull on.
library.startPoller((result) => {
  if (result.moved.length || result.removed.length) {
    console.log(`Auto-pull: pulled ${result.moved.length} file(s), recycled ${result.removed.length} folder(s)`);
  }
});
