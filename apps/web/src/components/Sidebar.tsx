import { useEffect, useMemo, useRef, useState } from 'react';
import type { Project, SessionMeta } from '../api';
import type { MessageKey } from '../i18n';
import { VesselLogo } from './VesselLogo';
import { useI18n } from './LanguageProvider';
import { projectName, readableSessionTitle } from './TaskComposer';
import { formatClock } from '../utils/timeFormat';
import { applyTheme, getStoredTheme, type ThemeMode } from '../utils/theme';
import { RAIL_AREAS, GLYPHS, type RailArea } from './layout/Rail';

export interface SidebarProps {
  area?: RailArea;
  onSelectArea?: (area: RailArea) => void;
  selectedProjectRoot?: string;
  onSelectProject?: (root: string) => void;
  projects: Project[];
  sessions: SessionMeta[];
  onNewSession: () => void;
  /** currently open session id (if any); highlights its row. */
  selectedSessionId?: string | null;
  /** invoked when the user clicks a session row. */
  onSelectSession: (id: string) => void;
  onRenameTopic?: (sessionId: string, title: string) => void;
  onArchiveTopic?: (sessionId: string, archived: boolean) => void;
  onDeleteSession?: (sessionId: string | string[]) => void;
  deleteErrors?: Record<string, MessageKey>;
  deletingIds?: string[];
  onCollapse?: () => void;
}

type TopicPeriodKey = 'topicToday' | 'topicYesterday' | 'topicLastSevenDays' | 'topicEarlier';

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
  const day = 24 * 60 * 60 * 1000;
  const yesterdayStart = todayStart - day;
  const lastWeekStart = todayStart - 7 * day;
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
    ['topicYesterday', new Map()],
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
      : timestamp < yesterdayStart
        ? 'topicLastSevenDays'
        : timestamp < todayStart
          ? 'topicYesterday'
          : 'topicToday';
    periods.get(periodKey)!.set(group.topicId, group);
  }

  return [...periods].map(([key, topics]) => ({ key, topics: [...topics.values()] })).filter((period) => period.topics.length > 0);
}

