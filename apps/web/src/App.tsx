import { useCallback, useEffect, useState } from 'react';
import { createApiClient, type ApiClient, type Health, type Project, type SessionMeta } from './api';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import NewSessionForm, { type NewSessionResult } from './components/NewSessionForm';
import ConversationView from './components/ConversationView';

export default function App() {
  const [api] = useState<ApiClient>(() => createApiClient());
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [serverError, setServerError] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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
        <StatusBar health={health} error={serverError} />
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
          </section>
        ) : (
          <ConversationView sessionId={selectedSessionId as string} api={api} />
        )}
      </main>
      {showNew && <NewSessionForm api={api} onCreated={onCreated} onClose={() => setShowNew(false)} />}
    </div>
  );
}