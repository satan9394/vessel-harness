/**
 * Vessel Local Web — Team UI mirror types + pure helpers (task 060).
 *
 * The web app is a standalone Vite project and never imports workspace
 * packages, so the Team/route/review JSON shapes sent by the local server
 * (apps/local-server seams over 056 AutoRoute + 057 TeamProjection + 059
 * ReviewHandoffStore) are mirrored here as plain interfaces, and the pure
 * selectors below turn a TeamRunState snapshot into the member cards the
 * <TeamPanel> renders. Keeping the mapping pure (state → cards → labels)
 * makes the panel trivially testable under node.
 */

// ---------------------------------------------------------------------------
// Route selection (056) — wire shapes from GET/POST /api/sessions/:id/route
// ---------------------------------------------------------------------------

export type RouteMode = 'auto' | 'fast' | 'pro';

export const ROUTE_MODES: readonly RouteMode[] = ['auto', 'fast', 'pro'];

/** Display names for the three user choices (UI labels stay language-neutral). */
export const ROUTE_MODE_LABELS: Record<RouteMode, string> = {
  auto: 'Auto',
  fast: 'Fast',
  pro: 'Pro',
};

export interface RouteMemberView {
  role: string;
  tier: string;
  providerId: string;
  model: string;
  configured: boolean;
}

/** Mirror of llm AutoRoute minus the provider instances (plain JSON). */
export interface RouteView {
  mode: RouteMode;
  category: string;
  complexity?: 'small' | 'medium' | 'complex';
  /** ordered role preset ids (developer / [developer, reviewer] / [lead, developer, reviewer]) */
  roles: string[];
  roleModels: RouteMemberView[];
  /** primary working model — 「Auto → <model>」label source */
  primary: RouteMemberView;
  hints: string[];
  pinned: boolean;
}

/** Session route state returned by GET /route (mode + pin + last resolution). */
export interface RouteState {
  mode: RouteMode;
  pinned: boolean;
  route: RouteView | null;
}

/**
 * 「Auto → mock-pro」display label (§10: UI shows the actual choice the mode
 * resolved to; pinned state is rendered separately, see ModelSelector).
 */
export function routeLabel(route: RouteView | null | undefined): string | null {
  if (!route?.primary?.model) return null;
  return `${ROUTE_MODE_LABELS[route.mode] ?? route.mode} → ${route.primary.model}`;
}

// ---------------------------------------------------------------------------
// Team run (057 TeamProjection) — wire shape of GET /team-runs/current + SSE
// ---------------------------------------------------------------------------

export type TeamRoleName = 'orchestrator' | 'generator' | 'evaluator';
export type TeamPhaseName = 'orchestrate' | 'generate' | 'evaluate';

export interface TeamRosterMember {
  memberId: string;
  presetId: string;
  role: TeamRoleName;
  tier?: string;
  model: string;
  providerId: string;
}

export interface TeamReviewConclusion {
  verdict: 'met' | 'not_met' | 'impossible' | 'error';
  reason: string;
  unmet: string[];
  suggestions: string[];
  evidence: string[];
}

export interface TeamPhaseRow {
  ordinal: number;
  phase: TeamPhaseName;
  memberId: string;
  presetId: string;
  role: TeamRoleName;
  status: 'running' | 'completed' | 'failed';
  delegateOf?: string;
  promptPreview?: string;
  outputPreview?: string;
  review?: TeamReviewConclusion;
  stopReason?: string;
  ts: number;
}

export interface TeamTurnRow {
  memberId: string;
  role: TeamRoleName;
  phase: TeamPhaseName;
  turnId: string;
  kind: 'running' | 'success' | 'error' | 'interrupted' | 'budget';
  promptPreview?: string;
  ts: number;
}

export interface TeamDelegateRow {
  delegateId: string;
  parentMemberId: string;
  childSessionId: string;
  preset?: string;
  status: 'running' | 'done';
  stopReason?: string;
  isError?: boolean;
  outputPreview?: string;
  durationMs?: number;
  ts: number;
}

export interface TeamToolRow {
  memberId: string;
  role: TeamRoleName;
  toolName: string;
  status: 'started' | 'done' | 'denied' | 'error';
  ts: number;
}

/** Whole-run snapshot (mirror of application TeamProjection.state()). */
export interface TeamRunState {
  runId: string;
  task: string;
  complexity?: string;
  roster: TeamRosterMember[];
  status: 'running' | 'done';
  outcome?: 'completed' | 'failed';
  error?: string;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  phases: TeamPhaseRow[];
  turns: TeamTurnRow[];
  delegates: TeamDelegateRow[];
  toolActivities: TeamToolRow[];
}

/** One aggregated member card for the panel (pure projection of the snapshot). */
export interface TeamMemberCard {
  memberId: string;
  presetId: string;
  role: TeamRoleName;
  model: string;
  providerId: string;
  tier?: string;
  /** the member's most recent phase row (output/review live here) */
  phase?: TeamPhaseRow;
  /** true while this member's phase is the current running window */
  running: boolean;
  turns: TeamTurnRow[];
  tools: TeamToolRow[];
  delegates: TeamDelegateRow[];
}

