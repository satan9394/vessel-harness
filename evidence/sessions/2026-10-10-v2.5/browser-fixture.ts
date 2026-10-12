/** Offline browser QA server. Run with npx tsx evidence/sessions/2026-10-10-v2.5/browser-fixture.ts. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVesselServer } from '../../../apps/local-server/src/server.ts';
import { SessionController, SessionRegistry, ProjectRegistry, ReviewHandoffStore } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import { Session } from '@vessel/core';
import type { ChatRequest, StreamChunk } from '@vessel/shared';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, '../../..');
// Kept as evidence; no cleanup or deletion, and no real user stores are used.
const root = path.join(evidence, 'browser-workspace');
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, 'sample.txt'), 'old first\ncontext\nold last\n');
const home = path.join(root, 'fixture-home');
process.env.VESSEL_PROVIDER_ROOT = path.join(home, 'providers');
process.env.VESSEL_USAGE_ROOT = path.join(home, 'usage');
class SlowOfflineProvider extends MockProvider {
  override async *stream(request: ChatRequest): AsyncGenerator<StreamChunk> {
    for await (const chunk of super.stream(request)) {
      yield chunk;
      if (chunk.type === 'reasoning_delta') await new Promise(resolve => setTimeout(resolve, 5500));
    }
  }
}
const registry = new SessionRegistry({ vesselHome: home, index: true });
const historical = registry.create({ workspaceRoot: root });
const history = await Session.open({ workspaceRoot: root, sessionId: historical.id });
await history.appendSync({ type: 'audit/denial', toolName: 'Shell', toolCallId: 'offline-history', reason: 'Offline fixture policy denial', stage: 'rule', surface: false });
await history.close();
registry.renameTopic(historical.id, 'Offline historical rule fixture');
registry.setTopicArchived(historical.id, true);
let fixtureId = 0;
const server = createVesselServer({ port: Number(process.env.V25_QA_PORT ?? 35725), staticDir: path.join(repo, 'apps/web/dist'),
  sessionRegistry: registry, projectRegistry: new ProjectRegistry({ vesselHome: home }),
  reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(home, 'reviews') }),
  sessionFactory: async input => {
    const controller = await SessionController.create({ ...input,
      model: 'v25-offline-fixture', memory: { enabled: true },
      provider: new SlowOfflineProvider([{ when: /.*/, response: {
        reasoningContent: 'Offline fixture: inspect the two proposed hunks, preserve context, and apply only the selected change.',
        text: 'Offline fixture completed. Review the Patch canvas to accept or discard each hunk.',
      } }], { usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 25 } }),
      behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml'), policySystemPath: path.join(repo, 'configs/policy.default.yaml'),
    });
    controller.bus.on('after_model', () => server.widgets!.publish(controller.sessionId, {
      id: `fixture-patch-${++fixtureId}`, kind: 'diff_inspector', turnIndex: fixtureId,
      timestamp: new Date().toISOString(), status: 'pending', payload: {
        filePath: 'sample.txt', additions: 2, deletions: 2, collapsedByDefault: false,
        patch: '--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-old first\n+new first\n@@ -3 +3 @@\n-old last\n+new last\n',
      },
    }), 'v25-browser-fixture');
    return controller;
  },
});
await server.listen();
console.log(`V25_OFFLINE_QA http://127.0.0.1:${server.port} workspace=${root}`);
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);
