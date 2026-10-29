import { localizedValue } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import type { TeamDagTask } from '../../teamStages';
import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../api';

const outputCopy = {
  zh: { expand: '展开全文', collapse: '收起', loading: '正在加载…', failed: '全文加载失败，请重试。', capped: '输出超过 64 KiB，仅显示前 64 KiB。' },
  en: { expand: 'Expand full output', collapse: 'Collapse', loading: 'Loading…', failed: 'Could not load full output. Please retry.', capped: 'Output exceeds 64 KiB; showing the first 64 KiB.' },
};

export function TeamNodeDetails({ task, onClose, artifact, onArtifact, artifactUrl, onDownload, expanded = false, fullOutput, outputTruncated, outputLoading, outputError, onToggleOutput }: {
  task: TeamDagTask; onClose: () => void;
  artifact?: { path?: string; diff: string; comparison: string; error?: string };
  onArtifact?: (index: number) => void; artifactUrl?: (index: number) => string;
  onDownload?: (index: number) => void;
  expanded?: boolean; fullOutput?: string; outputTruncated?: boolean;
  outputLoading?: boolean; outputError?: boolean; onToggleOutput?: () => void;
}) {
  const { t, lang } = useI18n();
  const copy = outputCopy[lang === 'zh' ? 'zh' : 'en'];
  const longOutput = (task.result?.output.length ?? 0) > 300;
  return <aside className="team-node-drawer" aria-label={t('taskDetails', { title: task.title })}>
    <button className="btn" onClick={onClose} aria-label={t('uiCloseTaskDetails')}>{t('close')}</button>
    <h3>{task.title}</h3><p>{task.description}</p>
    <p>{t('uiStatusLabel')} {localizedValue(task.status, t)}  {t('uiExecutor')} {task.claimedBy ?? t('uiUnclaimed')}</p>
    <p>{t('uiDependencies')} {task.dependencies.join(', ') || t('uiNone')}</p>
    {task.result && <>
      <pre>{expanded ? fullOutput : task.result.output.slice(0, 300) + (longOutput ? '…' : '')}</pre>
      {longOutput && <button type="button" className="btn" aria-expanded={expanded} disabled={outputLoading} onClick={onToggleOutput}>
        {outputLoading ? copy.loading : expanded ? copy.collapse : copy.expand}
      </button>}
      {outputError && <p role="status">{copy.failed}</p>}
      {expanded && outputTruncated && <p role="status">{copy.capped}</p>}
    </>}
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

export default function TeamNodeDrawer({ task, onClose, api, sessionId, stageId }: {
  task: TeamDagTask; onClose: () => void; api: ApiClient; sessionId: string; stageId: string;
}) {
  const [artifact, setArtifact] = useState<{ path?: string; diff: string; comparison: string; error?: string }>();
  const [output, setOutput] = useState<Awaited<ReturnType<ApiClient['getTeamTaskResult']>>>();
  const [expanded, setExpanded] = useState(false);
  const [outputLoading, setOutputLoading] = useState(false);
  const [outputError, setOutputError] = useState(false);
  const loading = useRef(false);
  const outputRevision = useRef(0);
  const revision = useRef(0);
  useEffect(() => {
    setOutput(undefined); setExpanded(false); setOutputLoading(false); setOutputError(false); loading.current = false;
    return () => { revision.current++; outputRevision.current++; };
  }, [api, sessionId, stageId, task.id]);
  return <TeamNodeDetails task={task} onClose={onClose} artifact={artifact}
    expanded={expanded} fullOutput={output?.output} outputTruncated={output?.truncated} outputLoading={outputLoading} outputError={outputError}
    onToggleOutput={() => {
      if (expanded) { setExpanded(false); return; }
      if (output) { setExpanded(true); return; }
      if (loading.current) return;
      loading.current = true; setOutputLoading(true); setOutputError(false);
      const selected = outputRevision.current;
      void api.getTeamTaskResult(sessionId, stageId, task.id).then(result => {
        if (selected === outputRevision.current) { setOutput(result); setExpanded(true); }
      }).catch(() => { if (selected === outputRevision.current) setOutputError(true); })
        .finally(() => { if (selected === outputRevision.current) { loading.current = false; setOutputLoading(false); } });
    }}
    onDownload={index => {
      void api.downloadTeamArtifact(stageId, task.id, index).then(blob => {
        const url = URL.createObjectURL(blob); const link = document.createElement('a');
        link.href = url; link.download = task.result!.artifacts[index].split(/[\\/]/).pop()!; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }).catch(error => setArtifact({ diff: '', comparison: '', error: String(error) }));
    }}
    onArtifact={index => { setArtifact(undefined); void loadArtifactDiff(api, stageId, task.id, index, revision, setArtifact); }} />;
}
