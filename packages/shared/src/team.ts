import type { ExecutionBudget } from './lifecycle.js';

/**
 * ARC-10 (Subagent / Team / Task Queue) shared contract.
 *
 * Principle (architecture plan §10): an Agent is **not a second runtime** — it is
 * a scoped configuration executed by the *same* AgentLoop. These types only
 * describe scheduling identity, scoping, leases and tree topology; they carry no
 * execution mechanism of their own.
 */

/** Lifecycle of one schedulable unit in the team task tree (UI-016 status badges). */
export const TASK_TREE_STATUSES = ['pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'] as const;
export type TaskTreeStatus = typeof TASK_TREE_STATUSES[number];

/** Statuses from which no further transition is possible. */
export const TASK_TREE_TERMINAL_STATUSES: readonly TaskTreeStatus[] = ['completed', 'failed', 'cancelled'];

export const TASK_LEASE_RELEASE_REASONS = ['completed', 'failed', 'timeout', 'cancelled', 'waiting_approval'] as const;
export type TaskLeaseReleaseReason = typeof TASK_LEASE_RELEASE_REASONS[number];

/**
 * A scoped agent configuration. Every field is a *reference* — never inline
 * behavior/policy content — so a child instance cannot smuggle in a wider scope.
 */
export interface AgentInstanceSpec {
  instanceId: string;
  parentInstanceId?: string;
  modelProfileRef: string;
  behaviorSnapshotRef: string;
  policyScopeRef: string;
  contextScopeRef: string;
  toolScopeRef: string;
  budget: ExecutionBudget;
}

/**
 * Concrete, intersectable permission surface. Narrowing is **monotonic**: the
 * effective scope of a child is never wider than its parent's, the preset's, or
 * the global policy's (`ParentScope ∩ PresetScope ∩ GlobalPolicy`).
 *
 * `'*'` means "all" (wildcard). An empty list means "none".
 */
export interface PermissionScope {
  allowedTools: string[];
  deniedTools: string[];
  writablePaths: string[];
  network: boolean;
  approvals: 'inherit' | 'ask' | 'never';
}

/** Lease over one task instance: the holder owns execution until it expires. */
export interface TaskLease {
  leaseId: string;
  instanceId: string;
  holder: string;
  attempt: number;
  acquiredAt: number;
  expiresAt: number;
  releasedAt?: number;
  releaseReason?: TaskLeaseReleaseReason;
}

export interface TaskTreeResult {
  output: string;
  artifacts?: string[];
  structured?: Record<string, unknown>;
  stopReason?: 'completed' | 'failed' | 'cancelled';
}

/** Deterministic roll-up of a node's direct children (parent result aggregation). */
export interface TaskTreeAggregate {
  completedChildren: string[];
  failedChildren: string[];
  cancelledChildren: string[];
  outputs: Record<string, string>;
}

export interface TaskTreeNode {
  instanceId: string;
  parentInstanceId?: string;
  title: string;
  status: TaskTreeStatus;
  dependencies: string[];
  spec: AgentInstanceSpec;
  /** effective scope after monotonic narrowing (never wider than the inputs). */
  permissionScope: PermissionScope;
  lease?: TaskLease;
  attempt: number;
  createdAt: number;
  startedAt?: number;
  settledAt?: number;
  durationMs?: number;
  result?: TaskTreeResult;
  error?: string;
  /** present on nodes cancelled by cascade propagation. */
  cancellation?: { reason: string; originInstanceId: string };
  /** present on coordinator nodes once their children are settled. */
  aggregate?: TaskTreeAggregate;
  children: string[];
}

export interface TaskTreeSnapshot {
  rootInstanceId: string;
  projectRoot: string;
  nodes: TaskTreeNode[];
  updatedAt: number;
}

/** Default global scope: everything allowed, narrowed only by explicit inputs. */
export function defaultPermissionScope(): PermissionScope {
  return { allowedTools: ['*'], deniedTools: [], writablePaths: ['*'], network: true, approvals: 'inherit' };
}

const APPROVAL_RANK: Record<PermissionScope['approvals'], number> = { inherit: 0, ask: 1, never: 2 };

