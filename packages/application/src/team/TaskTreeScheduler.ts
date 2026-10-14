import {
  assertAgentInstanceSpec,
  defaultPermissionScope,
  narrowPermissionScope,
  taskTreeStatusIsTerminal,
  type AgentInstanceSpec,
  type PermissionScope,
  type TaskLease,
  type TaskLeaseReleaseReason,
  type TaskTreeAggregate,
  type TaskTreeNode,
  type TaskTreeResult,
  type TaskTreeSnapshot,
} from '@vessel/shared';

/**
 * ARC-10 (architecture plan §10) — scheduling layer for scoped subagents.
 *
 * This module owns **only** dependency orchestration, leases, cancellation
 * propagation, result aggregation and monotonic permission narrowing. It never
 * executes a turn: real work is delegated to the injected `executor`, which must
 * reuse the existing AgentLoop (a second execution loop is forbidden).
 */

export type TaskTreeEvent =
  | { type: 'task:leased'; node: TaskTreeNode }
  | { type: 'task:started'; node: TaskTreeNode }
  | { type: 'task:waiting_approval'; node: TaskTreeNode }
  | { type: 'task:settled'; node: TaskTreeNode }
  | { type: 'task:failed'; node: TaskTreeNode }
  | { type: 'task:cancelled'; node: TaskTreeNode }
  | { type: 'lease:timeout'; node: TaskTreeNode }
  | { type: 'tree:updated'; snapshot: TaskTreeSnapshot };

export interface TaskTreeTaskInput {
  spec: AgentInstanceSpec;
  title: string;
  dependencies?: string[];
  /** optional preset facet, intersected (never widened) with parent + global scope. */
  presetScope?: PermissionScope;
}

export type TaskExecutionOutcome =
  | { status: 'completed'; result: TaskTreeResult }
  | { status: 'failed'; error: string }
  | { status: 'waiting_approval'; approvalId: string };

export type TaskTreeExecutor = (node: TaskTreeNode, signal: AbortSignal) => Promise<TaskExecutionOutcome>;

export interface TaskTreeSchedulerOptions {
  projectRoot: string;
  rootInstanceId: string;
  tasks: TaskTreeTaskInput[];
  executor: TaskTreeExecutor;
  globalScope?: PermissionScope;
  parentScope?: PermissionScope;
  leaseTtlMs?: number;
  maxConcurrency?: number;
  now?: () => number;
  leaseHolderId?: string;
  registry?: TaskTreeRegistry;
  onEvent?: (event: TaskTreeEvent) => void;
}

/** Cross-project store of published task-tree snapshots (read side of `/api/tasks/tree`). */
export class TaskTreeRegistry {
  private readonly trees = new Map<string, TaskTreeSnapshot>();

  publish(snapshot: TaskTreeSnapshot): void {
    this.trees.set(snapshot.rootInstanceId, structuredClone(snapshot));
  }
  get(rootInstanceId: string): TaskTreeSnapshot | undefined {
    const snapshot = this.trees.get(rootInstanceId);
    return snapshot ? structuredClone(snapshot) : undefined;
  }
  list(): TaskTreeSnapshot[] {
    return [...this.trees.values()].map((snapshot) => structuredClone(snapshot)).sort((a, b) => a.projectRoot.localeCompare(b.projectRoot) || a.rootInstanceId.localeCompare(b.rootInstanceId));
  }
  clear(): void { this.trees.clear(); }
}

export class CyclicTaskDependencyError extends Error {
  constructor(readonly cycle: string[]) { super(`task tree contains a cycle: ${cycle.join(' -> ')}`); this.name = 'CyclicTaskDependencyError'; }
}

export class TaskTreeScheduler {
  private readonly nodes = new Map<string, TaskTreeNode>();
  private readonly order: string[] = [];
  private readonly aborters = new Map<string, AbortController>();
  private readonly globalScope: PermissionScope;
  private readonly parentScope: PermissionScope;
  private readonly now: () => number;
  private readonly leaseTtlMs: number;
  private readonly maxConcurrency: number;
  private readonly leaseHolderId: string;
  private running = false;

  constructor(private readonly options: TaskTreeSchedulerOptions) {
    this.now = options.now ?? Date.now;
    this.leaseTtlMs = options.leaseTtlMs ?? 15 * 60_000;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 2);
    this.leaseHolderId = options.leaseHolderId ?? `scheduler:${options.rootInstanceId}`;
    this.globalScope = options.globalScope ?? defaultPermissionScope();
    this.parentScope = options.parentScope ?? this.globalScope;

