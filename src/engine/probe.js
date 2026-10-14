// Thin ffprobe wrapper: returns the audio stream and container facts the engine
// needs to choose an encoder and to verify output.

import { execFileSync } from 'node:child_process';
import { detectFfmpeg } from '../ffmpeg.js';

export function probe(input) {
  const { ffprobe } = detectFfmpeg();
  const out = execFileSync(ffprobe, [
    '-v', 'error',
    '-select_streams', 'a:0',
    '-show_entries', 'stream=codec_name,sample_rate,bits_per_raw_sample,bits_per_sample,sample_fmt,channels:format=format_name',
    '-of', 'default=noprint_wrappers=1',
    input,
  ], { encoding: 'utf8' });

  const data = {};
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) data[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return data;
}
