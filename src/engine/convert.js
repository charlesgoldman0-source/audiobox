// Audio conversion.
//
// FLAC is decoded and re-encoded to true uncompressed big-endian PCM AIFF, picking
// 16 or 24 bit to match the source exactly. The explicit encoder is load-bearing:
// omitting it makes FFmpeg silently downcoerce 24-bit to 16-bit. WAV and AIFF are
// passed through by a plain byte-for-byte file copy, never re-encoded.

import { execFileSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { detectFfmpeg } from '../ffmpeg.js';
import { probe } from './probe.js';

// Choose the PCM encoder from the source bit depth. bits_per_raw_sample is the
// authoritative field for FLAC (bits_per_sample reads 0 there and must be ignored).
export function chooseEncoder(info) {
  let bits = parseInt(info.bits_per_raw_sample, 10);
  if (!Number.isFinite(bits) || bits === 0) {
    if (info.sample_fmt === 's16') bits = 16;
    else if (info.sample_fmt === 's32') bits = 24;
    else bits = NaN;
  }
  if (Number.isFinite(bits)) {
    if (bits <= 16) return { encoder: 'pcm_s16be', bits: 16 };
    if (bits <= 24) return { encoder: 'pcm_s24be', bits: 24 };
  }
  return null; // 32-bit integer or float: out of scope, must be flagged not downcoerced
}

export function convertOrPassthrough(input, output, inputExt) {
  const ext = inputExt.toLowerCase();

  // AIFF: stream-copy with -map_metadata -1 so any stale native NAME/AUTH chunks
  // and old ID3 are dropped first. Stream copy does not touch the samples, so it
  // stays lossless, and the tag writer then writes a single clean ID3v2.3 tag.
  if (ext === '.aif' || ext === '.aiff') {
    const { ffmpeg } = detectFfmpeg();
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map_metadata', '-1',
      '-c:a', 'copy',
      output,
    ]);
    return { mode: 'passthrough' };
  }

  // FLAC: decode and re-encode to true lossless big-endian PCM AIFF.
  if (ext === '.flac') {
    const info = probe(input);
    const choice = chooseEncoder(info);
    if (!choice) {
      const err = new Error(
        `Unsupported source depth (sample_fmt=${info.sample_fmt}, bits_per_raw_sample=${info.bits_per_raw_sample}). `
        + '32-bit or float audio is out of scope and is not downconverted.',
      );
      err.code = 'UNSUPPORTED_DEPTH';
      throw err;
    }
    const { ffmpeg } = detectFfmpeg();
    execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', input,
      '-map_metadata', '-1',
      '-c:a', choice.encoder,
      output,
    ]);
    return {
      mode: 'convert',
      encoder: choice.encoder,
      bits: choice.bits,
      sampleRate: info.sample_rate,
      sourceCodec: info.codec_name,
    };
  }

  // WAV, MP3, M4A, AAC, OGG: keep the format, copy the file, and let the tag writer
  // rewrite the tags. A lossy file is never inflated into AIFF.
  copyFileSync(input, output);
  return { mode: 'passthrough' };
}
