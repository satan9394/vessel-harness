import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import type { RunResult, RunResultMetrics } from '../contracts/types.js';
import {
  aggregateRows,
  buildComparisons,
  buildReport,
  buildReportFromRunResults,
  renderCliSummary,
  renderReportMarkdown,
  rowFromRunResult,
  rowsFromLaneReport,
  writeReportFiles,
  type BenchmarkReport,
  type ReportRow,
} from './report.js';
import { LANE_MODELS, type RealModelLaneReport } from '../lane/real-model-lane.js';

/** Build a valid §15 L3 metrics record with deterministic overridable values. */
function metrics(overrides: Partial<RunResultMetrics> = {}): RunResultMetrics {
  return {
    success: true,
    wallTimeMs: 100,
    toolCalls: 2,
    invalidCalls: 0,
    retries: 0,
    inputTokens: 50,
    outputTokens: 20,
    cacheReadTokens: 5,
    costUsd: 0.01,
    contextPeak: 55,
    compactions: 0,
    humanIntervention: 0,
    policyViolations: 0,
    resumeSuccess: false,
    ...overrides,
  };
}

/** Build a valid 076 RunResult for a given harness/scenario/metrics. */
function run(adapterId: string, fixtureId: string, m: RunResultMetrics, adapterVersion = '1.0.0'): RunResult {
  return {
    adapterId,
    adapterVersion,
    fixtureId,
    metrics: m,
    startedAt: '2026-09-08T00:00:00.000Z',
  };
}

/**
 * Build a minimal (but type-complete) 082 RealModelLaneReport around the given rows.
 * Used to exercise the `vessel bench-report --input <lane.json>` aggregation path
 * (cli.ts:2280-2282 → rowsFromLaneReport) without running a real lane.
 */
function laneReport(rows: RealModelLaneReport['rows']): RealModelLaneReport {
  return {
    runId: 'real-model-lane-test',
    startedAt: '2026-09-08T00:00:00.000Z',
    finishedAt: '2026-09-08T00:00:01.000Z',
    durationMs: 1000,
    models: LANE_MODELS,
    scenarioCount: 1,
    scenarioIds: [...new Set(rows.map((r) => r.scenarioId))],
    rows,
    modelSummaries: [],
    degraded: false,
    reportMdPath: 'x.md',
    reportJsonPath: 'x.json',
  };
}

/** ReportRow 的旧键集（改动前 `rowFromRunResult` 的 8 个键，含顺序）——负对照基准。 */
const LEGACY_ROW_KEYS = [
  'harnessId', 'harnessVersion', 'modelId', 'scenarioId', 'metrics', 'startedAt', 'status', 'notes',
];

/** ScenarioCompareRow 的旧键集（改动前 `buildComparisons` 的 16 个键，含顺序）——负对照基准。 */
const LEGACY_COMPARE_KEYS = [
  'harnessId', 'modelId', 'success', 'wallTimeMs', 'toolCalls', 'invalidCalls', 'retries',
  'inputTokens', 'outputTokens', 'cacheReadTokens', 'costUsd', 'contextPeak', 'compactions',
  'humanIntervention', 'policyViolations', 'resumeSuccess',
];

/** 固定时间戳：md 里 `generatedAt` 是唯一非确定字段，钉住它才能做整篇逐字比对。 */
const FROZEN_AT = '2026-09-08T00:00:00.000Z';

/**
 * **改动前** `renderReportMarkdown` 对「单个正常行报告」的逐字输出
 * （`buildReportFromRunResults([run('vessel','B001', metrics())], { source:'byte-identical' })`
 * + `generatedAt = FROZEN_AT`）。本卡只允许**异常行**多出内容 ⇒ 这张表必须一字不差。
 */
