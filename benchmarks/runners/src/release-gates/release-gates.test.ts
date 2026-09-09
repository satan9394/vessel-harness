import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  GATE_DEFINITIONS,
  GATE_ORDER,
  judgeBuild,
  judgeUnit,
  judgeRealModelLane,
  judgeRealModelLaneWithBilling,
  judgeRealModelLaneWithNonConvergence,
  isModelNonConvergentLane,
  judgeScenarioRuns,
  judgeSoakResume,
  judgePackagingProbe,
  judgeUxSmoke,
} from './gates.js';
import {
  releaseStatus,
  renderReleaseMarkdown,
  runReleaseGates,
  writeReleaseReportFiles,
  type ReleaseGateResult,
  type ReleaseReport,
} from './runner.js';
import type { GateExecutor } from './types.js';

/** A deterministic mock gate executor (fully injectable — no real commands). */
function mockExecutor(id: GateExecutor['gate']['id'], status: 'pass' | 'fail' | 'pending'): GateExecutor {
  return {
    gate: GATE_DEFINITIONS.find((g) => g.id === id)!,
    run: async () => ({
      status,
      evidence: { summary: `${id} ${status}`, detail: [`mock ${id}`] },
      ...(status === 'pending' ? { note: 'env not available' } : {}),
    }),
  };
}

const allPass = () => GATE_ORDER.map((id) => mockExecutor(id, 'pass'));

