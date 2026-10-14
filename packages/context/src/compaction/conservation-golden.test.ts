import { describe, expect, it } from 'vitest';
import type { CompactionConservationCheckInput, ConservationMessage } from '@vessel/shared';
import { CompactionConservationError, assertCompactionConservation } from './assertCompactionConservation.js';

/**
 * ARC-11 §11.1.6 / architecture plan §8.3 — Context fidelity golden gate.
 *
 * Compaction must conserve 100% of the facts that future turns still depend on:
 * the goal, verbatim user constraints, the latest instruction, denial records and
 * tool call/result pairs. A single lost item is a hard violation, never a warning.
 */

const GOAL = 'GOAL: close card 222 with all gates green';
const CONSTRAINT = 'CONSTRAINT: never delete files; always use the recycle bin';
const LATEST = 'LATEST: finish the fault-injection gates';
const CALL = 'CALL: Write src/app.ts';
const RESULT = 'RESULT: 42 bytes written';

function messages(): { original: ConservationMessage[]; compacted: ConservationMessage[] } {
  const chatter: ConservationMessage[] = Array.from({ length: 48 }, (_, index) => ({ role: 'user', content: `chatter turn ${index}` }));
  const original: ConservationMessage[] = [
    { role: 'system', content: GOAL },
    { role: 'user', content: CONSTRAINT, metadata: { preserveVerbatim: true } },
    ...chatter,
    { role: 'assistant', content: '', toolCalls: [{ id: 'tc1' }] },
    { role: 'tool', content: RESULT, toolCallId: 'tc1' },
    { role: 'user', content: LATEST },
  ];
  const compacted: ConservationMessage[] = [
    { role: 'user', content: `<compacted-summary>\n${GOAL}\n${CONSTRAINT}\n${CALL}\n${RESULT}\n${LATEST}\n</compacted-summary>`, metadata: { denialEventIds: ['deny-1'] } },
    { role: 'assistant', content: '', toolCalls: [{ id: 'tc1' }] },
    { role: 'tool', content: RESULT, toolCallId: 'tc1' },
  ];
  return { original, compacted };
}

function input(overrides: Partial<CompactionConservationCheckInput> = {}): CompactionConservationCheckInput {
  const { original, compacted } = messages();
  return { originalMessages: original, compactedMessages: compacted, requiredDenialEventIds: ['deny-1'], requiredToolPairs: [{ toolCallId: 'tc1', callText: CALL, resultText: RESULT }], latestInstruction: LATEST, ...overrides };
}

describe('ARC-11 compaction fidelity — 100% conservation', () => {
  it('conserves every required fact across a full compaction (100%)', () => {
    expect(() => assertCompactionConservation(input())).not.toThrow();
    const required = 5; // goal + constraint + latest instruction + denial + tool pair
    const preserved = required; // the assertion passing means all five survived
    expect(preserved / required).toBe(1);
  });

  it.each([
    ['goal_lost', () => input({ compactedMessages: [{ role: 'user', content: `${CONSTRAINT}\n${CALL}\n${RESULT}\n${LATEST}`, metadata: { denialEventIds: ['deny-1'] } }] })],
    ['constraint_lost', () => { const i = input(); return { ...i, compactedMessages: i.compactedMessages.map((m) => ({ ...m, content: String(m.content).replace(CONSTRAINT, '') })) }; }],
    ['latest_instruction_lost', () => { const i = input(); return { ...i, compactedMessages: i.compactedMessages.map((m) => ({ ...m, content: String(m.content).replace(LATEST, '') })) }; }],
    ['denial_lost', () => { const i = input(); return { ...i, compactedMessages: i.compactedMessages.map((m) => ({ ...m, metadata: {} })) }; }],
    ['tool_pair_lost', () => { const i = input(); return { ...i, compactedMessages: i.compactedMessages.map((m) => ({ ...m, content: String(m.content).replace(CALL, '') })) }; }],
  ])('raises %s when a required fact is dropped', (violation, build) => {
    try {
      assertCompactionConservation(build());
      throw new Error('expected a conservation violation');
    } catch (error) {
      expect(error).toBeInstanceOf(CompactionConservationError);
      expect((error as CompactionConservationError).violationType).toBe(violation);
    }
  });

  it('rejects orphaned tool calls and orphaned tool results', () => {
    const orphanCall = input({ compactedMessages: [{ role: 'assistant', content: `${GOAL}\n${CONSTRAINT}\n${CALL}\n${RESULT}\n${LATEST}`, toolCalls: [{ id: 'tc1' }], metadata: { denialEventIds: ['deny-1'] } }] });
    expect(() => assertCompactionConservation(orphanCall)).toThrow(/orphaned_tool_call/);
    const orphanResult = input({ compactedMessages: [{ role: 'user', content: `${GOAL}\n${CONSTRAINT}\n${CALL}\n${RESULT}\n${LATEST}`, metadata: { denialEventIds: ['deny-1'] } }, { role: 'tool', content: RESULT, toolCallId: 'tc9' }] });
    expect(() => assertCompactionConservation(orphanResult)).toThrow(/orphaned_tool_result/);
  });
});
