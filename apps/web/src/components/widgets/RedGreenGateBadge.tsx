import { useI18n } from '../LanguageProvider';
import type { RedGreenGateWidget } from '@vessel/shared';

export default function RedGreenGateBadge({ widget }: { widget: RedGreenGateWidget }) {
  const { t } = useI18n();
  const { phase, command, exitCode, proofSha256, failureSummary } = widget.payload;
  return <section className={`inline-widget gate-${phase}`} aria-label={t('uiVerificationGate')}>
    <header className="widget-head"><span className="gate-light" aria-hidden="true" /><strong>{phase === 'green_verified' ? t('uiGreenVerified') : phase === 'red_verified' ? t('uiRedVerified') : t('uiRejected')}</strong><code>SHA-256 {proofSha256.slice(0, 12)}</code></header>
    <details><summary>{t('uiVerificationDetails')}</summary><p><code>{command}</code>  {t('uiExit')} {exitCode}</p>{failureSummary && <pre>{failureSummary}</pre>}<p className="widget-hash">{t('uiSHA256')} {proofSha256}</p></details>
  </section>;
}