/** Wildcard-aware allowlist intersection (monotonic: result ⊆ each input). */
function intersectAllow(lists: readonly (readonly string[])[]): string[] {
  const concrete = lists.filter((list) => !list.includes('*'));
  if (concrete.length === 0) return ['*'];
  let result = new Set(concrete[0]);
  for (const list of concrete.slice(1)) {
    const allowed = new Set(list);
    result = new Set([...result].filter((item) => allowed.has(item)));
  }
  return [...result].sort();
}

function unionValues(lists: readonly (readonly string[])[]): string[] {
  const set = new Set<string>();
  for (const list of lists) for (const item of list) if (item !== '*') set.add(item);
  return [...set].sort();
}

/**
 * Monotonic narrowing of permission scopes: the effective scope can only ever
 * *lose* capabilities, never gain them. `deniedTools` unions (a deny anywhere
 * wins); allowlists/paths intersect; `network` ANDs; `approvals` takes the
 * strictest rank.
 */
export function narrowPermissionScope(...scopes: readonly (PermissionScope | undefined)[]): PermissionScope {
  const present = scopes.filter((scope): scope is PermissionScope => scope !== undefined);
  if (present.length === 0) return defaultPermissionScope();
  return {
    allowedTools: intersectAllow(present.map((scope) => scope.allowedTools)),
    deniedTools: unionValues(present.map((scope) => scope.deniedTools)),
    writablePaths: intersectAllow(present.map((scope) => scope.writablePaths)),
    network: present.every((scope) => scope.network),
    approvals: present.reduce<PermissionScope['approvals']>((strictest, scope) =>
      APPROVAL_RANK[scope.approvals] > APPROVAL_RANK[strictest] ? scope.approvals : strictest, 'inherit'),
  };
}

/**
 * True when `child` is no wider than `parent` on every dimension:
 * allows are a subset, denies a superset, paths a subset, network cannot be
 * gained, and the approval strictness rank cannot be relaxed.
 */
export function scopeIsSubset(child: PermissionScope, parent: PermissionScope): boolean {
  const allowSubset = (a: readonly string[], b: readonly string[]): boolean =>
    b.includes('*') || (!a.includes('*') && a.every((item) => b.includes(item)));
  const deniesAtLeast = (a: readonly string[], b: readonly string[]): boolean => b.every((item) => a.includes(item));
  return allowSubset(child.allowedTools, parent.allowedTools)
    && deniesAtLeast(child.deniedTools, parent.deniedTools)
    && allowSubset(child.writablePaths, parent.writablePaths)
    && (!child.network || parent.network)
    && APPROVAL_RANK[child.approvals] >= APPROVAL_RANK[parent.approvals];
}

export function taskTreeStatusIsTerminal(status: TaskTreeStatus): boolean {
  return TASK_TREE_TERMINAL_STATUSES.includes(status);
}

/** A lease is active while unreleased and not past its expiry. */
export function taskLeaseActive(lease: TaskLease | undefined, now = Date.now()): boolean {
  return !!lease && lease.releasedAt === undefined && lease.expiresAt > now;
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`invalid AgentInstanceSpec.${field}`);
}

/** Fail fast on structurally invalid specs (never coerce a wider scope into existence). */
export function assertAgentInstanceSpec(spec: AgentInstanceSpec): void {
  requireNonEmpty(spec.instanceId, 'instanceId');
  requireNonEmpty(spec.modelProfileRef, 'modelProfileRef');
  requireNonEmpty(spec.behaviorSnapshotRef, 'behaviorSnapshotRef');
  requireNonEmpty(spec.policyScopeRef, 'policyScopeRef');
  requireNonEmpty(spec.contextScopeRef, 'contextScopeRef');
  requireNonEmpty(spec.toolScopeRef, 'toolScopeRef');
  if (spec.parentInstanceId !== undefined) requireNonEmpty(spec.parentInstanceId, 'parentInstanceId');
  const budget = spec.budget;
  if (!budget || typeof budget !== 'object') throw new Error('invalid AgentInstanceSpec.budget');
  const positive: (keyof ExecutionBudget)[] = ['maxModelSteps', 'maxToolCalls', 'maxElapsedMs', 'maxConsecutiveErrors'];
  for (const key of positive) {
    const value = budget[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`invalid AgentInstanceSpec.budget.${key}`);
  }
}
