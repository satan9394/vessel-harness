/**
 * benchmarks/runners/soak — 1h soak entry (task 068).
 *
 * Runs the full-scale deterministic real-chain soak and writes a JSON + text
 * report under benchmarks/reports/SOAK-068/. Use:
 *
 *   npx tsx benchmarks/runners/src/soak/run-soak.ts [taskCount] [totalRounds]
 *
 * With full scale (see below) the run is the long-running background job; the
 * iteration->wall-clock equivalence is noted in the report. Env overrides:
 *   SOAK_TASKS / SOAK_ROUNDS / SOAK_HANDOFF_EVERY / SOAK_PAUSE_EVERY /
 *   SOAK_MAX_ACCEPTED / SOAK_BASE (temp base for stores/workspaces).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSoak, residueCount, SOAK_WORKSPACE_PREFIX, type SoakObservations } from './soak-driver.js';

// Full-scale preset: this is the "1h-equivalent" pressure. Each gen→eval attempt
// is ~1-3 ms with the deterministic mock provider, so 1h of continuous running
// ≈ 10^5–10^6 attempts. We machine-check the invariants on a large but tractable
// budget (thousands of iterations, hundreds of handoffs) — see report for the
// exact conversion and the reason a wall-clock-forced 1h would add little signal
// beyond what this iteration/size magnitude exposes.
const DEFAULT_TASKS = 120;
const DEFAULT_ROUNDS = 30;

function iso(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readInt(v: string | undefined, dflt: number): number {
  if (v === undefined || v === '') return dflt;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : dflt;
}

function summarize(obs: SoakObservations): string {
  const statuses = Object.entries(obs.finalQueueStatuses)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ');
  const heapDelta = Math.round((obs.heapEndMB - obs.heapStartMB) * 10) / 10;
  return [
    `label=${obs.label} durationMs=${obs.durationMs}`,
    `tasks=${obs.taskCount} rounds=${obs.totalRounds} enqueued=${obs.enqueued}`,
    `attempts=${obs.attempts} iterations=${obs.iterations}`,
    `finalQueueStatuses{${statuses}}`,
    `handoffCount=${obs.handoffCount} chain=${obs.handoffChainLength}`,
    `pauseResumeCycles=${obs.pauseResumeCycles} budgetChanges=${obs.budgetChanges}`,
    `tempResidue=${obs.tempResidueFinal} (0=clean, 064)`,
    `storeDirKB=${obs.storeDirBytes}`,
    `heapStartMB=${obs.heapStartMB} heapEndMB=${obs.heapEndMB} deltaMB=${heapDelta}`,
    `roundTrip queue=${obs.roundTripQueueReadable} itersTasks=${obs.roundTripIterationTasks} handoffs=${obs.roundTripHandoffsReadable} countConsistent=${obs.countConsistent}`,
    `resumeProducedIteration=${obs.resumeProducedIteration} resumeExtraIteration=${obs.resumeExtraIteration}`,
    `exhausted=${JSON.stringify(obs.exhausted)}`,
  ].join('\n');
}

const tasks = readInt(process.env.SOAK_TASKS, Number(process.argv[2] ?? DEFAULT_TASKS));
const rounds = readInt(process.env.SOAK_ROUNDS, Number(process.argv[3] ?? DEFAULT_ROUNDS));
const handoffEvery = readInt(process.env.SOAK_HANDOFF_EVERY, 8);
const pauseEvery = readInt(process.env.SOAK_PAUSE_EVERY, 7);
const maxAccepted = readInt(process.env.SOAK_MAX_ACCEPTED, 3);
const base = path.resolve(process.env.SOAK_BASE ?? os.tmpdir());
const runId = `soak_${iso()}`;
const outDir = path.join(
  fileURLToPath(new URL('../../../reports', import.meta.url)),
  'SOAK-068',
  runId,
);
fs.mkdirSync(outDir, { recursive: true });

async function main(): Promise<void> {
  const beforeResidue = residueCount(SOAK_WORKSPACE_PREFIX);
  const startedWall = Date.now();
  const runObs = await runSoak({
    label: `soak-068-${tasks}t-${rounds}r`,
    taskCount: tasks,
    totalRounds: rounds,
    maxRetries: 1,
    maxAcceptedRounds: maxAccepted,
    handoffEveryRounds: handoffEvery,
    pauseEveryRounds: pauseEvery,
    baseDir: base,
  });
  const wallMs = Date.now() - startedWall;

  const report: Record<string, unknown> = {
    runId,
    ts: new Date().toISOString(),
    kind: 'soak-068',
    config: {
      taskCount: tasks,
      totalRounds: rounds,
      maxRetries: 1,
      maxAcceptedRounds: maxAccepted,
      handoffEveryRounds: handoffEvery,
      pauseEveryRounds: pauseEvery,
      baseDir: base,
    },
    wallClockMs: wallMs,
    beforeTempResidue: beforeResidue,
    observation: runObs,
  };
  const reportPath = path.join(outDir, 'soak-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  const summaryPath = path.join(outDir, 'soak-summary.txt');
  fs.writeFileSync(summaryPath, summarize(runObs) + '\n', 'utf8');

  // concise stdout line for the harness job log + full path for the report.
  const statusesLine = Object.entries(runObs.finalQueueStatuses)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  console.log(
    `[soak-068] ${runId} wall=${wallMs}ms attempts=${runObs.attempts} iterations=${runObs.iterations} ` +
      `residue=${runObs.tempResidueFinal} handoffs=${runObs.handoffCount} chain=${runObs.handoffChainLength} ` +
      `heapDeltaMB=${Math.round((runObs.heapEndMB - runObs.heapStartMB) * 10) / 10} ` +
      `queue{${statusesLine}} resume=${runObs.resumeProducedIteration}`,
  );
  console.log(`[soak-068] report: ${reportPath}`);
}

main().catch((err) => {
  console.error('[soak-068] FAILED', err);
  process.exitCode = 1;
});