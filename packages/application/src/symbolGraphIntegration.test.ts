import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposedHarness } from './compose.js';

const repo = path.resolve(import.meta.dirname, '../../..');
let root: string; let harness: ComposedHarness | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-symbol-integration-'));
  fs.writeFileSync(path.join(root, 'api.ts'), 'export function execute() { return 1 }');
  fs.writeFileSync(path.join(root, 'caller.ts'), 'import { execute } from "@vessel/api"; export function caller() { return execute() }');
});
afterEach(async () => { await harness?.close(); harness = undefined; fs.rmSync(root, { recursive: true, force: true }); });
async function compose(enabled: boolean, deny = false) {
  const projectPolicy = path.join(root, 'policy.yaml');
  if (deny) fs.writeFileSync(projectPolicy, 'policy:\n  tools:\n    deny: [code_symbol_graph]\n');
  harness = await composeHarness({ workspaceRoot: root, provider: new MockProvider([
    { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'code_symbol_graph', arguments: { action: 'get_references', filePath: 'api.ts', symbolName: 'execute' } }] } },
    { when: /.*/, minToolResults: 1, response: { text: 'done' } },
  ]), model: 'mock', memory: { enabled: false },
  symbolGraph: enabled ? { filePaths: ['api.ts', 'caller.ts'], paths: { '@vessel/*': ['./*.ts'] } } : undefined,
  policyProjectPath: deny ? projectPolicy : undefined,
  policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') });
  return harness;
}
it('keeps AST tool opt-in in the actual composition registry', async () => {
  const h = await compose(false);
  expect(h.registry.spec('code_symbol_graph')).toBeUndefined();
});
it('actual loop resolves configured workspace aliases through the registered AST tool', async () => {
  const h = await compose(true);
  expect(h.registry.listVisible().some(tool => tool.name === 'code_symbol_graph')).toBe(true);
  await h.loop.runTurn('find exact callers');
  const results = h.session.replay().filter(record => record.type === 'tool/result');
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ toolName: 'code_symbol_graph' });
  expect(JSON.parse(results[0]!.content!).edges).toContainEqual({ fromId: 'caller.ts#caller', toId: 'api.ts#execute', relation: 'references' });
});
it('policy removes denied AST schema and denies a forced generator tool call with an audit', async () => {
  const h = await compose(true, true);
  expect(h.registry.listVisible().some(tool => tool.name === 'code_symbol_graph')).toBe(false);
  await h.loop.runTurn('force graph call');
  expect(h.session.replay().filter(record => record.type === 'tool/result')).toMatchObject([{ error: { errorClass: 'DENIED' } }]);
  expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'audit/denial', toolName: 'code_symbol_graph' }));
});
