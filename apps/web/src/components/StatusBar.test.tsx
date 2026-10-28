import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { translate, type Lang } from '../i18n';
import StatusBar from './StatusBar';

const locale = vi.hoisted(() => ({ lang: 'en' as 'en' | 'zh' }));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: translate(locale.lang) }) }));

describe.each<Lang>(['en', 'zh'])('StatusBar (%s)', lang => {
  it('shows a neutral connecting state before health responds', () => {
    locale.lang = lang;
    const html = renderToStaticMarkup(<StatusBar health={null} error={false} />);
    expect(html).toContain(translate(lang)('statusConnecting'));
    expect(html).not.toContain(translate('en')('statusDown'));
    expect(html).not.toContain(translate('zh')('statusDown'));
    expect(html).toContain('background:var(--dim)');
    expect(html).not.toMatch(/dot-ok|dot-err|status-err/);
    if (lang === 'en') expect(html).not.toMatch(/[\u3400-\u9fff]/);
  });

  it('shows the version and green dot when healthy', () => {
    locale.lang = lang;
    const html = renderToStaticMarkup(<StatusBar health={{ ok: true, version: '1.2.3' }} error={false} />);
    expect(html).toContain('1.2.3');
    expect(html).toContain('dot-ok');
    expect(html).not.toContain(translate(lang)('statusDown'));
  });

  it('shows the disconnected message and red dot on error even with stale health', () => {
    locale.lang = lang;
    const html = renderToStaticMarkup(<StatusBar health={{ ok: true, version: '1.2.3' }} error />);
    expect(html).toContain(translate(lang)('statusDown'));
    expect(html).toContain('dot-err');
    expect(html).toContain('status-err');
    expect(html).not.toContain('dot-ok');
  });
});
