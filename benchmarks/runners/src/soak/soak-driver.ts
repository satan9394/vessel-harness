/**
 * benchmarks/runners/soak — 1h soak driver for the 061-067 real run chain (task 068).
 *
 * Drives the REAL link deterministically with mock providers:
 *   ProjectTaskQueue (063) → LoopEngine (select → RealGeneratorAdapter 061 →
 *   RealEvaluatorAdapter 062 → persist=IterationStore 063 + queue.settle) →
 *   RunControl (066 budget/pause/resume interleaving) → HandoffStore (067
 *   generate + resume-from-handoff continuation), each generate attempt in an
 *   isolated TempDirWorkspaceFactory (064 — asserts zero os.tmpdir residue).
 *
 * The scenario is a planimetered multi-task queue drained over multiple "rounds":
 *   - each task takes `acceptedRounds[t]` rounds to reach met (deterministic
 *     reviewer gate); rounds before that settle not_met and the task is
 *     requeued for a new round. This forces: multi-iteration per task,
 *     workspace lifecycle under retry (064), persistence round-trip across
 *     rounds (063/066), and queue round-trip.
 *   - maxRetries=1 → a failing round burns 2 attempts, each owning a
 *     create+dispose temp workspace (worst-case 064 crush).
 *   - RunControl budget is relaxed (setBudget) intermittently and pause/resume
 *     flaps at round boundaries (066 gate).
 *   - a handoff is generated every `handoffEvery` rounds for the running task
 *     (collectHandoffMaterial from IterationStore replay + task), stored, and
 *     linked by continuationOf. At the end a fresh LoopEngine resumes from the
 *     latest handoff (handoffToTaskSeed) to prove continuation runs (067).
 *
 * Observe & return: workspace/temp residue (064), iteration/budget count
 * consistency (066), queue+iteration+handoff persistence round-trip (063/067),
 * handoff chain length, and a heapUsed time series (leak signal).
 *
 * Never touches the main workspace: all stores + temp workspaces live under
 * injected roots (os.tmpdir / a caller-provided base). This is a library module
 * usable from tests; the standalone soak entry is ./run-soak.ts.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChatProvider, ChatRequest, ChatResponse, PolicyArtifacts } from '@vessel/shared';
import { compilePolicyYaml } from '@vessel/policy';
import {
  LoopEngine,
  type LoopTask,
  type IterationResult,
  ProjectTaskQueue,
  IterationStore,
  HandoffStore,
  RunControl,
  projectQueueSelectTask,
  TempDirWorkspaceFactory,
  RealGeneratorAdapter,
  RealEvaluatorAdapter,
  collectHandoffMaterial,
  handoffToTaskSeed,
} from '@vessel/engine';

/** workspaces/temp roots the soak creates are always under this os.tmpdir prefix. */
export const SOAK_WORKSPACE_PREFIX = 'cah-068-soak-ws-';
/** store/queue/iteration/handoff roots are always under os.tmpdir() (never main workspace). */
export const SOAK_STORE_PREFIX = 'cah-068-soak-store-';

/** Per-call deterministic reviewer JSON verdicts (058 TeamReviewConclusion shape). */
export const MET_JSON = JSON.stringify({
  verdict: 'met',
  evidence: ['SOAK-068: acceptance golden present in developer output'],
  reason: '验收标准满足（SOAK-068 round gate passed）',
  unmet: [],
  suggestions: [],
});
export const NOT_MET_JSON = JSON.stringify({
  verdict: 'not_met',
  evidence: ['SOAK-068: not yet accepted (failed round gate)'],
  reason: '验收标准尚未满足（SOAK-068 round gate not passed）',
  unmet: ['src/out.ts 尚无 run 导出'],
  suggestions: ['继续下一轮迭代'],
});

/**
 * Soak config. Iteration magnitude comment: with a deterministic mock provider
 * each gen→eval attempt is ~1-3 ms; `totalRounds` fully drains the queue with
 * multi-iteration + retries. 1h of continuous real-chain stress ≈ thousands of
 * iterations; see run-soak.ts for the full-scale preset and this report for the
 * exact iteration->wall-clock conversion used.
 */