const NORMAL_REPORT_MD_LINES = [
  '# Benchmark Report — byte-identical',
  '> 任务卡：tasks/083-report-dashboard.md；权威需求：docs/Vessel路线 §15.1 L3（cross-harness 统一采集）；前置：076 RunResult 契约 + 082 lane 报告形状。',
  `> 生成于 ${FROZEN_AT}；schema 1；JSON 供 084 release gates 消费。`,
  '',
  '## 总体汇总',
  '| runs | passed | failed | success | harnesses | scenarios | wall(ms) | inTok | outTok | cacheTok | toolCalls | cost(USD) |',
  '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  '| 1 | 1 | 0 | 100% | 1 | 1 | 100 | 50 | 20 | 5 | 2 | 0.01 |',
  '',
  '## 按 harness 汇总',
  '| harness | runs | passed | failed | skipped | pending | success | avgWall(ms) | avgToolCalls | avgInTok | avgOutTok | avgCost | totalCost(USD) |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  '| vessel | 1 | 1 | 0 | 0 | 0 | 100% | 100 | 2 | 50 | 20 | 0.01 | 0.01 |',
  '',
  '## 按场景汇总',
  '| scenario | harnesses | runs | passed | failed | success | totalCost(USD) |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  '| B001 | vessel | 1 | 1 | 0 | 100% | 0.01 |',
  '',
  '## 跨 harness 对比（同场景 §15 L3 指标并列）',
  '### B001',
  '| harness | model | ok | wall(ms) | toolCalls | invalid | retries | inTok | outTok | cacheTok | cost(USD) | ctxPeak | compactions | human | policyViol |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  '| vessel |  | ✅ | 100 | 2 | 0 | 0 | 50 | 20 | 5 | 0.01 | 55 | 0 | 0 | 0 |',
  '',
  '> 说明：对比表把同一场景（fixture）在不同 harness（×可选 model）下的 §15 L3 指标并列；success 以 076 asserts 通过为准。',
];

