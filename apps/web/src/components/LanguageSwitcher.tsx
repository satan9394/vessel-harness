import { useEffect, useRef, useState } from 'react';
import { useI18n } from './LanguageProvider';
import type { Lang } from '../i18n';

/**
 * Top-bar language dropdown (zh / en) — task 045. Choices flow through
 * LanguageContext, which persists them to localStorage (`vessel.ui.lang`).
 */
export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
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

  function choose(next: Lang) {
    setLang(next);
    setOpen(false);
  }

  return (
    <div className="lang-switch" ref={rootRef}>
      <button
        type="button"
        className="btn lang-switch-toggle"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t('language')}
        onClick={() => setOpen((o) => !o)}
      >
        {lang === 'zh' ? '中文' : 'EN'}
      </button>
      {open && (
        <div className="lang-switch-popover" role="menu" aria-label={t('language')}>
          <button
            type="button"
            className={`lang-option${lang === 'zh' ? ' lang-option-active' : ''}`}
            role="menuitem"
            onClick={() => choose('zh')}
          >
            中文
          </button>
          <button
            type="button"
            className={`lang-option${lang === 'en' ? ' lang-option-active' : ''}`}
            role="menuitem"
            onClick={() => choose('en')}
          >
            English
          </button>
        </div>
      )}
    </div>
  );
}