export interface SoakConfig {
  taskCount: number;
  /** how many rounds the queue is drained before forced stop (round budget). */
  totalRounds: number;
  /** per-iteration retry allowance inside a round (066 budget; default 1). */
  maxRetries?: number;
  /** per-task rounds-to-met: `(index % maxAcceptedRoundsRng) + 1`. */
  maxAcceptedRounds?: number;
  /** generate a handoff every N rounds for the running task (0 = none). */
  handoffEveryRounds?: number;
  /** pause/resume flap cadence (every N rounds; default 7). */
  pauseEveryRounds?: number;
  /** use a separate temp base for stores? (default: os.tmpdir()). */
  baseDir?: string;
  /** label for this run (report). */
  label?: string;
}

/**
 * Default soak parameters. These MUST stay coherent, or the soak silently
 * stops exercising the chain it exists to cover:
 *  - `maxAcceptedRounds` is the largest per-task rounds-to-met. The round loop
 *    exits as soon as the pending queue drains, so if `maxAcceptedRounds` is
 *    not strictly greater than `handoffEveryRounds`, every task settles before
 *    the first handoff round and 067 handoff + resume never fire (observed:
 *    the old default 3 vs handoffEvery 8 produced `handoffCount=0`,
 *    `resumeProducedIteration=false`).
 *  - `totalRounds` must be at least `pauseEveryRounds`, or 066 pause/resume
 *    never fires for the same reason.
 * `checkSoakCoherence` enforces both; `run-soak.ts` fails loud when violated.
 */
export const SOAK_DEFAULTS = {
  taskCount: 120,
  totalRounds: 30,
  maxRetries: 1,
  maxAcceptedRounds: 12,
  handoffEveryRounds: 8,
  pauseEveryRounds: 7,
} as const;

export interface SoakCoherenceInput {
  totalRounds: number;
  maxAcceptedRounds: number;
  handoffEveryRounds: number;
  pauseEveryRounds: number;
}

export interface SoakCoherence {
  ok: boolean;
  problems: string[];
}

/**
 * Whether a soak parameter set will actually exercise handoff + pause/resume.
 * A `handoffEveryRounds`/`pauseEveryRounds` of 0 means "disabled" and is allowed.
 */
export function checkSoakCoherence(p: SoakCoherenceInput): SoakCoherence {
  const problems: string[] = [];
  if (p.handoffEveryRounds > 0 && p.maxAcceptedRounds <= p.handoffEveryRounds) {
    problems.push(
      `maxAcceptedRounds (${p.maxAcceptedRounds}) must exceed handoffEveryRounds (${p.handoffEveryRounds}): ` +
        `every task settles before the first handoff round, so 067 handoff/resume never fire`,
    );
  }
  if (p.pauseEveryRounds > 0 && p.totalRounds < p.pauseEveryRounds) {
    problems.push(
      `totalRounds (${p.totalRounds}) must be at least pauseEveryRounds (${p.pauseEveryRounds}): ` +
        `066 pause/resume never fires`,
    );
  }
  return { ok: problems.length === 0, problems };
}

/** One sample of a memory / residue observation. */
export interface SoakSample {
  step: string;
  /** cumulative completed gen→eval attempts processed so far. */
  attempts: number;
  heapUsedMB: number;
  heapTotalMB: number;
  /** os.tmpdir residue entries under SOAK_WORKSPACE_PREFIX at this point. */
  wsResidue: number;
}

