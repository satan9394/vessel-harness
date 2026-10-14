import { describe, expect, it } from 'vitest';
import {
  assertAgentInstanceSpec,
  defaultPermissionScope,
  narrowPermissionScope,
  scopeIsSubset,
  taskLeaseActive,
  taskTreeStatusIsTerminal,
  type AgentInstanceSpec,
  type PermissionScope,
} from './team.js';

const budget = { maxModelSteps: 8, maxToolCalls: 16, maxElapsedMs: 60_000, maxConsecutiveErrors: 3 };

function spec(overrides: Partial<AgentInstanceSpec> = {}): AgentInstanceSpec {
  return {
    instanceId: 'inst-1',
    modelProfileRef: 'model:mock',
    behaviorSnapshotRef: 'sha256:abc',
    policyScopeRef: 'policy:workspace-write',
    contextScopeRef: 'context:default',
    toolScopeRef: 'tools:readonly',
    budget,
    ...overrides,
  };
}

describe('AgentInstanceSpec contract', () => {
  it('accepts a well-formed scoped spec', () => {
    expect(() => assertAgentInstanceSpec(spec())).not.toThrow();
  });

  it('rejects a spec with a blank reference or non-positive budget', () => {
    expect(() => assertAgentInstanceSpec(spec({ modelProfileRef: '  ' }))).toThrow(/modelProfileRef/);
    expect(() => assertAgentInstanceSpec(spec({ budget: { ...budget, maxToolCalls: 0 } }))).toThrow(/maxToolCalls/);
  });
});

describe('monotonic permission narrowing', () => {
  const parent: PermissionScope = { allowedTools: ['Read', 'Write', 'Bash'], deniedTools: ['Bash'], writablePaths: ['/repo'], network: true, approvals: 'inherit' };
  const preset: PermissionScope = { allowedTools: ['Read', 'Write'], deniedTools: ['Write'], writablePaths: ['*'], network: true, approvals: 'ask' };
  const global = defaultPermissionScope();

  it('intersects allows, unions denies and takes the strictest approval', () => {
    const narrowed = narrowPermissionScope(parent, preset, global);
    expect(narrowed.allowedTools).toEqual(['Read', 'Write']);
    expect(narrowed.deniedTools).toEqual(['Bash', 'Write']);
    expect(narrowed.writablePaths).toEqual(['/repo']);
    expect(narrowed.network).toBe(true);
    expect(narrowed.approvals).toBe('ask');
  });

  it('never widens: the result is a subset of every input (monotonicity)', () => {
    const narrowed = narrowPermissionScope(parent, preset, global);
    expect(scopeIsSubset(narrowed, parent)).toBe(true);
    expect(scopeIsSubset(narrowed, preset)).toBe(true);
    expect(scopeIsSubset(narrowed, global)).toBe(true);
  });

  it('detects widening as not-a-subset', () => {
    const wider: PermissionScope = { ...parent, allowedTools: ['Read', 'Write', 'Bash', 'Web'] };
    expect(scopeIsSubset(wider, parent)).toBe(false);
    expect(scopeIsSubset({ ...parent, network: false }, { ...parent, network: true })).toBe(true);
  });

  it('treats a wildcard input as no restriction and an empty list as none', () => {
    expect(narrowPermissionScope(global, { ...global, allowedTools: [] }).allowedTools).toEqual([]);
    expect(narrowPermissionScope({ ...global, allowedTools: ['Read'] }, global).allowedTools).toEqual(['Read']);
  });
});

describe('task lease + status helpers', () => {
  it('is active only while unreleased and unexpired', () => {
    const lease = { leaseId: 'l1', instanceId: 'i1', holder: 'h', attempt: 1, acquiredAt: 0, expiresAt: 100 };
    expect(taskLeaseActive(lease, 50)).toBe(true);
    expect(taskLeaseActive(lease, 150)).toBe(false);
    expect(taskLeaseActive({ ...lease, releasedAt: 10 }, 50)).toBe(false);
    expect(taskLeaseActive(undefined, 0)).toBe(false);
  });

  it('classifies terminal statuses', () => {
    expect(taskTreeStatusIsTerminal('completed')).toBe(true);
    expect(taskTreeStatusIsTerminal('cancelled')).toBe(true);
    expect(taskTreeStatusIsTerminal('waiting_approval')).toBe(false);
  });
});