/** Left rail: projects plus searchable, date-grouped Topic navigation. */
export default function Sidebar({
  area,
  onSelectArea,
  projects,
  selectedProjectRoot,
  onSelectProject,
  sessions,
  onNewSession,
  selectedSessionId,
  onSelectSession,
  onRenameTopic,
  onArchiveTopic,
  onDeleteSession,
  deleteErrors = {},
  deletingIds = [],
  onCollapse,
}: SidebarProps) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const restoreDeleteFocus = useRef<string | null>(null);
  function cancelDelete() {
    restoreDeleteFocus.current = confirmDeleteId;
    setConfirmDeleteId(null);
  }
  const workspaceGroups = useMemo(() => {
    const roots = [...new Set([...projects.map(project => project.root), ...sessions.map(session => session.workspaceRoot)])];
    return roots.map(root => ({
      root,
      periods: groupSessionsByDateAndTopic(filterSessionsByTopic(sessions.filter(session => session.workspaceRoot === root), query, showArchived)),
    })).filter(group => group.periods.length > 0 || projects.some(project => project.root === group.root));
  }, [projects, sessions, query, showArchived]);

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
        {onCollapse && <button type="button" className="btn sidebar-collapse" aria-label={t('collapseSidebar')} onClick={onCollapse}>‹</button>}
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
                  <button type="button" className={`project-select${project.root === selectedProjectRoot ? ' side-item-active' : ''}`} onClick={() => onSelectProject?.(project.root)}>{projectName(project.root)}</button>
                </li>
              ))
            )}
          </ul>
        </section>

        <section>
          <div className="side-label">{t('recentSessions')}</div>
          <div className="side-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg>
            <input
              type="search"
              className="topic-search"
              aria-label={t('topicSearch')}
              placeholder={t('topicSearch')}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <label className="topic-archived-toggle">
            <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
            {t('topicShowArchived')}
          </label>
          {sessions.length === 0 ? (
            <div className="side-empty">{t('noSessions')}</div>
          ) : workspaceGroups.every(group => group.periods.length === 0) ? (
            <div className="side-empty">{t('noSessions')}</div>
          ) : (
            <div className="topic-period-list">
              {workspaceGroups.map((workspace) => (
                <section className="topic-period" key={workspace.root}>
                  <div className="side-label">{projectName(workspace.root)}</div>
                  {workspace.periods.map(period => (
                    <section className="topic-period" key={period.key}>
                      <div className="side-label topic-period-label">{t(period.key)}</div>
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
                                {readableSessionTitle(group.sessions[0]!, t('sessionNew'))}
                              </button>
                            )}
                            {editingTopicId !== group.topicId && (
                              <div className="topic-actions-inline">
                                <button type="button" className="topic-action" aria-label={t('topicRename')} title={t('topicRename')} onClick={() => beginRename(group)}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z" /></svg>
                                </button>
                                <button type="button" className="topic-action" aria-label={group.isArchived ? t('topicRestore') : t('topicArchive')} title={group.isArchived ? t('topicRestore') : t('topicArchive')} onClick={() => onArchiveTopic?.(group.sessions[0]!.id, !group.isArchived)}>
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 8h16v12H4zM3 4h18v4H3z" /><path d={group.isArchived ? 'm9 14 3-3 3 3M12 11v6' : 'M9 12h6'} /></svg>
                                </button>
                                {confirmDeleteId === group.sessions[0]!.id ? (
                                  <span className="topic-delete-confirm" onKeyDown={event => {
                                    if (event.key !== 'Escape') return;
                                    event.preventDefault();
                                    event.stopPropagation();
                                    cancelDelete();
                                  }}>
                                    <span className="dim">{t('sessionRecycleConfirm', { count: String(group.sessions.length) })}</span>
                                    <button type="button" className="btn btn-sm btn-danger" disabled={group.sessions.some(s => deletingIds.includes(s.id))} onClick={() => { onDeleteSession?.(group.sessions.map((s) => s.id)); setConfirmDeleteId(null); }}>{t('confirm')}</button>
                                    <button type="button" className="btn btn-sm" autoFocus onClick={cancelDelete}>{t('cancel')}</button>
                                  </span>
                                ) : (
                                  <button type="button" className="topic-action topic-action-danger" aria-label={t('delete')} title={t('delete')} ref={button => {
                                    if (button && restoreDeleteFocus.current === group.sessions[0]!.id) {
                                      restoreDeleteFocus.current = null;
                                      button.focus();
                                    }
                                  }} onClick={() => setConfirmDeleteId(group.sessions[0]!.id)}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" /></svg>
                                  </button>
                                )}
                              </div>
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
                              {group.sessions.length > 1 ? readableSessionTitle(session, t('sessionNew')) : formatClock(session.updatedAt ?? session.createdAt)}
                            </button>
                          ))}
                          {group.sessions.filter(session => deleteErrors[session.id]).map(session => (
                            <div key={`delete-${session.id}`} role="alert">
                              <p>{session.id}: {t(deleteErrors[session.id]!)}</p>
                              <button type="button" className="btn btn-sm" disabled={deletingIds.includes(session.id)} onClick={() => onDeleteSession?.(session.id)}>{t('retry')}</button>
                            </div>
                          ))}

                    </section>
                  ))}
                    </section>
                  ))}
                </section>
              ))}
            </div>
          )}
        </section>
        <p className="dim hierarchy-hint">{t('hierarchyHint')}</p>
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-area-tabs" role="tablist" aria-label={t('navigationMenu')}>
          {RAIL_AREAS.map((val) => (
            <button
              key={val}
              type="button"
              role="tab"
              data-area={val}
              className={`sidebar-area-btn${area === val ? ' active' : ''}`}
              aria-selected={area === val}
              aria-label={t(val === 'studio' ? 'agentStudio' : val)}
              title={t(val === 'studio' ? 'agentStudio' : val)}
              onClick={() => onSelectArea?.(val)}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {GLYPHS[val]}
              </svg>
              <span className="sidebar-area-label">{t(val === 'studio' ? 'agentStudio' : val)}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-footer-extra">
          <button
            type="button"
            className="btn btn-sm sidebar-theme-toggle"
            aria-label={t(isDark ? 'themeSwitchLight' : 'themeSwitchDark')}
            title={t(isDark ? 'themeSwitchLight' : 'themeSwitchDark')}
            onClick={() => {
              const next = isDark ? 'light' : 'dark';
              setTheme(next);
              applyTheme(next);
            }}
          >
            {isDark ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
            <span className="sidebar-theme-text">{isDark ? 'Dark' : 'Light'}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