describe('gate criteria judges (tasks 084) — pure, no commands', () => {
  it('judgeBuild passes only on tsc exit 0', () => {
    expect(judgeBuild({ code: 0, stdout: '', stderr: '' }).status).toBe('pass');
    expect(judgeBuild({ code: 1, stdout: 'error TS2322', stderr: '' }).status).toBe('fail');
    const fail = judgeBuild({ code: 1, stdout: '', stderr: '' });
    expect(fail.evidence.summary).toContain('tsc -b exit 1');
    expect(fail.evidence.detail).toContain('tsc exit=1');
  });

  it('judgeUnit passes only on exit 0 + no failure marker', () => {
    const ok = 'Test Files  10 passed (120 tests)';
    expect(judgeUnit({ code: 0, stdout: ok, stderr: '' }).status).toBe('pass');
    // a failing test is surfaced as fail
    expect(judgeUnit({ code: 1, stdout: '+ some failing tests', stderr: 'FAIL' }).status).toBe('fail');
    expect(judgeUnit({ code: 0, stdout: 'FAIL  gates.test.ts', stderr: '' }).status).toBe('fail');
    // exit 0 but a "failed" line → still fail (never a silent pass)
    expect(judgeUnit({ code: 0, stdout: 'Test Files  2 failed', stderr: '' }).status).toBe('fail');
  });

  it('judgeRealModelLane : no provider → pending; clean run → pass; failed row → fail', () => {
    expect(judgeRealModelLane({ rowCount: 0, passed: 0, failed: 0, pendingEnv: 2, degraded: true }).status).toBe('pending');
    expect(judgeRealModelLane({ rowCount: 8, passed: 8, failed: 0, pendingEnv: 0, degraded: false }).status).toBe('pass');
    expect(judgeRealModelLane({ rowCount: 8, passed: 7, failed: 1, pendingEnv: 0, degraded: false }).status).toBe('fail');
  });

  it('judgeRealModelLaneWithBilling : 余额不足阻塞 → pending（不误判 fail，不伪造 pass）', () => {
    const balanceNote = 'Model call failed: OpenAI-compatible 401 Unauthorized: {"type":"error","error":{"type":"CreditsError","message":"Insufficient balance."}}';
    const regNote = 'model returned malformed JSON';
    const v = judgeRealModelLaneWithBilling({
      rowCount: 13, passed: 0, failed: 13, pendingEnv: 0, degraded: false,
      failedNotes: [balanceNote, balanceNote],
    });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.note).toContain('余额不足');
    // 真实回归失败（非 balance）仍应 fail
    const reg = judgeRealModelLaneWithBilling({
      rowCount: 13, passed: 0, failed: 13, pendingEnv: 0, degraded: false,
      failedNotes: [regNote],
    });
    expect(reg.status).toBe('fail');
    // 空参退化到原 judge
    expect(judgeRealModelLaneWithBilling({ rowCount: 8, passed: 8, failed: 0, pendingEnv: 0, degraded: false, failedNotes: [] }).status).toBe('pass');
  });

  it('judgeRealModelLaneWithNonConvergence : 模型未收敛 → pending；其它失败仍 fail（task 102）', () => {
    const nonConvergent =
      'RunResult success=false：finalText 为空（toolCalls=65，多为模型未在步数/预算内收敛）';
    const v = judgeRealModelLaneWithNonConvergence({
      rowCount: 14, passed: 8, failed: 2, pendingEnv: 0, degraded: false,
      failedNotes: [nonConvergent, nonConvergent],
    });
    expect(v.status).toBe('pending');
    expect(v.pending).toBe(true);
    expect(v.note).toContain('步预算');
    expect(v.evidence.detail).toContain('passed=8');
    // 非「未收敛」的失败仍按原语义 fail（不掩盖真实回归）
    expect(
      judgeRealModelLaneWithNonConvergence({
        rowCount: 8, passed: 7, failed: 1, pendingEnv: 0, degraded: false,
        failedNotes: ['model returned malformed JSON'],
      }).status,
    ).toBe('fail');
    // 无失败 → pass 原样透传
    expect(
      judgeRealModelLaneWithNonConvergence({ rowCount: 8, passed: 8, failed: 0, pendingEnv: 0, degraded: false, failedNotes: [] }).status,
    ).toBe('pass');
    expect(isModelNonConvergentLane([nonConvergent])).toBe(true);
    expect(isModelNonConvergentLane(['fixture not found: B009'])).toBe(false);
  });

  it('judgeScenarioRuns : all pass → pass; any fail → fail', () => {
    expect(judgeScenarioRuns({ scenarioIds: ['B001', 'B002'], passed: [true, true] }).status).toBe('pass');
    expect(judgeScenarioRuns({ scenarioIds: ['B001', 'B002'], passed: [true, false] }).status).toBe('fail');
  });

  it('judgeSoakResume enforces the 063/064 resume invariants', () => {
    const ok = { pauseResumeCycles: 1, tempResidue: 0, resumeProducedIteration: true, countConsistent: true };
    expect(judgeSoakResume(ok).status).toBe('pass');
    expect(judgeSoakResume({ ...ok, tempResidue: 2 }).status).toBe('fail');
    expect(judgeSoakResume({ ...ok, resumeProducedIteration: false }).status).toBe('fail');
  });

  it('judgeUxSmoke / judgePackagingProbe : missing tooling → explicit pending (never silent pass)', () => {
    // probe failed → pending
    expect(judgeUxSmoke({ webDistPresent: false, probeFailed: true }).status).toBe('pending');
    expect(judgeUxSmoke({ webDistPresent: true, probeFailed: false }).status).toBe('pass');
    expect(judgePackagingProbe({ rootHasDist: false, entryExists: false, probeFailed: true }).status).toBe('pending');
    expect(judgePackagingProbe({ rootHasDist: true, entryExists: true, probeFailed: false }).status).toBe('pass');
    expect(judgePackagingProbe({ rootHasDist: true, entryExists: false, probeFailed: false }).status).toBe('fail');
    const pending = judgeUxSmoke({ webDistPresent: false, probeFailed: true });
    expect(pending.note).toBeTruthy(); // environment annotation required
  });
});

