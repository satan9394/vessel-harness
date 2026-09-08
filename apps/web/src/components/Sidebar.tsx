import type { Project, SessionMeta } from '../api';
import { VesselLogo } from './VesselLogo';

export interface SidebarProps {
  projects: Project[];
  sessions: SessionMeta[];
  onNewSession: () => void;
  /** currently open session id (if any); highlights its row. */
  selectedSessionId?: string | null;
  /** invoked when the user clicks a session row. */
  onSelectSession: (id: string) => void;
}

/** Left rail (240px): brand, New Session, Projects, Recent Sessions, Settings. */
export default function Sidebar({
  projects,
  sessions,
  onNewSession,
  selectedSessionId,
  onSelectSession,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <VesselLogo />
        <span className="brand-name">Vessel</span>
      </div>

      <button type="button" className="btn btn-primary" onClick={onNewSession}>
        + New Session
      </button>

      <nav className="side-nav">
        <div className="side-label">Projects</div>
        <ul className="side-list">
          {projects.length === 0 ? (
            <li className="side-empty">暂无项目</li>
          ) : (
            projects.map((p) => (
              <li key={p.root} className="side-item" title={p.root}>
                {p.root}
              </li>
            ))
          )}
        </ul>

        <div className="side-label">Recent Sessions</div>
        <ul className="side-list">
          {sessions.length === 0 ? (
            <li className="side-empty">暂无会话</li>
          ) : (
            sessions.map((s) => (
              <li
                key={s.id}
                className={`side-item${s.id === selectedSessionId ? ' side-item-active' : ''}`}
                title={s.workspaceRoot}
                role="button"
                tabIndex={0}
                onClick={() => onSelectSession(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectSession(s.id);
                  }
                }}
              >
                {s.workspaceRoot}
              </li>
            ))
          )}
        </ul>
      </nav>

      <div className="side-footer">
        <span className="side-item">Settings</span>
      </div>
    </aside>
  );
}