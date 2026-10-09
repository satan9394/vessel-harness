import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { composeHarness, type ComposedHarness } from './compose.js';

const repo = path.resolve(import.meta.dirname, '../../..');
let root: string; let harness: ComposedHarness | undefined;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-pruning-composed-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  fs.writeFileSync(path.join(root, '.git/info/exclude'), '*.ts\n.harness/\n');
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(root, `f${i}.ts`), `export function f${i}(): number {\n${'const internal = 1;\n'.repeat(300)}return 1; }`);
});
afterEach(async () => { await harness?.close(); harness = undefined; fs.rmSync(root, { recursive: true, force: true }); });
async function compose(denyRead = false) {
  const policyProjectPath = path.join(root, 'policy.yaml');
  if (denyRead) fs.writeFileSync(policyProjectPath, 'policy:\n  filesystem:\n    deny_read: ["f0.ts"]\n');
  harness = await composeHarness({ workspaceRoot: root, provider: new MockProvider([]), model: 'mock', memory: { enabled: false },
    symbolGraph: { filePaths: Array.from({ length: 8 }, (_, i) => `f${i}.ts`) },
    adaptivePruning: { tokenThreshold: 100, targetTokenBudget: 0, preserveRecentTurns: 3, activeFiles: ['f0.ts'] },
    policyProjectPath: denyRead ? policyProjectPath : undefined,
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') });
  return harness;
}
it('composition shares guarded AST indexing and applies pruning to real Read results', async () => {
  const h = await compose();
  await h.session.appendSync({ type: 'user/message', msgId: 'u', role: 'user', content: 'task definition', surface: true });
  for (let i = 0; i < 8; i++) {
    await h.session.appendSync({ type: 'assistant/attempt', msgId: `a${i}`, content: '', attemptNo: 1, surface: false,
      toolCalls: [{ toolCallId: `r${i}`, name: 'Read', arguments: { path: `f${i}.ts` } }] });
    const result = await h.registry.spec('Read')!.execute({ path: `f${i}.ts` }, { workspaceRoot: root, cwd: root });
    await h.session.appendSync({ type: 'tool/result', toolCallId: `r${i}`, toolName: 'Read', content: result.content, meta: result.meta, surface: true });
  }
  const envelope = await h.builder.assemble(1);
  expect(envelope.messages.find(m => m.toolCallId === 'r1')!.content).toContain('AST skeleton');
  expect(envelope.messages.find(m => m.toolCallId === 'r0')!.content).toContain('const internal');
  expect(envelope.messages.find(m => m.toolCallId === 'r7')!.content).toContain('const internal');
  expect(envelope.messages.find(m => m.content === 'task definition')).toBeDefined();
  expect(envelope.pruning!.blastRadius.modifiedFiles).toEqual([]);
});
it('pruning uses graph filesystem guards and cannot index a denied configured file', async () => {
  const h = await compose(true);
  await expect(h.builder.assemble(1)).rejects.toThrow(/deny_read|denied/i);
});
