import { localizedValue } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import type { TeamDagTask } from '../../teamStages';
import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../api';

export function TeamNodeDetails({ task, onClose, artifact, onArtifact, artifactUrl, onDownload }: {
  task: TeamDagTask; onClose: () => void;
  artifact?: { path?: string; diff: string; comparison: string; error?: string };
  onArtifact?: (index: number) => void; artifactUrl?: (index: number) => string;
  onDownload?: (index: number) => void;
}) {
  const { t } = useI18n();
  return <aside className="team-node-drawer" aria-label={t('taskDetails', { title: task.title })}>
    <button className="btn" onClick={onClose} aria-label={t('uiCloseTaskDetails')}>{t('close')}</button>
    <h3>{task.title}</h3><p>{task.description}</p>
    <p>{t('uiStatusLabel')} {localizedValue(task.status, t)}  {t('uiExecutor')} {task.claimedBy ?? t('uiUnclaimed')}</p>
    <p>{t('uiDependencies')} {task.dependencies.join(', ') || t('uiNone')}</p>
    {task.result && <pre>{task.result.output.slice(0, 300)}</pre>}
    {task.error && <p role="alert">{task.error}</p>}
    {task.result?.artifacts.map((file, index) => <p key={file}>
      {onDownload ? <button className="btn" onClick={() => onDownload(index)}>{file}</button> : artifactUrl ? <a href={artifactUrl(index)} target="_blank" rel="noreferrer">{file}</a> : <code>{file}</code>}{' '}
      {onArtifact && <button className="btn" onClick={() => onArtifact(index)}>{t('uiViewDiff')}</button>}
    </p>)}
    {artifact && <section aria-label={t('uiArtifactDiff')}><p>{artifact.path} · {artifact.comparison}</p><pre>{artifact.diff || t('uiNoWorkspaceChangesAgainstHEAD')}</pre>{artifact.error && <p role="alert">{artifact.error}</p>}</section>}
  </aside>;
}

export async function loadArtifactDiff(api: ApiClient, stageId: string, taskId: string, index: number, revision: { current: number }, onResult: (result: { path?: string; diff: string; comparison: string; error?: string }) => void) {
  const selected = ++revision.current;
  try { const result = await api.getTeamArtifact(stageId, taskId, index); if (selected === revision.current) onResult(result); }
  catch (err) { if (selected === revision.current) onResult({ diff: '', comparison: '', error: String(err) }); }
}

export default function TeamNodeDrawer({ task, onClose, api, stageId }: {
  task: TeamDagTask; onClose: () => void; api: ApiClient; stageId: string;
}) {
  const [artifact, setArtifact] = useState<{ path?: string; diff: string; comparison: string; error?: string }>();
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, [api, stageId, task.id]);
  return <TeamNodeDetails task={task} onClose={onClose} artifact={artifact}
    onDownload={index => {
      void api.downloadTeamArtifact(stageId, task.id, index).then(blob => {
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = task.result!.artifacts[index].split(/[\\/]/).pop()!; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }).catch(error => setArtifact({ diff: '', comparison: '', error: String(error) }));
    }}
    onArtifact={index => { setArtifact(undefined); void loadArtifactDiff(api, stageId, task.id, index, revision, setArtifact); }} />;
}
