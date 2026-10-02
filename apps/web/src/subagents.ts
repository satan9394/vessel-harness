import type { ApiClient } from './api';
import { createEventStream, type SseFrame } from './sse';

/** Compact wire mirror; full agent prompts and results never enter the panel. */
export interface SubagentItem {
  id: string;
  name: string;
  provider: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';
  worktreePath?: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  lastError?: string;
}

export interface SubagentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface SubagentLog { phase: string; message: string; ts: number }
export interface SubagentDetail { summary: SubagentItem; logs: SubagentLog[]; usage: SubagentUsage }
interface SubagentDelta {
  id: string;
  summary?: SubagentItem;
  phase?: string;
  message?: string;
  usage?: SubagentUsage;
}

/** Open the stream before loading snapshots so a fast completion cannot disappear. */
export function watchSubagents(
  api: Pick<ApiClient, 'listSubagents' | 'subagentEventsUrl'>,
  onChange: (items: SubagentItem[]) => void,
  onFrame: (delta: SubagentDelta, ts: number) => void,
  onError: (error: unknown) => void,
) {
  const items = new Map<string, SubagentItem>();
  const revisions = new Map<string, number>();
  let revision = 0;
  let request = 0;
  let closed = false;
  const refresh = () => {
    const atRevision = revision;
    const thisRequest = ++request;
    return api.listSubagents().then(({ subagents }) => {
      if (closed || thisRequest !== request) return;
      for (const item of subagents) {
        if (!items.has(item.id) || (revisions.get(item.id) ?? 0) <= atRevision) items.set(item.id, item);
      }
      const present = new Set(subagents.map((item) => item.id));
      for (const id of items.keys()) {
        if (!present.has(id) && (revisions.get(id) ?? 0) <= atRevision) {
          items.delete(id);
          revisions.delete(id);
        }
      }
      onChange([...items.values()]);
    }).catch((error: unknown) => { if (!closed) onError(error); });
  };
  const stream = createEventStream(api.subagentEventsUrl, {
    onOpen: () => { void refresh(); },
    onEvent(frame: SseFrame) {
      if (closed || !['subagent:start', 'subagent:step', 'subagent:end'].includes(frame.type)) return;
      const delta = frame.delta as SubagentDelta | undefined;
      if (!delta || typeof delta.id !== 'string') return;
      revisions.set(delta.id, ++revision);
      if (delta.summary) {
        items.set(delta.id, delta.summary);
      }
      onChange([...items.values()]);
      onFrame(delta, frame.ts ?? Date.now());
    },
    onError,
  });
  const ready = refresh();
  return { ready, close() { closed = true; stream.close(); } };
}
