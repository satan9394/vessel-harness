import type { ChatProvider } from '@vessel/shared';
import type { ComposeOptions } from '@vessel/application';
import { runScenario } from './runner.js';
import type { ScenarioReport } from './types.js';

export interface CandidateRun {
  /** 1-based index, matching the returned array order. */
  index: number;
  report: ScenarioReport;
}

export interface RunCandidatesOptions {
  scenarioId: string;
  /** Integer in 1..8; invalid values throw RangeError synchronously. */
  runs: number;
  repoRoot: string;
  reportsDir: string;
  policyPath: string;
  behaviorIRPath: string;
  /** Omitted or null selects runScenario's deterministic offline mock lane. */
  provider?: ChatProvider | null;
  /** Defaults to mock-model. Supply the intended model when injecting a provider. */
  model?: string;
  nativeSandbox?: ComposeOptions['nativeSandbox'];
}

/** Run candidates sequentially in independent runScenario workspaces; propagate any rejection unchanged. */
export function runCandidates(opts: RunCandidatesOptions): Promise<CandidateRun[]> {
  if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 8) {
    throw new RangeError('runs must be an integer in 1..8');
  }

  const { runs, ...scenarioOptions } = opts;
  return (async () => {
    const candidates: CandidateRun[] = [];
    for (let index = 1; index <= runs; index++) {
      const report = await runScenario({
        ...scenarioOptions,
        provider: opts.provider ?? null,
        model: opts.model ?? 'mock-model',
      });
      candidates.push({ index, report });
    }
    return candidates;
  })();
}