export interface SoakObservations {
  label: string;
  /** per-run isolated workspace prefix (hermetic residue tracking; 064). */
  wsPrefix: string;
  taskCount: number;
  totalRounds: number;
  enqueued: number;
  /** completed gen→eval attempts (generate calls) — equals engine attempt budget use. */
  attempts: number;
  /** completed admitted iterations (IterationStore entries) across all tasks. */
  iterations: number;
  /** iterations per task: taskId → ordinal count (as persisted). */
  iterationsPerTask: Record<string, number>;
  /** queue final status tallies (persistence round-trip check). */
  finalQueueStatuses: Record<string, number>;
  /** handoff records created + continuation chain length. */
  handoffCount: number;
  handoffChainLength: number;
  /** pause/resume flaps exercised (066). */
  pauseResumeCycles: number;
  /** budget raise/lower events exercised (066). */
  budgetChanges: number;
  /** `control.exhausted` snapshot at settlement (should reflect budget reason or null). */
  exhausted: unknown;
  /** os.tmpdir residue matching SOAK_WORKSPACE_PREFIX at completion (0 = clean). */
  tempResidueFinal: number;
  /** base dir residue for stores at completion (computed against a snapshot). */
  storeDirBytes: number;
  /** memory time series (leak signal). */
  samples: SoakSample[];
  heapStartMB: number;
  heapEndMB: number;
  /** round-trip: fresh store reads (063/067). */
  roundTripQueueReadable: boolean;
  roundTripIterationTasks: number;
  roundTripHandoffsReadable: boolean;
  /** 063/066 count consistency: IterationStore replay length === tracked count. */
  countConsistent: boolean;
  /** resume-from-handoff continuation proof (067). */
  resumeProducedIteration: boolean;
  resumeExtraIteration: number | null;
  durationMs: number;
  perTaskAcceptedRounds: Record<string, number>;
}

const POLICY_YAML = `
policy:
  version: 1
  profile: workspace-write
  approval: never
  filesystem:
    protected: ['.git', '.git/**']
  shell:
    deny: ['destructive-delete']
  tools:
    deny: []
  guidance:
    - 只调用显式允许的工具
`;

function policies(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

function textResponse(text: string): ChatResponse {
  return { content: text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 50, outputTokens: 20 } };
}

/** count os.tmpdir entries matching a prefix (064 leak detector). */
export function residueCount(prefix: string): number {
  let names: string[];
  try {
    names = fs.readdirSync(os.tmpdir());
  } catch {
    return 0;
  }
  return names.filter((n) => n.startsWith(prefix)).length;
}

/** parse the embedded task index from a goal string. */
function taskIndexFrom(goal: string): number {
  const m = /SOAK-068-task-(\d+)/.exec(goal);
  return m ? Number(m[1]) : -1;
}

/**
 * Deterministic developer generator provider: always returns a "satisfied"
 * developer claim (task-specific) so the reviewer is the only verdict authority.
 */
export function createDeveloperProvider(): ChatProvider {
  const id = 'soak-dev';
  const provider: ChatProvider = {
    id,
    chat: async (request: ChatRequest): Promise<ChatResponse> => {
      const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const idx = taskIndexFrom(lastUser);
      return textResponse(
        `SOAK-068 developer task-${idx}: 已完成 src/out.ts 导出 run；产出满足验收标准（golden present）。GOLDEN-068`,
      );
    },
  };
  return provider;
}

/**
 * Deterministic reviewer provider (058 verdict JSON): returns met once the
 * per-task round counter reaches its acceptedRounds, not_met otherwise. Closes
 * over the harness's `roundCounter` map so multi-round requeue is deterministic.
 */
export interface GatedReviewerShared {
  roundCounter: Map<number, number>;
  acceptedRounds: Map<number, number>;
}
export function createReviewerProvider(shared: GatedReviewerShared): ChatProvider {
  const id = 'soak-rev';
  const provider: ChatProvider = {
    id,
    chat: async (request: ChatRequest): Promise<ChatResponse> => {
      const lastUser = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
      const idx = taskIndexFrom(lastUser);
      const round = shared.roundCounter.get(idx) ?? 1;
      const need = shared.acceptedRounds.get(idx) ?? 1;
      return textResponse(round >= need ? MET_JSON : NOT_MET_JSON);
    },
  };
  return provider;
}

/**
 * Run the soak once (one process). Writes store/iteration/handoff roots under
 * `base`. Returns observations. Deterministic for a given config+seed.
 */
