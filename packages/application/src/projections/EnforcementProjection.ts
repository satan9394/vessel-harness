import type { EventBus } from '@vessel/core';
import type { SandboxStatus, ToolErrorPayload } from '@vessel/shared';
import type {
  EnforcementEvent,
  EnforcementSource,
  EnforcementTelemetrySnapshot,
  ProcessTreeAuditEvent,
} from './types.js';

type PolicyDecisionPayload = {
  toolCallId: string;
  toolName: string;
  verdict: 'allow' | 'deny' | 'ask';
  decisionPath?: string[];
  ruleRef?: string;
  reason?: string;
};

/** Minimal structural slice of a session record the fs-confinement fold needs. */
interface FoldableToolResultRecord {
  type: 'tool/result';
  toolCallId: string;
  toolName: string;
  error?: ToolErrorPayload;
  meta: Record<string, unknown>;
}

/**
 * EnforcementProjection — task 074 runtime enforcement telemetry.
 *
 * A unified, queryable view over the 071-073 enforcement seams + the 050
 * audit/denial record style. It REUSES existing sources rather than inventing a
 * second event pipeline (avoid re-inventing; project the records already
 * emitted), and exposes an INJECTABLE seam for the runtime-side events that
 * have no bus/session representation:
 *
 *  - **policy denials** (050): reused from the `policy_decision` bus event with
 *    `verdict:'deny'` (same source as {@link PolicyProjection}); each is folded
 *    into an `EnforcementEvent` of type `deny`, source `policy`.
 *
 *  - **fs-confinement guard DENIED** (073): the tool guard throws an
 *    `FsGuardError` whose `guard` kind ('escape'|'protected'|'deny-read'|
 *    'confinement'|'size'|'nul') is recorded on the session `tool/result` as
 *    `error.errorClass === 'DENIED'` + `meta.guard`. The bus `after_tool`
 *    payload DROPS `meta`, so this is folded from the Session replay (the same
 *    reuse path Telemetry.finalizeRecord uses) via `foldSession()`. Each match
 *    becomes an `EnforcementEvent` of type = guard kind, source
 *    `fs-confinement`.
 *
 *  - **sandbox process-tree audit** (071/072): an append-only audit trail kept
 *    on the `Sandbox` runtime object — NOT on the bus/session. Consumers push
 *    process-tree events through `recordProcessTree(event)` (the injectable
 *    seam); each is reclassified by its `ProcessTreeAuditKind`.
 *
 *  - **sandbox backend / resource-limit status** (071): injected via
 *    `reportStatus(sandboxStatus, limits?)` so CLI/web can surface "which
 *    backend is enforcing, what caps are configured".
 *
 * Shape is fully injectable & assertable: `snapshot()` returns an immutable
 * aggregation (`events`, `counts`, `sources`, `recent(n)`, `status()`,
 * `treeAudit()`).
 */
export class EnforcementProjection {
  private readonly eventLog: EnforcementEvent[] = [];
  private readonly typeCounts = new Map<string, number>();
  private readonly sourceCountsMap: Record<EnforcementSource, number> = {
    policy: 0,
    'fs-confinement': 0,
    'process-tree': 0,
    'sandbox-status': 0,
  };
  private readonly treeAuditEvents: ProcessTreeAuditEvent[] = [];
  private statusValue?: SandboxStatus;
  private limitSummary?: string[];

  /** Subscribe to `policy_decision` deny events (050 reuse). Returns detach. */
  attach(bus: EventBus): () => void {
    return bus.on(
      'policy_decision',
      (payload) => {
        const p = payload as PolicyDecisionPayload;
        if (p.verdict !== 'deny') return;
        this.recordEvent({
          type: 'deny',
          source: 'policy',
          detail: p.reason ?? 'policy deny',
          meta: { toolCallId: p.toolCallId, toolName: p.toolName, ruleRef: p.ruleRef },
        });
      },
      'projection:enforcement:policy',
    );
  }

