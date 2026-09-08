import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Session } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { createPlan, executePlan, formatPlan, generatePlan, injectPlan, type Plan, type StepEvaluator } from './Planner.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-planner-'));
}

describe('V0.2-M2 planner — plans are first-class objects', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('createPlan validates structure (fail loud)', () => {
    expect(() => createPlan('', [{ id: 's1', description: 'd', acceptance: ['a'] }])).toThrow(/goal/);
    expect(() => createPlan('goal', [])).toThrow(/step/);
    expect(() => createPlan('goal', [{ id: 's1', description: 'd', acceptance: [] }])).toThrow(/acceptance/);
    expect(() =>
      createPlan('goal', [
        { id: 's1', description: 'd', acceptance: ['a'] },
        { id: 's1', description: 'd2', acceptance: ['b'] },
      ]),
    ).toThrow(/duplicate/);
    const ok = createPlan('goal', [{ id: 's1', description: 'd', acceptance: ['a'] }]);
    expect(ok.goal).toBe('goal');
  });

  it('formatPlan renders goal, steps and acceptance criteria', () => {
    const plan = createPlan('重构模块', [
      { id: 's1', description: '拆出 util 模块', acceptance: ['src/util.js 存在', '导出 parse()'] },
      { id: 's2', description: '迁移调用点', acceptance: ['grep 零残留 oldName'] },
    ]);
    const text = formatPlan(plan);
    expect(text).toContain('# Plan — 重构模块');
    expect(text).toContain('s1');
    expect(text).toContain('验收：src/util.js 存在');
    expect(text).toContain('s2');
  });

  it('injectPlan writes the plan into the session as source=plan (replayable)', async () => {
    const session = await Session.open({ workspaceRoot: workspace, sessionId: 'plan-sess' });
    const plan = createPlan('g', [{ id: 's1', description: 'd', acceptance: ['a1'] }]);
    await injectPlan(session, plan);
    const recs = session.replay().filter((r) => r.type === 'user/message');
    expect(recs).toHaveLength(1);
    const rec = recs[0] as { source?: string; content: string };
    expect(rec.source).toBe('plan');
    expect(rec.content).toContain('# Plan');
    await session.close();
  });

  it('executePlan drives steps through the loop and evaluates acceptance independently', async () => {
    const plan: Plan = createPlan('g', [
      { id: 's1', description: 'step one', acceptance: ['GOLDEN-1'] },
      { id: 's2', description: 'step two', acceptance: ['GOLDEN-2'] },
    ]);
    const outputs: string[] = [];
    const run = async (prompt: string) => {
      outputs.push(prompt);
      return { finalText: prompt.includes('step one') ? 'GOLDEN-1 done' : 'GOLDEN-2 done' };
    };
    const evaluate: StepEvaluator = async ({ step, output }) => ({
      verdict: output.includes(step.acceptance[0]!) ? 'met' : 'not_met',
      evidence: [output],
      reason: output.includes(step.acceptance[0]!) ? 'golden present' : 'golden missing',
    });
    const report = await executePlan(run, plan, evaluate);
    expect(report.overallVerdict).toBe('met');
    expect(report.stepResults).toHaveLength(2);
    expect(report.stepResults.every((r) => r.verdict.verdict === 'met')).toBe(true);
    expect(outputs).toHaveLength(2);
  });

  it('executePlan retries a failing step up to maxAttemptsPerStep then reports not_met with evidence', async () => {
    const plan = createPlan('g', [{ id: 's1', description: 'd', acceptance: ['GOLDEN'] }]);
    let calls = 0;
    const run = async () => ({ finalText: `call-${++calls}` });
    const evaluate: StepEvaluator = async ({ output, attempts }) => ({
      verdict: output.includes('call-3') ? 'met' : 'not_met',
      evidence: [`attempt ${attempts}`],
      reason: 'only third attempt carries the golden text',
    });
    const report = await executePlan(run, plan, evaluate, { maxAttemptsPerStep: 3 });
    expect(report.stepResults[0]!.attempts).toBe(3);
    expect(report.stepResults[0]!.verdict.verdict).toBe('met');
    expect(report.overallVerdict).toBe('met');

    const report2 = await executePlan(run, plan, evaluate, { maxAttemptsPerStep: 2 });
    expect(report2.stepResults[0]!.verdict.verdict).toBe('not_met');
    expect(report2.overallVerdict).toBe('not_met');
    expect(report2.overallEvidence.some((e) => e.includes('s1') && e.includes('not_met'))).toBe(true);
  });

  it('plan-level acceptance criteria are evaluated over combined step evidence', async () => {
    const plan = createPlan('g', [{ id: 's1', description: 'd', acceptance: ['X'] }], ['ALL-DONE']);
    const run = async () => ({ finalText: 'X output' });
    let planLevelCalled = false;
    const evaluate: StepEvaluator = async ({ step, output }) => {
      if (step.id === 'plan') {
        planLevelCalled = true;
        return { verdict: output.includes('ALL-DONE') ? 'met' : 'not_met', evidence: [], reason: 'plan-level check' };
      }
      return { verdict: output.includes('X') ? 'met' : 'not_met', evidence: [], reason: 'step check' };
    };
    const report = await executePlan(run, plan, evaluate);
    expect(planLevelCalled).toBe(true);
    expect(report.overallVerdict).toBe('not_met');
    expect(report.reason).toContain('plan-level acceptance');
  });

  it('generatePlan parses LLM JSON output into a validated Plan', async () => {
    const provider = new MockProvider(
      [
        {
          when: /.*/,
          ifNoToolResult: true,
          response: {
            text: JSON.stringify({
              goal: '修复测试',
              steps: [
                { id: 's1', description: '定位失败用例', acceptance: ['tests 运行输出含失败名'] },
                { id: 's2', description: '修复并跑测试', acceptance: ['vitest 全绿'] },
              ],
              acceptance: ['所有测试通过'],
            }),
          },
        },
      ],
      { model: 'planner-model' },
    );
    const plan = await generatePlan(provider, 'planner-model', '修复测试');
    expect(plan.goal).toBe('修复测试');
    expect(plan.steps).toHaveLength(2);
    expect(plan.acceptance).toContain('所有测试通过');
    expect(() => createPlan(plan.goal, plan.steps, plan.acceptance)).not.toThrow();
  });

  it('generatePlan fails loud on non-JSON output', async () => {
    const provider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: '我还没想好计划' } }], { model: 'planner-model' });
    await expect(generatePlan(provider, 'planner-model', 'g')).rejects.toThrow(/not valid JSON/);
  });
});
