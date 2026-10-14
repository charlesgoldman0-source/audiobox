// Starts the local server with the same command on Windows and macOS.
//
// On a machine behind a TLS-intercepting proxy (some work laptops), Node must trust the
// system certificate store or every HTTPS call to Spotify fails. That needs the
// --use-system-ca flag, which older Node versions do not know. It is added only when this
// Node supports it, so "npm start" works everywhere without editing package.json.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const server = join(dirname(fileURLToPath(import.meta.url)), '..', 'server', 'dev-server.js');
const flags = process.allowedNodeEnvironmentFlags.has('--use-system-ca') ? ['--use-system-ca'] : [];
const child = spawn(process.execPath, [...flags, server], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code === null ? 0 : code));
