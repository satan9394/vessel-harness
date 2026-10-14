import { useEffect, useState } from 'react';
import { useI18n } from '../LanguageProvider';
import type { ApiClient } from '../../api';
import {
  childrenOf,
  flattenTree,
  formatDuration,
  nodeById,
  taskStatusLabelKey,
  type TaskTreeNodeView,
  type TaskTreesResponse,
} from '../../workbench';
import '../card222.css';

export interface TeamTaskTreeProps {
  api?: Pick<ApiClient, 'taskTrees'>;
  sessionId?: string | null;
  /** server-side render / test fixture: preloaded snapshot, no fetch. */
  initial?: TaskTreesResponse;
}

/**
 * UI-016 — Team Task Tree. Renders the ARC-10 scheduler's published snapshots:
 * parent/child topology, dependency edges, leases, metrics and status badges,
 * with deterministic parent/child navigation.
 */
export default function TeamTaskTree({ api, sessionId, initial }: TeamTaskTreeProps) {
  const { t } = useI18n();
  const [data, setData] = useState<TaskTreesResponse | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const [treeIndex, setTreeIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!api) return;
    let active = true;
    api.taskTrees()
      .then((response) => { if (active) { setData(response); setError(null); } })
      .catch((failure) => { if (active) setError(failure); });
    return () => { active = false; };
  }, [api, revision, sessionId]);

  const trees = data?.trees ?? [];
  const snapshot = trees[Math.min(treeIndex, Math.max(0, trees.length - 1))];
  const node = snapshot && selected ? nodeById(snapshot, selected) : undefined;

  return (
    <section className="dashboard-panel team-task-tree" aria-label={t('tasksTitle')}>
      <h3>{t('tasksTitle')}</h3>
      <p className="dim">{t('tasksHint')}</p>
      <button className="btn" onClick={() => setRevision((value) => value + 1)}>{t('modelRetry')}</button>
      {error ? <p role="alert" className="error-text">{t('tasksReadError', { error: String((error as Error)?.message ?? error) })}</p> : null}
      {!error && trees.length === 0 ? <p className="dim">{t('tasksEmpty')}</p> : null}

      {trees.length > 1 && (
        <div className="task-tree-selector" role="group" aria-label={t('tasksSelect')}>
          {trees.map((tree, index) => (
            <button key={tree.rootInstanceId} className={`btn${index === treeIndex ? ' side-item-active' : ''}`} aria-pressed={index === treeIndex}
              onClick={() => { setTreeIndex(index); setSelected(null); }}>
              {tree.projectRoot || tree.rootInstanceId} · {tree.rootInstanceId}
            </button>
          ))}
        </div>
      )}

      {snapshot && (
        <>
          <p className="dim">{t('tasksProjectLabel')}: <code>{snapshot.projectRoot}</code> · {snapshot.rootInstanceId}</p>
          <ul className="task-tree-list" role="tree" aria-label={t('tasksTitle')}>
            {flattenTree(snapshot).map(({ node: item, depth }) => (
              <li key={item.instanceId} role="treeitem" aria-level={depth + 1} aria-selected={item.instanceId === selected}
                className="task-tree-node" data-status={item.status} data-instance={item.instanceId}
                style={{ marginLeft: `${depth * 0.9}rem` }}
                onClick={() => setSelected(item.instanceId)}>
                <button className="btn" onClick={(event) => { event.stopPropagation(); setSelected(item.instanceId); }}>{item.title}</button>
                <span className={`status-badge status-${item.status}`}>{t(taskStatusLabelKey(item.status))}</span>
                <span>{t('tasksDuration')}: {formatDuration(item.durationMs)}</span>
                <span>{t('tasksAttempt', { n: String(item.attempt) })}</span>
                <span>{t('tasksDependencies')}: {item.dependencies.length ? item.dependencies.join(', ') : t('tasksNone')}</span>
                {item.lease && <span>{t('tasksLease')}: {item.lease.holder}{item.lease.releaseReason ? ` (${item.lease.releaseReason})` : ''}</span>}
                {item.error && <span className="error-text">{t('tasksError')}: {item.error}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {snapshot && node && (
        <div className="card222-detail" aria-label={t('tasksNode')}>
          <h4>{node.title} · <code>{node.instanceId}</code></h4>
          <p><span className={`status-badge status-${node.status}`}>{t(taskStatusLabelKey(node.status))}</span> · {t('tasksDuration')}: {formatDuration(node.durationMs)}</p>
          <p>{t('tasksDependencies')}: {node.dependencies.length ? node.dependencies.join(', ') : t('tasksNone')}</p>
          {node.parentInstanceId && (
            <p><button className="btn" onClick={() => setSelected(node.parentInstanceId!)}>{t('tasksFocusParent')}</button></p>
          )}
          <p>{t('tasksChildren')}: {childrenOf(snapshot, node.instanceId).map((child) => child.instanceId).join(', ') || t('tasksNone')}</p>
          {node.aggregate && (
            <p>{t('tasksAggregate')}: {node.aggregate.completedChildren.length} ✓ / {node.aggregate.failedChildren.length} ✗ / {node.aggregate.cancelledChildren.length} ⊘</p>
          )}
          {node.cancellation && <p>{t('tasksCancelledBy')}: {node.cancellation.reason} · {node.cancellation.originInstanceId}</p>}
          {node.result?.output && <p>{node.result.output}</p>}
        </div>
      )}
      <TaskNodeJson node={node} label={t('traceDetail')} />
    </section>
  );
}

function TaskNodeJson({ node, label }: { node?: TaskTreeNodeView; label: string }) {
  if (!node) return null;
  return <details><summary>{label}</summary><pre className="trace-detail">{JSON.stringify(node, null, 2)}</pre></details>;
}
