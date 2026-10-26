import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { AutonomousReflectionEngine } from '@vessel/memory';
import type { LearnedStore, ReflectiveRule } from '@vessel/memory';
import type { TeamEndPayload } from '@vessel/shared';
import { composeHarness } from './compose.js';
import type { ComposedHarness } from './compose.js';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const rule: ReflectiveRule = { id: 'rule', category: 'tool_failure', triggerCondition: 'Read ENOENT', lesson: 'Verify workspace paths.',
  recommendedAction: 'Read the required file before retrying.', confidence: 0.85, frequency: 1, updatedAt: 1 };
const evaluation: TeamEndPayload = { teamRunId: 'review-1', outcome: 'failed', durationMs: 1, members: [{ memberId: 'evaluator-1', presetId: 'review',
  role: 'evaluator', phase: 'evaluate', status: 'completed', sessionId: 'review-session', delegationDepth: 0, durationMs: 1,
  review: { verdict: 'not_met', reason: 'constraint failed', unmet: ['thin core'], suggestions: [], evidence: [] } }] };

describe('reflection suggestions', () => {
  let root: string;
  let harness: ComposedHarness | undefined;
  const suggest = vi.fn<LearnedStore['suggest']>();
  const approve = vi.fn<LearnedStore['approve']>();
  const reject = vi.fn<LearnedStore['reject']>();
  const learnedStore: Pick<LearnedStore, 'suggest' | 'approve' | 'reject'> = { suggest, approve, reject };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-compose-learned-'));
    suggest.mockReset().mockImplementation(input => ({ ...input, id: 'suggestion-1', createdAt: '2026-10-25T00:00:00.000Z', status: 'pending' }));
    approve.mockReset().mockReturnValue({ ok: false, reason: 'Explicit approval required' });
    reject.mockReset().mockReturnValue(undefined);
  });
  afterEach(async () => {
    await harness?.close();
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function open(inject = true): Promise<ComposedHarness> {
    harness = await composeHarness({ workspaceRoot: root, provider: new MockProvider([]), model: 'mock',
      policySystemPath: path.join(REPO_ROOT, 'configs/policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs/behavior.default.yaml'),
      ...(inject ? { learnedStore } : {}) });
    await harness.session.appendSync({ type: 'turn/start', turnId: 'turn-1', surface: false });
    return harness;
  }

  async function close(): Promise<void> {
    const active = harness!;
    harness = undefined;
    await active.close();
  }

  async function denial(active: ComposedHarness): Promise<void> {
    await active.session.appendSync({ type: 'audit/denial', toolName: 'Shell', toolCallId: 'denied', stage: 'rule', reason: 'denied', surface: false });
  }

  it.each(['after_turn', 'team_end'] as const)('suggests a complete experience from %s without approval', async event => {
    const active = await open();
    if (event === 'after_turn') await denial(active);
    await active.bus.emit(event, event === 'team_end' ? evaluation : { turnId: 'turn-1', kind: 'success' });
    await close();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest).toHaveBeenCalledWith(expect.objectContaining({ kind: 'memory', reason: expect.any(String), content: expect.any(String), evidence: [expect.any(String)] }));
    const entry = suggest.mock.calls[0]![0];
    expect(entry.reason.trim()).not.toBe('');
    expect(entry.content).toContain(event === 'after_turn' ? 'denied by the active policy' : 'rejected an architecture constraint');
    expect(entry.evidence[0]).toContain(event === 'after_turn' ? 'session.jsonl#seq=' : 'review-1:evaluator-1');
    expect(approve).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
  });

  it.each([
    { sourceSequence: 7, sourceId: 'd-1' },
    { sourceId: 'd-1' },
  ])('uses returned rule provenance rather than the input event (%j)', async evidenceSource => {
    vi.spyOn(AutonomousReflectionEngine.prototype, 'processSessionEnd').mockResolvedValue([{ ...rule, evidenceSource }]);
    const active = await open();
    await denial(active);
    await close();
    expect(suggest).toHaveBeenCalledTimes(1);
    expect(suggest.mock.calls[0]![0].evidence).toEqual([evidenceSource.sourceSequence !== undefined
      ? path.join(active.session.dir, 'session.jsonl') + '#seq=7'
      : `session:${active.session.sessionId}/event:d-1`]);
  });

  it('skips a reflection without evidence and warns once without throwing', async () => {
    vi.spyOn(AutonomousReflectionEngine.prototype, 'processSessionEnd').mockResolvedValue([rule]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    await close();
    expect(suggest).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith('[vessel] reflection suggestion skipped: missing evidence');
  });

  it('preserves reflection when no suggestion store is injected', async () => {
    const reflection = vi.spyOn(AutonomousReflectionEngine.prototype, 'processSessionEnd').mockResolvedValue([rule]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open(false);
    await close();
    expect(reflection).toHaveBeenCalledTimes(1);
    expect(suggest).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('deduplicates repeated callbacks and the close flush within one turn', async () => {
    const active = await open();
    await denial(active);
    await active.bus.emit('after_turn', { turnId: 'turn-1', kind: 'success' });
    await active.bus.emit('after_turn', { turnId: 'turn-1', kind: 'success' });
    await close();
    expect(suggest).toHaveBeenCalledTimes(1);
  });

  it.each(['', '   ', 'TODO'])('rejects a missing or whole-field placeholder cue %j', async triggerCondition => {
    vi.spyOn(AutonomousReflectionEngine.prototype, 'processSessionEnd').mockResolvedValue([{ ...rule, triggerCondition, evidenceSource: { sourceSequence: 1 } }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const active = await open();
    await denial(active);
    await close();
    expect(suggest).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledExactlyOnceWith('[vessel] reflection suggestion skipped: missing cue');
  });
});
