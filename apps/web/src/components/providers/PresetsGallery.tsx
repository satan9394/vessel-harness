import { useState } from 'react';
import { useI18n } from '../LanguageProvider';
import { localizePreset, PRESET_CATEGORIES, PROVIDER_PRESETS_CATALOG, type PresetInfo, type ProviderCategory } from './presetsData';

export function PresetsGallery({ onSelect, selectedId, disabled }: { onSelect: (preset: PresetInfo) => void; selectedId?: string; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProviderCategory | 'all'>('all');
  const presets = PROVIDER_PRESETS_CATALOG.map(preset => localizePreset(preset, lang)).filter(preset => (category === 'all' || preset.category === category)
    && `${preset.id} ${preset.name} ${preset.defaultModel} ${preset.hint ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="preset-gallery" aria-label={t('providerPreset')}>
    <input className="input" type="search" aria-label={t('presetSearchPlaceholder')} placeholder={t('presetSearchPlaceholder')} value={query} onChange={event => setQuery(event.target.value)} disabled={disabled} />
    <div className="preset-gallery-tabs" role="group" aria-label={t('providerPreset')}>
      {PRESET_CATEGORIES.map(item => <button key={item.id} type="button" className="preset-gallery-tab" aria-pressed={category === item.id} onClick={() => setCategory(item.id)} disabled={disabled}>{t(item.labelKey)}</button>)}
    </div>
    <div className="preset-gallery-grid">{presets.map(preset => <button key={preset.id} type="button" className="preset-card" aria-pressed={selectedId === preset.id} onClick={() => onSelect(preset)} disabled={disabled}>
      <span className="preset-avatar" aria-hidden="true">{preset.id[0]!.toUpperCase()}</span>
      <strong>{preset.name}</strong>
      {preset.hint && <small>{preset.hint}</small>}
      {preset.defaultModel && <code>{preset.defaultModel}</code>}
      <span className="provider-badge">{t(PRESET_CATEGORIES.find(item => item.id === preset.category)!.labelKey)}</span>
      {preset.auth && <small>{preset.auth}</small>}
    </button>)}</div>
    {!presets.length && <p role="status" className="dim">{t('presetNoResults')}</p>}
  </section>;
}
