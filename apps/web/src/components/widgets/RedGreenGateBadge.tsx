import type { RedGreenGateWidget } from '@vessel/shared';

export default function RedGreenGateBadge({ widget }: { widget: RedGreenGateWidget }) {
  const { phase, command, exitCode, proofSha256, failureSummary } = widget.payload;
  return <section className={`inline-widget gate-${phase}`} aria-label="Verification gate">
    <header className="widget-head"><span className="gate-light" aria-hidden="true" /><strong>{phase === 'green_verified' ? 'Green verified' : phase === 'red_verified' ? 'Red verified' : 'Rejected'}</strong><code>SHA-256 {proofSha256.slice(0, 12)}</code></header>
    <details><summary>Verification details</summary><p><code>{command}</code> · exit {exitCode}</p>{failureSummary && <pre>{failureSummary}</pre>}<p className="widget-hash">SHA-256: {proofSha256}</p></details>
  </section>;
}
