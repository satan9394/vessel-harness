import { expect, it } from 'vitest';
import { canonicalArgumentsHash, type CanonicalToolInvocation } from '@vessel/shared';
import { PolicyEngine } from './Engine.js';
import { compilePolicyYaml } from '../risk/Compiler.js';

it('policy reload revokes every permit issued under the prior snapshot', () => {
  const artifacts = compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never');
  const engine = new PolicyEngine(artifacts);
  const operation: CanonicalToolInvocation = { canonicalToolId: 'builtin:Read', subject: { sessionId: 's', runId: 'r', agentInstanceId: 'a' }, argumentsCanonicalHash: canonicalArgumentsHash({ path: 'a' }), requestedScopes: ['read'] };
  const permit = engine.permits.issue(operation);
  expect(engine.permits.validate(permit, operation)).toBe(true);
  engine.update(artifacts);
  expect(engine.permits.consume(permit, operation)).toBe(false);
  expect(engine.permits.consume(engine.permits.issue(operation), operation)).toBe(true);
});

it('argument fingerprints preserve semantic changes and normalize key order', () => {
  expect(canonicalArgumentsHash({ a: [1, { c: true, b: 'v' }] })).toBe(canonicalArgumentsHash({ a: [1, { b: 'v', c: true }] }));
  expect(canonicalArgumentsHash({ path: 'a' })).not.toBe(canonicalArgumentsHash({ path: 'b' }));
  expect(() => canonicalArgumentsHash({ value: undefined })).toThrow();
  expect(() => canonicalArgumentsHash({ value: new Date() })).toThrow();
});
