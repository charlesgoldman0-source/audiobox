import { fileURLToPath } from 'node:url';
// Confirms the /api/process SSE stream emits the expected lifecycle events.
// Requires the server running. Run: node test/process-stream.test.mjs
const folder = fileURLToPath(new URL('./fixtures/in', import.meta.url));
const res = await fetch(`http://localhost:4848/api/process?folder=${encodeURIComponent(folder)}`);
const reader = res.body.getReader();
const decoder = new TextDecoder();
let buf = '';
const counts = {};

while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += decoder.decode(value, { stream: true });
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const chunk = buf.slice(0, i);
    buf = buf.slice(i + 2);
    const data = chunk.replace(/^data: /, '');
    try {
      const msg = JSON.parse(data);
      counts[msg.type] = (counts[msg.type] || 0) + 1;
      if (msg.type === 'stage') console.log(`  stage ${msg.stage.padEnd(8)} ${msg.name}`);
      if (msg.type === 'file-done') console.log(`  DONE  ${msg.result.newName}  [${msg.result.audio?.label}]  verify=${msg.result.verifyOk}`);
      if (msg.type === 'file-error') console.log(`  ERROR ${msg.name}: ${msg.message}`);
    } catch { /* ignore keep-alives */ }
  }
}
console.log('\nevent counts:', JSON.stringify(counts));
