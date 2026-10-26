import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { runCandidates, type CandidateRun, type RunCandidatesOptions } from './index.js';
import * as runner from './runner.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
});

function options(runs = 2): RunCandidatesOptions {
  const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-candidates-'));
  tempDirs.push(reportsDir);
  return {
    scenarioId: 'B001', runs, repoRoot: REPO_ROOT, reportsDir,
    policyPath: path.join(REPO_ROOT, 'configs/policy.default.yaml'),
    behaviorIRPath: path.join(REPO_ROOT, 'configs/behavior.default.yaml'),
  };
}

describe('runCandidates', () => {
  it.each([0, 9, 1.5, -1, NaN, Infinity, 2.5])('rejects runs=%s synchronously before IO', runs => {
    const opts = options(runs);
    expect(() => runCandidates(opts)).toThrow(RangeError);
    expect(() => runCandidates(opts)).toThrow('1..8');
    expect(fs.readdirSync(opts.reportsDir)).toEqual([]);
  });

  it('runs two offline candidates with independent persisted reports and workspaces', async () => {
    const opts = options();
    const candidates: CandidateRun[] = await runCandidates(opts);
    expect(candidates.map(candidate => candidate.index)).toEqual([1, 2]);
    const reports = candidates.map(candidate => candidate.report);
    expect(new Set(reports.map(report => report.runId)).size).toBe(2);
    expect(new Set(reports.map(report => report.workspace)).size).toBe(2);
    const scenarioDir = path.join(opts.reportsDir, opts.scenarioId);
    expect(fs.readdirSync(scenarioDir).sort()).toEqual(reports.map(report => report.runId).sort());
    for (const report of reports) {
      const runDir = path.join(scenarioDir, report.runId);
      expect(report.scenarioId).toBe('B001');
      expect(report.success).toBe(true);
      expect(report.workspace).toBe(path.join(runDir, 'workspace'));
      expect(fs.statSync(report.workspace).isDirectory()).toBe(true);
      expect(path.dirname(report.reportPath)).toBe(runDir);
      expect(fs.statSync(report.reportPath).isFile()).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'))).toMatchObject({
        scenarioId: 'B001', runId: report.runId,
      });
    }
  });

  it.each([1, 8])('accepts the boundary runs=%s and forwards options sequentially', async runs => {
    const opts = {
      ...options(runs), provider: new MockProvider([]), model: 'candidate-model',
      nativeSandbox: { isAvailable: async () => false, execute: vi.fn() },
    };
    const report = {} as CandidateRun['report'];
    let finishFirst!: (value: CandidateRun['report']) => void;
    const scenario = vi.spyOn(runner, 'runScenario')
      .mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }))
      .mockResolvedValue(report);
    const pending = runCandidates(opts);
    expect(scenario).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(scenario).toHaveBeenCalledTimes(1);
    finishFirst(report);
    const candidates = await pending;
    expect(candidates.map(candidate => candidate.index)).toEqual(Array.from({ length: runs }, (_, i) => i + 1));
    expect(scenario).toHaveBeenCalledTimes(runs);
    const { runs: _runs, ...expected } = opts;
    for (const [actual] of scenario.mock.calls) expect(actual).toEqual(expected);
  });

  it('propagates a second runScenario rejection unchanged and stops before the third', async () => {
    const sentinel = new Error('second scenario failed');
    const scenario = vi.spyOn(runner, 'runScenario')
      .mockResolvedValueOnce({} as CandidateRun['report'])
      .mockRejectedValueOnce(sentinel);
    await expect(runCandidates(options(3))).rejects.toBe(sentinel);
    expect(scenario).toHaveBeenCalledTimes(2);
  });
});
