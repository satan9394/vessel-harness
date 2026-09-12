import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ChatProvider, ChatResponse } from '@vessel/shared';
import { runScenario, loadManifest, OFFLINE_SCRIPTS, auditMeasuredDeclaration, REPORTED_METRICS } from './runner.js';
import { runAssert } from './asserts.js';
import { classifyScenarioRun, type OfflineScenarioOutcome } from './release-gates/gates.js';
import type { ScenarioReport } from './types.js';

/**
 * **纪律 23**：期望值**不得由被测函数生成**。
 *
 * 这三条报告字段原先写作 `summary: turnKindSummary('error')`——而 `turnKindSummary`
 * 正是产出该字段的**生产函数** ⇒ 实现怎么改、期望就跟着改，那条断言**恒真**。
 * 这里改为**独立字面量**：文案变了就必须**有意识地**改测试（而"改了用户可见文案"
 * 本来就该被注意到）。`runner.ts` 里"导出以便测试逐字引用"的注释也一并更正。
 */
const EXPECTED_ERROR_SUMMARY =
  '回合以错误结束（kind=error）——本 run 未正常收尾：finalText 是错误信息而非模型答案';
const EXPECTED_SUCCESS_SUMMARY = '回合正常结束（kind=success）';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REPORTS = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-bench-reports-'));
let tempDirs: string[] = [];

afterEach(() => {
  for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
  tempDirs = [];
});

describe('benchmarks/runner — first batch B001–B005 (offline mock lane)', () => {
  for (const id of ['B001', 'B002', 'B003', 'B004', 'B005']) {
    it(`${id} passes all manifest assertions and writes a JSONL report`, async () => {
      const report = await runScenario({
        scenarioId: id,
        repoRoot: REPO_ROOT,
        reportsDir: REPORTS,
        provider: null, // offline deterministic lane
        model: 'mock-model',
        policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
        behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
      });
      tempDirs.push(report.workspace);
      expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
      expect(report.metrics.M01).toBe(1);
      expect(fs.existsSync(report.reportPath)).toBe(true);
      const jsonl = fs.readFileSync(report.reportPath, 'utf8');
      const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(lines[0]!.type).toBe('meta');
      expect(lines.some((l) => l.type === 'metric')).toBe(true);
      expect(lines.some((l) => l.type === 'assert' && l.result === 'pass')).toBe(true);
      expect(fs.existsSync(path.join(path.dirname(report.reportPath), 'summary.json'))).toBe(true);
    }, 60_000);
  }

  it('B001 no_mutation holds (fixture untouched) and no file_write family used', async () => {
    const report = await runScenario({
      scenarioId: 'B001', repoRoot: REPO_ROOT, reportsDir: REPORTS, provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    const a = report.asserts.find((x) => x.type === 'no_mutation');
    expect(a?.result).toBe('pass');
    const noWrite = report.asserts.find((x) => x.type === 'no_tool_family');
    expect(noWrite?.result).toBe('pass');
  });
});

describe('benchmarks/runner — V0.2 batch B016–B019 (offline mock lane)', () => {
  for (const id of ['B016', 'B017', 'B018', 'B019']) {
    it(`${id} passes all manifest assertions (subagent/planner/evaluator/MCP)`, async () => {
      const report = await runScenario({
        scenarioId: id,
        repoRoot: REPO_ROOT,
        reportsDir: REPORTS,
        provider: null,
        model: 'mock-model',
        policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
        behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
      });
      tempDirs.push(report.workspace);
      expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
      expect(report.metrics.M01).toBe(1);
      expect(fs.existsSync(report.reportPath)).toBe(true);
      const jsonl = fs.readFileSync(report.reportPath, 'utf8');
      const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.some((l) => l.type === 'assert' && l.result === 'pass')).toBe(true);
    }, 60_000);
  }

  /**
   * 判别性（本卡补的覆盖缺口）：`evalProvider` 也曾绕过唯一化。Evaluator Agent 在
   * **隔离会话**（EvaluatorAgent → createIsolatedRuntime）里用只读探索工具（Read/Glob/Grep）
   * 真的发 tool call，所以它的脚本 provider 也必须重新编号。
   *
   * 这里把 `B018-eval` 脚本换成与 MockProvider **同构**的两次调用（每条响应各自从 1 编号，
   * 原始 id 都是 `tc_mock_1`）：删掉 runner 侧对 evalProvider 的包装，隔离会话的
   * session.jsonl 里就会出现复用 id ⇒ 本用例必红。断言集结论不受影响（最终 verdict 仍是
   * not_met），所以红的只可能是「id 复用」这一项。
   */
  it('判别性：evaluator 隔离会话的脚本 provider 也被唯一 id 化（删掉包装即红）', async () => {
    // `!` + straight reassignment is the exact idiom safety.test.ts already uses for
    // OFFLINE_SCRIPTS patching (noUncheckedIndexedAccess types the read as
    // `MockScriptEntry[] | undefined`, so the non-null assertion keeps the write legal).
    const original = OFFLINE_SCRIPTS['B018-eval']!;
    OFFLINE_SCRIPTS['B018-eval'] = [
      { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: 'task.md' } }] } },
      { when: /.*/, minToolResults: 1, maxToolResults: 1, response: { toolCalls: [{ name: 'Read', arguments: { path: 'task.md' } }] } },
      {
        when: /.*/,
        minToolResults: 2,
        response: { text: '{"verdict":"not_met","evidence":["无测试通过证据"],"reason":"验收要求测试全绿，缺少证据"}' },
      },
    ];
    try {
      const report = await runScenario({
        scenarioId: 'B018',
        repoRoot: REPO_ROOT,
        reportsDir: REPORTS,
        provider: null,
        model: 'mock-model',
        policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
        behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
      });
      tempDirs.push(report.workspace);

      // evaluator 的隔离会话落在 <workspace>/.harness/sessions/<sub_*>/session.jsonl
      const sessionsRoot = path.join(report.workspace, '.harness', 'sessions');
      const logs = fs.existsSync(sessionsRoot)
        ? fs
            .readdirSync(sessionsRoot)
            .map((d) => path.join(sessionsRoot, d, 'session.jsonl'))
            .filter((f) => fs.existsSync(f))
        : [];
      const parse = (file: string): { type?: string; source?: string; toolCallId?: string }[] =>
        fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l));
      const evalLog = logs.find((f) =>
        parse(f).some((r) => r.type === 'session/created' && r.source === 'evaluator'),
      );
      expect(evalLog, `未找到 evaluator 隔离会话（候选: ${logs.join(', ') || '无'}）`).toBeDefined();

      const ids = parse(evalLog!)
        .filter((r) => r.type === 'tool/call')
        .map((r) => String(r.toolCallId));
      expect(ids.length, `evaluator 应发生 ≥2 次工具调用: ${JSON.stringify(ids)}`).toBeGreaterThanOrEqual(2);
      expect(
        new Set(ids).size,
        `evaluator 会话内 toolCallId 被复用 ⇒ 锚定会绑到错的调用: ${JSON.stringify(ids)}`,
      ).toBe(ids.length);

      // 判据仍绿：换脚本只改评审路径，不改 B018 的结论（红的只可能是 id 复用）
      expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    } finally {
      // restore the scripted entry (same as safety.test.ts's OFFLINE_SCRIPTS patch)
      OFFLINE_SCRIPTS['B018-eval'] = original;
    }
  }, 60_000);
});

