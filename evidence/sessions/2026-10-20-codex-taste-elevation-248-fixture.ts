/** Offline visual fixture. Run: npx tsx evidence/sessions/2026-10-20-codex-taste-elevation-248-fixture.ts
 * Port 5678 was checked free; Vite review port 35148 proxies API requests here.
 * Session/project/provider/usage/review roots use this process's temporary directory. No cleanup/deletion.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectRegistry, ReviewHandoffStore, SessionController, SessionRegistry } from '@vessel/application';
import { MockProvider } from '@vessel/llm';
import { createVesselServer } from '../../apps/local-server/src/server.js';
import { createDefaultProviderStore } from '../../apps/local-server/src/providers/defaultStore.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-taste-248-'));
process.env.VESSEL_PROVIDER_ROOT = path.join(root, 'providers');
process.env.VESSEL_USAGE_ROOT = path.join(root, 'usage');
const registry = new SessionRegistry({ vesselHome: path.join(root, 'index') });
const response = '# Navigation audit\nThe workbench keeps projects, sessions and execution evidence in one continuous surface.\n\n## Verification\n> Provider tests reuse saved credentials. Session deletion reports the recycle-bin result.\n\n```typescript\nconst result = await api.testProvider({ name: \'fixture\', apiKey: \'\' });\n```\n\n| Surface | Result |\n|---|---|\n| Workbench | Ready |\n| Activity | No pending approvals |\n\n- Inspect the changes\n- Run the required gates';
const controller = await SessionController.create({
  workspaceRoot: root, model: 'mock', registry,
  provider: new MockProvider([{ when: /.*/, response: { text: response } }]),
  policySystemPath: path.resolve('configs/policy.default.yaml'),
  behaviorIRPath: path.resolve('configs/behavior.default.yaml'), memory: { enabled: false },
});
const projects = new ProjectRegistry({ vesselHome: path.join(root, 'projects') });
projects.open(root);
const server = await createVesselServer({
  port: 5678, host: '127.0.0.1', sessionRegistry: registry, projectRegistry: projects,
  providerStore: createDefaultProviderStore({ rootDir: path.join(root, 'providers') }),
  reviewStore: new ReviewHandoffStore({ reviewsRoot: path.join(root, 'reviews') }),
  staticDir: path.resolve('apps/web/dist'), sessionFactory: async () => controller,
}).listen();
await fetch(`http://127.0.0.1:${server.port}/api/sessions`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceRoot: root }),
});
await controller.runTurn('Review the navigation and report the verification plan.');
console.log(JSON.stringify({ port: server.port, root, sessionId: controller.sessionId, provider: 'offline mock' }));
process.on('SIGINT', () => { void server.close().then(() => controller.close()).then(() => process.exit(0)); });
