import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IterationStore, defaultIterationRoot, newIterationEntryId } from './iteration-store.js';
import type { IterationEntry, IterationTaskRecord } from './iteration-store.js';
import type { IterationResult } from './LoopEngine.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-iteration-store-'));
}

const ROOT_PROJECT = path.join(os.tmpdir(), 'fake-project-it');

/** 任务快照（goal/acceptance 对齐 LoopTask / 061-062 run 记录输入）。 */
const TASK = { taskId: 'task_1000_aabbccdd', goal: '实现 computeFee', acceptance: ['导出 computeFee', '测试全绿'], projectRoot: ROOT_PROJECT };

describe('engine/iteration-store — default root / id 约定（task 063）', () => {
  it('defaultIterationRoot 指向 ~/.vessel/iterations（env VESSEL_ITERATIONS_ROOT 可覆盖）', () => {
    const before = process.env.VESSEL_ITERATIONS_ROOT;
    try {
      delete process.env.VESSEL_ITERATIONS_ROOT;
      expect(defaultIterationRoot('fake-home')).toBe(path.join('fake-home', '.vessel', 'iterations'));
      process.env.VESSEL_ITERATIONS_ROOT = path.join('env', 'root');
      expect(defaultIterationRoot('fake-home')).toBe(path.join('env', 'root'));
    } finally {
      if (before === undefined) delete process.env.VESSEL_ITERATIONS_ROOT;
      else process.env.VESSEL_ITERATIONS_ROOT = before;
    }
  });

  it('newIterationEntryId 沿用 <kind>_<ts>_<hex> 约定且可区分', () => {
    expect(newIterationEntryId(2000, '11223344')).toBe('iter_2000_11223344');
    const a = newIterationEntryId();
    const b = newIterationEntryId();
    expect(a).toMatch(/^iter_\d+_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe('engine/iteration-store — IterationStore 迭代日志（task 063）', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeStore(): IterationStore {
    let clock = 1_000_000;
    return new IterationStore({ iterationsRoot: root, now: () => (clock += 7) });
  }

  function engineResult(overrides: Partial<IterationResult> = {}): IterationResult {
    return {
      iteration: 1,
      taskId: TASK.taskId,
      verdict: 'met',
      evidence: ['src/fee.js 导出存在'],
      reason: '验收通过',
      outputPath: '/tmp/ws-x',
      retryCount: 1,
      ...overrides,
    };
  }

  it('appendIteration 建目录记录 <root>/<task-id>/meta.json：任务基座快照 + 首个条目（ordinal=1、字段缺省归一）', () => {
    const s = makeStore();
    const rec = s.appendIteration(TASK, { verdict: 'met', evidence: ['e1'], reason: 'ok' });
    expect(rec.taskId).toBe(TASK.taskId);
    expect(rec.goal).toBe(TASK.goal);
    expect(rec.acceptance).toEqual(TASK.acceptance);
    expect(rec.projectRoot).toBe(path.resolve(ROOT_PROJECT));
    expect(rec.iterations).toHaveLength(1);
    const it0 = rec.iterations[0]!;
    expect(it0.iteration).toBe(1);
    expect(it0.id).toMatch(/^iter_\d+_[0-9a-f]{8}$/);
    expect(it0.taskId).toBe(TASK.taskId);
    expect(it0.verdict).toBe('met');
    expect(it0.evidence).toEqual(['e1']);
    expect(it0.reason).toBe('ok');
    expect(it0.retryCount).toBe(1); // 缺省
    expect(s.dirFor(TASK.taskId)).toBe(path.join(root, TASK.taskId));
    expect(fs.existsSync(s.metaPath(TASK.taskId))).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(s.metaPath(TASK.taskId), 'utf8')) as IterationTaskRecord;
    expect(onDisk.iterations).toHaveLength(1);
  });

  it('多次 append：per-task 序数 1..n（append 次序即回放顺序），基座保持首次快照不变', () => {
    const s = makeStore();
    s.appendIteration(TASK, { verdict: 'not_met', reason: '首轮未过' });
    s.appendIteration(TASK, { verdict: 'met', reason: '二轮通过', metAfterRetries: true });
    const rec = s.appendIteration(TASK, { verdict: 'met', reason: '三轮复核' });
    expect(rec.iterations.map((it) => it.iteration)).toEqual([1, 2, 3]);
    // 后续 append 传不同 goal 也不改写基座（基座不可变）
    expect(rec.goal).toBe(TASK.goal);
    const replay = s.replay(TASK.taskId);
    expect(replay.map((it) => it.iteration)).toEqual([1, 2, 3]);
    expect(replay[1]?.reason).toBe('二轮通过');
    expect(replay[1]?.metAfterRetries).toBe(true);
  });

  it('appendEngineResult：LoopEngine persist seam 的 IterationResult 1:1 落库（含 non-met 原样保留）', () => {
    const s = makeStore();
    s.appendEngineResult(TASK, engineResult({ iteration: 1, verdict: 'met', outputPath: '/ws/out', retryCount: 2, metAfterRetries: true }));
    const rec = s.get(TASK.taskId)!;
    const it0 = rec.iterations[0]!;
    expect(it0.verdict).toBe('met');
    expect(it0.evidence).toEqual(['src/fee.js 导出存在']);
    expect(it0.reason).toBe('验收通过');
    expect(it0.outputPath).toBe('/ws/out');
    expect(it0.retryCount).toBe(2);
    expect(it0.metAfterRetries).toBe(true);
    expect(it0.engineIteration).toBe(1);
    // 非 met 瞬时结论如实落库（绝不归一成 met）
    const t2 = { ...TASK, taskId: 'task_2000_11223344' };
    s.appendEngineResult(t2, engineResult({ iteration: 1, taskId: t2.taskId, verdict: 'impossible', reason: '无法达成' }));
    expect(s.get(t2.taskId)!.iterations[0]!.verdict).toBe('impossible');
    const t3 = { ...TASK, taskId: 'task_3000_11223344' };
    s.appendEngineResult(t3, engineResult({ iteration: 1, taskId: t3.taskId, verdict: 'error', reason: 'evaluator 失败' }));
    expect(s.get(t3.taskId)!.iterations[0]!.verdict).toBe('error');
  });

  it('富快照：generator（061 GeneratorRunRecord）/ evaluator（062 EvaluatorRunRecord）/ transition / testResults 整记录落库可回放', () => {
    const s = makeStore();
    const generator = {
      taskId: TASK.taskId,
      goal: TASK.goal,
      acceptance: [...TASK.acceptance],
      output: '实现了 computeFee',
      artifactPaths: ['src/fee.js'],
      developer: null,
      teamRunId: 'team_1_abcd',
      workspaceRoot: '/ws/gen',
      iteration: 1,
      attempt: 2,
      startedAt: 111,
      durationMs: 5000,
    };
    const evaluator = {
      taskId: TASK.taskId,
      goal: TASK.goal,
      acceptance: [...TASK.acceptance],
      workspaceRoot: '/ws/eval',
      iteration: 1,
      attempt: 2,
      generatorOutput: '实现了 computeFee',
      artifactPaths: ['src/fee.js'],
      evidencePaths: ['/ws/eval/src/fee.js'],
      visibleTools: ['Read', 'Glob', 'Grep'],
      conclusion: {
        verdict: 'met' as const,
        reason: '验收全过',
        unmet: [],
        suggestions: [],
        evidence: ['src/fee.js 导出存在'],
      },
      reviewerPresetId: 'reviewer',
      startedAt: 222,
      durationMs: 4000,
    };
    s.appendIteration(TASK, {
      verdict: 'met',
      reason: '验收全过',
      retryCount: 2,
      metAfterRetries: true,
      testResults: 'vitest run: 12 passed',
      transition: { from: 'in-progress', to: 'met' },
      generator,
      evaluator,
    });
    const it0 = s.get(TASK.taskId)!.iterations[0]!;
    expect(it0.transition).toEqual({ from: 'in-progress', to: 'met' });
    expect(it0.testResults).toBe('vitest run: 12 passed');
    expect(it0.generator).toEqual(generator);
    expect(it0.evaluator).toEqual(evaluator);
    expect(it0.evaluator!.conclusion.verdict).toBe('met');
    // 跨实例回放整记录仍完整（JSON round-trip）
    const fresh = new IterationStore({ iterationsRoot: root });
    const replayed = fresh.replay(TASK.taskId);
    expect(replayed[0]!.generator!.artifactPaths).toEqual(['src/fee.js']);
    expect(replayed[0]!.evaluator!.evidencePaths).toEqual(['/ws/eval/src/fee.js']);
  });

  it('跨实例追加续号：store A 写 2 条 → 新实例 B 再 append 得 ordinal 3（append 幂等续写不重号）', () => {
    const sA = makeStore();
    sA.appendIteration(TASK, { verdict: 'not_met' });
    sA.appendIteration(TASK, { verdict: 'met' });
    const sB = new IterationStore({ iterationsRoot: root });
    const rec = sB.appendIteration(TASK, { verdict: 'met', reason: '第三轮' });
    expect(rec.iterations.map((it) => it.iteration)).toEqual([1, 2, 3]);
    expect(sB.replay(TASK.taskId)).toHaveLength(3);
    expect(rec.updatedAt >= rec.createdAt).toBe(true);
  });

  it('回放/查询：replay 无记录 → []；get 未知 → undefined；list 最近更新在前', () => {
    const s = makeStore();
    expect(s.replay('task_zz_00000000')).toEqual([]);
    expect(s.get('task_zz_00000000')).toBeUndefined();
    const a = { ...TASK, taskId: 'task_aaa_00000001' };
    const b = { ...TASK, taskId: 'task_bbb_00000002' };
    s.appendIteration(a, { verdict: 'not_met' });
    s.appendIteration(b, { verdict: 'met' });
    s.appendIteration(a, { verdict: 'met' }); // a 再次更新 → a 排前
    const list = s.list();
    expect(list.map((r) => r.taskId)).toEqual([a.taskId, b.taskId]);
    expect(list[0]!.iterations).toHaveLength(2);
  });

  it('校验 fail loud：空/危险 taskId、空 goal、非法 verdict', () => {
    const s = makeStore();
    expect(() => s.appendIteration({ taskId: '', goal: 'g' }, { verdict: 'met' })).toThrow(/taskId/);
    expect(() => s.appendIteration({ taskId: '../escape', goal: 'g' }, { verdict: 'met' })).toThrow(/taskId/);
    expect(() => s.appendIteration({ taskId: 'task_ok_1', goal: '   ' }, { verdict: 'met' })).toThrow(/goal is required/);
    // @ts-expect-error 运行时非法 verdict（模拟外部 JSON 调用）
    expect(() => s.appendIteration(TASK, { verdict: 'partly' })).toThrow(/invalid verdict/);
    // 目录逃逸守卫生效：root 下只应有合法记录
    expect(fs.readdirSync(root)).toHaveLength(0);
  });

  it('损坏条目容忍 + 原子写无 .tmp 残留：坏 meta 跳过，多次 append 后可完整读回', () => {
    const s = makeStore();
    for (let i = 0; i < 15; i += 1) {
      s.appendIteration(TASK, { verdict: i % 2 === 0 ? 'met' : 'not_met', reason: `第 ${i + 1} 轮` });
    }
    // 手工写坏一条记录（模拟 torn/corrupt）
    const badTaskId = 'task_corrupt_00000001';
    fs.mkdirSync(path.join(root, badTaskId), { recursive: true });
    fs.writeFileSync(path.join(root, badTaskId, 'meta.json'), '{broken', 'utf8');
    const fresh = new IterationStore({ iterationsRoot: root });
    expect(fresh.get(badTaskId)).toBeUndefined();
    const list = fresh.list();
    expect(list.map((r) => r.taskId)).toEqual([TASK.taskId]);
    expect(fresh.replay(TASK.taskId)).toHaveLength(15);
    expect(fresh.replay(TASK.taskId).map((it) => it.iteration)).toEqual(
      Array.from({ length: 15 }, (_, i) => i + 1),
    );
    // 无 .tmp 残留
    const files = fs.readdirSync(path.join(root, TASK.taskId));
    expect(files).toEqual(['meta.json']);
  });

  it('队列 ↔ 迭代联动（key 贯通）：QueueTask id 作为迭代记录 taskId，transition 记队列状态转移', () => {
    const s = makeStore();
    // 直接用队列产出的 task id（task_<ts>_<hex> 同型）+ 队列 settle 语义一致的状态对
    const queueTaskId = 'task_5000_12345678';
    const rec: IterationTaskRecord = s.appendIteration(
      { taskId: queueTaskId, goal: '任务 Q', projectRoot: ROOT_PROJECT },
      { verdict: 'met', transition: { from: 'in-progress', to: 'met' }, reason: '队列验收通过' },
    );
    const replay: readonly IterationEntry[] = s.replay(queueTaskId);
    expect(replay).toHaveLength(1);
    expect(replay[0]!.transition).toEqual({ from: 'in-progress', to: 'met' });
    expect(rec.taskId).toBe(queueTaskId);
    expect(rec.goal).toBe('任务 Q');
  });
});
