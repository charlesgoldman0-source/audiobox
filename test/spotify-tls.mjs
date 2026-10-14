// Confirms Node can complete a TLS handshake to Spotify. A 400 is success (it means
// the connection worked and Spotify rejected the dummy grant). "FAIL fetch failed"
// means the TLS trust problem is still present. Run with: node --use-system-ca
const r = await fetch('https://accounts.spotify.com/api/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: 'grant_type=client_credentials',
}).catch((e) => ({ error: e.message }));
if (r.error) console.log('FAIL', r.error);
else console.log('TLS ok, status', r.status);
