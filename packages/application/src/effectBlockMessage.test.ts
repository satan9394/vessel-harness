import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Session } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { EffectJournal } from '@vessel/runtime';
import type { CanonicalToolInvocation, ToolSpec } from '@vessel/shared';
import { SessionController } from './session/SessionController.js';

/**
 * Card 282. When a session is blocked by an unknown effect, the transcript used to show only
 * `OUTCOME_UNKNOWN: ...`, and the model's honest reading of that is "the tool is broken" (measured
 * in card 276: three retries, then it told the user Shell was unavailable). The block is an
 * operator problem, so the message has to name the command that clears it, with this session's id.
 */
const repo = path.resolve(import.meta.dirname, '../../..');
let root: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-effect-block-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const call = { toolCallId: 'call_from_crash', toolName: 'Write', arguments: { path: 'a.txt' } };
const tool = { name: 'Write', requiredPermission: 'workspace-write', effects: 'non_idempotent' } as ToolSpec;
const invocation: CanonicalToolInvocation = {
  canonicalToolId: 'builtin:Write', subject: { sessionId: 'sess_blocked', runId: 'r', agentInstanceId: 'a' },
  argumentsCanonicalHash: 'seed', requestedScopes: [],
};

it('tells the operator which command clears the block, and still refuses to run the write', async () => {
  const sessionId = 'sess_blocked';
  const seed = await Session.open({ workspaceRoot: root, sessionId });
  new EffectJournal(path.join(seed.dir, 'execution.jsonl')).begin(call, tool, invocation);
  await seed.close();

  const controller = await SessionController.create({
    workspaceRoot: root, sessionId, model: 'mock', permission: 'danger-full-access',
    provider: new MockProvider([
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: { path: 'x.txt', content: 'x' } }] } },
      { when: /.*/, minToolResults: 1, response: { text: 'blocked' } },
    ]),
    policySystemPath: path.join(repo, 'configs/policy.default.yaml'),
    behaviorIRPath: path.join(repo, 'configs/behavior.default.yaml'),
  });
  try {
    await controller.runTurn('Create x.txt');
    const results = controller.session.replay().filter((record): record is Extract<typeof record, { type: 'tool/result' }> => record.type === 'tool/result');
    expect(results).toHaveLength(1);
    expect(results[0]!.error?.errorClass).toBe('DENIED');
    const message = results[0]!.error?.message ?? '';
    expect(message).toContain('OUTCOME_UNKNOWN');
    expect(message).toContain('call_from_crash#1');
    expect(message).toContain(`vessel effects resolve --session ${sessionId}`);
    // The write never happened, and the block is still on until a human resolves it.
    expect(fs.existsSync(path.join(root, 'x.txt'))).toBe(false);
    expect(controller.pendingEffects()).toMatchObject([{ key: 'call_from_crash', attempt: 1 }]);
  } finally { await controller.close(); }
});
