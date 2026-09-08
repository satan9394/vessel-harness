import { useState } from 'react';
import type { ApiClient } from '../api';

export interface NewSessionResult {
  sessionId: string;
  projectRoot: string;
}

interface Props {
  api: ApiClient;
  onCreated: (result: NewSessionResult) => void;
  onClose: () => void;
}

/** New Session flow: prompt workspaceRoot → open project → create session. */
export default function NewSessionForm({ api, onCreated, onClose }: Props) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ws = value.trim();
    if (!ws) return;
    setBusy(true);
    setError(null);
    try {
      await api.openProject(ws);
      const { session } = await api.createSession({ workspaceRoot: ws });
      onCreated({ sessionId: session.id, projectRoot: session.workspaceRoot });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="overlay" role="dialog" aria-label="新建会话">
      <form className="modal" onSubmit={submit}>
        <h3>New Session</h3>
        <label className="field-label" htmlFor="workspaceRoot">
          workspaceRoot
        </label>
        <input
          id="workspaceRoot"
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="/path/to/project"
          autoFocus
        />
        {error && <div className="error-text">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !value.trim()}>
            {busy ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}