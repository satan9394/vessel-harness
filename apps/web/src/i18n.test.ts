import { describe, it, expect } from 'vitest';
import {
  DICT,
  LANG_STORAGE_KEY,
  getInitialLang,
  inferLang,
  loadStoredLang,
  saveLang,
  translate,
  type Lang,
  type PersistStorage,
} from './i18n';

/** In-memory localStorage stub (node env has no real localStorage). */
function memoryStorage(): PersistStorage & { dump: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => new Map(map),
  };
}

describe('i18n translate(t)', () => {
  it('translates core keys into zh and en', () => {
    const t = (lang: Lang) => translate(lang);
    expect(t('zh')('send')).toBe('发送');
    expect(t('en')('send')).toBe('Send');
    expect(t('zh')('newSession')).toBe('+ 新建会话');
    expect(t('en')('newSession')).toBe('+ New Session');
  });

  it('both dictionaries define the same core key set with non-empty values', () => {
    const zhKeys = Object.keys(DICT.zh).sort();
    const enKeys = Object.keys(DICT.en).sort();
    expect(zhKeys).toEqual(enKeys);
    for (const key of zhKeys) {
      expect((DICT.zh as Record<string, string>)[key]).toBeTruthy();
      expect((DICT.en as Record<string, string>)[key]).toBeTruthy();
    }
  });

  it('interpolates {var} placeholders from params', () => {
    expect(translate('en')('statusOk', { version: '0.4.2' })).toBe('Vessel local server ok (v0.4.2)');
    expect(translate('zh')('statusOk', { version: '0.4.2' })).toContain('v0.4.2');
  });

  it('falls back to en / the raw key for an unknown key', () => {
    expect(translate('zh')('settings' as never)).toBe('设置'); // known key, fine
    expect(translate('en')('definitelyMissing' as never)).toBe('definitelyMissing');
  });
});

describe('default language inference', () => {
  it('zh* locale → zh', () => {
    expect(inferLang({ language: 'zh-CN' })).toBe('zh');
    expect(inferLang({ language: 'zh-tw' })).toBe('zh');
  });

  it('non-zh locale → en', () => {
    expect(inferLang({ language: 'en-US' })).toBe('en');
    expect(inferLang({ language: 'fr-FR' })).toBe('en');
  });

  it('missing locale defaults to en', () => {
    expect(inferLang(null)).toBe('en');
  });
});

describe('localStorage override', () => {
  it('stored choice overrides the detected locale', () => {
    const store = memoryStorage();
    store.setItem(LANG_STORAGE_KEY, 'en');
    expect(getInitialLang({ storage: store, locale: { language: 'zh-CN' } })).toBe('en');
  });

  it('without a stored choice the locale default wins', () => {
    const store = memoryStorage();
    expect(getInitialLang({ storage: store, locale: { language: 'zh-CN' } })).toBe('zh');
    expect(getInitialLang({ storage: store, locale: { language: 'en-US' } })).toBe('en');
  });

  it('saveLang persists under the expected key and reloads', () => {
    const store = memoryStorage();
    saveLang('zh', store);
    expect(store.dump().get(LANG_STORAGE_KEY)).toBe('zh');
    expect(loadStoredLang(store)).toBe('zh');
  });

  it('invalid stored value is ignored', () => {
    const store = memoryStorage();
    store.setItem(LANG_STORAGE_KEY, 'ja-JP');
    expect(loadStoredLang(store)).toBeNull();
    expect(getInitialLang({ storage: store, locale: { language: 'en-US' } })).toBe('en');
  });
});