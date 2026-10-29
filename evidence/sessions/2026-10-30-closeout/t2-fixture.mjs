import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const evidence = import.meta.dirname;
const repo = path.resolve(evidence, '../../..');
const initial = JSON.parse(fs.readFileSync(path.join(evidence, 'startup.json')));
const root = path.join(initial.root, 't2-final');
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) { process.env[key] = path.join(root, 'home'); fs.mkdirSync(process.env[key], { recursive: true }); }
for (const [key, dir] of Object.entries({ VESSEL_PROVIDER_ROOT: 'providers', VESSEL_USAGE_ROOT: 'usage', VESSEL_MCP_ROOT: 'mcp', VESSEL_SETTINGS_ROOT: 'settings', VESSEL_DAEMON_ROOT: 'daemon' })) { process.env[key] = path.join(root, dir); fs.mkdirSync(process.env[key], { recursive: true }); }
process.env.VESSEL_TRASH_TTL_DAYS = '0';
const ws = path.join(root, 'ws'); fs.mkdirSync(ws, { recursive: true });
const { createVesselServer } = await import(pathToFileURL(path.join(repo, 'apps/local-server/dist/index.js')));
const { OpenAICompatibleProvider } = await import(pathToFileURL(path.join(repo, 'packages/llm/dist/index.js')));
const provider = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${initial.ports.provider}/v1`, model: 'fixture-model' });
const server = createVesselServer({ port: 5698, workspace: ws, staticDir: path.join(initial.root, 'web-final'), teamProviders: { fixture: provider }, tierBindings: Object.fromEntries(['fast', 'pro', 'auto', 'heavy'].map(tier => [tier, { providerId: 'fixture', model: 'fixture-model' }])) });
await server.listen();
const base = 'http://127.0.0.1:5698';
async function api(route, body) {
  const response = await fetch(base + route, { headers: { Origin: base, 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const value = await response.json(); if (!response.ok) throw new Error(`${route}: ${response.status} ${JSON.stringify(value)}`); return value;
}
await api('/api/providers', { name: 'fixture', protocol: 'openai-compatible', baseUrl: `http://127.0.0.1:${initial.ports.provider}/v1`, apiKey: '', models: ['fixture-model'] });
const { session } = await api('/api/sessions', { workspaceRoot: ws, provider: 'fixture', model: 'fixture-model', permission: 'workspace-write' });
await fetch(base + `/api/sessions/${session.id}/topic`, { method: 'PATCH', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'T2 final drawer verification' }) });
const stages = [];
for (const length of [298, 300, 570]) {
  const { stage } = await api(`/api/sessions/${session.id}/team-stages`, { task: `SUMMARY_${length}`, mode: 'fast', tasks: [{ id: `summary_${length}`, title: `Summary ${length}`, description: `SUMMARY_${length}`, assignedRole: 'generator', dependencies: [], status: 'pending' }] });
  await api(`/api/team/stages/${stage.id}/approve`, {});
  let done;
  for (let i = 0; i < 100; i++) { done = (await api(`/api/team/stages/${stage.id}`)).stage; if (done.status === 'finished') break; await new Promise(resolve => setTimeout(resolve, 100)); }
  stages.push({ requestedLength: length, stage: done, result: await api(`/api/sessions/${session.id}/team-stages/${stage.id}/tasks/summary_${length}/result`) });
}
const proof = { pid: process.pid, port: 5698, root, ws, session, stages };
fs.writeFileSync(path.join(evidence, 't2-final-fixture.json'), JSON.stringify(proof, null, 2)); console.log(JSON.stringify({ pid: process.pid, port: 5698, session: session.id, outputs: stages.map(stage => stage.result.output.length) }));
process.on('SIGINT', async () => { await server.close(); process.exitCode = 0; });
process.on('SIGTERM', async () => { await server.close(); process.exitCode = 0; });
