import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { SessionController, SessionRegistry, ProjectRegistry, ReviewHandoffStore } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import type { BehaviorInspection } from '@vessel/shared';
import { createVesselServer } from '../server.js';

describe('active behavior introspection', () => {
  it('serves actual session snapshots, observes request hashes, rejects mutations and foreign origins', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-behavior-inspect-'));
    const registry = new SessionRegistry({ vesselHome: path.join(root, 'index') });
    const ctl = await SessionController.create({ workspaceRoot: root, model: 'mock',
      provider: new MockProvider([{ when: /.*/, response: { text: 'fixture' } }]),
      policySystemPath: path.resolve('configs/policy.default.yaml'), behaviorIRPath: path.resolve('configs/behavior.default.yaml'),
      memory: { enabled: false }, registry });
    const server = await createVesselServer({ port: 0, sessionRegistry: registry,
      projectRegistry: new ProjectRegistry({ vesselHome: root }), reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
      sessionFactory: async () => ctl }).listen();
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect((await fetch(`${base}/api/behavior/inspect`)).status).toBe(404);
      await fetch(`${base}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root }) });
      const url = `${base}/api/behavior/inspect?sessionId=${ctl.sessionId}`;
      const before = await (await fetch(url)).json() as { inspection: BehaviorInspection };
      expect(before.inspection.layers.find((layer: { level: string }) => layer.level === 'L4')!.status).toBe('unavailable');
      expect((await fetch(url, { method: 'POST' })).status).toBe(405);
      expect((await fetch(url, { headers: { Origin: 'https://foreign.example' } })).status).toBe(403);
      await ctl.runTurn('inspect behavior');
      const after = await (await fetch(url)).json() as { inspection: BehaviorInspection };
      const layer = after.inspection.layers.find((item: { level: string }) => item.level === 'L4')!;
      expect(layer.status).toBe('available');
      expect(layer.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
      expect(layer.snapshot).toMatchObject({ model: 'mock' });
      expect(JSON.stringify(layer)).not.toContain('inspect behavior');
      const effective = await (await fetch(url.replace('/inspect?', '/effective?'))).json();
      expect(effective).toEqual(after);
      after.inspection.entries[0]!.sourceRef = 'tampered';
      expect(ctl.behaviorInspection.entries[0]!.sourceRef).not.toBe('tampered');
    } finally {
      await server.close(); await ctl.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  }, 30000);
});
