import type { ReactNode as I18nTestNode } from 'react';
import { LanguageProvider } from '../LanguageProvider';
import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup as renderMarkup } from 'react-dom/server';
import { createApiClient } from '../../api';
import { pollDashboard, type ReflectiveRuleView } from '../../dashboard';
import { CognitiveRulesDashboard, CognitiveRulesFilters, CognitiveRulesList, filterCognitiveRules } from '../CognitiveRulesDashboard';

const rules: ReflectiveRuleView[] = [
  { id: 'policy-1', category: 'policy_denial', triggerCondition: 'Write outside workspace', lesson: 'Whitelist required', recommendedAction: 'Request scope approval', frequency: 4, updatedAt: 1000, confidence: .9 },
  { id: 'tool-1', category: 'tool_failure', triggerCondition: 'Failed shell', lesson: 'Use absolute paths', recommendedAction: 'Check working directory', frequency: 2, updatedAt: 2000 },
  { id: 'arch-1', category: 'architecture_constraint', triggerCondition: 'Import core mechanism', lesson: 'Keep Thin Core', recommendedAction: 'Use application composition', frequency: 7, updatedAt: 3000 },
];
function nodes(root: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as ReactNode)];
}

describe('CognitiveRulesDashboard', () => {
  it('renders category, trigger, lesson, action, hits and timestamp without interpreting lesson markup', () => {
    const html = renderToStaticMarkup(<CognitiveRulesList rules={[...rules, { ...rules[0]!, id: 'untrusted', lesson: '<script>external()</script>' }]} />);
    for (const rule of rules) for (const field of [rule.id, rule.category, rule.triggerCondition, rule.lesson, rule.recommendedAction]) expect(html).toContain(field);
    expect(html).toContain('<dd>4</dd>');
    expect(html).toContain('1970-01-01T00:00:01.000Z');
    expect(html).toContain('90%');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('combines each category with case-insensitive live search across all meaningful rule fields', () => {
    for (const rule of rules) expect(filterCognitiveRules(rules, rule.category, '')).toEqual([rule]);
    expect(filterCognitiveRules(rules, '', '  WHITELIST  ')).toEqual([rules[0]]);
    expect(filterCognitiveRules(rules, '', 'working directory')).toEqual([rules[1]]);
    expect(filterCognitiveRules(rules, '', 'ARCH-1')).toEqual([rules[2]]);
    expect(filterCognitiveRules(rules, 'policy_denial', 'Thin Core')).toEqual([]);
    expect(filterCognitiveRules(rules, '', '')).toEqual(rules);
    expect(renderToStaticMarkup(<CognitiveRulesList rules={[]} />)).toContain('No matching reflective rules');
  });

  it('category and search controls pass current values through their real handlers', () => {
    const onCategory = vi.fn(); const onQuery = vi.fn();
    const tree = CognitiveRulesFilters({ category: 'tool_failure', query: 'shell', onCategory, onQuery });
    const controls = nodes(tree);
    const select = controls.find((node) => node.type === 'select')!;
    const input = controls.find((node) => node.type === 'input')!;
    (select.props.onChange as (event: unknown) => void)({ target: { value: 'policy_denial' } });
    (input.props.onChange as (event: unknown) => void)({ target: { value: 'Whitelist' } });
    expect(onCategory).toHaveBeenCalledWith('policy_denial');
    expect(onQuery).toHaveBeenCalledWith('Whitelist');
    expect(select.props.value).toBe('tool_failure');
    expect(input.props.value).toBe('shell');
    expect(controls.filter((node) => node.type === 'option')).toHaveLength(4);
    expect(renderToStaticMarkup(tree)).toContain('Search rules');
  });

  it('loads rules through authenticated API and reports availability with read errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ available: true, rules })))
      .mockResolvedValueOnce(new Response('{"error":"memory_unavailable"}', { status: 503 }));
    const api = createApiClient({ fetch: fetcher, token: () => 'fixture-token' });
    const receive = vi.fn(); const fail = vi.fn();
    const poll = pollDashboard(() => api.cognitiveRules(), receive, fail, 10000);
    await poll.ready;
    expect(receive).toHaveBeenCalledWith({ available: true, rules });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/memory/rules');
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' });
    await poll.refresh();
    expect(fail).toHaveBeenCalledWith('memory_unavailable');
    poll.close();
  });

  it('shows accessible loading while initial read is pending', () => {
    const html = renderToStaticMarkup(<CognitiveRulesDashboard api={{ cognitiveRules: async () => ({ available: true, rules }) }} />);
    expect(html).toContain('Loading reflective rules');
    expect(html).toContain('aria-busy="true"');
  });
});

function renderToStaticMarkup(node: I18nTestNode): string {
  return renderMarkup(<LanguageProvider>{node}</LanguageProvider>).replace(/\s+/g, ' ');
}

vi.mock('../../i18n', async original => ({ ...await original<typeof import('../../i18n')>(), getInitialLang: () => 'en' as const }));

vi.mock('../LanguageProvider', async original => {
  const { translate } = await import('../../i18n');
  return { ...await original<typeof import('../LanguageProvider')>(), useI18n: () => ({ lang: 'en', t: translate('en'), setLang: vi.fn() }) };
});
