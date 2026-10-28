import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockProvider } from '@vessel/llm';
import { Executor } from '@vessel/runtime';
import { AutonomousReflectionEngine } from '@vessel/memory';
import type { LearnedStore, ReflectiveRule } from '@vessel/memory';
import { isWidgetBlock, type TeamEndPayload, type DiffInspectorWidget } from '@vessel/shared';
import { composeHarness } from './compose.js';
import type { ComposedHarness } from './compose.js';

vi.mock('node:fs', async original => ({ ...await original<typeof import('node:fs')>() }));

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

describe('successful new-file Write diff publication', () => {
  let root: string;
  let harness: ComposedHarness | undefined;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-write-diff-')); });
  afterEach(async () => { await harness?.close(); harness = undefined; vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

  async function open(name: string, args: Record<string, unknown>, permission?: 'read-only', provider = new MockProvider([
    { when: /.*/, ifNoToolResult: true, response: { toolCalls: [{ name, arguments: args }] } },
    { when: /.*/, minToolResults: 1, response: { text: 'done' } },
  ])) {
    harness = await composeHarness({ workspaceRoot: root, model: 'mock', permission, memory: { enabled: false },
      provider, policySystemPath: path.join(REPO_ROOT, 'configs/policy.default.yaml'),
      behaviorIRPath: path.join(REPO_ROOT, 'configs/behavior.default.yaml') });
    return harness;
  }

  it.each(['first\nsecond\n', 'first\nsecond', 'first\r\nsecond\r\n', ''])('publishes the complete all-added diff after durable success (%j)', async content => {
    const h = await open('Write', { path: 'nested/new.txt', content });
    const widgets: DiffInspectorWidget[] = [];
    h.bus.on('ui/widget_block', payload => {
      if (!isWidgetBlock(payload) || payload.kind !== 'diff_inspector') throw new Error('unexpected widget');
      expect(fs.readFileSync(path.join(root, 'nested/new.txt'), 'utf8')).toBe(content);
      expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'tool/result', toolName: 'Write',
        content: `wrote nested${path.sep}new.txt (${Buffer.byteLength(content)} bytes)`, meta: { path: `nested${path.sep}new.txt`, bytes: Buffer.byteLength(content) } }));
      widgets.push(payload);
    });
    await h.loop.runTurn('create fixture');
    const rows = content.replace(/\r\n/g, '\n').split('\n');
    if (rows.at(-1) === '') rows.pop();
    const patch = ['--- /dev/null', '+++ b/nested/new.txt', `@@ -0,0 +${rows.length ? 1 : 0},${rows.length} @@`,
      ...rows.map(row => `+${row}`), ...(content && !content.endsWith('\n') ? ['\\ No newline at end of file'] : [])].join('\n') + '\n';
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toMatchObject({ kind: 'diff_inspector', status: 'resolved', turnIndex: 0,
      payload: { filePath: 'nested/new.txt', additions: rows.length, deletions: 0, patch } });
    const result = h.session.replay().find(record => record.type === 'tool/result')!;
    if (result.type !== 'tool/result') throw new Error('missing result');
    await h.bus.emit('after_tool', { toolCallId: 'unrelated', toolName: 'Write', result: {} });
    await h.bus.emit('after_tool', { toolCallId: result.toolCallId, toolName: 'Write', result: {} });
    expect(widgets).toHaveLength(1);
    expect(fs.readFileSync(path.join(root, 'nested/new.txt'), 'utf8')).toBe(content);
  });

  it.each(['..notes.txt', '..data/file.txt'])('preserves the existing filesystem guard denial for two-dot-prefixed paths (%s)', async filePath => {
    const h = await open('Write', { path: filePath, content: 'inside\n' });
    const widgets: unknown[] = []; h.bus.on('ui/widget_block', widget => { widgets.push(widget); });
    await h.loop.runTurn('create internal fixture');
    expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'tool/result', error: expect.objectContaining({ errorClass: 'DENIED' }), meta: expect.objectContaining({ guard: 'escape' }) }));
    expect(fs.existsSync(path.join(root, filePath))).toBe(false);
    expect(widgets).toEqual([]);
  });

  it('never publishes an interrupted late completion when the next overwrite reuses its tool-call ID', async () => {
    const args = { path: 'late.txt', content: 'first\n' };
    const h = await open('Write', args, undefined, new MockProvider([
      { when: 'create fixture', ifNoToolResult: true, response: { toolCalls: [{ name: 'Write', arguments: args }] } },
      { when: 'overwrite fixture', minToolResults: 1, maxToolResults: 1, response: { toolCalls: [{ name: 'Write', arguments: { path: 'late.txt', content: 'second\n' } }] } },
      { when: /.*/, minToolResults: 1, response: { text: 'done' } },
    ]));
    let entered!: () => void; const atCompletion = new Promise<void>(resolve => { entered = resolve; });
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    let dispatch: ReturnType<Executor['runTool']> | undefined;
    const execute = Executor.prototype.runTool;
    vi.spyOn(Executor.prototype, 'runTool').mockImplementation(function (this: Executor, tool, call, ctx) {
      const result = execute.call(this, tool, call, ctx);
      if (call.arguments.content !== 'first\n') return result;
      dispatch = result.then(async value => { entered(); await held; return value; });
      return dispatch;
    });
    const publish = vi.fn(); h.bus.on('ui/widget_block', publish);
    const first = h.loop.runTurn('create fixture');
    await atCompletion;
    expect(fs.readFileSync(path.join(root, 'late.txt'), 'utf8')).toBe('first\n');
    expect(h.loop.interrupt()).toBe(true);
    expect((await first).kind).toBe('interrupted');
    release(); await dispatch;
    expect((await h.loop.runTurn('overwrite fixture')).kind).toBe('success');
    const calls = h.session.replay().filter(record => record.type === 'tool/call');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.toolCallId).toBe(calls[1]!.toolCallId);
    expect(fs.readFileSync(path.join(root, 'late.txt'), 'utf8')).toBe('second\n');
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(['Write', 'Edit'])('keeps existing-file %s out of scope without a widget', async name => {
    fs.writeFileSync(path.join(root, 'existing.txt'), 'before');
    const h = await open(name, name === 'Write' ? { path: 'existing.txt', content: 'after' }
      : { path: 'existing.txt', old_string: 'before', new_string: 'after' });
    const publish = vi.fn(); h.bus.on('ui/widget_block', publish);
    await h.loop.runTurn('change fixture');
    expect(fs.readFileSync(path.join(root, 'existing.txt'), 'utf8')).toBe('after');
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish when policy denies Write before execution', async () => {
    const h = await open('Write', { path: 'denied.txt', content: 'never written' }, 'read-only');
    const publish = vi.fn(); h.bus.on('ui/widget_block', publish);
    await h.loop.runTurn('try denied write');
    expect(fs.existsSync(path.join(root, 'denied.txt'))).toBe(false);
    expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'tool/result', error: expect.objectContaining({ errorClass: 'DENIED' }) }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not publish a partial write that returns a failure', async () => {
    const h = await open('Write', { path: 'partial.txt', content: 'complete' });
    const write = fs.writeFileSync;
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, options) => {
      if (file === path.join(root, 'partial.txt')) { write(file, 'part', options); throw new Error('injected partial write'); }
      return write(file, data, options);
    });
    const publish = vi.fn(); h.bus.on('ui/widget_block', publish);
    await h.loop.runTurn('try failed write');
    expect(fs.readFileSync(path.join(root, 'partial.txt'), 'utf8')).toBe('part');
    expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'tool/result', error: expect.objectContaining({ errorClass: 'TOOL_FAILURE', message: 'write failed: injected partial write' }) }));
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps successful Write successful when a presentation observer throws', async () => {
    const h = await open('Write', { path: 'success.txt', content: 'complete\n' });
    h.bus.on('ui/widget_block', () => { throw new Error('observer unavailable'); });
    expect((await h.loop.runTurn('create fixture')).kind).toBe('success');
    expect(h.session.replay()).toContainEqual(expect.objectContaining({ type: 'tool/result', content: 'wrote success.txt (9 bytes)' }));
    expect(fs.readFileSync(path.join(root, 'success.txt'), 'utf8')).toBe('complete\n');
  });
});
