/** Browser-only mirrors of the read-only dashboard projections (task 185). */
export interface MeshNodeView {
  nodeId: string;
  endpoint: string;
  roleCapabilities: string[];
  status: 'online' | 'busy' | 'offline';
  latencyMs: number;
  remoteTasks?: { id: string; title: string; assignedRole: string; status: string }[];
}
export interface MeshSnapshot {
  configured: boolean;
  local: MeshNodeView | null;
  peers: MeshNodeView[];
  observedAt: number;
}
export type RuleCategory = 'policy_denial' | 'tool_failure' | 'architecture_constraint';
export interface ReflectiveRuleView {
  id: string;
  category: RuleCategory;
  triggerCondition: string;
  lesson: string;
  recommendedAction: string;
  frequency: number;
  updatedAt: number;
  confidence?: number;
}
export interface RulesSnapshot { available: boolean; rules: ReflectiveRuleView[] }

export function appendRttSamples(previous: Record<string, number[]>, peers: MeshNodeView[]): Record<string, number[]> {
  return Object.fromEntries(peers.map((peer) => [peer.nodeId, peer.status === 'offline'
    ? previous[peer.nodeId] ?? [] : [...(previous[peer.nodeId] ?? []), peer.latencyMs].slice(-20)]));
}

/** Schedule after completion, so slow reads never overlap. Teardown rejects late updates. */
export function pollDashboard<T>(read: () => Promise<T>, receive: (value: T) => void,
  fail: (message: string) => void, intervalMs: number, busy: (value: boolean) => void = () => {}) {
  let closed = false;
  let pending: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function refresh(): Promise<void> {
    if (closed) return Promise.resolve();
    if (pending) return pending;
    clearTimeout(timer);
    busy(true);
    pending = (async () => {
      try { const value = await Promise.resolve().then(read); if (!closed) receive(value); }
      catch (error) { if (!closed) fail(error instanceof Error ? error.message : String(error)); }
      finally {
        pending = undefined;
        if (!closed) {
          busy(false);
          timer = setTimeout(() => { void refresh(); }, intervalMs);
        }
      }
    })();
    return pending;
  }
  const ready = refresh();
  return { ready, refresh, close() { closed = true; clearTimeout(timer); } };
}
