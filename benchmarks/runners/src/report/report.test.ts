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
});