export interface ResilienceEvidence {
  rounds: Array<{ round: number; facts: Record<string, string>; completed: boolean }>;
  expectedRecordHashes: string[];
  replayedRecordHashes: string[];
  replayedSequences: number[];
  injectedTokens: number;
  overflowInterceptedCount: number;
  overflowAttempts: number;
  pressureCompactions: number;
  mcpCleanupMs: number;
  reopenCount: number;
  orphanProcessCount: number;
  workspaceResidueCount: number;
}

export interface ResilienceExpectation { rounds: number; facts: Readonly<Record<string, string>> }

/** Blind evaluator: no provider identity, source command, or self-reported score. */
export function scoreLongSessionResilience(evidence: ResilienceEvidence, expected: ResilienceExpectation) {
  if (!Number.isSafeInteger(expected.rounds) || expected.rounds < 1 || Object.keys(expected.facts).length === 0) throw new Error('Empty resilience expectation');
  let completed = 0;
  let factsPreserved = 0;
  for (let round = 1; round <= expected.rounds; round++) {
    const entries = evidence.rounds.filter(item => item.round === round);
    if (entries.length !== 1) continue;
    const item = entries[0]!;
    if (item.completed) completed++;
    for (const [key, value] of Object.entries(expected.facts)) if (item.facts[key] === value) factsPreserved++;
  }
  const expectedCount = evidence.expectedRecordHashes.length;
  const matched = evidence.expectedRecordHashes.filter((hash, i) =>
    evidence.replayedRecordHashes[i] === hash && evidence.replayedSequences[i] === i + 1).length;
  const dataIntegrityRate = expectedCount === 0 ? 0 : matched / Math.max(expectedCount, evidence.replayedRecordHashes.length, evidence.replayedSequences.length) * 100;
  const recoveryChecks = [evidence.overflowInterceptedCount === 1 && evidence.overflowAttempts === 2,
    Number.isFinite(evidence.mcpCleanupMs) && evidence.mcpCleanupMs >= 0 && evidence.mcpCleanupMs <= 2000,
    evidence.reopenCount === 1 && dataIntegrityRate === 100];
  const completionRate = completed / expected.rounds * 100;
  const factPreservationRate = factsPreserved / (expected.rounds * Object.keys(expected.facts).length) * 100;
  const recoveryRate = recoveryChecks.filter(Boolean).length / recoveryChecks.length * 100;
  const overallPreservationScore = (completionRate + factPreservationRate + recoveryRate) / 3;
  return {
    completionRate, factPreservationRate, recoveryRate, dataIntegrityRate, overallPreservationScore,
    rounds: evidence.rounds.length, injectedTokens: evidence.injectedTokens,
    orphanProcessCount: evidence.orphanProcessCount, workspaceResidueCount: evidence.workspaceResidueCount,
    passed: evidence.rounds.length === expected.rounds && evidence.rounds.every(item => Number.isSafeInteger(item.round) && item.round >= 1 && item.round <= expected.rounds)
      && overallPreservationScore >= 90 && dataIntegrityRate === 100 && recoveryRate === 100
      && evidence.injectedTokens >= 500_000 && evidence.pressureCompactions > 0
      && evidence.orphanProcessCount === 0 && evidence.workspaceResidueCount === 0,
  };
}
