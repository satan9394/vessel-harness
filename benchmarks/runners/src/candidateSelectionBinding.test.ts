import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectCandidate } from '@vessel/engine';
import { reviewFromReport, selectFromCandidates, type CandidateRun } from './index.js';
import type { AssertResult } from './types.js';

vi.mock('@vessel/engine', async importOriginal => {
  const engine = await importOriginal<typeof import('@vessel/engine')>();
  return { ...engine, selectCandidate: vi.fn(engine.selectCandidate) };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function run(id: string, results: AssertResult['result'][]): CandidateRun {
  return {
    index: 1,
    report: {
      scenarioId: 'B001', runId: id, success: false,
      asserts: results.map((result, index) => ({
        id: `a${index + 1}`, type: 'file_exists', target: 'output.txt', result, evidence: {},
      })),
      metrics: {}, finalText: `output ${id}`,
      startedAt: '2026-10-26T00:00:00Z', finishedAt: '2026-10-26T00:00:01Z', durationMs: 1000,
      workspace: `unused/${id}/workspace`, reportPath: `unused/${id}/report.json`,
      sessionLog: `unused/${id}/session.jsonl`,
    },
  };
}

function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freeze(child);
  }
}

describe('reviewFromReport', () => {
  it.each<{ results: AssertResult['result'][]; verdict: string; reason: string }>([
    { results: [], verdict: 'not_met', reason: 'no assertions recorded' },
    { results: ['fail', 'pass', 'fail'], verdict: 'not_met', reason: 'failed: a1, a3' },
    { results: ['fail', 'fail', 'fail', 'fail', 'fail'], verdict: 'not_met', reason: 'failed: a1, a2, a3, a4, a5' },
    { results: ['fail', 'fail', 'fail', 'fail', 'fail', 'fail'], verdict: 'not_met', reason: 'failed: a1, a2, a3, a4, a5 …' },
    { results: ['pass', 'pass'], verdict: 'met', reason: '2/2 asserts passed' },
    { results: ['pass', 'skip', 'pass'], verdict: 'met', reason: '2/3 asserts passed (1 skipped)' },
    { results: ['skip', 'skip'], verdict: 'met', reason: '0/2 asserts passed (2 skipped)' },
  ])('$results yields $reason', ({ results, verdict, reason }) => {
    expect(reviewFromReport(run('candidate', results))).toEqual({ candidateId: 'candidate', verdict, reason });
  });
});

describe('selectFromCandidates', () => {
  it('maps every report and forwards reviews and seed to the existing selector', () => {
    const runs = [run('pass-1', ['pass']), run('pass-2', ['pass']), run('fail', ['fail'])];
    const selected = selectFromCandidates(runs, 'seed-a');
    expect(selectCandidate).toHaveBeenCalledExactlyOnceWith({
      candidates: runs.map(({ report }) => ({
        id: report.runId, output: report.finalText, artifactPaths: [report.workspace, report.reportPath],
      })),
      reviews: runs.map(reviewFromReport), seed: 'seed-a',
    });
    expect(['pass-1', 'pass-2']).toContain(selected.chosen);
    expect(selected.why).toContain('1 not_met');
    expect(selectFromCandidates(runs, 'seed-a')).toEqual(selected);
    expect(selectFromCandidates(runs, 'seed-b').aliases).not.toEqual(selected.aliases);
  });

  it('selects nothing when every report fails, even with empty final text', () => {
    const runs = [run('fail-1', ['fail']), run('fail-2', ['fail'])];
    for (const candidate of runs) candidate.report.finalText = '';
    const selected = selectFromCandidates(runs, 'seed');
    expect(selected.chosen).toBeNull();
    expect(selected.why).toContain('0 met');
    expect(selected.why).toContain('2 not_met');
    expect(selected.discarded).toEqual([]);
  });

  it('does not mutate frozen inputs or print', () => {
    const runs = [run('pass', ['pass', 'skip']), run('fail', ['fail']), run('empty', [])];
    const before = structuredClone(runs);
    freeze(runs);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map(method => vi.spyOn(console, method).mockImplementation(() => {}));
    for (const candidate of runs) reviewFromReport(candidate);
    selectFromCandidates(runs, 'seed');
    expect(runs).toEqual(before);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
