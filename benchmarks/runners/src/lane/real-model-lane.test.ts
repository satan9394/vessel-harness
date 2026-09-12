/**
 * task 082 — Real-Model Benchmark Lane tests.
 *
 * Covers: scenario-set validation (registry shape/tier/runnable), lane
 * execution with an injected mock provider, §15 L3 collection aggregation,
 * report emission, no-credential degradation (pending-environment, no throw),
 * and error handling (missing fixture / thrown resolver).
 *
 * NOTE (deletion铁律): tests keep temp dirs under os.tmpdir() — OS-managed
 * scratch — and never invoke permanent deletion.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { MockProvider } from '@vessel/llm';
import type { ChatProvider, ChatResponse } from '@vessel/shared';
import { validateRunResult } from '../contracts/validate.js';
import type { RunResult } from '../contracts/types.js';
import { loadManifest, OFFLINE_SCRIPTS } from '../runner.js';
import {
  LANE_MODELS,
  LANE_SCENARIOS,
  runRealModelLane,
  probeModelApi,
  scenarioAppliesToModel,
  renderLaneMarkdown,
  describeLaneFailureNote,
  describeAbnormalTurnNote,
  abnormalTurnKindOf,
  type LaneModel,
  type LaneScenarioEntry,
} from './real-model-lane.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function mockResolver(provider: ChatProvider | null): () => Promise<ChatProvider | null> {
  return async () => provider;
}

function mockProvider(text = 'LANE-MOCK-ANSWER'): ChatProvider {
  return new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text } }], { model: 'mock-model' });
}

/**
 * 熔断注入器（与 contracts/contracts.test.ts:211-236 同源）：每一步都发**完全相同的**
 * 工具调用（同 intent）⇒ policy 第 3 次拒绝同一 intent ⇒ `DenialLimitError` ⇒
 * core AgentLoop.ts:334-338 把 `err.message` 写进 finalText 后**正常 return** kind='error'。
 * ⇒ `RunResult.metrics.success === true`（finalText 非空）但回合没跑完。
 */
