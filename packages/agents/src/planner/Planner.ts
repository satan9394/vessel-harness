import type { Session } from '@vessel/core';
import type { ChatProvider } from '@vessel/shared';
import type { EvaluatorVerdict } from '../evaluator/Evaluator.js';

export interface PlanStep {
  id: string;
  description: string;
  /** acceptance criteria — drive the Evaluator for this step */
  acceptance: string[];
}

export interface Plan {
  goal: string;
  steps: PlanStep[];
  /** overall acceptance criteria for the whole task (optional) */
  acceptance?: string[];
}

export interface PlanStepResult {
  step: PlanStep;
  output: string;
  verdict: EvaluatorVerdict;
  attempts: number;
}

export interface PlanExecutionReport {
  plan: Plan;
  stepResults: PlanStepResult[];
  overallVerdict: EvaluatorVerdict['verdict'];
  overallEvidence: string[];
  reason: string;
}

export interface StepEvaluator {
  (ctx: { step: PlanStep; output: string; attempts: number }): Promise<EvaluatorVerdict>;
}

export interface ExecutePlanOptions {
  /** max attempts per step before the step is marked not_met */
  maxAttemptsPerStep?: number;
}

/** Validation — plans are first-class objects and must be well-formed (fail loud). */
export function createPlan(goal: string, steps: PlanStep[], acceptance?: string[]): Plan {
  if (!goal.trim()) throw new Error('plan error: goal is required');
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('plan error: at least one step is required');
  const ids = new Set<string>();
  for (const s of steps) {
    if (!s.id || !s.description) throw new Error('plan error: every step needs id + description');
    if (ids.has(s.id)) throw new Error(`plan error: duplicate step id "${s.id}"`);
    ids.add(s.id);
    if (!Array.isArray(s.acceptance) || s.acceptance.length === 0) {
      throw new Error(`plan error: step "${s.id}" needs ≥1 acceptance criterion`);
    }
  }
  return { goal, steps, acceptance };
}

/** Render the plan as markdown — injected into context as a user/message (source='plan'). */
export function formatPlan(plan: Plan): string {
  const lines = [`# Plan — ${plan.goal}`];
  plan.steps.forEach((s, i) => {
    lines.push(`${i + 1}. **${s.id}** — ${s.description}`);
    for (const a of s.acceptance) lines.push(`   - 验收：${a}`);
  });
  if (plan.acceptance?.length) {
    lines.push('整体验收：');
    for (const a of plan.acceptance) lines.push(`- ${a}`);
  }
  return lines.join('\n');
}

/**
 * Plan enters the context as a first-class object: appended to the session as a
 * user/message with source='plan' (B01), so it is recorded, replayable and
 * subject to compaction like any other message.
 */
export async function injectPlan(session: Session, plan: Plan): Promise<void> {
  await session.appendSync({
    type: 'user/message',
    msgId: `plan_${Date.now()}`,
    role: 'user',
    content: formatPlan(plan),
    source: 'plan',
    surface: true,
  });
}

/**
 * Plan-driven execution: each step is run through the loop; the step's
 * acceptance criteria drive an independent Evaluator (never the generator
 * self-declaring completion). not_met retries up to maxAttemptsPerStep, then
 * the step is recorded with its evidence. Overall verdict: met iff every step
 * met (and, when present, the plan-level acceptance also met).
 */
export async function executePlan(
  run: (prompt: string) => Promise<{ finalText: string }>,
  plan: Plan,
  evaluate: StepEvaluator,
  opts: ExecutePlanOptions = {},
): Promise<PlanExecutionReport> {
  const maxAttempts = opts.maxAttemptsPerStep ?? 1;
  const stepResults: PlanStepResult[] = [];
  const overallEvidence: string[] = [];

  for (const step of plan.steps) {
    let verdict: EvaluatorVerdict = { verdict: 'error', evidence: [], reason: 'no attempt' };
    let output = '';
    let attempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts = attempt;
      const turn = await run(step.description);
      output = turn.finalText;
      verdict = await evaluate({ step, output, attempts: attempt });
      if (verdict.verdict === 'met') break;
    }
    stepResults.push({ step, output, verdict, attempts });
    overallEvidence.push(`[${step.id}] ${verdict.verdict} — ${verdict.reason}`);
  }

  const allMet = stepResults.every((r) => r.verdict.verdict === 'met');
  let overall: EvaluatorVerdict['verdict'] = allMet ? 'met' : 'not_met';
  let reason = allMet
    ? `all ${stepResults.length} step(s) met acceptance`
    : `${stepResults.filter((r) => r.verdict.verdict !== 'met').length} step(s) failed acceptance`;
  if (overall === 'met' && plan.acceptance?.length) {
    // plan-level acceptance evaluated over the combined evidence
    const combined = stepResults.map((r) => r.output).join('\n---\n');
    const v = await evaluate({ step: { id: 'plan', description: plan.goal, acceptance: plan.acceptance }, output: combined, attempts: 1 });
    if (v.verdict !== 'met') {
      overall = v.verdict;
      reason = `plan-level acceptance: ${v.reason}`;
    }
    overallEvidence.push(`[plan] ${v.verdict} — ${v.reason}`);
  }

  return { plan, stepResults, overallVerdict: overall, overallEvidence, reason };
}

/**
 * Generative planner: ask the LLM for a structured plan (goal/steps/acceptance).
 * Output must parse as JSON matching the Plan shape; on parse failure the
 * caller receives a thrown error (fail loud — never a silently malformed plan).
 */
export async function generatePlan(provider: ChatProvider, model: string, goal: string): Promise<Plan> {
  const resp = await provider.chat({
    model,
    messages: [
      {
        role: 'system',
        content:
          '输出 JSON：{"goal":"...","steps":[{"id":"s1","description":"...","acceptance":["..."]}],"acceptance":["..."]}。步骤 2–6 个，每步至少 1 条可验证的验收标准。',
      },
      { role: 'user', content: `为以下目标制定计划：${goal}` },
    ],
    temperature: 0,
    requestKind: 'main',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(resp.content);
  } catch {
    throw new Error(`generatePlan: model output is not valid JSON: ${resp.content.slice(0, 200)}`);
  }
  const p = parsed as Partial<Plan>;
  if (typeof p.goal !== 'string' || !Array.isArray(p.steps)) {
    throw new Error('generatePlan: model output missing goal/steps');
  }
  const steps: PlanStep[] = (p.steps as Partial<PlanStep>[]).map((s, i) => ({
    id: typeof s.id === 'string' ? s.id : `s${i + 1}`,
    description: typeof s.description === 'string' ? s.description : String(s.description ?? ''),
    acceptance: Array.isArray(s.acceptance) ? s.acceptance.map(String) : [],
  }));
  return createPlan(p.goal, steps, Array.isArray(p.acceptance) ? p.acceptance.map(String) : undefined);
}
