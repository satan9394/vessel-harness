import { useI18n } from '../LanguageProvider';
import { useId, useState } from 'react';
import type { DiffInspectorWidget } from '@vessel/shared';
import { parseUnifiedDiff } from '@vessel/shared/widgets';
import { parsePatchHunks } from '../../../../../packages/shared/src/patch.js';
import { InteractivePatchPicker } from '../canvas/InteractivePatchPicker';
import { createApiClient } from '../../api';
export { parseUnifiedDiff } from '@vessel/shared/widgets';

export default function InlineDiffInspector({ widget, sessionId, onAction }: { widget: DiffInspectorWidget; sessionId?: string; onAction?: (hunkId: string, action: 'accept' | 'reject') => Promise<void> }) {
  const { t } = useI18n();
  const rows = parseUnifiedDiff(widget.payload.patch);
  const [collapsed, setCollapsed] = useState(widget.payload.collapsedByDefault ?? rows.length > 20);
  const id = useId();
  const additions = rows.filter(row => row.kind === 'add').length;
  const deletions = rows.filter(row => row.kind === 'remove').length;
  let hunks: import('@vessel/shared').DiffHunk[] = [];
  try { hunks = parsePatchHunks(widget.payload.patch, widget.payload.filePath).map(hunk => ({ ...hunk, status: widget.payload.hunkStatuses?.[hunk.id] ?? 'pending' })); }
  catch { /* Unsupported patches retain the existing read-only inspector. */ }
  return <section className="inline-widget" aria-label={t('uiDiffInspector')}>
    <header className="widget-head"><code>{widget.payload.filePath}</code><span className="diff-add">+{additions}</span><span className="diff-remove">−{deletions}</span>
      <button type="button" className="btn" aria-expanded={!collapsed} aria-controls={id} onClick={() => setCollapsed(value => !value)}>{collapsed ? t('expandLines', { count: String(rows.length) }) : t('uiCollapseDiff')}</button></header>
    <div id={id} className="widget-diff" hidden={collapsed} role="region" aria-label={t('uiUnifiedDiff')}>{!collapsed && (sessionId && hunks.length
      ? <InteractivePatchPicker key={`${sessionId}:${widget.id}`} hunks={hunks} onAction={onAction ?? (async (hunkId, action) => { await createApiClient().applyPatch(sessionId, widget.id, hunkId, action); })} />
      : <table aria-label={t('uiOldLineNewLinePatch')}><tbody>{rows.map((row, index) => <tr key={index} className={`diff-${row.kind}`}><td className="diff-number">{row.oldLine ?? ''}</td><td className="diff-number">{row.newLine ?? ''}</td><td><code>{row.text || ' '}</code></td></tr>)}</tbody></table>)}</div>
  </section>;
}
