import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api';
import {
  normalizeGoalTasks,
  sortGoalTasks,
  type GoalBudget,
  type GoalIteration,
  type GoalTask,
} from '../goal';
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
 *  - POST /api/goal/tasks/:id/pause|resume — 066 run control (suspend/continue)
 *  - GET/POST /api/goal/tasks/:id/budget — 066 iteration/retry budget (§11.1 1/1)
 * Renders <GoalPanel>.
 */
export default function GoalModule({ sessionId, api }: Props) {
  const [tasks, setTasks] = useState<GoalTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [iterations, setIterations] = useState<GoalIteration[]>([]);
  const [budget, setBudget] = useState<GoalBudget | null>(null);
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
      setBudget(null);
      void loadIterations(id);
      void api
        .getGoalBudget(id)
        .then(({ budget: b }) => {
          setBudget(b);
        })
        .catch(() => {
          // budget query is best-effort; a non-live task still shows defaults
        });
    },
    [api, loadIterations],
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

  /** task 066: suspend the selected task's live run (not an abort). */
  const pause = useCallback(async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.pauseGoalTask(selectedId);
      await refreshTasks();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, selectedId, busy, refreshTasks, showError]);

  /** task 066: continue a paused run from the same boundary. */
  const resume = useCallback(async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.resumeGoalTask(selectedId);
      await refreshTasks();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, selectedId, busy, refreshTasks, showError]);

  /**
   * task 066: budget control — bump §11.1 default 1/1 caps (Goal/Loop mode relax).
   * Reads the current budget, then writes maxIterations+1 / maxRetries+1 so the
   * button is a simple "more budget" pivot from the UI-selected defaults.
   */
  const budgetStep = useCallback(async () => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const current = await api.getGoalBudget(selectedId);
      const next = {
        maxIterations: (current.budget?.maxIterations ?? 1) + 1,
        maxRetries: (current.budget?.maxRetries ?? 1) + 1,
      };
      const { budget: b } = await api.setGoalBudget(selectedId, next);
      setBudget(b);
      await refreshTasks();
    } catch (err) {
      showError(err);
    } finally {
      setBusy(false);
    }
  }, [api, selectedId, busy, refreshTasks, showError]);

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
        onPause={pause}
        onResume={resume}
        onBudget={budgetStep}
        budget={budget ?? undefined}
        enqueueCancelled={enqueueCancelled}
      />
      <div className="dim goal-module-hint">
        Run control: Pause suspends, Resume continues; Budget sets maxIterations/maxRetries (§11.1 default 1/1).
      </div>
    </div>
  );
}