import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  getInitialLang,
  saveLang,
  translate,
  type I18nApi,
  type Lang,
} from '../i18n';

/**
 * Lightweight language context (task 045). Zero deps — no i18next. Holds the
 * current lang (seeded from navigator.language with a localStorage override),
 * a live `t(key)` translator, and a `setLang` that re-renders consumers and
 * persists the choice. Wrap the app in <LanguageProvider> to use `useI18n()`.
 */

const I18nContext = createContext<I18nApi | null>(null);

export interface LanguageProviderProps {
  children: React.ReactNode;
}

export function LanguageProvider({ children }: LanguageProviderProps) {
  const [lang, setLangState] = useState<Lang>(() => getInitialLang());

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
  }, []);

  const api = useMemo<I18nApi>(() => {
    const t = translate(lang);
    return { lang, t, setLang };
  }, [lang, setLang]);

  return <I18nContext.Provider value={api}>{children}</I18nContext.Provider>;
}

/** Read language + translator from context; throws when used outside provider. */
export function useI18n(): I18nApi {
  const api = useContext(I18nContext);
  if (!api) throw new Error('useI18n must be used within <LanguageProvider>');
  return api;
}