import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as engine from '@vessel/engine';
import { findReusableRun, listCompletedRuns } from './runCache.js';

describe('completed run lookup', () => {
  let root: string;
  let reports: string;
  const older = '2026-10-24T15:00:00.000Z';
  const newer = '2026-10-25T15:00:00.000Z';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-run-cache-'));
    reports = path.join(root, 'reports');
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function marker(runId: string, value: unknown): string {
    const dir = path.join(reports, 'B001', runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.run-complete.json'), JSON.stringify(value), 'utf8');
    return dir;
  }

  it('lists two valid runs newest first and skips a damaged marker', () => {
    marker('run_1_aa', { version: 1, fingerprint: 'B', fileCount: 4, finishedAt: older });
    marker('run_2_bb', { version: 1, fingerprint: 'A', fileCount: 5, finishedAt: newer });
    const broken = marker('run_3_cc', {});
    fs.writeFileSync(path.join(broken, '.run-complete.json'), '{', 'utf8');
    expect(listCompletedRuns(reports, 'B001').map((run) => [run.runId, run.fingerprint])).toEqual([
      ['run_2_bb', 'A'], ['run_1_aa', 'B'],
    ]);
  });

  it('computes the identity once, selects the latest match and rejects changed source', () => {
    const src = path.join(root, 'packages', 'fixture', 'src');
    fs.mkdirSync(src, { recursive: true });
    const source = path.join(src, 'index.ts');
    fs.writeFileSync(source, 'export const value = 1;\n', 'utf8');
    const fingerprint = engine.computeHarnessFingerprint(root);
    marker('run_1_aa', { version: 1, fingerprint: fingerprint.value, fileCount: 1, finishedAt: older });
    marker('run_2_bb', { version: 1, fingerprint: fingerprint.value, fileCount: 1, finishedAt: newer });
    const compute = vi.spyOn(engine, 'computeHarnessFingerprint');
    expect(findReusableRun(reports, 'B001', root)?.runId).toBe('run_2_bb');
    expect(compute).toHaveBeenCalledExactlyOnceWith(root);
    fs.writeFileSync(source, 'export const value = 2;\n', 'utf8');
    compute.mockClear();
    expect(findReusableRun(reports, 'B001', root)).toBeNull();
    expect(compute).toHaveBeenCalledExactlyOnceWith(root);
  });

  it('returns empty results for missing directories, empty directories and empty markers', () => {
    expect(listCompletedRuns(reports, 'B001')).toEqual([]);
    expect(findReusableRun(reports, 'B001', root)).toBeNull();
    fs.mkdirSync(path.join(reports, 'B001'), { recursive: true });
    expect(listCompletedRuns(reports, 'B001')).toEqual([]);
    expect(findReusableRun(reports, 'B001', root)).toBeNull();
    marker('run_1_aa', {});
    expect(listCompletedRuns(reports, 'B001')).toEqual([]);
    expect(findReusableRun(reports, 'B001', root)).toBeNull();
  });

  it('uses the directory name as runId and resolves an absolute dir', () => {
    const dir = marker('run_1_aa', { version: 1, fingerprint: 'A', fileCount: 1, finishedAt: newer });
    const relativeReports = path.relative(process.cwd(), reports);
    expect(listCompletedRuns(relativeReports, 'B001')).toEqual([
      { scenarioId: 'B001', runId: 'run_1_aa', dir: path.resolve(dir), fingerprint: 'A', fileCount: 1, finishedAt: newer },
    ]);
  });

  it('skips missing files, unsupported versions and invalid field types or values', () => {
    const valid = { version: 1, fingerprint: 'A', fileCount: 1, finishedAt: newer };
    const invalid: unknown[] = [
      null, [], { ...valid, version: 2 }, { ...valid, fingerprint: 1 }, { ...valid, fingerprint: '' },
      { ...valid, fileCount: '1' }, { ...valid, fileCount: -1 }, { ...valid, fileCount: 1.5 },
      { ...valid, finishedAt: 1 }, { ...valid, finishedAt: 'not a date' },
      { ...valid, finishedAt: '2026-99-99T00:00:00.000Z' },
    ];
    invalid.forEach((value, index) => marker(`run_${index}_aa`, value));
    fs.mkdirSync(path.join(reports, 'B001', 'run_100_aa'));
    expect(listCompletedRuns(reports, 'B001')).toEqual([]);
  });
});
