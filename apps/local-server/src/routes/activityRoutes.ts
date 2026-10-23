/**
 * UI-013 read side: aggregate active and `WAITING_APPROVAL` work across every
 * project into a single Activity queue. Pure aggregation over injected sources so
 * it is deterministic and testable without spinning up a real session.
 */

export type ActivityKind = 'session' | 'team' | 'subagent' | 'goal';
export type RunOutcomeStatus = 'queued' | 'running' | 'waiting_approval' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'unknown';
export type ActivityStatus = 'needs_attention' | 'running' | 'completed' | 'failed' | 'interrupted' | 'cancelled' | 'unknown';

export interface ActivityRun {
  id: string;
  kind: ActivityKind;
  projectRoot: string;
  title: string;
  status: ActivityStatus;
  needsApproval: boolean;
  /** present when an inline decision is possible (UI-013 approval queue). */
  approval?: ActivityApproval;
  /** short, already-sanitized human hint (never raw prompt text). */
  detail?: string;
  updatedAt: number;
  href?: string;
  /** canonical observed outcome (ARCH-01) */
  outcome?: RunOutcomeStatus;
  statusSource?: 'live' | 'event_log' | 'approval_queue' | 'inferred';
  runId?: string;
  observedAt?: number;
  revision?: number;
  reasonCode?: string;
}

export interface ActivityApprovalOption { id: string; label: string; tone: string }

export interface ActivityApproval {
  sessionId: string;
  widgetId: string;
  actionType: string;
  description: string;
  requestedAt: string;
  options: ActivityApprovalOption[];
}

export interface ActivitySessionSource {
  runId?: string;
  observedAt?: number;
  revision?: number;
  reasonCode?: string;
  id: string;
  workspaceRoot: string;
  createdAt?: string;
  updatedAt?: string;
  topic?: { title?: string; isArchived?: boolean };
  lastRunStatus?: RunOutcomeStatus;
  errorDetail?: string;
  recordCount?: number;
}

export interface ActivityLiveState {
  runId?: string;
  observedAt?: number;
  revision?: number;
  reasonCode?: string;
  turnActive: boolean;
  lastRunStatus?: RunOutcomeStatus;
  errorDetail?: string;
  recordCount?: number;
}

export interface ActivitySubagentSource {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  worktreePath?: string;
  startedAt: string;
  endedAt?: string;
}

export interface ActivityTeamStageSource {
  id: string;
  status: 'staged' | 'approved' | 'rejected' | 'running' | 'finished';
  createdAt: number;
  tasks?: { status: string }[];
}

export interface ActivityGoalSource {
  id: string;
  projectRoot: string;
  goal: string;
  status: 'pending' | 'in-progress' | 'paused' | 'met' | 'not_met' | 'cancelled';
  createdAt?: string;
  updatedAt?: string;
}

export interface ActivitySources {
  sessions: () => Promise<ActivitySessionSource[]>;
  live: (sessionId: string) => ActivityLiveState | undefined;
  /** every pending permission decision across projects. */
  approvals: () => ActivityApproval[];
  subagents: () => Promise<ActivitySubagentSource[]>;
  teamStages: () => ActivityTeamStageSource[];
  goalTasks: () => ActivityGoalSource[];
  /** project root attributed to team/subagent activity when unknown. */
  defaultProjectRoot?: string;
}

const STATUS_ORDER: Record<ActivityStatus, number> = {
  needs_attention: 0,
  failed: 1,
  running: 2,
  unknown: 3,
  interrupted: 4,
  cancelled: 5,
  completed: 6,
};

function sessionStatus(outcome: RunOutcomeStatus): ActivityStatus {
  return outcome === 'failed' || outcome === 'interrupted' || outcome === 'cancelled' || outcome === 'completed'
    ? outcome : 'unknown';
}

function time(value: string | number | undefined): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') { const parsed = Date.parse(value); if (Number.isFinite(parsed)) return parsed; }
  return 0;
}

export class ActivityRoutes {
  constructor(private readonly sources: ActivitySources) {}

