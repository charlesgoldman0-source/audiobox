# Audiobox

A small local app that prepares downloaded tracks for a CDJ. Point it at a folder and in one
run it:

1. **Converts FLAC to true AIFF.** A real decode and re-encode with FFmpeg, not a renamed
   file. FLAC is lossless, so the AIFF holds identical audio in an uncompressed container.
   WAV, AIFF and MP3 keep their own format.
2. **Rewrites the embedded Artist and Title tags.** This is the part that matters, because a
   CDJ reads the tags, not the filename.
3. **Renames each file to match:** `Artist - Title`, with several artists comma separated.

It runs on your own machine and opens in your browser. Nothing is uploaded anywhere, and
nothing is deleted: your originals stay where they are.

Audiobox does not download music. It starts from files already on your disk.

## Download the app

The easiest way is the desktop app. Nothing else needs installing: it carries its own copy of
FFmpeg and opens in its own window.

1. Open the [Releases page](https://github.com/charlesgoldman0-source/audiobox/releases/latest).
2. **Windows:** download `Audiobox-Setup-<version>.exe` and run it. Windows may show a blue
   "Windows protected your PC" box because the app is not signed with a paid certificate.
   Click **More info**, then **Run anyway**. A desktop shortcut appears when it is done.
3. **Mac:** download the `.dmg` for your Mac (`arm64` for Apple Silicon, `x64` for Intel),
   open it, and drag Audiobox to Applications. The first time, right-click the app, choose
   **Open**, then **Open** again, because it is not signed with an Apple certificate. If macOS
   says the app is damaged, open Terminal and run
   `xattr -cr /Applications/Audiobox.app`, then try again.

The desktop app keeps its settings in its own data folder, so it does not share them with a
copy run from source. To update it, download the newer installer from the same page and run
it; the settings are kept.

If you would rather run it from source, the rest of this section applies.

## What you need

- **Node.js 20 or newer**, from [nodejs.org](https://nodejs.org)
- **FFmpeg**, which does the audio conversion
- **Git**, to get a copy

## Install on Windows

1. Install Node.js from [nodejs.org](https://nodejs.org).
2. Install FFmpeg. In PowerShell:

   ```
   winget install --id Gyan.FFmpeg -e --source winget
   ```

   Close and reopen PowerShell afterwards so it picks up the new command.
3. Get Audiobox and start it:

   ```
   git clone https://github.com/charlesgoldman0-source/audiobox.git
   cd audiobox
   npm install
   npm start
   ```

4. Open <http://localhost:4848>.

From then on, double-click `Start Audiobox.cmd` in the audiobox folder to start it. The
folder is wherever PowerShell was when you ran `git clone`, usually your own user folder.

## Install on macOS

1. Open Terminal (press Cmd and Space, type Terminal, press Enter).
2. Install [Homebrew](https://brew.sh) if you do not have it, then:

   ```
   brew install node ffmpeg git
   ```

3. Get Audiobox:

   ```
   git clone https://github.com/charlesgoldman0-source/audiobox.git ~/Audiobox
   cd ~/Audiobox
   npm install
   ```

4. Start it by double-clicking `Start Audiobox.command`, or by running `npm start`. If macOS
   says the file cannot be opened, right-click it, choose Open, then Open again.

To stop the app, close the terminal window it is running in.

## Updating

New versions arrive through the same repository. Your settings, meaning the folders, the
checklist and any Spotify sign-in, live in two files inside the Audiobox folder that an
update never touches (`.audiobox-library.json` and `.audiobox-spotify.json`), so they survive
every update.

- **Mac:** close Audiobox if it is running, then double-click `Update Audiobox.command`. It
  fetches the latest version, installs anything new, and starts the app.
- **Windows:** close Audiobox if it is running, then double-click `Update Audiobox.cmd`. It
  does the same as the Mac version.
- **By hand, on either:** close Audiobox, then in the Audiobox folder run `git pull`, then
  `npm install`, then start it again.
- **GitHub Desktop:** Fetch origin, then Pull, then run `npm install` once and start the app.

If an update refuses to apply, a file in the folder was changed by hand. Copy the two
settings files somewhere safe, install Audiobox again following the steps above, and put
them back.

## Using it

### Convert a folder

Click **Convert a folder** in the header, choose any folder of tracks, and check the preview
of what each file will become. Run it, and finished files are written to a `processed`
folder inside it.

### Work from a playlist

The **Playlist to search list** panel turns a Spotify, Apple Music or SoundCloud playlist
into a copy-paste list for searching on Soulseek, one `Artist - Title` per line, with a copy
button on each.

Paste a playlist link and press **Load tracks**. No account and no setup are needed for a
public playlist on any of the three. In Spotify, copy the link from the playlist's Share menu.
In Apple Music, open the playlist, choose Share, then Copy Link; a playlist you made yourself
has to be shared publicly for the link to work. On SoundCloud, open the set, choose Share,
then Copy Link; a private set works through its own share link.

**Make Spotify playlist** turns the list you have built, from any mix of the three services,
into a private playlist on your own Spotify account, so you can listen through it before
searching. It needs the Spotify sign-in below, and if you signed in before this button existed
it asks you to reconnect once to allow playlist creation. Tracks that are not on Spotify are
listed by name and left out, never replaced with a guess. There is no equivalent for Apple
Music or SoundCloud, for the same reasons that block their sign-in.

A single song's link works too, from any of the three. It is added to the list you already
have rather than replacing it, so a few links pasted one after another build up a list of
their own. Lines already on the list are not added twice.

SoundCloud titles are typed by whoever uploaded the track, so the names there are best
effort: Audiobox uses the label's own artist and title where the upload carries them, then an
"Artist - Title" split of the upload's title, and otherwise leaves the artist blank rather
than guess.

As files arrive, Audiobox matches them against the list, so you can see what you still need,
then convert and rename the lot in one go.

### Folders

The **Folders** panel sets the three folders Audiobox moves tracks through. Click **Change**
on any row to pick a folder.

| Row | What it is |
|---|---|
| From | Where your download client writes finished downloads. Audiobox watches this. |
| Through | A staging folder for files Audiobox has pulled in, ready to convert. |
| To | Where finished, renamed tracks end up. |

The staging and finished folders are created for you. The first folder has to already exist,
because your download client is what writes to it: if Audiobox cannot find it, check your
client's own settings for where it saves completed downloads.

Each playlist gets its own subfolder inside the staging and finished folders, named after the
playlist, so separate sets stay separate.

If you would rather set the folders outside the app, set `AUDIOBOX_SOULSEEK`,
`AUDIOBOX_INCOMING` or `AUDIOBOX_READY` before starting. An environment variable overrides
the panel, and the app says so on the affected row.

## Reading your private playlists (optional)

Pasting a link covers public playlists. To read your **own private Spotify** playlists, sign
in under **Sign in to read your private playlists**.

There is no equivalent for Apple Music or SoundCloud. Apple only issues the keys its API
needs to members of the paid Apple Developer Program, and SoundCloud stopped issuing API keys
altogether, so Audiobox cannot offer a sign-in for either that a normal listener could use.
Make the playlist public, or for SoundCloud use its private share link, and paste that.

This needs a few minutes of setup once, and the reason is worth knowing: **Spotify allows
only five signed-in users per developer app**, and the tier that would lift that limit
requires a registered business with at least 250,000 monthly active users. So Audiobox cannot
ship a shared login that works for everybody. Each person uses their own free app instead.

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and sign
   in. Creating an app requires a Spotify Premium subscription.
2. Create an app. Any name will do.
3. Set the Redirect URI to exactly:

   ```
   http://127.0.0.1:4848/api/spotify/callback
   ```

   The app shows this with a copy button. It must match exactly, and Spotify requires
   `127.0.0.1` rather than `localhost` here.
4. Copy the Client ID from your app, paste it into Audiobox, click **Save**, then
   **Connect Spotify**.

Audiobox asks for read-only access and reads playlist names only. It never writes to your
account and never downloads audio from Spotify. Your tokens are stored in
`.audiobox-spotify.json` in the Audiobox folder, on your machine only.

## If something does not work

- **FFmpeg not found** in the header: install it with the command above, then restart the
  app. Check it worked by running `npm run check-ffmpeg`.
- **Port 4848 is already in use**: Audiobox is already running. Open
  <http://localhost:4848>. To use a different port, start it with `PORT=4900 npm start`.
- **A file is flagged instead of renamed**: its tags were blank or unclear and the filename
  did not read as `Artist - Title`. Audiobox never guesses a name, so fix that one by hand.
- **A private playlist will not load**: pasting a link only works for public playlists. Sign
  in, or make the playlist public in Spotify.
- **The Folders panel says a folder does not exist**: that row points somewhere your download
  client is not using. Check its settings and set the row to match.

## Notes

- Tags are reformatted from what each file already carries. Audiobox never invents artist or
  title data. If it cannot work out a name, it flags the file rather than guessing.
- A remixer named in brackets in the title is not repeated in the Artist field, so
  `Davor Tosovic, Liuos - Envelope Depth (Liuos Remodel)` becomes
  `Davor Tosovic - Envelope Depth (Liuos Remodel)`. A `feat.` bracket is left alone.
- Audiobox never renames a file without also fixing its embedded tags.

## Licence

MIT. See [LICENSE](LICENSE).
