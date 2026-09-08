import { useCallback, useEffect, useState } from 'react';
import { createApiClient, type ApiClient, type Health, type Project, type SessionMeta } from './api';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import NewSessionForm, { type NewSessionResult } from './components/NewSessionForm';
import ConversationView from './components/ConversationView';
import CustomizePanel from './components/CustomizePanel';
import UsageBar, { emptyUsage } from './components/UsageBar';
import ToolActivityRow from './components/ToolActivityRow';
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
const UNIMPLEMENTED: UiModuleId[] = ['Team', 'Context', 'Logs', 'MCP', 'Policy'];

export default function App() {
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
          <CustomizePanel modules={modules} onChange={handleModulesChange} />
        </div>
        {nothingSelected ? (
          <section className="main-body">
            <h2>选择或新建会话</h2>
            <p className="dim">
              从左侧 Recent Sessions 选择一个会话开始对话，或点击 <strong>+ New Session</strong> 打开一个项目。
            </p>
            {serverError && (
              <p className="error-text">
                无法连接 local server——请先运行 <code>vessel serve</code>（127.0.0.1:5678）。
              </p>
            )}
            <ModuleSections modules={modules} />
          </section>
        ) : (
          <div className="conversation-wrap">
            <ConversationView sessionId={selectedSessionId as string} api={api} />
            <ModuleSections modules={modules} />
          </div>
        )}
      </main>
      {showNew && <NewSessionForm api={api} onCreated={onCreated} onClose={() => setShowNew(false)} />}
    </div>
  );
}

/** Render the enabled UI module sections in display order (placeholders for now). */
function ModuleSections({ modules }: { modules: UiModuleState }) {
  const enabled = SECTION_ORDER.filter((key) => modules[key]);
  if (enabled.length === 0) return null;
  return (
    <div className="module-sections">
      {enabled.map((key) => (
        <ModuleSection key={key} id={key} />
      ))}
    </div>
  );
}

function ModuleSection({ id }: { id: UiModuleId }) {
  switch (id) {
    case 'Tasks':
      return <PlaceholderCard title="Tasks">任务列表占位（开发中）。</PlaceholderCard>;
    case 'ChangedFiles':
      return <PlaceholderCard title="Changed Files">变更文件列表占位（开发中）。</PlaceholderCard>;
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
            {SAMPLE_TOOL_ACTIVITY.map((t, i) => (
              <ToolActivityRow key={i} delta={t} />
            ))}
          </div>
        </PlaceholderCard>
      );
    default:
      if (UNIMPLEMENTED.includes(id)) {
        return (
          <div className="module-card">
            <div className="module-card-title">{id}</div>
            <div className="module-card-body dim">未实现（占位）。</div>
          </div>
        );
      }
      return null;
  }
}

function PlaceholderCard({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="module-card">
      <div className="module-card-title">{title}</div>
      <div className="module-card-body dim">{children ?? '（开发中）'}</div>
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