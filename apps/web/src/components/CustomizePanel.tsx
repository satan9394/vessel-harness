import { useEffect, useRef, useState } from 'react';
import {
  UI_MODULES,
  toggleModule,
  type UiModuleId,
  type UiModuleState,
} from '../uiModules';
import { useI18n } from './LanguageProvider';

interface Props {
  modules: UiModuleState;
  onChange: (next: UiModuleState) => void;
}

/**
 * Top-right "Customize" button + popover panel (task 043). Renders a checkbox
 * list of the nine UI modules; a change is lifted up via `onChange`, which the
 * caller persists to localStorage. The panel closes on outside click or Escape.
 */
export default function CustomizePanel({ modules, onChange }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function setModule(key: UiModuleId) {
    onChange(toggleModule(modules, key));
  }

  return (
    <div className="customize" ref={rootRef}>
      <button
        type="button"
        className="btn customize-toggle"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {t('customize')}
      </button>
      {open && (
        <div className="customize-popover" role="dialog" aria-label={t('customizeHead')}>
          <div className="customize-head">{t('customizeHead')}</div>
          <div className="customize-list">
            {UI_MODULES.map((key) => (
              <label key={key} className="customize-item">
                <input
                  type="checkbox"
                  checked={modules[key]}
                  onChange={() => setModule(key)}
                />
                <span>{key}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}