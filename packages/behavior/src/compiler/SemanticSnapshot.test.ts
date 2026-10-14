import { describe, expect, it } from 'vitest';
import type { BehaviorAssertionResult, BehaviorEntry, BehaviorIR, PolicyArtifacts, ProviderCapabilities } from '@vessel/shared';
import { BEHAVIOR_CATEGORIES, BEHAVIOR_COMPATIBILITY_LEVELS, BehaviorCompileError, compileBehavior } from '../index.js';
import { parseBehaviorIR } from '../ir/BehaviorIR.js';

const policy: PolicyArtifacts = { promptGuidance: [], deniedTools: ['Shell'], profile: 'danger-full-access', approval: 'never', rules: [{ id: 'fs-protected:.git', domain: 'filesystem', action: 'deny', match: () => true }] };
const entry: BehaviorEntry = { id: 'safe', class: 'safety', channel: 'runtime_policy', policy_ref: 'filesystem.protected', render: 'Protect .git', category: 'Constraint', assertions: ['no-write'], sourceRef: 'base.yaml' };
const ir = (item: BehaviorEntry): BehaviorIR => ({ version: '1', entries: [item] });

describe('semantic behavior snapshots', () => {
  it('exposes all categories and compatibility levels without self-certification', () => {
    expect(BEHAVIOR_CATEGORIES).toHaveLength(7);
    expect(BEHAVIOR_COMPATIBILITY_LEVELS).toEqual(['Importable', 'Renderable', 'Mappable', 'Enforceable', 'Verified']);
    const result = compileBehavior(ir(entry), policy);
    expect(result.inspection.entries[0]!).toMatchObject({ category: 'Constraint', compatibility: 'Enforceable', policyRuleIds: ['fs-protected:.git'], sourceRef: 'base.yaml' });
    expect(result.inspection.layers.map(layer => layer.level)).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
    expect(result.inspection.layers[4]!).toMatchObject({ status: 'unavailable', snapshot: null });
    expect(result.inspection.layers.slice(0, 4).every(layer => layer.snapshotHash?.length === 64)).toBe(true);
  });

  it('requires passing evidence for every assertion before marking Verified', () => {
    const policyRevision = 'test-policy-v1';
    const snapshotHash = compileBehavior(ir(entry), policy, { policyRevision }).inspection.snapshotHash;
    const candidates: Record<string, BehaviorAssertionResult[]>[] = [{}, { safe: [{ assertionId: 'no-write', passed: false, evidence: 'failed', snapshotHash }] }, { safe: [{ assertionId: 'other', passed: true, evidence: 'test log', snapshotHash }] }, { safe: [{ assertionId: 'no-write', passed: true, evidence: '', snapshotHash }] }];
    for (const assertionResults of candidates) {
      expect(compileBehavior(ir(entry), policy, { assertionResults, policyRevision }).inspection.entries[0]!.compatibility).toBe('Enforceable');
    }
    const assertionResults = { safe: [{ assertionId: 'no-write', passed: true, evidence: 'deterministic evaluator log', snapshotHash }] };
    expect(compileBehavior(ir(entry), policy, { assertionResults, policyRevision }).inspection.entries[0]!.compatibility).toBe('Verified');
    expect(compileBehavior(ir(entry), policy, { assertionResults }).inspection.entries[0]!.compatibility).toBe('Enforceable');
    for (const variant of [
      { input: ir({ ...entry, render: 'Changed protected paths' }), enforcement: policy, profile: undefined },
      { input: ir(entry), enforcement: { ...policy, profile: 'read-only' as const }, profile: undefined },
      { input: ir(entry), enforcement: { ...policy, deniedTools: ['Shell', 'Write'] }, profile: undefined },
      { input: ir(entry), enforcement: policy, profile: { provider: 'other', model: 'new-model' } },
    ]) expect(compileBehavior(variant.input, variant.enforcement, { assertionResults, policyRevision, modelProfile: variant.profile }).inspection.entries[0]!.compatibility).toBe('Enforceable');
  });

  it.each(['channel', 'policy_ref', 'category', 'conflictDomain'] as const)('rejects immutable %s overrides', field => {
    const base = { ...entry, conflictDomain: 'filesystem' };
    const patch = { ...base, [field]: field === 'channel' ? 'prompt_guidance' : field === 'category' ? 'Instruction' : 'other', sourceRef: 'project.yaml' } as BehaviorEntry;
    expect(() => compileBehavior(ir(base), policy, { layers: [ir(patch)] })).toThrow(BehaviorCompileError);
  });

  it('deduplicates assertions and tracks the winner of each field', () => {
    const result = compileBehavior(ir(entry), policy, { layers: [ir({ ...entry, render: 'Protect .git and secrets', assertions: ['no-write', 'no-secret'], sourceRef: 'project.yaml' })] });
    const effective = result.inspection.entries[0]!;
    expect(effective.assertions).toEqual(['no-write', 'no-secret']);
    expect(effective.provenance.policy_ref!.sourceRef).toBe('base.yaml');
    expect(effective.provenance.render).toMatchObject({ sourceRef: 'project.yaml', strategy: 'replace', priority: 1 });
    expect(effective.provenance['assertions.no-write']!.sourceRef).toBe('base.yaml');
    expect(effective.provenance['assertions.no-secret']!.sourceRef).toBe('project.yaml');
    expect(result.inspection.snapshotHash).not.toBe(compileBehavior(ir(entry), policy).inspection.snapshotHash);
  });

  it('monotonically narrows permission metadata and unions denied tools', () => {
    const base: BehaviorEntry = { ...entry, channel: 'prompt_guidance', policy_ref: undefined, permissions: { allowedTools: ['Read', 'Shell'], deniedTools: ['Write'], maxToolCalls: 5 } };
    const result = compileBehavior(ir(base), policy, { layers: [ir({ ...base, permissions: { allowedTools: ['Read'], deniedTools: ['Shell'], maxToolCalls: 3 } })] });
    const snapshot = result.inspection.layers[1]!.snapshot as BehaviorIR;
    expect(snapshot.entries[0]!.permissions).toEqual({ allowedTools: ['Read'], deniedTools: ['Write', 'Shell'], maxToolCalls: 3 });
    expect(result.inspection.entries[0]!.compatibility).toBe('Mappable');
    expect(result.inspection.diagnostics[0]!.code).toBe('PERMISSION_GUIDANCE_ONLY');
    for (const permissions of [{ allowedTools: ['Delete'] }, { maxToolCalls: 6 }]) expect(() => compileBehavior(ir(base), policy, { layers: [ir({ ...base, permissions })] })).toThrow('privilege escalation');
  });

  it('never claims unsupported permissions as executable runtime enforcement', () => {
    for (const permissions of [{ allowedTools: ['Read'] }, { maxToolCalls: 2 }, { deniedTools: ['Write'] }]) expect(() => compileBehavior(ir({ ...entry, permissions }), policy)).toThrow('no matching runtime enforcement');
    expect(compileBehavior(ir({ ...entry, permissions: { deniedTools: ['Shell'] } }), policy).inspection.entries[0]!.compatibility).toBe('Enforceable');
  });

  it('rejects untrusted privileged entries, ambiguous priority and critical constraints without assertions', () => {
    expect(() => compileBehavior(ir({ ...entry, trust: 'untrusted' }), policy)).toThrow('untrusted');
    expect(() => compileBehavior(ir({ ...entry, priority: 2 }), policy, { layers: [ir({ ...entry, priority: 2, render: 'Changed' })] })).toThrow('ambiguous');
    expect(() => compileBehavior(ir({ ...entry, priority: 2 }), policy, { layers: [ir({ ...entry, priority: 1 })] })).toThrow('lower priority');
    expect(() => compileBehavior(ir({ ...entry, severity: 'critical', assertions: [] }), policy)).toThrow('requires conformance assertions');
    expect(() => compileBehavior(ir({ ...entry, severity: 'critical' }), policy)).toThrow('registered conformance assertions');
    expect(compileBehavior(ir({ ...entry, severity: 'critical' }), policy, { supportedAssertionIds: ['no-write'] }).inspection.entries[0]!.compatibility).toBe('Enforceable');
  });

  it('reports model degradation for soft guidance and blocks mandatory unsupported features', () => {
    expect(() => compileBehavior(ir(entry), policy, { unsupportedEntryIds: ['safe'] })).toThrow('unsupported');
    const result = compileBehavior(ir({ ...entry, channel: 'prompt_guidance', policy_ref: undefined }), policy, { unsupportedEntryIds: ['safe'] });
    expect(result.inspection.entries[0]!.compatibility).toBe('Renderable');
    expect(result.inspection.diagnostics[0]!.code).toBe('MODEL_DEGRADATION');
  });

  it('rejects invalid semantic schema metadata and unknown nested declarations', () => {
    for (const patch of [{ category: 'Safety' }, { priority: 'high' }, { assertions: [false] }, { permissions: { allowedTools: '*' } }, { permissions: { admin: true } }, { enforcementChannel: 'prompt_guidance' }]) expect(() => parseBehaviorIR(JSON.stringify(ir({ ...entry, ...patch } as BehaviorEntry)))).toThrow();
    expect(() => parseBehaviorIR('{"behavior":{"version":"1","entries":[],"rogue":true}}')).toThrow('unknown');
    expect(() => parseBehaviorIR('null')).toThrow('object required');
    expect(() => compileBehavior({ version: '1', entries: [entry, entry] }, policy)).toThrow('duplicate');
  });

  it('returns detached snapshots and deterministic hashes without mutating caller IR or policy', () => {
    const input = ir(entry);
    const before = JSON.stringify(input);
    const result = compileBehavior(input, policy);
    expect(compileBehavior(input, policy).inspection.snapshotHash).toBe(result.inspection.snapshotHash);
    result.harnessConfig.deniedTools.push('Read');
    (result.inspection.layers[0]!.snapshot as BehaviorIR[])[0]!.entries[0]!.render = 'mutated';
    expect(JSON.stringify(input)).toBe(before);
    expect(policy.deniedTools).toEqual(['Shell']);
  });

  it('normalizes omitted fields and blocks severity or inferred category downgrades', () => {
    const base = { ...entry, channel: 'prompt_guidance' as const, policy_ref: undefined, severity: 'critical' as const, permissions: { allowedTools: ['Read'], maxToolCalls: 2 } };
    const result = compileBehavior(ir(base), policy, { layers: [ir({ ...base, severity: undefined, permissions: { allowedTools: undefined, maxToolCalls: undefined } })] });
    const snapshot = result.inspection.layers[1]!.snapshot as BehaviorIR;
    expect(snapshot.entries[0]!.severity).toBe('critical');
    expect(snapshot.entries[0]!.permissions?.allowedTools).toEqual(['Read']);
    expect(snapshot.entries[0]!.permissions?.maxToolCalls).toBe(2);
    expect(() => compileBehavior(ir(base), policy, { layers: [ir({ ...base, severity: 'info' })] })).toThrow('immutable severity');
    const inferred = { ...entry, category: undefined };
    expect(() => compileBehavior(ir(inferred), policy, { layers: [ir({ ...inferred, category: 'Instruction' })] })).toThrow('immutable category');
  });

  it('compiles the same input against actual provider capability profiles without treating unknown as success', () => {
    const input = ir({ ...entry, channel: 'prompt_guidance', policy_ref: undefined, requiredCapabilities: { structuredOutput: true, contextWindow: 8192, reasoning: false } });
    const capabilities = { structuredOutput: { status: 'declared', value: true }, contextWindow: { status: 'detected', value: 16384 }, reasoning: { status: 'declared', value: false } } as ProviderCapabilities;
    const supported = compileBehavior(input, policy, { modelProfile: { provider: 'supported', model: 'model-a', capabilities } });
    expect(supported.inspection.entries[0]!.compatibility).toBe('Mappable');
    const unknown = compileBehavior(input, policy, { modelProfile: { provider: 'unknown', model: 'model-b', capabilities: { ...capabilities, structuredOutput: { status: 'unknown' } } } });
    expect(unknown.inspection.entries[0]!.compatibility).toBe('Renderable');
    expect(unknown.warnings[0]!).toContain('structuredOutput unsupported or unknown');
    expect(unknown.inspection.layers[2]!.snapshot).toMatchObject({ modelProfile: { provider: 'unknown', model: 'model-b' } });
    expect(unknown.inspection.layers[2]!.snapshotHash).not.toBe(supported.inspection.layers[2]!.snapshotHash);
    expect(compileBehavior(input, policy).inspection.entries[0]!.compatibility).toBe('Renderable');
    for (const requirements of [{ structuredOutput: true }, { reasoning: true }, { contextWindow: 32768 }]) expect(() => compileBehavior(ir({ ...entry, requiredCapabilities: requirements }), policy, { modelProfile: { provider: 'unknown', model: 'model-b', capabilities: { ...capabilities, structuredOutput: { status: 'unknown' } } } })).toThrow(BehaviorCompileError);
    expect(() => compileBehavior(ir({ ...entry, requiredCapabilities: { reasoning: false } }), policy, { modelProfile: { provider: 'unknown', model: 'model-b', capabilities: { ...capabilities, reasoning: { status: 'unknown' } } } })).toThrow('unknown');
  });

  it('rejects invalid capability declarations and weakened upstream requirements', () => {
    for (const requiredCapabilities of [{ tools: 'yes' }, { contextWindow: 0 }, { contextWindow: -1 }, { contextWindow: 1.5 }, { unknown: true }]) expect(() => parseBehaviorIR(JSON.stringify(ir({ ...entry, requiredCapabilities } as BehaviorEntry)))).toThrow('requiredCapabilities');
    const input = ir({ ...entry, channel: 'prompt_guidance', policy_ref: undefined, requiredCapabilities: { tools: true, contextWindow: 8192 } });
    expect(() => compileBehavior(input, policy, { layers: [ir({ ...input.entries[0]!, requiredCapabilities: { tools: false } })] })).toThrow('cannot be weakened');
    expect(() => compileBehavior(input, policy, { layers: [ir({ ...input.entries[0]!, requiredCapabilities: { contextWindow: 4096 } })] })).toThrow('cannot be weakened');
  });
});
