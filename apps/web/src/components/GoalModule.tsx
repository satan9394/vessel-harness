import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import { normalizeGoalTasks, sortGoalTasks, type GoalIteration, type GoalTask } from '../goal';
import GoalPanel from './GoalPanel';

interface Props {
  sessionId: string;
  api: ApiClient;
}

/**
 * Goal module (task 065) — owns the session project's Goal queue + iteration
 * replay + run control:
 *  - GET /api/goal/tasks (projectQueue filtered by this session's workspaceRoot)
 *  - GET /api/goal/tasks/:id/iterations (replay) on selection
 *  - POST /api/goal/tasks (enqueue a goal)
 *  - POST /api/goal/tasks/:id/run (trigger the 061-064 real run chain once)
 * Renders <GoalPanel>. 066 control (pause/resume/budget) stays a UI seam.
 */
export default function GoalModule({ sessionId, api }: Props) {
  const [tasks, setTasks] = useState<GoalTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [iterations, setIterations] = useState<GoalIteration[]>([]);
  const [projectRoot, setProjectRoot] = useState<string | null>(null);
  const [goal, setGoal] = useState('');
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enqueueCancelled, setEnqueueCancelled] = useState(false);

  const showError = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
  }, []);

  // Resolve this session's owning project workspace root (used to filter the
  // project task queue + attach on enqueue).
  useEffect(() => {
    let alive = true;
    void api
      .sessions()
      .then(({ sessions }) => {
        const meta = sessions.find((s) => s.id === sessionId);
        if (alive) setProjectRoot(meta?.workspaceRoot ?? null);
      })
      .catch((err) => showError(err));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, api]);

  const refreshTasks = useCallback(async () => {
    try {
      const { tasks: list } = await api.listGoalTasks(projectRoot ?? undefined);
      setTasks(sortGoalTasks(normalizeGoalTasks(list)));
    } catch (err) {
      showError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, projectRoot, showError]);

  const loadIterations = useCallback(
    async (id: string) => {
      if (!id) {
        setIterations([]);
        return;
      }
      try {
        const replay = await api.goalIterations(id);
        setIterations(replay.iterations ?? []);
      } catch (err) {
        showError(err);
      }
    },
    [api, showError],
  );

  useEffect(() => {
    setSelectedId(null);
    setIterations([]);
    setGoal('');
    setError(null);
    setEnqueueCancelled(false);
    void refreshTasks();
  }, [refreshTasks]);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      void loadIterations(id);
    },
    [loadIterations],
  );

  const enqueue = useCallback(async () => {
    const g = goal.trim();
    if (!g || busy) return;
    if (!projectRoot) {
      showError(new Error('No owning project workspace for this session'));
      return;
    }
    setBusy(true);
    setError(null);
    setEnqueueCancelled(false);
    try {
      const { task } = await api.enqueueGoal(projectRoot, g);
      setGoal('');
      await refreshTasks();
      // auto-select the fresh pending task so the user can run it immediately
      setSelectedId(task.id);
      setIterations([]);
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, projectRoot, goal, busy, refreshTasks, showError]);

  const run = useCallback(async () => {
    if (!selectedId || busy || running) return;
    setRunning(true);
    setError(null);
    setEnqueueCancelled(false);
    try {
      const result = await api.runGoalTask(selectedId);
      // refresh queue (status settled) + the fresh iteration replay
      await refreshTasks();
      if (result.result?.queueTask?.id === selectedId) {
        await loadIterations(selectedId);
      }
    } catch (err) {
      showError(err);
      setEnqueueCancelled(true);
    } finally {
      setRunning(false);
    }
  }, [api, selectedId, busy, running, refreshTasks, loadIterations, showError]);

  return (
    <div className="goal-module">
      <form
        className="goal-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void enqueue();
        }}
      >
        <input
          className="input composer-input"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="Goal… (enqueue into this project's task queue)"
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !goal.trim()}>
          {busy ? 'Adding…' : 'Enqueue'}
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
      <GoalPanel
        tasks={tasks}
        selectedId={selectedId}
        iterations={iterations}
        running={running}
        busy={busy}
        onSelect={select}
        onRun={run}
        enqueueCancelled={enqueueCancelled}
      />
      <div className="dim goal-module-hint">
        One bounded run per trigger (maxIterations / maxRetries = 1). Richer control (pause / resume / budget) lands in 066.
      </div>
    </div>
  );
}