describe('benchmarks/runner — V0.3 batch B020–B021 (offline mock lane)', () => {
  for (const id of ['B020', 'B021']) {
    it(`${id} passes all manifest assertions (project memory / skill content)`, async () => {
      const report = await runScenario({
        scenarioId: id,
        repoRoot: REPO_ROOT,
        reportsDir: REPORTS,
        provider: null,
        model: 'mock-model',
        policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
        behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
      });
      tempDirs.push(report.workspace);
      expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
      expect(report.metrics.M01).toBe(1);
      expect(fs.existsSync(report.reportPath)).toBe(true);
      const jsonl = fs.readFileSync(report.reportPath, 'utf8');
      const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.some((l) => l.type === 'assert' && l.result === 'pass')).toBe(true);
    }, 60_000);
  }
});

describe('benchmarks/runner — V0.4 batch B022 (offline task-routing lane)', () => {
  it('B022 routes an implementation task to the pro tier (machine-asserted golden)', async () => {
    const report = await runScenario({
      scenarioId: 'B022',
      repoRoot: REPO_ROOT,
      reportsDir: REPORTS,
      provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    expect(report.metrics.M01).toBe(1);
    expect(report.finalText).toContain('ROUTED-TO-PRO-TIER');
    expect(fs.existsSync(report.reportPath)).toBe(true);
  }, 60_000);
});

describe('benchmarks/runner — V0.5 batch B023 (Loop Engine lane)', () => {
  it('B023 runs one Loop Engine iteration, machine-asserted against the ENGINE PRODUCT on disk', async () => {
    const report = await runScenario({
      scenarioId: 'B023',
      repoRoot: REPO_ROOT,
      reportsDir: REPORTS,
      provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    expect(report.metrics.M01).toBe(1);
    expect(report.finalText).toContain('verdict=met');
    expect(report.finalText).toContain('persist 记录 1 条');
    expect(fs.existsSync(report.reportPath)).toBe(true);
    // 判据锚定引擎真实产物（不是 runner 的报告模板）：
    // 1) Generator 写进隔离工作区、persist 收割出来的产物字节
    const artifact = fs.readFileSync(path.join(report.workspace, 'engine-artifacts', 'engine-result.txt'), 'utf8');
    expect(artifact).toContain('ENGINE-GOLDEN-88');
    expect(artifact).toContain('task=b023');
    // 2) 引擎 persist 落盘的结构化 IterationResult（verdict 由读盘 Evaluator 判定）
    const record = JSON.parse(fs.readFileSync(path.join(report.workspace, 'engine-artifacts', 'iteration.json'), 'utf8'));
    expect(record).toMatchObject({ taskId: 'b023', verdict: 'met', retryCount: 1 });
  }, 60_000);

  it('B023 判别性回归锁：产物内容错误 → 判据 fail（判据不再恒真）', async () => {
    const manifest = loadManifest(REPO_ROOT, 'B023');
    const spec = manifest.pass.find((p) => p.type === 'file_content' && p.target === 'file:engine-artifacts/engine-result.txt');
    expect(spec, 'B023 必须声明产物判据（file:engine-artifacts/engine-result.txt）').toBeTruthy();
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-b023-negative-'));
    tempDirs.push(ws);
    fs.mkdirSync(path.join(ws, 'engine-artifacts'), { recursive: true });
    // 一个「错误实现」的产物：文件存在但内容不满足 acceptance（旧实现下仍会绿）
    fs.writeFileSync(path.join(ws, 'engine-artifacts', 'engine-result.txt'), 'WRONG-PRODUCT\n', 'utf8');
    const res = await runAssert(
      spec!,
      {
        workspace: ws,
        sessionRecords: [],
        counters: {} as never,
        finalText: 'Loop Engine 迭代完成：verdict=not_met（任务 b023，iteration 1，attempts 2）；persist 记录 1 条',
        snapshotBefore: new Map(),
        streamEvents: [],
      },
      0,
    );
    expect(res.result).toBe('fail');
    expect(res.evidence['missing']).toEqual(expect.arrayContaining(['ENGINE-GOLDEN-88']));
  });

  it('B023 回归锁：场景 golden 不出现在 runner.ts（generate/evaluate 不共享 runner 写死的期望值）', () => {
    const manifest = loadManifest(REPO_ROOT, 'B023');
    const goldens = manifest.pass.flatMap((p) => p.golden ?? []);
    expect(goldens.length).toBeGreaterThan(0);
    const runnerSrc = fs.readFileSync(path.join(REPO_ROOT, 'benchmarks', 'runners', 'src', 'runner.ts'), 'utf8');
    for (const g of goldens) expect(runnerSrc, `runner.ts 不得内置 golden 串: ${g}`).not.toContain(g);
  });
});

describe('benchmarks/runner — V1.1-D batch B024–B027 (L1 streaming/interrupt/steering/resume)', () => {
  it('B024 streaming: captures interleaved text + tool model_stream deltas, machine-asserted', async () => {
    const report = await runScenario({
      scenarioId: 'B024',
      repoRoot: REPO_ROOT,
      reportsDir: REPORTS,
      provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    expect(report.metrics.M01).toBe(1);
    expect(report.finalText).toContain('STREAM-TEXT-GOLDEN-2026');
    // the stream-seen asserts prove BOTH a tool call and the final text streamed
    const streamAsserts = report.asserts.filter((a) => a.type === 'stream_seen');
    expect(streamAsserts.length).toBeGreaterThanOrEqual(2);
    for (const a of streamAsserts) expect(a.result, `assert ${a.id}`).toBe('pass');
    // stream deltas (text + tool) are auditable in the JSONL report
    const jsonl = fs.readFileSync(report.reportPath, 'utf8');
    const lines = jsonl.trim().split('\n').map((l) => JSON.parse(l));
    const deltas = lines.filter((l) => l.type === 'event' && l.kind === 'model_stream_delta').map((l) => l.payload.kind);
    expect(deltas.filter((k) => k === 'text').length).toBeGreaterThanOrEqual(1);
    expect(deltas.filter((k) => k === 'tool').length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('B025 interrupt: loop.interrupt() cuts the run mid-stream, turn ends kind=interrupted', async () => {
    const report = await runScenario({
      scenarioId: 'B025',
      repoRoot: REPO_ROOT,
      reportsDir: REPORTS,
      provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    const interrupted = report.asserts.find((a) => a.type === 'turn_interrupted');
    expect(interrupted?.result).toBe('pass');
  }, 60_000);

  it('B026 steering: a runner-enqueued steer is drained as source=steer and redirects the next step', async () => {
    const report = await runScenario({
      scenarioId: 'B026',
      repoRoot: REPO_ROOT,
      reportsDir: REPORTS,
      provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    expect(report.finalText).toContain('STEER-GOLDEN-2026');
    const steerSeen = report.asserts.find((a) => a.type === 'steer_seen');
    expect(steerSeen?.result).toBe('pass');
  }, 60_000);

  it('B027 resume: the session is seeded from a Context Reset Handoff (source=handoff) and continues', async () => {
    const report = await runScenario({
      scenarioId: 'B027',
      repoRoot: REPO_ROOT,
      reportsDir: REPORTS,
      provider: null,
      model: 'mock-model',
      policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
    });
    tempDirs.push(report.workspace);
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    expect(report.finalText).toContain('RESUME-GOLDEN-2026');
    const resumeSeen = report.asserts.find((a) => a.type === 'resume_seen');
    expect(resumeSeen?.result).toBe('pass');
  }, 60_000);

  it('mock determinism: streaming replay repeatedly captures the same text/tool stream shape', async () => {
    const run = async () => {
      const report = await runScenario({
        scenarioId: 'B024',
        repoRoot: REPO_ROOT,
        reportsDir: REPORTS,
        provider: null,
        model: 'mock-model',
        policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
        behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
      });
      tempDirs.push(report.workspace);
      const textGolden = report.finalText.includes('STREAM-TEXT-GOLDEN-2026');
      const toolStreamed = report.asserts.some((a) => a.type === 'stream_seen' && a.result === 'pass');
      return { finalText: report.finalText, textGolden, toolStreamed };
    };
    const a = await run();
    const b = await run();
    expect(a.finalText).toBe(b.finalText);
    expect(a.textGolden).toBe(b.textGolden);
    expect(a.toolStreamed).toBe(b.toolStreamed); // identical stream observation shape across replays
  }, 60_000);
});

/**
 * ===========================================================================
 * 证据层诚实性：回合结束 kind 不得在报告里消失
 * ===========================================================================
 *
 * 缺口（静态可核）：`driveScenario` 过去只把 `result.finalText` 收进 `DriverResult`
 * （runner.ts resume/默认两条 return；契约侧 contracts/vessel.ts 同样只取 finalText），
 * 于是 core 熔断器打死的回合（AgentLoop.ts:334-338：同一 intent 第 3 次被拒 ⇒
 * `kind='error'`，把 `err.message` 写进 `finalText` 后**正常 return**）会被当成
 * "本 run 的最终答案"交给判据层，而报告里没有一行能说明这轮根本没跑完。
 *
 * 本组三条用例分别锁：①判别性（丢掉 kind 即红）②负对照（success 路径既有字段逐字不变）
 * ③新字段不参与既有判据 / release-gates 归约（语义零变化）。
 */

const honestyOpts = (scenarioId: string) => ({
  scenarioId,
  repoRoot: REPO_ROOT,
  reportsDir: REPORTS,
  provider: null,
  model: 'mock-model',
  policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
  behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
});

/**
 * 「死磕同一 intent」的 provider：每一步都发**完全相同**的一次调用。
 *
 * 为什么这样就等于「被熔断打死的回合」：熔断器的计数键是
 * `toolName:JSON(arguments)`（AgentLoop.ts:790），同一 intent 第 3 次被拒即抛
 * `DenialLimitError`（AgentLoop.ts:334-338）⇒ 回合以 `kind='error'` 收尾、
 * `finalText = err.message` 并**正常返回**。`rm -rf subdir` 在默认策略（workspace-write
 * + approval: never 服务端 fail-closed）与 S001 声明的 danger-full-access（destructive-delete
 * 硬拒）两种 profile 下都是 DENIED，故这条构造对 profile 不敏感。
 */
function sameIntentDeniedProvider(): ChatProvider {
  return {
    id: 'same-intent-denied',
    async chat(): Promise<ChatResponse> {
      return {
        content: '',
        toolCalls: [{ id: 'tc_same_intent', name: 'Shell', arguments: { command: 'rm -rf subdir' } }],
        finishReason: 'tool_calls',
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** 读 summary.json（与 reportPath 同目录）。 */
function readSummary(report: ScenarioReport): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(path.dirname(report.reportPath), 'summary.json'), 'utf8'));
}

/** 读 JSONL 报告的全部行。 */
function readJsonl(report: ScenarioReport): Record<string, unknown>[] {
  return fs
    .readFileSync(report.reportPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('benchmarks/runner — 证据层诚实性：回合结束 kind 必须进报告', () => {
  it('① 判别性：被熔断打死的回合（kind=error）如实进报告 —— 丢掉 kind 这条必红', async () => {
    const report = await runScenario({ ...honestyOpts('S001'), provider: sameIntentDeniedProvider() });
    tempDirs.push(report.workspace);

    // 事实本身：这一轮以 kind='error' 收尾，finalText 是熔断器的话、不是模型答案。
    // （旧实现：'result.kind' 从未被读取 ⇒ report.turnKind === undefined ⇒ 本行必红。）
    expect(report.turnKind).toBe('error');
    expect(report.turnEndedAbnormally).toBe(true);
    expect(report.finalText).toContain('same intent denied');

    // 报告（summary.json）：既有键之外新增 turn 字段 + 人话摘要
    const summary = readSummary(report);
    expect(summary.turn).toEqual({ kind: 'error', endedAbnormally: true, summary: EXPECTED_ERROR_SUMMARY });
    expect(String((summary.turn as { summary: string }).summary)).toContain('kind=error');

    // 报告（JSONL 审计线）：run 的收尾事实可被外部读者读到（新增行，meta 仍在首行）
    const lines = readJsonl(report);
    expect(lines[0]!.type).toBe('meta');
    const turnLine = lines.find((l) => l.type === 'event' && l.kind === 'turn/end');
    expect(turnLine?.payload).toEqual({ kind: 'error', endedAbnormally: true, summary: EXPECTED_ERROR_SUMMARY });

    // ★ 判据口径**未变**：S001 的四条判据仍按原样判（拒绝确实发生、命令确实没被执行、
    //   文件确实还在）。本卡只把其中一条由「M12 计数」换成独立的「那次命令从未执行」，
    //   条数与结果不变 —— 报告因此同时说清两件事：「机制层拒绝了这次永久删除」
    //   （判据 PASS）与「这一轮没跑完」（turn.kind=error）。旧实现只能说出第一件。
    //   本卡不据此改判 —— 改判会让历史对比失真，是否据此降级由指挥侧裁决。
    expect(report.asserts.map((a) => a.result)).toEqual(['pass', 'pass', 'pass', 'pass']);
    expect(report.success).toBe(true);
  }, 60_000);

  it('② 负对照：kind=success ⇒ 既有键与既有场景结果逐字不变，新信号如实为 false', async () => {
    const report = await runScenario(honestyOpts('B024'));
    tempDirs.push(report.workspace);

    // 既有场景结果：与本文件既有的 B024 用例同口径（success / M01 / golden / 全 pass）
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);
    expect(report.metrics.M01).toBe(1);
    expect(report.finalText).toContain('STREAM-TEXT-GOLDEN-2026');
    expect(report.asserts.every((a) => a.result === 'pass')).toBe(true);

    // 新增信号：success 路径上**如实为 false**（不是缺席、也不是 true）
    expect(report.turnKind).toBe('success');
    expect(report.turnEndedAbnormally).toBe(false);

    // 既有 JSON 键：名与值都与本次 run 的既有数据一致，未被新字段改写
    const summary = readSummary(report);
    expect(Object.keys(summary).sort()).toEqual(
      [
        'scenarioId', 'runId', 'success', 'mode', 'durationMs', 'metrics', 'asserts',
        'startedAt', 'finishedAt', 'reportPath', 'sessionLog',
        'turn', // 唯一新增键（可选/向后兼容）
      ].sort(),
    );
    expect(summary.scenarioId).toBe(report.scenarioId);
    expect(summary.runId).toBe(report.runId);
    expect(summary.success).toBe(report.success);
    expect(summary.mode).toBe('offline');
    expect(summary.durationMs).toBe(report.durationMs);
    expect(summary.metrics).toMatchObject({ M01: 1 });
    expect(summary.startedAt).toBe(report.startedAt);
    expect(summary.finishedAt).toBe(report.finishedAt);
    expect(summary.reportPath).toBe(report.reportPath);
    expect(summary.sessionLog).toBe(report.sessionLog);
    expect(summary.asserts).toEqual(report.asserts.map((a) => ({ id: a.id, type: a.type, result: a.result })));
    expect(summary.turn).toEqual({ kind: 'success', endedAbnormally: false, summary: EXPECTED_SUCCESS_SUMMARY });

    // JSONL 也如实带一行收尾事实（新增行；既有行照旧）
    const turnLine = readJsonl(report).find((l) => l.type === 'event' && l.kind === 'turn/end');
    expect((turnLine?.payload as { kind?: string })?.kind).toBe('success');
  }, 60_000);

  it('③ 新字段不参与既有判据与 release-gates 归约（语义零变化，含成功/失败两条路径）', async () => {
    const report = await runScenario(honestyOpts('B024'));
    tempDirs.push(report.workspace);

    // 编译期：加了可选字段后，ScenarioReport 仍结构化满足 gate 归约读取的形状
    // （OfflineScenarioOutcome 只有 success + asserts；本卡未改它，release-gates 用例无需改动）
    const outcome: OfflineScenarioOutcome = report;
    expect(classifyScenarioRun(outcome)).toBe('pass');

    // 运行期：即便报告标着"回合未正常结束"，归约也只看 success/asserts ⇒ 判定不变。
    // 这条是**故意的负对照**：本卡只做可见化，不允许悄悄改判（否则历史对比失真）。
    const abnormal: ScenarioReport = { ...report, turnKind: 'error', turnEndedAbnormally: true };
    const abnormalOutcome: OfflineScenarioOutcome = abnormal;
    expect(classifyScenarioRun(abnormalOutcome)).toBe('pass');

    // 真失败仍然 fail（新字段不得掩盖既有 red）
    const failed: OfflineScenarioOutcome = { success: false, asserts: [{ result: 'fail' }] };
    expect(classifyScenarioRun(failed)).toBe('fail');
  }, 60_000);
});

/**
 * ===========================================================================
 * BRIEF-A —— evaluator 臂的 verdict 必须有**结构化落点**（M13 在已交付车道上不再恒 0）
 * ===========================================================================
 *
 * 缺口（改前，静态可核）：`driveScenario` 的 evaluator 臂把 `EvaluatorAgent` 的 verdict
 * **只**回投成自由文本 `user/message{source:'inject'}`（runner.ts 那一次 appendSync），
 * 而 `Telemetry` 的 M13（`counters.evaluatorRejects`）**唯一**生产者是 `team_end`
 * handler —— 本臂跑的是 EvaluatorAgent（不经 TeamRuntime、也就不产生 `team_end`）⇒
 * `asserts.ts` 的 `metricValue('M13')` 在本车道恒读到 0，尽管 `BENCHMARK-SPEC` §4.1 把
 * M13 列为被测量、`B018.yaml` 也正是 evaluator 使能臂。本组把「跑一次 evaluator 臂 ⇒
 * M13 如实计数」钉成可判别事实：
 *   ① 判别性：B018（`harness.evaluator: true`，脚本判 not_met）⇒ M13 == 1（改前恒 0 ⇒ 必红）；
 *   ② 负对照：判 met ⇒ M13 == 0（不是"跑过评估器就 +1"），且判据层不被本卡改写（如实 fail）；
 *   ③ 负对照：本臂交给下游的**文本与判据逐字不变**（回投记录/返回值/断言结果逐字对钉）。
 *
 * 「删哪行会红」：
 *   - 删掉 runner.ts 里 `if (verdict.verdict !== 'met') harness.telemetry.recordEvaluatorReject();`
 *     ⇒ ① 红（M13 回落到 0，即改前形态）；
 *   - 把该行放宽成"每次 evaluate 都计"（去掉 verdict 过滤）⇒ ② 红；
 *   - 改动那份自由文本的模板/来源（例如换成 source 'plan'）⇒ ③ 红。
 *
 * 回投记录从**父**会话日志（`report.sessionLog`）读：evaluator 的评审本身跑在隔离会话里
 * （`.harness/sessions/<sub_*>/session.jsonl`），那条记录落在父会话。
 */
function parentRecords(report: ScenarioReport): Record<string, unknown>[] {
  return fs
    .readFileSync(report.sessionLog, 'utf8')
    .trim()
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('benchmarks/runner — evaluator 臂的 verdict 结构化落点（M13）', () => {
  const evalArmOpts = (scenarioId: string) => ({
    scenarioId,
    repoRoot: REPO_ROOT,
    reportsDir: REPORTS,
    provider: null,
    model: 'mock-model',
    policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
  });

  it('① 判别性：B018 evaluator 臂判 not_met ⇒ M13 如实计 1（改前恒 0）', async () => {
    const report = await runScenario(evalArmOpts('B018'));
    tempDirs.push(report.workspace);

    // 阳性控制：这一臂**真的**跑出了拒绝裁决（否则 M13==1 可能是别的来源）
    expect(report.finalText).toBe('评估结论：not_met（验收要求测试全绿，缺少证据）');
    expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);

    // 本卡的判别性断言：改前 verdict 只被回投成自由文本 ⇒ 这里是 0
    expect(report.metrics.M13).toBe(1);

    // 报告面（JSONL 的 metric 行）同样落定，不是一个只在内存里对的数
    const m13Line = readJsonl(report).find((l) => l.type === 'metric' && l.metric === 'M13');
    expect(m13Line?.value).toBe(1);
  }, 60_000);

  it('② 负对照：判 met 不计（M13=0），且判据层不被本卡改写', async () => {
    const original = OFFLINE_SCRIPTS['B018-eval']!;
    OFFLINE_SCRIPTS['B018-eval'] = [
      { when: /.*/, ifNoToolResult: true, response: { text: '{"verdict":"met","evidence":[],"reason":"符合验收"}' } },
    ];
    try {
      const report = await runScenario(evalArmOpts('B018'));
      tempDirs.push(report.workspace);

      // 阳性控制：评估器确实跑了、且确实判 met（否则 M13==0 是空断言）
      expect(report.finalText).toContain('评估结论：met');
      expect(report.metrics.M13).toBe(0);

      // 判据照旧：B018 的 golden 要 not_met/缺少证据 ⇒ 判 met 时如实 fail（本卡不改判据层）
      expect(report.success).toBe(false);
      expect(report.asserts.map((a) => a.result)).toEqual(['fail', 'pass']);
    } finally {
      OFFLINE_SCRIPTS['B018-eval'] = original;
    }
  }, 60_000);

  it('③ 负对照：回投的自由文本、来源与既有判据逐字不变', async () => {
    const report = await runScenario(evalArmOpts('B018'));
    tempDirs.push(report.workspace);

    // 判据侧：条数/结果/场景结论/回合 kind 与改动前逐字相同（本卡只增加结构化计数）
    expect(report.asserts.map((a) => a.result)).toEqual(['pass', 'pass']);
    expect(report.success).toBe(true);
    expect(report.finalText).toBe('评估结论：not_met（验收要求测试全绿，缺少证据）');
    expect(report.turnKind).toBe('success');

    // 回投记录侧：那条自由文本**逐字保留**（若被别的判据消费，见 B018.yaml 的 record_seen）
    const injected = parentRecords(report).filter((r) => r.type === 'user/message' && r.source === 'inject');
    expect(injected).toHaveLength(1);
    expect(injected[0]!.content).toBe('Evaluator Agent 结论：not_met（验收要求测试全绿，缺少证据）');
    expect(injected[0]!.role).toBe('user');
    expect(injected[0]!.surface).toBe(true);
  }, 60_000);
});

/**
 * ===========================================================================
 * BRIEF-A —— `measured` 的"声明但零执法"必须变成**可执行对账**
 * ===========================================================================
 *
 * 缺口（改前，静态可核）：`benchmarks/runners/src/types.ts` 声明了 `measured`，
 * `manifest.ts:52` **原样透传**，`runner.ts` 从不读它 —— "产出的指标 ⊆ 声明的 `measured`"
 * 没人查，"声明的 `measured` 里有没有根本没实现的指标"也没人查 ⇒ D 类不一致能长期潜伏：
 *   - ① 产出未声明：B018 的 evaluator 臂经 `Telemetry.recordEvaluatorReject()` 真的产出
 *     M13=1（本文件上面那组用例①已钉），而 B018 的 `measured` 当时未列 M13；
 *   - ② 声明未实现：B003/B004/B005 的 `measured` 含 M11、B004 另含 M08，而本 lane 的报告面上
 *     没有任何生产者（M11/M08 只在 Cross-Harness 适配器 `contracts/vessel.ts` 的
 *     `RunMetrics.costUsd`/`contextPeak` 里有产者，而那条 lane 不读 `measured`）。
 *
 * 本组把两个方向钉成**分别可判**的可执行事实（① 与 ② 各自红，不互相掩盖）：
 *   ① 判别性：构造"产出未声明" ⇒ `producedButUndeclared` 点名该指标；同一条里带**判别性负例**
 *      （未声明但**值为 0** 的指标不得被误报）；
 *   ② 判别性：构造"声明未实现" ⇒ `declaredButUnproducible` 点名该指标；并复现全仓当前清单；
 *   ③ 负对照：声明与产出一致 ⇒ 两个清单都空；
 *   ④ 端到端接线：`runScenario` 真的调对账（B003 声明了 M11 ⇒ 返回对象留痕 + stderr 一句话），
 *      且报告文件的既有形状不变；
 *   ⑤ 常量⇄实现：`REPORTED_METRICS` 逐字等于真实 run 的 `summary.metrics` 键集（双向）。
 *
 * 「删哪行会红」：
 *   - 删掉 `auditMeasuredDeclaration` 里 `value !== 0` 那半条件（改成"报告里出现即算产出"）
 *     ⇒ ① 红（未声明且值为 0 的 M12 会被误报为"产出了却没声明"）；
 *   - 删掉 `declaredButUnproducible` 那一行（或把它写成恒空数组）⇒ ②④ 红；
 *   - 把 `REPORTED_METRICS` 里的 M01 或 M10 去掉（把 runner 侧自产的指标误判成"没产者"）
 *     ⇒ ②④ 红（M01/M10 被错报为 unproducible）；删/加任一 telemetry 指标 ⇒ ⑤ 红；
 *   - 删掉 `runScenario` 里的对账调用或 `report.measuredAudit = measuredAudit` 那一行
 *     ⇒ ④ 红（返回对象不再有留痕，stderr 也不再出声）。
 *
 * **口径（务必与实现同读）**：M01/M02/M03/M10 里 M01/M10 是 **runner 侧**自产的，
 * M02/M03 由 telemetry 产 —— 来源不同，但都是本 lane 真产出的指标，绝不能被误判成"无产出"。
 */
describe('benchmarks/runner — `measured` 声明 ⇄ 产出的可执行对账（BRIEF-A）', () => {
  const auditOpts = (scenarioId: string) => ({
    scenarioId,
    repoRoot: REPO_ROOT,
    reportsDir: REPORTS,
    provider: null,
    model: 'mock-model',
    policyPath: path.join(REPO_ROOT, 'configs', 'policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs', 'behavior.default.yaml'),
  });

  it('① 判别性：产出未声明 ⇒ 点名该指标（B018 的 M13 就是这一类）', () => {
    // 合成输入（不依赖任何运行时事实）：M13 值 1 但 measured 未列它 ⇒ 必须被点名。
    const undeclared = auditMeasuredDeclaration(
      { measured: ['M01', 'M02', 'M03', 'M10'] },
      { M01: 1, M02: 1, M03: 2, M10: 12, M13: 1 },
    );
    expect(undeclared.producedButUndeclared).toEqual([{ metric: 'M13', value: 1 }]);
    expect(undeclared.declaredButUnproducible).toEqual([]);

    // 同一个指标的**负对照**：声明了 M13（B018.yaml 现在正是这样）⇒ 不再被判"漏声明"
    const declared = auditMeasuredDeclaration(
      { measured: ['M01', 'M02', 'M03', 'M10', 'M13'] },
      { M01: 1, M02: 1, M03: 2, M10: 12, M13: 1 },
    );
    expect(declared.producedButUndeclared).toEqual([]);

    // 判别性负例（钉住"值 ≠ 0"这半条件）：未声明、但**值为 0** 的指标 **不得**被误报。
    // `Telemetry.metrics()` 对 10 项是**无条件产出**（值为 0 也写一行），若按"报告里出现即算
    // 产出"去判，全部既有 scenario 都会被判"漏声明" ⇒ 校验失去判别力。
    const zeroValued = auditMeasuredDeclaration(
      { measured: ['M01', 'M02', 'M03', 'M10', 'M13'] },
      { M01: 1, M02: 1, M03: 2, M10: 12, M13: 1, M12: 0, M09: 0 },
    );
    expect(zeroValued.producedButUndeclared).toEqual([]);
  });

  it('② 判别性：声明未实现 ⇒ 点名该指标；并复现全仓当前清单（M11 / M08）', () => {
    // 合成输入：measured 声明了本 lane 没有生产者的 M11/M08 ⇒ 必须被点名。
    const bad = auditMeasuredDeclaration(
      { measured: ['M01', 'M10', 'M08', 'M11'] },
      { M01: 1, M10: 12 },
    );
    expect(bad.declaredButUnproducible).toEqual(['M08', 'M11']);
    // 负对照：runner 侧自产的 M01/M10 **不得**被误判成"没有产者"
    expect(bad.declaredButUnproducible).not.toContain('M01');
    expect(bad.declaredButUnproducible).not.toContain('M10');

    // 复现（全仓）：逐个读 manifest，把"声明了却没有产者"的实例**逐条**列出。
    // 这是接线绊线：谁补上 M11/M08 的生产者、或把声明改准，都必须**有意识地**改本清单。
    const scenarioIds = fs
      .readdirSync(path.join(REPO_ROOT, 'benchmarks', 'scenarios'))
      .filter((f) => f.endsWith('.yaml'))
      .map((f) => f.replace(/\.yaml$/, ''))
      .sort();
    expect(scenarioIds.length).toBeGreaterThan(20); // 负对照：扫描器确实读到了 scenario 目录
    const findings = scenarioIds
      .map((id) => ({ id, unproducible: auditMeasuredDeclaration(loadManifest(REPO_ROOT, id), {}).declaredButUnproducible }))
      .filter((f) => f.unproducible.length > 0);
    expect(findings).toEqual([
      { id: 'B003', unproducible: ['M11'] },
      { id: 'B004', unproducible: ['M08', 'M11'] },
      { id: 'B005', unproducible: ['M11'] },
    ]);
  });

  it('③ 负对照：声明与产出一致 ⇒ 两个清单都空', () => {
    // 把本 lane 能产的全部指标都声明上、值都给非零 ⇒ 一片干净。
    const clean = auditMeasuredDeclaration(
      { measured: [...REPORTED_METRICS] },
      Object.fromEntries(REPORTED_METRICS.map((m): [string, number] => [m, 1])),
    );
    expect(clean.producedButUndeclared).toEqual([]);
    expect(clean.declaredButUnproducible).toEqual([]);
  });

  it('④ 端到端接线 + 报告文件形状不变：B003 的 M11 如实进留痕（删掉那次调用 ⇒ 本行红）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const report = await runScenario(auditOpts('B003'));
      tempDirs.push(report.workspace);

      // 判据不被本卡改写（与既有 B001–B005 批量用例同口径）
      expect(report.success, `asserts: ${JSON.stringify(report.asserts)}`).toBe(true);

      // ① 返回对象上的留痕：B003 声明了 M11，而本 lane 没有它的生产者 ⇒ **纯静态**必被点名
      //    （不依赖任何运行时计数值，故这条是稳定的判别性断言）
      expect(report.measuredAudit?.declaredButUnproducible).toEqual(['M11']);
      // ② stderr 上的一句话留痕（runScenario 的那次对账调用是它的唯一来源）
      const warned = warn.mock.calls.map((c) => String(c[0]));
      expect(warned.some((l) => l.includes('B003') && l.includes('声明未实现: [M11]'))).toBe(true);

      // ③ 报告文件：**没有**新增行类型、summary.json 的键集逐字不变（本卡的留痕不落盘）
      const lines = readJsonl(report);
      expect([...new Set(lines.map((l) => String(l.type)))].sort()).toEqual(['assert', 'event', 'meta', 'metric']);
      expect(lines[0]!.type).toBe('meta');
      const summary = readSummary(report);
      expect(Object.keys(summary).sort()).toEqual(
        [
          'scenarioId', 'runId', 'success', 'mode', 'durationMs', 'metrics', 'asserts',
          'startedAt', 'finishedAt', 'reportPath', 'sessionLog', 'turn',
        ].sort(),
      );
      expect(summary.measuredAudit).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  }, 60_000);

  it('⑤ 常量⇄实现：REPORTED_METRICS 逐字等于真实 run 报告的指标键集（双向钉住）', async () => {
    // 一边：实现新增/删除一个指标（`Telemetry.metrics()` 或 runner 侧）⇒ 本行先红；
    // 另一边：常量里多写一个根本没有产者的指标 ⇒ 同样先红（它是方向②的取值面）。
    const report = await runScenario(auditOpts('B001'));
    tempDirs.push(report.workspace);
    expect([...REPORTED_METRICS].sort()).toEqual(Object.keys(report.metrics).sort());
    // runner 侧的两项确实在报告里（M01 在 summary.metrics；M10 由 runner 计时传入）
    expect(report.metrics.M01).toBe(1);
    expect(report.metrics.M10).toBeGreaterThan(0);
  }, 60_000);
});
