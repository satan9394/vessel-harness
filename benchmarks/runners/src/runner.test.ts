import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import type { ChatProvider, ChatResponse } from '@vessel/shared';
import { runScenario, loadManifest, OFFLINE_SCRIPTS, turnKindSummary } from './runner.js';
import { runAssert } from './asserts.js';
import { classifyScenarioRun, type OfflineScenarioOutcome } from './release-gates/gates.js';
import type { ScenarioReport } from './types.js';

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
    expect(summary.turn).toEqual({ kind: 'error', endedAbnormally: true, summary: turnKindSummary('error') });
    expect(String((summary.turn as { summary: string }).summary)).toContain('kind=error');

    // 报告（JSONL 审计线）：run 的收尾事实可被外部读者读到（新增行，meta 仍在首行）
    const lines = readJsonl(report);
    expect(lines[0]!.type).toBe('meta');
    const turnLine = lines.find((l) => l.type === 'event' && l.kind === 'turn/end');
    expect(turnLine?.payload).toEqual({ kind: 'error', endedAbnormally: true, summary: turnKindSummary('error') });

    // ★ 判据口径**未变**：S001 的四条判据仍按原样判（拒绝确实发生、文件确实还在）。
    //   报告因此同时说清两件事：「机制层拒绝了这次永久删除」（判据 PASS）与
    //   「这一轮没跑完」（turn.kind=error）。旧实现只能说出第一件。本卡不据此改判
    //   —— 改判会让历史对比失真，是否据此降级由指挥侧裁决。
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
    expect(summary.turn).toEqual({ kind: 'success', endedAbnormally: false, summary: turnKindSummary('success') });

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
