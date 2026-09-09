import type { ChatProvider } from '@vessel/shared';
import type { SteerSource } from '@vessel/core';
import type { ComposedHarness, ComposeOptions } from '../compose.js';
import { composeHarness } from '../compose.js';
import { SessionRegistry, type SessionMeta } from './SessionRegistry.js';
import {
  ConversationProjection,
  ToolActivityProjection,
  UsageProjection,
  PolicyProjection,
  type CatalogPriceSource,
  type PricingTable,
} from '../projections/index.js';

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
  /** optional pricing table for the Usage projection cost estimate. */
  pricingTable?: PricingTable;
  /** optional catalog price source (model-catalog.json) — fallback chain 2nd link (task 087). */
  pricingCatalog?: CatalogPriceSource;
  /** strict pricing: 只用模型专属价目（model/catalog），未收录模型按 0 计价（task 086）. */
  strictPricing?: boolean;
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
 * Projection bundle attached to the session's bus. The Web/CLI surface reads
 * these read-only facts instead of parsing the raw event JSONL.
 */
export interface SessionProjections {
  conversation: ConversationProjection;
  toolActivity: ToolActivityProjection;
  usage: UsageProjection;
  policy: PolicyProjection;
}

/**
 * SessionController — the stable command surface for one application session.
 *
 * Wraps the ComposeRoot's ComposedHarness (loop / session / bus) so the CLI and
 * future Web surface call a single command API instead of each duplicating the
 * compose→run→close wiring. The underlying loop/session stay reachable for
 * event subscription via the public `session` and `bus` fields.
 *
 * `interrupt` (task 050) aborts the loop's active turn scope in real time —
 * the turn then closes with kind='interrupted'. `steer` (task 051) enqueues a
 * user direction-change directive into the loop's SteeringQueue — it never
 * stops anything, and is consumed at the next step boundary where it becomes a
 * B01 user/message record (source='steer') injected into the next model
 * context (interrupt = 停, steer = 改方向继续).
 */
export class SessionController {
  private readonly harness: ComposedHarness;
  readonly sessionId: string;
  private readonly providerId: string;
  private readonly model: string;
  private readonly permission: SessionPermission;

  /** bus-attached event projections (read-only UI facts). */
  readonly projections: SessionProjections;
  private readonly detachProjections: () => void;

  private constructor(harness: ComposedHarness, opts: SessionControllerOptions) {
    this.harness = harness;
    this.sessionId = opts.id ?? harness.session.sessionId;
    this.providerId = opts.providerId ?? opts.provider.id;
    this.model = opts.model;
    this.permission = (opts.permission ?? 'workspace-write') as SessionPermission;

    this.projections = {
      conversation: new ConversationProjection(),
      toolActivity: new ToolActivityProjection(),
      usage: new UsageProjection({
        model: this.model,
        pricingTable: opts.pricingTable,
        catalog: opts.pricingCatalog,
        protocol: this.providerId,
        strict: opts.strictPricing,
      }),
      policy: new PolicyProjection(),
    };
    const detaches = [
      this.projections.conversation.attach(harness.bus),
      this.projections.toolActivity.attach(harness.bus),
      this.projections.usage.attach(harness.bus),
      this.projections.policy.attach(harness.bus),
    ];
    this.detachProjections = () => {
      for (const off of detaches) off();
    };
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

  /**
   * Run one user turn through the session loop. The loop owns a per-turn
   * interrupt scope (AgentLoop.begin/end), so calling runTurn while an older
   * turn is still running aborts that stale turn (same semantics as the
   * controller's previous per-call AbortController).
   */
  async runTurn(prompt: string) {
    return this.harness.loop.runTurn(prompt);
  }

  /**
   * Request an interrupt of the current turn (task 050). Aborts the loop's
   * active turn scope: in-flight provider streams / tool executions stop and
   * the turn ends with kind='interrupted'. No-op when no turn is running.
   */
  interrupt(): void {
    this.harness.loop.interrupt();
  }

  /**
   * Steer the session with a user control message (task 051). Forwards into the
   * loop's SteeringQueue: the directive is consumed at the next step boundary
   * and injected as a user-level message into the next model context — it never
   * interrupts an in-flight tool call or atomic file write.
   */
  steer(message: string, source?: SteerSource): void {
    this.harness.loop.steer(message, source);
  }

  /** Number of buffered, unconsumed steer directives (task 051). */
  get pendingSteerCount(): number {
    return this.harness.loop.pendingSteerCount;
  }

  /** Close the composed harness (session log, MCP clients, telemetry detach). */
  async close(): Promise<void> {
    this.detachProjections();
    await this.harness.close();
  }
}