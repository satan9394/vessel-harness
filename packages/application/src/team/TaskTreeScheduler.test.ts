import { describe, expect, it } from 'vitest';
import type { AgentInstanceSpec, PermissionScope, TaskTreeNode, TaskTreeStatus } from '@vessel/shared';
import { CyclicTaskDependencyError, TaskTreeRegistry, TaskTreeScheduler, type TaskExecutionOutcome, type TaskTreeTaskInput } from './TaskTreeScheduler.js';

const budget = { maxModelSteps: 4, maxToolCalls: 8, maxElapsedMs: 30_000, maxConsecutiveErrors: 2 };

function spec(id: string, parentInstanceId?: string): AgentInstanceSpec {
  return {
    instanceId: id,
    parentInstanceId,
    modelProfileRef: 'model:mock',
    behaviorSnapshotRef: 'sha256:snap',
    policyScopeRef: 'policy:workspace-write',
    contextScopeRef: 'context:default',
    toolScopeRef: `tools:${id}`,
    budget,
  };
}

function statuses(nodes: TaskTreeNode[]): Record<string, TaskTreeStatus> {
  return Object.fromEntries(nodes.map((node) => [node.instanceId, node.status]));
}

describe('TaskTreeScheduler dependency DAG', () => {
  it('runs dependencies before dependents and aggregates child results', async () => {
    const seen: string[] = [];
    const tasks: TaskTreeTaskInput[] = [
      { spec: spec('root'), title: 'coordinator' },
      { spec: spec('a', 'root'), title: 'a' },
      { spec: spec('b', 'root'), title: 'b' },
      { spec: spec('c', 'root'), title: 'c', dependencies: ['a'] },
    ];
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root', tasks, maxConcurrency: 1,
      executor: async (node): Promise<TaskExecutionOutcome> => {
        seen.push(node.instanceId);
        return { status: 'completed', result: { output: `${node.instanceId}-out` } };
      },
    });
    const snapshot = await scheduler.run();
    expect(statuses(snapshot.nodes)).toEqual({ root: 'completed', a: 'completed', b: 'completed', c: 'completed' });
    expect(seen.indexOf('c')).toBeGreaterThan(seen.indexOf('a'));
    const root = snapshot.nodes.find((node) => node.instanceId === 'root')!;
    expect(root.children).toEqual(['a', 'b', 'c']);
    expect(root.aggregate).toEqual({ completedChildren: ['a', 'b', 'c'], failedChildren: [], cancelledChildren: [], outputs: { a: 'a-out', b: 'b-out', c: 'c-out' } });
  });

  it('rejects cycles deterministically', () => {
    expect(() => new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root',
      tasks: [
        { spec: spec('root'), title: 'root' },
        { spec: spec('a', 'root'), title: 'a', dependencies: ['b'] },
        { spec: spec('b', 'root'), title: 'b', dependencies: ['a'] },
      ],
      executor: async () => ({ status: 'completed', result: { output: '' } }),
    })).toThrow(CyclicTaskDependencyError);
  });

  it('cancels dependents when a dependency fails and records aggregated failures', async () => {
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root',
      tasks: [
        { spec: spec('root'), title: 'root' },
        { spec: spec('a', 'root'), title: 'a' },
        { spec: spec('b', 'root'), title: 'b', dependencies: ['a'] },
      ],
      executor: async (node) => node.instanceId === 'a' ? { status: 'failed', error: 'boom' } : { status: 'completed', result: { output: node.instanceId } },
    });
    const snapshot = await scheduler.run();
    const b = snapshot.nodes.find((node) => node.instanceId === 'b')!;
    expect(b.status).toBe('cancelled');
    expect(b.cancellation?.reason).toBe('blocked_by_failed_dependency');
    const root = snapshot.nodes.find((node) => node.instanceId === 'root')!;
    expect(root.aggregate?.failedChildren).toEqual(['a']);
    expect(root.aggregate?.cancelledChildren).toEqual(['b']);
  });
});

