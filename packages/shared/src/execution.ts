import { createHash, randomUUID } from 'node:crypto';

export interface ExecutionSubject { sessionId: string; runId: string; agentInstanceId: string }
export interface CanonicalToolInvocation {
  canonicalToolId: string;
  subject: ExecutionSubject;
  argumentsCanonicalHash: string;
  requestedScopes: string[];
}
export interface ExecutionPermit extends CanonicalToolInvocation {
  policyRevision: number;
  expiresAt: number;
  nonce: string;
}
export interface ExecutionPermitAuthority {
  issue(invocation: CanonicalToolInvocation): ExecutionPermit;
  validate(permit: ExecutionPermit, invocation: CanonicalToolInvocation): boolean;
  consume(permit: ExecutionPermit, invocation: CanonicalToolInvocation): boolean;
}

/** JSON arguments have one stable fingerprint, regardless of object key insertion order. */
export function canonicalArgumentsHash(value: unknown): string {
  function canonical(input: unknown): string {
    if (Array.isArray(input)) return '[' + input.map(canonical).join(',') + ']';
    if (input !== null && typeof input === 'object') {
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) throw new TypeError('Execution arguments must be plain JSON');
      return '{' + Object.keys(input).sort().map(key => JSON.stringify(key) + ':' + canonical((input as Record<string, unknown>)[key])).join(',') + '}';
    }
    const result = JSON.stringify(input);
    if (result === undefined || (typeof input === 'number' && !Number.isFinite(input))) throw new TypeError('Execution arguments must be JSON');
    return result;
  }
  return createHash('sha256').update(canonical(value)).digest('hex');
}

/** In-process capability: only original, immutable objects issued by the host validate.
 * Serialized/agent-constructed JSON cannot recreate authority. Cross-process transport
 * must use a separately authenticated authority rather than serializing this capability.
 */
export function createExecutionPermitAuthority(revision: () => number, now = Date.now, ttlMs = 30_000): ExecutionPermitAuthority {
  const pending = new WeakSet<ExecutionPermit>();
  const validate = (permit: ExecutionPermit, invocation: CanonicalToolInvocation) => pending.has(permit) && permit.expiresAt > now() && permit.policyRevision === revision() && canonicalArgumentsHash(invocation) === canonicalArgumentsHash({ canonicalToolId: permit.canonicalToolId, subject: permit.subject, argumentsCanonicalHash: permit.argumentsCanonicalHash, requestedScopes: permit.requestedScopes });
  return {
    issue(invocation) {
      const permit: ExecutionPermit = Object.freeze({ ...invocation, subject: Object.freeze({ ...invocation.subject }), requestedScopes: Object.freeze([...invocation.requestedScopes]) as unknown as string[], policyRevision: revision(), expiresAt: now() + ttlMs, nonce: randomUUID() });
      pending.add(permit);
      return permit;
    },
    validate,
    consume(permit, invocation) {
      const valid = validate(permit, invocation);
      pending.delete(permit);
      return valid;
    },
  };
}
