export class BehaviorCompileError extends Error {
  constructor(public readonly entryId: string, public readonly policyRef: string | null, reason = 'has no executable enforcement rule') {
    super(`behavior compile error: "${entryId}" (channel=runtime_policy, policy_ref=${policyRef ?? '<missing>'}) ${reason}`);
    this.name = 'BehaviorCompileError';
  }
}
