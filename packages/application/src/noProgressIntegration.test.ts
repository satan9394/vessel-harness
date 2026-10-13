import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { createFsTools } from '@vessel/tools';
import { compilePolicyYaml } from '@vessel/policy';
import { LoopEngine, RealGeneratorAdapter } from '@vessel/engine';
import { composeHarness, type ComposedHarness } from './compose.js';
import { CompactionBoundaryGuard } from '@vessel/context';
import type { ChatMessage } from '@vessel/shared';

const repo = path.resolve(import.meta.dirname, '../../..');
let root: string;
let harness: ComposedHarness | undefined;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-stagnation-')); fs.writeFileSync(path.join(root, 'input.txt'), 'evidence'); });
afterEach(async () => { await harness?.close(); harness = undefined; fs.rmSync(root, { recursive: true, force: true }); });
const provider = () => new MockProvider([{ when: /.*/, response: { toolCalls: [{ name: 'Read', arguments: { path: 'input.txt' } }] } }]);

function strictPairs(messages: ChatMessage[]) {
  const pending = new Set<string>();
  for (const message of messages) {
    if (message.role === 'tool') {
      expect(pending.has(message.toolCallId!)).toBe(true);
      pending.delete(message.toolCallId!);
    } else {
      expect(pending.size).toBe(0);
      for (const call of message.toolCalls ?? []) pending.add(call.id);
    }
  }
  expect(pending.size).toBe(0);
}

