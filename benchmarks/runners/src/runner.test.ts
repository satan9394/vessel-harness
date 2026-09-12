import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach } from 'vitest';
import { runScenario, loadManifest } from './runner.js';
import { runAssert } from './asserts.js';

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
