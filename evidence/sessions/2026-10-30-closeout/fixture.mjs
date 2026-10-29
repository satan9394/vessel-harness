import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(import.meta.dirname, '../../..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-closeout-'));
const ports = { serve: 5694, provider: 5695, team: 5696 };
const ws = path.join(root, 'ws');
fs.mkdirSync(ws);
for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  process.env[key] = path.join(root, 'home'); fs.mkdirSync(process.env[key], { recursive: true });
}
for (const [key, dir] of Object.entries({ VESSEL_PROVIDER_ROOT: 'providers', VESSEL_USAGE_ROOT: 'usage', VESSEL_MCP_ROOT: 'mcp', VESSEL_SETTINGS_ROOT: 'settings', VESSEL_DAEMON_ROOT: 'daemon' })) {
  process.env[key] = path.join(root, dir); fs.mkdirSync(process.env[key], { recursive: true });
}
process.env.VESSEL_TRASH_TTL_DAYS = '0';
const requests = [];
const expected = Object.fromEntries([298, 300, 570].map(n => [n, '摘要验证。'.repeat(Math.ceil(n / 5)).slice(0, n - 4) + 'END!']));
fs.writeFileSync(path.join(root, 'expected.json'), JSON.stringify(expected, null, 2));
let serve;
let team;
const stub = http.createServer(async (req, res) => {
  if (req.url === '/control/stop') {
    res.end('stopping');
    setImmediate(async () => { serve?.kill(); await team?.close(); stub.close(); });
    return;
  }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'fixture-model', context_window: 8192, supports_tools: true, supports_streaming: true }] })); return;
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const text = JSON.stringify(body.messages ?? []);
  const write = text.includes('WRITE_FIXTURE');
  // Each turn has a new user prompt; only a tool result after the latest user counts.
  const lastUser = body.messages?.findLastIndex(message => message.role === 'user') ?? -1;
  const hasTool = body.messages?.slice(lastUser + 1).some(message => message.role === 'tool');
  const length = /SUMMARY_(298|300|570)/.exec(text)?.[1];
  const tool = write && !hasTool ? { id: `fixture-write-${requests.length}`, type: 'function', function: { name: 'Write', arguments: JSON.stringify({ path: 'fixture.txt', content: 'before\nsecond\n' }) } } : undefined;
  const output = tool ? '' : length ? expected[length] : write ? 'Fixture complete' : 'Assistant reply for the long-title header fixture.';
  requests.push({ at: new Date().toISOString(), url: req.url, stream: body.stream, hasTool, write, length, outputLength: output.length, messages: body.messages, tool });
  fs.writeFileSync(path.join(root, 'requests.json'), JSON.stringify(requests, null, 2));
  if (body.stream) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const frame = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
    frame({ model: 'fixture-model', choices: [{ delta: { role: 'assistant', ...(tool ? { tool_calls: [{ index: 0, ...tool }] } : { content: output }) }, finish_reason: null }] });
    frame({ choices: [{ delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 600 } });
    res.end('data: [DONE]\n\n');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'fixture-model', choices: [{ message: { role: 'assistant', content: output, ...(tool ? { tool_calls: [tool] } : {}) }, finish_reason: tool ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 600 } }));
  }
});
await new Promise((resolve, reject) => { stub.once('error', reject); stub.listen(ports.provider, '127.0.0.1', resolve); });
const { createVesselServer } = await import(pathToFileURL(path.join(repo, 'apps/local-server/dist/index.js')));
const { OpenAICompatibleProvider } = await import(pathToFileURL(path.join(repo, 'packages/llm/dist/index.js')));
const provider = new OpenAICompatibleProvider({ baseUrl: `http://127.0.0.1:${ports.provider}/v1`, model: 'fixture-model' });
team = createVesselServer({ port: ports.team, workspace: ws, teamProviders: { fixture: provider },
  tierBindings: Object.fromEntries(['fast', 'pro', 'auto', 'heavy'].map(tier => [tier, { providerId: 'fixture', model: 'fixture-model' }])) });
await team.listen();
const out = fs.openSync(path.join(root, 'serve.stdout.log'), 'a');
const err = fs.openSync(path.join(root, 'serve.stderr.log'), 'a');
serve = spawn(process.execPath, [path.join(repo, 'apps/cli/dist/cli.js'), 'serve', '--port', String(ports.serve), '--workspace', ws], { cwd: repo, env: process.env, stdio: ['ignore', out, err], windowsHide: true });
fs.closeSync(out); fs.closeSync(err);
const startup = { root, ws, ports, fixturePid: process.pid, servePid: serve.pid, startedAt: new Date().toISOString(), requestedRoute: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', fast: false, agents: false }, writes: 'TEMP only except evidence' };
fs.writeFileSync(path.join(import.meta.dirname, 'startup.json'), JSON.stringify(startup, null, 2));
console.log(JSON.stringify(startup));
