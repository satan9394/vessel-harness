import { appendFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

// Test-owned state only; no real credentials, models, or external agents.
const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'vessel-card218-browser-'));
for (const kind of ['PROVIDER', 'USAGE', 'SESSION']) process.env[`VESSEL_${kind}_ROOT`] = path.join(fixtureRoot, kind.toLowerCase());
const workspaceRoot = path.join(fixtureRoot, 'workspace');
mkdirSync(workspaceRoot);
const modelEndpoint = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'fixture-a' }, { id: 'fixture-b' }] }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
  void (async () => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const input = JSON.parse(body) as { model: string; stream?: boolean; messages: unknown[] };
    const observed = { at: new Date().toISOString(), observedModel: input.model, messageCount: input.messages.length };
    console.log(JSON.stringify(observed));
    appendFileSync(path.resolve('evidence/sessions/2026-10-12-card218/browser-model-observations.jsonl'), JSON.stringify(observed) + '\n');
    const text = `Local fixture response: ${input.model}`;
    if (input.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5 } }));
    }
  })().catch(() => { if (!res.headersSent) res.writeHead(500); res.end(); });
});
modelEndpoint.listen(0, '127.0.0.1');
await once(modelEndpoint, 'listening');
const modelAddress = modelEndpoint.address() as { port: number };
const { createVesselServer } = await import('../../../apps/local-server/src/server.js');
const { ProjectRegistry } = await import('@vessel/application');
const server = await createVesselServer({ port: 31828, staticDir: path.resolve('apps/web/dist'), projectRegistry: new ProjectRegistry({ vesselHome: fixtureRoot }) }).listen();
const metadata = { url: `http://127.0.0.1:${server.port}`, modelBaseUrl: `http://127.0.0.1:${modelAddress.port}/v1`, workspaceRoot, fixtureRoot };
console.log(JSON.stringify(metadata));
writeFileSync(path.resolve('evidence/sessions/2026-10-12-card218/browser-fixture-meta.json'), JSON.stringify(metadata, null, 2));
// Seed only the isolated fixture, making the screenshot suite reproducible.
async function seed(endpoint: string, body: unknown, method = 'POST') {
  const response = await fetch(`${metadata.url}/api${endpoint}`, { method, headers: { 'Content-Type': 'application/json', Origin: metadata.url }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Fixture seed ${endpoint}: ${response.status}`);
  return response.json();
}
await seed('/projects/open', { workspaceRoot });
await seed('/providers', { name: 'local-fixture', protocol: 'openai-compatible', baseUrl: metadata.modelBaseUrl, apiKey: '', models: ['fixture-a', 'fixture-b'] });
const seeded = await seed('/sessions', { workspaceRoot, provider: 'local-fixture', model: 'fixture-a', permission: 'read-only' }) as { session: { id: string } };
await seed(`/sessions/${seeded.session.id}/topic`, { title: 'Review workbench navigation' }, 'PATCH');
const close = () => { modelEndpoint.close(); void server.close().then(() => process.exit(0)); };
process.on('SIGINT', close);
process.on('SIGTERM', close);