describe('gate definitions (tasks 084) — §21 registry', () => {
  it('defines exactly the 8 §21 gates in the documented order', () => {
    expect(GATE_ORDER).toEqual([
      'build', 'unit', 'deterministic-bench', 'real-model-bench',
      'safety', 'resume', 'ux-smoke', 'packaging',
    ]);
    expect(GATE_DEFINITIONS).toHaveLength(8);
    GATE_DEFINITIONS.forEach((g, i) => expect(g.position).toBe(i + 1));
    expect(GATE_DEFINITIONS.map((g) => g.criterion.length)).not.toContain(0);
  });
});

describe('real gate executors assemble + env-sensitive gates pend (tasks 084)', () => {
  it('buildReleaseGateExecutors yields 8 gates in §21 order', async () => {
    const { buildReleaseGateExecutors } = await import('./gates.js');
    const executors = buildReleaseGateExecutors();
    expect(executors).toHaveLength(8);
    expect(executors.map((e) => e.gate.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // no duplicate gate ids
    expect(new Set(executors.map((e) => e.gate.id)).size).toBe(8);
  });

  it('build/unit pass on an exit-0 command; ux-smoke & packaging pend when tooling absent', async () => {
    const { buildReleaseGateExecutors } = await import('./gates.js');
    const executors = buildReleaseGateExecutors({
      // point the probe at a nonexistent workdir so neither dist nor apps/web/dist exists
      webDistRoot: 'does-not-exist/dist',
      packageEntry: 'does-not-exist/index.js',
    });
    const ctx = {
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-ux'),
      exec: async () => ({ code: 0, stdout: 'tsc ok\n', stderr: '' }),
    };
    const build = executors.find((e) => e.gate.id === 'build')!;
    const unit = executors.find((e) => e.gate.id === 'unit')!;
    const ux = executors.find((e) => e.gate.id === 'ux-smoke')!;
    const pkg = executors.find((e) => e.gate.id === 'packaging')!;
    expect((await build.run(ctx)).status).toBe('pass');
    expect((await unit.run(ctx)).status).toBe('pass');
    expect((await ux.run(ctx)).status).toBe('pending');
    expect((await pkg.run(ctx)).status).toBe('pending');
  });

  it('real-model-bench: resolver 能解析 provider → 跑 lane（不再误判 degraded）；resolver 无 key → pending', async () => {
    const { buildReleaseGateExecutors } = await import('./gates.js');
    const { MockProvider } = await import('@vessel/llm');
    // 用 mock provider resolver（有 provider → anyAvailable=true → 跑 lane）
    const executors = buildReleaseGateExecutors({
      providerResolver: async () =>
        new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: 'G' } }], { model: 'm' }),
      models: [{ id: 'opencode-go:mimo-v2.5', displayName: 'OpenCode Go mimo-v2.5', tier: 'flash', defaultModel: 'mimo-v2.5' }],
    });
    const real = executors.find((e) => e.gate.id === 'real-model-bench')!;
    const ctx = {
      repoRoot: os.tmpdir(),
      reportsDir: path.join(os.tmpdir(), 'rg-real'),
      exec: async () => ({ code: 0, stdout: '', stderr: '' }),
    };
    // 无真实 fixtures 目录 → lane 行会 failed（fixture missing），但 gate 不应退化为 degraded/pending-无provider
    const verdict = await real.run(ctx);
    // provider 已解析 → 不是「无 provider」pending
    expect(verdict.evidence.summary).not.toContain('未运行（无 credential/provider）');
    // 无 key resolver → pending（原语义保持）
    const executorsNoKey = buildReleaseGateExecutors({
      providerResolver: async () => null,
      models: [{ id: 'x', displayName: 'X', tier: 'flash', defaultModel: 'm' }],
    });
    const realNoKey = executorsNoKey.find((e) => e.gate.id === 'real-model-bench')!;
    const noKeyVerdict = await realNoKey.run(ctx);
    expect(noKeyVerdict.status).toBe('pending');
    expect(noKeyVerdict.note).toContain('无真实 API 凭据');
  });
});

