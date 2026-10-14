// Checks how many tracks the embed returns for several playlists, to see if large
// playlists are capped. Run with: node --use-system-ca test/spotify-embed.mjs
// Add a few of your own public playlist IDs here, ideally a mix of small and large, then
// run the script. Nothing is downloaded: it only counts the names the embed page returns.
// A playlist ID is the part after /playlist/ in a Spotify share link.
const ids = {
  // 'a small playlist': 'paste the id here',
  // 'a large playlist': 'paste the id here',
};

if (Object.keys(ids).length === 0) {
  console.log('Add at least one playlist ID to the ids object at the top of this file.');
  process.exit(0);
}

async function embedTracks(id) {
  const r = await fetch(`https://open.spotify.com/embed/playlist/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
  });
  if (!r.ok) return { status: r.status, tracks: [] };
  const html = await r.text();
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
  if (!m) return { status: r.status, tracks: [], note: 'no data block' };
  const data = JSON.parse(m[1]);
  const pp = (data.props && data.props.pageProps) || {};
  const entity = (pp.state && pp.state.data && pp.state.data.entity) || pp.entity || {};
  return { status: r.status, tracks: entity.trackList || [] };
}

for (const [name, id] of Object.entries(ids)) {
  const { status, tracks, note } = await embedTracks(id);
  const multi = tracks.find((t) => (t.subtitle || '').includes(','));
  console.log(`${String(name).padEnd(26)} status ${status}  tracks ${tracks.length}  ${note || ''}`);
  if (multi) console.log(`   multi-artist example: ${multi.subtitle} - ${multi.title}`);
}
