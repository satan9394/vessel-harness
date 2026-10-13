import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { PolicyArtifacts, PolicyRule } from '@vessel/shared';
import { BehaviorCompileError, compileBehavior, hasDomainEnforcement } from './Compiler.js';
import { parseBehaviorIR } from '../ir/BehaviorIR.js';
import { compilePolicyYaml } from '@vessel/policy';
import type { BehaviorIR } from '../ir/BehaviorIR.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

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
  it('does not certify declaration-only network policy as runtime enforcement', () => {
    const policy = compilePolicyYaml(`
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  network:
    deny_domains: [169.254.169.254]
`);
    expect(hasDomainEnforcement('network.deny_domains', policy)).toBe(false);
    expect(() => compileBehavior({ version: '0.1', entries: [{
      id: 'network-denial', class: 'safety', channel: 'runtime_policy',
      policy_ref: 'network.deny_domains', render: 'Domain requests are blocked.',
    }] }, policy)).toThrow(BehaviorCompileError);
  });

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

  it('compileBehavior rejects a runtime_policy entry without matching enforcement', () => {
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
    expect(() => compileBehavior(ir, artifacts({
      rules: [rule('fs-deny-read:.env', 'filesystem', 'deny')],
    }))).toThrow('safety.protected_paths');

    // with the actual protected rule present, no warning and the prompt section renders
    const ok = compileBehavior(ir, artifacts({
      rules: [rule('fs-protected:.git', 'filesystem', 'deny')],
      fsConfig: { protected: ['.git'], denyRead: [] },
    }));
    expect(ok.warnings).toHaveLength(0);
    expect(ok.promptSections).toContain('不要改写受保护路径。');
  });

  it.each([undefined, '', ' ', 'filesystem', 'filesystem.protected.typo', 'fs-protected', 'fs-protected:.git/extra'])('rejects missing or partial policy references (%s) without replacing the active result', (policy_ref) => {
    const policy = artifacts({ rules: [rule('fs-protected:.git', 'filesystem', 'deny')] });
    const entry: BehaviorIR['entries'][number] = {
      id: 'protected', class: 'safety', channel: 'runtime_policy', policy_ref: 'filesystem.protected', render: 'Protected paths are denied.',
    };
    const previous = compileBehavior({ version: '0.1', entries: [entry] }, policy);
    let active = previous;
    expect(() => { active = compileBehavior({ version: '0.1', entries: [{ ...entry, policy_ref }] }, policy); }).toThrow(BehaviorCompileError);
    expect(active).toBe(previous);
    expect(policy.rules).toHaveLength(1);
  });

  it('accepts only exact executable restrictive custom mappings', () => {
    expect(hasDomainEnforcement('custom', artifacts({ rules: [rule('custom-longer', 'tools', 'deny')] }))).toBe(false);
    expect(hasDomainEnforcement('custom-longer', artifacts({ rules: [rule('custom', 'tools', 'deny')] }))).toBe(false);
    expect(hasDomainEnforcement('custom', artifacts({ rules: [rule('custom', 'tools', 'allow')] }))).toBe(false);
    expect(hasDomainEnforcement('custom', artifacts({ rules: [rule('custom', 'tools', 'ask')] }))).toBe(true);
    expect(hasDomainEnforcement('custom', artifacts({ rules: [{ ...rule('custom', 'tools', 'deny'), match: undefined! }] }))).toBe(false);
  });

  it('cannot certify unrelated or permissive git/network rules', () => {
    expect(hasDomainEnforcement('git.force_push', artifacts({ rules: [rule('git:force-push', 'git', 'allow')] }))).toBe(false);
    expect(hasDomainEnforcement('git.unknown', artifacts({ rules: [rule('git:force-push', 'git', 'deny')] }))).toBe(false);
    expect(hasDomainEnforcement('network.deny_domains', artifacts({ rules: [rule('network-custom', 'network', 'deny')] }))).toBe(false);
    expect(hasDomainEnforcement('network.unknown', artifacts({ rules: [rule('net-deny:example.com', 'network', 'deny')] }))).toBe(false);
    expect(hasDomainEnforcement('filesystem.protected', artifacts({ rules: [rule('fs-protected:.git', 'network', 'deny')] }))).toBe(false);
  });

  it.each(['', ' ', 123, ['filesystem.protected']])('IR loader rejects invalid runtime policy references (%s)', (policy_ref) => {
    expect(() => parseBehaviorIR(JSON.stringify({ version: '0.1', entries: [{
      id: 'protected', class: 'safety', channel: 'runtime_policy', policy_ref, render: 'Do not write protected paths.',
    }] }))).toThrow('requires policy_ref');
  });

  it('task 116: filesystem.deny_read claim (safety.secret_handling) needs an fs-deny-read:* rule, not just any fs rule', () => {
    const onlyProtected = artifacts({
      rules: [rule('fs-protected:.git', 'filesystem', 'deny')],
      fsConfig: { protected: ['.git'], denyRead: [] },
    });
    expect(hasDomainEnforcement('filesystem.deny_read', onlyProtected)).toBe(false);

    const withDenyRead = artifacts({
      rules: [rule('fs-protected:.git', 'filesystem', 'deny'), rule('fs-deny-read:.env', 'filesystem', 'deny')],
      fsConfig: { protected: ['.git'], denyRead: ['.env'] },
    });
    expect(hasDomainEnforcement('filesystem.deny_read', withDenyRead)).toBe(true);
  });

  it('task 116: real configs compile with zero warnings and all runtime_policy entries resolve', () => {
    const behaviorPath = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');
    const policyPath = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
    const ir = parseBehaviorIR(fs.readFileSync(behaviorPath, 'utf8'), behaviorPath);
    const policy = compilePolicyYaml(fs.readFileSync(policyPath, 'utf8'));
    const result = compileBehavior(ir, policy);

    // 双通道强制：新增 runtime_policy 条目（含 safety.secret_handling → filesystem.deny_read）必须全部有执法规则
    expect(result.warnings).toHaveLength(0);
    for (const c of result.conformance) {
      expect(c.policyRuleFound, `entry ${c.entryId} (${c.channel}, ref=${c.policyRef}) must resolve`).toBe(true);
    }
  });

  it('task 116: v0.2 audit entries render into prompt sections (own phrasing, retry/plan/honest/context/concise)', () => {
    const behaviorPath = path.join(REPO_ROOT, 'configs', 'behavior.default.yaml');
    const policyPath = path.join(REPO_ROOT, 'configs', 'policy.default.yaml');
    const ir = parseBehaviorIR(fs.readFileSync(behaviorPath, 'utf8'), behaviorPath);
    const policy = compilePolicyYaml(fs.readFileSync(policyPath, 'utf8'));
    const result = compileBehavior(ir, policy);

    for (const expected of [
      '重试要有退避',
      '先给出计划（目标→步骤→验证方式）再动手',
      '拿不到真实验证结果',
      '写入项目指令文件（AGENTS.md）',
      '基于摘要与最新请求继续',
      '注意上下文占用',
      '回复简洁直给',
      '凭据与密钥不写入文件、不落日志、不外发',
    ]) {
      expect(result.promptSections.some((s) => s.includes(expected)), expected).toBe(true);
    }
  });
});
