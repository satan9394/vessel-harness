import type { ChatProvider } from '@vessel/shared';

export type EvaluatorVerdictKind = 'met' | 'not_met' | 'impossible' | 'error';

export interface EvaluatorVerdict {
  verdict: EvaluatorVerdictKind;
  /** evidence references (transcript lines / disk paths / metrics) */
  evidence: string[];
  reason: string;
}

export interface SessionEvidence {
  transcript: string;
  finalAssistantText: string;
  metrics?: Record<string, number>;
  /** optional disk-evidence check (read-only) */
  diskCheck?: (predicate: (p: string) => boolean) => Promise<boolean>;
}

/**
 * Evaluator contract (ARCHITECTURE §4.10 / D3 decision point 12).
 * Evaluator is NOT a new primitive — an independent LLM call (requestKind=goal-eval)
 * over transcript + read-only disk evidence; verdict met/not_met/impossible/error.
 * Generator must never self-declare completion (Generator/Evaluator separation).
 */
export interface Evaluator {
  evaluate(evidence: SessionEvidence): Promise<EvaluatorVerdict>;
}

/** Deterministic evaluator for offline lanes: golden substrings in final text. */
export class DeterministicEvaluator implements Evaluator {
  constructor(
    private readonly golden: string[],
    private readonly opts: { caseSensitive?: boolean } = {},
  ) {}

  async evaluate(evidence: SessionEvidence): Promise<EvaluatorVerdict> {
    const haystack = this.opts.caseSensitive ? evidence.finalAssistantText : evidence.finalAssistantText.toLowerCase();
    const missing = this.golden.filter((g) => {
      const needle = this.opts.caseSensitive ? g : g.toLowerCase();
      return !haystack.includes(needle);
    });
    if (missing.length === 0) {
      return { verdict: 'met', evidence: [...this.golden], reason: 'final assistant text contains all golden substrings' };
    }
    return {
      verdict: 'not_met',
      evidence: [`missing: ${missing.join(', ')}`],
      reason: `final assistant text misses ${missing.length} golden substring(s)`,
    };
  }
}

/** Independent-LLM evaluator (requestKind=goal-eval) over the transcript. */
export class LLEvaluator implements Evaluator {
  constructor(
    private readonly provider: ChatProvider,
    private readonly model: string,
    private readonly goal: string,
  ) {}

  async evaluate(evidence: SessionEvidence): Promise<EvaluatorVerdict> {
    const prompt = [
      `你是独立 Evaluator。目标：${this.goal}`,
      '',
      '只依据以下证据判定，不自证、不猜测：',
      `最终回复：\n${evidence.finalAssistantText.slice(0, 4000)}`,
      '',
      '判定为 met / not_met / impossible / error 之一，并给出一条 reason。',
    ].join('\n');
    try {
      const resp = await this.provider.chat({
        model: this.model,
        messages: [
          { role: 'system', content: '输出 JSON：{"verdict":"met|not_met|impossible|error","reason":"..."}' },
          { role: 'user', content: prompt },
        ],
        temperature: 0,
        requestKind: 'goal-eval',
      });
      const parsed = JSON.parse(resp.content) as { verdict?: EvaluatorVerdictKind; reason?: string };
      const verdict = parsed.verdict ?? 'error';
      return {
        verdict,
        evidence: ['goal-eval LLM verdict'],
        reason: parsed.reason ?? resp.content.slice(0, 300),
      };
    } catch (err) {
      return { verdict: 'error', evidence: [], reason: `evaluator call failed: ${(err as Error).message}` };
    }
  }
}
