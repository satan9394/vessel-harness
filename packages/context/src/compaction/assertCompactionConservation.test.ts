import { it, expect } from 'vitest';
import { assertCompactionConservation } from './assertCompactionConservation.js';

it.each(['missing', 'label-only', 'orphaned'])('rejects lost keepID anchor: %s', mode => {
  expect(() => assertCompactionConservation({
    originalMessages: [{ id: 'anchor', role: 'assistant', content: 'ESSENTIAL_ANCHOR' }],
    compactedMessages: [
      { role: 'assistant', content: mode === 'missing' ? 'ESSENTIAL_ANCHOR' : 'unrelated', metadata: mode === 'missing' ? {} : { keepID: 'anchor' } },
      { role: 'assistant', content: mode === 'orphaned' ? 'ESSENTIAL_ANCHOR' : '' },
    ], requiredKeepIds: ['anchor'],
  })).toThrow(expect.objectContaining({ violationType: 'keep_id_lost' }));
});

it('retains goal, explicit denial references and ordered call/result pairs', () => {
  expect(() => assertCompactionConservation({ originalMessages: [], preservedGoalPrefix: 'protect core', requiredDenialEventIds: ['deny:1'],
    compactedMessages: [{ role: 'user', content: 'Goal: protect core', metadata: { denialEventIds: ['deny:1'] } },
      { role: 'assistant', content: '', toolCalls: [{ id: 'a' }] }, { role: 'tool', content: '', toolCallId: 'a' }] })).not.toThrow();
});

it('retains OpenCode 2.1 metadata.keepID contract for preserved message citations', () => {
  expect(() => assertCompactionConservation({
    originalMessages: [],
    requiredKeepIds: ['msg-101', 'msg-102'],
    compactedMessages: [
      { role: 'user', content: 'preserved context', metadata: { keepID: 'msg-101' } },
      { role: 'assistant', content: 'summary', metadata: { keepId: 'msg-102' } },
    ],
  })).not.toThrow();

  try {
    assertCompactionConservation({
      originalMessages: [],
      requiredKeepIds: ['msg-101', 'msg-missing'],
      compactedMessages: [
        { role: 'user', content: 'preserved context', metadata: { keepID: 'msg-101' } },
      ],
    });
    throw new Error('accepted');
  } catch (error) {
    expect(error).toHaveProperty('violationType', 'keep_id_lost');
  }
});

it.each([
  [{ originalMessages: [{ role: 'user', content: 'goal' }, { role: 'user', content: 'Do not touch core', metadata: { preserveVerbatim: true } }], compactedMessages: [{ role: 'user', content: 'goal' }] }, 'constraint_lost'],
  [{ originalMessages: [], latestInstruction: 'local only', compactedMessages: [{ role: 'user', content: 'goal' }] }, 'latest_instruction_lost'],
  [{ originalMessages: [], requiredToolPairs: [{ toolCallId: 'read', callText: 'Read(file.ts)', resultText: 'file contents' }], compactedMessages: [{ role: 'user', content: 'Read(file.ts)' }] }, 'tool_pair_lost'],
] as const)('rejects loss in fidelity fixtures', (input, violationType) => {
  try { assertCompactionConservation(input); throw new Error('accepted'); }
  catch (error) { expect(error).toHaveProperty('violationType', violationType); }
});
it.each([
  [{ preservedGoalPrefix: 'protect core', compactedMessages: [{ role: 'user', content: 'lost' }] }, 'goal_lost'],
  [{ requiredDenialEventIds: ['deny:1'], compactedMessages: [{ role: 'user', content: 'deny:1' }] }, 'denial_lost'],
  [{ compactedMessages: [{ role: 'assistant', content: '', toolCalls: [{ id: 'a' }] }] }, 'orphaned_tool_call'],
  [{ compactedMessages: [{ role: 'tool', content: '', toolCallId: 'a' }] }, 'orphaned_tool_result'],
] as const)('rejects a conservation violation', (input, violationType) => {
  try { assertCompactionConservation({ originalMessages: [], ...input }); throw new Error('accepted'); }
  catch (error) { expect(error).toHaveProperty('violationType', violationType); }
});
