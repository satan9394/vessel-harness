import type { ChatProvider } from '@vessel/shared';
import type { ComposedHarness, ComposeOptions } from '../compose.js';
import { composeHarness } from '../compose.js';
import { SessionRegistry, type SessionMeta } from './SessionRegistry.js';

/** Permission profiles a session can be composed with. */
export type SessionPermission = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface SessionControllerOptions extends ComposeOptions {
  /** id of the already-created session (must match composeHarness sessionId). */
  id?: string;
  /** registry to register the session in; omitted → in-memory only. */
  registry?: SessionRegistry;
  /**
   * provider id label recorded in the registry meta. Defaults to the
   * ChatProvider's own `id` when the options override it is not given.
   */
  providerId?: string;
}

/** Snapshot of the current session control-plane state. */
export interface SessionState {
  id: string;
  workspaceRoot: string;
  provider: string;
  model: string;
  permission: SessionPermission;
}

/**
 * SessionController — the stable command surface for one application session.
 *
 * Wraps the ComposeRoot's ComposedHarness (loop / session / bus) so the CLI and
 * future Web surface call a single command API instead of each duplicating the
 * compose→run→close wiring. The underlying loop/session stay reachable for
 * event subscription via the public `session` and `bus` fields.
 *
 * `interrupt`/`steer` are reserved seams for Milestone C (real implementation);
 * this card keeps them as safe no-ops that never crash, storing their inputs so
 * a future card can consume them without changing the public shape.
 */
export class SessionController {
  private readonly harness: ComposedHarness;
  readonly sessionId: string;
  private readonly providerId: string;
  private readonly model: string;
  private readonly permission: SessionPermission;

  private abortController: AbortController | null = null;
  private readonly pendingSteers: string[] = [];

  private constructor(harness: ComposedHarness, opts: SessionControllerOptions) {
    this.harness = harness;
    this.sessionId = opts.id ?? harness.session.sessionId;
    this.providerId = opts.providerId ?? opts.provider.id;
    this.model = opts.model;
    this.permission = (opts.permission ?? 'workspace-write') as SessionPermission;
  }

  /**
   * Compose a full session then wrap it in a controller. Registers the session
   * metadata in the registry (when provided) so `list`/`get` see it.
   */
  static async create(opts: SessionControllerOptions): Promise<SessionController> {
    const harness = await composeHarness(opts);
    const ctl = new SessionController(harness, opts);
    const now = new Date().toISOString();
    const meta: SessionMeta = {
      id: ctl.sessionId,
      workspaceRoot: opts.workspaceRoot,
      provider: ctl.providerId,
      model: ctl.model,
      permission: ctl.permission,
      createdAt: now,
      updatedAt: now,
    };
    opts.registry?.put(meta);
    return ctl;
  }

  /** Current control-plane state snapshot. */
  get state(): SessionState {
    return {
      id: this.sessionId,
      workspaceRoot: this.harness.session.workspaceRoot,
      provider: this.providerId,
      model: this.model,
      permission: this.permission,
    };
  }

  /** The composed core Session (append-only event log) — for event subscription. */
  get session() {
    return this.harness.session;
  }

  /** The composed EventBus — subscribe to before_model/before_tool/etc. */
  get bus() {
    return this.harness.bus;
  }

  /** The composed AgentLoop (advanced use; prefer runTurn). */
  get loop() {
    return this.harness.loop;
  }

  /** Run one user turn through the session loop. */
  async runTurn(prompt: string) {
    this.abortController?.abort();
    this.abortController = new AbortController();
    return this.harness.loop.runTurn(prompt);
  }

  /**
   * Reserved seam: request an interrupt of the current turn. Milestone C wires
   * this into the loop's checkpoints; for now it attaches/aborts an
   * AbortController so the plumbing is in place without changing behavior.
   */
  interrupt(): void {
    this.abortController?.abort();
  }

  /**
   * Reserved seam: steer the session with a control message. Milestone C will
   * consume these from a pending queue during a turn; this card stores them.
   */
  steer(message: string): void {
    this.pendingSteers.push(message);
  }

  /** Number of buffered, unconsumed steer messages (Milestone C). */
  get pendingSteerCount(): number {
    return this.pendingSteers.length;
  }

  /** Close the composed harness (session log, MCP clients, telemetry detach). */
  async close(): Promise<void> {
    this.abortController?.abort();
    await this.harness.close();
  }
}