describe('TaskTreeScheduler leases and timeouts', () => {
  it('fails a node whose lease expires and cascades to its children', async () => {
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root', leaseTtlMs: 30,
      tasks: [
        { spec: spec('root'), title: 'root' },
        { spec: spec('slow', 'root'), title: 'slow' },
        { spec: spec('child', 'slow'), title: 'child' },
      ],
      executor: async (node, signal) => {
        if (node.instanceId !== 'slow') return { status: 'completed', result: { output: node.instanceId } };
        return new Promise<TaskExecutionOutcome>((resolve) => {
          const fail = () => resolve({ status: 'failed', error: 'aborted' });
          if (signal.aborted) return fail();
          signal.addEventListener('abort', fail, { once: true });
        });
      },
    });
    const snapshot = await scheduler.run();
    const slow = snapshot.nodes.find((node) => node.instanceId === 'slow')!;
    expect(slow.status).toBe('failed');
    expect(slow.error).toBe('lease_timeout');
    expect(slow.lease?.releaseReason).toBe('timeout');
    const child = snapshot.nodes.find((node) => node.instanceId === 'child')!;
    expect(child.status).toBe('cancelled');
    expect(child.cancellation).toEqual({ reason: 'lease_timeout', originInstanceId: 'slow' });
  });

  it('propagates a parent cancellation to every descendant with a stable origin', async () => {
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root',
      tasks: [
        { spec: spec('root'), title: 'root' },
        { spec: spec('a', 'root'), title: 'a' },
        { spec: spec('b', 'a'), title: 'b' },
      ],
      executor: async (_node, signal) => new Promise<TaskExecutionOutcome>((resolve) => {
        const fail = () => resolve({ status: 'failed', error: 'aborted' });
        if (signal.aborted) return fail();
        signal.addEventListener('abort', fail, { once: true });
      }),
    });
    const running = scheduler.run();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(scheduler.cancel('root', 'user_cancelled')).toBe(true);
    const snapshot = await running;
    expect(statuses(snapshot.nodes)).toEqual({ root: 'cancelled', a: 'cancelled', b: 'cancelled' });
    for (const node of snapshot.nodes) expect(node.cancellation).toEqual({ reason: 'user_cancelled', originInstanceId: 'root' });
  });
});

describe('TaskTreeScheduler approval + scoping + registry', () => {
  it('gates on approval, then re-queues on approval and settles on the next run', async () => {
    let approved = false;
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root',
      tasks: [{ spec: spec('root'), title: 'root' }, { spec: spec('gate', 'root'), title: 'gate' }],
      executor: async (node) => {
        if (node.instanceId === 'gate' && !approved) return { status: 'waiting_approval', approvalId: 'ap-1' };
        return { status: 'completed', result: { output: node.instanceId } };
      },
    });
    const first = await scheduler.run();
    expect(first.nodes.find((node) => node.instanceId === 'gate')!.status).toBe('waiting_approval');
    expect(scheduler.resolveApproval('gate', 'approved')).toBe(true);
    approved = true;
    const second = await scheduler.run();
    expect(second.nodes.find((node) => node.instanceId === 'gate')!.status).toBe('completed');
    expect(second.nodes.find((node) => node.instanceId === 'gate')!.attempt).toBe(2);
  });

  it('denies approval by cancelling the gate and its subtree', async () => {
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root',
      tasks: [
        { spec: spec('root'), title: 'root' },
        { spec: spec('gate', 'root'), title: 'gate' },
        { spec: spec('leaf', 'gate'), title: 'leaf', dependencies: ['gate'] },
      ],
      executor: async (node) => node.instanceId === 'gate' ? { status: 'waiting_approval', approvalId: 'ap' } : { status: 'completed', result: { output: node.instanceId } },
    });
    await scheduler.run();
    expect(scheduler.resolveApproval('gate', 'denied')).toBe(true);
    const after = scheduler.snapshot();
    expect(after.nodes.find((node) => node.instanceId === 'gate')!.status).toBe('cancelled');
    expect(after.nodes.find((node) => node.instanceId === 'leaf')!.status).toBe('cancelled');
  });

  it('narrows child scope by parent ∩ preset ∩ global and never widens', async () => {
    const global: PermissionScope = { allowedTools: ['Read', 'Write', 'Bash', 'Web'], deniedTools: [], writablePaths: ['*'], network: true, approvals: 'inherit' };
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root', globalScope: global,
      tasks: [
        { spec: spec('root'), title: 'root', presetScope: { allowedTools: ['Read', 'Write'], deniedTools: ['Write'], writablePaths: ['/repo'], network: true, approvals: 'inherit' } },
        { spec: spec('child', 'root'), title: 'child', presetScope: { allowedTools: ['*'], deniedTools: [], writablePaths: ['*'], network: true, approvals: 'never' } },
      ],
      executor: async (node) => ({ status: 'completed', result: { output: node.instanceId } }),
    });
    const snapshot = await scheduler.run();
    const root = snapshot.nodes.find((node) => node.instanceId === 'root')!;
    const child = snapshot.nodes.find((node) => node.instanceId === 'child')!;
    expect(root.permissionScope.allowedTools).toEqual(['Read', 'Write']);
    expect(child.permissionScope.allowedTools).toEqual(['Read', 'Write']);
    expect(child.permissionScope.deniedTools).toEqual(['Write']);
    expect(child.permissionScope.approvals).toBe('never');
  });

  it('publishes snapshots to the shared registry', async () => {
    const registry = new TaskTreeRegistry();
    const scheduler = new TaskTreeScheduler({
      projectRoot: '/repo', rootInstanceId: 'root', registry,
      tasks: [{ spec: spec('root'), title: 'root' }],
      executor: async () => ({ status: 'completed', result: { output: 'done' } }),
    });
    await scheduler.run();
    const published = registry.get('root');
    expect(published?.projectRoot).toBe('/repo');
    expect(published?.nodes[0]!.status).toBe('completed');
    expect(registry.list()).toHaveLength(1);
  });
});
