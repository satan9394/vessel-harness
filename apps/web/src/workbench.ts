import type { MessageKey } from './i18n';

/**
 * Card 222 wire types (mirrored locally — the Web app never imports workspace
 * packages at runtime). Shapes match the local-server JSON exactly.
 */

export const TASK_TREE_STATUSES = ['pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled'] as const;
export type TaskTreeStatus = typeof TASK_TREE_STATUSES[number];

export interface TaskLeaseView {
  leaseId: string;
  holder: string;
  attempt: number;
  acquiredAt: number;
  expiresAt: number;
  releasedAt?: number;
  releaseReason?: string;
}

export interface TaskTreeAggregateView {
  completedChildren: string[];
  failedChildren: string[];
  cancelledChildren: string[];
  outputs: Record<string, string>;
}

export interface TaskTreeNodeView {
  instanceId: string;
  parentInstanceId?: string;
  title: string;
  status: TaskTreeStatus;
  dependencies: string[];
  permissionScope: { allowedTools: string[]; deniedTools: string[]; approvals: string };
  lease?: TaskLeaseView;
  attempt: number;
  durationMs?: number;
  result?: { output: string };
  error?: string;
  cancellation?: { reason: string; originInstanceId: string };
  aggregate?: TaskTreeAggregateView;
  children: string[];
}

export interface TaskTreeSnapshotView {
  rootInstanceId: string;
  projectRoot: string;
  nodes: TaskTreeNodeView[];
  updatedAt: number;
}

export interface TaskTreesResponse { trees: TaskTreeSnapshotView[]; updatedAt: number }

export function treeRoots(snapshot: TaskTreeSnapshotView): TaskTreeNodeView[] {
  return snapshot.nodes.filter((node) => !node.parentInstanceId).sort((a, b) => a.title.localeCompare(b.title));
}

export function childrenOf(snapshot: TaskTreeSnapshotView, instanceId: string): TaskTreeNodeView[] {
  return snapshot.nodes.filter((node) => node.parentInstanceId === instanceId);
}

export function nodeById(snapshot: TaskTreeSnapshotView, instanceId: string): TaskTreeNodeView | undefined {
  return snapshot.nodes.find((node) => node.instanceId === instanceId);
}

const TASK_STATUS_KEYS: Record<TaskTreeStatus, MessageKey> = {
  pending: 'taskStatusPending',
  running: 'taskStatusRunning',
  waiting_approval: 'taskStatusWaitingApproval',
  completed: 'taskStatusCompleted',
  failed: 'taskStatusFailed',
  cancelled: 'taskStatusCancelled',
};
export function taskStatusLabelKey(status: TaskTreeStatus): MessageKey { return TASK_STATUS_KEYS[status] ?? 'taskStatusPending'; }

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

/** Flatten a tree depth-first so children render under their parent. */
export function flattenTree(snapshot: TaskTreeSnapshotView): { node: TaskTreeNodeView; depth: number }[] {
  const out: { node: TaskTreeNodeView; depth: number }[] = [];
  const visit = (node: TaskTreeNodeView, depth: number) => {
    out.push({ node, depth });
    for (const child of childrenOf(snapshot, node.instanceId).sort((a, b) => a.title.localeCompare(b.title))) visit(child, depth + 1);
  };
  for (const root of treeRoots(snapshot)) visit(root, 0);
  return out;
}

// ---------------------------------------------------------------------------
// UI-013 Activity queue
// ---------------------------------------------------------------------------

export type ActivityKind = 'session' | 'team' | 'subagent' | 'goal';
export type RunOutcomeStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'unknown';
export type ActivityStatus = 'needs_attention' | 'running' | 'completed' | 'failed' | 'unknown';

export interface ActivityApprovalView {
  sessionId: string;
  widgetId: string;
  actionType: string;
  description: string;
  requestedAt: string;
  options: { id: string; label: string; tone: string }[];
}

