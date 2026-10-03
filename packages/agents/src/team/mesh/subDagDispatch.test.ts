import { describe, it, expect } from 'vitest';
import type { TeamDagTask } from '../dag/types.js';
import { connect, startNode, roster } from './__tests__/helpers.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { compilePolicyYaml } from '@vessel/policy';
import { createTeamMeshExecution } from '../../../../../apps/local-server/src/meshExecution.js';
import type { ChatRequest } from '@vessel/shared';
import { NativeMeshEventBus } from './NativeMeshEventBus.js';
import { TeamDagScheduler } from '../dag/DagScheduler.js';

const task = (id: string, dependencies: string[] = []): TeamDagTask => ({ id, title: id, description: id, assignedRole: 'generator', dependencies, status: 'pending' });
describe('remote sub-DAG execution', () => {
  it('streams large frames with backpressure and paginates replay beyond 1 MiB', async () => {
    const a = await startNode(); const b = await startNode({ roster: roster(), async execute() { return { output: 'x'.repeat(150000), artifacts: [] }; } });
    try {
      await connect(a, b); a.mesh.registerDag('large', [task('a'), task('b'), task('c')], 'ref', {});
      const events: number[] = []; const off = a.mesh.subscribePeerEvents(b.descriptor.nodeId, e => events.push(e.seq));
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, { dagId: 'large', subGraphNodes: ['a', 'b', 'c'], contextSnapshotRef: 'ref' });
      await expect.poll(() => a.mesh.dagSnapshot('large').every(t => t.status === 'completed')).toBe(true);
      expect(events).toEqual([1, 2, 3, 4, 5, 6]); off();
      const replay = new NativeMeshEventBus(structuredClone(a.descriptor));
      try { replay.trustPeer(b.descriptor); await replay.reconcilePeer(b.descriptor.nodeId); expect(replay.remoteSnapshot(b.descriptor.nodeId, 'large')!.seq).toBe(6); }
      finally { await replay.close(); }
    } finally { await a.close(); await b.close(); }
  });
  it('releases sender reservations after a deterministic receiver rejection', async () => {
    const a = await startNode(); const b = await startNode(); const c = await startNode({ roster: roster(), async execute() { return { output: 'ok', artifacts: [] }; } });
    try {
      await connect(a, b); await connect(a, c); a.mesh.registerDag('retry', [task('a')], 'ref', {});
      const branch = { dagId: 'retry', subGraphNodes: ['a'], contextSnapshotRef: 'ref' };
      await expect(a.mesh.dispatchSubDag(b.descriptor.nodeId, branch)).rejects.toThrow('503');
      await a.mesh.dispatchSubDag(c.descriptor.nodeId, branch); await a.mesh.reconcilePeer(c.descriptor.nodeId);
      expect(a.mesh.dagSnapshot('retry')[0]!.status).toBe('completed');
    } finally { await a.close(); await b.close(); await c.close(); }
  });
  it('interrupts an in-flight production member when the mesh closes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mesh-abort-')); let started = false; let aborted = false;
    const execution = createTeamMeshExecution({ workspaceRoot: dir, tools: [], policyArtifacts: compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never'), providers: { mock: {
      id: 'mock', async chat(req) { started = true; return await new Promise((_, reject) => { req.signal!.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); }, { once: true }); }); },
    } } }, [{ presetId: 'developer', providerId: 'mock', model: 'mock' }]);
    const a = await startNode(); const b = await startNode(execution);
    try {
      await connect(a, b); a.mesh.registerDag('cancel', [task('a')], 'ref', {});
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, { dagId: 'cancel', subGraphNodes: ['a'], contextSnapshotRef: 'ref' });
      await expect.poll(() => started).toBe(true); await b.close(); expect(aborted).toBe(true);
    } finally { await a.close(); await b.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('executes the production TeamRuntime adapter offline with dependency handoff after automatic stream reconnect', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mesh-'));
    const requests: ChatRequest[] = [];
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const execution = createTeamMeshExecution({ workspaceRoot: dir, tools: [], policyArtifacts: compilePolicyYaml('policy:\n  version: 1\n  profile: workspace-write\n  approval: never'), providers: { mock: {
      id: 'mock', async chat(req) { requests.push(req); if (requests.length === 1) await barrier; return { content: 'remote output'.repeat(100), toolCalls: [], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1 } }; },
    } } }, [{ presetId: 'developer', providerId: 'mock', model: 'mock' }]);
    const a = await startNode(); const b = await startNode(execution);
    try {
      await connect(a, b); a.mesh.registerDag('real-runtime', [task('a'), task('b', ['a'])], 'ref', { data: 'snapshot' });
      const events: number[] = []; const off = a.mesh.subscribePeerEvents(b.descriptor.nodeId, e => events.push(e.seq));
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, { dagId: 'real-runtime', subGraphNodes: ['a', 'b'], contextSnapshotRef: 'ref' });
      await expect.poll(() => requests.length).toBe(1);
      b.mesh.disconnectStreams(); release();
      await expect.poll(() => a.mesh.remoteSnapshot(b.descriptor.nodeId, 'real-runtime')?.tasks.every(t => t.status === 'completed')).toBe(true);
      expect(events).toEqual([1, 2, 3, 4]); expect(requests).toHaveLength(2);
      expect(requests[1]!.messages.some(m => m.content.includes(`Completed dependency outputs:\n${'remote output'.repeat(100)}`))).toBe(true);
      expect(a.mesh.dagSnapshot('real-runtime')[1]!.result!.output).toBe('remote output'.repeat(100));
      off();
    } finally { release(); await a.close(); await b.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('serializes dependency-closed branches, streams task states/context/diff and reconciles dropped events without rerunning', async () => {
    let calls = 0;
    const a = await startNode(); const b = await startNode({ roster: roster(), async execute(t, context) { calls++; expect(context).toEqual({ brief: 'offline' }); return { output: t.id, artifacts: ['result.txt'], artifactDiffs: [{ path: 'result.txt', diff: '+result' }] }; } });
    try {
      await connect(a, b); a.mesh.registerDag('dag', [task('a'), task('b', ['a']), task('other')], 'snapshot', { brief: 'offline' });
      const events: number[] = []; const off = a.mesh.subscribePeerEvents(b.descriptor.nodeId, e => events.push(e.seq));
      await expect(a.mesh.dispatchSubDag(b.descriptor.nodeId, { dagId: 'dag', subGraphNodes: ['b'], contextSnapshotRef: 'snapshot' })).rejects.toThrow('dependency');
      const branch = { dagId: 'dag', subGraphNodes: ['a', 'b'], contextSnapshotRef: 'snapshot' };
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, branch);
      await expect.poll(() => a.mesh.remoteSnapshot(b.descriptor.nodeId, 'dag')?.tasks.every(t => t.status === 'completed')).toBe(true);
      expect(events).toEqual([1, 2, 3, 4]); expect(calls).toBe(2);
      off(); b.mesh.disconnectStreams();
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, { ...branch, subGraphNodes: ['other'] });
      const off2 = a.mesh.subscribePeerEvents(b.descriptor.nodeId, e => events.push(e.seq));
      await expect.poll(() => a.mesh.remoteSnapshot(b.descriptor.nodeId, 'dag')?.tasks.length).toBe(3);
      await a.mesh.reconcilePeer(b.descriptor.nodeId); expect(events).toEqual([1, 2, 3, 4, 5, 6]);
      expect(a.mesh.remoteSnapshot(b.descriptor.nodeId, 'dag')!.artifactDiffs).toEqual([{ path: 'result.txt', diff: '+result' }]);
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, branch); expect(calls).toBe(3);
      await expect(a.mesh.dispatchSubDag(b.descriptor.nodeId, { ...branch, subGraphNodes: ['a'] })).rejects.toThrow('409');
      off2();
    } finally { await a.close(); await b.close(); }
  });
  it('propagates failed dependencies and rejects missing nodes, context refs and role capability', async () => {
    const a = await startNode(); const b = await startNode({ roster: roster(), async execute() { throw new Error('offline failure'); } });
    try {
      await connect(a, b); a.mesh.registerDag('dag', [task('a'), task('b', ['a'])], 'ref', {});
      const branch = { dagId: 'dag', subGraphNodes: ['a', 'b'], contextSnapshotRef: 'ref' };
      await expect(a.mesh.dispatchSubDag(b.descriptor.nodeId, { ...branch, contextSnapshotRef: 'unknown' })).rejects.toThrow('invalid');
      await expect(a.mesh.dispatchSubDag(b.descriptor.nodeId, { ...branch, subGraphNodes: ['unknown'] })).rejects.toThrow();
      const limited = await startNode();
      try { limited.descriptor.roleCapabilities = ['evaluator']; await connect(a, limited); await expect(a.mesh.dispatchSubDag(limited.descriptor.nodeId, branch)).rejects.toThrow('capability'); }
      finally { await limited.close(); }
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, branch); await a.mesh.reconcilePeer(b.descriptor.nodeId);
      expect(a.mesh.remoteSnapshot(b.descriptor.nodeId, 'dag')!.tasks.map(t => t.status)).toEqual(['failed', 'failed']);
    } finally { await a.close(); await b.close(); }
  });
  it('aggregates branches across peers and prevents global duplicate delegation', async () => {
    const execution = { roster: roster(), async execute(t: TeamDagTask) { return { output: t.id, artifacts: [] }; } };
    const a = await startNode(); const b = await startNode(execution); const c = await startNode(execution);
    try {
      await connect(a, b); await connect(a, c); a.mesh.registerDag('global', [task('left'), task('right')], 'ref', {});
      await a.mesh.dispatchSubDag(b.descriptor.nodeId, { dagId: 'global', subGraphNodes: ['left'], contextSnapshotRef: 'ref' });
      await expect(a.mesh.dispatchSubDag(c.descriptor.nodeId, { dagId: 'global', subGraphNodes: ['left'], contextSnapshotRef: 'ref' })).rejects.toThrow('already delegated');
      await a.mesh.dispatchSubDag(c.descriptor.nodeId, { dagId: 'global', subGraphNodes: ['right'], contextSnapshotRef: 'ref' });
      await a.mesh.reconcilePeer(b.descriptor.nodeId); await a.mesh.reconcilePeer(c.descriptor.nodeId);
      expect(a.mesh.dagSnapshot('global').map(t => t.status)).toEqual(['completed', 'completed']);
      const members = roster();
      const parent = new TeamDagScheduler({ id: 'global', tasks: [task('left'), task('right')], roster: members, status: 'approved', createdAt: Date.now() });
      for (const id of ['left', 'right']) {
        parent.evaluateReadiness(); parent.claimTask(id, members[0]!.memberId); parent.startTask(id);
        await a.mesh.settleParent('global', parent);
      }
      expect(parent.isSettled()).toBe(true); expect(parent.snapshot().map(t => t.result!.output)).toEqual(['left', 'right']);
      await a.mesh.settleParent('global', parent); expect(parent.isSettled()).toBe(true);
    } finally { await a.close(); await b.close(); await c.close(); }
  });
});


