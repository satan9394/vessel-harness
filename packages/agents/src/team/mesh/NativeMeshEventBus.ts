import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import * as http from 'node:http';
import * as https from 'node:https';
import { EventEmitter } from 'node:events';
import { TeamDagScheduler } from '../dag/DagScheduler.js';
import type { TeamDagTask } from '../dag/types.js';
import type { MeshNodeDescriptor, RemoteSubDagTask, MeshEventBus, MeshEvent, MeshExecution, MeshArtifactDiff } from './types.js';

const LIMIT = 1024 * 1024;
class MeshHttpError extends Error { constructor(readonly status: number) { super(`mesh HTTP ${status}`); } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mac = (token: string, value: string) => createHmac('sha256', token).update(value).digest('hex');
const equal = (a: string, b: string) => /^[0-9a-f]{64}$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function validate(node: MeshNodeDescriptor): void {
  const url = new URL(node.endpoint);
  if (!uuid.test(node.nodeId) || !/^[0-9a-f]{48}$/.test(node.token) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('invalid mesh descriptor');
  if (!Array.isArray(node.roleCapabilities) || node.roleCapabilities.some(r => !['generator', 'evaluator'].includes(r))) throw new Error('invalid capabilities');
}
function reply(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
}

/** Native HTTP/SSE mesh. Trust is provisioned locally on both nodes, never from an inbound body. */
export class NativeMeshEventBus implements MeshEventBus {
  private readonly peers = new Map<string, MeshNodeDescriptor>();
  private readonly dags = new Map<string, { tasks: TeamDagTask[]; ref: string; context: unknown }>();
  private readonly runs = new Map<string, string>();
  private readonly ownership = new Set<string>();
  private readonly delegated = new Map<string, string>();
  private readonly history = new Map<string, MeshEvent[]>();
  private readonly received = new Map<string, MeshEvent[]>();
  private readonly events = new EventEmitter();
  private readonly streams = new Set<http.ServerResponse>();
  private readonly subscriptions = new Set<() => void>();
  private readonly nonces = new Map<string, number>();
  private readonly abort = new AbortController();
  private readonly jobs = new Set<Promise<void>>();
  private heartbeat?: ReturnType<typeof setInterval>;
  private closed = false;
  constructor(readonly local: MeshNodeDescriptor, private readonly execution?: MeshExecution, private readonly reconnectMs = 100) { validate(local); }

  trustPeer(node: MeshNodeDescriptor): void {
    validate(node); if (node.nodeId === this.local.nodeId) throw new Error('cannot trust self');
    const previous = this.peers.get(node.nodeId);
    if (previous && (previous.token !== node.token || previous.endpoint !== node.endpoint)) throw new Error('peer identity already pinned');
    if (!previous) this.peers.set(node.nodeId, structuredClone(node));
  }
  peer(nodeId: string): MeshNodeDescriptor | undefined { const node = this.peers.get(nodeId); return node && structuredClone(node); }
  listPeers(): Omit<MeshNodeDescriptor, 'token'>[] {
    return [...this.peers.values()].map(({ token: _token, ...peer }) => structuredClone(peer));
  }
  async registerPeer(node: MeshNodeDescriptor): Promise<void> {
    this.trustPeer(node);
    const nonce = randomUUID();
    const result = await this.request(node, '/api/mesh/handshake', 'POST', { nonce }) as { nodeId: string; proof: string };
    if (result.nodeId !== node.nodeId || !equal(result.proof ?? '', mac(node.token, `${nonce}:${this.local.nodeId}:${node.nodeId}`))) throw new Error('peer handshake rejected');
    this.peers.get(node.nodeId)!.status = 'online';
  }
  async probePeer(nodeId: string): Promise<void> {
    const node = this.requirePeer(nodeId); const start = Date.now();
    try { await this.registerPeer(node); node.latencyMs = Date.now() - start; node.status = 'online'; }
    catch (error) { node.status = 'offline'; throw error; }
  }
  startHeartbeat(intervalMs = 15000): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => { for (const id of this.peers.keys()) void this.probePeer(id).catch(() => {}); }, intervalMs);
    this.heartbeat.unref();
  }
  registerDag(dagId: string, tasks: TeamDagTask[], ref: string, context: unknown): void {
    if (!dagId || !ref || this.dags.has(dagId)) throw new Error('invalid or duplicate DAG');
    this.dags.set(dagId, structuredClone({ tasks, ref, context }));
  }
  async dispatchSubDag(targetNodeId: string, task: RemoteSubDagTask): Promise<void> {
    const node = this.requirePeer(targetNodeId); const dag = this.dags.get(task.dagId);
    if (!dag || task.contextSnapshotRef !== dag.ref || !Array.isArray(task.subGraphNodes) || !task.subGraphNodes.length || new Set(task.subGraphNodes).size !== task.subGraphNodes.length) throw new Error('invalid subgraph');
    const selected = new Set(task.subGraphNodes);
    const tasks = task.subGraphNodes.map(id => { const t = dag.tasks.find(t => t.id === id); if (!t || t.dependencies.some(d => !selected.has(d))) throw new Error('subgraph must be dependency closed'); return t; });
    if (tasks.some(t => !node.roleCapabilities.includes(t.assignedRole))) throw new Error('peer lacks role capability');
    const keys = tasks.map(t => JSON.stringify([task.dagId, t.id]));
    if (keys.some(key => this.delegated.has(key) && this.delegated.get(key) !== targetNodeId)) throw new Error('task already delegated to another peer');
    // Retain ownership on an ambiguous transport failure: retrying the same target is idempotent.
    const newKeys = keys.filter(key => !this.delegated.has(key));
    for (const key of newKeys) this.delegated.set(key, targetNodeId);
    try { await this.request(node, '/api/mesh/tasks', 'POST', { ...task, tasks, context: dag.context }); }
    catch (error) {
      if (error instanceof MeshHttpError && (error.status < 500 || error.status === 503)) for (const key of newKeys) this.delegated.delete(key);
      throw error;
    }
  }
  /** Deterministic global DAG view, including local pending tasks and all delegated peer branches. */
  dagSnapshot(dagId: string): TeamDagTask[] {
    const dag = this.dags.get(dagId); if (!dag) throw new Error('unknown DAG');
    const tasks = new Map(dag.tasks.map(t => [t.id, structuredClone(t)]));
    for (const peerId of this.peers.keys()) for (const task of this.remoteSnapshot(peerId, dagId)?.tasks ?? []) {
      if (this.delegated.get(JSON.stringify([dagId, task.id])) === peerId) tasks.set(task.id, task);
    }
    return structuredClone([...tasks.values()]);
  }
  /** Settle parent tasks that its owner has already claimed/started for remote execution. */
  async settleParent(dagId: string, parent: TeamDagScheduler): Promise<void> {
    for (const remote of this.dagSnapshot(dagId)) {
      const local = parent.snapshot().find(t => t.id === remote.id);
      if (local?.status !== 'running') continue;
      if (remote.status === 'completed' && remote.result) await parent.settleTask(remote.id, remote.result);
      else if (remote.status === 'failed') await parent.failTask(remote.id, remote.error ?? 'remote task failed');
    }
  }
  remoteSnapshot(nodeId: string, dagId: string): MeshEvent | undefined {
    const events = this.received.get(nodeId)?.filter(e => e.dagId === dagId);
    if (!events?.length) return undefined;
    const tasks = new Map<string, TeamDagTask>(); const diffs = new Map<string, MeshArtifactDiff>();
    for (const event of events) { for (const task of event.tasks) tasks.set(task.id, task); for (const diff of event.artifactDiffs) diffs.set(diff.path, diff); }
    return structuredClone({ ...events.at(-1)!, tasks: [...tasks.values()], artifactDiffs: [...diffs.values()] });
  }
  private accept(nodeId: string, event: MeshEvent): void {
    const history = this.received.get(nodeId) ?? []; const last = history.at(-1)?.seq ?? 0;
    if (!event || event.nodeId !== nodeId || !Number.isSafeInteger(event.seq) || typeof event.dagId !== 'string' || !Array.isArray(event.tasks) || event.tasks.some(t => !t || typeof t.id !== 'string' || !['pending', 'ready', 'claimed', 'running', 'completed', 'failed'].includes(t.status)) || !Array.isArray(event.artifactDiffs) || event.artifactDiffs.some(d => typeof d.path !== 'string' || typeof d.diff !== 'string')) throw new Error('invalid mesh event');
    if (event.seq <= last) return;
    if (event.seq !== last + 1) throw new Error('mesh event sequence gap');
    history.push(structuredClone(event)); this.received.set(nodeId, history);
    this.events.emit(`peer:${nodeId}`, structuredClone(event));
  }
  async reconcilePeer(nodeId: string): Promise<void> {
    let more = true;
    while (more) {
      const after = this.received.get(nodeId)?.at(-1)?.seq ?? 0;
      const data = await this.request(this.requirePeer(nodeId), `/api/mesh/events?after=${after}`, 'GET') as { events: MeshEvent[]; more: boolean };
      for (const event of data.events) this.accept(nodeId, event);
      more = data.more;
    }
  }
  subscribePeerEvents(nodeId: string, onEvent: (event: MeshEvent) => void): () => void {
    const node = this.requirePeer(nodeId); let stopped = false; let active: http.ClientRequest | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = (event: MeshEvent) => { try { onEvent(event); } catch { /* consumer failure must not break reconciliation */ } };
    this.events.on(`peer:${nodeId}`, listener);
    const connect = () => {
      if (stopped || this.closed) return;
      const after = this.received.get(nodeId)?.at(-1)?.seq ?? 0; const route = `/api/mesh/stream?after=${after}`;
      active = this.open(node, route, 'GET', '');
      active.setTimeout(45000, () => active?.destroy());
      active.on('response', res => {
        if (res.statusCode !== 200) { res.resume(); active?.destroy(); return; }
        node.status = 'online'; let buffer = ''; res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (Buffer.byteLength(frame) > LIMIT) { res.destroy(); return; }
            const data = frame.split('\n').find(l => l.startsWith('data: '));
            if (data) { try { this.accept(nodeId, JSON.parse(data.slice(6)) as MeshEvent); } catch { res.destroy(); return; } }
          }
          if (Buffer.byteLength(buffer) > LIMIT) res.destroy();
        });
        res.on('error', () => {});
      });
      active.on('error', () => {});
      active.once('close', () => { node.status = 'offline'; if (!stopped && !this.closed) timer = setTimeout(connect, this.reconnectMs); });
      active.end();
    };
    const stop = () => { stopped = true; clearTimeout(timer); active?.destroy(); this.events.off(`peer:${nodeId}`, listener); this.subscriptions.delete(stop); };
    this.subscriptions.add(stop); connect(); return stop;
  }
  private requirePeer(id: string): MeshNodeDescriptor { const node = this.peers.get(id); if (!node) throw new Error('unknown mesh peer'); return node; }
  private open(node: MeshNodeDescriptor, route: string, method: string, body: string): http.ClientRequest {
    if (this.closed) throw new Error('mesh is closed');
    const nonce = `${Date.now()}:${randomUUID()}`;
    const url = new URL(route, node.endpoint);
    const request = (url.protocol === 'https:' ? https : http).request(url, { method, headers: {
      Authorization: `Bearer ${node.token}`, 'Content-Type': 'application/json', 'x-mesh-node': this.local.nodeId,
      'x-mesh-nonce': nonce, 'x-mesh-proof': mac(this.local.token, `${method}:${route}:${nonce}:${body}`),
    } });
    return request;
  }
  private request(node: MeshNodeDescriptor, route: string, method: string, value?: unknown): Promise<unknown> {
    const body = value === undefined ? '' : JSON.stringify(value);
    if (Buffer.byteLength(body) > LIMIT) return Promise.reject(new Error('mesh payload too large'));
    return new Promise((resolve, reject) => {
      const req = this.open(node, route, method, body); req.setTimeout(5000, () => req.destroy(new Error('mesh request timeout')));
      req.on('error', reject); req.on('response', res => {
        let raw = ''; res.setEncoding('utf8'); res.on('error', reject);
        res.on('data', (chunk: string) => { raw += chunk; if (Buffer.byteLength(raw) > LIMIT) res.destroy(new Error('mesh response too large')); });
        res.on('end', () => { if (res.statusCode !== 200 && res.statusCode !== 202) { reject(new MeshHttpError(res.statusCode ?? 500)); return; } try { resolve(JSON.parse(raw)); } catch (error) { reject(error); } });
      }); req.end(body);
    });
  }
  /** Mounted behind the daemon authMiddleware, and additionally verifies the provisioned sender. */
  async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    try {
      const chunks: Buffer[] = []; let bytes = 0; req.setTimeout(5000, () => req.destroy());
      for await (const chunk of req) { const buffer = Buffer.from(chunk as Buffer); bytes += buffer.length; if (bytes > LIMIT) { reply(res, 413, { error: 'payload_too_large' }); return; } chunks.push(buffer); }
      const body = Buffer.concat(chunks).toString('utf8');
      const nodeId = String(req.headers['x-mesh-node'] ?? ''); const peer = this.peers.get(nodeId);
      const nonce = String(req.headers['x-mesh-nonce'] ?? ''); const timestamp = Number(nonce.split(':')[0]);
      for (const [key, ts] of this.nonces) if (Date.now() - ts > 30000) this.nonces.delete(key);
      if (!peer || !Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 30000 || this.nonces.has(`${nodeId}:${nonce}`) || !equal(String(req.headers['x-mesh-proof'] ?? ''), mac(peer.token, `${req.method}:${req.url}:${nonce}:${body}`))) { reply(res, 401, { error: 'untrusted_peer' }); return; }
      this.nonces.set(`${nodeId}:${nonce}`, timestamp);
      const url = new URL(req.url!, this.local.endpoint);
      if (req.method === 'POST' && url.pathname === '/api/mesh/handshake') {
        const data = JSON.parse(body) as { nonce: string }; if (!uuid.test(data.nonce)) throw new Error('invalid challenge');
        reply(res, 200, { nodeId: this.local.nodeId, proof: mac(this.local.token, `${data.nonce}:${nodeId}:${this.local.nodeId}`) }); return;
      }
      if (req.method === 'GET' && ['/api/mesh/events', '/api/mesh/stream'].includes(url.pathname)) {
        const after = Number(url.searchParams.get('after') ?? 0); const history = this.history.get(nodeId) ?? [];
        if (!Number.isSafeInteger(after) || after < 0 || after > (history.at(-1)?.seq ?? 0)) throw new Error('invalid event cursor');
        if (url.pathname.endsWith('/events')) {
          const page: MeshEvent[] = []; let size = 64;
          for (const event of history) if (event.seq > after) { const bytes = Buffer.byteLength(JSON.stringify(event)) + 1; if (size + bytes > LIMIT) break; page.push(event); size += bytes; }
          reply(res, 200, { events: page, more: (page.at(-1)?.seq ?? after) < (history.at(-1)?.seq ?? 0) }); return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        req.setTimeout(0);
        let cursor = after; let waiting = false;
        const send = () => {
          if (waiting || res.destroyed) return;
          for (const event of this.history.get(nodeId) ?? []) if (event.seq > cursor) {
            cursor = event.seq;
            if (!res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`)) { waiting = true; return; }
          }
        };
        res.on('drain', () => { waiting = false; send(); });
        this.events.on(`local:${nodeId}`, send); this.streams.add(res);
        res.once('close', () => { this.events.off(`local:${nodeId}`, send); this.streams.delete(res); clearInterval(heartbeat); });
        send();
        res.write(': connected\n\n'); const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000); heartbeat.unref(); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/mesh/tasks') {
        if (!this.execution) { reply(res, 503, { error: 'mesh_executor_unconfigured' }); return; }
        const data = JSON.parse(body) as RemoteSubDagTask & { tasks: TeamDagTask[]; context: unknown };
        if (!data.dagId || typeof data.dagId !== 'string' || !data.contextSnapshotRef || !Array.isArray(data.tasks) || !data.tasks.length || data.tasks.length > 100 || !Array.isArray(data.subGraphNodes) || data.tasks.length !== data.subGraphNodes.length || data.tasks.some(t => !data.subGraphNodes.includes(t.id) || !this.local.roleCapabilities.includes(t.assignedRole))) throw new Error('invalid subgraph payload');
        const scheduler = new TeamDagScheduler({ id: data.dagId, tasks: data.tasks, roster: this.execution.roster, status: 'approved', createdAt: Date.now() });
        if (Buffer.byteLength(JSON.stringify(scheduler.snapshot())) > LIMIT - 65536) throw new Error('mesh graph exceeds event size limit');
        const key = JSON.stringify([nodeId, data.dagId, [...data.subGraphNodes].sort()]); const fingerprint = mac(this.local.token, body); const old = this.runs.get(key);
        if (old && old !== fingerprint) { reply(res, 409, { error: 'conflicting_dispatch' }); return; }
        if (!old) {
          const owned = data.subGraphNodes.map(id => JSON.stringify([nodeId, data.dagId, id]));
          if (owned.some(id => this.ownership.has(id))) { reply(res, 409, { error: 'overlapping_dispatch' }); return; }
          for (const id of owned) this.ownership.add(id);
          this.runs.set(key, fingerprint);
          const job = this.execute(nodeId, data, scheduler); this.jobs.add(job); void job.finally(() => this.jobs.delete(job));
        }
        reply(res, 202, { accepted: true }); return;
      }
      reply(res, 404, { error: 'not_found' });
    } catch { if (!res.headersSent) reply(res, 400, { error: 'invalid_mesh_request' }); else res.destroy(); }
  }
  private async execute(peerId: string, data: { dagId: string; context: unknown }, scheduler: TeamDagScheduler): Promise<void> {
    const diffs: MeshArtifactDiff[] = [];
    const publish = () => {
      const history = this.history.get(peerId) ?? [];
      const event: MeshEvent = { nodeId: this.local.nodeId, seq: history.length + 1, dagId: data.dagId, tasks: scheduler.snapshot(), artifactDiffs: structuredClone(diffs) };
      history.push(event); this.history.set(peerId, history); this.events.emit(`local:${peerId}`, event);
    };
    while (!scheduler.isSettled() && !this.abort.signal.aborted) {
      const ready = scheduler.evaluateReadiness();
      for (const task of ready) {
        const member = this.execution!.roster.find(m => m.role === task.assignedRole)!;
        scheduler.claimTask(task.id, member.memberId); scheduler.startTask(task.id); publish();
        try {
          const dependencies = scheduler.snapshot().filter(t => task.dependencies.includes(t.id));
          const result = await this.execution!.execute(task, structuredClone(data.context), this.abort.signal, dependencies);
          const proposed = { tasks: scheduler.snapshot().map(t => t.id === task.id ? { ...t, result } : t), artifactDiffs: [...diffs, ...(result.artifactDiffs ?? [])] };
          if (Buffer.byteLength(JSON.stringify(proposed)) > LIMIT - 65536) throw new Error('mesh result exceeds event size limit');
          diffs.push(...(result.artifactDiffs ?? [])); await scheduler.settleTask(task.id, result);
        } catch (error) { await scheduler.failTask(task.id, error instanceof Error ? error.message : String(error)); }
        publish();
      }
    }
  }
  /** Force stream interruption without discarding retained sequence history (also useful for transport tests). */
  disconnectStreams(): void { for (const stream of this.streams) stream.destroy(); }
  async close(): Promise<void> {
    this.closed = true; clearInterval(this.heartbeat); this.abort.abort(); for (const stop of this.subscriptions) stop();
    this.disconnectStreams(); await Promise.allSettled(this.jobs); this.events.removeAllListeners();
  }
}
