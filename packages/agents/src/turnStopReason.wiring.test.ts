import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { resolveEvaluatorTurnOutcome } from './evaluator/EvaluatorAgent.js';
import { SubagentManager } from './subagent/SubagentManager.js';
import { TeamRuntime } from './team/TeamRuntime.js';
// 替身自身的可核对性：本文件 import 到的就是替身（若守卫断言红，说明 vi.mock 没生效，
// 那么下面的三处断言也就失去意义 —— 先红在守卫处，便于定位是测试装配问题而非被测代码问题）。
import { mapTurnKindToStopReason as mockedMap } from './turnStopReason.js';

/**
 * BRIEF「同一件事三处实现、两套口径」验收 ② 的**动态**证据 ——
 * **「改映射函数即三处同时变」**。
 *
 * 做法：把唯一实现（`./turnStopReason.js`）替换成一个"记录每次调用、恒返回 `'aborted'`"的替身
 * （`'aborted'` 与真实映射对 `success` 回合的 `'completed'` 可区分），然后跑三条**真实链路**：
 *
 *   1. evaluator —— `resolveEvaluatorTurnOutcome`（评审判决的落点）
 *   2. subagent —— `SubagentManager.delegate`（真实子会话回合）
 *   3. team     —— `TeamRuntime.runTeam`（真实顶层成员回合）
 *
 * 三处都必须**同时**变成替身的值。任何一处自带第二份 switch/词表（这正是改前的状态：
 * evaluator 与 subagent 各一份、team 第三套口径），那一处会保持旧值 ⇒ 本用例红。
 * 静态证据（同一模块导出、全包仅一份映射表）见 `turnStopReason.test.ts` 的 ②。
 *
 * 本文件**只**为这条断言而存在：模块级 `vi.mock` 会让同文件内的其它用例也拿到替身，
 * 故单测/静态护栏/真实链路用例都放在各自文件里，互不影响。
 */
const spy = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock('./turnStopReason.js', () => ({
  mapTurnKindToStopReason: (kind: string) => {
    spy.calls.push(kind);
    return 'aborted';
  },
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

function provider(text: string): MockProvider {
  return new MockProvider([{ when: /.*/, response: { text } }], { model: 'mock-model' });
}

describe('BRIEF-stopReason② — 改映射函数即三处同时变（唯一实现 / 同一词表）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-stopreason-wiring-'));
    spy.calls.length = 0;
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('② 三处消费点（evaluator / subagent / team）都经过同一个函数：映射一改，三处同时变', async () => {
    // 0) 替身已生效（守卫：避免"因为 mock 没装上而假绿/假红"的误判）
    expect(mockedMap('success')).toBe('aborted');
    spy.calls.length = 0; // 守卫自己也算一次调用，清掉后再数三条真实链路

    const policyArtifacts = artifacts();
    const VALID_MET = '{"verdict":"met","evidence":[],"reason":"r"}';

    // 1) evaluator —— 评审判决（真实解析 + 真实映射调用）
    const outcome = resolveEvaluatorTurnOutcome({ kind: 'success', finalText: VALID_MET });
    expect(outcome.stopReason).toBe('aborted'); // 真实映射下是 'completed'
    expect(outcome.isError).toBe(true); // isError 与 stopReason 同源（非 completed ⇒ 失败）

    // 2) subagent —— 真实 delegate 链路（子回合 kind='success'）
    const manager = new SubagentManager({
      workspaceRoot: workspace,
      provider: provider('CHILD-DONE'),
      model: 'mock-model',
      policyArtifacts,
      tools: [],
      bus: new EventBus(),
    });
    const delegated = await manager.delegate({ prompt: '独立任务', delegationDepth: 0 });
    expect(delegated.stopReason).toBe('aborted');
    expect(delegated.isError).toBe(true);

    // 3) team —— 真实 runTeam 链路（顶层成员回合 kind='success'）
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: { mock: provider('TEAM-DONE') },
      policyArtifacts,
      tools: [],
    });
    const summary = await runtime.runTeam({
      task: '任务',
      roster: [{ presetId: 'developer', model: 'mock-model', providerId: 'mock' }],
    });
    expect(summary.members[0]!.stopReason).toBe('aborted');
    expect(summary.members[0]!.status).toBe('failed');

    // 三处**都**调用了这个函数，且都是 success 回合（映射被替换 ⇒ 三处同时变，不是各自常量）
    expect(spy.calls).toEqual(['success', 'success', 'success']);
  });
});
