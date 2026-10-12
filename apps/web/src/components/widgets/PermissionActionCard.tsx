import { localizedValue } from '../../i18n';
import { useI18n } from '../LanguageProvider';
import { useEffect, useRef, useState } from 'react';
import type { PermissionActionWidget } from '@vessel/shared';

export default function PermissionActionCard({ widget, onRespond }: { widget: PermissionActionWidget; onRespond?: (widgetId: string, optionId: string) => Promise<void> }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [error, setError] = useState<string>();
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const resolved = widget.resolution?.selectedOptionId ?? selected;
  const disabled = pending || widget.status !== 'pending' || Boolean(resolved) || !onRespond;
  async function respond(optionId: string) {
    if (disabled || inFlight.current || !onRespond) return;
    inFlight.current = true; setPending(true); setError(undefined);
    try { await onRespond(widget.id, optionId); if (alive.current) setSelected(optionId); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  }
  return <section className="inline-widget" data-permission-action aria-label={t('uiPermissionAction')} aria-busy={pending}><header className="widget-head"><strong>{t('uiPermission')} {localizedValue(widget.payload.actionType, t)}</strong></header><p>{widget.payload.description}</p>
    <div className="widget-actions">{widget.payload.options.map(option => <button key={option.id} type="button" className={`btn ${option.tone === 'primary' ? 'btn-primary' : option.tone === 'danger' ? 'widget-danger' : ''}`} disabled={disabled} onClick={() => void respond(option.id)}>{option.label}</button>)}</div>
    <p role="status">{pending ? t('uiSendingResponse') : resolved ? t('resolvedChoice', { choice: widget.payload.options.find(option => option.id === resolved)?.label ?? resolved }) : widget.status === 'expired' ? t('uiExpired') : !onRespond ? t('uiResponseUnavailable') : t('uiAwaitingYourDecision')}</p>
    {error && !resolved && widget.status === 'pending' && <p role="alert" className="error-text">{error}  {t('uiChooseAnOptionToRetry')}</p>}
  </section>;
}