function circuitBreakerProvider(): ChatProvider {
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

/** provider 首次调用即抛 ⇒ vessel adapter 捕获为 runError ⇒ metrics.success=false。 */
function throwingProvider(message = 'provider exploded'): ChatProvider {
  return {
    id: 'throwing',
    async chat(): Promise<ChatResponse> {
      throw new Error(message);
    },
  };
}

/** A small scenarios override that is quick and deterministic for execution tests. */
const EXEC_SET: LaneScenarioEntry[] = [
  { id: 'B001', tier: 'flash', runnable: true },
  { id: 'B002', tier: 'flash', runnable: false, note: 'skipped-by-design' },
];

describe('lane — scenario-set validation (§15.1 L2 固定 20-50 场景)', () => {
  it('exposes a fixed default registry (all existing assets + V1.1-D lanes) inside the 20-50 target', () => {
    const ids = LANE_SCENARIOS.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(ids.length).toBe(25);
    // unique ids
    expect(new Set(ids).size).toBe(ids.length);
    // known scenario ids (B001-B027 existing + safety S001-S008)
    for (const id of ids) expect(id).toMatch(/^(B\d{3}|S\d{3})$/);
    // V1.1-D capability lanes are present
    for (const id of ['B024', 'B025', 'B026', 'B027']) expect(ids).toContain(id);
  });

  it('every entry carries a valid tier and all runnable ones are executable L1 assets', () => {
    for (const s of LANE_SCENARIOS) {
      expect(['pro', 'flash', 'both']).toContain(s.tier);
      // runnable set only includes fixtures that exist as L1 assets
      if (s.runnable) {
        expect(fs.existsSync(path.join(REPO_ROOT, 'benchmarks', 'fixtures', s.id, 'task.md'))).toBe(true);
      }
    }
    const runnable = LANE_SCENARIOS.filter((s) => s.runnable);
    expect(runnable.length).toBe(13); // B001-B005 + S001-S008
  });

  it('documentation: every V1.1-D scenario manifest + fixture is registered and offline-drivable', () => {
    // V1.1-D lanes must be present in LANE_SCENARIOS (enumerated for the 20-50
    // set), carry a loadable manifest, a fixture with task.md, and an offline
    // mock script so the deterministic offline lane can drive them.
    for (const id of ['B024', 'B025', 'B026', 'B027']) {
      const entry = LANE_SCENARIOS.find((s) => s.id === id);
      expect(entry).toBeDefined();
      expect(entry!.runnable).toBe(false); // deterministic-mock feature lane
      const manifest = loadManifest(REPO_ROOT, id);
      expect(manifest.harness).toBeDefined(); // has a capability driver
      expect(fs.existsSync(path.join(REPO_ROOT, 'benchmarks', 'fixtures', id, 'task.md'))).toBe(true);
      expect(Array.isArray(OFFLINE_SCRIPTS[id])).toBe(true); // offline mock script drives it
    }
  });

  it('annotation: pro tier carries task-style scenarios + feature lanes; flash carries light/safety', () => {
    const proIds = LANE_SCENARIOS.filter((s) => s.tier === 'pro').map((s) => s.id);
    const flashIds = LANE_SCENARIOS.filter((s) => s.tier === 'flash').map((s) => s.id);
    expect(proIds).toContain('B003'); // implement
    expect(proIds).toContain('B004'); // refactor
    expect(proIds).toContain('B005'); // exec
    expect(flashIds).toContain('B001'); // read+answer
    expect(flashIds).toContain('S001'); // safety
    // V1.1-D lanes annotated
    expect(proIds).toContain('B024'); // streaming
    expect(flashIds).toContain('B026'); // steering
    // scenarios are feature lanes (runnable:false) — not driven on a real model
    for (const id of ['B024', 'B025', 'B026', 'B027']) {
      expect(LANE_SCENARIOS.find((s) => s.id === id)?.runnable).toBe(false);
    }
    // scenarioAppliesToModel gate
    const pro = LANE_MODELS[0]!;
    const flash = LANE_MODELS[1]!;
    expect(scenarioAppliesToModel(LANE_SCENARIOS.find((s) => s.id === 'B003')!, pro)).toBe(true);
    expect(scenarioAppliesToModel(LANE_SCENARIOS.find((s) => s.id === 'B003')!, flash)).toBe(false);
    expect(scenarioAppliesToModel(LANE_SCENARIOS.find((s) => s.id === 'S001')!, flash)).toBe(true);
  });

  it('models default to DeepSeek V4 Pro / Flash with distinct tiers', () => {
    expect(LANE_MODELS.map((m) => m.id)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(LANE_MODELS[0]!.tier).toBe('pro');
    expect(LANE_MODELS[1]!.tier).toBe('flash');
    expect(LANE_MODELS[0]!.displayName).toBe('DeepSeek V4 Pro');
  });
});

describe('lane — execution with injected mock provider (§15.1 L2/L3 采集)', () => {
  it('drives runnable scenarios through the 076 adapter and returns validated RunResult rows', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-reports-'));
    const report = await runRealModelLane({
      models: LANE_MODELS,
      scenarios: LANE_SCENARIOS,
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    // a flash tier model → runs flash runnable scenarios; pro tier model → pro runnable scenarios
    const flashRows = report.rows.filter((r) => r.modelId === 'deepseek-v4-flash' && r.status === 'passed');
    expect(flashRows.length).toBeGreaterThanOrEqual(1);
    // every executed row carries a 076-valid RunResult
    for (const r of report.rows) {
      if (r.status === 'passed') {
        expect(r.result).toBeDefined();
        expect(validateRunResult(r.result!)).toEqual([]);
        expect(r.result!.metrics.success).toBe(true);
      }
    }
    // non-runnable feature lanes are always skipped (never burn quota)
    const skipped = report.rows.filter((r) => r.status === 'skipped');
    expect(skipped.length).toBeGreaterThan(0);
    for (const r of skipped) expect(r.result).toBeUndefined();
    // no pending-environment & not degraded with a working mock provider
    expect(report.degraded).toBe(false);
    expect(report.rows.some((r) => r.status === 'pending-environment')).toBe(false);
    // scenario count registry-wide
    expect(report.scenarioCount).toBe(LANE_SCENARIOS.length);
  }, 120_000);

  it('collection aggregation: modelSummaries total §15 L3 across rows', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-reports-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!], // flash only for a fast deterministic run
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.modelSummaries).toHaveLength(1);
    const s = report.modelSummaries[0]!;
    expect(s.modelId).toBe('deepseek-v4-flash');
    expect(s.passed).toBe(1);
    const row = report.rows[0]!;
    expect(row.result).toBeDefined();
    // summary wallTime sums the row's wallTime (consistent accumulator)
    expect(s.wallTimeMs).toBeGreaterThanOrEqual(0);
    expect(s.costUsd).toBeGreaterThanOrEqual(0);
    expect(s.inputTokens).toBe(row.result!.metrics.inputTokens);
  }, 120_000);

  it('report: writes markdown + json into reportsDir and renders a model×scenario matrix', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-reports-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!],
      scenarios: EXEC_SET,
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(fs.existsSync(report.reportMdPath)).toBe(true);
    expect(fs.existsSync(report.reportJsonPath)).toBe(true);
    const md = fs.readFileSync(report.reportMdPath, 'utf8');
    expect(md).toContain(`# ${report.runId}`);
    expect(md).toContain('model | scenario | tier | status');
    expect(md).toContain('B001');
    expect(md).toContain('pending-environment');
    expect(md).toContain('skipped');
    // json round-trip carries all rows
    const parsed = JSON.parse(fs.readFileSync(report.reportJsonPath, 'utf8')) as {
      rows: unknown[];
      modelSummaries: unknown[];
    };
    expect(parsed.rows).toHaveLength(report.rows.length);
    expect(parsed.modelSummaries).toHaveLength(report.modelSummaries.length);
    // pure renderer is directly usable
    expect(renderLaneMarkdown(report)).toContain('DeepSeek V4 Flash');
  }, 120_000);
});

