import { localizedValue } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import { useState } from 'react';
import type { DiffHunk } from '@vessel/shared';

export interface InteractivePatchPickerProps {
  hunks: DiffHunk[];
  onAction: (hunkId: string, action: 'accept' | 'reject') => Promise<void>;
}
export function InteractivePatchPicker({ hunks, onAction }: InteractivePatchPickerProps): React.JSX.Element {
  const { t } = useI18n();
  const [decisions, setDecisions] = useState<Record<string, { status: DiffHunk['status']; source: DiffHunk; sourceStatus: DiffHunk['status'] }>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [sideBySide, setSideBySide] = useState(false);
  const currentStatus = (hunk: DiffHunk) => {
    const decision = decisions[hunk.id];
    // A server/SSE status change supersedes this instance's completed action.
    return decision?.source === hunk && decision.sourceStatus === hunk.status ? decision.status : hunk.status;
  };
  const decide = async (hunk: DiffHunk, action: 'accept' | 'reject') => {
    if (busy || currentStatus(hunk) === (action === 'accept' ? 'accepted' : 'rejected')) return;
    setBusy(hunk.id); setError('');
    try {
      await onAction(hunk.id, action);
      setDecisions(previous => ({ ...previous, [hunk.id]: { status: action === 'accept' ? 'accepted' : 'rejected', source: hunk, sourceStatus: hunk.status } }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : t('patchFailed')); }
    finally { setBusy(undefined); }
  };
  return <section aria-label={t('uiInteractivePatchPicker')}>
    <button className="btn" type="button" aria-pressed={sideBySide} onClick={() => setSideBySide(value => !value)}>{sideBySide ? t('viewUnified') : t('viewSplit')}</button>
    {error && <p role="alert">{error}</p>}
    {hunks.map(hunk => {
      const status = currentStatus(hunk);
      let oldLine = hunk.oldStart; let newLine = hunk.newStart;
      return <article key={hunk.id} aria-label={hunk.id} className="inline-widget">
        <header className="widget-head"><code>{hunk.filePath} @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</code>
          <span role="status">{localizedValue(status, t)}</span>
          <button type="button" className="btn" disabled={!!busy || status === 'accepted'} onClick={() => decide(hunk, 'accept')}>{status === 'rejected' ? t('reapplyHunk') : t('acceptHunk')}</button>
          <button type="button" className="btn" disabled={!!busy || status === 'rejected'} onClick={() => decide(hunk, 'reject')}>{status === 'accepted' ? t('revertHunk') : t('discardHunk')}</button></header>
        <div className="widget-diff"><table aria-label={sideBySide ? t('uiSideBySidePatch') : t('uiUnifiedPatch')}><tbody>{hunk.lines.map((line, index) => {
          const kind = line[0] === '+' ? 'add' : line[0] === '-' ? 'remove' : line[0] === ' ' ? 'context' : 'header';
          const old = kind === 'context' || kind === 'remove' ? oldLine++ : '';
          const next = kind === 'context' || kind === 'add' ? newLine++ : '';
          return <tr key={index} className={`diff-${kind}`}><td className="diff-number">{old}</td>
            {sideBySide ? <><td><code>{kind === 'add' ? '' : line.slice(1)}</code></td><td className="diff-number">{next}</td><td><code>{kind === 'remove' ? '' : line.slice(1)}</code></td></>
              : <><td className="diff-number">{next}</td><td><code>{line}</code></td></>}</tr>;
        })}</tbody></table></div>
      </article>;
    })}
  </section>;
}
