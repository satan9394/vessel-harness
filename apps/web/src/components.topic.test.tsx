import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import type { SessionMeta } from './api';
import { LanguageProvider } from './components/LanguageProvider';
import { getInitialLang, translate } from './i18n';
import Sidebar, { filterSessionsByTopic, groupSessionsByDateAndTopic } from './components/Sidebar';
import TalkingMetricsBar from './components/TalkingMetricsBar';
import ThinkingBlock from './components/ThinkingBlock';
import MessageList from './components/MessageList';

function render(node: ReactElement): string {
  return renderToStaticMarkup(<LanguageProvider>{node}</LanguageProvider>);
}

function session(id: string, updatedAt: string, title: string, topicId = `topic_${id}`, isArchived = false): SessionMeta {
  return {
    id,
    workspaceRoot: `/workspace/${id}`,
    provider: 'mock',
    model: 'mock-model',
    permission: 'read-only',
    createdAt: updatedAt,
    updatedAt,
    topic: {
      topicId,
      title,
      createdAt: Date.parse(updatedAt),
      updatedAt: Date.parse(updatedAt),
      isArchived,
    },
  };
}

describe('Topic sidebar', () => {
  it('keeps sessions for one Topic together across date ranges and places it by latest activity', () => {
    const now = new Date('2026-09-24T12:00:00.000Z').getTime();
    const sessions = [
      session('newer', new Date(now).toISOString(), 'Quarterly analysis', 'topic-shared'),
      session('older', new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(), 'Quarterly analysis', 'topic-shared'),
    ];

    const groups = groupSessionsByDateAndTopic(sessions, now);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('topicToday');
    expect(groups[0]!.topics).toMatchObject([
      { topicId: 'topic-shared', title: 'Quarterly analysis', sessions: [{ id: 'newer' }, { id: 'older' }] },
    ]);
  });

  it('filters by Topic, path, and session id and hides archived Topics by default', () => {
    const active = session('active-42', '2026-09-24T10:00:00.000Z', 'Quarterly analysis');
    const archived = session('archived-9', '2026-09-24T09:00:00.000Z', 'Old plan', 'topic-old', true);

    expect(filterSessionsByTopic([active, archived], 'QUARTERLY', false)).toEqual([active]);
    expect(filterSessionsByTopic([active, archived], 'workspace/active-42', false)).toEqual([active]);
    expect(filterSessionsByTopic([active, archived], 'active-42', false)).toEqual([active]);
    expect(filterSessionsByTopic([active, archived], '', false)).toEqual([active]);
    expect(filterSessionsByTopic([active, archived], '', true)).toEqual([active, archived]);
  });

  it('renders Topic search, grouped titles, session rows, rename, and archive controls', () => {
    const html = render(
      <Sidebar
        projects={[]}
        sessions={[session('s-1', '2026-09-24T10:00:00.000Z', 'Quarterly analysis')]}
        onNewSession={() => {}}
        onSelectSession={() => {}}
        onRenameTopic={() => {}}
        onArchiveTopic={() => {}}
      />,
    );

    expect(html).toContain('topic-search');
    expect(html).toContain('Quarterly analysis');
    expect(html).toContain('topic-session');
    const t = translate(getInitialLang());
    expect(html).toContain(t('topicRename'));
    expect(html).toContain(t('topicArchive'));
  });
});

describe('thinking and per-turn metrics components', () => {
  it('renders a collapsed, keyboard-native Thinking disclosure with duration and text', () => {
    const html = render(<ThinkingBlock text="Check constraints before answering." durationMs={1250} />);
    expect(html).toContain('<details class="thinking-block">');
    expect(html).not.toContain('<details class="thinking-block" open');
    const t = translate(getInitialLang());
    expect(html).toContain(`<summary aria-label="${t('thinkingFor', { duration: '1.3s' })}">`);
    expect(html).toContain('<pre class="thinking-content">Check constraints before answering.</pre>');
    expect(render(<ThinkingBlock text="" />)).toBe('');
  });

  it('integrates the thinking disclosure as a separate assistant conversation item', () => {
    const html = render(
      <MessageList
        thinking={false}
        items={[{ id: 'thinking-1', kind: 'thinking', thinking: { text: 'reasoning', durationMs: 50, streaming: false } }]}
      />,
    );
    expect(html).toContain('thinking-block');
    expect(html).toContain('reasoning');
    expect(html).not.toContain('msg-body">reasoning');
  });

  it('shows all four token dimensions plus latency and estimated cost, including zero values', () => {
    const html = render(
      <TalkingMetricsBar metrics={{
        inputTokens: 12,
        outputTokens: 0,
        reasoningTokens: 4,
        cacheReadTokens: 0,
        latencyMs: 150,
        costUsd: 0,
        estimated: true,
      }} />,
    );
    const t = translate(getInitialLang());
    for (const label of ['metricPrompt', 'metricCompletion', 'metricThinking', 'metricCacheRead', 'metricLatency', 'metricCost'] as const) {
      expect(html).toContain(t(label));
    }
    expect(html).toContain('12 tok');
    expect(html).toContain('0 tok');
    expect(html).toContain('150ms');
    expect(html).toContain('~$0.0000');
    expect(render(<TalkingMetricsBar metrics={{}} />)).toBe('');
  });
});
