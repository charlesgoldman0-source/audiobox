# CLAUDE.md: Audiobox

Audiobox is a local app that prepares downloaded DJ tracks. It runs on the user's own
machine, operates on real audio files in a folder, and is built to look and feel excellent,
not like a generic tool.

It is a public, open-source app (MIT). Anyone can clone it and run it, so nothing may assume
one particular machine, one particular user, or one particular set of folders.

## What This App Does

The app takes a folder of downloaded tracks and, in one run:

1. **Converts FLAC to true AIFF.** Real decode and re-encode using FFmpeg, not a file
   rename. FLAC is lossless, so the AIFF is identical audio in an uncompressed container.
   WAV and AIFF files are passed through untouched as audio.
2. **Rewrites embedded metadata** to a fixed format every time. The CDJ reads the embedded
   Artist and Title tags, NOT the filename, so this is the part that matters most.
   - Artist field: clean artist name. Multiple artists are comma separated
     (for example "Artist One, Artist Two, Artist Three").
   - Title field: clean song name, junk stripped.
3. **Renames the file** to match the tags: `Artist - Title` using the same artist
   convention as above.
4. **Analyses audio features** and writes them to a sidecar data file (BPM, musical key,
   energy, and spectral features via FFT analysis). This data feeds a later
   "find more tracks like this" workflow. It does not change the audio.

## Scope Boundaries: Do Not Build These

- **No track downloading, ever.** The app never downloads audio from Spotify, SoundCloud,
  Soulseek or anywhere else. The user downloads tracks themselves. The app starts from files
  already on disk. The one allowed acquisition step is reading a Spotify playlist's track
  names as text, which is covered below.
- **No audio recognition or mix identification.** Do not add track identification, mix
  scanning, or anything that calls a recognition service. It would mean downloading audio and
  using an endpoint not offered for that purpose, neither of which belongs in a published app.
  The owner keeps the pre-1.0 build that had this, for personal use only, in a separate
  folder outside this repository (Audiobox-personal, port 4849). Never merge it back here.
- The app can only reformat metadata that already exists in the file. If a downloaded file
  has blank or clearly wrong tags, the app must NOT invent data. It either falls back to
  parsing the filename (if that toggle is on) or flags the file for manual fixing. This
  behaviour is configurable in the app, not assumed.

## Spotify Playlist to Search List

A front step that feeds the manual download workflow. It never downloads audio, and it only
ever reads.

There are two paths, and both must keep working:

- **Paste a playlist link.** The default, and the only one that works for everybody with no
  setup. The track names are read from Spotify's public embed page, so it needs no account
  and no Client ID, but it only works for public playlists and depends on that page's markup.
- **Sign in (optional).** Authorization Code flow with PKCE, so only a Client ID is needed
  and there is no secret to manage. This is the only way to read the user's *private*
  playlists, via `GET /playlists/{id}/items`.

**Why each user needs their own Spotify app, and why this cannot be changed:** Spotify allows
only five authenticated users per developer app, counted per developer account across all its
apps, and since 11 February 2026 the owner must hold Spotify Premium. Extended Quota Mode,
which would lift the cap, has been restricted to registered organisations with at least
250,000 monthly active users since 15 May 2025. A shipped shared Client ID would therefore
lock out the sixth person to install the app. Do not attempt to ship one.

Development Mode does retain `GET /me/playlists` and `GET /playlists/{id}/items`, with
`items` returned only for playlists the signed-in user owns or collaborates on. Verified
against Spotify's February 2026 migration guide.

Requested scopes are read-only (`playlist-read-private playlist-read-collaborative`). Do not
add write scopes: nothing in the app writes to a Spotify account.

`listTracks` returns `{ id, name, tracks }`. The resolved bare playlist ID matters, because
the staging and finished folders are named from it, and a pasted URL is not a usable folder
name.

## Apple Music Playlist to Search List

The same job for Apple Music, public playlists only, in src/server/apple.js:

- **Paste a playlist link.** The track names come from the public page at
  `music.apple.com/<storefront>/playlist/<id>`: the `serialized-server-data` JSON block
  carries each track's `title` and `artistName` in order, and the `schema:music-playlist`
  ld+json block carries the playlist name and track count, which is used as a cross-check.
  Needs no account. A user-made playlist must be shared publicly or the page is a 404.
