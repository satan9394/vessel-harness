import { selectCandidate, type CandidateReview, type SelectionResult } from '@vessel/engine';
import type { CandidateRun } from './candidates.js';

/**
 * Reuse recorded assertions as a review, without IO or another evaluator/provider call.
 * Empty assertions are not_met; failures list at most five IDs in report order.
 * Otherwise the review is met, with pass/total counts and any skips noted separately.
 */
export function reviewFromReport(run: CandidateRun): CandidateReview {
  const { runId: candidateId, asserts } = run.report;
  if (asserts.length === 0) {
    return { candidateId, verdict: 'not_met', reason: 'no assertions recorded' };
  }
  const failed = asserts.filter(assert => assert.result === 'fail');
  if (failed.length > 0) {
    return {
      candidateId,
      verdict: 'not_met',
      reason: `failed: ${failed.slice(0, 5).map(assert => assert.id).join(', ')}${failed.length > 5 ? ' …' : ''}`,
    };
  }
  const passed = asserts.filter(assert => assert.result === 'pass').length;
  const skipped = asserts.length - passed;
  return {
    candidateId,
    verdict: 'met',
    reason: `${passed}/${asserts.length} asserts passed${skipped > 0 ? ` (${skipped} skipped)` : ''}`,
  };
}

/** Pure binding for runCandidates results; callers supply the reproducible selection seed. */
export function selectFromCandidates(runs: CandidateRun[], seed: string): SelectionResult {
  return selectCandidate({
    candidates: runs.map(({ report }) => ({
      id: report.runId,
      output: report.finalText,
      artifactPaths: [report.workspace, report.reportPath],
    })),
    reviews: runs.map(reviewFromReport),
    seed,
  });
}
