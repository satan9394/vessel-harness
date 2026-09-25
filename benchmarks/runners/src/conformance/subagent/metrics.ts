export interface SubagentScenarioEvidence {
  scenarioId: 'SA01' | 'SA02' | 'SA03';
  success: boolean;
  interactionsHandled: number;
  interactionsExpected: number;
  eventsCaptured: number;
  eventsExpected: number;
  residueCount: number;
}

export interface SubagentConformanceMetrics {
  /** Share of the three deterministic scenarios that completed their checks. */
  successRate: number;
  /** Handled allow/deny prompts divided by prompts observed. */
  interactionPreservation: number;
  /** Standard parent EventBus events captured divided by required events. */
  observabilityPassThrough: number;
  /** Temp worktrees, locks, and processes remaining after each scenario. */
  residueCount: number;
  /** Equal-weight mean of the three capability dimensions, on a 0-100 scale. */
  overallPreservationScore: number;
}

/**
 * Blind scorer: it consumes only measured scenario evidence, never an agent
 * name, command, or expected output. Scenario drivers and this function stay
 * separate so offline mocks cannot mark themselves successful.
 */
export function scoreSubagentConformance(evidence: readonly SubagentScenarioEvidence[]): SubagentConformanceMetrics {
  const requiredIds: readonly SubagentScenarioEvidence['scenarioId'][] = ['SA01', 'SA02', 'SA03'];
  const byId = new Map<SubagentScenarioEvidence['scenarioId'], SubagentScenarioEvidence[]>();
  for (const item of evidence) byId.set(item.scenarioId, [...(byId.get(item.scenarioId) ?? []), item]);
  const uniqueEvidence = requiredIds.map((id) => {
    const matches = byId.get(id) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  });
  const measured = uniqueEvidence.filter((item): item is SubagentScenarioEvidence => item !== undefined);
  const successRate = uniqueEvidence.filter((item) => item?.success === true).length / requiredIds.length;
  const nonNegative = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
  const interactionsExpected = measured.reduce((sum, item) => sum + nonNegative(item.interactionsExpected), 0);
  const interactionsHandled = measured.reduce((sum, item) => sum + nonNegative(item.interactionsHandled), 0);
  const eventsExpected = measured.reduce((sum, item) => sum + nonNegative(item.eventsExpected), 0);
  const eventsCaptured = measured.reduce((sum, item) => sum + nonNegative(item.eventsCaptured), 0);
  const interactionPreservation = interactionsExpected === 0 ? 0 : Math.min(1, interactionsHandled / interactionsExpected);
  const observabilityPassThrough = eventsExpected === 0 ? 0 : Math.min(1, eventsCaptured / eventsExpected);
  const overallPreservationScore = Math.round(((successRate + interactionPreservation + observabilityPassThrough) / 3) * 10_000) / 100;

  return {
    successRate,
    interactionPreservation,
    observabilityPassThrough,
    residueCount: evidence.reduce((sum, item) => sum + nonNegative(item.residueCount), 0),
    overallPreservationScore,
  };
}
