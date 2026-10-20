import { useState } from 'react';
import { useI18n } from '../LanguageProvider';

export interface ModelChipsProps {
  models: string[];
  selected: string[];
  defaultModel?: string | null;
  onToggle: (model: string) => void;
  onSetDefault?: (model: string) => void;
  onRemove?: (model: string) => void;
  onAdd?: (model: string) => void;
  disabled?: boolean;
  onSelectionChange?: (models: string[]) => void;
}

export function ModelChips({ models, selected, defaultModel, onToggle, onSetDefault, onRemove, onAdd, disabled, onSelectionChange }: ModelChipsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'selected' | 'unselected'>('all');
  const all = [...new Set([...models, ...selected])];
  const selection = new Set(selected);
  const visible = all.filter(model => model.toLowerCase().includes(query.trim().toLowerCase())
    && (filter === 'all' || (filter === 'selected' ? selection.has(model) : !selection.has(model))));
  function bulk(action: 'select' | 'deselect' | 'invert') {
    if (!onSelectionChange) return;
    const next = new Set(selected);
    for (const model of visible) {
      if (action === 'deselect' || (action === 'invert' && selection.has(model))) next.delete(model);
      else next.add(model);
    }
    onSelectionChange([...next]);
  }
  return <div className="model-chips" role="group" aria-label={t('providerModels')}>
    <div className="model-chips-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
      <input type="search" className="input" aria-label={t('modelSearchPlaceholder')} placeholder={t('modelSearchPlaceholder')} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
      }} />
      {query && <button type="button" className="btn" aria-label={t('modelSearchClear')} disabled={disabled} onClick={() => setQuery('')}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
    </div>
    <div className="model-chips-toolbar">
      <div role="group" aria-label={t('providerModels')} className="model-chips-filters">
        {(['all', 'selected', 'unselected'] as const).map(value => <button type="button" className="preset-gallery-tab" key={value} disabled={disabled} aria-pressed={filter === value} onClick={() => setFilter(value)}>{t(value === 'all' ? 'modelFilterAll' : value === 'selected' ? 'modelFilterSelected' : 'modelFilterUnselected')} ({value === 'all' ? all.length : value === 'selected' ? selection.size : all.length - selection.size})</button>)}
      </div>
      {onSelectionChange && <div className="model-chips-actions">
        <button type="button" className="btn" disabled={disabled || !visible.length} onClick={() => bulk('select')}>{t('selectAll')}</button>
        <button type="button" className="btn" disabled={disabled || !visible.length} onClick={() => bulk('deselect')}>{t('deselectAll')}</button>
        <button type="button" className="btn" disabled={disabled || !visible.length} onClick={() => bulk('invert')}>{t('invertSelection')}</button>
      </div>}
      <span className="model-chips-count" role="status">{t('modelSearchCount', { selected: String(selection.size), total: String(all.length) })}</span>
    </div>
    <div className="model-chips-scroll" tabIndex={0} role="group" aria-label={t('providerModels')}>
    {visible.map(model => {
      const active = selected.includes(model);
      return <span key={model} className={`model-chip${active ? ' is-selected' : ''}${model === defaultModel ? ' is-default' : ''}`}>
        <button type="button" className="model-chip-toggle" aria-pressed={active} disabled={disabled} onClick={() => onToggle(model)}>
          {active && <span aria-hidden="true">✓ </span>}{model}
        </button>
        {active && onSetDefault && <button type="button" aria-label={`${t('modelSetAsDefault')}: ${model}`} aria-pressed={model === defaultModel} disabled={disabled} onClick={() => onSetDefault(model)}>{model === defaultModel ? '★' : '☆'}</button>}
        {onRemove && (!active || !models.includes(model)) && <button type="button" aria-label={`${t('modelRemove')}: ${model}`} disabled={disabled} onClick={() => onRemove(model)}>×</button>}
      </span>;
    })}
    {!visible.length && <p className="dim">{t('presetNoResults')}</p>}
    </div>
    {onAdd && <input className="input model-chip-input" aria-label={t('modelAddPlaceholder')} placeholder={t('modelAddPlaceholder')} value={draft} maxLength={256} disabled={disabled} onChange={event => setDraft(event.target.value)} onKeyDown={event => {
      if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      const model = draft.trim();
      if (model && !/[\x00-\x1f\x7f,，]/.test(model)) { onAdd(model); setDraft(''); }
    }} />}
  </div>;
}
