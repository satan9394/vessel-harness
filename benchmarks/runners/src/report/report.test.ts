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
import { LANE_MODELS } from '../lane/real-model-lane.js';

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

  it('rowFromRunResult derives status from metrics.success', () => {
    expect(rowFromRunResult(run('x', 'S1', metrics({ success: true }))).status).toBe('passed');
    expect(rowFromRunResult(run('x', 'S1', metrics({ success: false }))).status).toBe('failed');
  });
});