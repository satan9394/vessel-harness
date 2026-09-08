/**
 * apps/local-server — Team/route seams (task 060).
 *
 * The web Team UI consumes three data planes, all served from this module:
 *
 *  1. RouteSeam — per-session Auto/Fast/Pro selection + Pin. Reuses the 056
 *     pure resolution chain (@vessel/llm classifyCategory/complexity/roles/
 *     tiers/bindings) so roster plans and the「Auto → <model>」label come from
 *     the same single source of truth as AutoTaskRouter (this server never
 *     imports agents — only the plain route vocabulary).
 *
 *  2. ActiveTeamRun — one live 057 TeamRuntime run with a TeamProjection over
 *     its own EventBus. Snapshots (TeamRunState) are the web's live frames;
 *     TeamRuntime is imported from @vessel/agents and configured like the
 *     application e2e (mock providers + empty tool face) so the local server
 *     can demonstrate full runs offline.
 *
 *  3. Review seams live in server.ts over @vessel/application's
 *     ReviewHandoffStore (059) — no extra vocabulary here.
 *
 * Layer note: local-server is the composition seam — importing @vessel/agents,
 * @vessel/application, @vessel/core, @vessel/llm, @vessel/policy is in scope
 * (apps/cli does the same through @vessel/application); nothing new is added to
 * the mechanism packages.
 */

