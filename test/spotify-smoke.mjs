// Smoke test for the Spotify endpoints (no real login). Server must be running.
// Saves a dummy Client ID, checks status, confirms the login redirect builds a valid
// Spotify authorize URL, then clears the Client ID so the app starts fresh.
const base = 'http://localhost:4848';

async function postConfig(clientId) {
  await fetch(`${base}/api/spotify/config`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId }),
  });
}

await postConfig('testclient123');
console.log('status after config:', JSON.stringify(await (await fetch(`${base}/api/spotify/status`)).json()));

const login = await fetch(`${base}/api/spotify/login`, { redirect: 'manual' });
const location = login.headers.get('location') || '';
console.log('login status:', login.status);
console.log('redirect host:', location.slice(0, 46));
console.log('has client_id:', location.includes('client_id=testclient123'));
console.log('has pkce:', location.includes('code_challenge_method=S256'));
console.log('has scope:', location.includes('playlist-read-private'));

await postConfig('');
console.log('status after reset:', JSON.stringify(await (await fetch(`${base}/api/spotify/status`)).json()));