- **No sign-in, and do not try to add one.** Apple's API needs a developer token signed
  with a MusicKit key, which Apple issues only to paid Apple Developer Program members, so
  no listener cloning the app could use it. Unofficial web-player tokens are off limits.
- Links look like `https://music.apple.com/za/playlist/<slug>/pl.u-<id>` (user made) or
  `.../pl.<hex>` (editorial). The storefront in the link is kept, because a playlist can
  be missing from another storefront. Same `{ id, name, tracks }` shape and the same line
  cleaning as Spotify, so the client treats both alike through `/api/apple/tracks`.

## SoundCloud Playlist to Search List

The same job for SoundCloud sets, in src/server/soundcloud.js, through `/api/soundcloud/tracks`:

- **Paste a set link** (`https://soundcloud.com/<user>/sets/<slug>`, optionally `/s-<token>`
  for a private set's share link; `on.soundcloud.com` short links are followed). The page's
  `window.__sc_hydration` block holds the playlist with its first few tracks in full and the
  rest as IDs. The IDs are filled through `api-v2.soundcloud.com/tracks?ids=` in batches of
  50, using the client id the page ships in its own scripts, which is the exact call the page
  makes for itself. Metadata only; nothing is ever downloaded.
- **No sign-in, and do not try to add one.** SoundCloud closed API key registration years
  ago. The client id is scraped from the page's assets and cached per process, and refreshed
  once if SoundCloud rejects it.
- **Naming is best effort, never invented.** Titles are uploader free text. Order of
  preference: `publisher_metadata.artist` (with `release_title` when the title has no
  dash), then an "Artist - Title" split of the title with a catalogue code such as SGR087
  dropped from either end, else the title alone with the artist blank. `trackToLine()` is the
  rule and is unit tested. The uploader's username is never used as the artist, because
  uploaders are usually labels or DJs.
- The checklist id is `<user>-<slug>`, and the folder takes the set's title as usual.

## Single Song Links

Each reader also accepts a link to one song: a Spotify track link or `spotify:track:` URI,
an Apple Music song link or an album link with `?i=<id>`, and a SoundCloud track link
(anything under a user that is not `/sets/`, including a private `/s-<token>` link). The
reader returns `{ id: "track-<id>", name: "", single: true, tracks: [line] }`, and the client
sends the line to `POST /api/library/checklist/add`, which appends to the current checklist,
skips lines already present, and, when no playlist is active, starts one named
"Single tracks". A song never replaces the list, because people paste several in a row.
Sources: Spotify's embed page (or the API when signed in), Apple's `songDetailHeader`
section (or the album's track list picked by the `?i=` id), SoundCloud's `sound`
hydratable, all through the same line cleaning as their playlists.

## Folders

The app moves tracks through three folders, all set by the user in the Folders panel:

| Key | Purpose |
|---|---|
| `soulseekComplete` | Where the download client writes finished downloads. Watched, never written to. |
| `incoming` | Staging folder for pulled files, awaiting conversion. |
| `ready` | Where finished, renamed tracks end up. |

Rules:

- Defaults are derived from the user's home directory, never hardcoded to a specific profile.
- `AUDIOBOX_SOULSEEK`, `AUDIOBOX_INCOMING` and `AUDIOBOX_READY` override the saved values.
  When one is set, the panel says so on that row and disables its button, rather than letting
  the user edit a field that will have no effect.
- Only `soulseekComplete` must already exist. The other two are created on demand.
- Each playlist gets its own subfolder inside `incoming` and `ready`. Both the playlist name
  and the ID are sanitised before being used as a folder name: they arrive from the client,
  and a separator in either would escape the staging folder.
- Paths and settings live in `.audiobox-library.json`, which is gitignored. A fresh clone
  must start with sensible defaults and no leftover data.

## Platform

- Windows and **macOS** are both supported, so every shell call has a platform branch:
  FFmpeg lookup (winget folders on Windows, Homebrew folders on macOS) in src/ffmpeg.js, the
  folder picker and zip in src/server/dev-server.js, and the Recycle Bin or Trash step in
  src/server/library.js. Linux gets a safe no-op where there is no equivalent. Never add a
  PowerShell call without a macOS branch.
- Anything interpolated into a shell string must be sanitised first. The folder picker's
  prompt is restricted to plain text, because a quote or backtick would break out of the
  AppleScript or PowerShell literal.
- `npm start` runs src/cli/start.js, which adds `--use-system-ca` only when the Node version
  supports it (needed behind a TLS-intercepting proxy, harmless elsewhere).
- The app is a **small local web app**: it opens in the browser, looks beautiful, but works
  on the user's actual local files through a local backend (Node). It is not a cloud app and
  not a pure command line script.

## Always Do First

- **Invoke the `frontend-design` skill** before writing any frontend code, every session,
  no exceptions.
- Confirm FFmpeg is available on the machine before relying on conversion. If it is not
  installed, the app must detect this and tell the user clearly how to install it, rather
  than failing silently.

## Design Direction

The app must feel **lekker**: considered, tactile, and specific to DJ track prep. It is
a tool for someone deep in underground minimal, not a generic file utility.

The visual language already exists in `web/styles.css` and must be extended rather than
replaced. Tokens live on `:root`: a DJ booth palette (`--booth-black`, `--wax`, `--jog-amber`,
`--screen-cyan`, `--bone`), Archivo for display, Hanken Grotesk for body, JetBrains Mono for
paths and data, layered colour-tinted shadows, and a single `--ease`.

- Reuse the existing components: `.crate` for a panel, `.crate__head` with an `.eyebrow` and
  a `.crate__state` pill, `.crate__label` for micro-labels, `.input`, and the `.btn`
  variants. Do not invent a parallel set.
- Do NOT use default Tailwind palette colors as the primary.
- The signature element is the live processing chain and the CDJ screen. New panels stay
  quiet so they do not compete with it.
- Structural markers must encode something true. The Folders panel reads From, Through, To
  because a track really does move in that direction; do not add numbering that means nothing.
- Shadows are layered and colour tinted, never flat `shadow-md`.
- Animate only `transform` and `opacity`. Never `transition-all`. Respect reduced motion.
- Every clickable element has hover, focus-visible, and active states.

## Local Server

- **Always serve on localhost.** Never screenshot a `file:///` URL.
- Start the dev server in the background before taking any screenshots.
- If the server is already running, do not start a second instance.

## Screenshot Workflow

- After building UI, screenshot from localhost, read the PNG back, and compare against
  the intended design. Do at least 2 comparison rounds. Be specific about mismatches
  (for example "card gap is 16px but should be 24px"). Stop only when no visible issues
  remain or the user says so.
- Check: spacing and padding, font size, weight, line height, exact colors, alignment,
  border radius, shadows, and the processing animation.

## Hard Rules

- Do not download audio, from any source, for any reason.
- Do not reintroduce audio recognition or mix identification.
- Do not invent metadata. Reformat or fall back or flag, per the configured behaviour.
- Do not rename a file without also fixing its embedded tags. Tags are the priority.
- Do not request Spotify write scopes.
- Do not hardcode a path from one machine or user profile.
- Do not use `transition-all`.
- Do not use default Tailwind blue or indigo as the primary color.
- Do not improve scope beyond the four jobs above without being asked.

## House Conventions (apply consistently)

- Metric units without spaces (for example 240.5mm).
- Correct capitalisation: SolidWorks, AutoCAD, FFmpeg, AIFF, FLAC, WAV, Soulseek, CDJ,
  Spotify, Node.js.
- Writing conventions (no contractions, no em or en dashes, metric units) are covered by the
  global CLAUDE.md, and they apply to interface copy as well as documentation.
- README.md is written for a stranger who has never seen the app. Keep it plain, and keep
  the Spotify five-user explanation in it: without that, the setup step looks arbitrary.
- A remixer or editor named in the title's brackets is not repeated in the Artist field. For
  example "Davor Tosovic, Liuos - Envelope Depth (Liuos Remodel)" becomes "Davor Tosovic -
  Envelope Depth (Liuos Remodel)". Never strip the only artist; "feat." brackets are left
  alone. This is `dropBracketCredits` in src/engine/clean.js, applied to file tags and to the
  Spotify helper.

## Deployment

- Covered by the global CLAUDE.md: localhost until Charles explicitly says to push.
- The code lives in the public GitHub repository `charlesgoldman0-source/audiobox`. Because
  it is public, never commit a token, a Client ID, a personal path, or a playlist: the
  gitignore covers `.audiobox-spotify.json` and `.audiobox-library.json`, and it must stay
  that way.