  async list(): Promise<{ runs: ActivityRun[]; updatedAt: number }> {
    const root = this.sources.defaultProjectRoot ?? '';
    const [sessions, subagents] = await Promise.all([this.sources.sessions(), this.sources.subagents()]);
    const approvals = this.sources.approvals();
    const approvalBySession = new Map<string, ActivityApproval>();
    for (const approval of approvals) if (!approvalBySession.has(approval.sessionId)) approvalBySession.set(approval.sessionId, approval);
    const runs: ActivityRun[] = [];

    for (const session of sessions) {
      if (session.topic?.isArchived) continue;
      const approval = approvalBySession.get(session.id);
      const live = this.sources.live(session.id);

      let status: ActivityStatus;
      let outcome: RunOutcomeStatus;
      let statusSource: 'live' | 'event_log' | 'approval_queue' | 'inferred';

      if (approval) {
        status = 'needs_attention';
        outcome = 'waiting_approval';
        statusSource = 'approval_queue';
      } else if (live?.turnActive) {
        status = 'running';
        outcome = 'running';
        statusSource = 'live';
      } else if (live?.lastRunStatus) {
        outcome = live.lastRunStatus;
        status = sessionStatus(outcome);
        statusSource = 'live';
      } else if (session.lastRunStatus) {
        outcome = session.lastRunStatus;
        status = sessionStatus(outcome);
        statusSource = 'event_log';
      } else if (session.recordCount === 0 || live?.recordCount === 0) {
        // 空会话，从未执行任何有效 Turn，归为 unknown / queued，绝不冒充 completed
        status = 'unknown';
        outcome = 'queued';
        statusSource = 'inferred';
      } else {
        // 无法从现有数据确证成功结果，归为 unknown
        status = 'unknown';
        outcome = 'unknown';
        statusSource = 'inferred';
      }

      runs.push({
        id: session.id,
        kind: 'session',
        projectRoot: session.workspaceRoot,
        title: session.topic?.title?.trim() || session.id,
        status,
        outcome,
        statusSource,
        runId: live?.runId ?? session.runId,
        observedAt: live?.observedAt ?? session.observedAt ?? Date.now(),
        revision: live?.revision ?? session.revision,
        reasonCode: approval ? 'approval_pending' : live?.turnActive ? 'turn_active' : live?.reasonCode ?? session.reasonCode,
        detail: live?.errorDetail ?? session.errorDetail,
        needsApproval: Boolean(approval),
        approval,
        updatedAt: time(session.updatedAt ?? session.createdAt),
        href: `/api/sessions/${session.id}`,
      });
    }

    for (const stage of this.sources.teamStages()) {
      let status: ActivityStatus = 'unknown';
      let outcome: RunOutcomeStatus = 'unknown';
      if (stage.status === 'staged') { status = 'needs_attention'; outcome = 'waiting_approval'; }
      else if (stage.status === 'approved') { outcome = 'queued'; }
      else if (stage.status === 'rejected') { status = 'cancelled'; outcome = 'cancelled'; }
      else if (stage.status === 'running') { status = 'running'; outcome = 'running'; }
      else if (stage.status === 'finished') {
        const tasks = stage.tasks ?? [];
        if (tasks.some(task => task.status === 'failed')) { status = 'failed'; outcome = 'failed'; }
        else if (tasks.some(task => task.status === 'cancelled')) { status = 'cancelled'; outcome = 'cancelled'; }
        // A finished scheduler alone proves no success; require every task to succeed.
        else if (tasks.length > 0 && tasks.every(task => task.status === 'completed')) { status = 'completed'; outcome = 'completed'; }
      }
      runs.push({ id: stage.id, kind: 'team', projectRoot: root, title: `Team plan ${stage.id}`, status, outcome, statusSource: 'inferred', needsApproval: stage.status === 'staged', updatedAt: stage.createdAt });
    }

    for (const subagent of subagents) {
      const status: ActivityStatus = subagent.status === 'running' || subagent.status === 'failed' || subagent.status === 'cancelled' || subagent.status === 'completed' ? subagent.status : 'unknown';
      const outcome: RunOutcomeStatus = subagent.status === 'idle' ? 'queued' : subagent.status === 'running' || subagent.status === 'completed' || subagent.status === 'failed' || subagent.status === 'cancelled' ? subagent.status : 'unknown';
      runs.push({ id: subagent.id, kind: 'subagent', projectRoot: subagent.worktreePath ?? root, title: subagent.name, status, outcome, statusSource: 'inferred', needsApproval: false, updatedAt: time(subagent.endedAt ?? subagent.startedAt) });
    }

    for (const task of this.sources.goalTasks()) {
      const status: ActivityStatus = task.status === 'paused' ? 'needs_attention' : task.status === 'met' ? 'completed' : task.status === 'not_met' ? 'failed' : task.status === 'cancelled' ? 'cancelled' : task.status === 'in-progress' ? 'running' : 'unknown';
      runs.push({ id: task.id, kind: 'goal', projectRoot: task.projectRoot, title: task.goal, status, needsApproval: false, updatedAt: time(task.updatedAt ?? task.createdAt) });
    }

    runs.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
    return { runs, updatedAt: Date.now() };
  }
}
