import { useI18n } from '../LanguageProvider';
import type { ImpactRadarWidget } from '@vessel/shared';

export default function AstImpactRadar({ widget }: { widget: ImpactRadarWidget }) {
  const { t } = useI18n();
  const { targetSymbol, blastRadius } = widget.payload;
  return <section className="inline-widget" aria-label={t('uiASTImpactRadar')}><header className="widget-head"><strong>{t('uiImpact')} {targetSymbol}</strong><span>{blastRadius.modifiedFiles.length}  {t('uiFiles')} {blastRadius.affectedCallers.length}  {t('uiCallers')}</span></header>
    <h4>{t('uiModifiedFiles')}</h4><ul>{blastRadius.modifiedFiles.map(file => <li key={file}><code>{file}</code></li>)}</ul>
    <h4>{t('uiAffectedCallers')}</h4>{blastRadius.affectedCallers.length ? <ul>{blastRadius.affectedCallers.map((caller, index) => <li key={`${caller.filePath}:${caller.symbolName}:${index}`}><code>{caller.symbolName}</code> → <code>{caller.filePath}</code></li>)}</ul> : <p className="dim">{t('uiNoAffectedCallersReported')}</p>}
  </section>;
}