export interface ActivityRunView {
  id: string;
  kind: ActivityKind;
  projectRoot: string;
  title: string;
  status: ActivityStatus;
  needsApproval: boolean;
  approval?: ActivityApprovalView;
  detail?: string;
  updatedAt: number;
  href?: string;
  outcome?: RunOutcomeStatus;
  statusSource?: 'live' | 'event_log' | 'approval_queue' | 'inferred';
}

export interface ActivityResponse { runs: ActivityRunView[]; updatedAt: number }

const ACTIVITY_STATUS_KEYS: Record<ActivityStatus, MessageKey> = {
  needs_attention: 'activityNeedsAttention',
  failed: 'activityFailed',
  unknown: 'activityUnknown' as MessageKey,
  running: 'activityRunning',
  completed: 'activityCompleted',
};
export function activityStatusLabelKey(status: ActivityStatus): MessageKey { return ACTIVITY_STATUS_KEYS[status]; }

export function groupActivity(runs: ActivityRunView[]): { status: ActivityStatus; runs: ActivityRunView[] }[] {
  const order: ActivityStatus[] = ['needs_attention', 'failed', 'unknown', 'running', 'completed'];
  return order.map((status) => ({ status, runs: runs.filter((run) => run.status === status) })).filter((group) => group.runs.length > 0);
}

// ---------------------------------------------------------------------------
// UI-015 Studio Composer
// ---------------------------------------------------------------------------

export interface ComposerLibraryEntry {
  id: string;
  class: string;
  channel: 'prompt_guidance' | 'runtime_policy';
  render: string;
  priority?: number;
  policy_ref?: string;
  severity?: 'info' | 'warning' | 'critical';
  assertions?: string[];
  conflictDomain?: string;
}

export interface BehaviorConflictView {
  domain: string;
  entryIds: string[];
  severity: 'warning' | 'error';
  code: string;
  message: string;
}

export interface BehaviorConformanceEntryView {
  entryId: string;
  category: string;
  channel: string;
  priority: number;
  policyRef: string | null;
  policyRuleFound: boolean;
  compatibility: string;
}

export interface BehaviorConformanceReportView {
  snapshotHash: string;
  verdict: 'verified' | 'enforceable' | 'incomplete' | 'rejected';
  conflicts: BehaviorConflictView[];
  conformance: BehaviorConformanceEntryView[];
  diagnostics: { entryId: string; severity: string; code: string; message: string }[];
  warnings: string[];
  levels: { level: string; status: 'available' | 'unavailable' }[];
}

/** Re-order staged entries by descending priority, then id (stable, deterministic). */
export function sortByPriority(entries: ComposerLibraryEntry[]): ComposerLibraryEntry[] {
  return [...entries].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
}

/** Reassign sequential priorities top-down (higher first). */
export function reorderPriority(entries: ComposerLibraryEntry[], index: number, direction: -1 | 1): ComposerLibraryEntry[] {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= entries.length || target >= entries.length) return entries;
  const next = [...entries];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next.map((entry, position) => ({ ...entry, priority: (next.length - position) * 10 }));
}

// ---------------------------------------------------------------------------
// UI-017 Trace
// ---------------------------------------------------------------------------

export interface TraceStepView {
  seq: number;
  ts: string;
  type: string;
  turnId?: string;
  step?: number;
  title: string;
  detail: Record<string, unknown>;
}

export interface TraceTurnView { turnId: string; steps: TraceStepView[] }

export interface TraceReportView {
  sessionId: string;
  turns: TraceTurnView[];
  recordCount: number;
  redactedFields: string[];
}

export const TRACE_LAYOUT_STORAGE_KEY = 'vessel.trace.layout';

export function readTraceLayout(storage: Pick<Storage, 'getItem'> | undefined): { compact: boolean; showDetail: boolean } {
  try {
    const value: unknown = JSON.parse(storage?.getItem(TRACE_LAYOUT_STORAGE_KEY) ?? 'null');
    if (value && typeof value === 'object') {
      const state = value as { compact?: unknown; showDetail?: unknown };
      return { compact: state.compact === true, showDetail: state.showDetail !== false };
    }
  } catch { /* storage may be disabled */ }
  return { compact: false, showDetail: true };
}
