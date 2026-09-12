import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { EvaluatorAgent, createReadOnlyExplorationTools, mapTurnKindToStopReason, resolveEvaluatorTurnOutcome } from './EvaluatorAgent.js';
import { SubagentManager } from '../subagent/SubagentManager.js';

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

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-evalagent-'));
}

function jsonProvider(verdictJson: string): MockProvider {
  return new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: verdictJson } }], { model: 'eval-model' });
}

describe('V0.2-M3 evaluator agent — independent review form', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('rejects a generator output with met/not_met + evidence in an isolated session', async () => {
    const bus = new EventBus();
    const started: string[] = [];
    bus.on('subagent_start', (p) => {
      started.push((p as { childSessionId: string }).childSessionId);
    });
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"not_met","evidence":["src/fee.js 缺少 computeFee"],"reason":"产物不存在"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      bus,
    });
    const v = await agent.evaluate({
      goal: '实现 computeFee',
      generatorOutput: '我已完成实现，全部通过。（自证无效）',
      acceptance: ['src/fee.js 导出 computeFee'],
    });
    expect(v.verdict).toBe('not_met');
    expect(v.evidence).toContain('src/fee.js 缺少 computeFee');
    expect(v.reason).toBe('产物不存在');
    expect(started).toHaveLength(1);
  });

  it('passes when the isolated evaluator finds the artifact satisfies acceptance', async () => {
    fs.writeFileSync(path.join(workspace, 'result.txt'), 'ANSWER-2026', 'utf8');
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      // evaluator reads the disk evidence first, then verdicts met
      provider: new MockProvider(
        [
          { when: /读|read/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: 'result.txt' } }] } },
          { when: /.*/, minToolResults: 1, response: { text: '{"verdict":"met","evidence":["result.txt 内容为 ANSWER-2026"],"reason":"磁盘证据确认"}' } },
        ],
        { model: 'eval-model' },
      ),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await agent.evaluate({
      goal: '产出 ANSWER-2026',
      generatorOutput: '完成了',
      acceptance: ['result.txt 含 ANSWER-2026'],
      evidencePaths: ['result.txt'],
    });
    expect(v.verdict).toBe('met');
    expect(v.evidence.join()).toContain('ANSWER-2026');
  });

  it('returns error verdict when the evaluator output is not valid JSON (fail loud, no false pass)', async () => {
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('评审结论：不合格'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await agent.evaluate({ goal: 'g', generatorOutput: 'done' });
    expect(v.verdict).toBe('error');
  });

  it('the evaluator tool set is read-only (no file_write family)', () => {
    const tools = createReadOnlyExplorationTools(workspace);
    expect(tools.some((t) => t.family === 'file_write')).toBe(false);
    expect(tools.some((t) => t.name === 'Write')).toBe(false);
    expect(tools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read']);
    const agent = new EvaluatorAgent({ workspaceRoot: workspace, provider: jsonProvider('{"verdict":"met","evidence":[],"reason":"ok"}'), model: 'm', policyArtifacts: artifacts() });
    expect(agent.visibleTools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read']);
  });

  it('Generator/Evaluator separation end-to-end: subagent generates, EvaluatorAgent independently judges', async () => {
    // generator child produces an artifact text (its own session)
    const bus = new EventBus();
    const genProvider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: '实现了 computeFee：return amount*0.1' } }], { model: 'gen-model' });
    const genManager = new SubagentManager({ workspaceRoot: workspace, provider: genProvider, model: 'gen-model', policyArtifacts: artifacts(), tools: [], bus });
    const gen = await genManager.delegate({ prompt: '实现 computeFee 并汇报', delegationDepth: 0 });
    expect(gen.stopReason).toBe('completed');

    // independent evaluator agent (separate session, read-only) judges the artifact
    const evalAgent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"not_met","evidence":["没有测试通过证据"],"reason":"验收要求隐藏测试全绿，无证据"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await evalAgent.evaluate({
      goal: 'computeFee 通过隐藏测试',
      generatorOutput: gen.output,
      acceptance: ['隐藏测试全绿'],
    });
    // the evaluator's verdict governs — the generator cannot self-certify
    expect(v.verdict).toBe('not_met');
    expect(gen.output).toContain('computeFee');
  });

  it('the evaluator session is isolated and recorded as source=evaluator', async () => {
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"met","evidence":[],"reason":"ok"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await agent.evaluate({ goal: 'g', generatorOutput: 'x' });
    expect(v.verdict).toBe('met');
    // find the evaluator session log (only one session dir: .harness/sessions/*)
    const sessionsDir = path.join(workspace, '.harness', 'sessions');
    const dirs = fs.readdirSync(sessionsDir);
    expect(dirs).toHaveLength(1);
    const log = fs.readFileSync(path.join(sessionsDir, dirs[0]!, 'session.jsonl'), 'utf8');
    expect(log).toContain('"source":"evaluator"');
  });
});

