import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect } from 'vitest';
import { runSoak, residueCount, SOAK_WORKSPACE_PREFIX } from './soak-driver.js';
/**
 * benchmarks/soak — deterministic fast regression for the 1h soak driver (task 068).
 *
 * Small config, but exercises the SAME invariants the full-scale soak asserts:
 * workspace/temp residue (064), iteration/budget count consistency (066),
 * queue+iteration+handoff persistence round-trip (063/067), and resume-from-
 * handoff continuation (067). Deterministic against the mock gate. Fast enough
 * for the root vitest suite.
 */
describe('benchmarks/soak — soak driver invariants (task 068)', () => {
  it('full real-chain soak (multi-round + retry + pause/resume + handoff) stays consistent', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-068-test-base-'));
    try {
      const obs = await runSoak({
        label: 'test-small',
        taskCount: 6,
        totalRounds: 4,
        maxRetries: 1,
        maxAcceptedRounds: 3,
        handoffEveryRounds: 2,
        pauseEveryRounds: 2,
        baseDir: base,
      });

      // 064: zero workspace/temp residue after the soak. Hermetic: count only
      // THIS run's unique workspace prefix (concurrent soaks/tests never bleed in).
      expect(obs.tempResidueFinal).toBe(0);
      expect(residueCount(obs.wsPrefix)).toBe(0);
      expect(residueCount(obs.wsPrefix)).toBeLessThanOrEqual(residueCount(SOAK_WORKSPACE_PREFIX));

      // every task was enqueued + the queue round-trips via a fresh store.
      expect(obs.enqueued).toBe(6);
      expect(obs.roundTripQueueReadable).toBe(true);
      expect(obs.finalQueueStatuses).toBeDefined();
      // all iterations persisted are > 0 and match the per-task map.
      expect(obs.iterations).toBeGreaterThanOrEqual(6);
      for (const [id, n] of Object.entries(obs.iterationsPerTask)) {
        expect(n).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(n)).toBe(true);
        void id;
      }

      // 066: budget/pause interleaving actually ran.
      expect(obs.pauseResumeCycles).toBeGreaterThan(0);
      expect(obs.budgetChanges).toBeGreaterThanOrEqual(1);

      // attempts >= iterations (retries can add attempts for a task).
      expect(obs.attempts).toBeGreaterThanOrEqual(obs.iterations);

      // 063/067: iteration store round-trips; handoffs readable.
      expect(obs.roundTripIterationTasks).toBeGreaterThanOrEqual(1);
      expect(obs.handoffCount).toBeGreaterThanOrEqual(1);
      expect(obs.roundTripHandoffsReadable).toBe(true);
      expect(obs.handoffChainLength).toBeGreaterThanOrEqual(1);
      // 063/066: IterationStore replay length matches tracked per-task count.
      expect(obs.countConsistent).toBe(true);

      // 067: resume-from-handoff produced at least one extra iteration.
      expect(obs.resumeProducedIteration).toBe(true);
      expect(obs.resumeExtraIteration).toBeGreaterThanOrEqual(1);

      // bounded run (non-zero duration, sane memory sample bookends).
      expect(obs.durationMs).toBeGreaterThan(0);
      expect(obs.heapStartMB).toBeGreaterThan(0);
      expect(obs.heapEndMB).toBeGreaterThan(0);
      expect(obs.samples.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });

  it('workspace residue stays zero at every round boundary sampled (064 pressure)', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-068-test-base2-'));
    try {
      const obs = await runSoak({
        label: 'test-residue',
        taskCount: 4,
        totalRounds: 3,
        maxRetries: 1,
        maxAcceptedRounds: 2,
        handoffEveryRounds: 1,
        baseDir: base,
      });
      // every sampled boundary (round-N) recorded zero residue.
      for (const s of obs.samples) {
        expect(s.wsResidue).toBe(0);
      }
      expect(obs.tempResidueFinal).toBe(0);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  });
});