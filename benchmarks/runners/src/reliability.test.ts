import { describe, expect, it, vi } from 'vitest';
import { categories, evaluate, fixtures, main, type Suite } from './reliability.js';

function passingSuites(): Suite[] {
  return fixtures.map(f => ({ name: `C:/repo/${f.source}`, assertionResults: [{ title: f.title, fullName: `suite ${f.title}`, status: 'passed' }] }));
}

describe('ARCH-09 reliability evidence gate', () => {
  it('maps every fixture to exactly one current passing assertion and all seven categories', () => {
    const result = evaluate(fixtures, passingSuites());
    expect(result.errors).toEqual([]);
    expect(result.results.every(f => f.outcome === 'passed')).toBe(true);
    expect(Object.keys(result.coverage)).toEqual([...categories]);
    expect(Object.values(result.coverage).every(ids => ids.length > 0)).toBe(true);
  });

  it('rejects missing categories even when the total fixture count is sufficient', () => {
    const result = evaluate(fixtures.filter(f => f.category !== 'event-replay'), passingSuites());
    expect(result.results).toHaveLength(13);
    expect(result.errors).toContain('缺少类别 event-replay');
  });

  it.each(['pending', 'skipped', 'failed'])('never counts %s as category coverage', status => {
    const suites = passingSuites();
    suites[0]!.assertionResults[0]!.status = status;
    const result = evaluate(fixtures, suites);
    expect(result.results[0]).toMatchObject({ outcome: 'failed', reason: `Assertion status: ${status}` });
    expect(result.coverage.retry).toEqual([]);
    expect(result.errors).toContain('缺少类别 retry');
  });

  it('rejects missing, duplicate and wrong-source assertions', () => {
    const suites = passingSuites();
    suites[0]!.name = 'C:/another/unrelated.test.ts';
    suites[1]!.assertionResults.push({ ...suites[1]!.assertionResults[0]! });
    const result = evaluate(fixtures, suites);
    expect(result.results[0]).toMatchObject({ outcome: 'failed', reason: 'Expected one assertion, found 0' });
    expect(result.results[1]).toMatchObject({ outcome: 'failed', reason: 'Expected one assertion, found 2' });
  });

  it('rejects an empty catalogue and duplicate fixture ids', () => {
    expect(evaluate([], []).errors).toContain('Expected 10–20 fixtures');
    expect(evaluate([...fixtures, fixtures[0]!], passingSuites()).errors).toContain('Duplicate fixture id');
  });

  it('refuses live and unknown arguments before any execution', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(main(['--live'])).toBe(1);
      expect(main(['--unknown'])).toBe(1);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Offline-only'));
    } finally { log.mockRestore(); }
  });
});