  /**
   * Fold the Session replay for fs-confinement guard DENIED (073 reuse). The
   * bus `after_tool` drops `meta`, so the authoritative guard kind lives on the
   * `tool/result` session record (`errorClass:'DENIED'` + `meta.guard`).
   * Safe to call repeatedly; skips records already seen.
   */
  foldSession(session: { replay(): readonly FoldableToolResultRecord[] }): void {
    for (const r of session.replay()) {
      if (r.type !== 'tool/result') continue;
      const guard: unknown = r.meta?.guard;
      if (!guard) continue;
      if (r.error?.errorClass !== 'DENIED') continue;
      this.recordEvent({
        type: String(guard),
        source: 'fs-confinement',
        detail: r.error.message ?? `fs guard ${String(guard)}`,
        meta: { toolCallId: r.toolCallId, toolName: r.toolName, guard: String(guard) },
      });
    }
  }

  /**
   * Injectable runtime seam: push a process-tree audit event (071/072) produced
   * by the Sandbox runtime audit trail. Each event's `kind` becomes its type.
   */
  recordProcessTree(event: ProcessTreeAuditEvent): void {
    this.treeAuditEvents.push(event);
    this.recordEvent({
      type: event.kind,
      source: 'process-tree',
      ts: event.at,
      detail: event.detail,
      meta: event.pid !== undefined ? { pid: event.pid } : undefined,
    });
  }

  /**
   * Injectable runtime seam: report the sandbox backend / resource-limit status
   * (071). `limits` is an optional human list of enforced caps (e.g. max active
   * processes / working set) surfaced by CLI/web.
   */
  reportStatus(status: SandboxStatus, limits?: string[]): void {
    this.statusValue = { ...status };
    this.limitSummary = limits ? [...limits] : undefined;
    this.recordEvent({
      type: 'report',
      source: 'sandbox-status',
      detail: `${status.backend ?? 'none'} backend enabled=${status.enabled} active=${status.active}`,
      meta: {
        backend: status.backend,
        supported: status.supported,
        limits: this.limitSummary,
      },
    });
  }

  /** All aggregated enforcement events, oldest-first (defensive copy). */
  events(): readonly EnforcementEvent[] {
    return this.copyEvents();
  }

  /** Count per classified enforcement type. */
  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    // stable order: first-seen
    for (const e of this.eventLog) {
      out[e.type] = (out[e.type] ?? 0) + 1;
    }
    return out;
  }

  /** Count per source module (all four enforcement seams). */
  sourceCounts(): Record<EnforcementSource, number> {
    return { ...this.sourceCountsMap };
  }

  /** Last `n` events, newest-first (defensive copy). */
  recent(n: number): readonly EnforcementEvent[] {
    return this.copyEvents().slice(-n).reverse();
  }

  /** Current sandbox backend / resource-limit status (undefined if unreported). */
  status(): SandboxStatus | undefined {
    return this.statusValue ? { ...this.statusValue } : undefined;
  }

  /** Process-tree audit events pushed through the runtime seam. */
  treeAudit(): readonly ProcessTreeAuditEvent[] {
    return this.treeAuditEvents.map((e) => ({ ...e }));
  }

  /** One immutable queryable snapshot of the whole telemetry surface. */
  snapshot(): EnforcementTelemetrySnapshot {
    const self = this;
    return {
      get events() {
        return self.events();
      },
      get counts() {
        return self.counts();
      },
      get sources() {
        return self.sourceCounts();
      },
      recent(n: number) {
        return self.recent(n);
      },
      status() {
        return self.status();
      },
      treeAudit() {
        return self.treeAudit();
      },
    };
  }

  /** Internal fold: append + increment counters. */
  private recordEvent(
    e: Pick<EnforcementEvent, 'type' | 'source' | 'detail' | 'meta'> & { ts?: number },
  ): void {
    const ts = e.ts ?? Date.now();
    this.eventLog.push({
      type: e.type,
      source: e.source,
      ts,
      detail: e.detail,
      meta: e.meta,
    });
    this.typeCounts.set(e.type, (this.typeCounts.get(e.type) ?? 0) + 1);
    this.sourceCountsMap[e.source] += 1;
  }

  private copyEvents(): EnforcementEvent[] {
    return this.eventLog.map((e) => ({ ...e, meta: e.meta ? { ...e.meta } : undefined }));
  }
}