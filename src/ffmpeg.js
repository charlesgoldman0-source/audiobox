// FFmpeg locator and availability check.
//
// On Windows, winget installs Gyan.FFmpeg to a portable folder and updates the
// PATH for new shells only. On macOS, Homebrew puts it in /opt/homebrew/bin (Apple
// Silicon) or /usr/local/bin (Intel), which a double-clicked launcher may not have on
// its PATH. So we never assume "ffmpeg" resolves by name. We check, in order: an
// explicit override, the platform's usual install folders, then the PATH.
// Every candidate is validated by actually running it, so a stale path cannot pass.

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const INSTALL_STEPS = {
  win32: [
    'Install it on Windows with:',
    '    winget install --id Gyan.FFmpeg -e --source winget',
    '',
    'Then open a new terminal so the PATH updates.',
  ],
  darwin: [
    'Install it on macOS with Homebrew:',
    '    brew install ffmpeg',
    '',
    'If Homebrew is missing, install it first from https://brew.sh',
  ],
  linux: [
    'Install it with your package manager, for example:',
    '    sudo apt install ffmpeg',
  ],
};

export const INSTALL_HELP = [
  'FFmpeg was not found on this machine.',
  '',
  ...(INSTALL_STEPS[process.platform] || INSTALL_STEPS.linux),
  '',
  'Alternatively, set the AUDIOBOX_FFMPEG and AUDIOBOX_FFPROBE environment',
  'variables to the full paths of the ffmpeg and ffprobe programs.',
].join('\n');

// Gyan.FFmpeg installs to:
//   %LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-<version>-full_build\bin\
function wingetCandidates(exe) {
  const found = [];
  const base = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages');
  if (!existsSync(base)) return found;
  for (const pkg of safeReaddir(base)) {
    if (!pkg.toLowerCase().startsWith('gyan.ffmpeg')) continue;
    const pkgDir = join(base, pkg);
    for (const inner of safeReaddir(pkgDir)) {
      const candidate = join(pkgDir, inner, 'bin', exe);
      if (existsSync(candidate)) found.push(candidate);
    }
  }
  return found;
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function runs(path) {
  try {
    execFileSync(path, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function resolveBinary(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;
  const override = process.env[`AUDIOBOX_${name.toUpperCase()}`];

  // Absolute paths first, so callers that need a real directory (for example yt-dlp's
  // --ffmpeg-location) get one. The bare PATH name is only a last resort.
  const tries = [];
  if (override) tries.push(override);
  if (process.platform === 'win32') {
    tries.push(...wingetCandidates(exe));
    tries.push(join('C:', 'ffmpeg', 'bin', exe));
    tries.push(join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', exe));
  } else {
    // Homebrew on Apple Silicon, Homebrew on Intel, MacPorts, then the system folders.
    tries.push(join('/opt/homebrew/bin', exe));
    tries.push(join('/usr/local/bin', exe));
    tries.push(join('/opt/local/bin', exe));
    tries.push(join('/usr/bin', exe));
  }
  tries.push(name); // bare name, resolved via PATH

  for (const candidate of tries) {
    const isBareName = candidate === name;
    if (isBareName || existsSync(candidate)) {
      if (runs(candidate)) return candidate;
    }
  }
  return null;
}

let cached = null;

// Returns { ffmpeg, ffprobe, version } with absolute, verified binary paths.
// Throws an Error with FFMPEG_NOT_FOUND code and install instructions if missing.
export function detectFfmpeg() {
  if (cached) return cached;

  const ffmpeg = resolveBinary('ffmpeg');
  const ffprobe = resolveBinary('ffprobe');

  if (!ffmpeg || !ffprobe) {
    const missing = [!ffmpeg && 'ffmpeg', !ffprobe && 'ffprobe'].filter(Boolean).join(' and ');
    const error = new Error(`Could not find ${missing}.\n\n${INSTALL_HELP}`);
    error.code = 'FFMPEG_NOT_FOUND';
    throw error;
  }

  let version = 'unknown';
  try {
    const out = execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' });
    version = out.split('\n')[0].trim();
  } catch {
    // Version line is informational only; resolution already proved the binary runs.
  }

  cached = { ffmpeg, ffprobe, version };
  return cached;
}
