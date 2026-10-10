// Interactive offline smoke: only Vessel's own TUI; no external harness or real provider.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MockProvider } from '@vessel/llm';
import type { PermissionActionWidget } from '@vessel/shared';
import { createStdioIO, runChat } from '../../../apps/cli/src/tui/chat.js';
import { ProviderStore } from '../../../apps/cli/src/providers/ProviderStore.js';

const root = path.resolve(import.meta.dirname, '../../..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-v24-terminal-smoke-'));
for (const key of ['VESSEL_PROVIDER_ROOT', 'VESSEL_USAGE_ROOT', 'VESSEL_SESSION_ROOT', 'VESSEL_SETTINGS_ROOT', 'VESSEL_MCP_ROOT']) process.env[key] = workspace;
const io = createStdioIO();
const permission: PermissionActionWidget = { id: 'tty-fixture', kind: 'permission_action', turnIndex: 0,
  timestamp: new Date().toISOString(), status: 'pending', payload: { actionType: 'filesystem_write',
    description: 'Offline fixture: use Right then Enter. No action executes.',
    options: [{ id: 'allow', label: 'Allow fixture', tone: 'primary' }, { id: 'deny', label: 'Deny fixture', tone: 'neutral' }] } };
io.write('Terminal smoke fixture; no real agent or write action.');
io.statusLine?.update({ modelName: 'fixture', sandboxTier: 'unknown', workspaceFingerprint: 'abcdef0123456789', cachedTokensRate: 0.75, activeTurns: 0 });
io.statusLine?.render();
io.writeWidget?.({ id: 'diff', kind: 'diff_inspector', turnIndex: 0, timestamp: permission.timestamp, status: 'pending', payload: {
  filePath: 'fixture.ts', additions: 1, deletions: 1, patch: '--- a/fixture.ts\n+++ b/fixture.ts\n@@ -1 +1 @@\n---counter;\n+++counter;' } });
const selected = await io.selectPermission?.(permission);
io.write(`Selected fixture option: ${selected ?? 'cancelled'}`);
io.dispose?.();
await runChat({ workspaceRoot: workspace, provider: new MockProvider([{ when: /.*/, response: { text: 'Offline TUI smoke complete.' } }]),
  model: 'offline-fixture', store: new ProviderStore({ rootDir: workspace }), settingsRoot: workspace,
  policySystemPath: path.join(root, 'configs/policy.default.yaml'), behaviorIRPath: path.join(root, 'configs/behavior.default.yaml') });
// Preserve the smoke workspace; no deletion is performed.
