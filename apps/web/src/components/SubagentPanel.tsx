import { useCallback, useEffect, useRef, useState } from 'react';
import { createApiClient, type ApiClient } from '../api';
import { watchSubagents, type SubagentDetail, type SubagentItem, type SubagentUsage } from '../subagents';

export type { SubagentItem } from '../subagents';
export interface SubagentPanelProps { subagents: SubagentItem[]; onCancel?: (id: string) => void }

export function SubagentListPanel({ subagents, selectedId, onSelect, onCancel, cancellingId }: SubagentPanelProps & {
  selectedId?: string | null;
  onSelect: (id: string) => void;
  cancellingId?: string | null;
}) {
  return <section className="subagent-list" aria-label="Subagents">
    <h3 className="side-label">Subagents</h3>
    {subagents.length === 0 ? <div className="side-empty">No active subagents</div> :
      <ul className="side-list">{subagents.map((sub) => <li className="subagent-card" key={sub.id} data-testid={`subagent-card-${sub.id}`}>
        <button type="button" className={`side-item subagent-select${selectedId === sub.id ? ' side-item-active' : ''}`}
          aria-expanded={selectedId === sub.id} aria-controls="subagent-detail" onClick={() => onSelect(sub.id)}>
          <span className="subagent-name">{sub.name}</span>
          <span className={`subagent-badge status-${sub.status}`}>{sub.status}</span>
        </button>
        {sub.status === 'running' && onCancel && <button type="button" className="topic-action"
          disabled={cancellingId === sub.id} aria-label={`Cancel ${sub.name}`} onClick={() => onCancel(sub.id)}>Cancel</button>}
      </li>)}</ul>}
  </section>;
}

export function SubagentDetailDrawer({ subagent, detail, onClose, onCancel, cancelling }: {
  subagent: SubagentItem;
  detail?: SubagentDetail;
  onClose: () => void;
  onCancel?: (id: string) => void;
  cancelling?: boolean;
}) {
  const usage: SubagentUsage = detail?.usage ?? {};
  const durationMs = subagent.endedAt ? Date.parse(subagent.endedAt) - Date.parse(subagent.startedAt) : undefined;
  return <aside id="subagent-detail" className="subagent-drawer" role="dialog" aria-labelledby="subagent-detail-title"
    data-testid="subagent-drawer" onKeyDown={(event) => { if (event.key === 'Escape') onClose(); }}>
    <div className="subagent-drawer-heading"><h3 id="subagent-detail-title">{subagent.name} Details</h3>
      <button type="button" className="btn" autoFocus onClick={onClose}>Close</button></div>
    <dl className="subagent-fields">
      <dt>ID</dt><dd>{subagent.id}</dd><dt>Provider</dt><dd>{subagent.provider}</dd>
      <dt>Status</dt><dd>{subagent.status}</dd><dt>Worktree</dt><dd>{subagent.worktreePath ?? '—'}</dd>
      <dt>Started</dt><dd>{subagent.startedAt}</dd><dt>Ended</dt><dd>{subagent.endedAt ?? '—'}</dd>
      <dt>Duration</dt><dd>{durationMs === undefined ? '—' : `${durationMs.toLocaleString()} ms`}</dd>
      <dt>Exit code</dt><dd>{subagent.exitCode ?? '—'}</dd>
    </dl>
    {subagent.lastError && <p className="error-text">{subagent.lastError}</p>}
    <h4>Token usage</h4><dl className="talking-metrics" aria-label="Subagent token usage">
      {([['Input', 'inputTokens'], ['Output', 'outputTokens'], ['Cache read', 'cacheReadTokens'], ['Cache write', 'cacheWriteTokens']] as const)
        .map(([label, key]) => <div className="talking-metric" key={key}><dt>{label}</dt><dd>{usage[key] === undefined ? '—' : `${usage[key].toLocaleString()} tok`}</dd></div>)}
    </dl>
    <h4>Execution stages</h4><ol className="subagent-logs" aria-live="polite">
      {detail?.logs.map((log, index) => <li key={index}><time dateTime={new Date(log.ts).toISOString()}>{new Date(log.ts).toLocaleTimeString()}</time> <strong>{log.phase}</strong> {log.message}</li>)}
    </ol>
    {subagent.status === 'running' && onCancel && <button type="button" className="btn" disabled={cancelling}
      onClick={() => onCancel(subagent.id)}>Cancel</button>}
  </aside>;
}

