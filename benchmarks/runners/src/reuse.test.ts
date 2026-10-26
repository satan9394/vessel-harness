import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as engine from '@vessel/engine';
import { assessRunReusability } from './reuse.js';

describe('run reuse readiness', () => {
  let root: string;
  let run: string;
  function json(name: string, value: unknown): void { fs.writeFileSync(path.join(run, name), JSON.stringify(value)); }
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-reuse-'));
    run = path.join(root, 'reports/B001/run_1_aa');
    fs.mkdirSync(path.join(root, 'packages/example/src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages/example/src/index.ts'), 'export const n = 1;');
    fs.mkdirSync(path.join(run, 'workspace'), { recursive: true });
    json('summary.json', { success: true });
    json('.run-complete.json', { version: 1, fingerprint: engine.computeHarnessFingerprint(root).value });
  });
  afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  it('accepts complete matching runs and computes the fingerprint exactly once', () => {
    fs.writeFileSync(path.join(run, 'report.jsonl'), 'report\n');
    fs.writeFileSync(path.join(run, 'session.jsonl'), 'session\n');
    json('summary.json', { success: true, reportPath: path.relative(root, path.join(run, 'report.jsonl')), sessionLog: path.join(run, 'session.jsonl') });
    const compute = vi.spyOn(engine, 'computeHarnessFingerprint');
    expect(assessRunReusability(run, root)).toEqual({ ok: true, reasons: [] });
    expect(compute).toHaveBeenCalledExactlyOnceWith(root);
  });

  it('rejects a changed harness fingerprint', () => {
    fs.writeFileSync(path.join(root, 'packages/example/src/index.ts'), 'export const n = 2;');
    expect(assessRunReusability(run, root)).toEqual({ ok: false, reasons: ['fingerprint mismatch'] });
  });

  it('reports missing summaries and unsuccessful runs', () => {
    fs.unlinkSync(path.join(run, 'summary.json'));
    expect(assessRunReusability(run, root).reasons).toContain('missing summary.json');
    json('summary.json', { success: false });
    expect(assessRunReusability(run, root).reasons).toContain('summary.json success must be true');
    json('summary.json', []);
    expect(assessRunReusability(run, root).reasons).toContain('summary.json must be an object');
  });

  it('requires declared artifacts to exist and be nonempty, while old reports can omit them', () => {
    json('summary.json', { success: true, reportPath: 'missing.jsonl', sessionLog: path.join(run, 'empty.jsonl') });
    fs.writeFileSync(path.join(run, 'empty.jsonl'), '');
    expect(assessRunReusability(run, root).reasons).toEqual(['missing reportPath: missing.jsonl', `sessionLog must be a nonempty file: ${path.join(run, 'empty.jsonl')}`]);
    json('summary.json', { success: true });
    expect(assessRunReusability(run, root)).toEqual({ ok: true, reasons: [] });
  });

  it('turns marker parse failures into reasons without throwing', () => {
    fs.writeFileSync(path.join(run, '.run-complete.json'), '{broken');
    const result = assessRunReusability(run, root);
    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/^read: /);
    expect(result.reasons[0]).toMatch(/JSON|property/i);
  });

  it('accumulates invalid marker and workspace checks and handles a missing run', () => {
    json('.run-complete.json', { version: 2, fingerprint: '' });
    fs.rmdirSync(path.join(run, 'workspace'));
    expect(assessRunReusability(run, root).reasons).toEqual([
      '.run-complete.json version must be 1', '.run-complete.json fingerprint must be nonempty', 'fingerprint mismatch', 'missing workspace/',
    ]);
    expect(assessRunReusability(path.join(root, 'missing'), root).reasons).toEqual(['missing runDir', 'missing summary.json', 'missing .run-complete.json', 'missing workspace/']);
  });
});
