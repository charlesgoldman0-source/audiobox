// Audiobox desktop shell.
//
// Wraps the same local server the browser version runs, inside its own window, so a person
// installs nothing else: the download carries Node (inside Electron) and FFmpeg (the
// ffmpeg-static and ffprobe-static packages). The page is identical. The differences are
// that the folder picker is the native dialog, outside links open in the real browser, the
// settings files live in the app's own data folder, and closing the window stops the server.

// Electron's module is CommonJS, so ESM code takes the default export and unpacks it.
import electron from 'electron';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, sep } from 'node:path';

const { app, BrowserWindow, dialog, shell } = electron;
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

// Fixed on purpose: the Spotify sign-in's redirect address is registered against this port.
const PORT = 4848;

// Programs packed inside app.asar cannot be run; electron-builder unpacks them beside it.
function unpacked(path) {
  return String(path || '').split('app.asar' + sep).join('app.asar.unpacked' + sep);
}

// Points the server's FFmpeg locator at the bundled binaries. If the packages are missing
// for this platform the locator falls back to whatever is installed on the machine.
function useBundledFfmpeg() {
  try {
    const ffmpeg = unpacked(require('ffmpeg-static'));
    const ffprobe = unpacked(require('ffprobe-static').path);
    if (ffmpeg && ffprobe) {
      process.env.AUDIOBOX_FFMPEG = ffmpeg;
      process.env.AUDIOBOX_FFPROBE = ffprobe;
    }
  } catch { /* locator falls back to the machine's own FFmpeg */ }
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

async function waitForServer(port, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://localhost:' + port + '/api/status');
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

async function start() {
  process.env.AUDIOBOX_DESKTOP = '1';
  // Settings and tokens go to the app's own data folder, never beside the packed code.
  process.env.AUDIOBOX_DATA_DIR = app.getPath('userData');
  useBundledFfmpeg();

  if (!(await portFree(PORT))) {
    await dialog.showMessageBox({
      type: 'info',
      title: 'Audiobox',
      message: 'Audiobox is already running.',
      detail: 'Something is already using port ' + PORT + ', usually another copy of Audiobox or a '
        + 'terminal running npm start. Close that first, then open Audiobox again.',
    });
    app.quit();
    return;
  }

  // The page's Choose folder button asks the server, and the server asks us for the native
  // dialog rather than running a PowerShell or AppleScript picker.
  globalThis.audioboxPickFolder = async (prompt) => {
    const owner = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showOpenDialog(owner, { title: prompt, properties: ['openDirectory'] });
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
  };

  await import('../src/server/dev-server.js');
  const up = await waitForServer(PORT);

  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 880,
    minHeight: 600,
    backgroundColor: '#0f0c0a',
    title: 'Audiobox',
    icon: join(here, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Links that would open a new tab (SoundCloud, Bandcamp, a finished Spotify playlist) go
  // to the person's real browser. The Spotify sign-in navigates this window and returns to
  // the local server, so it is left alone.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!up) {
    await dialog.showMessageBox(win, { type: 'error', title: 'Audiobox', message: 'The local server did not start.', detail: 'Try opening Audiobox again. If it keeps happening, report it with the version number from the About box.' });
    app.quit();
    return;
  }
  await win.loadURL('http://localhost:' + PORT + '/?noreload=1');

  // Test hook: capture the window to a PNG and quit, so a build can be checked without a hand.
  if (process.env.AUDIOBOX_SHOT) {
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.AUDIOBOX_SHOT_WAIT || 4000)));
    const image = await win.webContents.capturePage();
    writeFileSync(process.env.AUDIOBOX_SHOT, image.toPNG());
    app.quit();
  }
}

// One copy at a time. A second launch just brings the first window forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

app.on('window-all-closed', () => app.quit());