    const inputs = new Map<string, TaskTreeTaskInput>();
    for (const task of options.tasks) {
      assertAgentInstanceSpec(task.spec);
      if (inputs.has(task.spec.instanceId)) throw new Error(`duplicate instance id: ${task.spec.instanceId}`);
      inputs.set(task.spec.instanceId, task);
    }
    const root = inputs.get(options.rootInstanceId);
    if (!root) throw new Error(`unknown root instance: ${options.rootInstanceId}`);
    if (root.spec.parentInstanceId) throw new Error('root instance must not declare a parent');
    const at = this.now();
    for (const task of options.tasks) {
      const { spec } = task;
      const dependencies = [...new Set(task.dependencies ?? [])];
      for (const dep of dependencies) if (!inputs.has(dep)) throw new Error(`unknown dependency: ${dep}`);
      if (spec.parentInstanceId && !inputs.has(spec.parentInstanceId)) throw new Error(`unknown parent instance: ${spec.parentInstanceId}`);
      const presetScope = task.presetScope;
      this.nodes.set(spec.instanceId, {
        instanceId: spec.instanceId,
        parentInstanceId: spec.parentInstanceId,
        title: task.title,
        status: 'pending',
        dependencies,
        spec,
        permissionScope: narrowPermissionScope(this.parentScope, presetScope, this.globalScope),
        attempt: 0,
        createdAt: at,
        children: [],
      });
      this.order.push(spec.instanceId);
    }
    // Second pass: link children and narrow scope against the *effective* parent scope.
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      if (!node.parentInstanceId) continue;
      const parent = this.nodes.get(node.parentInstanceId)!;
      parent.children.push(id);
      node.permissionScope = narrowPermissionScope(parent.permissionScope, inputs.get(id)!.presetScope, this.globalScope);
    }
    this.detectCycles();
  }

  private detectCycles(): void {
    const state = new Map<string, 0 | 1 | 2>();
    const stack: string[] = [];
    const visit = (id: string): void => {
      const mark = state.get(id) ?? 0;
      if (mark === 1) throw new CyclicTaskDependencyError([...stack.slice(stack.indexOf(id)), id]);
      if (mark === 2) return;
      state.set(id, 1);
      stack.push(id);
      for (const dep of this.nodes.get(id)!.dependencies) visit(dep);
      stack.pop();
      state.set(id, 2);
    };
    for (const id of this.order) visit(id);
  }

  private emit(event: TaskTreeEvent): void {
    this.options.onEvent?.(event);
    if (this.options.registry && event.type !== 'tree:updated') {
      this.options.registry.publish(this.snapshot());
    }
  }

  snapshot(): TaskTreeSnapshot {
    return {
      rootInstanceId: this.options.rootInstanceId,
      projectRoot: this.options.projectRoot,
      nodes: this.order.map((id) => structuredClone(this.nodes.get(id)!)),
      updatedAt: this.now(),
    };
  }

  node(instanceId: string): TaskTreeNode | undefined {
    const node = this.nodes.get(instanceId);
    return node ? structuredClone(node) : undefined;
  }

  /** Instances that are ready to run: pending with all dependencies completed. */
  private readyNodes(): TaskTreeNode[] {
    const ready: TaskTreeNode[] = [];
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      if (node.status !== 'pending') continue;
      const blocked = node.dependencies.some((dep) => {
        const status = this.nodes.get(dep)!.status;
        return status === 'failed' || status === 'cancelled';
      });
      if (blocked) continue;
      if (node.dependencies.every((dep) => this.nodes.get(dep)!.status === 'completed')) ready.push(node);
    }
    return ready;
  }

  private acquireLease(node: TaskTreeNode): void {
    const at = this.now();
    const lease: TaskLease = { leaseId: `${node.instanceId}:${node.attempt}:${at}`, instanceId: node.instanceId, holder: this.leaseHolderId, attempt: node.attempt + 1, acquiredAt: at, expiresAt: at + this.leaseTtlMs };
    node.lease = lease;
    this.emit({ type: 'task:leased', node: structuredClone(node) });
  }

  private releaseLease(node: TaskTreeNode, reason: TaskLeaseReleaseReason): void {
    if (!node.lease) return;
    node.lease.releasedAt = this.now();
    node.lease.releaseReason = reason;
  }

  async run(): Promise<TaskTreeSnapshot> {
    if (this.running) throw new Error('task tree scheduler already running');
    this.running = true;
    try {
      let progressed = true;
      while (progressed) {
        this.propagateBlocked();
        const ready = this.readyNodes();
        if (ready.length === 0) { progressed = false; break; }
        const batch = ready.slice(0, this.maxConcurrency);
        await Promise.all(batch.map((node) => this.runNode(node)));
      }
      this.aggregate();
      const snapshot = this.snapshot();
      this.options.registry?.publish(snapshot);
      return snapshot;
    } finally {
      this.running = false;
    }
  }

  /** Cancel a node and deterministically cascade to every descendant. */
  cancel(instanceId: string, reason = 'parent_cancelled'): boolean {
    const node = this.nodes.get(instanceId);
    if (!node || taskTreeStatusIsTerminal(node.status)) return false;
    this.cancelSubtree(node, reason, instanceId);
    return true;
  }

  private cancelSubtree(node: TaskTreeNode, reason: string, originInstanceId: string): void {
    if (taskTreeStatusIsTerminal(node.status)) return;
    this.aborters.get(node.instanceId)?.abort(new Error(`task cancelled: ${reason}`));
    this.releaseLease(node, 'cancelled');
    node.status = 'cancelled';
    node.settledAt = this.now();
    node.durationMs = node.startedAt === undefined ? undefined : node.settledAt - node.startedAt;
    node.cancellation = { reason, originInstanceId };
    this.emit({ type: 'task:cancelled', node: structuredClone(node) });
    for (const childId of node.children) this.cancelSubtree(this.nodes.get(childId)!, reason, originInstanceId);
  }

  /** Mark descendants of failed/cancelled dependencies as cancelled (blocked). */
  private propagateBlocked(): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of this.order) {
        const node = this.nodes.get(id)!;
        if (node.status !== 'pending') continue;
        const blocker = node.dependencies.find((dep) => {
          const status = this.nodes.get(dep)!.status;
          return status === 'failed' || status === 'cancelled';
        });
        if (blocker) {
          this.cancelSubtree(node, `blocked_by_${this.nodes.get(blocker)!.status}_dependency`, blocker);
          changed = true;
        }
      }
    }
  }

  private async runNode(node: TaskTreeNode): Promise<void> {
    node.attempt += 1;
    this.aborters.set(node.instanceId, new AbortController());
    const signal = this.aborters.get(node.instanceId)!.signal;
    node.status = 'running';
    node.startedAt = this.now();
    this.acquireLease(node);
    this.emit({ type: 'task:started', node: structuredClone(node) });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      this.aborters.get(node.instanceId)?.abort(new Error('lease timeout'));
    }, this.leaseTtlMs);

    let outcome: TaskExecutionOutcome;
    try {
      outcome = await this.options.executor(structuredClone(node), signal);
    } catch (error) {
      outcome = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }

    if (timedOut || taskTreeStatusIsTerminal(node.status)) {
      if (!taskTreeStatusIsTerminal(node.status)) {
        this.releaseLease(node, 'timeout');
        node.status = 'failed';
        node.error = 'lease_timeout';
        node.settledAt = this.now();
        node.durationMs = node.startedAt === undefined ? undefined : node.settledAt - node.startedAt;
        this.emit({ type: 'lease:timeout', node: structuredClone(node) });
        this.cancelSubtreeChildren(node, 'lease_timeout');
      }
      this.aborters.delete(node.instanceId);
      return;
    }

    node.settledAt = this.now();
    node.durationMs = node.startedAt === undefined ? undefined : node.settledAt - node.startedAt;
    if (outcome.status === 'completed') {
      node.status = 'completed';
      node.result = outcome.result;
      this.releaseLease(node, 'completed');
      this.emit({ type: 'task:settled', node: structuredClone(node) });
    } else if (outcome.status === 'waiting_approval') {
      node.status = 'waiting_approval';
      this.releaseLease(node, 'waiting_approval');
      this.emit({ type: 'task:waiting_approval', node: structuredClone(node) });
    } else {
      node.status = 'failed';
      node.error = outcome.error;
      this.releaseLease(node, 'failed');
      this.emit({ type: 'task:failed', node: structuredClone(node) });
      this.cancelSubtreeChildren(node, 'dependency_failed');
    }
    this.aborters.delete(node.instanceId);
  }

  private cancelSubtreeChildren(node: TaskTreeNode, reason: string): void {
    for (const childId of node.children) this.cancelSubtree(this.nodes.get(childId)!, reason, node.instanceId);
  }

  /** Resolve a `waiting_approval` gate. Approval re-queues the node for another run. */
  resolveApproval(instanceId: string, decision: 'approved' | 'denied'): boolean {
    const node = this.nodes.get(instanceId);
    if (!node || node.status !== 'waiting_approval') return false;
    if (decision === 'denied') {
      this.cancelSubtree(node, 'approval_denied', instanceId);
    } else {
      node.status = 'pending';
      node.lease = undefined;
      delete node.error;
    }
    return true;
  }

  /** Deterministic roll-up of each coordinator's direct children. */
  private aggregate(): void {
    for (const id of this.order) {
      const node = this.nodes.get(id)!;
      if (node.children.length === 0) continue;
      const aggregate: TaskTreeAggregate = { completedChildren: [], failedChildren: [], cancelledChildren: [], outputs: {} };
      for (const childId of node.children) {
        const child = this.nodes.get(childId)!;
        if (child.status === 'completed') aggregate.completedChildren.push(childId);
        else if (child.status === 'failed') aggregate.failedChildren.push(childId);
        else if (child.status === 'cancelled') aggregate.cancelledChildren.push(childId);
        if (child.result?.output) aggregate.outputs[childId] = child.result.output;
      }
      node.aggregate = aggregate;
    }
  }
}
