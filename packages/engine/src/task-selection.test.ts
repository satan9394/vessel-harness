import { describe, it, expect } from 'vitest';
import { createTaskQueue, queueSelectTask, ArrayTaskQueue } from './taskQueue.js';
import { selectTaskFor, classifyTaskFor } from './selection.js';
import { LoopEngine, type LoopTask } from './LoopEngine.js';
import type { EvaluatorVerdict } from '@cah/agents';

const A: LoopTask = { id: 'a', goal: '实现登录功能' };
const B: LoopTask = { id: 'b', goal: '审查代码' };
const C: LoopTask = { id: 'c', goal: '搜索 needle' };

describe('engine — TaskQueue (V0.5-M2)', () => {
  it('FIFO order: enqueue a,b,c → next returns a,b,c then null', () => {
    const q = createTaskQueue([A, B, C]);
    expect(q.next()).toBe(A);
    expect(q.next()).toBe(B);
    expect(q.next()).toBe(C);
    expect(q.next()).toBeNull();
  });

  it('peek does not consume; empty peek returns null', () => {
    const q = createTaskQueue([A]);
    expect(q.peek()).toBe(A);
    expect(q.size).toBe(1);
    expect(q.next()).toBe(A);
    expect(q.peek()).toBeNull();
  });

  it('isEmpty and size track state', () => {
    const q = new ArrayTaskQueue<LoopTask>();
    expect(q.isEmpty()).toBe(true);
    q.enqueue(A);
    expect(q.isEmpty()).toBe(false);
    expect(q.size).toBe(1);
    q.enqueue(B);
    expect(q.size).toBe(2);
  });

  it('drain returns all in FIFO order and empties the queue', () => {
    const q = createTaskQueue([A, B]);
    expect(q.drain()).toEqual([A, B]);
    expect(q.isEmpty()).toBe(true);
  });

  it('queueSelectTask adapter returns null on empty queue (LoopEngine stop contract)', async () => {
    const q = createTaskQueue([A]);
    const select = queueSelectTask(q);
    expect(await select()).toBe(A);
    expect(await select()).toBeNull();
  });

  it('queueSelectTask drives a LoopEngine iteration loop (one met task then stop)', async () => {
    const q = createTaskQueue([A]);
    const engine = new LoopEngine(
      {
        selectTask: queueSelectTask(q),
        generate: async () => ({ output: 'done GOLDEN' }),
        evaluate: async () => ({ verdict: 'met', evidence: ['GOLDEN'], reason: 'ok' }) as EvaluatorVerdict,
        persist: async () => {},
      },
      { maxIterations: 3 },
    );
    const report = await engine.run();
    expect(report?.taskId).toBe('a');
    expect(report?.outcome).toBe('met');
  });
});

describe('engine — Task Selection (V0.5-M2)', () => {
  it('selectTaskFor maps goal → category → preset/tier via classifyTask + DEFAULT_PRESETS', () => {
    const impl = selectTaskFor(A); // 实现登录功能
    expect(impl.category).toBe('implementation');
    expect(impl.preset.agentPreset).toBe('developer');
    expect(impl.tier).toBe('pro');
    expect(impl.model).toBeUndefined(); // no router → no concrete model
  });

  it('review task maps to reviewer preset / pro tier; search to fast', () => {
    const review = selectTaskFor(B);
    expect(review.category).toBe('review');
    expect(review.preset.agentPreset).toBe('reviewer');
    const search = selectTaskFor(C);
    expect(search.category).toBe('search');
    expect(search.tier).toBe('fast');
  });

  it('classifyTaskFor is the provider-free convenience wrapper', () => {
    const sel = classifyTaskFor(A);
    expect(sel.category).toBe('implementation');
    expect(sel.model).toBeUndefined();
  });

  it('injected classifier overrides the default', () => {
    const sel = selectTaskFor({ id: 'x', goal: 'anything' }, { classify: () => 'planning' });
    expect(sel.category).toBe('planning');
    expect(sel.preset.agentPreset).toBe('planner');
  });

  it('injected preset resolver overrides DEFAULT_PRESETS', () => {
    const sel = selectTaskFor(A, { presets: () => ({ category: 'implementation', agentPreset: 'custom', modelTier: 'fast', description: 'x' }) });
    expect(sel.preset.agentPreset).toBe('custom');
    expect(sel.tier).toBe('fast');
  });

  it('injected router resolves a concrete model', () => {
    const router = {
      resolve: () => ({
        model: 'claude-x',
        category: 'implementation',
        preset: { category: 'implementation', agentPreset: 'developer', modelTier: 'pro', description: 'x' },
      }),
      // resolve return type is approximated — test only reads model/category/preset
    } as unknown as import('./selection.js').RouterLike;
    const sel = selectTaskFor(A, { router });
    expect(sel.model).toBe('claude-x');
    expect(sel.category).toBe('implementation');
  });

  it('unknown goal falls back to the unknown preset', () => {
    const sel = selectTaskFor({ id: 'u', goal: 'hello there' });
    expect(sel.category).toBe('unknown');
    expect(sel.tier).toBe('pro');
  });
});
