import { localizedValue } from './i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createApiClient, type ApiClient, type Health, type Project, type SessionMeta, type CreateSessionInput } from './api';
import CommandPalette, { trapFocus } from './components/common/CommandPalette';
import type { CommandItem } from './components/palette/types';
import { INSPECTOR_TABS, INSPECTOR_LABELS, type InspectorTab } from './components/layout/DualSurfaceLayout';
import Sidebar from './components/Sidebar';
import SubagentWorkspace from './components/SubagentPanel';
import TaskComposer, { projectName, readableSessionTitle } from './components/TaskComposer';
import StatusBar from './components/StatusBar';
import NewSessionForm, { type NewSessionResult } from './components/NewSessionForm';
import ConversationView from './components/ConversationView';
import AttentionControls from './components/AttentionControls';
import { AttentionManager } from './utils/attentionManager';
import CustomizePanel from './components/CustomizePanel';
import ProviderSettingsModal from './components/providers/ProviderSettingsModal';
import LanguageSwitcher from './components/LanguageSwitcher';
import { LanguageProvider, useI18n } from './components/LanguageProvider';
import TeamModule from './components/TeamModule';
import GoalModule from './components/GoalModule';
import SwarmTopologyView from './components/SwarmTopologyView';
import CognitiveRulesDashboard from './components/CognitiveRulesDashboard';
import {
  loadModules,
  saveModules,
  type UiModuleState,
  type UiModuleId,
} from './uiModules';

/** Enabled module sections rendered below the conversation / empty state. */
const SECTION_ORDER: UiModuleId[] = [
  'Swarm',
  'CognitiveRules',
  'Team',
  'Tasks',
  'ChangedFiles',
  'Context',
  'ToolActivity',
  'Logs',
  'Cost',
  'MCP',
  'Policy',
];
/**
 * **已声明未实现**（非丢数据）：这四个模块在模块选择器里可勾选，但面板本体尚未实现，
 * 渲染时显示 `t('unimplemented')` 占位（见下方 `UNIMPLEMENTED.includes(id)` 分支）。
 * 触发条件 = 对应后端投影/接口就绪（Context / Logs / MCP / Policy 各有其数据源），
 * 届时逐个从本清单移除并把面板接上。
 */
const UNIMPLEMENTED: UiModuleId[] = ['Context', 'Logs', 'MCP', 'Policy'];

export default function App() {
  return (
    <LanguageProvider>
      <AppShell />
    </LanguageProvider>
  );
}

