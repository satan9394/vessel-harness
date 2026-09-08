import type { EventBus } from '@vessel/core';
import type { ToolActivity, ToolActivityStatus } from './types.js';

type BeforeToolPayload = { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
type AfterToolPayload = {
  toolCallId: string;
  toolName: string;
  result: { content?: string; error?: { errorClass?: string; message?: string } };
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
 *  - `before_tool` (waterfall, visited by `bus.on`) → status `started`, args summary
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

  attach(bus: EventBus): () => void {
    const offStart = bus.on(
      'before_tool',
      (payload) => {
        const p = payload as BeforeToolPayload;
        if (typeof p.toolName !== 'string') return;
        const ts = Date.now();
        this.startedAt.set(p.toolCallId, ts);
        const entry: ToolActivity = {
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
      },
      'projection:toolactivity:start',
    );

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
          toolName: p.toolName,
          status,
          argsSummary: existing !== undefined ? this.items[existing]?.argsSummary : undefined,
          durationMs,
          ts,
        };
        if (existing !== undefined) {
          this.items[existing] = entry;
        } else {
          this.index.set(p.toolCallId, this.items.length);
          this.items.push(entry);
        }
      },
      'projection:toolactivity:end',
    );

    return () => {
      offStart();
      offEnd();
    };
  }

  activities(): ToolActivity[] {
    return this.items;
  }
}