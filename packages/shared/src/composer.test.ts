import { describe, expect, it } from 'vitest';
import type { BehaviorEntry } from './behavior.js';
import { behaviorConformanceVerdict, detectBehaviorConflicts, type BehaviorConformanceEntry } from './composer.js';

function entry(overrides: Partial<BehaviorEntry>): BehaviorEntry {
  return { id: 'e1', class: 'guidance', channel: 'prompt_guidance', render: 'Be concise.', ...overrides };
}

describe('behavior composer conflict detection', () => {
  it('flags duplicate ids as an activation-blocking error', () => {
    const conflicts = detectBehaviorConflicts([entry({ id: 'dup' }), entry({ id: 'dup', render: 'Other.' })]);
    expect(conflicts).toContainEqual(expect.objectContaining({ code: 'duplicate_id', severity: 'error' }));
  });

  it('flags a runtime constraint without policy_ref and a critical rule without assertions', () => {
    const conflicts = detectBehaviorConflicts([
      entry({ id: 'r1', class: 'guidance', channel: 'runtime_policy', policy_ref: '' }),
      entry({ id: 'r2', class: 'safety', channel: 'runtime_policy', policy_ref: 'filesystem.protected', severity: 'critical' }),
    ]);
    expect(conflicts.map((c) => c.code)).toEqual(expect.arrayContaining(['missing_enforcement', 'critical_without_assertions']));
    expect(conflicts.every((c) => c.severity === 'error')).toBe(true);
  });

  it('flags conflicting guidance and priority ties within a conflict domain', () => {
    const conflicts = detectBehaviorConflicts([
      entry({ id: 'a', conflictDomain: 'style', render: 'Use tabs.', priority: 1 }),
      entry({ id: 'b', conflictDomain: 'style', render: 'Use spaces.', priority: 1 }),
    ]);
    expect(conflicts.map((c) => c.code).sort()).toEqual(['conflicting_guidance', 'priority_tie']);
    expect(conflicts.every((c) => c.severity === 'warning')).toBe(true);
  });

  it('returns no conflicts for a clean, ordered set', () => {
    expect(detectBehaviorConflicts([
      entry({ id: 'a', conflictDomain: 'style', render: 'Use tabs.', priority: 1 }),
      entry({ id: 'b', conflictDomain: 'style', render: 'Use tabs.', priority: 2 }),
    ]).filter((c) => c.code !== 'conflicting_guidance')).toEqual([]);
  });
});

describe('behavior conformance verdict', () => {
  const base: BehaviorConformanceEntry = { entryId: 'e', category: 'Instruction', channel: 'prompt_guidance', priority: 0, policyRef: null, policyRuleFound: true, compatibility: 'Mappable' };
  it('is rejected on any error conflict', () => {
    expect(behaviorConformanceVerdict([{ domain: 'd', entryIds: ['e'], severity: 'error', code: 'missing_enforcement', message: 'x' }], [base])).toBe('rejected');
  });
  it('is incomplete when a runtime rule is unenforced', () => {
    expect(behaviorConformanceVerdict([], [{ ...base, channel: 'runtime_policy', policyRef: 'filesystem.protected', policyRuleFound: false }])).toBe('incomplete');
  });
  it('is verified only when every entry is Verified', () => {
    expect(behaviorConformanceVerdict([], [{ ...base, compatibility: 'Verified' }])).toBe('verified');
    expect(behaviorConformanceVerdict([], [base])).toBe('enforceable');
  });
});
