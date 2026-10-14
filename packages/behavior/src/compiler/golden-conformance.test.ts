import { describe, expect, it } from 'vitest';
import type { BehaviorIR } from '../ir/BehaviorIR.js';
import type { PolicyArtifacts } from '@vessel/shared';
import { BehaviorCompileError, compileBehavior } from './Compiler.js';

/**
 * ARC-11 §11.1.5 — Behavior Golden Conformance.
 *
 * Asserts the L0→L4 effective chain is stable and deterministic, that the
 * compatibility ladder reports the honest level, and that enforcement gaps are
 * a hard compile failure (fail-to-compile), never a silent degradation.
 */

const policy: PolicyArtifacts = {
  promptGuidance: [],
  deniedTools: [],
  profile: 'workspace-write',
  approval: 'ask',
  rules: [
    { id: 'fs-protected:/repo/.env', domain: 'filesystem', action: 'deny', match: () => true },
    { id: 'shell-deny:destructive-delete', domain: 'shell', action: 'deny', match: () => true },
  ],
};

const ir: BehaviorIR = {
  version: '1.0',
  entries: [
    { id: 'guide', class: 'style', channel: 'prompt_guidance', render: 'Be concise.', priority: 10, sourceRef: 'configs/behavior.default.yaml' },
    { id: 'protect', class: 'safety', channel: 'runtime_policy', policy_ref: 'filesystem.protected', render: 'Never read .env.', priority: 20, assertions: ['a1'], sourceRef: 'configs/behavior.default.yaml' },
  ],
};

describe('Behavior golden conformance — L0→L4 chain', () => {
  it('produces a deterministic snapshot and a complete L0→L4 layer chain', () => {
    const first = compileBehavior(ir, policy, { policyRevision: 'rev-1' });
    const second = compileBehavior(ir, policy, { policyRevision: 'rev-1' });
    expect(first.inspection.snapshotHash).toBe(second.inspection.snapshotHash);
    expect(first.conformance).toEqual(second.conformance);
    expect(first.inspection.layers.map((layer) => layer.level)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
    expect(first.inspection.layers.slice(0, 4).every((layer) => layer.status === 'available' && !!layer.snapshotHash)).toBe(true);
    expect(first.inspection.layers.find((layer) => layer.level === 'L4')).toMatchObject({ status: 'unavailable' });
  });

  it('maps every entry into the conformance set (100% coverage) with honest levels', () => {
    const result = compileBehavior(ir, policy, { policyRevision: 'rev-1' });
    expect(result.conformance.map((entry) => entry.entryId).sort()).toEqual(['guide', 'protect']);
    const guide = result.inspection.entries.find((entry) => entry.id === 'guide')!;
    const protect = result.inspection.entries.find((entry) => entry.id === 'protect')!;
    expect(guide.compatibility).toBe('Mappable');
    expect(protect.compatibility).toBe('Enforceable');
    expect(protect.policyRuleIds).toEqual(['fs-protected:/repo/.env']);
    expect(result.conformance.every((entry) => entry.policyRuleFound)).toBe(true);
  });

  it('escalates to Verified only with a revision + assertions matching the snapshot hash', () => {
    const base = compileBehavior(ir, policy, { policyRevision: 'rev-1' });
    const hash = base.inspection.snapshotHash;
    const verified = compileBehavior(ir, policy, {
      policyRevision: 'rev-1',
      assertionResults: { protect: [{ assertionId: 'a1', passed: true, evidence: 'deny rule matched', snapshotHash: hash }] },
    });
    expect(verified.inspection.entries.find((entry) => entry.id === 'protect')!.compatibility).toBe('Verified');
    const stale = compileBehavior(ir, policy, {
      policyRevision: 'rev-1',
      assertionResults: { protect: [{ assertionId: 'a1', passed: true, evidence: 'x', snapshotHash: 'deadbeef' }] },
    });
    expect(stale.inspection.entries.find((entry) => entry.id === 'protect')!.compatibility).toBe('Enforceable');
  });

  it('fails to compile when a runtime constraint has no enforcement (policy narrowing gate)', () => {
    const missing: BehaviorIR = { version: '1.0', entries: [{ id: 'orphan', class: 'safety', channel: 'runtime_policy', policy_ref: 'network.deny_domains', render: 'No network.', sourceRef: 'x' }] };
    expect(() => compileBehavior(missing, policy)).toThrow(BehaviorCompileError);
    const noRef: BehaviorIR = { version: '1.0', entries: [{ id: 'noref', class: 'safety', channel: 'runtime_policy', render: 'x', sourceRef: 'x' }] };
    expect(() => compileBehavior(noRef, policy)).toThrow(BehaviorCompileError);
  });

  it('degrades to Renderable (warning, never silent removal) for unsupported model features', () => {
    const withCapability: BehaviorIR = { version: '1.0', entries: [{ id: 'cap', class: 'tools', channel: 'prompt_guidance', render: 'Use the browser.', requiredCapabilities: { parallelToolCalls: true }, sourceRef: 'x' }] };
    const result = compileBehavior(withCapability, policy, { unsupportedEntryIds: ['cap'] });
    expect(result.inspection.entries[0]!.compatibility).toBe('Renderable');
    expect(result.inspection.diagnostics[0]).toMatchObject({ code: 'MODEL_DEGRADATION', entryId: 'cap' });
  });

  it('enforces a shell deny declaration the same way as filesystem (dual-channel mapping)', () => {
    const shell: BehaviorIR = { version: '1.0', entries: [{ id: 'nodelete', class: 'safety', channel: 'runtime_policy', policy_ref: 'shell.destructive-delete', render: 'Never delete.', sourceRef: 'x' }] };
    const result = compileBehavior(shell, policy);
    expect(result.conformance[0]).toMatchObject({ entryId: 'nodelete', policyRuleFound: true });
  });
});
