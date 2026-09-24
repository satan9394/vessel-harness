import { useMemo, useState } from 'react';
import type { Project, SessionMeta } from '../api';
import { VesselLogo } from './VesselLogo';
import { useI18n } from './LanguageProvider';

export interface SidebarProps {
  projects: Project[];
  sessions: SessionMeta[];
  onNewSession: () => void;
  /** currently open session id (if any); highlights its row. */
  selectedSessionId?: string | null;
  /** invoked when the user clicks a session row. */
  onSelectSession: (id: string) => void;
  onRenameTopic?: (sessionId: string, title: string) => void;
  onArchiveTopic?: (sessionId: string, archived: boolean) => void;
}

type TopicPeriodKey = 'topicToday' | 'topicLastSevenDays' | 'topicEarlier';

export interface SidebarTopicGroup {
  topicId: string;
  title: string;
  isArchived: boolean;
  sessions: SessionMeta[];
}

export interface SidebarPeriodGroup {
  key: TopicPeriodKey;
  topics: SidebarTopicGroup[];
}

/** Search by Topic title, workspace path, or stable session id. */
export function filterSessionsByTopic(sessions: SessionMeta[], query: string, showArchived: boolean): SessionMeta[] {
  const needle = query.trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    if (!showArchived && session.topic?.isArchived) return false;
    if (!needle) return true;
    return [session.topic?.title, session.workspaceRoot, session.id].some((value) => value?.toLocaleLowerCase().includes(needle));
  });
}

/** Pure grouping helper, shared by the sidebar and its deterministic tests. */
export function groupSessionsByDateAndTopic(sessions: SessionMeta[], now = Date.now()): SidebarPeriodGroup[] {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  const lastWeekStart = todayStart - 7 * 24 * 60 * 60 * 1000;
  const topics = new Map<string, SidebarTopicGroup>();

  const ordered = [...sessions].sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
  for (const session of ordered) {
    const topicId = session.topic?.topicId ?? `session:${session.id}`;
    let group = topics.get(topicId);
    if (!group) {
      group = {
        topicId,
        title: session.topic?.title ?? '',
        isArchived: session.topic?.isArchived === true,
        sessions: [],
      };
      topics.set(topicId, group);
    }
    group.isArchived ||= session.topic?.isArchived === true;
    group.sessions.push(session);
  }

  const periods = new Map<TopicPeriodKey, Map<string, SidebarTopicGroup>>([
    ['topicToday', new Map()],
    ['topicLastSevenDays', new Map()],
    ['topicEarlier', new Map()],
  ]);
  // A Topic stays together even when its sessions span multiple date ranges;
  // place the entire group according to its latest activity.
  for (const group of topics.values()) {
    const latest = group.sessions[0];
    const timestamp = latest ? Date.parse(latest.updatedAt ?? latest.createdAt) : Number.NaN;
    const periodKey: TopicPeriodKey = !Number.isFinite(timestamp) || timestamp < lastWeekStart
      ? 'topicEarlier'
      : timestamp < todayStart
        ? 'topicLastSevenDays'
        : 'topicToday';
    periods.get(periodKey)!.set(group.topicId, group);
  }

  return [...periods].map(([key, topics]) => ({ key, topics: [...topics.values()] })).filter((period) => period.topics.length > 0);
}

function sessionLabel(session: SessionMeta): string {
  const parts = session.workspaceRoot.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || session.id.slice(0, 12);
}

/** Left rail: projects plus searchable, date-grouped Topic navigation. */
export default function Sidebar({
  projects,
  sessions,
  onNewSession,
  selectedSessionId,
  onSelectSession,
  onRenameTopic,
  onArchiveTopic,
}: SidebarProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const periods = useMemo(
    () => groupSessionsByDateAndTopic(filterSessionsByTopic(sessions, query, showArchived)),
    [sessions, query, showArchived],
  );

  function beginRename(group: SidebarTopicGroup) {
    setEditingTopicId(group.topicId);
    setDraftTitle(group.title);
  }

  function saveRename(group: SidebarTopicGroup) {
    const title = draftTitle.trim();
    if (title) onRenameTopic?.(group.sessions[0]!.id, title);
    setEditingTopicId(null);
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <VesselLogo />
        <span className="brand-name">Vessel</span>
      </div>

      <button type="button" className="btn btn-primary" onClick={onNewSession}>
        {t('newSession')}
      </button>

      <nav className="side-nav">
        <section>
          <div className="side-label">{t('projects')}</div>
          <ul className="side-list">
            {projects.length === 0 ? (
              <li className="side-empty">{t('noProjects')}</li>
            ) : (
              projects.map((project) => (
                <li key={project.root} className="side-item" title={project.root}>
                  {project.root}
                </li>
              ))
            )}
          </ul>
        </section>

        <section>
          <div className="side-label">{t('recentSessions')}</div>
          <input
            className="input topic-search"
            aria-label={t('topicSearch')}
            placeholder={t('topicSearch')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <label className="topic-archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            {t('topicShowArchived')}
          </label>
          {sessions.length === 0 ? (
            <div className="side-empty">{t('noSessions')}</div>
          ) : periods.length === 0 ? (
            <div className="side-empty">{t('noSessions')}</div>
          ) : (
            <div className="topic-period-list">
              {periods.map((period) => (
                <section className="topic-period" key={period.key}>
                  <div className="side-label">{t(period.key)}</div>
                  {period.topics.map((group) => (
                    <section className="topic-group" key={group.topicId}>
                      <div className="topic-heading">
                        {editingTopicId === group.topicId ? (
                          <form
                            className="topic-edit"
                            onSubmit={(event) => {
                              event.preventDefault();
                              saveRename(group);
                            }}
                          >
                            <input
                              className="input"
                              aria-label={t('topicRename')}
                              value={draftTitle}
                              onChange={(event) => setDraftTitle(event.target.value)}
                              autoFocus
                            />
                            <button type="submit" className="topic-action" aria-label={t('topicSave')}>{t('topicSave')}</button>
                            <button type="button" className="topic-action" onClick={() => setEditingTopicId(null)}>{t('topicCancel')}</button>
                          </form>
                        ) : (
                          <button
                            type="button"
                            className="topic-title"
                            onClick={() => onSelectSession(group.sessions[0]!.id)}
                            title={group.title}
                          >
                            {group.title || t('topicUntitled')}
                          </button>
                        )}
                      </div>
                      {group.sessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          className={`side-item topic-session${session.id === selectedSessionId ? ' side-item-active' : ''}`}
                          title={session.workspaceRoot}
                          onClick={() => onSelectSession(session.id)}
                        >
                          {sessionLabel(session)}
                        </button>
                      ))}
                      {editingTopicId !== group.topicId && (
                        <div className="topic-actions">
                          <button type="button" className="topic-action" onClick={() => beginRename(group)}>
                            {t('topicRename')}
                          </button>
                          <button
                            type="button"
                            className="topic-action"
                            onClick={() => onArchiveTopic?.(group.sessions[0]!.id, !group.isArchived)}
                          >
                            {group.isArchived ? t('topicRestore') : t('topicArchive')}
                          </button>
                        </div>
                      )}
                    </section>
                  ))}
                </section>
              ))}
            </div>
          )}
        </section>
      </nav>

      <div className="side-footer">
        <span className="side-item">{t('settings')}</span>
      </div>
    </aside>
  );
}