import type { ChatProvider, PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import {
  classifyTask,
  complexityForCategory,
  resolveTierBinding,
  roleTierFor,
  rolesForComplexity,
} from '@vessel/llm';
import type { AutoRoute, ResolvedRoleModel, RouteMode, TierBindings } from '@vessel/llm';
import { TeamRuntime } from '@vessel/agents';
import { TeamProjection } from '@vessel/application';
import type { TeamRunState } from '@vessel/application';

/** Default tier → member binding for the offline smoke server (mock providers). */
export const DEFAULT_TIER_BINDINGS: TierBindings = {
  pro: { providerId: 'mock', model: 'mock-pro' },
  fast: { providerId: 'mock', model: 'mock-fast' },
  review: { providerId: 'mock', model: 'mock-review' },
};

export interface RouteSeamOptions {
  /** tier → { providerId, model } (056 §10: provider/config layer injects) */
  bindings: TierBindings;
  /** fallback tier when a requested tier is not bound (default 'pro') */
  defaultTier?: string;
}

/**
 * RouteSeam — per-session model-choice state (mode + pin + last resolution).
 * Mirrors AutoTaskRouter's public semantics without holding ChatProvider
 * instances: resolve() is the 056 chain (auto classify → complexity → roles →
 * tiers → bindings; fast/pro bypass classify), pinCurrent/unpin as documented
 * in task 056. One instance per server session id.
 */
export class RouteSeam {
  private readonly bindings: TierBindings;
  private readonly defaultTier: string;
  private currentMode: RouteMode = 'auto';
  private pinnedRoute: AutoRoute | undefined;
  private lastRoute: AutoRoute | undefined;

  constructor(opts: RouteSeamOptions) {
    this.bindings = opts.bindings;
    this.defaultTier = opts.defaultTier ?? 'pro';
  }

  get mode(): RouteMode {
    return this.currentMode;
  }

  setMode(mode: unknown): boolean {
    if (mode !== 'auto' && mode !== 'fast' && mode !== 'pro') return false;
    this.currentMode = mode;
    return true;
  }

  get pinned(): boolean {
    return this.pinnedRoute !== undefined;
  }

  /**
   * Resolve the mode (input override wins, else the session mode) for a task.
   * Auto + pinned → the locked route (no re-judge); explicit fast/pro always
   * resolves fresh (user's latest intent). The auto resolution is remembered as
   * the pin candidate.
   */
  resolve(input: { task?: string; mode?: RouteMode }): AutoRoute {
    const mode = input.mode ?? this.currentMode;
    let route: AutoRoute;
    if (mode === 'auto' && this.pinnedRoute) {
      route = { ...this.pinnedRoute, pinned: true };
    } else {
      route = mode === 'auto' ? this.resolveAuto(input.task) : this.resolveExplicit(mode);
    }
    // keep the latest resolution as the display route (pin candidate for auto)
    this.lastRoute = route;
    return route;
  }

  /** Pin for this session — locks the last auto resolution (056 semantics). */
  pin(): AutoRoute {
    if (this.pinnedRoute) return { ...this.pinnedRoute, pinned: true };
    if (!this.lastRoute || this.lastRoute.mode !== 'auto') {
      throw new Error('no auto route to pin — resolve a task in auto mode first');
    }
    this.pinnedRoute = this.lastRoute;
    return { ...this.pinnedRoute, pinned: true };
  }

  unpin(): void {
    this.pinnedRoute = undefined;
  }

  /** Session route state for the UI (mode + pin + last resolution). */
  state(): { mode: RouteMode; pinned: boolean; route: AutoRoute | null } {
    const route = this.lastRoute ? { ...this.lastRoute, pinned: this.pinned } : null;
    return { mode: this.currentMode, pinned: this.pinned, route };
  }

  private resolveExplicit(mode: 'fast' | 'pro'): AutoRoute {
    const { binding, configured, hint } = resolveTierBinding(mode, this.bindings, this.defaultTier);
    const model: ResolvedRoleModel = {
      role: 'developer',
      tier: mode,
      providerId: binding.providerId,
      model: binding.model,
      configured,
    };
    return {
      mode,
      category: 'unknown',
      roles: ['developer'],
      roleModels: [model],
      primary: model,
      hints: hint ? [hint] : [],
      pinned: false,
    };
  }

  private resolveAuto(task?: string): AutoRoute {
    const category = task && task.trim().length > 0 ? classifyTask(task) : 'unknown';
    const complexity = complexityForCategory(category);
    const roles = rolesForComplexity(complexity);
    const hints: string[] = [];
    const roleModels: ResolvedRoleModel[] = roles.map((role) => {
      const tier = roleTierFor(role, complexity, undefined, this.defaultTier);
      const { binding, configured, hint } = resolveTierBinding(tier, this.bindings, this.defaultTier);
      if (hint) hints.push(hint);
      return { role, tier, providerId: binding.providerId, model: binding.model, configured };
    });
    return {
      mode: 'auto',
      category,
      complexity,
      roles,
      roleModels,
      primary: roleModels[0]!,
      hints,
      pinned: false,
    };
  }
}

/** Team bus event → TeamDelta kind (web SSE frame discrimination). */
export type TeamEventKind = 'start' | 'phase' | 'end' | 'turn' | 'tool' | 'delegate';

const EVENT_KIND: Record<string, TeamEventKind> = {
  team_start: 'start',
  team_phase: 'phase',
  team_end: 'end',
  before_turn: 'turn',
  after_turn: 'turn',
  after_tool: 'tool',
  subagent_start: 'delegate',
  subagent_stop: 'delegate',
};

export interface ActiveTeamRun {
  runId: string;
  bus: EventBus;
  /** current TeamProjection snapshot (null until team_start lands) */
  snapshot(): TeamRunState | null;
  /** subscribe to snapshot updates (kind + full state); returns unsubscribe */
  onUpdate(cb: (kind: TeamEventKind, state: TeamRunState | null) => void): () => void;
  /** resolves when the run settles (outcome + error message, never rejects) */
  settled: Promise<{ outcome: string; error?: string }>;
  /** tear down bus listeners */
  close(): void;
}

export interface StartTeamRunOptions {
  workspaceRoot: string;
  task: string;
  acceptance?: readonly string[];
  /** resolved route (roles + roleModels) from RouteSeam — the roster plan */
  route: AutoRoute;
  /** providerId → ChatProvider for the member models (mock default in server) */
  providers: Record<string, ChatProvider>;
  /** shared policy artifacts (default server policy yaml compiled once) */
  policyArtifacts: PolicyArtifacts;
}

/**
 * Start one team run over its own EventBus with an attached TeamProjection.
 * Listens to the eight events the projection consumes and pushes full-state
 * snapshots to onUpdate subscribers — the web 'team' SSE frames are exactly
 * these. runTeam never rejects for runtime failures (outcome 'failed' is a
 * returned state); structural errors reject and are captured into `settled`.
 */
export async function startTeamRun(opts: StartTeamRunOptions): Promise<ActiveTeamRun> {
  const bus = new EventBus();
  const projection = new TeamProjection();
  projection.attach(bus);

  const runtime = new TeamRuntime({
    workspaceRoot: opts.workspaceRoot,
    providers: opts.providers,
    policyArtifacts: opts.policyArtifacts,
    tools: [],
    bus,
  });

  const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const listeners = new Set<(kind: TeamEventKind, state: TeamRunState | null) => void>();
  const offs: (() => void)[] = [];
  for (const [event, kind] of Object.entries(EVENT_KIND)) {
    const off = bus.on(event, () => {
      const state = projection.state();
      for (const cb of listeners) cb(kind, state);
    }, `team-seam:${runId}:${event}`);
    offs.push(off);
  }

  const settled = runtime
    .runTeam({
      task: opts.task,
      acceptance: opts.acceptance,
      route: {
        complexity: opts.route.complexity,
        roles: [...opts.route.roles],
        roleModels: [...opts.route.roleModels],
      },
    })
    .then(
      (summary) => ({ outcome: summary.outcome, error: summary.error }),
      (err: unknown) => ({ outcome: 'failed', error: err instanceof Error ? err.message : String(err) }),
    );

  return {
    runId,
    bus,
    snapshot: () => projection.state(),
    onUpdate: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    settled,
    close: () => {
      for (const off of offs) off();
      listeners.clear();
    },
  };
}
