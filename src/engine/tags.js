// Reading and writing embedded tags.
//
// Reading uses music-metadata (fast, normalised, read only). Writing uses
// node-taglib-sharp, which writes the correct scheme per container: ID3v2 for AIFF,
// RIFF INFO for WAV, Vorbis comments for FLAC, all the tags a CDJ actually reads.
//
// AIFF detail that matters: node-taglib-sharp defaults a new tag to ID3v2.2. CDJs
// are happiest with ID3v2.3, so we force it before saving. Multiple artists go in as
// one comma-separated string so they land in a single TPE1 frame.

import taglib from 'node-taglib-sharp';
import { parseFile } from 'music-metadata';

const { File: TagLibFile, Id3v2Settings, TagTypes, Id3v2FrameIdentifiers } = taglib;

export async function readTags(path) {
  const meta = await parseFile(path, { duration: false });
  const common = meta.common || {};
  const format = meta.format || {};
  return {
    title: common.title || '',
    artist: common.artist || (common.artists ? common.artists.join(', ') : ''),
    artists: common.artists || [],
    container: format.container || '',
    codec: format.codec || '',
    sampleRate: format.sampleRate || null,
    bitsPerSample: format.bitsPerSample || null,
    tagTypes: format.tagTypes || [],
  };
}

export function writeTags(path, { artist, title }, outputExt) {
  // Id3v2Settings is a global static, so set the policy explicitly on every call
  // rather than relying on previous state. AIFF must be ID3v2.3 for CDJ
  // compatibility; WAV and FLAC carry their own scheme and must not be forced to
  // v2.3 (that throws "Feature only supported in version 2.4+" on WAV).
  if (/\.(aiff?|mp3)$/i.test(outputExt)) {
    Id3v2Settings.defaultVersion = 3;
    Id3v2Settings.forceDefaultVersion = true;
  } else {
    Id3v2Settings.forceDefaultVersion = false;
  }
  const file = TagLibFile.createFromPath(path);
  try {
    dropUnrenderableFrames(file);
    file.tag.title = title;
    file.tag.performers = [artist]; // single comma-separated string => one TPE1 frame
    file.save();
  } finally {
    file.dispose();
  }
}

// Some downloads carry an ID3v2 "unique file identifier" (UFID) frame with empty data, a
// store or database key that means nothing to a CDJ. node-taglib-sharp cannot re-render
// such a frame and the save fails with "Argument null: text was not provided". Dropping
// UFID frames before saving loses nothing the player reads.
function dropUnrenderableFrames(file) {
  const id3 = file.getTag(TagTypes.Id3v2, false);
  if (!id3 || typeof id3.removeFrames !== 'function') return;
  id3.removeFrames(Id3v2FrameIdentifiers.UFID);
}
