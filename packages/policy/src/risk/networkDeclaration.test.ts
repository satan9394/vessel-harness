import { describe, expect, it } from 'vitest';
import { compilePolicyYaml } from './Compiler.js';
import { PolicyEngine } from '../engine/Engine.js';

const POLICY = 'policy:\n  version: "0.1"\n  profile: danger-full-access\n  approval: never\n  network:\n    deny_domains: [169.254.169.254]\n';
const calls = [
    { toolName: 'Shell', arguments: { command: 'curl http://169.254.169.254/latest/meta-data/' } },
    { toolName: 'WebFetch', arguments: { url: 'http://169.254.169.254/x' } },
    { toolName: 'Shell', arguments: { command: 'echo 169.254.169.254' } },
    { toolName: 'Shell', arguments: { command: 'echo hello' } },
];

describe('network declarations are not enforcement', () => {
  it('marks domain declarations unenforced and excludes executable rule fields', () => {
    const artifacts = compilePolicyYaml(POLICY);
    expect(artifacts.rules).toEqual([]);
    expect(artifacts.declarationOnly).toEqual([{
      id: 'net-deny:169.254.169.254', domain: 'network', enforced: false,
      reason: 'declared denied domain: 169.254.169.254; not enforced in v0.1; proxy enforcement deferred to v0.2',
    }]);
    expect(artifacts.declarationOnly![0]).not.toHaveProperty('match');
    expect(artifacts.declarationOnly![0]).not.toHaveProperty('action');
  });

  it('does not deny calls merely containing a declared domain', async () => {
    const engine = new PolicyEngine(compilePolicyYaml(POLICY));
    // Decision-only probes: no Shell command or fictitious WebFetch is executed.
    for (const call of calls) {
      expect(await engine.decide(call)).toMatchObject({ action: 'allow' });
    }
  });

  it('still denies force push under full access with the actual rule reference', async () => {
    const engine = new PolicyEngine(compilePolicyYaml(POLICY + '  git:\n    force_push: deny\n'));
    expect(await engine.decide({ toolName: 'Shell', arguments: { command: 'git push --force origin main' } }))
      .toMatchObject({ action: 'deny', ruleRef: 'git:force-push', decisionPath: ['rule:git:force-push'] });
    expect(await engine.decide({ toolName: 'Shell', arguments: { command: 'git push origin main' } }))
      .toMatchObject({ action: 'allow' });
  });

  it('still denies through profile and approval independently of domain text', async () => {
    const engine = new PolicyEngine(compilePolicyYaml(POLICY.replace('profile: danger-full-access', 'profile: workspace-write')));
    for (const call of [calls[0]!, calls[3]!]) {
      expect(await engine.decide(call, { requiredPermission: 'danger-full-access' })).toMatchObject({
        action: 'deny', ruleRef: 'policy-never',
        decisionPath: ['profile:workspace-write:danger-full-access', 'approval:never'],
      });
    }
  });
});
