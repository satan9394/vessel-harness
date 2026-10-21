import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { SessionRegistry, ProjectRegistry, ReviewHandoffStore } from '@vessel/application';
import { createVesselServer } from '../apps/local-server/src/server.js';
import { ProviderStore } from '../apps/local-server/src/providers/ProviderStore.js';

// Read the retained audit session; isolate all registry/provider writes from user state.
const id = 'sess_1792583751073_cc114a5b';
const source = new SessionRegistry();
const meta = source.get(id);
assert(meta, 'Retained Task 253 session must exist');
const log = path.join(meta.workspaceRoot, '.harness', 'sessions', id, 'session.jsonl');
const hash = () => createHash('sha256').update(fs.readFileSync(log)).digest('hex');
const before = hash();
const home = fs.mkdtempSync(path.resolve('evidence/sessions/task254-replay-'));
const registry = new SessionRegistry({ vesselHome: home });
registry.put(meta);
const server = createVesselServer({
  port: 0, sessionRegistry: registry,
  projectRegistry: new ProjectRegistry({ vesselHome: home }),
  reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(home, 'reviews') }),
  providerStore: new ProviderStore({ rootDir: path.join(home, 'providers') }),
});
await server.listen();
try {
  const base = `http://127.0.0.1:${server.port}`;
  const responses = await Promise.all([
    fetch(`${base}/api/sessions/${id}`), fetch(`${base}/api/sessions/${id}/messages`),
  ]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const transcript = await responses[1]!.json() as { messages: { msg?: { role: string; text: string } }[]; usage: unknown[] };
  assert.equal(transcript.messages.filter(item => item.msg?.role === 'user').length, 1);
  assert.equal(transcript.messages.filter(item => item.msg?.role === 'assistant').length, 1);
  const abort = new AbortController();
  const events = await fetch(`${base}/api/sessions/${id}/events?hydrate=1`, { signal: abort.signal });
  const frame = new TextDecoder().decode((await events.body!.getReader().read()).value);
  assert(frame.includes('"type":"transcript"'));
  assert(frame.includes('"role":"user"') && frame.includes('"role":"assistant"'));
  abort.abort();
  const proof = { id, port: server.port, http: responses.map(r => r.status), messages: transcript.messages.length,
    usageCalls: transcript.usage.length, sseSnapshot: true, before, after: hash(),
    browser: 'Unavailable: browser inventory empty; iab creation rejected', isolatedRegistry: home, platform: os.platform() };
  assert.equal(proof.before, proof.after, 'Original session log must remain unchanged');
  fs.writeFileSync('evidence/sessions/2026-10-21-task254-retained-session.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
} finally { await server.close(); }