/** Friendly member heading: preset id → Lead/Developer/Reviewer label. */
export function roleDisplay(presetId: string, role: TeamRoleName): string {
  switch (presetId) {
    case 'lead':
      return 'Lead';
    case 'developer':
      return 'Developer';
    case 'reviewer':
      return 'Reviewer';
    default:
      break;
  }
  switch (role) {
    case 'orchestrator':
      return 'Lead';
    case 'generator':
      return 'Developer';
    case 'evaluator':
      return 'Reviewer';
    default:
      return presetId;
  }
}

/** Member phase label (evaluate → Review 等展示名). */
export function phaseDisplay(phase: TeamPhaseName): string {
  switch (phase) {
    case 'orchestrate':
      return 'Orchestrate';
    case 'generate':
      return 'Generate';
    case 'evaluate':
      return 'Review';
    default:
      return phase;
  }
}

export function verdictDisplay(verdict: TeamReviewConclusion['verdict']): string {
  switch (verdict) {
    case 'met':
      return 'Met';
    case 'not_met':
      return 'Not met';
    case 'impossible':
      return 'Impossible';
    case 'error':
      return 'Parse error';
    default:
      return verdict;
  }
}

/**
 * Group the flat snapshot rows into per-roster-member cards ordered by the
 * roster (execution order). Cards render roster rows even when the member has
 * no events yet (friendly skeleton during a running team).
 */
export function memberCards(state: TeamRunState): TeamMemberCard[] {
  return state.roster.map((member) => {
    const phases = state.phases.filter((p) => p.memberId === member.memberId);
    const phase = phases[phases.length - 1];
    const activeMemberId = currentMemberId(state);
    const running = state.status === 'running' && phase !== undefined && phase.memberId === activeMemberId;
    return {
      memberId: member.memberId,
      presetId: member.presetId,
      role: member.role,
      model: member.model,
      providerId: member.providerId,
      tier: member.tier,
      phase,
      running,
      turns: state.turns.filter((t) => t.memberId === member.memberId),
      tools: state.toolActivities.filter((t) => t.memberId === member.memberId),
      delegates: state.delegates.filter((d) => d.parentMemberId === member.memberId),
    };
  });
}

/** memberId of the phase currently executing (running window), if any. */
export function currentMemberId(state: TeamRunState): string | undefined {
  if (state.status !== 'running') return undefined;
  for (let i = state.phases.length - 1; i >= 0; i -= 1) {
    const p = state.phases[i]!;
    if (p.status === 'running') return p.memberId;
  }
  return undefined;
}

/** Short one-line run summary (header text / a11y label). */
export function runSummary(state: TeamRunState): string {
  const head = `${state.roster.length} agent${state.roster.length === 1 ? '' : 's'}`;
  const tail =
    state.status === 'running'
      ? 'running…'
      : state.outcome === 'failed'
        ? `failed — ${state.error ?? 'error'}`
        : `completed in ${Math.round((state.durationMs ?? 0) / 1000)}s`;
  return `${head} · ${tail}`;
}

/** Tools grouped into one-line activity chips per card (name × count). */
export function toolSummary(tools: TeamToolRow[]): { toolName: string; status: TeamToolRow['status']; count: number }[] {
  const byName = new Map<string, TeamToolRow>();
  const counts = new Map<string, number>();
  for (const tool of tools) {
    byName.set(tool.toolName, tool);
    counts.set(tool.toolName, (counts.get(tool.toolName) ?? 0) + 1);
  }
  return [...byName.entries()].map(([toolName, row]) => ({
    toolName,
    status: row.status,
    count: counts.get(toolName) ?? 1,
  }));
}

// ---------------------------------------------------------------------------
// External Review handoff (059) — wire shapes from /api/reviews
// ---------------------------------------------------------------------------

export type ReviewStatus = 'pending' | 'imported';

export interface ReviewResultEntry {
  id: string;
  source: 'external' | 'internal';
  importedAt: string;
  conclusion: TeamReviewConclusion;
  raw: string;
}

/** Mirror of application ReviewHandoffRecord (meta.json snapshot). */
export interface ReviewRecord {
  id: string;
  status: ReviewStatus;
  source: 'external';
  createdAt: string;
  updatedAt: string;
  workspaceRoot?: string;
  task: string;
  acceptance: string[];
  changedFiles: string[];
  diffSummary: string;
  testResults: string;
  constraints: string[];
  checklist: string[];
  outputSchema: string;
  results: ReviewResultEntry[];
}

/** Normalize a raw JSON team snapshot (arrays default so selectors never crash). */
export function normalizeTeamState(raw: Partial<TeamRunState> | null | undefined): TeamRunState | null {
  if (!raw || typeof raw.runId !== 'string') return null;
  return {
    runId: raw.runId,
    task: raw.task ?? '',
    complexity: raw.complexity,
    roster: raw.roster ?? [],
    status: raw.status === 'done' ? 'done' : 'running',
    outcome: raw.outcome,
    error: raw.error,
    startedAt: raw.startedAt ?? Date.now(),
    endedAt: raw.endedAt,
    durationMs: raw.durationMs,
    phases: raw.phases ?? [],
    turns: raw.turns ?? [],
    delegates: raw.delegates ?? [],
    toolActivities: raw.toolActivities ?? [],
  };
}

/** Sort review records newest first (server sorts; belt-and-braces here). */
export function sortReviews(reviews: ReviewRecord[]): ReviewRecord[] {
  return [...reviews].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}
