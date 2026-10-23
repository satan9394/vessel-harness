import { createHash } from 'node:crypto';
import type { EffectivePolicyInspection, PolicyArtifacts } from '@vessel/shared';

/** Whitelist only compiled policy metadata; never serialize executable matchers. */
export function inspectEffectivePolicy(artifacts: PolicyArtifacts): EffectivePolicyInspection {
  const snapshot = {
    readOnly: true as const,
    sources: structuredClone(artifacts.sources ?? []),
    profile: artifacts.profile,
    approval: artifacts.approval,
    rules: artifacts.rules.map(({ id, domain, action, reason }) => ({ id, domain, action, reason })),
    deniedTools: [...artifacts.deniedTools],
    filesystem: artifacts.fsConfig ? structuredClone(artifacts.fsConfig) : undefined,
    shellAllow: [...(artifacts.shellAllow ?? [])],
    advisoryGuidanceCount: artifacts.promptGuidance.length,
    declarationOnly: structuredClone(artifacts.declarationOnly ?? []),
  };
  return { ...snapshot, snapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
}