it.each(['wire', 'pressure', 'overflow'])('reconciles a production four-call interrupted batch for a resumed new turn (%s)', async mode => {
  const mock = new MockProvider([
    { when: /batch/, response: { toolCalls: Array.from({ length: 4 }, () => ({ name: 'Read', arguments: { path: 'input.txt' } })) } },
    { when: /next/, response: { text: 'done' } },
  ]);
  const stream = mock.stream.bind(mock);
  let overflow = false;
  vi.spyOn(mock, 'stream').mockImplementation(async function* (request) {
    strictPairs(request.messages);
    if (overflow) { overflow = false; throw new Error('maximum context length exceeded'); }
    yield* stream(request);
  });
  const options = { workspaceRoot: root, provider: mock, model: 'mock', memory: { enabled: false }, maxSteps: 20,
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') };
  harness = await composeHarness(options);
  harness.bus.on('tool/call', () => {
    expect(CompactionBoundaryGuard.canCompactHistory(0, harness!.session.replay())).toBe(false);
  }, 'test:active-pending');
  expect((await harness.loop.runTurn('batch')).kind).toBe('interrupted');
  const before = harness.session.replay();
  expect(before.filter(r => r.type === 'tool/result')).toHaveLength(3);
  const attempt = before.find(r => r.type === 'assistant/attempt');
  expect(attempt?.type === 'assistant/attempt' && attempt.toolCalls).toHaveLength(4);
  expect(CompactionBoundaryGuard.canCompactHistory(0, before)).toBe(true);
  const sessionId = harness.session.sessionId;
  await harness.close(); harness = undefined;
  harness = await composeHarness({ ...options, sessionId });
  expect(harness.session.replay().find(r => r.type === 'assistant/attempt')).toEqual(attempt);
  const compact = vi.spyOn(harness.compaction, 'compact');
  if (mode === 'pressure') vi.spyOn(harness.compaction, 'shouldCompact').mockReturnValue(true);
  if (mode === 'overflow') overflow = true;
  expect((await harness.loop.runTurn('next')).kind).toBe('success');
  if (mode !== 'wire') expect(compact).toHaveBeenCalledWith(mode);
  expect(harness.session.replay().filter(r => r.type === 'audit/stagnation_break')).toHaveLength(1);
});

it('keeps a completed reused ID paired after a production abandoned batch and resume', async () => {
  const mock = new MockProvider([
    { when: /batch/, response: { toolCalls: Array.from({ length: 4 }, () => ({ name: 'Read', arguments: { path: 'input.txt' } })) } },
    { when: /next/, maxToolResults: 3, response: { toolCalls: [{ name: 'Read', arguments: { path: 'input.txt' } }] } },
    { when: /next/, minToolResults: 4, response: { text: 'done' } },
  ]);
  const stream = mock.stream.bind(mock);
  vi.spyOn(mock, 'stream').mockImplementation(async function* (request) {
    strictPairs(request.messages);
    const next = request.messages.some(message => message.role === 'user' && message.content === 'next');
    for await (const chunk of stream(request)) {
      if (next && (chunk.type === 'tool_call_start' || chunk.type === 'tool_call_end')) yield { ...chunk, id: 'tc_mock_4' };
      else yield chunk;
    }
  });
  const options = { workspaceRoot: root, provider: mock, model: 'mock', memory: { enabled: false }, maxSteps: 20,
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') };
  harness = await composeHarness(options);
  expect((await harness.loop.runTurn('batch')).kind).toBe('interrupted');
  const sessionId = harness.session.sessionId;
  await harness.close(); harness = undefined;
  harness = await composeHarness({ ...options, sessionId });
  expect((await harness.loop.runTurn('next')).kind).toBe('success');
  const records = harness.session.replay();
  expect(records.filter(record => record.type === 'tool/result')).toHaveLength(4);
  expect(records.filter(record => record.type === 'tool/result' && record.toolCallId === 'tc_mock_4')).toHaveLength(1);
});

it('interrupts the production application loop after three tool executions and persists before observation', async () => {
  harness = await composeHarness({ workspaceRoot: root, provider: provider(), model: 'mock', memory: { enabled: false }, maxSteps: 20,
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'), behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml') });
  harness.bus.on('audit/stagnation_break', () => {
    expect(harness!.session.replay().filter(r => r.type === 'audit/stagnation_break')).toHaveLength(1);
  }, 'test:durability');
  const turn = await harness.loop.runTurn('Read repeatedly');
  expect(turn.kind).toBe('interrupted');
  const records = harness.session.replay();
  expect(records.filter(r => r.type === 'tool/result')).toHaveLength(3);
  expect(records.find(r => r.type === 'audit/stagnation_break')).toMatchObject({ stagnantStepCount: 3, reason: 'workspace_stagnation' });
  await harness.session.flush();
  expect(fs.readFileSync(path.join(root, '.harness', 'sessions', harness.session.sessionId, 'session.jsonl'), 'utf8')).toContain('audit/stagnation_break');
});

it('guards isolated developer sessions and admits a durable engine failure without retrying or continuing', async () => {
  const generator = new RealGeneratorAdapter({ providers: { mock: provider() }, developerProviderId: 'mock', developerModel: 'mock',
    policyArtifacts: compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never\n'),
    tools: createFsTools({ workspaceRoot: root, fsPolicy: { protected: [], denyRead: [], allow: [] } }), maxSteps: 20 });
  const persist = vi.fn(async () => {}); const evaluate = vi.fn(); const shouldContinue = vi.fn(async () => true);
  const engine = new LoopEngine({ selectTask: async () => ({ id: 'repeat', goal: 'Read repeatedly' }), generate: ctx => generator.generate(ctx),
    evaluate, persist, shouldContinue, workspaceFactory: async () => ({ root }), disposeWorkspace: async () => {} }, { maxRetries: 10, maxIterations: 10 });
  const report = await engine.run();
  expect(report).toMatchObject({ outcome: 'stopped', result: { verdict: 'error', retryCount: 1, reason: 'stagnation_break: workspace_stagnation' } });
  expect(evaluate).not.toHaveBeenCalled(); expect(shouldContinue).not.toHaveBeenCalled(); expect(persist).toHaveBeenCalledTimes(1);
  const evidence = JSON.parse(report!.result.evidence[0]!);
  expect(evidence).toMatchObject({ stagnantStepCount: 3, stepIndex: 3, toolName: 'Read' });
});