export function SubagentPanel({ subagents, onCancel }: SubagentPanelProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = subagents.find((sub) => sub.id === selectedId);
  return <div className="subagent-panel" data-testid="subagent-panel">
    <SubagentListPanel subagents={subagents} selectedId={selectedId} onSelect={setSelectedId} onCancel={onCancel} />
    {selected && <SubagentDetailDrawer subagent={selected} onClose={() => setSelectedId(null)} onCancel={onCancel} />}
  </div>;
}

/** Sidebar controller: compact list, bounded detail replay, and native SSE lifecycle. */
export default function SubagentWorkspace({ api: suppliedApi }: { api?: ApiClient }) {
  const [api] = useState(() => suppliedApi ?? createApiClient());
  const [subagents, setSubagents] = useState<SubagentItem[]>([]);
  const [details, setDetails] = useState<Record<string, SubagentDetail>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const activeIds = useRef(new Set<string>());
  const reportError = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  useEffect(() => {
    const watcher = watchSubagents(api, (items) => {
      activeIds.current = new Set(items.map((item) => item.id));
      setSubagents(items);
      setDetails((current) => Object.fromEntries(Object.entries(current).filter(([id]) => activeIds.current.has(id))));
      setSelectedId((id) => id && activeIds.current.has(id) ? id : null);
    }, (delta, ts) => {
      revision.current++;
      setDetails((current) => {
        const previous = current[delta.id];
        const summary = delta.summary ?? previous?.summary;
        if (!summary) return current;
        return { ...current, [delta.id]: { summary,
          logs: [...(previous?.logs ?? []), ...(delta.phase || delta.message ? [{ phase: delta.phase ?? 'step', message: delta.message ?? '', ts }] : [])].slice(-100),
          usage: { ...previous?.usage, ...delta.usage },
        } };
      });
    }, reportError);
    return () => watcher.close();
  }, [api, reportError]);
  useEffect(() => {
    if (!selectedId) return;
    let closed = false;
    const atRevision = revision.current;
    void api.getSubagent(selectedId).then((detail) => {
      if (closed || !activeIds.current.has(selectedId)) return;
      setDetails((current) => {
        const live = current[selectedId];
        if (!live || atRevision === revision.current) return { ...current, [selectedId]: detail };
        const logs = [...detail.logs, ...live.logs].filter((log, index, all) =>
          all.findIndex((other) => other.ts === log.ts && other.phase === log.phase && other.message === log.message) === index);
        return { ...current, [selectedId]: { summary: live.summary, logs: logs.sort((a, b) => a.ts - b.ts).slice(-100), usage: { ...detail.usage, ...live.usage } } };
      });
    }).catch((cause: unknown) => { if (!closed) reportError(cause); });
    return () => { closed = true; };
  }, [api, selectedId, reportError]);
  async function cancel(id: string) {
    setCancellingId(id);
    setError('');
    try { await api.cancelSubagent(id); } catch (cause) { reportError(cause); }
    finally { setCancellingId(null); }
  }
  const selected = subagents.find((sub) => sub.id === selectedId);
  return <div className="subagent-panel" data-testid="subagent-panel">
    <SubagentListPanel subagents={subagents} selectedId={selectedId} onSelect={setSelectedId}
      onCancel={(id) => void cancel(id)} cancellingId={cancellingId} />
    {error && <p className="error-text" role="alert">{error}</p>}
    {selected && <SubagentDetailDrawer subagent={selected} detail={details[selected.id]} onClose={() => setSelectedId(null)}
      onCancel={(id) => void cancel(id)} cancelling={cancellingId === selected.id} />}
  </div>;
}
