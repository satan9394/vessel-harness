import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ProjectRegistry, ReviewHandoffStore, SessionController, SessionRegistry } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import { createVesselServer } from '../server.js';

describe('effective session Policy', () => {
  it('reads the bound policy and source hashes without activating candidates or rereading changed files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-policy-summary-'));
    const policyPath = path.join(root, 'policy.yaml');
    const bytes = fs.readFileSync(path.resolve('configs/policy.default.yaml'));
    fs.writeFileSync(policyPath, bytes);
    const registry = new SessionRegistry({ vesselHome: path.join(root, 'index') });
    const ctl = await SessionController.create({ workspaceRoot: root, model: 'mock', permission: 'read-only',
      provider: new MockProvider([]), policySystemPath: policyPath,
      behaviorIRPath: path.resolve('configs/behavior.default.yaml'), memory: { enabled: false }, registry });
    const server = await createVesselServer({ port: 0, sessionRegistry: registry,
      projectRegistry: new ProjectRegistry({ vesselHome: root }),
      reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }), sessionFactory: async () => ctl }).listen();
    const base = `http://127.0.0.1:${server.port}`;
    try {
      await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root }) });
      const url = `${base}/api/sessions/${ctl.sessionId}/policy`;
      const response = await fetch(url);
      expect(response.status).toBe(200);
      const before = await response.json() as { sessionId: string; policy: Record<string, unknown> };
      expect(before).toMatchObject({ sessionId: ctl.sessionId, policy: { readOnly: true, profile: 'read-only', approval: 'never',
        sources: [{ kind: 'system', ref: policyPath, hash: createHash('sha256').update(bytes).digest('hex') },
          { kind: 'session', overrides: { profile: 'read-only' } }],
        filesystem: { protected: expect.arrayContaining(['.env']) },
        declarationOnly: expect.arrayContaining([expect.objectContaining({ enforced: false, domain: 'network', reason: expect.any(String) })]),
      } });
      expect(before.policy.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(before)).not.toContain('match');
      fs.writeFileSync(policyPath, bytes.toString().replace('workspace-write', 'danger-full-access'));
      const candidate = await fetch(`${base}/api/behavior/compose`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: ctl.sessionId, entries: [{ id: 'candidate', class: 'safety', channel: 'runtime_policy', render: 'candidate only' }] }) });
      expect(candidate.status).toBe(200);
      expect(await candidate.json()).toMatchObject({ verdict: 'rejected' });
      expect(await (await fetch(url)).json()).toEqual(before);
      const copy = ctl.policyArtifacts;
      copy.sources![0]!.ref = 'tampered';
      expect(await (await fetch(url)).json()).toEqual(before);
      expect((await fetch(url, { method: 'POST' })).status).toBe(405);
      expect((await fetch(url, { headers: { Origin: 'https://foreign.example' } })).status).toBe(403);
      expect((await fetch(`${base}/api/sessions/missing/policy`)).status).toBe(404);
    } finally { await server.close(); await ctl.close(); fs.rmSync(root, { recursive: true, force: true }); }
  }, 30000);
});
