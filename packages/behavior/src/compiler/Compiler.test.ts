import { describe, it, expect } from 'vitest';
import type { PolicyArtifacts, PolicyRule } from '@cah/shared';
import { compileBehavior, hasDomainEnforcement } from './Compiler.js';
import type { BehaviorIR } from '../ir/BehaviorIR.js';

function rule(id: string, domain: PolicyRule['domain'], action: PolicyRule['action']): PolicyRule {
  return { id, domain, action, match: () => false };
}

function artifacts(overrides: Partial<PolicyArtifacts> = {}): PolicyArtifacts {
  return {
    promptGuidance: [],
    deniedTools: [],
    rules: [],
    profile: 'workspace-write',
    approval: 'never',
    ...overrides,
  };
}

describe('behavior compiler — rule-level dual-channel enforcement (D4 §7.2)', () => {
  it('filesystem.protected is satisfied only by an fs-protected:* rule, not by any filesystem deny', () => {
    // Old domain-level check passed this: a lone fs-deny-read rule satisfied
    // the claim "filesystem.protected". Rule-level must reject it.
    const onlyDenyRead = artifacts({
      rules: [rule('fs-deny-read:.env', 'filesystem', 'deny')],
      fsConfig: { protected: [], denyRead: ['.env'] },
    });
    expect(hasDomainEnforcement('filesystem.protected', onlyDenyRead)).toBe(false);

    const withProtected = artifacts({
      rules: [rule('fs-protected:.git', 'filesystem', 'deny'), rule('fs-deny-read:.env', 'filesystem', 'deny')],
      fsConfig: { protected: ['.git'], denyRead: ['.env'] },
    });
    expect(hasDomainEnforcement('filesystem.protected', withProtected)).toBe(true);
    expect(hasDomainEnforcement('filesystem.deny_read', withProtected)).toBe(true);
  });

  it('shell.deny requires a shell-deny:* rule; shell.<category> matches the exact category id', () => {
    const onlyDiskFormat = artifacts({ rules: [rule('shell-deny:disk-format', 'shell', 'deny')] });
    // broad "shell.deny" claim is satisfied by any shell-deny:* rule
    expect(hasDomainEnforcement('shell.deny', onlyDiskFormat)).toBe(true);
    // category claim must match that exact category — disk-format present, destructive-delete absent
    expect(hasDomainEnforcement('shell.disk-format', onlyDiskFormat)).toBe(true);
    expect(hasDomainEnforcement('shell.destructive-delete', onlyDiskFormat)).toBe(false);
  });

  it('compileBehavior warns when a runtime_policy entry has no matching rule (never silently dropped)', () => {
    const ir: BehaviorIR = {
      version: '0.1',
      entries: [
        {
          id: 'safety.protected_paths',
          class: 'safety',
          channel: 'runtime_policy',
          policy_ref: 'filesystem.protected',
          render: '不要改写受保护路径。',
        },
      ],
    };
    // policy has filesystem rules but NO fs-protected:* rule — claim is unenforced
    const result = compileBehavior(ir, artifacts({
      rules: [rule('fs-deny-read:.env', 'filesystem', 'deny')],
    }));
    expect(result.warnings.some((w) => w.includes('safety.protected_paths'))).toBe(true);
    expect(result.conformance[0]).toMatchObject({ entryId: 'safety.protected_paths', policyRuleFound: false });

    // with the actual protected rule present, no warning and the prompt section renders
    const ok = compileBehavior(ir, artifacts({
      rules: [rule('fs-protected:.git', 'filesystem', 'deny')],
      fsConfig: { protected: ['.git'], denyRead: [] },
    }));
    expect(ok.warnings).toHaveLength(0);
    expect(ok.promptSections).toContain('不要改写受保护路径。');
  });
});
