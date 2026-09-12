import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { EvaluatorAgent, createReadOnlyExplorationTools, resolveEvaluatorTurnOutcome } from './EvaluatorAgent.js';
// BRIEF「同一件事三处实现、两套口径」：映射函数已收敛到**唯一实现**（本文件断言逐条不变，
// 只把 import 指向单一实现所在模块）。
import { mapTurnKindToStopReason } from '../turnStopReason.js';
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

/** A23 镜像载荷（packages/shared/src/events.ts:239-246）—— 只取断言用得到的字段。 */
type EvaluatorStartPayload = {
  delegateId: string;
  childAgentId: string;
  childSessionId: string;
  preset?: string;
  isContinuable: boolean;
};

function collectStarts(bus: EventBus): EvaluatorStartPayload[] {
  const starts: EvaluatorStartPayload[] = [];
  bus.on('subagent_start', (p) => {
    starts.push(p as EvaluatorStartPayload);
  });
  return starts;
}

function collectStops(bus: EventBus): EvaluatorStopPayload[] {
  const stops: EvaluatorStopPayload[] = [];
  bus.on('subagent_stop', (p) => {
    stops.push(p as EvaluatorStopPayload);
  });
  return stops;
}

/** 只读探索面 + denyRead：读 secret/** 必被 fs 守卫判 DENIED（guards.ts:281-284 → fsTools.ts:47）。 */
const DENY_READ_POLICY = { protected: ['.git', '.git/**'], denyRead: ['secret/**'], allow: [] };
/** AgentLoop 熔断文案（AgentLoop.ts:794 `same intent denied ${n} times: ${toolName}`，n=3）。 */
const BREAKER_TEXT = 'same intent denied 3 times: Read';

/**
 * 最小复现装置：评审子代理连续三次请求同一个 denyRead 路径 ⇒ 三次工具层 DENIED
 * ⇒ 第 3 次抛 DenialLimitError ⇒ runTurn 正常返回 kind='error'、finalText=熔断文案。
 * （这正是"评审没跑完"，而旧实现把它上报成 stopReason='completed'。）
 * 模块级（带 workspace 入参）：两个 BRIEF 用例组共用**同一份**装置，复现路径不出现第二份实现。
 */