function AppShell() {
  const { t } = useI18n();
  const [attention] = useState(() => new AttentionManager());
  useEffect(() => { attention.attach(); return () => attention.dispose(); }, [attention]);
  const [api] = useState<ApiClient>(() => createApiClient());
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [serverError, setServerError] = useState(false);
  const [showProviders, setShowProviders] = useState(false);
  const [providerRevision, setProviderRevision] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [area, setArea] = useState<'workbench' | 'activity' | 'studio' | 'settings'>('workbench');
  const [drawer, setDrawer] = useState(false);
  const [taskStarting, setTaskStarting] = useState(false);
  const navigationFocus = useRef<HTMLElement | null>(null);
  const [projectRoot, setProjectRoot] = useState('');
  useEffect(() => {
    if (!drawer) return;
    navigationFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const navigation = document.querySelector<HTMLElement>('.navigation-shell');
    navigation?.querySelector<HTMLButtonElement>('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setDrawer(false); }
      else if (navigation) trapFocus(event, navigation);
    };
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('keydown', close);
      if (navigationFocus.current?.isConnected) navigationFocus.current.focus();
    };
  }, [drawer]);
  const [initialTask, setInitialTask] = useState<{ sessionId: string; text: string }>();
  const [newPermission, setNewPermission] = useState<CreateSessionInput['permission']>('workspace-write');
  const [viewRequest, setViewRequest] = useState<{ action: 'clear' | 'collapse' | 'expand' | 'export' | InspectorTab; serial: number }>();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [modules, setModules] = useState<UiModuleState>(() => loadModules());

  const handleModulesChange = useCallback((next: UiModuleState) => {
    setModules(next);
    saveModules(next);
  }, []);

  const updateSessionTopic = useCallback(async (id: string, input: { title?: string; isArchived?: boolean }) => {
    try {
      const { session } = await api.updateSessionTopic(id, input);
      setSessions((current) => current.map((item) => item.id === session.id ? session : item));
    } catch {
      setServerError(true);
    }
  }, [api]);

  const connect = useCallback(async () => {
    setServerError(false);
    try {
      const h = await api.health();
      setHealth(h);
      const [{ projects: ps }, { sessions: ss }] = await Promise.all([api.projects(), api.sessions()]);
      setProjects(ps);
      setProjectRoot(current => current || ps[0]?.root || '');
      setSessions(ss);
      // Keep selection valid if a session was removed on the server.
      setSelectedSessionId((cur) => (cur && ss.some((s) => s.id === cur) ? cur : null));
    } catch {
      setServerError(true);
      setHealth(null);
    }
  }, [api]);

  useEffect(() => {
    void connect();
  }, [connect]);

  function onCreated(result: NewSessionResult) {
    // auto-open the freshly created session
    setArea('workbench');
    setSelectedSessionId(result.sessionId);
    void connect();
  }

  const nothingSelected = !selectedSessionId || !sessions.some((s) => s.id === selectedSessionId);

  const requestView = (action: 'clear' | 'collapse' | 'expand' | 'export' | InspectorTab) => setViewRequest(previous => ({ action, serial: (previous?.serial ?? 0) + 1 }));
  const commands: CommandItem[] = [
    { id: 'providers', title: t('modelSettings'), category: 'action', keywords: ['provider', 'model'], execute: () => setShowProviders(true) },
    { id: 'new', title: t('newSessionTitle'), category: 'action', execute: () => { if (taskStarting) return; setArea('workbench'); setSelectedSessionId(null); } },
    ...(['read-only', 'workspace-write'] as const).map(permission => ({ id: `sandbox:${permission}`, title: t('paletteSandbox', { permission: t(permission === 'read-only' ? 'permissionReadOnly' : 'permissionWorkspaceWrite') }), category: 'action' as const, keywords: ['security'], execute: () => { if (taskStarting) return; setNewPermission(permission); setShowNew(true); } })),
    ...projects.map(project => ({ id: `project:${project.root}`, title: projectName(project.root), category: 'project' as const, keywords: [project.root], execute: () => { if (taskStarting) return; setProjectRoot(project.root); setArea('workbench'); setSelectedSessionId(null); } })),
    ...sessions.filter(session => !session.topic?.isArchived).map(session => ({ id: `session:${session.id}`, title: `${readableSessionTitle(session, t('sessionNew'))} · ${projectName(session.workspaceRoot)}`, category: 'session' as const, keywords: [session.id, session.workspaceRoot], execute: () => { if (taskStarting) return; setArea('workbench'); setSelectedSessionId(session.id); } })),
    ...(!nothingSelected ? [
      ...INSPECTOR_TABS.map(tab => ({ id: `inspector:${tab}`, title: t('paletteInspector', { tab: t(INSPECTOR_LABELS[tab]) }), category: 'navigation' as const, execute: () => requestView(tab) })),
      { id: 'export', title: t('paletteExportJson'), category: 'action' as const, execute: () => requestView('export') },
      { id: 'clear', title: t('paletteClearScreen'), category: 'view' as const, execute: () => requestView('clear') },
      { id: 'collapse', title: t('paletteCollapse'), category: 'view' as const, execute: () => requestView('collapse') },
      { id: 'expand', title: t('paletteExpand'), category: 'view' as const, execute: () => requestView('expand') },
    ] : []),
  ];

  return (
    <div className={`app${drawer ? ' navigation-open' : ''}`} data-provider-revision={providerRevision}>
      {drawer && <button className="navigation-backdrop" aria-label={t('close')} onClick={() => setDrawer(false)} />}
      <div className="navigation-shell" role={drawer ? 'dialog' : undefined} aria-modal={drawer ? true : undefined} aria-label={drawer ? t('navigationMenu') : undefined}>
      <button className="btn navigation-close" onClick={() => setDrawer(false)}>{t('close')}</button>
      <nav className="primary-nav" aria-label="Vessel">
        {(['workbench', 'activity', 'studio', 'settings'] as const).map(value => <button key={value} data-area={value} className={`btn${area === value ? ' side-item-active' : ''}`} aria-current={area === value ? 'page' : undefined} onClick={() => { setArea(value); setDrawer(false); }}>{t(value === 'studio' ? 'agentStudio' : value)}</button>)}
      </nav>
      <div className="session-navigation" inert={taskStarting}>
      <Sidebar
        projects={projects}
        sessions={sessions}
        onNewSession={() => { if (taskStarting) return; setArea('workbench'); setSelectedSessionId(null); setDrawer(false); }}
        selectedProjectRoot={projectRoot}
        onSelectProject={root => { if (taskStarting) return; setProjectRoot(root); setArea('workbench'); setSelectedSessionId(null); setDrawer(false); }}
        selectedSessionId={selectedSessionId}
        onSelectSession={id => { if (taskStarting) return; setSelectedSessionId(id); setArea('workbench'); setDrawer(false); }}
        onRenameTopic={(id, title) => void updateSessionTopic(id, { title })}
        onArchiveTopic={(id, isArchived) => void updateSessionTopic(id, { isArchived })}
      />
      </div>
      </div>
      <main className="main" inert={drawer}>
        <div className="topbar">
          <button className="btn navigation-toggle" aria-label={t('navigationMenu')} aria-expanded={drawer} onClick={() => setDrawer(value => !value)}>☰</button>
          <StatusBar health={health} error={serverError} />
          <div className="topbar-actions">

            <CommandPalette commands={commands} />
            <details className="preferences-menu"><summary className="btn">{t('preferences')}</summary><div className="preferences-content"><AttentionControls attention={attention} /><CustomizePanel modules={modules} onChange={handleModulesChange} /><LanguageSwitcher /></div></details>
          </div>
        </div>
        {area === 'activity' ? <section className="main-body"><h2>{t('activity')}</h2><p className="dim">{t('activityHint')}</p><div className="activity-sessions">{sessions.filter(session => !session.topic?.isArchived).map(session => <button className="btn" key={session.id} disabled={taskStarting} onClick={() => { if (taskStarting) return; setSelectedSessionId(session.id); setArea('workbench'); }}><strong>{readableSessionTitle(session, t('sessionNew'))}</strong><span>{projectName(session.workspaceRoot)} · {new Date(session.updatedAt ?? session.createdAt).toLocaleString()}</span></button>)}</div>{!sessions.length && <p>{t('noSessions')}</p>}<SubagentWorkspace api={api} /></section>
 : null}
        {area === 'studio' ? <section className="main-body"><h2>{t('agentStudio')}</h2><p className="dim">{t('studioHint')}</p><CognitiveRulesDashboard api={api} /></section>
 : null}
        {area === 'settings' ? <section className="main-body"><h2>{t('settings')}</h2><button className="btn" data-action="configure-models" onClick={() => setShowProviders(true)}>{t('modelSettings')}</button><p className="dim">{t('layoutBoundary')}</p><CustomizePanel modules={modules} onChange={handleModulesChange} /><LanguageSwitcher /><AttentionControls attention={attention} /></section>
 : null}
        <div className="workbench-region" hidden={area !== 'workbench'}>
        {nothingSelected ? (
          <section className="main-body workbench-home">
            <p className="dim">{t('hierarchyHint')}</p>
            {serverError && <p role="alert" className="error-text">{t('serverDown')} <code>vessel serve</code> <button className="btn" onClick={() => void connect()}>{t('modelRetry')}</button></p>}
            <TaskComposer onBusyChange={setTaskStarting} api={api} projects={projects} selectedRoot={projectRoot} onSelectProject={setProjectRoot} providerRevision={providerRevision} disabled={serverError || !health?.ok} onConfigureModels={() => setShowProviders(true)} onAdvanced={() => setShowNew(true)} onStarted={(session, task) => { setSessions(current => [session, ...current.filter(item => item.id !== session.id)]); setProjectRoot(session.workspaceRoot); setInitialTask({ sessionId: session.id, text: task }); setSelectedSessionId(session.id); void connect(); }} />
          </section>
        ) : (
          <div className="conversation-wrap">
            <ConversationView initialTask={initialTask} onInitialTaskConsumed={() => setInitialTask(undefined)} sessionTitle={readableSessionTitle(sessions.find(session => session.id === selectedSessionId)!, t('sessionNew'))} providerRevision={providerRevision} onConfigureModels={() => setShowProviders(true)} attention={attention} viewRequest={viewRequest} sessionId={selectedSessionId as string} api={api} onSessionUpdated={() => void connect()} />
            <ModuleSections modules={modules} api={api} sessionId={selectedSessionId as string} />
          </div>
        )}
        </div>
      </main>
      {showNew && <NewSessionForm hidden={showProviders} providerRevision={providerRevision} onConfigureModels={() => setShowProviders(true)} initialWorkspaceRoot={projectRoot} initialPermission={newPermission} api={api} onCreated={onCreated} onClose={() => setShowNew(false)} />}
      {showProviders && <ProviderSettingsModal api={api} onClose={() => setShowProviders(false)} onChanged={() => setProviderRevision(previous => previous + 1)} />}
    </div>
  );
}

