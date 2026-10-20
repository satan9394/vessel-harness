import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { localizedValue, translate, type Lang } from '../i18n';
import type { ToolDelta } from '../sse';
import ToolActivityRow from './ToolActivityRow';

const language = vi.hoisted(() => ({ current: 'en' as Lang }));
vi.mock('./LanguageProvider', () => ({
  useI18n: () => ({ lang: language.current, t: translate(language.current) }),
}));

function render(delta: Partial<ToolDelta> = {}): string {
  return renderToStaticMarkup(<ToolActivityRow delta={{ toolName: 'read_file', status: 'done', ts: 1, ...delta }} />);
}

beforeEach(() => { language.current = 'en'; });

describe('ToolActivityRow', () => {
  it('renders the name, localized status, duration and full argument title', () => {
    const html = render({ durationMs: 42, argsSummary: 'apps/web/src/styles.css' });
    expect(html).toContain('<span class="tool-name">read_file</span>');
    expect(html).toContain('<span class="tool-status">done</span>');
    expect(html).toContain('<span class="tool-dur">42ms</span>');
    expect(html).toContain('<div class="tool-args" title="apps/web/src/styles.css">apps/web/src/styles.css</div>');
  });

  it.each([
    ['started', 'running'], ['done', 'ok'], ['denied', 'danger'], ['error', 'danger'],
  ] as const)('maps %s to %s with an accessible group name', (status, tone) => {
    const html = render({ status });
    expect(html).toContain(`class="tool-row tool-row--${tone}"`);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain(`role="group" aria-label="read_file · ${localizedValue(status, translate('en'))}"`);
    expect(html).toContain('class="tool-rail" aria-hidden="true"');
  });

  it.each([[0, '0ms'], [999, '999ms'], [1000, '1.0s'], [1250, '1.3s'], [12000, '12.0s']])(
    'formats %s milliseconds as %s', (durationMs, expected) => {
      expect(render({ durationMs })).toContain(`<span class="tool-dur">${expected}</span>`);
    },
  );

  it('omits absent optional metadata', () => {
    const html = render();
    expect(html).not.toContain('class="tool-dur"');
    expect(html).not.toContain('class="tool-args"');
    expect(html).not.toContain('class="tool-badge"');
  });

  it('uses the localized fallback name and duration', () => {
    language.current = 'zh';
    const t = translate('zh');
    const html = render({ toolName: undefined, status: 'started', durationMs: 1500 });
    expect(html).toContain(`aria-label="${t('noTool')} · ${localizedValue('started', t)}"`);
    expect(html).toContain(t('timeSeconds', { value: '1.5' }));
  });

  it('renders the real sandbox audit disclosure and security details', () => {
    const html = render({ sandbox: {
      isolationTier: 'bwrap-ns', sandboxed: true, outcome: 'enforced', allowedWritePaths: ['/workspace'],
    } });
    expect(html).toContain('class="tool-badge"');
    expect(html).toContain('class="sandbox-audit sandbox-green"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('/workspace');
  });

  it('escapes tool arguments instead of treating them as markup', () => {
    const html = render({ argsSummary: '<script>alert("test")</script>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
