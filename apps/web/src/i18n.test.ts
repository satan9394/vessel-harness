import { describe, it, expect } from 'vitest';
import {
  DICT,
  LANG_STORAGE_KEY,
  getInitialLang,
  inferLang,
  loadStoredLang,
  saveLang,
  translate,
  localizedValue,
  type MessageKey,
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
      expect(DICT.zh[key as keyof typeof DICT.zh]).toBeTruthy();
      expect(DICT.en[key as keyof typeof DICT.en]).toBeTruthy();
    }
  });

  it('interpolates {var} placeholders from params', () => {
    expect(translate('en')('statusOk', { version: '0.4.2' })).toBe('Vessel local server ok (v0.4.2)');
    expect(translate('zh')('statusOk', { version: '0.4.2' })).toContain('版本 0.4.2');
  });

  it('falls back to en / the raw key for an unknown key', () => {
    expect(translate('zh')('settings' as never)).toBe('设置'); // known key, fine
    expect(translate('en')('definitelyMissing' as never)).toBe('definitelyMissing');
  });
});

describe('complete V2.6 dictionaries', () => {
  it('keeps every interpolation contract identical and fills every parameter in both languages', () => {
    for (const key of Object.keys(DICT.en) as MessageKey[]) {
      const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
      const expected = placeholders(DICT.en[key]);
      // English inflects count nouns; Chinese has no plural suffix.
      expect(placeholders(DICT.zh[key]).filter(name => name !== 'plural'), key)
        .toEqual(expected.filter(name => name !== 'plural'));
      const params = Object.fromEntries(expected.map(name => [name, `value-${name}`]));
      for (const lang of ['zh', 'en'] as const) {
        expect(translate(lang)(key, params), `${lang}:${key}`).not.toMatch(/\{\w+\}/);
      }
    }
  });

  it('localizes enum labels while preserving unknown observed values', () => {
    const t = translate('zh');
    expect(localizedValue('pending', t)).toBe('待处理');
    expect(localizedValue('windows-job-restricted', t)).toBe('受限作业隔离');
    expect(localizedValue('policy_denial', t)).toBe('策略拒绝');
    expect(localizedValue('third-party-role', t)).toBe('third-party-role');
  });

  it('uses natural Chinese for the session, canvas, permission, reasoning and command flows', () => {
    const t = translate('zh');
    expect(t('emptyBody')).not.toMatch(/Recent Sessions|New Session/);
    expect(t('permissionReadOnly')).toBe('只读探索权限');
    expect(t('permissionWorkspaceWrite')).toBe('工作区读写权限');
    expect(t('inspectorTitle')).toBe('画布检视器');
    expect(t('acceptHunk')).toBe('采纳此块');
    expect(t('reasoningRate', { rate: '12.5' })).toContain('推理词元／秒');
    expect(t('palettePlaceholder')).toBe('输入命令或搜索历史会话…');
    expect(translate('en')('palettePlaceholder')).toBe('Type a command or search sessions…');
    expect(Object.values(DICT.en).join('\n')).not.toMatch(/[\u4e00-\u9fff]/);
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
