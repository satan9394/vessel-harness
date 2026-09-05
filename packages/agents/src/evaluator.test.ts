import { describe, it, expect } from 'vitest';
import { DeterministicEvaluator, LLEvaluator } from './evaluator/Evaluator.js';
import { MockProvider } from '@cah/llm';

describe('agents/evaluator — contract (Generator/Evaluator separation)', () => {
  it('DeterministicEvaluator: met when all golden substrings present', async () => {
    const e = new DeterministicEvaluator(['progressive income tax']);
    const v = await e.evaluate({ transcript: '…', finalAssistantText: 'The computeTax computes progressive income tax by bracket.' });
    expect(v.verdict).toBe('met');
  });

  it('DeterministicEvaluator: not_met when golden missing', async () => {
    const e = new DeterministicEvaluator(['MAGIC-PHRASE']);
    const v = await e.evaluate({ transcript: '…', finalAssistantText: 'nothing here' });
    expect(v.verdict).toBe('not_met');
  });

  it('LLMEvaluator: independent model call with requestKind=goal-eval', async () => {
    const provider = new MockProvider(
      [{ when: /.*/, response: { text: '{"verdict":"met","reason":"磁盘证据确认产物存在"}' } }],
      { model: 'eval-model' },
    );
    const e = new LLEvaluator(provider, 'eval-model', '实现 computeFee 并通过隐藏测试');
    const v = await e.evaluate({ transcript: '…', finalAssistantText: 'done' });
    expect(v.verdict).toBe('met');
  });

  it('LLMEvaluator returns error verdict on provider failure (never self-certify)', async () => {
    const provider = new MockProvider([], { fallbackText: 'not json' });
    const e = new LLEvaluator(provider, 'eval-model', 'goal');
    const v = await e.evaluate({ transcript: '…', finalAssistantText: 'done' });
    expect(['error', 'met', 'not_met']).toContain(v.verdict);
  });
});
