import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ChatProvider, ChatResponse, PolicyArtifacts, TeamEndPayload } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { compilePolicyYaml } from '@vessel/policy';
import { TeamRuntime } from './TeamRuntime.js';

/**
 * BRIEF「同一件事三处实现、两套口径」—— TeamRuntime 的 stopReason 口径（**复现①：越词表**）。
 *
 * 代码路径（改前）：`TeamRuntime.runMemberPhase` 的
 *   `stopReason: turn.kind === 'success' ? undefined : turn.kind`
 * —— 直接把**回合 kind** 当 `stopReason` 输出 ⇒ 产出 `'budget'`/`'interrupted'`，
 * 而 `SubagentResultContract.stopReason`（packages/shared/src/events.ts:242）的词表是
 * `completed|aborted|error|max_tokens|refusal|denied` ⇒ **这两个值不在其中**。
 *
 * ## 为什么本文件把 `createIsolatedRuntime` 换成替身
 *
 * 顶层团队成员跑在 `runMemberPhase` **内部自建**的隔离运行时上，循环句柄不外泄；而
 * `kind='interrupted'` 只能由 `InterruptController.interrupt()` 产生（外部中断），
 * `TeamRuntime` 没有任何 signal/句柄入口 ⇒ **无法**从测试侧对真实 loop 触发一次中断
 * （provider 抛错也到不了这条分支：`AgentLoop.callModel` 会把它包成普通 Error，
 * 见 AgentLoop.ts:539-547）。故本文件把「回合结果」直接作为输入，只断言
 * **TeamRuntime 对 `turn.kind` 的映射**这一被测行为；替身只实现 TeamRuntime 真正用到的
 * `session.sessionId` / `loop.runTurn` / `close` 三个成员。
 *
 * 真实链路（不含任何替身）下的同族复现见同目录 `team-runtime.test.ts` 的
 * BRIEF-stopReason① 用例（空文本 MockProvider ⇒ AgentLoop 兜底判 `kind='budget'`）。
 */
const fake = vi.hoisted(() => ({ turns: [] as { kind: string; finalText: string }[] }));

vi.mock('../subagent/IsolatedRuntime.js', () => ({
  createIsolatedRuntime: async () => ({
    session: { sessionId: 'fake_session_stop_reason' },
    loop: {
      runTurn: async () => {
        const turn = fake.turns.shift() ?? { kind: 'success', finalText: 'FAKE-OUT' };
        return {
          turnId: 'turn_fake',
          kind: turn.kind,
          steps: 1,
          toolCalls: 0,
          finalText: turn.finalText,
          durationMs: 1,
        };
      },
    },
    close: async () => {},
  }),
}));

const POLICY_YAML = `
policy:
  version: 1
  profile: workspace-write
  approval: never
  filesystem:
    protected: ['.git', '.git/**']
  shell:
    deny: ['destructive-delete']
  tools:
    deny: []
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

/** provider 只是结构占位（替身运行时不会调用它）—— 保持 TeamRuntime 的构造契约即可。 */
const DUMMY_PROVIDER: ChatProvider = {
  id: 'mock',
  async chat(): Promise<ChatResponse> {
    return { content: '', toolCalls: [], finishReason: 'stop', usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

/** shared `SubagentResultContract.stopReason` 词表（packages/shared/src/events.ts:242）逐字副本。 */
const VOCABULARY: readonly string[] = ['completed', 'aborted', 'error', 'max_tokens', 'refusal', 'denied'];

function buildRuntime(workspace: string, bus: EventBus): TeamRuntime {
  return new TeamRuntime({
    workspaceRoot: workspace,
    providers: { mock: DUMMY_PROVIDER },
    policyArtifacts: artifacts(),
    tools: [],
    bus,
  });
}

describe('BRIEF-stopReason — TeamRuntime 的 stopReason 必须在契约词表内（复现①：越词表）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-team-stopreason-'));
    fake.turns = [];
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('① kind=interrupted 的成员回合 ⇒ stopReason 是词表内的 aborted（旧实现吐越词表的 interrupted ⇒ 必红）', async () => {
    fake.turns = [{ kind: 'interrupted', finalText: '' }];
    const bus = new EventBus();
    const ends: TeamEndPayload[] = [];
    bus.on('team_end', (p) => {
      ends.push(p as TeamEndPayload);
    }, 'test:team_end');
    const runtime = buildRuntime(workspace, bus);

    const summary = await runtime.runTeam({
      task: '被中断的任务',
      roster: [{ presetId: 'developer', model: 'mock-model', providerId: 'mock' }],
    });
    const member = summary.members[0]!;

    // 未跑完仍然是失败（判据不放宽）
    expect(member.status).toBe('failed');
    // 删掉 TeamRuntime 里那一行映射（回到 `turn.kind`）⇒ 这里是 'interrupted' ⇒ 红
    expect(member.stopReason).toBe('aborted');
    expect(member.stopReason).not.toBe('interrupted');
    expect(VOCABULARY.includes(member.stopReason ?? '')).toBe(true);

    // 投影消费面（team_end 载荷里的同一行）与失败原因文案同值
    expect(ends).toHaveLength(1);
    expect(ends[0]!.outcome).toBe('failed');
    expect(ends[0]!.members[0]!.stopReason).toBe('aborted');
    expect(summary.outcome).toBe('failed');
    expect(summary.error).toContain('aborted');

    // 只消费了一个假回合（证明中断回合确实走到了被测那一行）
    expect(fake.turns).toHaveLength(0);
  });

  it('③ 负对照（同一替身）：kind=success 的成员回合，stopReason/status/键集逐字不变', async () => {
    fake.turns = [{ kind: 'success', finalText: 'FAKE-OUT' }];
    const bus = new EventBus();
    const runtime = buildRuntime(workspace, bus);

    const summary = await runtime.runTeam({
      task: '正常任务',
      roster: [{ presetId: 'developer', model: 'mock-model', providerId: 'mock' }],
    });
    const member = summary.members[0]!;

    expect(summary.outcome).toBe('completed');
    expect(summary.error).toBeUndefined();
    expect(member.status).toBe('completed');
    expect(member.stopReason).toBeUndefined();
    expect('stopReason' in member).toBe(true);
    expect(Object.keys(member)).toEqual([
      'memberId',
      'presetId',
      'role',
      'phase',
      'status',
      'sessionId',
      'delegationDepth',
      'durationMs',
      'stopReason',
      'output',
    ]);
    expect(member.output).toBe('FAKE-OUT');
  });
});
