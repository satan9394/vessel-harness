import { describe, it, expect } from 'vitest';
import { compilePolicyYaml, parsePolicyYaml, PolicyEngine } from './index.js';
import type { PolicyArtifacts } from '@vessel/shared';

const BASE_POLICY = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  filesystem:
    protected: [".git", ".git/**", ".env"]
    deny_read: ["**/.aws/credentials"]
  shell:
    deny: ["destructive-delete", "disk-format"]
    allow: ["ls", "cat", "git status"]
  tools:
    deny: ["AskUserQuestion"]
  guidance:
    - "不要改写受保护路径。"
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(BASE_POLICY);
}

describe('policy/risk — Policy Compiler (four artifacts)', () => {
  it('compiles one declaration into four artifacts', () => {
    const a = artifacts();
    expect(a.promptGuidance.length).toBeGreaterThan(0); // soft channel
    expect(a.deniedTools).toContain('AskUserQuestion'); // tool interceptor
    expect(a.rules.some((r) => r.id.startsWith('fs-protected:.git'))).toBe(true); // runtime deny
    expect(a.profile).toBe('workspace-write');
    expect(a.approval).toBe('never');
    expect(a.fsConfig?.protected).toContain('.git');
    expect(a.shellAllow).toContain('ls');
  });

  it('fails loud on unknown top-level key', () => {
    expect(() => compilePolicyYaml(BASE_POLICY.replace('guidance:', 'bogus_thing:'))).toThrow(/unknown top-level key/);
  });

  it('fails loud on unknown shell.deny category', () => {
    const p = BASE_POLICY.replace('deny: ["destructive-delete", "disk-format"]', 'deny: ["teleport-anywhere"]');
    expect(() => compilePolicyYaml(p)).toThrow(/unknown shell\.deny category/);
  });

  it('parses bare policy or policy: wrapper', () => {
    const bare = parsePolicyYaml(BASE_POLICY);
    expect(bare.profile).toBe('workspace-write');
  });
});

describe('policy/engine — authoritative BeforeTool decision (POLICY-SPEC §4.2)', () => {
  it('① denied_tools denies before everything', async () => {
    const e = new PolicyEngine(artifacts());
    const v = await e.decide({ toolName: 'AskUserQuestion', arguments: {} });
    expect(v.action).toBe('deny');
    expect(v.decisionPath[0]).toContain('denied_tools');
  });

  it('② deny rule (shell destructive-delete) denies with never_auto semantics', async () => {
    const e = new PolicyEngine(artifacts());
    const v = await e.decide({ toolName: 'Shell', arguments: { command: 'rm -rf /tmp/x' } });
    expect(v.action).toBe('deny');
    expect(v.ruleRef).toContain('destructive-delete');
  });

  it('filesystem.protected write is denied by rule, not by prompt', async () => {
    const e = new PolicyEngine(artifacts());
    const v = await e.decide({ toolName: 'Write', arguments: { path: '.git/config', content: 'x' } });
    expect(v.action).toBe('deny');
    expect(v.ruleRef).toContain('fs-protected');
  });

  it('read-only command on the allowlist runs under workspace-write without approval', async () => {
    const e = new PolicyEngine(artifacts());
    const shellSpec = { requiredPermission: 'danger-full-access' as const };
    const v = await e.decide({ toolName: 'Shell', arguments: { command: 'ls -la' } }, shellSpec);
    expect(v.action).toBe('allow');
  });

  it('approval:never is service-enforced for profile-required approvals (fail-closed)', async () => {
    const e = new PolicyEngine(artifacts());
    const shellSpec = { requiredPermission: 'danger-full-access' as const };
    const v = await e.decide({ toolName: 'Shell', arguments: { command: 'node -e "1+1"' } }, shellSpec);
    expect(v.action).toBe('deny');
    expect(v.decisionPath).toContain('approval:never');
  });

  it('⑥ profile compare: read-only profile denies workspace-write tools', async () => {
    const a = compilePolicyYaml(BASE_POLICY.replace('profile: workspace-write', 'profile: read-only'));
    const e = new PolicyEngine(a);
    const v = await e.decide({ toolName: 'Write', arguments: { path: 'x.txt', content: 'y' } }, { requiredPermission: 'workspace-write' });
    expect(v.action).toBe('deny');
    expect(v.decisionPath.some((p) => p.startsWith('profile:'))).toBe(true);
  });

  it('guard: pre-existing deny cannot be flipped to allow by profile', async () => {
    const e = new PolicyEngine(artifacts());
    const v = await e.decide({ toolName: 'Shell', arguments: { command: 'rm -rf /tmp/x' } }, { requiredPermission: 'danger-full-access' });
    expect(v.action).toBe('deny'); // rule deny stays deny even under danger profile
  });
});
