import { describe, it, expect } from 'vitest';
import {
  currentMemberId,
  memberCards,
  normalizeTeamState,
  phaseDisplay,
  roleDisplay,
  routeLabel,
  runSummary,
  toolSummary,
  verdictDisplay,
} from './team';
import { complexRunningFixture, mediumTeamFixture, routeFixture } from './team.fixtures';

describe('team pure selectors (task 060 data consumption)', () => {
  it('memberCards groups phases/turns/tools per roster member in roster order', () => {
    const cards = memberCards(mediumTeamFixture());
    expect(cards.map((c) => c.memberId)).toEqual(['developer', 'reviewer']);
    expect(cards[0]?.phase?.outputPreview).toContain('已实现导出');
    expect(cards[0]?.turns).toHaveLength(1);
    expect(cards[0]?.tools.map((t) => t.toolName)).toEqual(['read_file', 'write_file', 'write_file']);
    expect(cards[1]?.phase?.review?.verdict).toBe('not_met');
    expect(cards[1]?.delegates).toHaveLength(0);
  });

  it('running flag + currentMemberId point at the live phase member', () => {
    const state = complexRunningFixture();
    expect(currentMemberId(state)).toBe('developer');
    const cards = memberCards(state);
    expect(cards.find((c) => c.memberId === 'developer')?.running).toBe(true);
    expect(cards.find((c) => c.memberId === 'lead')?.running).toBe(false);
    // lead owns the running delegate row
    expect(cards.find((c) => c.memberId === 'lead')?.delegates).toHaveLength(1);
  });

  it('toolSummary collapses repeated tools to name × count', () => {
    const state = mediumTeamFixture();
    const dev = state.toolActivities.filter((t) => t.memberId === 'developer');
    expect(toolSummary(dev)).toEqual([
      { toolName: 'read_file', status: 'done', count: 1 },
      { toolName: 'write_file', status: 'done', count: 2 },
    ]);
  });

  it('normalizeTeamState tolerates null / partial raw snapshots', () => {
    expect(normalizeTeamState(null)).toBeNull();
    expect(normalizeTeamState(undefined)).toBeNull();
    const partial = normalizeTeamState({ runId: 'team_x', status: 'running' });
    expect(partial?.status).toBe('running');
    expect(partial?.roster).toEqual([]);
    expect(partial?.phases).toEqual([]);
    expect(partial?.toolActivities).toEqual([]);
  });

  it('routeLabel renders the actual resolved model per mode (§10 label)', () => {
    expect(routeLabel(routeFixture())).toBe('Auto → mock-pro');
    expect(routeLabel(routeFixture({ mode: 'fast', primary: { role: 'developer', tier: 'fast', providerId: 'mock', model: 'mock-fast', configured: true } }))).toBe('Fast → mock-fast');
    expect(routeLabel(null)).toBeNull();
    expect(routeLabel(undefined)).toBeNull();
  });

  it('runSummary covers running / completed / failed outcomes', () => {
    expect(runSummary(complexRunningFixture())).toContain('running');
    expect(runSummary(mediumTeamFixture())).toContain('completed');
    const failed = { ...mediumTeamFixture(), status: 'done' as const, outcome: 'failed' as const, error: 'phase 2 failed' };
    expect(runSummary(failed)).toContain('failed — phase 2 failed');
  });

  it('display helpers map role/preset/phase/verdict to friendly labels', () => {
    expect(roleDisplay('developer', 'generator')).toBe('Developer');
    expect(roleDisplay('lead', 'orchestrator')).toBe('Lead');
    expect(roleDisplay('reviewer', 'evaluator')).toBe('Reviewer');
    expect(roleDisplay('architect', 'orchestrator')).toBe('Lead');
    expect(phaseDisplay('evaluate')).toBe('Review');
    expect(phaseDisplay('generate')).toBe('Generate');
    expect(verdictDisplay('not_met')).toBe('Not met');
    expect(verdictDisplay('met')).toBe('Met');
  });
});
