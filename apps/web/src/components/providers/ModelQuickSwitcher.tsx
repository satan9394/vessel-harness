import { useEffect, useId, useRef, useState } from 'react';
import type { ModelOption } from '../../api';
import { useI18n } from '../LanguageProvider';

export interface ActiveModel { provider: string; model: string }
export interface ModelQuickSwitcherProps {
  models: ModelOption[];
  current: ActiveModel | null;
  onSelect: (model: ActiveModel) => void;
  onOpenSettings?: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export function ModelQuickSwitcher({ models, current, onSelect, onOpenSettings, disabled, compact }: ModelQuickSwitcherProps) {
  const { t } = useI18n();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const filtered = models.filter(model => model.providerName !== 'mock' && `${model.providerName} ${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase()));
  const groups = [...new Set(filtered.map(model => model.providerName))];
  const ordered = groups.flatMap(provider => filtered.filter(model => model.providerName === provider));
  const online = !!current && models.some(model => model.providerName !== 'mock' && model.providerName === current.provider && model.id === current.model);
  function close() { setOpen(false); trigger.current?.focus(); }
  function choose(model: ModelOption) { if (disabled) return; onSelect({ provider: model.providerName, model: model.id }); close(); }
  useEffect(() => {
    if (!open || disabled) return;
    search.current?.focus();
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, disabled]);
  useEffect(() => {
    root.current?.querySelectorAll<HTMLElement>('.model-switcher-item')[active]?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return <div className={`model-switcher${compact ? ' is-compact' : ' model-pill'}`} ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }} onKeyDown={event => {
    if (!open || disabled || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(value => ordered.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + ordered.length) % ordered.length : 0);
      search.current?.focus();
    }
    if (event.key === 'Enter' && event.target === search.current) { event.preventDefault(); if (ordered[active]) choose(ordered[active]); }
  }}>
    <button type="button" ref={trigger} className="model-switcher-trigger" disabled={disabled} aria-expanded={open && !disabled} aria-controls={`${id}-panel`} aria-haspopup="dialog" onClick={() => { setOpen(value => !value); setQuery(''); setActive(0); }}>
      <span className="model-switcher-dot" data-state={online ? 'online' : 'offline'} aria-hidden="true" />
      <span>{current && current.provider !== 'mock' ? `${current.provider} / ${current.model}` : `${t('modelOffline')} / ${t('selectModel')}`}</span>
      <span aria-hidden="true">⌄</span>
    </button>
    {open && !disabled && <div id={`${id}-panel`} className="model-switcher-panel" role="dialog" aria-label={t('selectModel')}>
      <input ref={search} className="input model-switcher-search" role="combobox" aria-label={t('modelSearchPlaceholder')} aria-expanded="true" aria-controls={`${id}-list`} aria-activedescendant={ordered[active] ? `${id}-item-${active}` : undefined} value={query} placeholder={t('modelSearchPlaceholder')} onChange={event => { setQuery(event.target.value); setActive(0); }} />
      <div id={`${id}-list`} role="listbox" aria-label={t('selectModel')} className="model-switcher-list">
        {groups.map(provider => <div className="model-switcher-group" key={provider} role="group" aria-label={provider}>
          <h4>{provider}</h4>
          {ordered.filter(model => model.providerName === provider).map(model => {
            const index = ordered.indexOf(model);
            const selected = current?.provider === provider && current.model === model.id;
            return <button key={model.id} id={`${id}-item-${index}`} type="button" role="option" aria-selected={selected} className={`model-switcher-item${index === active ? ' is-active' : ''}`} onClick={() => choose(model)} onPointerMove={() => setActive(index)}>
              <span>{model.id}</span>{selected && <span className="provider-badge">✓ {t('currentLabel')}</span>}
            </button>;
          })}
        </div>)}
        {!ordered.length && <p role="status" className="dim">{t('presetNoResults')}</p>}
      </div>
      {onOpenSettings && <button type="button" className="btn model-switcher-footer" onClick={() => { close(); onOpenSettings(); }}>{t('configureModels')}</button>}
    </div>}
  </div>;
}