export async function runSoak(cfg: SoakConfig): Promise<SoakObservations> {
  const label = cfg.label ?? 'soak-068';
  const maxRetries = cfg.maxRetries ?? 1;
  const maxAccepted = cfg.maxAcceptedRounds ?? 3;
  const handoffEvery = cfg.handoffEveryRounds ?? 5;
  const pauseEvery = cfg.pauseEveryRounds ?? 7;
  const base = path.resolve(cfg.baseDir ?? os.tmpdir());
  const startedAtMs = Date.now();

  // --- isolated roots (never main workspace): stores live under `base`. ---
  const queueRoot = fs.mkdtempSync(path.join(base, 'cah-068-q-'));
  const iterRoot = fs.mkdtempSync(path.join(base, 'cah-068-i-'));
  const hoRoot = fs.mkdtempSync(path.join(base, 'cah-068-h-'));
  const queue = new ProjectTaskQueue({ tasksRoot: queueRoot });
  const iterations = new IterationStore({ iterationsRoot: iterRoot });
  const handoffs = new HandoffStore({ handoffsRoot: hoRoot });

  const projectRoot = fs.mkdtempSync(path.join(base, 'cah-068-project-'));

  // --- enqueue tasks (deterministic rounds-to-met). ---
  const acceptedRounds = new Map<number, number>();
  const enqueued: LoopTask[] = [];
  const goalById = new Map<string, string>();
  const acceptanceById = new Map<string, string[]>();
  for (let i = 0; i < cfg.taskCount; i += 1) {
    const rounds = (i % maxAccepted) + 1;
    acceptedRounds.set(i, rounds);
    const goal = `SOAK-068-task-${i}: 实现导出模块并补测试`;
    const acceptance = [`SOAK-068-task-${i}: src/out.ts 导出 run`];
    const t = queue.enqueue({ projectRoot, goal, acceptance });
    enqueued.push({ id: t.id, goal, acceptance });
    goalById.set(t.id, goal);
    acceptanceById.set(t.id, acceptance);
  }

  // --- deterministic providers + real adapters. ---
  const roundCounter = new Map<number, number>();
  const gated = { roundCounter, acceptedRounds };
  const devProvider = createDeveloperProvider();
  const revProvider = createReviewerProvider(gated);
  const artifacts = policies();
  const generator = new RealGeneratorAdapter({
    providers: { dev: devProvider },
    policyArtifacts: artifacts,
    tools: [],
    developerProviderId: 'dev',
    developerModel: 'soak-model',
  });
  const evaluator = new RealEvaluatorAdapter({
    providers: { rev: revProvider },
    policyArtifacts: artifacts,
    reviewerProviderId: 'rev',
    reviewerModel: 'soak-model',
  });

  // --- control + workspace factory. Per-run isolated workspace prefix: residue
  // tracking (064) counts only THIS run's workspaces, so concurrent soaks / tests
  // (e.g. vitest running while a background soak runs) never cross-contaminate.
  const control = new RunControl({ maxIterations: 1, maxRetries });
  const wsPrefix = `${SOAK_WORKSPACE_PREFIX}${process.pid}-${Math.random().toString(36).slice(2, 8)}-`;
  const wsFactory = new TempDirWorkspaceFactory(wsPrefix);

  // trackers
  const iterationsPerTask: Record<string, number> = {};
  let attempts = 0;
  let pauseResumeCycles = 0;
  let budgetChanges = 0;
  let latestHandoffByTask = new Map<string, string>();
  let handoffCount = 0;
  const samples: SoakSample[] = [];
  const takeSample = (step: string): void => {
    const mem = process.memoryUsage();
    samples.push({
      step,
      attempts,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      heapTotalMB: Math.round((mem.heapTotal / 1024 / 1024) * 10) / 10,
      wsResidue: residueCount(wsPrefix),
    });
  };
  takeSample('start');

  // persist seam: append engine result to IterationStore + settle the queue task.
  const persist = async (result: IterationResult): Promise<void> => {
    const goal = goalById.get(result.taskId) ?? result.taskId;
    const acceptance = acceptanceById.get(result.taskId);
    iterations.appendEngineResult(
      { taskId: result.taskId, goal, acceptance, projectRoot },
      result,
    );
    iterationsPerTask[result.taskId] = (iterationsPerTask[result.taskId] ?? 0) + 1;
    queue.settle(result.taskId, result.verdict, { reason: result.reason, iteration: result.iteration });
  };

  // engine drive
  let shouldContinue = false;
  const engine = new LoopEngine(
    {
      selectTask: projectQueueSelectTask(queue, { projectRoot }),
      generate: async (ctx) => {
        attempts += 1;
        return generator.generate(ctx);
      },
      evaluate: (ctx) => evaluator.evaluate(ctx),
      persist,
      shouldContinue: async () => shouldContinue,
      workspaceFactory: (t) => wsFactory.create(t),
      disposeWorkspace: (ws) => wsFactory.dispose(ws),
    },
    { control },
  );

  // --- drive rounds. One round = one full pass over the pending queue. ---
  let round = 0;
  while (round < cfg.totalRounds) {
    round += 1;
    const pending = queue.list({ projectRoot, status: 'pending' }).length;
    if (pending === 0) break;

    // increment each pending task's round counter (drives the reviewer gate:
    // a task becomes met once its round counter reaches its acceptedRounds).
    for (const t of queue.list({ projectRoot, status: 'pending' })) {
      const idx = taskIndexFrom(t.goal);
      if (idx >= 0) roundCounter.set(idx, (roundCounter.get(idx) ?? 0) + 1);
    }

    // budget relaxation (066): Goal/Loop mode relaxes maxIterations to the
    // round's pending count so ONE run() drains the whole queue pass; then we
    // tighten back to the default 1/1. This exercises live setBudget + the
    // budget gate at every round boundary.
    shouldContinue = true;
    control.setBudget({ maxIterations: Math.max(1, pending), maxRetries });
    budgetChanges += 1;

    // pause/resume flap (066): arm the gate BEFORE the run so the engine's
    // first boundary genuinely awaits it; resume fires mid-run after 5ms.
    const flap = pauseEvery > 0 && round % pauseEvery === 0;
    if (flap) {
      control.pause();
      pauseResumeCycles += 1;
    }
    const resumeTimer = flap ? setTimeout(() => control.resume(), 5) : null;

    await engine.run(); // full queue pass (each pending task: 1 iteration + retries)

    if (resumeTimer) clearTimeout(resumeTimer);
    shouldContinue = false;
    control.setBudget({ maxIterations: 1, maxRetries });
    budgetChanges += 1;

    // requeue not_met tasks to open their next round (063 requeue / 066 budget policy).
    for (const t of queue.list({ projectRoot, status: 'not_met' })) {
      queue.requeue(t.id);
    }

    // handoff generation (067): every `handoffEvery` rounds, snapshot the
    // running (currently in-progress or just-settled) task's progress.
    if (handoffEvery > 0 && round % handoffEvery === 0) {
      const tasks = queue.list({ projectRoot });
      for (const t of tasks) {
        if (t.status === 'met') continue;
        const replay = iterations.replay(t.id);
        if (replay.length === 0) continue;
        const material = collectHandoffMaterial({
          task: t,
          iterations: replay,
          snapshot: { currentState: `soak round ${round}`, evidence: ['SOAK-068 handoff'] },
        });
        const prev = latestHandoffByTask.get(t.id);
        const ho = handoffs.create(material, { continuationOf: prev });
        latestHandoffByTask.set(t.id, ho.id);
        handoffCount += 1;
      }
    }

    if (round % 5 === 0 || round === cfg.totalRounds) takeSample(`round-${round}`);
  }

  takeSample('end');

  // --- 066 budget semantics: capture control exhausted snapshot. ---
  const exhausted = control.state();

  // --- 063 persistence round-trip: read via FRESH store instances. ---
  const qFresh = new ProjectTaskQueue({ tasksRoot: queueRoot });
  const iFresh = new IterationStore({ iterationsRoot: iterRoot });
  const hFresh = new HandoffStore({ handoffsRoot: hoRoot });
  const freshQueue = qFresh.list({ projectRoot });
  const finalStatuses: Record<string, number> = {};
  for (const t of freshQueue) finalStatuses[t.status] = (finalStatuses[t.status] ?? 0) + 1;
  const roundTripIterationTasks = iFresh.list().length;
  const latestHandoff = hFresh.latest();
  const roundTripHandoffs = hFresh.list();

  // --- 063/066 count consistency: IterationStore replay length === tracked
  // per-task iteration count (persistence didn't lose/duplicate any entry). ---
  let countConsistent = true;
  for (const task of freshQueue) {
    const replayLen = iFresh.replay(task.id).length;
    if (replayLen !== (iterationsPerTask[task.id] ?? 0)) {
      countConsistent = false;
      break;
    }
  }

  // --- 067 resume-from-handoff continuation: run a fresh engine from the seed. ---
  let resumeProducedIteration = false;
  let resumeExtraIteration: number | null = null;
  if (latestHandoff) {
    const seed = handoffToTaskSeed(latestHandoff);
    const seedTask: LoopTask = { id: seed.id, goal: seed.goal, acceptance: seed.acceptance };
    if (!goalById.has(seed.id)) {
      goalById.set(seed.id, seed.goal);
      acceptanceById.set(seed.id, [...seed.acceptance]);
    }
    const before = iterations.replay(seed.id).length;
    // continuation persist: seed task is already terminal/pending in the queue,
    // so we only append the IterationStore record (proving a resume-run leaves a
    // trace) — never re-settle the queue (it would be an illegal state transfer).
    const contPersist = async (result: IterationResult): Promise<void> => {
      const goal = goalById.get(result.taskId) ?? result.taskId;
      const acceptance = acceptanceById.get(result.taskId);
      iterations.appendEngineResult({ taskId: result.taskId, goal, acceptance, projectRoot }, result);
      iterationsPerTask[result.taskId] = (iterationsPerTask[result.taskId] ?? 0) + 1;
    };
    const contEngine = new LoopEngine(
      {
        selectTask: async () => seedTask,
        generate: async (ctx) => {
          attempts += 1;
          return generator.generate(ctx);
        },
        evaluate: (ctx) => evaluator.evaluate(ctx),
        persist: contPersist,
        workspaceFactory: (t) => wsFactory.create(t),
        disposeWorkspace: (ws) => wsFactory.dispose(ws),
      },
      { maxIterations: 1, maxRetries },
    );
    const contReport = await contEngine.run();
    const after = iterations.replay(seed.id).length;
    resumeProducedIteration = Boolean(contReport) && after > before;
    resumeExtraIteration = after - before;
  }

  // 067 handoff chain length (continuationOf walkback from latest).
  let handoffChainLength = 0;
  let cursor = latestHandoff?.id;
  const idToRecord = new Map(roundTripHandoffs.map((h) => [h.id, h]));
  while (cursor && idToRecord.has(cursor)) {
    handoffChainLength += 1;
    cursor = idToRecord.get(cursor)?.continuationOf;
  }

  // 064 temp residue: zero workspace dirs left under THIS run's prefix.
  const tempResidueFinal = residueCount(wsPrefix);

  // report size of store dirs (drifted?).
  let storeDirBytes = 0;
  const addBytes = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) addBytes(p);
      else storeDirBytes += fs.statSync(p).size;
    }
  };
  addBytes(queueRoot);
  addBytes(iterRoot);
  addBytes(hoRoot);

  const heapStartMB = samples[0]?.heapUsedMB ?? 0;
  const heapEndMB = process.memoryUsage().heapUsed / 1024 / 1024;

  return {
    label,
    wsPrefix,
    taskCount: cfg.taskCount,
    totalRounds: cfg.totalRounds,
    enqueued: enqueued.length,
    attempts,
    iterations: iterationsPerTask ? Object.values(iterationsPerTask).reduce((a, b) => a + b, 0) : 0,
    iterationsPerTask,
    finalQueueStatuses: finalStatuses,
    handoffCount,
    handoffChainLength,
    pauseResumeCycles,
    budgetChanges,
    exhausted,
    tempResidueFinal,
    storeDirBytes: Math.round(storeDirBytes / 1024),
    samples,
    heapStartMB,
    heapEndMB: Math.round(heapEndMB * 10) / 10,
    roundTripQueueReadable: freshQueue.length === cfg.taskCount,
    roundTripIterationTasks,
    roundTripHandoffsReadable: roundTripHandoffs.length === handoffCount,
    countConsistent,
    resumeProducedIteration,
    resumeExtraIteration,
    durationMs: Date.now() - startedAtMs,
    perTaskAcceptedRounds: Object.fromEntries([...acceptedRounds.entries()].map(([k, v]) => [`task-${k}`, v])),
  };
}