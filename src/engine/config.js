// Engine defaults. These reflect the decisions Charles has made so far and are
// the toggles the interface will eventually expose.

export const defaultConfig = {
  // When embedded tags are blank or unclear: if the filename clearly reads
  // "Artist - Title", parse it; otherwise flag the file for a manual fix.
  // Charles chose this over always-flag and over always-parse.
  filenameFallback: true,

  // Featured artists: "move-to-artist" folds "feat. X" out of the title and into
  // the comma-separated Artist field. "keep-in-title" leaves a normalised
  // "(feat. X)" in the title instead.
  featMode: 'move-to-artist',

  // Split artist names on " & ", " + ", " vs " into the comma-separated form. On by
  // default because in this genre those almost always mark a collaboration, but a
  // single act whose name contains "&" (for example "Simon & Garfunkel") would be
  // split, so it can be turned off. Comma, semicolon, " / " and "feat." always split.
  splitArtistConnectors: true,
};