describe('runner: sequential order + aggregation + overall verdict (tasks 084)', () => {
  it('runs every gate in §21 order and aggregates schemaVersion/gates/totals (ready)', async () => {
    const report = await runReleaseGates(allPass(), { repoRoot: os.tmpdir(), reportsDir: os.tmpdir(), version: 'v1.0.0' }, async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(report.schemaVersion).toBe(1);
    expect(report.version).toBe('v1.0.0');
    expect(report.gates).toHaveLength(8);
    expect(report.gates.map((g) => g.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(report.status).toBe('ready');
    expect(report.totals).toMatchObject({ pass: 8, fail: 0, pending: 0 });
  });

  it('overall verdict: any fail → blocked (even with pending)', () => {
    const gates: ReleaseGateResult[] = GATE_ORDER.map((id) => ({
      id, name: id, position: GATE_ORDER.indexOf(id) + 1, criterion: '',
      status: 'pass', evidence: { summary: '' }, durationMs: 0,
    }));
    expect(releaseStatus([...gates.map((g) => ({ ...g }))])).toBe('ready');
    expect(releaseStatus(gates.map((g) => (g.id === 'build' ? { ...g, status: 'fail' as const } : g)))).toBe('blocked');
    expect(releaseStatus(gates.map((g) => (g.id === 'build' ? { ...g, status: 'pending' as const } : g)))).toBe('partial');
    // blocked wins over pending
    expect(
      releaseStatus(
        gates.map((g) =>
          g.id === 'build' ? { ...g, status: 'fail' as const } : g.id === 'unit' ? { ...g, status: 'pending' as const } : g,
        ),
      ),
    ).toBe('blocked');
  });

  it('a gate executor that throws becomes a fail verdict (never swallowed)', async () => {
    const executors = GATE_ORDER.map((id) => mockExecutor(id, 'pass'));
    executors.splice(
      executors.findIndex((e) => e.gate.id === 'build'),
      1,
      {
        gate: executors.find((e) => e.gate.id === 'build')!.gate,
        run: async () => {
          throw new Error('boom');
        },
      },
    );
    const report = await runReleaseGates(executors, { repoRoot: os.tmpdir(), reportsDir: os.tmpdir() }, async () => ({ code: 0, stdout: '', stderr: '' }));
    expect(report.gates.find((g) => g.id === 'build')!.status).toBe('fail');
    expect(report.status).toBe('blocked');
  });

  it('renderReleaseMarkdown renders a human-readable doc with status/totals/env notes', async () => {
    const executors = [
      mockExecutor('build', 'pass'),
      mockExecutor('real-model-bench', 'pending'),
      mockExecutor('packaging', 'pending'),
    ];
    const report = await runReleaseGates(executors, { repoRoot: os.tmpdir(), reportsDir: os.tmpdir(), version: 'v0.1' }, async () => ({ code: 0, stdout: '', stderr: '' }));
    const md = renderReleaseMarkdown(report);
    expect(md).toContain('# Release Report');
    expect(md).toContain('PARTIAL');
    expect(md).toContain('real-model-bench');
    expect(md).toContain('环境注解');
    expect(md).toContain('env not available');
    expect(md).toContain('pass');
  });

  it('writeReleaseReportFiles persists release-report.md + .json (084 output), JSON round-trips', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-rg-'));
    try {
      const report: ReleaseReport = await runReleaseGates(allPass(), { repoRoot: os.tmpdir(), reportsDir: dir, version: 'v1.0.0' }, async () => ({ code: 0, stdout: '', stderr: '' }));
      const { mdPath, jsonPath } = writeReleaseReportFiles(report, dir);
      expect(fs.existsSync(mdPath)).toBe(true);
      expect(fs.existsSync(jsonPath)).toBe(true);
      expect(jsonPath.endsWith('release-report.json')).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as ReleaseReport;
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.status).toBe('ready');
      expect(parsed.gates).toHaveLength(8);
      expect(fs.readFileSync(mdPath, 'utf8')).toContain('# Release Report');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});