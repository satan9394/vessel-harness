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

describe('policy/risk — task 073 filesystem confinement (allow-set)', () => {
  const CONFINED = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  filesystem:
    protected: [".git", ".git/**"]
    deny_read: ["**/.aws/credentials"]
    allow:
      - { path: "C:/shared-assets", mode: "read" }
      - { path: "cache/out", mode: "write" }
    confinement: true
`;

  it('compiles confinement:true into fsConfig.allow + fsConfig.confinement', () => {
    const a = compilePolicyYaml(CONFINED);
    expect(a.fsConfig?.confinement).toBe(true);
    expect(a.fsConfig?.allow).toEqual([
      { path: 'C:/shared-assets', mode: 'read' },
      { path: 'cache/out', mode: 'write' },
    ]);
    // existing protected/deny_read still flow through (coexists with confinement)
    expect(a.fsConfig?.protected).toContain('.git');
    expect(a.fsConfig?.denyRead).toContain('**/.aws/credentials');
  });

  it('mints a fs-confinement deny rule (pre-execute seam -> audit/denial)', () => {
    const a = compilePolicyYaml(CONFINED);
    expect(a.rules.some((r) => r.id === 'fs-confinement' && r.domain === 'filesystem')).toBe(true);
  });

  it('pre-execute deny: ".." escape on a file tool is denied by fs-confinement', async () => {
    const e = new PolicyEngine(compilePolicyYaml(CONFINED));
    const v = await e.decide({ toolName: 'Read', arguments: { path: '../../etc/passwd' } });
    expect(v.action).toBe('deny');
    expect(v.ruleRef).toBe('fs-confinement');
  });

  it('pre-execute deny: uncovered absolute path is denied; covered absolute allow passes', async () => {
    const e = new PolicyEngine(compilePolicyYaml(CONFINED));
    const readSpec = { requiredPermission: 'read' as const };
    const uncovered = await e.decide({ toolName: 'Write', arguments: { path: 'D:/elsewhere/out.txt' } }, { requiredPermission: 'workspace-write' });
    expect(uncovered.action).toBe('deny');
    const covered = await e.decide({ toolName: 'Read', arguments: { path: 'C:/shared-assets/a.txt' } }, readSpec);
    expect(covered.action).toBe('allow');
  });

  it('pre-execute allow: normal workspace-relative file ops are not false-denied by fs-confinement', async () => {
    const e = new PolicyEngine(compilePolicyYaml(CONFINED));
    const readSpec = { requiredPermission: 'read' as const };
    for (const p of ['src/a.ts', 'cache/out/x.json', 'README.md']) {
      const v = await e.decide({ toolName: 'Read', arguments: { path: p } }, readSpec);
      expect(v.action).not.toBe('deny'); // workspace-relative is left to the tool guard (never false-positive)
    }
  });

  it('confinement off (default): no fs-confinement rule is minted (back-compat routes)', () => {
    const a = compilePolicyYaml(BASE_POLICY);
    expect(a.fsConfig?.confinement).toBeFalsy();
    expect(a.rules.some((r) => r.id === 'fs-confinement')).toBe(false);
  });
});

describe('policy/risk — task V1.1-A: deny_read `**/.env` intercepts root-level `.env`', () => {
  const DENY_ENV = `
policy:
  version: "0.1"
  profile: workspace-write
  approval: never
  filesystem:
    protected: [".git"]
    deny_read: ["**/.env"]
`;

  it('`**/.env` deny_read rule denies a Read of the root-level `.env` (zero-level globstar)', async () => {
    const e = new PolicyEngine(compilePolicyYaml(DENY_ENV));
    const root = await e.decide({ toolName: 'Read', arguments: { path: '.env' } });
    expect(root.action).toBe('deny');
    expect(root.ruleRef).toContain('fs-deny-read');
    // nested credentials remain denied too
    const nested = await e.decide({ toolName: 'Read', arguments: { path: 'a/.env' } });
    expect(nested.action).toBe('deny');
    expect(nested.ruleRef).toContain('fs-deny-read');
    // a non-.env file is not denied by this rule (Read needs a `read` spec so
    // profile compare approves it — otherwise it'd fail-closed on danger)
    const readSpec = { requiredPermission: 'read' as const };
    const ok = await e.decide({ toolName: 'Read', arguments: { path: 'index.ts' } }, readSpec);
    expect(ok.action).not.toBe('deny');
  });
});
