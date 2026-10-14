/**
 * Card 222 offline browser fixture.
 *
 * Serves the built Web app (`apps/web/dist`) plus a real local-server whose
 * TaskTreeRegistry is populated by the real `TaskTreeScheduler` (ARC-10), with a
 * session that has (a) executed a turn (for the trace) and (b) a pending
 * permission decision (for the Activity approval queue).
 *
 *   npx tsx evidence/sessions/2026-10-14-card222/browser-fixture.ts
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ProjectRegistry,
  ReviewHandoffStore,
  SessionController,
  SessionRegistry,
  TaskTreeRegistry,
  TaskTreeScheduler,
} from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import type { AgentInstanceSpec } from '@vessel/shared';
import { createVesselServer } from '../../../apps/local-server/src/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = 32822;
const budget = { maxModelSteps: 6, maxToolCalls: 12, maxElapsedMs: 60_000, maxConsecutiveErrors: 2 };
const spec = (instanceId: string, parentInstanceId?: string): AgentInstanceSpec => ({
  instanceId, parentInstanceId,
  modelProfileRef: 'model:mock', behaviorSnapshotRef: 'sha256:card222beef', policyScopeRef: 'policy:workspace-write',
  contextScopeRef: 'context:default', toolScopeRef: 'tools:read-only', budget,
});

async function seedTree(projectRoot: string, rootId: string): Promise<void> {
  const scheduler = new TaskTreeScheduler({
    projectRoot, rootInstanceId: rootId, registry: taskTrees, maxConcurrency: 2,
    leaseTtlMs: 5_000,
    tasks: [
      { spec: spec(rootId), title: 'Coordinate refactor', presetScope: { allowedTools: ['Read', 'Write', 'Bash'], deniedTools: ['Delete'], writablePaths: ['E:/repo'], network: true, approvals: 'inherit' } },
      { spec: spec('explore', rootId), title: 'Explore call sites', presetScope: { allowedTools: ['Read'], deniedTools: [], writablePaths: [], network: false, approvals: 'ask' } },
      { spec: spec('patch', rootId), title: 'Apply patch', dependencies: ['explore'], presetScope: { allowedTools: ['Read', 'Write'], deniedTools: ['Bash'], writablePaths: ['E:/repo'], network: false, approvals: 'ask' } },
      { spec: spec('verify', rootId), title: 'Verify build', dependencies: ['patch'], presetScope: { allowedTools: ['Read', 'Bash'], deniedTools: ['Write'], writablePaths: [], network: false, approvals: 'never' } },
      { spec: spec('docs', rootId), title: 'Refresh docs', dependencies: ['patch'], presetScope: { allowedTools: ['Read', 'Write'], deniedTools: [], writablePaths: ['E:/repo/docs'], network: false, approvals: 'ask' } },
    ],
    executor: async (node) => {
      if (node.instanceId === 'verify') return { status: 'failed', error: 'tsc -b failed: 2 type errors' };
      if (node.instanceId === 'docs') return { status: 'completed', result: { output: 'docs refreshed' } };
      if (node.instanceId === 'patch') return { status: 'waiting_approval', approvalId: 'ap-patch' };
      return { status: 'completed', result: { output: `${node.title} complete` } };
    },
  });
  await scheduler.run();
  // `patch` stays `waiting_approval` (its descendants remain `pending`) so the
  // captured tree shows the full status spread.
  taskTrees.publish(scheduler.snapshot());
}

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-card222-fixture-'));
const sessionRegistry = new SessionRegistry({ vesselHome: path.join(workspace, 'index') });
const taskTrees = new TaskTreeRegistry();

await seedTree('E:/Code_file/Projects/Vessel_Harness', 'card222-root');
await seedTree('E:/Code_file/Projects/second-repo', 'card222-root-b');

const ctl = await SessionController.create({
  workspaceRoot: workspace, model: 'mock',
  provider: new MockProvider([{ when: /.*/, response: { text: 'Refactor plan ready: 3 files touched.' } }]),
  policySystemPath: path.resolve('configs/policy.default.yaml'),
  behaviorIRPath: path.resolve('configs/behavior.default.yaml'),
  memory: { enabled: false }, registry: sessionRegistry,
});

const server = await createVesselServer({
  port: PORT, sessionRegistry, taskTrees,
  projectRegistry: new ProjectRegistry({ vesselHome: workspace }),
  reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(workspace, 'reviews') }),
  staticDir: path.resolve('apps/web/dist'),
  sessionFactory: async () => ctl,
}).listen();

const base = `http://127.0.0.1:${server.port}`;
await fetch(`${base}/api/sessions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ workspaceRoot: workspace }),
});
await ctl.runTurn('Plan the refactor of the navigation module.');

// A pending permission decision so the Activity approval queue is populated.
// `request` keeps the decision pending for the whole capture window (default
// `publish` expires after 60s).
void server.widgets!.request(ctl.sessionId, {
  id: 'w-approve-card222', kind: 'permission_action', turnIndex: 1, timestamp: new Date().toISOString(), status: 'pending',
  payload: {
    actionType: 'filesystem_write',
    description: 'Write src/components/navigation.ts (12 lines)',
    options: [{ id: 'allow-once', label: 'Allow once', tone: 'primary' }, { id: 'deny', label: 'Deny', tone: 'danger' }],
  },
}, 3_600_000).catch(() => { /* expires with the fixture */ });

fs.writeFileSync(path.join(HERE, 'browser-fixture-meta.json'), JSON.stringify({
  url: base, sessionId: ctl.sessionId, workspaceRoot: workspace,
  taskTreeRoots: ['card222-root', 'card222-root-b'],
  approvalWidgetId: 'w-approve-card222',
  startedAt: new Date().toISOString(),
}, null, 2));
process.stdout.write(`card222 fixture serving ${base} (session ${ctl.sessionId})\n`);

const shutdown = async () => { await server.close(); await ctl.close(); process.exit(0); };
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
