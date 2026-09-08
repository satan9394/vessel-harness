import { useCallback, useEffect, useState } from 'react';
import { createApiClient, type ApiClient, type Health, type Project, type SessionMeta } from './api';
import Sidebar from './components/Sidebar';
import StatusBar from './components/StatusBar';
import NewSessionForm, { type NewSessionResult } from './components/NewSessionForm';

export default function App() {
  const [api] = useState<ApiClient>(() => createApiClient());
  const [health, setHealth] = useState<Health | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [serverError, setServerError] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [created, setCreated] = useState<NewSessionResult | null>(null);

  const connect = useCallback(async () => {
    setServerError(false);
    try {
      const h = await api.health();
      setHealth(h);
      const [{ projects: ps }, { sessions: ss }] = await Promise.all([api.projects(), api.sessions()]);
      setProjects(ps);
      setSessions(ss);
    } catch {
      setServerError(true);
      setHealth(null);
    }
  }, [api]);

  useEffect(() => {
    void connect();
  }, [connect]);

  function onCreated(result: NewSessionResult) {
    setCreated(result);
    void connect();
  }

  return (
    <div className="app">
      <Sidebar projects={projects} sessions={sessions} onNewSession={() => setShowNew(true)} />
      <main className="main">
        <StatusBar health={health} error={serverError} />
        {created ? (
          <section className="main-body">
            <h2>会话已创建</h2>
            <p className="result-line">
              session <code>{created.sessionId}</code>
            </p>
            <p className="result-line">workspaceRoot <code>{created.projectRoot}</code></p>
            <button type="button" className="btn" onClick={() => setCreated(null)}>
              选择或新建会话
            </button>
          </section>
        ) : (
          <section className="main-body">
            <h2>选择或新建会话</h2>
            <p className="dim">从左侧选择 Recent Sessions，或点击 <strong>+ New Session</strong> 打开一个项目。</p>
            {serverError && (
              <p className="error-text">无法连接 local server——请先运行 <code>vessel serve</code>（127.0.0.1:5678）。</p>
            )}
          </section>
        )}
      </main>
      {showNew && <NewSessionForm api={api} onCreated={onCreated} onClose={() => setShowNew(false)} />}
    </div>
  );
}