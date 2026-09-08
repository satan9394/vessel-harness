/**
 * End-to-end smoke: exercise the real local server's SSE + runTurn path the way
 * the web UI does, to confirm deltas match the types in apps/web/src/sse.ts.
 * Runs against `vessel serve` on 127.0.0.1:5678.
 */
const BASE = 'http://127.0.0.1:5678/api';

async function main() {
  const health = await (await fetch(`${BASE}/health`)).json();
  console.log('health:', JSON.stringify(health));

  const ws = `C:\\tmp\\vessel-smoke-${Date.now()}`;
  await fetch(`${BASE}/projects/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspaceRoot: ws }),
  });
  const created = await (
    await fetch(`${BASE}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceRoot: ws }),
    })
  ).json();
  const id = created.session.id;
  console.log('session id:', id);

  // Open the SSE stream and read until we've seen conversation + usage deltas.
  const sseRes = await fetch(`${BASE}/sessions/${id}/events`);
  if (sseRes.status !== 200) throw new Error(`sse status ${sseRes.status}`);
  const reader = sseRes.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const frames: { type: string; delta?: unknown }[] = [];

  async function pump(stopWhen: () => boolean): Promise<void> {
    while (!stopWhen()) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const frame = JSON.parse(line.slice(6));
          frames.push(frame);
        }
      }
    }
  }

  // First ping frame arrives on connect.
  await pump(() => frames.some((f) => f.type === 'ping'));
  console.log('got ping frame');

  // Fire a turn; keep pumping SSE until we see a usage delta.
  const turnP = fetch(`${BASE}/sessions/${id}/turns`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'say hi' }),
  });
  await pump(() => frames.some((f) => f.type === 'usage'));
  const turnRes = await turnP;
  const turn = await turnRes.json();
  console.log('turn:', JSON.stringify(turn));

  // Drain a little more (tool/policy may fire) then stop.
  await pump(() => frames.length >= 20);

  // Print summary of the distinct frame types seen (shape check on the live wire).
  const pivot: Record<string, number> = {};
  for (const f of frames) pivot[f.type] = (pivot[f.type] ?? 0) + 1;
  console.log('frame types seen:', JSON.stringify(pivot));

  const conv = frames.find((f) => f.type === 'conversation');
  console.log('sample conversation delta keys:', conv ? Object.keys(conv.delta as object).join(',') : '(none)');
  const tool = frames.find((f) => f.type === 'tool');
  if (tool) console.log('sample tool delta keys:', Object.keys(tool.delta as object).join(','));
  const usage = frames.find((f) => f.type === 'usage');
  console.log('sample usage delta keys:', usage ? Object.keys(usage.delta as object).join(',') : '(none)');

  reader.cancel();
  console.log('SMOKE_OK');
}

main().catch((err) => {
  console.error('SMOKE_FAIL', err);
  process.exit(1);
});