/**
 * BRIEF — EvaluatorAgent 对 `kind='error'` 的回合**无条件**上报 `stopReason:'completed'`
 * （失败被上报为完成）。
 *
 * 复现（改前）：旧 `evaluate()` 里 `result:{output, stopReason:'completed'}` 是**写死的常量**，
 * 且 `isError` 取自 `parseVerdict(...)` 的 verdict，与 `turn.kind` 无关 ⇒ 评审回合自己被熔断
 * （DenialLimitError ⇒ AgentLoop 把错误文案写进 finalText、置 kind='error' 后**正常返回**，
 * AgentLoop.ts:334-338）时，上游只看到一次"正常完成"的评审。
 *
 * 本组用例走**生产路径**（真实 IsolatedRuntime + AgentLoop + fs 守卫），不手调私有函数；
 * kind=success 的负对照同时钉死"旧字段/旧文案逐字不变"。
 */
type EvaluatorStopPayload = {
  delegateId: string;
  childSessionId: string;
  result: { output: string; stopReason: string; diagnostic?: string };
  isError: boolean;
};

describe('BRIEF — 未跑完的评审回合必须如实上报（旧实现恒 stopReason=completed）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  /** 只读探索面 + denyRead：读 secret/** 必被 fs 守卫判 DENIED（guards.ts:281-284 → fsTools.ts:47）。 */
  const DENY_READ_POLICY = { protected: ['.git', '.git/**'], denyRead: ['secret/**'], allow: [] };
  /** AgentLoop 熔断文案（AgentLoop.ts:794 `same intent denied ${n} times: ${toolName}`，n=3）。 */
  const BREAKER_TEXT = 'same intent denied 3 times: Read';

  function collectStops(bus: EventBus): EvaluatorStopPayload[] {
    const stops: EvaluatorStopPayload[] = [];
    bus.on('subagent_stop', (p) => {
      stops.push(p as EvaluatorStopPayload);
    });
    return stops;
  }

  /**
   * 最小复现装置：评审子代理连续三次请求同一个 denyRead 路径 ⇒ 三次工具层 DENIED
   * ⇒ 第 3 次抛 DenialLimitError ⇒ runTurn 正常返回 kind='error'、finalText=熔断文案。
   * （这正是"评审没跑完"，而旧实现把它上报成 stopReason='completed'。）
   */
  function breakingAgent(bus: EventBus): EvaluatorAgent {
    fs.mkdirSync(path.join(workspace, 'secret'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'secret', 'x.txt'), 'CLASSIFIED', 'utf8');
    return new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: new MockProvider(
        [{ when: /.*/, response: { toolCalls: [{ name: 'Read', arguments: { path: 'secret/x.txt' } }] } }],
        { model: 'eval-model' },
      ),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      tools: createReadOnlyExplorationTools(workspace, DENY_READ_POLICY),
      bus,
    });
  }

  it('① kind=error 的回合 ⇒ stopReason 由 kind 决定（旧实现恒 completed ⇒ 必红）', async () => {
    const bus = new EventBus();
    const stops = collectStops(bus);
    const v = await breakingAgent(bus).evaluate({ goal: 'g', generatorOutput: 'done' });

    expect(stops).toHaveLength(1);
    // 删掉 `const stopReason = mapTurnKindToStopReason(turn.kind)` / 换回字面量 'completed' ⇒ 此处红
    expect(stops[0]!.result.stopReason).toBe('error');
    // isError 与之一致（stopReason≠completed ⇒ isError）
    expect(stops[0]!.isError).toBe(true);
    // 熔断文案与诊断如实透传（旧实现也带 output，此处不放宽也不新增语义）
    expect(stops[0]!.result.output).toBe(BREAKER_TEXT);
    expect(stops[0]!.result.diagnostic).toBe('evaluator turn ended with kind=error');
    // verdict 语义：没跑完的回合不得产出"有效 verdict"
    expect(v.verdict).toBe('error');
    expect(v.reason).toContain('kind=error');
    expect(v.reason).toContain('stopReason=error');
    // 信息未丢失：熔断原文仍在 reason 里可核（旧实现是 parseVerdict 的 "not a valid verdict JSON: <原文>"）
    expect(v.reason).toContain(BREAKER_TEXT);
  });

  it('② 负对照：kind=success 的回合既有字段与行为逐字不变（含正常 verdict 解析路径）', async () => {
    const bus = new EventBus();
    const stops = collectStops(bus);
    const VERDICT_JSON = '{"verdict":"not_met","evidence":["src/fee.js 缺少 computeFee"],"reason":"产物不存在"}';
    const v = await new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider(VERDICT_JSON),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      bus,
    }).evaluate({ goal: 'g', generatorOutput: 'done' });

    // 返回的 verdict 逐字来自 parseVerdict（未跑完分支不得触碰 success 回合）
    expect(v).toEqual({
      verdict: 'not_met',
      evidence: ['src/fee.js 缺少 computeFee'],
      reason: '产物不存在',
      unmet: [],
      suggestions: [],
    });
    expect(stops).toHaveLength(1);
    // 载荷逐字不变：**恰好** {output, stopReason} 两个键 —— 无条件加 diagnostic 等字段即红
    expect(Object.keys(stops[0]!.result).sort()).toEqual(['output', 'stopReason']);
    expect(stops[0]!.result).toEqual({ output: VERDICT_JSON, stopReason: 'completed' });
    expect(stops[0]!.isError).toBe(false);
  });

  it('②b 负对照（不放宽判据）：success + 解析不出 verdict ⇒ isError 仍为真、stopReason 仍为 completed', async () => {
    const bus = new EventBus();
    const stops = collectStops(bus);
    const v = await new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('评审结论：不合格'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      bus,
    }).evaluate({ goal: 'g', generatorOutput: 'done' });

    // 旧语义逐字保留：verdict='error' + reason 来自 parseVerdict + isError=true + stopReason='completed'
    expect(v.verdict).toBe('error');
    expect(v.reason).toContain('evaluator agent output is not a valid verdict JSON');
    expect(stops[0]!.result.stopReason).toBe('completed');
    expect(stops[0]!.isError).toBe(true);
    expect(Object.keys(stops[0]!.result).sort()).toEqual(['output', 'stopReason']);
  });

  it('③ 单一变量判别：同一段合法 verdict JSON，success ⇒ 采用；error/budget/interrupted ⇒ 一律强制 error', () => {
    const VALID_MET = '{"verdict":"met","evidence":["e1"],"reason":"looks fine"}';

    const ok = resolveEvaluatorTurnOutcome({ kind: 'success', finalText: VALID_MET });
    expect(ok.stopReason).toBe('completed');
    expect(ok.isError).toBe(false);
    expect(ok.verdict.verdict).toBe('met');
    expect(ok.verdict.evidence).toEqual(['e1']);

    const nonSuccess = [
      ['error', 'error'],
      ['budget', 'max_tokens'],
      ['interrupted', 'aborted'],
    ] as const;
    for (const [kind, stopReason] of nonSuccess) {
      const out = resolveEvaluatorTurnOutcome({ kind, finalText: VALID_MET });
      expect(out.stopReason).toBe(stopReason);
      // 删掉强制分支（直接 return parsed）⇒ 这里会读到 'met' ⇒ 红
      expect(out.verdict.verdict).toBe('error');
      expect(out.isError).toBe(true);
      // 未跑完 ⇒ 不携带任何"评审结论"字段（半截 JSON 不得冒充结论）
      expect(out.verdict.evidence).toEqual([]);
      expect(out.verdict.unmet).toEqual([]);
      expect(out.verdict.suggestions).toEqual([]);
      // 可核：kind/stopReason 与原文都在 reason 里
      expect(out.verdict.reason).toContain(`kind=${kind}`);
      expect(out.verdict.reason).toContain(`stopReason=${stopReason}`);
      expect(out.verdict.reason).toContain('looks fine');
    }
  });

  it('③b 映射表与 SubagentManager 先例同口径（不新造词）：completed/error/max_tokens/aborted', () => {
    expect(mapTurnKindToStopReason('success')).toBe('completed');
    expect(mapTurnKindToStopReason('error')).toBe('error');
    expect(mapTurnKindToStopReason('budget')).toBe('max_tokens');
    expect(mapTurnKindToStopReason('interrupted')).toBe('aborted');
  });
});
