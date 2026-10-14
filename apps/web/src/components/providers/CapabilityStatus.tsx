import type { ProviderCapabilities } from '@vessel/shared';
import type { MessageKey } from '../../i18n';
import { useI18n } from '../LanguageProvider';

const FIELDS = {
  tools: 'capabilityTools', streaming: 'capabilityStreaming', contextWindow: 'capabilityContextWindow',
  structuredOutput: 'capabilityStructuredOutput', reasoning: 'capabilityReasoning',
  multimodalInput: 'capabilityMultimodalInput', multimodalOutput: 'capabilityMultimodalOutput', tokenUsage: 'capabilityTokenUsage',
} as const satisfies Partial<Record<keyof ProviderCapabilities, MessageKey>>;

/** Render backend evidence without inferring support from a model name or protocol. */
export default function CapabilityStatus({ capabilities }: { capabilities?: ProviderCapabilities }) {
  const { t } = useI18n();
  return <dl className="capability-status">{(Object.keys(FIELDS) as (keyof typeof FIELDS)[]).map(field => {
    const capability = capabilities?.[field];
    const known = capability && capability.status !== 'unknown';
    return <div key={field}><dt>{t(FIELDS[field])}</dt><dd>
      <span>{t(known ? capability.status === 'detected' ? 'capabilityDetected' : 'capabilityDeclared' : 'capabilityUnknown')}</span>
      {known && <> · {typeof capability.value === 'number' ? capability.value.toLocaleString() : t(capability.value ? 'capabilitySupported' : 'capabilityUnsupported')}{capability.source && <small className="dim"> · {capability.source}</small>}</>}
    </dd></div>;
  })}</dl>;
}