describe('report aggregation (task 083)', () => {
  it('aggregateRows computes per-harness summary stats and totals', () => {
    const rows: ReportRow[] = [
      rowFromRunResult(run('vessel', 'B001', metrics({ success: true, wallTimeMs: 200, costUsd: 0.02 }))),
      rowFromRunResult(run('vessel', 'B001', metrics({ success: true, wallTimeMs: 400, costUsd: 0.04 }))),
      rowFromRunResult(run('vessel', 'B002', metrics({ success: false, wallTimeMs: 100, costUsd: 0.01 }))),
    ];
    const { harnesses, totals } = aggregateRows(rows);
    expect(harnesses).toHaveLength(1);
    const v = harnesses[0]!;
    expect(v.runs).toBe(3);
    expect(v.passed).toBe(2);
    expect(v.failed).toBe(1);
    expect(v.successRate).toBeCloseTo(2 / 3, 5);
    expect(v.avgWallTimeMs).toBe(Math.round((200 + 400 + 100) / 3));
    expect(v.avgCostUsd).toBeCloseTo(0.023333, 5);
    expect(v.totalCostUsd).toBeCloseTo(0.07, 5);
    expect(v.scenarios).toEqual(['B001', 'B002']);
    expect(totals.runs).toBe(3);
    expect(totals.passed).toBe(2);
    expect(totals.failed).toBe(1);
    expect(totals.harnessCount).toBe(1);
    expect(totals.scenarioCount).toBe(2);
  });

  it('aggregateRows handles empty input without NaN', () => {
    const { harnesses, scenarios, totals } = aggregateRows([]);
    expect(harnesses).toEqual([]);
    expect(scenarios).toEqual([]);
    expect(totals).toMatchObject({
      runs: 0, passed: 0, failed: 0, successRate: 0, harnessCount: 0, scenarioCount: 0,
      totalWallTimeMs: 0, totalCostUsd: 0,
    });
    expect(Number.isNaN(totals.successRate)).toBe(false);
  });

  it('buildComparisons lists the same scenario across harnesses side by side', () => {
    const rows: ReportRow[] = [
      rowFromRunResult(run('vessel', 'B005', metrics({ success: true, wallTimeMs: 300, costUsd: 0.03 }))),
      rowFromRunResult(run('dsh', 'B005', metrics({ success: true, wallTimeMs: 500, costUsd: 0.09 }))),
      rowFromRunResult(run('opencode', 'B005', metrics({ success: false, wallTimeMs: 900, costUsd: 0.12 }))),
    ];
    const cmp = buildComparisons(rows);
    expect(cmp).toHaveLength(1);
    const { scenarioId, rows: cr } = cmp[0]!;
    expect(scenarioId).toBe('B005');
    expect(cr.map((r) => r.harnessId)).toEqual(['dsh', 'opencode', 'vessel']); // sorted
    const vessel = cr.find((r) => r.harnessId === 'vessel')!;
    expect(vessel.wallTimeMs).toBe(300);
    expect(vessel.costUsd).toBe(0.03);
    expect(vessel.success).toBe(true);
    expect(cr.find((r) => r.harnessId === 'opencode')!.success).toBe(false);
  });

  it('buildReport produces a JSON-serializable shape (084 consumption)', () => {
    const results = [
      run('vessel', 'B001', metrics()),
      run('dsh', 'B001', metrics({ costUsd: 0.11 })),
      run('vessel', 'S001', metrics({ success: false })),
    ];
    const rep = buildReportFromRunResults(results, { source: 'test' });
    expect(rep.schemaVersion).toBe(1);
    expect(rep.source).toBe('test');
    expect(typeof rep.generatedAt).toBe('string');
    expect(rep.totals.runs).toBe(3);
    expect(rep.harnesses).toHaveLength(2);
    expect(rep.scenarios).toHaveLength(2);
    expect(rep.comparisons).toHaveLength(2);
    // JSON round-trip — must serialize without loss (084 parses this exactly)
    const json = JSON.parse(JSON.stringify(rep)) as BenchmarkReport;
    expect(json.totals.runs).toBe(3);
    expect(json.comparisons[0]!.rows[0]!.harnessId).toBeTruthy();
    // every comparison row exposes the full §15 L3 surface
    for (const c of rep.comparisons) {
      for (const r of c.rows) {
        for (const k of ['success','wallTimeMs','toolCalls','inputTokens','outputTokens','costUsd','contextPeak'] as const) {
          expect(r).toHaveProperty(k);
        }
      }
    }
  });

  it('renderCliSummary prints a pad-aligned harness table and comparison lines', () => {
    const results = [
      run('vessel', 'B001', metrics({ success: true, wallTimeMs: 200, costUsd: 0.02 })),
      run('dsh', 'B001', metrics({ success: false, wallTimeMs: 600, costUsd: 0.08 })),
    ];
    const rep = buildReportFromRunResults(results);
    const out = renderCliSummary(rep);
    expect(out).toContain('runs');
    expect(out).toContain('vessel');
    expect(out).toContain('dsh');
    expect(out).toContain('success');
    expect(out).toContain('B001:');
    expect(out).toContain('cost=');
    expect(out).toContain('wall=');
  });

  it('renderReportMarkdown renders totals + per-harness + cross-harness tables', () => {
    const results = [
      run('vessel', 'B001', metrics({ success: true })),
      run('dsh', 'B001', metrics({ success: true, costUsd: 0.07 })),
    ];
    const rep = buildReportFromRunResults(results);
    const md = renderReportMarkdown(rep);
    expect(md).toContain('## 总体汇总');
    expect(md).toContain('## 按 harness 汇总');
    expect(md).toContain('## 跨 harness 对比');
    expect(md).toContain('| vessel |');
    expect(md).toContain('| dsh |');
  });

  it('writeReportFiles persists markdown + JSON to the reports dir', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-report-'));
    try {
      const rep = buildReportFromRunResults([run('vessel', 'B001', metrics())], { source: 'persist-test' });
      const { mdPath, jsonPath } = writeReportFiles(rep, dir);
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(mdPath.endsWith('.md')).toBe(true);
      expect(jsonPath.endsWith('.json')).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as BenchmarkReport;
      expect(parsed.totals.runs).toBe(1);
      expect(fs.readFileSync(mdPath, 'utf8')).toContain('# Benchmark Report');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rowsFromLaneReport converts 082 run rows (with modelId) into ReportRows', () => {
    // simulate a minimal 082 report with one run row per model for a scenario
    const mkLane = (): Parameters<typeof rowsFromLaneReport>[0] => ({
      runId: 'real-model-lane-1',
      startedAt: '2026-09-08T00:00:00.000Z',
      finishedAt: '2026-09-08T00:00:01.000Z',
      durationMs: 1000,
      models: LANE_MODELS,
      scenarioCount: 1,
      scenarioIds: ['B001'],
      rows: [
        { modelId: 'deepseek-v4-pro', scenarioId: 'B001', tier: 'flash', status: 'passed', result: run('vessel', 'B001', metrics({ costUsd: 0.05 })) },
        { modelId: 'deepseek-v4-flash', scenarioId: 'B001', tier: 'flash', status: 'failed', result: run('vessel', 'B001', metrics({ success: false, costUsd: 0.02 })) },
        { modelId: 'deepseek-v4-pro', scenarioId: 'B016', tier: 'pro', status: 'skipped', note: 'feature-lane' }, // no result → dropped
      ],
      modelSummaries: [],
      degraded: false,
      reportMdPath: 'x.md',
      reportJsonPath: 'x.json',
    });
    const rows = rowsFromLaneReport(mkLane());
    expect(rows).toHaveLength(2); // skipped row has no result → excluded
    expect(rows.every((r) => r.harnessId === 'vessel')).toBe(true);
    expect(rows.map((r) => r.modelId).sort()).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro']);
    expect(rows.find((r) => r.modelId === 'deepseek-v4-pro')!.metrics.costUsd).toBeCloseTo(0.05, 5);
  });

  /**
   * 旧断言（逐字保留，语义只收紧不放宽）：**正常收尾**的行仍由 `metrics.success`
   * 决定 status；`success === false` 仍 `failed`；正常行不多出任何键。
   * 本卡新增的「回合未正常收尾」一族见 ① / ①b / ①c / ② / ③——旧断言锁的
   * 从来只是「正常行」这一族，现在它不再顺带锁死缺陷（异常行另有判别性用例）。
   */
  it('rowFromRunResult derives status from metrics.success（正常收尾族：旧断言逐字保留）', () => {
    const ok = rowFromRunResult(run('x', 'S1', metrics({ success: true })));
    expect(ok.status).toBe('passed');
    expect(rowFromRunResult(run('x', 'S1', metrics({ success: false }))).status).toBe('failed');
    expect('turnEndedAbnormally' in ok).toBe(false);
    expect('turnKind' in ok).toBe(false);
  });

  /**
   * ① 复现 + 判别性（本卡）：`metrics.success === true` 但**回合未正常收尾**
   * （熔断打死）的 run result，经聚合后不再是 `passed`，且原因在行上可见。
   *
   * 「删掉修复就红」：把 report.ts 里 `status` 的 `&& !turnEndedAbnormally` 还原成
   * 改动前的 `result.metrics.success ? 'passed' : 'failed'`，本用例的
   * `expect(row.status).not.toBe('passed')` / `expect(rep.totals.passed).toBe(0)`
   * 立刻红（收到 'passed' / 1）。
   */
  it('① 复现+修复：metrics.success===true 但回合未正常收尾 ⇒ 聚合行不再是 passed（原因可见）', () => {
    const killed = run('vessel', 'B001', metrics({ success: true, costUsd: 0.03 }));
    // 上游写入侧（contracts/vessel.ts:223-230）在熔断打死回合时的真实产物：
    // finalText 非空 ⇒ success=true，同时 notes 带 `turn ended kind=error`。
    killed.notes = [
      'turn ended kind=error：本 run 未正常收尾，finalText 是错误/半截文案而非模型答案（circuit breaker: same intent denied）',
    ];

    // —— ★复现：改动前 report.ts:62 是 `status: result.metrics.success ? 'passed' : 'failed'`，
    //    本输入下唯一取值就是 'passed'——这正是「被熔断打死的行仍显示 passed」。
    const legacyStatus: string = killed.metrics.success ? 'passed' : 'failed';
    expect(legacyStatus).toBe('passed');

    // —— ★修复后：状态本身 + 加法字段 + note 三重可见
    const row = rowFromRunResult(killed);
    expect(row.status).not.toBe('passed');
    expect(row.status).toBe('failed');
    expect(row.turnEndedAbnormally).toBe(true);
    expect(row.turnKind).toBe('error');
    expect(row.notes?.join(' | ')).toContain('未正常收尾');
    expect(row.notes?.join(' | ')).toContain('kind=error');
    expect(row.notes?.join(' | ')).toContain('same intent denied'); // 真实异常文案留痕
    expect(row.metrics.success).toBe(true); // 076 契约的指标口径未被改写，只是不再据此报 passed

    // —— 聚合 / 看板同样看不到这行 pass
    const rep = buildReport([row], 'abnormal-turn');
    expect(rep.totals.passed).toBe(0);
    expect(rep.totals.failed).toBe(1);
    expect(rep.totals.successRate).toBe(0);
    expect(rep.harnesses[0]!.passed).toBe(0);
    expect(rep.harnesses[0]!.failed).toBe(1);
    expect(renderCliSummary(rep)).toContain('1 runs, 0 passed, 1 failed');
    expect(renderReportMarkdown(rep)).toContain('| vessel | 1 | 0 | 1 | 0 | 0 |');
  });

  /**
   * ①b 复现 + 判别性：082 lane JSON 经 `rowsFromLaneReport`（即
   * `vessel bench-report --input <lane.json>`，cli.ts:2280-2282）聚合时，
   * 同样不再把「回合被打死」的行报成 passed。覆盖两条路：
   *  (a) 修复后的 lane JSON —— 行自带结构化字段 turnEndedAbnormally / turnKind；
   *  (b) 修复前的 lane JSON —— 只有 result.notes 的字符串标记、没有结构化字段。
   *
   * 「删掉修复就红」：还原 rowsFromLaneReport 的字段透传（只传 modelId）或
   * rowFromRunResult 的 `&& !turnEndedAbnormally` ⇒ 两行 status 都变回 'passed'。
   */
  it('①b 复现+修复：lane JSON 里回合被打死的行经聚合不再显示 passed（结构化字段 / 旧 JSON）', () => {
    const killedWithField = run('vessel', 'B001', metrics({ success: true, costUsd: 0.03 }));
    killedWithField.notes = ['turn ended kind=budget：本 run 未正常收尾，finalText 是错误/半截文案而非模型答案'];
    const killedLegacyJson = run('vessel', 'B001', metrics({ success: true, costUsd: 0.04 }));
    killedLegacyJson.notes = ['turn ended kind=interrupted：本 run 未正常收尾，finalText 是错误/半截文案而非模型答案'];

    const lane = laneReport([
      // (a) 修复后的 lane：status 已收紧为 failed，并带加法字段
      {
        modelId: 'deepseek-v4-pro',
        scenarioId: 'B001',
        tier: 'pro',
        status: 'failed',
        result: killedWithField,
        note: 'RunResult metrics.success=true，但回合未正常收尾（kind=budget）',
        turnEndedAbnormally: true,
        turnKind: 'budget',
      },
      // (b) 修复前的 lane JSON：行状态是旧实现写下的 passed，且没有结构化字段
      { modelId: 'deepseek-v4-flash', scenarioId: 'B001', tier: 'flash', status: 'passed', result: killedLegacyJson },
    ]);

    // —— ★复现：旧聚合丢弃 lane 行状态、只看 metrics.success ⇒ 两行都取 'passed'
    const legacyStatuses = lane.rows.map((r) => (r.result!.metrics.success ? 'passed' : 'failed'));
    expect(legacyStatuses).toEqual(['passed', 'passed']);

    const rows = rowsFromLaneReport(lane);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.status)).toEqual(['failed', 'failed']);
    expect(rows[0]!.turnEndedAbnormally).toBe(true);
    expect(rows[0]!.turnKind).toBe('budget'); // 结构化字段优先（值同源，不是从文案猜的）
    expect(rows[1]!.turnEndedAbnormally).toBe(true);
    expect(rows[1]!.turnKind).toBe('interrupted'); // 旧 JSON 无结构化字段 ⇒ 复用 abnormalTurnKindOf 兜底
    expect(rows.every((r) => r.harnessId === 'vessel')).toBe(true);
    expect(rows.every((r) => r.notes?.some((n) => n.includes('未正常收尾')))).toBe(true);

    const rep = buildReport(rows, 'lane-json');
    expect(rep.totals.passed).toBe(0);
    expect(rep.totals.failed).toBe(2);
  });

  /**
   * ①c 识别方式（结构化字段优先）：lane 行标了 `turnEndedAbnormally === true` 时，
   * 即使 `result.notes` **没有** `turn ended kind=` 文案，聚合侧也必须判非 passed。
   * 「删掉修复就红」：去掉 rowFromRunResult 的结构化字段分支（只留 abnormalTurnKindOf）
   * ⇒ 本用例红（收到 'passed'）。
   */
  it('①c 识别方式：lane 行结构化字段优先，notes 无字符串标记也判非 passed', () => {
    const plain = run('vessel', 'B003', metrics({ success: true }));
    expect(plain.notes).toBeUndefined(); // 确认没有可被正则命中的文案
    const rows = rowsFromLaneReport(
      laneReport([
        {
          modelId: 'deepseek-v4-pro',
          scenarioId: 'B003',
          tier: 'pro',
          status: 'failed',
          result: plain,
          turnEndedAbnormally: true,
          turnKind: 'interrupted',
        },
      ]),
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.turnEndedAbnormally).toBe(true);
    expect(rows[0]!.turnKind).toBe('interrupted');
    expect(rows[0]!.notes?.join(' | ')).toContain('未正常收尾'); // 结构化信号同样给出可见原因
  });

  /**
   * ② 负对照（最重要）：正常收尾 + `metrics.success === true` ⇒ 仍 `passed`，
   * 键集与取值**逐字不变**（防「把一切都判非 passed」）。
   * 「删/改坏就红」：status 写成无条件 'failed'、去掉 `metrics.success` 与项、
   * 或让无关 notes（`adapter note: …`）误触发 —— 本用例都会红。
   */
  it('② 负对照：正常收尾 + success===true ⇒ 仍 passed，键集与取值逐字不变', () => {
    const normal = run('vessel', 'B001', metrics({ success: true }));
    const row = rowFromRunResult(normal);
    expect(row.status).toBe('passed');
    // 键集**与顺序**逐字不变（旧实现 8 个键；加法字段的键根本不出现）
    expect(Object.keys(row)).toEqual(LEGACY_ROW_KEYS);
    expect('turnEndedAbnormally' in row).toBe(false);
    expect('turnKind' in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain('turnEndedAbnormally');
    expect(row).toEqual({
      harnessId: 'vessel',
      harnessVersion: '1.0.0',
      modelId: undefined,
      scenarioId: 'B001',
      metrics: normal.metrics,
      startedAt: '2026-09-08T00:00:00.000Z',
      status: 'passed',
      notes: undefined,
    });

    // 无关 notes（adapter 的 provenance 说明）不得误触发（与 lane 谓词同一口径）
    const unrelated = run('vessel', 'B001', metrics({ success: true }));
    unrelated.notes = ['adapter note: metric provenance approximation'];
    const unrelatedRow = rowFromRunResult(unrelated);
    expect(unrelatedRow.status).toBe('passed');
    expect('turnEndedAbnormally' in unrelatedRow).toBe(false);

    // 聚合与看板同样不变
    const rep = buildReport([row], 'negative-control');
    expect(rep.totals.passed).toBe(1);
    expect(rep.totals.failed).toBe(0);
    expect(rep.totals.successRate).toBe(1);
    expect(renderCliSummary(rep)).toContain('1 runs, 1 passed, 0 failed');
  });

  /**
   * ③ 既有行为不变：`metrics.success === false` ⇒ 仍 `failed`；
   * notes 逐字不变（新分支不接管这一族），且不多出任何键（row / lane 两条路同款）。
   */
  it('③ 既有行为：success===false ⇒ 仍 failed，notes 与键集逐字不变', () => {
    const failed = run('vessel', 'B002', metrics({ success: false }));
    failed.notes = ['adapter note: metric provenance approximation'];
    const row = rowFromRunResult(failed);
    expect(row.status).toBe('failed');
    expect(row.notes).toBe(failed.notes); // 同一引用：新分支未改写 success=false 一族
    expect(row.turnEndedAbnormally).toBeUndefined();
    expect(row.turnKind).toBeUndefined();
    expect('turnEndedAbnormally' in row).toBe(false);
    expect(Object.keys(row)).toEqual(LEGACY_ROW_KEYS);

    // lane 路径同款（含「success=false 的行不带异常标记」——标记语义是「正常返回但 kind≠success」）
    const rows = rowsFromLaneReport(
      laneReport([{ modelId: 'deepseek-v4-pro', scenarioId: 'B002', tier: 'pro', status: 'failed', result: failed }]),
    );
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.notes).toBe(failed.notes);
    expect('turnEndedAbnormally' in rows[0]!).toBe(false);
  });

  /**
   * ①d 复现 + 判别性（本卡）：`metrics.success === true` 但**回合未正常收尾**的行，
   * 在**对比表（JSON 行） / md / CLI** 三处都不得再呈现为成功；且 `turnKind` 与原因
   * 必须被渲染出来（本卡之前 md/CLI 完全不渲染 notes/turnKind）。
   *
   * 「删掉修复就红」（四处，逐处红）：
   *  - 删掉 `buildComparisons` 的条件展开 ⇒ `turnEndedAbnormally` 不出现 ⇒ 红；
   *  - `compareOkMark` 还原成 `r.success ? '✅' : '❌'` ⇒ md 里重现 ✅ ⇒ 红；
   *  - `compareCliVerdict` 还原成 `r.success ? 'OK' : 'FAIL'` ⇒ CLI 重现
   *    `  B001: vessel OK wall=…` ⇒ 红；
   *  - 删掉 md/CLI 里的异常原因渲染 ⇒ `turnKind=error` 在两面消失 ⇒ 红。
   */
  it('①d 复现+修复：异常收尾行在对比表/md/CLI 三处都不再呈现为成功，且 turnKind 可见', () => {
    const killed = run('vessel', 'B001', metrics({ success: true, costUsd: 0.03 }));
    // 写入侧（contracts/vessel.ts:223-230）在熔断打死回合时的真实产物。
    killed.notes = [
      'turn ended kind=error：本 run 未正常收尾，finalText 是错误/半截文案而非模型答案（circuit breaker: same intent denied）',
    ];
    const row = rowFromRunResult(killed);
    const rep = buildReport([row], 'abnormal-turn-overlay');

    // —— ★复现（改动前实现，逐字）：report.ts:390 `success: m.success`；
    //    :506 `r.success ? '✅' : '❌'`；:538 `r.success ? 'OK' : 'FAIL'`。
    //    本输入下三处唯一取值就是「绿」——这正是「被熔断打死的运行仍显示 ✅/OK」。
    const legacyCompareSuccess = row.metrics.success;
    const legacyMdOk = row.metrics.success ? '✅' : '❌';
    const legacyCliVerdict = row.metrics.success ? 'OK' : 'FAIL';
    expect(legacyCompareSuccess).toBe(true);
    expect(legacyMdOk).toBe('✅');
    expect(legacyCliVerdict).toBe('OK');
    expect(`| vessel |  | ${legacyMdOk} |`).toBe('| vessel |  | ✅ |');
    expect(`  B001: vessel ${legacyCliVerdict} wall=100ms`).toBe('  B001: vessel OK wall=100ms');

    // —— ① 对比表（JSON 数据面）：success 保持 076 指标口径（裁决 A，见
    //    ScenarioCompareRow.success），但该行自带加法字段 ⇒ 不再是一行"裸绿"。
    const cr = buildComparisons([row])[0]!.rows[0]!;
    expect(cr.success).toBe(true); // 原始指标口径未被改判
    expect(cr.turnEndedAbnormally).toBe(true);
    expect(cr.turnKind).toBe('error');
    expect(Object.keys(cr)).toEqual([...LEGACY_COMPARE_KEYS, 'turnEndedAbnormally', 'turnKind']);

    // —— ② md：ok 列不再是 ✅，且 turnKind 与原因文本被渲染出来
    const md = renderReportMarkdown(rep);
    expect(md).not.toContain('✅');
    expect(md).toContain('| vessel |  | ⚠ |');
    expect(md).toContain('> ⚠ vessel：回合未正常收尾（turnKind=error）');

    // —— ③ CLI 摘要：行首不再是 OK，且原因行紧随其后
    const cli = renderCliSummary(rep);
    expect(cli).not.toMatch(/\bOK\b/);
    expect(cli).toContain('  B001: vessel ⚠ wall=100ms in=50 out=20 cost=$0.03');
    expect(cli).toContain('    ⚠ vessel：回合未正常收尾（turnKind=error）');

    // 上一张卡已修的汇总口径仍不看绿（本卡不改它，只锁住没被改坏）
    expect(rep.totals.passed).toBe(0);
    expect(rep.totals.failed).toBe(1);
  });

  /**
   * ②d 负对照（最重要）：正常收尾 + `metrics.success === true` 的行，对比表键集、
   * **整篇 md**、CLI 对比行**逐字不变**（防「把一切都标异常」）。
   *
   * 「删/改坏就红」：无条件加 `turnEndedAbnormally`/`turnKind` ⇒ 键集比对红；
   * md 多加一行、改表头/分隔线/✅ ⇒ 整篇逐字比对红；CLI 多出原因行 ⇒ 行集合比对红。
   */
  it('②d 负对照：正常行 ⇒ 对比表键集 / 整篇 md / CLI 对比行逐字不变', () => {
    const normal = run('vessel', 'B001', metrics());
    const rep = buildReportFromRunResults([normal], { source: 'byte-identical' });
    rep.generatedAt = FROZEN_AT; // 只钉时间戳（md 里唯一非确定字段），其余全部逐字比对

    // 对比表：键集与顺序 = 旧 16 键，加法字段的键根本不出现
    const cr = buildComparisons(rep.rows)[0]!.rows[0]!;
    expect(Object.keys(cr)).toEqual(LEGACY_COMPARE_KEYS);
    expect('turnEndedAbnormally' in cr).toBe(false);
    expect('turnKind' in cr).toBe(false);
    expect(JSON.stringify(cr)).not.toContain('turnEndedAbnormally');

    // md：整篇逐字锁（汇总表 / 表头 / 分隔线 / ✅ / 末尾说明行一字不差）
    const md = renderReportMarkdown(rep);
    expect(md).toBe(NORMAL_REPORT_MD_LINES.join('\n') + '\n');
    expect(md).not.toContain('⚠');

    // CLI：对比行整行逐字锁，且没有多出任何原因行
    const cli = renderCliSummary(rep);
    expect(cli).not.toContain('⚠');
    expect(cli.split('\n').filter((l) => l.includes('B001:'))).toEqual([
      '  B001: vessel OK wall=100ms in=50 out=20 cost=$0.01',
    ]);
  });

  /**
   * ③b 既有行为不变：`metrics.success === false` 的行，呈现**只由 success 决定**——
   * 普通失败行与「失败 + 回合标记」的子族都仍渲染 `❌` / `FAIL`，不出现 `⚠`、不出现原因行
   * （标记作为**数据**仍在对比行上，供审计回读；只是不接管呈现）。
   *
   * 判别方式：把两行的回合标记从数据上抹掉后重建报告，md/CLI 必须**逐字相同** ⇒
   * 回合标记对 success=false 一族的呈现零影响。
   * 「改坏就红」：若 `mustNotDisplayAsSuccess` 去掉 `r.success === true` 这一半，
   * 本用例的 `not.toContain('⚠')` 与逐字相同断言立刻红。
   */
  it('③b 既有行为：metrics.success===false 的对比表/md/CLI 呈现逐字不变（❌/FAIL，无 ⚠）', () => {
    const plainFail = run('dsh', 'B002', metrics({ success: false, costUsd: 0.02 }));
    const killedFail = run('vessel', 'B002', metrics({ success: false, costUsd: 0.04 }));
    killedFail.notes = ['turn ended kind=interrupted：本 run 未正常收尾，finalText 是错误/半截文案而非模型答案'];
    const rows = [rowFromRunResult(plainFail), rowFromRunResult(killedFail)];

    // 数据面：两条都是 success=false；第二条带回合标记（本卡不改这一族的数据口径）
    expect(rows.map((r) => r.metrics.success)).toEqual([false, false]);
    expect(rows[0]!.turnEndedAbnormally).toBeUndefined();
    expect(rows[1]!.turnEndedAbnormally).toBe(true);
    expect(rows[1]!.turnKind).toBe('interrupted');
    expect(rows[1]!.notes).toBe(killedFail.notes); // 新分支未改写 success=false 一族

    const rep = buildReport(rows, 'existing-failure-presentation');
    rep.generatedAt = FROZEN_AT;
    const md = renderReportMarkdown(rep);
    const cli = renderCliSummary(rep);

    expect(md).toContain('| dsh |  | ❌ |');
    expect(md).toContain('| vessel |  | ❌ |');
    expect(md).not.toContain('⚠');
    expect(cli).not.toContain('⚠');
    expect(cli).not.toContain('turnKind');
    expect(cli.split('\n').filter((l) => l.includes('B002:'))).toEqual([
      '  B002: dsh FAIL wall=100ms in=50 out=20 cost=$0.02',
      '  B002: vessel FAIL wall=100ms in=50 out=20 cost=$0.04',
    ]);

    // 把回合标记从数据上抹掉 ⇒ 呈现逐字相同（回合标记不接管 success=false 一族的呈现）
    const stripped: ReportRow[] = rows.map((r) => {
      const copy: ReportRow = { ...r };
      delete copy.turnEndedAbnormally;
      delete copy.turnKind;
      return copy;
    });
    const repStripped = buildReport(stripped, 'existing-failure-presentation');
    repStripped.generatedAt = FROZEN_AT;
    expect(renderReportMarkdown(repStripped)).toBe(md);
    expect(renderCliSummary(repStripped)).toBe(cli);
  });
});