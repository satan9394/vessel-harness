import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useI18n } from './components/LanguageProvider';
import NewSessionForm from './components/NewSessionForm';
import AstImpactRadar from './components/widgets/AstImpactRadar';
import type { ApiClient } from './api';
import { LANG_STORAGE_KEY, type I18nApi } from './i18n';

// Deterministic rerender driver, matching the existing Web interaction tests.
// Context and rendering remain real; only state scheduling is controlled.
const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.values[index], (value: unknown) => {
      hooks.values[index] = typeof value === 'function' ? value(hooks.values[index]) : value;
    }];
  },
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (callback: unknown) => callback,
}));
afterEach(() => { hooks.values = []; hooks.cursor = 0; vi.unstubAllGlobals(); });

describe('live language context', () => {
  it('switches existing consumers immediately and persists the explicit choice', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('navigator', { language: 'en-US' });
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const read = () => {
      hooks.cursor = 0;
      return LanguageProvider({ children: createElement(Consumer) }) as ReactElement<{ value: I18nApi }>;
    };
    function Consumer() {
      const { t } = useI18n();
      return <p>{t('newSessionTitle')} · {t('acceptHunk')} · {t('palettePlaceholder')}</p>;
    }
    const initial = read();
    expect(renderToStaticMarkup(initial)).toContain('New Session');
    initial.props.value.setLang('zh');
    const chinese = read();
    expect(renderToStaticMarkup(chinese)).toContain('新建会话 · 采纳此块 · 输入命令或搜索历史会话…');
    expect(values.get(LANG_STORAGE_KEY)).toBe('zh');
    chinese.props.value.setLang('en');
    expect(renderToStaticMarkup(read())).toContain('Accept hunk');
    expect(values.get(LANG_STORAGE_KEY)).toBe('en');
  });

  it('renders form copy and widget accessibility labels from the current dictionary', () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    vi.stubGlobal('localStorage', { getItem: () => null });
    const html = renderToStaticMarkup(<LanguageProvider>
      <NewSessionForm api={{} as ApiClient} onCreated={() => {}} onClose={() => {}} />
      <AstImpactRadar widget={{ id: 'impact', kind: 'impact_radar', status: 'pending', timestamp: 'now', turnIndex: 0,
        payload: { targetSymbol: 'run', blastRadius: { modifiedFiles: ['a.ts'], affectedCallers: [] } } }} />
    </LanguageProvider>);
    expect(html).toContain('只读探索权限');
    expect(html).toContain('工作区读写权限');
    expect(html).toContain('aria-label="代码影响范围"');
    expect(html).toContain('未报告受影响的调用者。');
    expect(html).not.toMatch(/Workspace write|Read-only|No affected callers/);
  });
});
