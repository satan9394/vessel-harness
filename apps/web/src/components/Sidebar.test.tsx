import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionMeta } from '../api';
import { translate } from '../i18n';
import Sidebar, { filterSessionsByTopic, groupSessionsByDateAndTopic } from './Sidebar';

const locale = vi.hoisted(() => ({ lang: 'en' as 'en' | 'zh' }));
vi.mock('./LanguageProvider', () => ({ useI18n: () => ({ t: translate(locale.lang), lang: locale.lang }) }));
const now = new Date(2026, 9, 19, 12).getTime();
const midnight = new Date(2026, 9, 19).getTime();
const day = 24 * 60 * 60 * 1000;
function session(id: string, time: number, topicId = id): SessionMeta {
  return { id, workspaceRoot: 'E:/workspace', createdAt: new Date(time).toISOString(),
    topic: { topicId, title: `Task ${id}`, createdAt: time, updatedAt: time } };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); locale.lang = 'en'; });

describe('Sidebar date and topic grouping', () => {
  it.each([
    ['en', 'dark', 'Switch to light theme'], ['en', 'light', 'Switch to dark theme'],
    ['zh', 'dark', '切换为浅色主题'], ['zh', 'light', '切换为深色主题'],
  ] as const)('localizes the accessible theme action (%s/%s)', (lang, theme, label) => {
    locale.lang = lang;
    vi.stubGlobal('localStorage', { getItem: () => theme });
    const html = renderToStaticMarkup(<Sidebar projects={[]} sessions={[]} selectedSessionId={null} onNewSession={() => {}} onSelectSession={() => {}} />);
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`title="${label}"`);
  });
  it('keeps all four periods ordered and assigns exact boundaries', () => {
    const input = [session('old', midnight - 7 * day - 1), session('week', midnight - 7 * day),
      session('yesterday', midnight - day), session('today', midnight), session('last-night', midnight - 1)];
    const groups = groupSessionsByDateAndTopic(input, now);
    expect(groups.map(group => group.key)).toEqual(['topicToday', 'topicYesterday', 'topicLastSevenDays', 'topicEarlier']);
    expect(groups.map(group => group.topics.flatMap(topic => topic.sessions.map(item => item.id))))
      .toEqual([['today'], ['last-night', 'yesterday'], ['week'], ['old']]);
    expect(input[0]!.id).toBe('old');
  });
  it('keeps a topic together using its latest updated activity', () => {
    const older = session('older', midnight - 10 * day, 'shared');
    const newer = { ...session('newer', midnight - 9 * day, 'shared'), updatedAt: new Date(now).toISOString() };
    const groups = groupSessionsByDateAndTopic([older, newer], now);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe('topicToday');
    expect(groups[0]!.topics[0]!.sessions.map(item => item.id)).toEqual(['newer', 'older']);
  });
  it('places invalid dates in Earlier and omits empty periods', () => {
    expect(groupSessionsByDateAndTopic([], now)).toEqual([]);
    expect(groupSessionsByDateAndTopic([{ ...session('bad', now), createdAt: 'invalid' }], now)[0]!.key).toBe('topicEarlier');
  });
  it('renders visible period headings per workspace with accessible inline actions', () => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const html = renderToStaticMarkup(<Sidebar projects={[]} sessions={[session('today', now), session('yesterday', midnight - day),
      { ...session('other', now), workspaceRoot: 'E:/other' }]} selectedSessionId="today" onNewSession={() => {}} onSelectSession={() => {}} />);
    expect(html.match(/topic-period-label/g)).toHaveLength(3);
    expect(html).toContain('Yesterday');
    expect(html).toContain('topic-session side-item-active');
    expect(html).toContain('aria-label="Rename session"');
    expect(html).toContain('topic-actions-inline');
    expect(html).not.toContain('<details');
  });
  it('names a single workspace once: no second copy as a history group label', () => {
    const html = renderToStaticMarkup(<Sidebar projects={[{ root: 'E:/solo' }]}
      sessions={[{ ...session('today', now), workspaceRoot: 'E:/solo' }]} selectedSessionId="today" onNewSession={() => {}} onSelectSession={() => {}} />);
    expect(html).toContain('>solo<');                       // the project row keeps the name
    expect(html).not.toMatch(/class="side-label[^"]*">solo</); // the history group label does not
  });
  it('labels each workspace group when sessions span several roots', () => {
    const html = renderToStaticMarkup(<Sidebar projects={[]}
      sessions={[session('today', now), { ...session('other', now), workspaceRoot: 'E:/other' }]} selectedSessionId="today" onNewSession={() => {}} onSelectSession={() => {}} />);
    expect(html).toMatch(/class="side-label[^"]*">workspace</);
    expect(html).toMatch(/class="side-label[^"]*">other</);
    expect(html.match(/topic-period-label/g)).toHaveLength(2);
  });
  it('does not render a bare workspace label for a project with no sessions', () => {
    const html = renderToStaticMarkup(<Sidebar projects={[{ root: 'E:/empty' }, { root: 'E:/workspace' }]}
      sessions={[session('today', now)]} selectedSessionId="today" onNewSession={() => {}} onSelectSession={() => {}} />);
    // several roots: the group that owns sessions keeps its label...
    expect(html).toMatch(/class="side-label[^"]*">workspace</);
    // ...the project with no periods must not paint an empty heading
    expect(html).not.toMatch(/class="side-label[^"]*">empty</);
  });
});

describe('Sidebar unified area footer navigation', () => {
  it('renders all four area buttons and marks the selected area active', () => {
    const html = renderToStaticMarkup(
      <Sidebar
        area="activity"
        onSelectArea={() => {}}
        projects={[]}
        sessions={[]}
        onNewSession={() => {}}
        onSelectSession={() => {}}
      />
    );
    expect(html).toContain('sidebar-footer');
    expect(html).toContain('sidebar-area-tabs');
    expect(html).toContain('data-area="workbench"');
    expect(html).toContain('data-area="activity"');
    expect(html).toContain('data-area="studio"');
    expect(html).toContain('data-area="settings"');
    expect(html).toContain('data-area="activity" class="sidebar-area-btn active" aria-selected="true"');
    expect(html).toContain('sidebar-theme-toggle');
  });
});

describe('Sidebar topic filtering', () => {
  const active = session('Active-ID', now);
  const archived = { ...session('archived', now), topic: { ...session('archived', now).topic!, isArchived: true } };
  it('hides archived topics by default and includes them when requested', () => {
    expect(filterSessionsByTopic([active, archived], '', false)).toEqual([active]);
    expect(filterSessionsByTopic([active, archived], '  ', true)).toEqual([active, archived]);
    expect(filterSessionsByTopic([archived], 'archived', false)).toEqual([]);
  });
  it('matches trimmed case-insensitive titles, roots and session IDs', () => {
    for (const query of [' TASK ACTIVE ', 'E:/WORKSPACE', 'active-id']) {
      expect(filterSessionsByTopic([active], query, false)).toEqual([active]);
    }
    expect(filterSessionsByTopic([active], 'missing', true)).toEqual([]);
    expect(filterSessionsByTopic([{ ...active, topic: undefined }], 'active-id', false)).toHaveLength(1);
  });
});