/** Render the enabled UI module sections in display order (placeholders for now). */
function ModuleSections({
  modules,
  api,
  sessionId,
}: {
  modules: UiModuleState;
  api: ApiClient;
  sessionId: string | null;
}) {
  const enabled = SECTION_ORDER.filter((key) => modules[key]);
  if (enabled.length === 0) return null;
  return (
    <div className="module-sections">
      {enabled.map((key) => (
        <ModuleSection key={key} id={key} api={api} sessionId={sessionId} />
      ))}
    </div>
  );
}

function ModuleSection({
  id,
  api,
  sessionId,
}: {
  id: UiModuleId;
  api: ApiClient;
  sessionId: string | null;
}) {
  const { t } = useI18n();
  switch (id) {
    case 'Swarm':
      return <SwarmTopologyView api={api} />;
    case 'CognitiveRules':
      return <CognitiveRulesDashboard api={api} />;
    case 'Team':
      // task 060: real Team module (model select + team panel + external review)
      // needs a session; without one show the friendly prompt.
      if (!sessionId) {
        return (
          <div className="module-card">
            <div className="module-card-title">{t('uiTeam')}</div>
            <div className="module-card-body dim">{t('teamModuleNoSession')}</div>
          </div>
        );
      }
      return (
        <div className="module-card module-card-team">
          <div className="module-card-title">{t('uiTeam')}</div>
          <div className="module-card-body">
            <TeamModule sessionId={sessionId} api={api} />
          </div>
        </div>
      );
    case 'Tasks':
      // task 065: real Goal module (task queue + iteration replay + run control)
      // needs a session; without one show the friendly prompt.
      if (!sessionId) {
        return (
          <div className="module-card">
            <div className="module-card-title">{t('uiGoals')}</div>
            <div className="module-card-body dim">{t('goalModuleNoSession')}</div>
          </div>
        );
      }
      return (
        <div className="module-card module-card-goal">
          <div className="module-card-title">{t('uiGoals')}</div>
          <div className="module-card-body">
            <GoalModule sessionId={sessionId} api={api} />
          </div>
        </div>
      );
    case 'ChangedFiles':
    case 'Cost':
    case 'ToolActivity':
      // Real session data is shown in the conversation Inspector.
      return null;
    default:
      if (UNIMPLEMENTED.includes(id)) {
        return (
          <div className="module-card">
            <div className="module-card-title">{localizedValue(id, t)}</div>
            <div className="module-card-body dim">{t('unimplemented')}</div>
          </div>
        );
      }
      return null;
  }
}
