import { useCallback, useEffect, useState } from 'react';
import { createApiClient, type ApiClient, type Health, type Project, type SessionMeta } from './api';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import NewSessionForm, { type NewSessionResult } from './components/NewSessionForm';
import ConversationView from './components/ConversationView';
import CustomizePanel from './components/CustomizePanel';
import LanguageSwitcher from './components/LanguageSwitcher';
import { LanguageProvider, useI18n } from './components/LanguageProvider';
import UsageBar, { emptyUsage } from './components/UsageBar';
import ToolActivityRow from './components/ToolActivityRow';
import TeamModule from './components/TeamModule';
import GoalModule from './components/GoalModule';
import type { ToolDelta } from './sse';
import {
  loadModules,
  saveModules,
  type UiModuleState,
  type UiModuleId,
} from './uiModules';

/** Enabled module sections rendered below the conversation / empty state. */
const SECTION_ORDER: UiModuleId[] = [
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
  const [api] = useState<ApiClient>(() => createApiClient());
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [serverError, setServerError] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [modules, setModules] = useState<UiModuleState>(() => loadModules());

  const handleModulesChange = useCallback((next: UiModuleState) => {
    setModules(next);
    saveModules(next);
  }, []);

  const connect = useCallback(async () => {
    setServerError(false);
    try {
      const h = await api.health();
      setHealth(h);
      const [{ projects: ps }, { sessions: ss }] = await Promise.all([api.projects(), api.sessions()]);
      setProjects(ps);
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
    setSelectedSessionId(result.sessionId);
    void connect();
  }

  const nothingSelected = !selectedSessionId || !sessions.some((s) => s.id === selectedSessionId);

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        sessions={sessions}
        onNewSession={() => setShowNew(true)}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
      />
      <main className="main">
        <div className="topbar">
          <StatusBar health={health} error={serverError} />
          <div className="topbar-actions">
            <CustomizePanel modules={modules} onChange={handleModulesChange} />
            <LanguageSwitcher />
          </div>
        </div>
        {nothingSelected ? (
          <section className="main-body">
            <h2>{t('emptyTitle')}</h2>
            <p className="dim">{t('emptyBody')}</p>
            {serverError && (
              <p className="error-text">
                {t('serverDown')} <code>vessel serve</code>
              </p>
            )}
            <ModuleSections modules={modules} api={api} sessionId={null} />
          </section>
        ) : (
          <div className="conversation-wrap">
            <ConversationView sessionId={selectedSessionId as string} api={api} />
            <ModuleSections modules={modules} api={api} sessionId={selectedSessionId as string} />
          </div>
        )}
      </main>
      {showNew && <NewSessionForm api={api} onCreated={onCreated} onClose={() => setShowNew(false)} />}
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
    case 'Team':
      // task 060: real Team module (model select + team panel + external review)
      // needs a session; without one show the friendly prompt.
      if (!sessionId) {
        return (
          <div className="module-card">
            <div className="module-card-title">Team</div>
            <div className="module-card-body dim">{t('teamModuleNoSession')}</div>
          </div>
        );
      }
      return (
        <div className="module-card module-card-team">
          <div className="module-card-title">Team</div>
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
            <div className="module-card-title">Goals</div>
            <div className="module-card-body dim">{t('goalModuleNoSession')}</div>
          </div>
        );
      }
      return (
        <div className="module-card module-card-goal">
          <div className="module-card-title">Goals</div>
          <div className="module-card-body">
            <GoalModule sessionId={sessionId} api={api} />
          </div>
        </div>
      );
    case 'ChangedFiles':
      return <PlaceholderCard title="Changed Files">{t('changedFilesPlaceholder')}</PlaceholderCard>;
    case 'Cost':
      // 042 UsageBar reuse; placeholders until live usage is lifted up from a session.
      return (
        <PlaceholderCard title="Cost">
          <UsageBar usage={emptyUsage()} />
        </PlaceholderCard>
      );
    case 'ToolActivity':
      // 042 ToolActivityRow reuse; placeholder rows until a live tool stream is lifted up.
      return (
        <PlaceholderCard title="Tool Activity">
          <div className="tool-activity-list">
            {SAMPLE_TOOL_ACTIVITY.map((tool, i) => (
              <ToolActivityRow key={i} delta={tool} />
            ))}
          </div>
        </PlaceholderCard>
      );
    default:
      if (UNIMPLEMENTED.includes(id)) {
        return (
          <div className="module-card">
            <div className="module-card-title">{id}</div>
            <div className="module-card-body dim">{t('unimplemented')}</div>
          </div>
        );
      }
      return null;
  }
}

function PlaceholderCard({ title, children }: { title: string; children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="module-card">
      <div className="module-card-title">{title}</div>
      <div className="module-card-body dim">{children ?? t('placeholderDev')}</div>
    </div>
  );
}

const now = Date.now();
/** Placeholder tool rows for the Tool Activity module until live data is wired. */
const SAMPLE_TOOL_ACTIVITY: ToolDelta[] = [
  { toolName: 'read_file', status: 'done', argsSummary: 'src/App.tsx', durationMs: 12, ts: now },
  { toolName: 'grep', status: 'done', argsSummary: 'pattern=task 043', durationMs: 8, ts: now },
  { toolName: 'write_file', status: 'started', argsSummary: 'src/components/CustomizePanel.tsx', ts: now },
];