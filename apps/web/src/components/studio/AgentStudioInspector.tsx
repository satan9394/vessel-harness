import { useEffect, useState } from 'react';
import type { BehaviorCategory, BehaviorCompatibility, BehaviorInspection } from '@vessel/shared';
import { ApiError, type ApiClient } from '../../api';
import { useI18n } from '../LanguageProvider';

const categories = { Instruction: 'behaviorInstruction', Workflow: 'behaviorWorkflow', Constraint: 'behaviorConstraint', ToolStrategy: 'behaviorToolStrategy', Verification: 'behaviorVerification', ResourceBudget: 'behaviorResourceBudget', ContextStrategy: 'behaviorContextStrategy' } as const satisfies Record<BehaviorCategory, string>;
const compatibility = { Importable: 'behaviorImportable', Renderable: 'behaviorRenderable', Mappable: 'behaviorMappable', Enforceable: 'behaviorEnforceable', Verified: 'behaviorVerified' } as const satisfies Record<BehaviorCompatibility, string>;
const ladder = Object.keys(compatibility) as BehaviorCompatibility[];

/** Ignore reads that finish after a session switch or unmount. */
export function readBehaviorInspection(api: Pick<ApiClient, 'inspectBehavior'>, sessionId: string, receive: (inspection: BehaviorInspection) => void, fail: (error: unknown) => void) {
  let active = true;
  const ready = api.inspectBehavior(sessionId).then(result => { if (active) receive(result.inspection); }, error => { if (active) fail(error); });
  return { ready, close: () => { active = false; } };
}

export function BehaviorInspectionView({ inspection }: { inspection: BehaviorInspection }) {
  const { t } = useI18n();
  return <div className="behavior-inspection">
    <p className="behavior-hash"><code>{inspection.snapshotHash}</code></p>
    <h3>{t('behaviorChain')}</h3>
    <ol className="behavior-layers">{inspection.layers.map(layer => <li key={layer.level} data-layer={layer.level}>
      <strong>{layer.level}</strong> <span>{t(layer.status === 'available' ? 'behaviorAvailable' : 'behaviorLayerUnavailable')}</span>
      {layer.sourceRefs.length > 0 && <p>{t('behaviorSource')}: {layer.sourceRefs.join(', ')}</p>}
      {layer.snapshotHash && <code>{layer.snapshotHash}</code>}
      {layer.status === 'available' ? <details><summary>{t('behaviorSnapshot')}</summary><pre>{JSON.stringify(layer.snapshot, null, 2)}</pre></details>
        : <p className="dim">{layer.level === 'L4' ? t('behaviorL4Unavailable') : t('behaviorLayerUnavailable')}{layer.reason && layer.level !== 'L4' && <><br /><code>{layer.reason}</code></>}</p>}
    </li>)}</ol>
    <div className="behavior-entries">{inspection.entries.length === 0 && <p>{t('behaviorNoEntries')}</p>}{inspection.entries.map(entry => <article key={entry.id} className="behavior-entry">
      <h3>{entry.id} <span className="badge">{t(categories[entry.category])}</span></h3>
      <dl><dt>{t('behaviorSource')}</dt><dd>{entry.sourceRef}</dd><dt>{t('behaviorPriority')}</dt><dd>{entry.priority}</dd><dt>{t('behaviorChannel')}</dt><dd>{t(entry.channel === 'runtime_policy' ? 'behaviorPolicyChannel' : 'behaviorPromptChannel')}</dd></dl>
      <ol className="behavior-ladder" aria-label={entry.compatibility}>{ladder.map((level, index) => <li key={level} data-reached={index <= ladder.indexOf(entry.compatibility)} aria-current={level === entry.compatibility ? 'step' : undefined}>{t(compatibility[level])}</li>)}</ol>
      <h4>{t('behaviorMapping')}</h4><p>{entry.policyRef ?? t('behaviorNoMapping')}</p>{entry.policyRuleIds.length > 0 && <ul>{entry.policyRuleIds.map(id => <li key={id}><code>{id}</code></li>)}</ul>}
      <details><summary>{t('behaviorProvenance')}</summary><pre>{JSON.stringify(entry.provenance, null, 2)}</pre></details>
      {entry.assertions.length > 0 && <details><summary>{t('behaviorAssertions')}</summary><ul>{entry.assertions.map(id => <li key={id}><code>{id}</code></li>)}</ul><ul>{entry.assertionResults.map(result => <li key={result.assertionId}>{result.assertionId}: {t(result.passed ? 'behaviorPassed' : 'behaviorFailed')} — {result.evidence}</li>)}</ul></details>}
    </article>)}</div>
    <h3>{t('behaviorDiagnostics')}</h3>{inspection.diagnostics.length === 0 ? <p className="dim">{t('behaviorNoDiagnostics')}</p> : <ul>{inspection.diagnostics.map((diagnostic, index) => <li key={index}><code>{diagnostic.code}</code>: {diagnostic.message} ({diagnostic.entryId}, {diagnostic.sourceRef})</li>)}</ul>}
  </div>;
}

export default function AgentStudioInspector({ api, selectedSessionId }: { api: Pick<ApiClient, 'inspectBehavior'>; selectedSessionId: string | null }) {
  const { t } = useI18n();
  const [result, setResult] = useState<{ sessionId: string; inspection?: BehaviorInspection; error?: unknown } | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    setResult(null);
    if (!selectedSessionId) return;
    const read = readBehaviorInspection(api, selectedSessionId, inspection => setResult({ sessionId: selectedSessionId, inspection }), error => setResult({ sessionId: selectedSessionId, error }));
    return read.close;
  }, [api, selectedSessionId, revision]);
  const current = result?.sessionId === selectedSessionId ? result : null;
  return <section className="agent-studio-inspector" aria-label={t('behaviorInspector')} aria-busy={!!selectedSessionId && !current}>
    <h2>{t('behaviorInspector')}</h2>
    <button className="btn" disabled={!selectedSessionId || !current} onClick={() => { setResult(null); setRevision(value => value + 1); }}>{t('uiRefresh')}</button>
    {!selectedSessionId ? <p>{t('behaviorSelectSession')}</p> : !current ? <p role="status">{t('loading')}</p> : current.inspection ? <BehaviorInspectionView inspection={current.inspection} />
      : <p role="alert">{current.error instanceof ApiError && current.error.status === 404 ? t('behaviorUnavailable') : t('behaviorReadError', { error: current.error instanceof Error ? current.error.message : String(current.error) })}</p>}
  </section>;
}
