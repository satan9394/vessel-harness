import type { EventBus } from '@vessel/core';
import type { SandboxAudit, ToolActivity, ToolActivityStatus } from './types.js';

type BeforeToolPayload = { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
type AfterToolPayload = {
  toolCallId: string;
  toolName: string;
  result: { content?: string; error?: { errorClass?: string; message?: string }; meta?: { sandbox?: Record<string, unknown> } };
};

const ARGS_MAX = 120;

/** Compact single-line summary of tool arguments (truncated). */
function summarize(args: Record<string, unknown> | undefined): string | undefined {
  if (!args) return undefined;
  try {
    const json = JSON.stringify(args);
    if (json.length <= ARGS_MAX) return json;
    return `${json.slice(0, ARGS_MAX)}…`;
  } catch {
    return String(args);
  }
}

/**
 * ToolActivityProjection — one row per tool dispatch.
 *
 * Sources (verified from packages/core/src/agent-loop/AgentLoop.ts):
 *  - `application/tool_started` → actual execution start + arguments
 *    (`before_tool` remains a compatible observation for standalone bus callers)
 *  - `after_tool` (emit) → terminal status (`denied` on DENIED error,
 *    `error` on other errors, else `done`) + durationMs
 *
 * Both `bus.on('before_tool')` listeners return `void` so the tool-policy
 * waterfalls keep their own authoritative decision.
 */
export class ToolActivityProjection {
  private readonly items: ToolActivity[] = [];
  /** toolCallId → index into items (for pairing started → terminal). */
  private readonly index = new Map<string, number>();
  /** toolCallId → start timestamp (duration computation). */
  private readonly startedAt = new Map<string, number>();
  private pendingShell?: string;
  private readonly audits = new Map<string, SandboxAudit>();

  attach(bus: EventBus): () => void {
    const start = (payload: unknown) => {
        const p = payload as BeforeToolPayload;
        if (typeof p.toolName !== 'string') return;
        const ts = Date.now();
        this.startedAt.set(p.toolCallId, ts);
        if (p.toolName === 'Shell') this.pendingShell = p.toolCallId;
        const entry: ToolActivity = {
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          status: 'started',
          argsSummary: summarize(p.arguments),
          ts,
        };
        const existing = this.index.get(p.toolCallId);
        if (existing !== undefined) {
          this.items[existing] = entry;
        } else {
          this.index.set(p.toolCallId, this.items.length);
          this.items.push(entry);
        }
      };
    const offStart = bus.on('before_tool', start, 'projection:toolactivity:start');
    const offExecutionStart = bus.on('application/tool_started', start, 'projection:toolactivity:execution-start');

    const offEnd = bus.on(
      'after_tool',
      (payload) => {
        const p = payload as AfterToolPayload;
        if (typeof p.toolName !== 'string') return;
        const ts = Date.now();
        const start = this.startedAt.get(p.toolCallId);
        const durationMs = start !== undefined ? ts - start : undefined;
        this.startedAt.delete(p.toolCallId);

        let status: ToolActivityStatus = 'done';
        if (p.result?.error) {
          status = p.result.error.errorClass === 'DENIED' ? 'denied' : 'error';
        }

        const existing = this.index.get(p.toolCallId);
        const entry: ToolActivity = {
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          status,
          argsSummary: existing !== undefined ? this.items[existing]?.argsSummary : undefined,
          durationMs,
          sandbox: this.audits.get(p.toolCallId) ?? sandboxAuditFromResult(p.result?.meta?.sandbox),
          ts,
        };
        this.audits.delete(p.toolCallId);
        if (this.pendingShell === p.toolCallId) this.pendingShell = undefined;
        if (existing !== undefined) {
          this.items[existing] = entry;
        } else {
          this.index.set(p.toolCallId, this.items.length);
          this.items.push(entry);
        }
      },
      'projection:toolactivity:end',
    );

    const offAudit = bus.on('audit/sandbox_enforced', payload => {
      // Shell is exclusive; the composition boundary emits its audit before after_tool.
      if (!this.pendingShell) return;
      const { isolationTier, sandboxed, outcome, allowedWritePaths, reason, constraints } = payload as SandboxAudit;
      this.audits.set(this.pendingShell, { isolationTier, sandboxed, outcome,
        ...(allowedWritePaths ? { allowedWritePaths: [...allowedWritePaths] } : {}), ...(reason ? { reason } : {}),
        ...(constraints ? { constraints: structuredClone(constraints) } : {}) });
    }, 'projection:toolactivity:sandbox');
    return () => {
      offStart();
      offExecutionStart();
      offEnd();
      offAudit();
    };
  }

  activities(): ToolActivity[] {
    return this.items;
  }

  activity(toolCallId: string): ToolActivity | undefined {
    const index = this.index.get(toolCallId);
    return index === undefined ? undefined : this.items[index];
  }
}

export function sandboxAuditFromResult(meta?: Record<string, unknown>): SandboxAudit | undefined {
  if (!meta) return undefined;
  const isolationTier = typeof meta.isolationTier === 'string' ? meta.isolationTier : 'passthrough-fallback';
  const sandboxed = meta.active === true && isolationTier !== 'passthrough-fallback';
  return { isolationTier, sandboxed, outcome: sandboxed ? 'enforced' : 'fallback',
    ...(typeof meta.reason === 'string' ? { reason: meta.reason } : {}) };
}
