import { useId, useState } from 'react';
import type { DiffInspectorWidget } from '@vessel/shared';
import { parseUnifiedDiff } from '@vessel/shared/widgets';
export { parseUnifiedDiff } from '@vessel/shared/widgets';

export default function InlineDiffInspector({ widget }: { widget: DiffInspectorWidget }) {
  const rows = parseUnifiedDiff(widget.payload.patch);
  const [collapsed, setCollapsed] = useState(widget.payload.collapsedByDefault ?? rows.length > 20);
  const id = useId();
  const additions = rows.filter(row => row.kind === 'add').length;
  const deletions = rows.filter(row => row.kind === 'remove').length;
  return <section className="inline-widget" aria-label="Diff inspector">
    <header className="widget-head"><code>{widget.payload.filePath}</code><span className="diff-add">+{additions}</span><span className="diff-remove">−{deletions}</span>
      <button type="button" className="btn" aria-expanded={!collapsed} aria-controls={id} onClick={() => setCollapsed(value => !value)}>{collapsed ? `Expand ${rows.length} lines` : 'Collapse diff'}</button></header>
    <div id={id} className="widget-diff" hidden={collapsed} role="region" aria-label="Unified diff">{!collapsed && <table aria-label="Old line, new line, patch"><tbody>{rows.map((row, index) => <tr key={index} className={`diff-${row.kind}`}><td className="diff-number">{row.oldLine ?? ''}</td><td className="diff-number">{row.newLine ?? ''}</td><td><code>{row.text || ' '}</code></td></tr>)}</tbody></table>}</div>
  </section>;
}
