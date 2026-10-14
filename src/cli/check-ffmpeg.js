// Standalone FFmpeg check. Prints where the binaries were found, or clear
// install instructions if they are missing. Mirrors the check the engine runs
// before any conversion, so the user never hits a silent failure.

import { detectFfmpeg } from '../ffmpeg.js';

try {
  const { ffmpeg, ffprobe, version } = detectFfmpeg();
  console.log('FFmpeg is ready.');
  console.log(`  version : ${version}`);
  console.log(`  ffmpeg  : ${ffmpeg}`);
  console.log(`  ffprobe : ${ffprobe}`);
  process.exit(0);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
