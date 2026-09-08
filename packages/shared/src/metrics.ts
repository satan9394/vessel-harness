/**
 * @vessel/shared — session/telemetry contracts (BENCHMARK-SPEC metrics M01–M14, JSONL report shape).
 */

export type MetricId =
  | 'M01' | 'M02' | 'M03' | 'M04' | 'M05' | 'M06' | 'M07'
  | 'M08' | 'M09' | 'M10' | 'M11' | 'M12' | 'M13' | 'M14';

export interface MetricValue {
  metric: MetricId;
  name: string;
  value: number;
  unit: string;
  source: string;
  approx?: boolean;
  detail?: Record<string, unknown>;
}

/** One line of the BENCHMARK-SPEC §4.2 JSONL report. */
export type ReportLine =
  | {
      type: 'meta';
      runId: string;
      ts: string;
      scenarioId: string;
      harness: string;
      arm: string | null;
      mode: 'offline' | 'live';
      env: Record<string, unknown>;
    }
  | { type: 'metric'; runId: string; ts: string; metric: MetricId; name: string; value: number; unit: string; source: string; approx?: boolean; detail?: Record<string, unknown> }
  | { type: 'event'; runId: string; ts: string; kind: string; payload: Record<string, unknown> }
  | { type: 'assert'; runId: string; ts: string; assertId: string; assertType: string; target: string; result: 'pass' | 'fail' | 'skip'; evidence: Record<string, unknown> };

export interface ScenarioSummary {
  scenarioId: string;
  runId: string;
  success: boolean;
  metrics: Record<string, number>;
  asserts: { id: string; type: string; result: 'pass' | 'fail' | 'skip' }[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}