describe('lane — degradation & exceptions', () => {
  it('degrades to pending-environment for unresolvable providers without throwing', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-'));
    const report = await runRealModelLane({
      models: LANE_MODELS,
      scenarios: LANE_SCENARIOS,
      providerResolver: mockResolver(null), // no credentials / cannot resolve
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.degraded).toBe(true);
    const pending = report.rows.filter((r) => r.status === 'pending-environment');
    // every runnable, tier-applicable scenario is pending-environment; none ran
    expect(pending.length).toBeGreaterThan(0);
    expect(report.rows.some((r) => r.status === 'passed')).toBe(false);
    expect(report.rows.some((r) => r.result)).toBe(false);
  });

  it('probeModelApi reports availability per model and never throws', async () => {
    const avail = await probeModelApi(LANE_MODELS, mockResolver(mockProvider()));
    expect(avail['deepseek-v4-pro']).toBe(true);
    expect(avail['deepseek-v4-flash']).toBe(true);
    const none = await probeModelApi(LANE_MODELS, async () => null);
    expect(none['deepseek-v4-pro']).toBe(false);
    // throwing resolver is treated as unavailable, not an exception
    const thrown = await probeModelApi(
      LANE_MODELS,
      async () => {
        throw new Error('provider exploded');
      },
    );
    expect(thrown['deepseek-v4-flash']).toBe(false);
  });

  it('marks a missing-fixture scenario as failed and throws nothing', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!],
      scenarios: [{ id: 'B999', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    const row = report.rows[0]!;
    expect(row.status).toBe('failed');
    expect(row.note).toContain('fixture not found');
    expect(report.degraded).toBe(false);
  });

  it('scenario tier filtering skips non-applicable scenarios for a model', async () => {
    // a pro-only scenario set fed to a flash-only model → all skipped (not applicable)
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-lane-'));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!], // flash
      scenarios: [{ id: 'B003', tier: 'pro', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    // B003 is pro-tier; the flash model has no applicable scenarios → zero rows
    expect(report.rows).toHaveLength(0);
    expect(report.modelSummaries[0]!.runnableScenarios).toBe(0);
  });

  it('describeLaneFailureNote: success=false 原因含真实运行异常（task 108），无异常保留未收敛基线', () => {
    const wireNote = describeLaneFailureNote({
      metrics: { success: false, toolCalls: 2 },
      notes: [
        "run raised: opencode-go 400 invalid_request_error (http): Messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
      ],
    } as unknown as RunResult);
    // 保留「finalText 为空」基线子串（gate 判据兼容）+ 追加真实异常
    expect(wireNote).toContain('RunResult success=false：finalText 为空');
    expect(wireNote).toContain('toolCalls=2');
    expect(wireNote).toContain('运行异常');
    expect(wireNote).toContain("role 'tool' must be a response");
    // 无 notes（如 mimo 未收敛：步数预算耗尽、无异常）→ 保持原「多为模型未在步数/预算内收敛」文案
    const convNote = describeLaneFailureNote({ metrics: { success: false, toolCalls: 65 } } as unknown as RunResult);
    expect(convNote).toContain('多为模型未在步数/预算内收敛');
    expect(convNote).not.toContain('运行异常');
  });
});

/**
 * 证据层诚实性（本卡）：**回合未正常收尾的行不得报 passed**。
 *
 * 缺口：`metrics.success` 的口径是 `runError === null && finalText.trim().length > 0`
 * （contracts/vessel.ts:197 —— 「模型说了话」），而熔断打死的回合把错误文案写进 finalText
 * 后正常 return ⇒ success=true；lane 旧口径（real-model-lane.ts:342）据此判 passed，
 * 「本 run 未正常收尾」的 notes 只躺在 `row.result.notes` 里 ⇒ 报告里出现**来源不明的绿灯**。
 */
describe('lane — 证据层诚实性：回合未正常收尾不得报 passed', () => {
  const REPORTS_PREFIX = 'cah-lane-abnormal-';

  /**
   * ① 复现 + 判别性：异常收尾 + metrics.success===true ⇒ 行状态不再是 passed。
   * 删掉修复（把 :417-418 的 `abnormalKind === undefined` 或 :423-429 的 note 分支还原）
   * ⇒ 本用例必红。
   */
  it('复现 + 修复：熔断打死（success===true, kind=error）的行不得报 passed，且原因在行上可见', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), REPORTS_PREFIX));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!], // flash
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(circuitBreakerProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    const row = report.rows[0]!;
    expect(row).toBeDefined();

    // —— 前提（上游契约侧已修，contracts.test.ts:211-236 同源）：回合被打死但 finalText 非空 ⇒ 口径仍算 success
    expect(row.result).toBeDefined();
    expect(row.result!.metrics.success).toBe(true);
    expect(row.result!.notes?.join(' | ')).toContain('turn ended kind=error');
    expect(row.result!.notes?.join(' | ')).toContain('same intent denied');

    // —— ★复现：旧实现（real-model-lane.ts:342 的三元表达式）在本输入下的唯一取值就是 'passed'
    //    （issues.length===0 且 metrics.success===true）。这一行就是「当前该行 status === 'passed'」的证据。
    const legacyStatus: string =
      validateRunResult(row.result!).length === 0 && row.result!.metrics.success ? 'passed' : 'failed';
    expect(legacyStatus).toBe('passed');

    // —— ★修复后：非 passed（状态本身 + 加法字段 + note 三重可见）
    expect(row.status).not.toBe('passed');
    expect(row.status).toBe('failed');
    expect(row.turnEndedAbnormally).toBe(true);
    expect(row.turnKind).toBe('error');
    expect(row.note).toBeDefined();
    expect(row.note!).toContain('未正常收尾');
    expect(row.note!).toContain('kind=error');
    expect(row.note!).toContain('本行不计 passed');
    expect(row.note!).toContain('same intent denied'); // 真实异常文案留在行上

    // —— 聚合与报告层同样看不到这行 pass（可见性不止在 JSON 的行对象里）
    expect(report.modelSummaries[0]!.passed).toBe(0);
    expect(report.modelSummaries[0]!.failed).toBe(1);
    const md = fs.readFileSync(report.reportMdPath, 'utf8');
    expect(md).toContain('未正常收尾');
    expect(md).toContain('| B001 | flash | failed |');
  }, 120_000);

  /**
   * ② 负对照（最重要）：正常收尾 + metrics.success===true ⇒ 仍 passed、字段逐字不变。
   * 若有人「把一切都判非 passed」（例如去掉 `abnormalKind === undefined` 之后的与项、
   * 或把 status 写成只看 issues），本用例必红。
   */
  it('负对照：正常收尾 + success===true ⇒ 仍 passed，键集与取值逐字不变', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), REPORTS_PREFIX));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!],
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(mockProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    const row = report.rows[0]!;
    expect(row.status).toBe('passed');
    expect(row.result!.metrics.success).toBe(true);
    expect(row.result!.notes).toBeUndefined(); // 正常收尾：notes 仍缺席（上游契约侧纪律）
    expect(row.note).toBeUndefined(); // 正常行不带 note —— 与改动前逐字一致
    // 键集**与顺序**逐字不变：没有 turnEndedAbnormally / turnKind
    expect(Object.keys(row)).toEqual(['modelId', 'scenarioId', 'tier', 'status', 'result', 'note']);
    expect('turnEndedAbnormally' in row).toBe(false);
    expect('turnKind' in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain('turnEndedAbnormally');
    // 聚合不变
    expect(report.modelSummaries[0]!.passed).toBe(1);
    expect(report.modelSummaries[0]!.failed).toBe(0);
    expect(fs.readFileSync(report.reportMdPath, 'utf8')).toContain('| B001 | flash | passed |');
  }, 120_000);

  /** ③ 既有行为不变：metrics.success===false ⇒ failed，note 仍走既有基线（不放宽、不改写）。 */
  it('既有行为：success===false ⇒ 仍 failed，note 基线逐字不变（不被新分支改写）', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), REPORTS_PREFIX));
    const report = await runRealModelLane({
      models: [LANE_MODELS[1]!],
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: mockResolver(throwingProvider()),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    const row = report.rows[0]!;
    expect(row.status).toBe('failed');
    expect(row.result!.metrics.success).toBe(false);
    // 逐字：仍由 describeLaneFailureNote 生成（gate 的 isModelNonConvergentLane 基线可判）
    expect(row.note).toBe(describeLaneFailureNote(row.result!));
    expect(row.note).toContain('RunResult success=false：finalText 为空');
    expect(row.note).toContain('provider exploded');
    expect(row.note).not.toContain('但回合未正常收尾'); // 新分支未接管 success=false 一族
    // runTurn 抛异常时没有回合 kind ⇒ 不加异常标记（该字段语义 = 「正常返回但 kind≠success」）
    expect(row.turnEndedAbnormally).toBeUndefined();
    expect(row.turnKind).toBeUndefined();
    expect('turnEndedAbnormally' in row).toBe(false);
    expect(report.modelSummaries[0]!.failed).toBe(1);
    expect(report.modelSummaries[0]!.passed).toBe(0);
  }, 120_000);

  /**
   * 谓词层最小判别（纯函数，不跑 lane）：
   * 只认 vessel 契约写入的「未正常收尾」标记，无关 notes / 显式 kind=success 一律不触发。
   */
  it('abnormalTurnKindOf：只认「turn ended kind=<非 success>」，无关 notes 不误触发', () => {
    const r = (notes?: string[]): RunResult =>
      ({ metrics: { success: true, toolCalls: 0 }, notes } as unknown as RunResult);
    // 负对照：正常收尾 / 无关 notes / 显式 success 一律 undefined
    expect(abnormalTurnKindOf(r(undefined))).toBeUndefined();
    expect(abnormalTurnKindOf(r([]))).toBeUndefined();
    expect(abnormalTurnKindOf(r(['turn ended kind=success：…']))).toBeUndefined();
    expect(abnormalTurnKindOf(r(['adapter note: metric provenance approximation']))).toBeUndefined();
    // 正例：真实 kind
    expect(abnormalTurnKindOf(r(['turn ended kind=error：本 run 未正常收尾']))).toBe('error');
    expect(abnormalTurnKindOf(r(['turn ended kind=budget：本 run 未正常收尾']))).toBe('budget');
    expect(abnormalTurnKindOf(r(['turn ended kind=interrupted：本 run 未正常收尾']))).toBe('interrupted');
    // 写入侧逐字文案（contracts/vessel.ts:225-230）
    const real =
      'turn ended kind=error：本 run 未正常收尾，finalText 是错误/半截文案而非模型答案' +
      '（finalText="same intent denied 3 times: Shell"）';
    expect(abnormalTurnKindOf(r([real]))).toBe('error');
    // note 文案：可自解释，且**不得**与 gate 的「未收敛」判据（/success=false/i + /finalText\s*为空/）撞车
    const note = describeAbnormalTurnNote(r([real]), 'error');
    expect(note).toContain('kind=error');
    expect(note).toContain('未正常收尾');
    expect(note).toContain('本行不计 passed');
    expect(note).toContain('same intent denied');
    expect(note).not.toMatch(/success=false/i);
    expect(note).not.toMatch(/finalText\s*为空/);
    // 无 notes（防御性）时仍生成可自解释的 note
    expect(describeAbnormalTurnNote({ metrics: { success: true, toolCalls: 0 } } as unknown as RunResult, 'error')).toContain(
      'kind=error',
    );
  });
});