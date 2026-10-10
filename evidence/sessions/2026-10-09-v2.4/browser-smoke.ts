// Offline integration fixture: no real provider, external agent or filesystem write action.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionController, SessionRegistry, ProjectRegistry } from '@vessel/application';
import type { ChatProvider, WidgetBlock, PermissionActionWidget } from '@vessel/shared';
import { createVesselServer, type VesselServer } from '../../../apps/local-server/src/server.js';
import { WorkspaceFingerprinter } from '@vessel/tools';

const root = path.resolve(import.meta.dirname, '../../..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-v24-browser-smoke-'));
let server: VesselServer;
server = createVesselServer({
  port: Number(process.env.VESSEL_SMOKE_PORT ?? 30824),
  staticDir: path.join(root, 'apps/web/dist'),
  observeWorkspace: WorkspaceFingerprinter.compute,
  sessionRegistry: new SessionRegistry({ vesselHome: workspace }),
  projectRegistry: new ProjectRegistry({ vesselHome: workspace }),
  sessionFactory: async input => {
    let controller: SessionController;
    let turnIndex = 0;
    const provider: ChatProvider = {
      id: 'offline-widget-fixture',
      async chat() {
        const base = { turnIndex: turnIndex++, timestamp: new Date().toISOString(), status: 'pending' as const };
        const prefix = `fixture-${base.turnIndex}`;
        const blocks: WidgetBlock[] = [
          { ...base, id: `${prefix}-diff`, kind: 'diff_inspector', payload: {
            filePath: 'fixture/arithmetic.ts', additions: 12, deletions: 12,
            patch: '--- a/fixture/arithmetic.ts\n+++ b/fixture/arithmetic.ts\n@@ -1,12 +1,12 @@\n' + Array.from({ length: 12 }, (_, i) => `-const old${i} = ${i};\n+const next${i} = ${i + 1};`).join('\n'),
          } },
          { ...base, id: `${prefix}-gate`, kind: 'red_green_gate', payload: {
            phase: 'green_verified', command: 'offline fixture gate (synthetic)', exitCode: 0, proofSha256: 'a'.repeat(64),
          } },
          { ...base, id: `${prefix}-impact`, kind: 'impact_radar', payload: { targetSymbol: 'sum', blastRadius: {
            modifiedFiles: ['fixture/arithmetic.ts'], affectedCallers: [{ filePath: 'fixture/caller.ts', symbolName: 'total' }],
          } } },
        ];
        for (const block of blocks) server.widgets!.publish(controller.sessionId, block);
        const permission: PermissionActionWidget = { ...base, id: `${prefix}-permission`, kind: 'permission_action', payload: {
          actionType: 'filesystem_write', description: 'Offline fixture: choose an option; no file will be written.',
          options: [{ id: 'allow', label: 'Approve fixture', tone: 'primary' }, { id: 'deny', label: 'Reject fixture', tone: 'neutral' }],
        } };
        const decision = await server.widgets!.request(controller.sessionId, permission, 180_000);
        console.log(`Fixture decision: ${JSON.stringify(decision)}`);
        return { content: `Offline fixture completed: ${decision?.selectedOptionId ?? 'expired'}.`, toolCalls: [], finishReason: 'stop',
          usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 75, cacheMetrics: {
            provider: 'offline-widget-fixture', model: 'fixture', promptTokens: 100, cachedTokens: 75, creationTokens: 0, billedHitRate: 0.75, estimatedSavingsUsd: 0,
          } } };
      },
    };
    controller = await SessionController.create({ ...input, provider, model: 'fixture', memory: { enabled: false },
      policySystemPath: path.join(root, 'configs/policy.default.yaml'), behaviorIRPath: path.join(root, 'configs/behavior.default.yaml') });
    return controller;
  },
});
await server.listen();
const created = await fetch(`http://127.0.0.1:${server.port}/api/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: workspace }) });
console.log(JSON.stringify({ port: server.port, workspace, session: (await created.json()) }));
process.on('SIGINT', () => { void server.close().then(() => process.exit(0)); });
// Preserve fixture state for inspection; this smoke never deletes user or generated files.
