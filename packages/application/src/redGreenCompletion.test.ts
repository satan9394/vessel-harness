import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { ChatProvider } from '@vessel/shared';
import { RedGreenGate } from '@vessel/policy';
import { composeHarness, type ComposedHarness } from './compose.js';

const repo = path.resolve(import.meta.dirname, '../../..');
let root: string; let harness: ComposedHarness | undefined;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-completion-gate-')); });
afterEach(async () => { await harness?.close(); harness = undefined; fs.rmSync(root, { recursive: true, force: true }); });
async function compose(provider: ChatProvider, gate?: RedGreenGate) {
  harness = await composeHarness({ workspaceRoot: root, provider, model: 'mock', taskType: 'bugfix', redGreenGate: gate, memory: { enabled: false },
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') });
  return harness;
}
it('ordinary completion is rejected and audited without modifying core', async () => {
  const h = await compose(new MockProvider([{ when: /.*/, response: { text: 'fixed successfully' } }]));
  await expect(h.loop.runTurn('repair')).rejects.toThrow(/Policy Deny/);
  expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'audit/denial', ruleRef: 'gate:red-green' }));
  expect((await h.policyEngine.decide({ toolName: 'claim_task_complete', arguments: { proof: 'fake' } })).action).toBe('deny');
});
it('streamed completion text is withheld before denial', async () => {
  const provider: ChatProvider = { id: 'fixture', chat: async () => { throw Error('stream only'); }, async *stream() {
    yield { type: 'text_delta', text: 'FIXED_SUCCESSFULLY' }; yield { type: 'message_end', finishReason: 'stop' };
  } };
  const h = await compose(provider); const text: string[] = [];
  h.bus.on('model_stream_delta', payload => { text.push(JSON.stringify(payload)); });
  await expect(h.loop.runTurn('repair')).rejects.toThrow(/Policy Deny/);
  expect(text.join('')).not.toContain('FIXED_SUCCESSFULLY');
});
it.each(['error', 'tool_calls', 'unknown'])('no-tool %s completion still requires evaluator evidence', async finishReason => {
  const provider: ChatProvider = { id: 'fixture', chat: async () => ({ content: 'FAKE_SUCCESS', toolCalls: [], finishReason: finishReason === 'error' ? 'error' : 'tool_calls', usage: { inputTokens: 0, outputTokens: 0 } }), async *stream() {
    yield { type: 'text_delta', text: 'FAKE_SUCCESS' }; yield { type: 'message_end', finishReason };
  } };
  const h = await compose(provider); const text: string[] = [];
  h.bus.on('model_stream_delta', payload => { text.push(JSON.stringify(payload)); });
  await expect(h.loop.runTurn('repair')).rejects.toThrow(/Policy Deny/);
  expect(text.join('')).not.toContain('FAKE_SUCCESS');
});
it('a dangling tool start cannot bypass completion admission', async () => {
  const provider: ChatProvider = { id: 'fixture', chat: async () => { throw Error('stream only'); }, async *stream() {
    yield { type: 'text_delta', text: 'FAKE_SUCCESS' };
    yield { type: 'tool_call_start', id: 'dangling', name: 'Read', arguments: '{}' };
    yield { type: 'message_end', finishReason: 'stop' };
  } };
  const h = await compose(provider); const text: string[] = [];
  h.bus.on('model_stream_delta', payload => { text.push(JSON.stringify(payload)); });
  await expect(h.loop.runTurn('repair')).rejects.toThrow(/Policy Deny/);
  expect(text.join('')).not.toContain('FAKE_SUCCESS');
});
it('evaluator-owned subprocess evidence admits ordinary completion', async () => {
  fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=0');
  fs.writeFileSync(path.join(root, 'repro.cjs'), "require('node:assert/strict').equal(require('./value.cjs'),1,'TARGET_BUG')");
  const gate = new RedGreenGate(); const config = { cwd: root, reproductionCommand: { executable: process.execPath, args: ['repro.cjs'] }, fullSuiteCommand: { executable: process.execPath, args: ['repro.cjs'] }, reproductionFiles: ['repro.cjs'], sourceFiles: ['value.cjs'], allowBaselineFailureReasons: ['TARGET_BUG'] };
  const red = await gate.verifyRedPhase(config); fs.writeFileSync(path.join(root, 'value.cjs'), 'module.exports=1');
  expect((await gate.verifyGreenPhase(red.proof, config)).success).toBe(true);
  const h = await compose(new MockProvider([{ when: /.*/, response: { text: 'fixed successfully' } }]), gate);
  expect((await h.loop.runTurn('repair')).kind).toBe('success');
});
