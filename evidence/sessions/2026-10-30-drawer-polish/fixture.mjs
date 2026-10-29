import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
const evidence = import.meta.dirname;
const repo = path.resolve(evidence, '../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-drawer-polish-'));
const ports = { web: 5700, provider: 5701 };
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  process.env[key] = path.join(root, 'home'); fs.mkdirSync(process.env[key], { recursive: true });
}
for (const [key, dir] of Object.entries({ VESSEL_PROVIDER_ROOT: 'providers', VESSEL_USAGE_ROOT: 'usage', VESSEL_MCP_ROOT: 'mcp', VESSEL_SETTINGS_ROOT: 'settings', VESSEL_DAEMON_ROOT: 'daemon' })) {
  process.env[key] = path.join(root, dir); fs.mkdirSync(process.env[key], { recursive: true });
}
process.env.VESSEL_TRASH_TTL_DAYS = '0';
const ws = path.join(root, 'ws'); fs.mkdirSync(ws);
const expected = Object.fromEntries([570, 4800].map(n => [n, '摘要验证。'.repeat(Math.ceil(n / 5)).slice(0, n - 4) + 'END!']));
const requests = [];
const stub = http.createServer(async (req, res) => {
  if (req.url === '/control/stop') {
    await server.close(); res.end('stopped'); stub.close(); return;
  }
  if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-model' }] })); return; }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const length = /SUMMARY_(570|4800)/.exec(JSON.stringify(body.messages))?.[1];
  if (!length) { res.writeHead(400); res.end('Unknown fixture'); return; }
  const output = expected[length]; requests.push({ length: output.length, stream: body.stream });
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const value of [{ model: 'fixture-model', choices: [{ delta: { role: 'assistant', content: output }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 1600 } }]) res.write('data: ' + JSON.stringify(value) + '\n\n');
    res.end('data: [DONE]\n\n');
  } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ model: 'fixture-model', choices: [{ message: { role: 'assistant', content: output }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 1600 } })); }
});
await new Promise((resolve, reject) => { stub.once('error', reject); stub.listen(ports.provider, '127.0.0.1', resolve); });
const { createVesselServer } = await import(pathToFileURL(path.join(repo, 'apps/local-server/dist/index.js')));
const { OpenAICompatibleProvider } = await import(pathToFileURL(path.join(repo, 'packages/llm/dist/index.js')));
const provider = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${ports.provider}/v1`, model: 'fixture-model' });
const server = createVesselServer({ port: ports.web, workspace: ws, staticDir: path.join(repo, 'apps/web/dist'), teamProviders: { fixture: provider }, tierBindings: Object.fromEntries(['fast', 'pro', 'auto', 'heavy'].map(tier => [tier, { providerId: 'fixture', model: 'fixture-model' }])) });
await server.listen();
const base = `http://127.0.0.1:${ports.web}`;
async function api(route, body) {
  const response = await fetch(base + route, { headers: { Origin: base, 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(`${route}: ${response.status}`); return value;
}
await api('/api/providers', { name: 'fixture', protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${ports.provider}/v1`, apiKey: '', models: ['fixture-model'] });
const samples = [];
for (const length of [570, 4800]) {
  const { session } = await api('/api/sessions', { workspaceRoot: ws, provider: 'fixture', model: 'fixture-model', permission: 'workspace-write' });
  const { stage } = await api(`/api/sessions/${session.id}/team-stages`, { task: `SUMMARY_${length}`, mode: 'fast', tasks: [{ id: `summary_${length}`, title: `Summary ${length}`, description: `SUMMARY_${length}`, assignedRole: 'generator', dependencies: [], status: 'pending' }] });
  await api(`/api/team/stages/${stage.id}/approve`, {});
  let done;
  for (let i = 0; i < 100; i++) { done = (await api(`/api/team/stages/${stage.id}`)).stage; if (done.status === 'finished') break; await new Promise(resolve => setTimeout(resolve, 100)); }
  const result = await api(`/api/sessions/${session.id}/team-stages/${stage.id}/tasks/summary_${length}/result`);
  if (result.output !== expected[length]) throw new Error(`Fixture output mismatch: ${length}`);
  samples.push({ length, sessionId: session.id, stageId: stage.id, taskId: `summary_${length}`, stage: done, result });
}
const proof = { pid: process.pid, base, ports, root, ws, staticDir: path.join(repo, 'apps/web/dist'), samples, requests, scope: 'Synthetic local-only provider; isolated user state; existing unchanged backend dist; fresh web production build' };
fs.writeFileSync(path.join(evidence, 'fixture.json'), JSON.stringify(proof, null, 2));
console.log(JSON.stringify({ pid: process.pid, base, root, samples: samples.map(({ length, sessionId, stageId }) => ({ length, sessionId, stageId })) }));
process.on('SIGINT', async () => { await server.close(); stub.close(); });
process.on('SIGTERM', async () => { await server.close(); stub.close(); });