function breakingAgent(workspace: string, bus: EventBus): EvaluatorAgent {
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

/**
 * TeamProjection 委派行的**最小镜像**（packages/application/src/projections/TeamProjection.ts:180-205）：
 * `onSubagentStart` 用 `delegateId` 建行（:185-192），`onSubagentStop` 按**同一个** `delegateId` 反查
 * （:198 `[...this.delegates].reverse().find((d) => d.delegateId === p.delegateId)`），
 * 反查不到就 `return`（:199）—— 事件被**静默丢弃**，行永远停在 'running'。
 *
 * 为什么在这里镜像、而不直接驱动真投影：依赖方向是 application → agents
 * （packages/application/package.json:29 `"@vessel/agents": "^0.1.0"`），本仓铁律「依赖零环」，
 * 在 agents 的用例里 import @vessel/application 会造出反向边；且本次改动范围不含 packages/application。
 * 因此这里只镜像**查找规则**这一条关键语义（一行 find + 一行 return），真投影的驱动形状见交付报告。
 */
type DelegateRowMirror = { delegateId: string; status: 'running' | 'done'; stopReason?: string; isError?: boolean };

function mirrorDelegateRows(
  starts: readonly EvaluatorStartPayload[],
  stops: readonly EvaluatorStopPayload[],
): DelegateRowMirror[] {
  const rows: DelegateRowMirror[] = starts.map((s): DelegateRowMirror => ({ delegateId: s.delegateId, status: 'running' }));
  for (const s of stops) {
    const row = [...rows].reverse().find((r) => r.delegateId === s.delegateId); // TeamProjection.ts:198
    if (!row) continue; // TeamProjection.ts:199 —— 找不到行即丢弃（旧实现的 evaluator stop 走到这里）
    row.status = 'done';
    row.stopReason = s.result.stopReason;
    row.isError = s.isError;
  }
  return rows;
}

describe('BRIEF — 未跑完的评审回合必须如实上报（旧实现恒 stopReason=completed）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('① kind=error 的回合 ⇒ stopReason 由 kind 决定（旧实现恒 completed ⇒ 必红）', async () => {
    const bus = new EventBus();
    const stops = collectStops(bus);
    const v = await breakingAgent(workspace, bus).evaluate({ goal: 'g', generatorOutput: 'done' });

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

  it('② 负对照：kind=success 的回合 result 载荷与 verdict 逐字不变（delegateId 除外 —— 它现在与 start 成对）', async () => {
    const bus = new EventBus();
    const starts = collectStarts(bus);
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
    // BRIEF-成对：success 路径唯一**有意变化**的是 stop 的 delegateId（旧实现两处各自现算，
    // 与 start 永不相等）。旧断言从未覆盖该字段 ⇒ 此处按「不弱于旧断言」补上**结构性**断言：
    // stop.delegateId 必须**等于 start.delegateId**，且 start 的既有形状（毫秒+随机后缀）不变。
    // 逐字值不可断言（含 Date.now()），故断言相等关系 + 形状 —— 比"逐字相等"更强（不可伪造常量）。
    expect(starts).toHaveLength(1);
    expect(starts[0]!.delegateId).toMatch(/^eval_\d+_[0-9a-f]{6}$/);
    expect(stops[0]!.delegateId).toBe(starts[0]!.delegateId);
    expect(stops[0]!.childSessionId).toBe(starts[0]!.childSessionId);
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

/**
 * BRIEF — evaluator 镜像事件（A23/A24）的 `delegateId` 必须**成对**。
 *
 * 复现（改前）：`evaluate()` 两处各自现算 delegateId ——
 *   start（旧 EvaluatorAgent.ts:231）：`eval_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
 *   stop （旧 EvaluatorAgent.ts:243）：`eval_${Date.now()}`
 * 两者是**不同字符串**（前者带 6 位十六进制后缀、后者不带），于是 stop 永远匹配不上 start 建的行：
 * 任何按 delegateId 关联的消费方都收不到 evaluator 的 stop —— 最直接的是 TeamProjection
 * （packages/application/src/projections/TeamProjection.ts:195-205）：onSubagentStart 以 delegateId
 * 建行（:185-192），onSubagentStop 反查同一 id（:198），查不到就 `return`（:199）**静默丢弃**
 * ⇒ 行永远停在 'running'，stopReason / isError / durationMs / outputPreview 永远为空。
 * 于是「stopReason 由 turn.kind 决定」那处修复在投影里**观察不到**（行为正确 ≠ 可观测）。
 *
 * 判别性（删掉修复即红）：
 *   ① `start.delegateId === stop.delegateId` —— 旧实现必红，且是**关系**断言（不可用常量伪造）；
 *   ② 按 TeamProjection 的查找规则镜像跑一遍：start 建的那一行被 stop 落定为 done + stopReason；
 *      旧实现下 stop 找不到行（行仍为 'running'）⇒ 红；
 *   ③ 负对照：verdict 解析 / stopReason 映射 / result 载荷键集 / 只读工具面逐字不变。
 *
 * ② 为何是「镜像」而不是驱动真投影：依赖方向 application → agents
 * （packages/application/package.json:29），在 agents 用例里 import @vessel/application 会造出反向边
 * （铁律：依赖零环），且本卡改动范围不含 packages/application。镜像只保留 :198-199 的查找语义；
 * 真投影的驱动形状见交付报告（TeamProjection.attach(bus) + 同一 bus 上的 start/stop）。
 */
describe('BRIEF — evaluator 镜像事件 start/stop 的 delegateId 必须成对（旧实现两处各自现算 ⇒ 永不相等）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('① start 与 stop 的 delegateId 逐字相等（旧实现 start 带 _hex 后缀、stop 不带 ⇒ 必红）', async () => {
    const bus = new EventBus();
    const starts = collectStarts(bus);
    const stops = collectStops(bus);

    const v = await new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"met","evidence":["e1"],"reason":"ok"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      bus,
    }).evaluate({ goal: 'g', generatorOutput: 'done' });

    expect(v.verdict).toBe('met');
    expect(starts).toHaveLength(1);
    expect(stops).toHaveLength(1);
    // 删掉 evaluate() 顶部 `const delegateId = ...` 这一行（改回两处各自现算）⇒ 此处红
    expect(stops[0]!.delegateId).toBe(starts[0]!.delegateId);
    // 反向守卫：不得为了让断言通过而把 start 降级成旧 stop 的 `eval_<ts>`（形状仍是毫秒+随机后缀）
    expect(starts[0]!.delegateId).toMatch(/^eval_\d+_[0-9a-f]{6}$/);
    // 同一次委派的其它关联字段也指向同一个子会话（成对不只体现在 id 上）
    expect(stops[0]!.childSessionId).toBe(starts[0]!.childSessionId);
  });

  it('② 投影按同一 delegateId 反查到该行并落定（镜像 TeamProjection.ts:180-205；旧实现丢事件 ⇒ 必红）', async () => {
    // 用 kind=error 的熔断回合驱动：这正是「刚修好的 stopReason 到不了投影」的那条路径
    const bus = new EventBus();
    const starts = collectStarts(bus);
    const stops = collectStops(bus);
    await breakingAgent(workspace, bus).evaluate({ goal: 'g', generatorOutput: 'done' });

    expect(stops[0]!.result.stopReason).toBe('error');
    const rows = mirrorDelegateRows(starts, stops);
    expect(rows).toHaveLength(1);
    // 镜像 TeamProjection.ts:198-203：旧实现下 delegateId 不匹配 ⇒ 这一行仍停在 'running'（红）
    expect(rows[0]).toEqual({
      delegateId: starts[0]!.delegateId,
      status: 'done',
      stopReason: 'error',
      isError: true,
    });
  });

  it('②b 投影镜像同样覆盖 success 回合（stopReason=completed / isError=false 落进同一行）', async () => {
    const bus = new EventBus();
    const starts = collectStarts(bus);
    const stops = collectStops(bus);
    await new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"not_met","evidence":[],"reason":"no"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      bus,
    }).evaluate({ goal: 'g', generatorOutput: 'done' });

    const rows = mirrorDelegateRows(starts, stops);
    expect(rows[0]).toEqual({
      delegateId: starts[0]!.delegateId,
      status: 'done',
      stopReason: 'completed',
      isError: false,
    });
  });

  it('③ 负对照：修复只动 delegateId —— verdict 解析 / stopReason 映射 / result 键集 / 只读工具面逐字不变', async () => {
    // (a) success + 合法 JSON：verdict 逐字来自 parseVerdict，result 恰好 {output, stopReason}
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
    expect(v).toEqual({
      verdict: 'not_met',
      evidence: ['src/fee.js 缺少 computeFee'],
      reason: '产物不存在',
      unmet: [],
      suggestions: [],
    });
    expect(Object.keys(stops[0]!.result).sort()).toEqual(['output', 'stopReason']);
    expect(stops[0]!.result).toEqual({ output: VERDICT_JSON, stopReason: 'completed' });
    expect(stops[0]!.isError).toBe(false);

    // (b) kind=error 的熔断回合：stopReason/isError/diagnostic 逐字不变（修复不碰这条路径）
    const bus2 = new EventBus();
    const stops2 = collectStops(bus2);
    await breakingAgent(workspace, bus2).evaluate({ goal: 'g', generatorOutput: 'done' });
    expect(stops2[0]!.result).toEqual({
      output: BREAKER_TEXT,
      stopReason: 'error',
      diagnostic: 'evaluator turn ended with kind=error',
    });
    expect(stops2[0]!.isError).toBe(true);

    // (c) 只读工具面不变（Read/Glob/Grep，无 file_write 家族）
    const tools = createReadOnlyExplorationTools(workspace);
    expect(tools.some((t) => t.family === 'file_write')).toBe(false);
    expect(tools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read']);
  });
});
