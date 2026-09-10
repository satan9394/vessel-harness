import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Session } from '@vessel/core';
import { IterationStore, ProjectTaskQueue } from '../index.js';
import {
  buildHandoff,
  isHandoffRecord,
  newHandoffId,
  parseHandoff,
  serializeHandoff,
  type HandoffMaterial,
} from './Handoff.js';
import { collectHandoffMaterial } from './HandoffMaterial.js';
import { renderHandoffText } from './HandoffRender.js';
import { HandoffStore, defaultHandoffRoot } from './HandoffStore.js';
import { HANDOFF_LENGTH_THRESHOLD, HANDOFF_THRESHOLD_RATIO, handoffSeamState, shouldGenerateHandoff } from './HandoffTrigger.js';
import { handoffStartContext, handoffToTaskSeed, seedSessionFromHandoff } from './StartFromHandoff.js';

// node:fs 的 ESM 命名空间导出 non-configurable（vitest 2.1.9 报 "Cannot redefine property"），
// 沿用 113 vi.mock 方案：默认真实委托的 renameSync，供 task 114 EPERM 有界重试注入；
// 其余 API 原样委托，不影响本文件其它用例。
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  const renameSync = actual.renameSync;
  return {
    ...actual,
    renameSync: vi.fn((...args: Parameters<typeof renameSync>) => renameSync(...args)),
  };
});

function tempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** §12 九字段全齐的完整素材（各验收用例的基座；字段名逐字 §12 yaml）。 */
function fullMaterial(overrides: Partial<HandoffMaterial> = {}): HandoffMaterial {
  return {
    goal: '实现 computeFee 并补测试',
    completed: ['完成导出 computeFee', '完成单测覆盖'],
    current_state: '实现已落盘，待验收',
    changed_files: ['packages/fee/src/index.ts', 'packages/fee/src/index.test.ts'],
    tests: ['vitest run packages/fee: 12 passed'],
    decisions: ['采用 decimal 而非 float 计费'],
    blockers: ['验收需要评审通过'],
    next_actions: ['运行全量 vitest', '提交 commit'],
    evidence: ['exit 0 (tsc -b)', '12 tests passed'],
    taskId: 'task_1000_aabbccdd',
    acceptance: ['导出 computeFee', '测试全绿'],
    projectRoot: path.join(os.tmpdir(), 'fake-project-handoff'),
    ...overrides,
  };
}

const HANDOFF_FIELDS = [
  'goal',
  'completed',
  'current_state',
  'changed_files',
  'tests',
  'decisions',
  'blockers',
  'next_actions',
  'evidence',
] as const;

describe('engine/handoff — Handoff 类型 + 生成（task 067）', () => {
  it('buildHandoff 产出 §12 九字段齐的结构化 handoff：id 前缀 handoff_ + 时间戳', () => {
    const rec = buildHandoff(fullMaterial(), { now: 2_000, id: 'handoff_2000_11223344' });
    expect(rec.id).toBe('handoff_2000_11223344');
    expect(rec.id).toMatch(/^handoff_\d+_[0-9a-f]{8}$/);
    expect(rec.createdAt).toBe('1970-01-01T00:00:02.000Z');
    expect(rec.updatedAt).toBe(rec.createdAt);
    for (const f of HANDOFF_FIELDS) {
      expect(rec).toHaveProperty(f);
    }
    expect(rec.goal).toBe('实现 computeFee 并补测试');
    expect(rec.completed).toEqual(['完成导出 computeFee', '完成单测覆盖']);
    expect(rec.current_state).toBe('实现已落盘，待验收');
    expect(rec.changed_files).toHaveLength(2);
    expect(rec.tests).toContain('vitest run packages/fee: 12 passed');
    expect(rec.decisions).toContain('采用 decimal 而非 float 计费');
    expect(rec.blockers).toContain('验收需要评审通过');
    expect(rec.next_actions).toContain('运行全量 vitest');
    expect(rec.evidence).toContain('12 tests passed');
    // 引擎复用元数据透传
    expect(rec.taskId).toBe('task_1000_aabbccdd');
    expect(rec.acceptance).toEqual(['导出 computeFee', '测试全绿']);
  });

  it('buildHandoff 异常：goal 为空 fail loud；数组字段宽容归一', () => {
    expect(() => buildHandoff({ ...fullMaterial(), goal: '' })).toThrow(/goal is required/);
    expect(() => buildHandoff({ ...fullMaterial(), goal: '   ' })).toThrow(/goal is required/);
    const rec = buildHandoff({
      ...fullMaterial(),
      completed: ['a', 42, null] as unknown as string[],
      changed_files: undefined as unknown as string[],
    });
    expect(rec.completed).toEqual(['a']);
    expect(rec.changed_files).toEqual([]);
  });

  it('serialize/parse round-trip：JSON 序列化可完整恢复（isHandoffRecord 校验）', () => {
    const rec = buildHandoff(fullMaterial());
    const text = serializeHandoff(rec);
    const parsed = parseHandoff(text);
    expect(parsed).toEqual(rec);
    expect(isHandoffRecord(parsed)).toBe(true);
    expect(() => parseHandoff('not json')).toThrow(/malformed/);
    expect(() => parseHandoff(JSON.stringify({ id: 'handoff_x', goal: '' }))).toThrow(/not a valid handoff/);
    expect(isHandoffRecord({ id: 'task_x', goal: 'g' })).toBe(false);
  });

  it('newHandoffId 沿用 <kind>_<ts>_<hex> 约定且可区分', () => {
    expect(newHandoffId(2000, '11223344')).toBe('handoff_2000_11223344');
    const a = newHandoffId();
    const b = newHandoffId();
    expect(a).toMatch(/^handoff_\d+_[0-9a-f]{8}$/);
    expect(a).not.toBe(b);
  });
});

describe('engine/handoff — HandoffStore 持久化（059 存储模式，task 067）', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir('cah-handoff-store-');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function store(): HandoffStore {
    return new HandoffStore({ handoffsRoot: root });
  }

  it('defaultHandoffRoot 指向 ~/.vessel/handoffs（env VESSEL_HANDOFFS_ROOT 可覆盖）', () => {
    const before = process.env.VESSEL_HANDOFFS_ROOT;
    try {
      delete process.env.VESSEL_HANDOFFS_ROOT;
      expect(defaultHandoffRoot('fake-home')).toBe(path.join('fake-home', '.vessel', 'handoffs'));
      process.env.VESSEL_HANDOFFS_ROOT = path.join('env', 'root');
      expect(defaultHandoffRoot('fake-home')).toBe(path.join('env', 'root'));
    } finally {
      if (before === undefined) delete process.env.VESSEL_HANDOFFS_ROOT;
      else process.env.VESSEL_HANDOFFS_ROOT = before;
    }
  });

  it('create 落盘目录布局 <root>/<handoff-id>/meta.json + handoff.md，get 完整 round-trip', () => {
    const s = store();
    const rec = s.create(fullMaterial(), { now: 3_000, id: 'handoff_3000_11223344' });
    expect(fs.existsSync(s.metaPath(rec.id))).toBe(true);
    expect(fs.existsSync(s.handoffPath(rec.id))).toBe(true);
    // 原子写：无 tmp 残留
    expect(fs.readdirSync(s.dirFor(rec.id)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const got = s.get(rec.id)!;
    expect(got).toEqual(rec);
    expect(got.id).toBe('handoff_3000_11223344');
    expect(got.goal).toBe('实现 computeFee 并补测试');
    expect(got.completed).toEqual(rec.completed);
    expect(got.blockers).toEqual(rec.blockers);
  });

  it('list 最新在前 + latest 返回最近一条；未知 id / 损坏 meta → undefined（容错）', () => {
    const s = store();
    const a = s.create(fullMaterial({ goal: '目标 A' }), { now: 1_000, id: 'handoff_1000_aaaa' });
    const b = s.create(fullMaterial({ goal: '目标 B' }), { now: 2_000, id: 'handoff_2000_bbbb' });
    expect(s.list().map((r) => r.id)).toEqual([b.id, a.id]);
    expect(s.latest()?.id).toBe(b.id);
    expect(s.get('handoff_9999_nope')).toBeUndefined();
    // 损坏 meta.json → get undefined（不 throw，registry 同款容忍）
    fs.writeFileSync(s.metaPath(a.id), '{ broken json', 'utf8');
    expect(s.get(a.id)).toBeUndefined();
    expect(s.list().map((r) => r.id)).toEqual([b.id]);
  });

  it('renderHandoffText 输出含 §12 全部 yaml 字段名', () => {
    const rec = buildHandoff(fullMaterial({ continuationOf: 'handoff_3000_11223344' }), {
      now: 4_000,
      id: 'handoff_4000_11223344',
    });
    const text = renderHandoffText(rec);
    expect(text).toContain('# Context Reset Handoff');
    for (const f of HANDOFF_FIELDS) {
      expect(text).toContain(`${f}:`);
    }
    expect(text).toContain('handoff-id: `handoff_4000_11223344`');
    expect(text).toContain('- 完成导出 computeFee');
    expect(text).toContain('continuation-of: handoff_3000_11223344');
  });
});

describe('engine/handoff — 素材来源（063 IterationStore / 任务对象，task 067）', () => {
  it('collectHandoffMaterial 从 QueueTask + IterationStore 回放聚合 §12 素材', () => {
    const queueRoot = tempDir('cah-handoff-material-q-');
    const iterRoot = tempDir('cah-handoff-material-i-');
    try {
      const queue = new ProjectTaskQueue({ tasksRoot: queueRoot });
      const iterations = new IterationStore({ iterationsRoot: iterRoot });
      const task = queue.enqueue({
        projectRoot: path.join(os.tmpdir(), 'p'),
        goal: '实现 computeFee',
        acceptance: ['导出 computeFee', '测试全绿'],
      });
      // 迭代 1: not_met（缺测试证据）→ blockers；迭代 2: met → completed/decisions/evidence
      iterations.appendIteration(
        { taskId: task.id, goal: task.goal, acceptance: task.acceptance, projectRoot: task.projectRoot },
        { verdict: 'not_met', reason: '缺测试证据', evidence: ['tests failed: 1'], engineIteration: 1 },
      );
      const rec2 = iterations.appendIteration(
        { taskId: task.id, goal: task.goal, acceptance: task.acceptance, projectRoot: task.projectRoot },
        {
          verdict: 'met',
          reason: '验收标准满足',
          evidence: ['vitest: 12 passed'],
          outputPath: path.join(os.tmpdir(), 'out-iter2'),
          testResults: 'vitest run: 12 passed',
          engineIteration: 2,
          transition: { from: 'in-progress', to: 'met' },
        },
      );

      const material = collectHandoffMaterial({
        task: queue.get(task.id)!,
        iterations: iterations.replay(task.id),
        snapshot: {
          changedFiles: ['src/fee.ts'],
          tests: ['snapshot: tsc 0'],
          evidence: ['snapshot: exit 0'],
          blockers: ['snapshot blocker'],
        },
      });
      const iter2Output = rec2.iterations[rec2.iterations.length - 1]!.outputPath!;

      expect(material.goal).toBe('实现 computeFee');
      expect(material.taskId).toBe(task.id);
      expect(material.acceptance).toEqual(['导出 computeFee', '测试全绿']);
      expect(material.projectRoot).toBe(path.resolve(path.join(os.tmpdir(), 'p')));
      // met 迭代 → completed
      expect(material.completed).toEqual([expect.stringContaining('iter 2: met')]);
      // not_met 迭代 → blockers（+ 运行侧 snapshot.blockers 透传）
      expect(material.blockers.join('|')).toContain('iter 1: not_met');
      expect(material.blockers).toContain('snapshot blocker');
      // 每条迭代 → decisions；evidence = 迭代 evidence + outputPath + snapshot
      expect(material.decisions).toHaveLength(2);
      expect(material.evidence).toEqual(
        expect.arrayContaining(['tests failed: 1', 'vitest: 12 passed', iter2Output, 'snapshot: exit 0']),
      );
      // tests = snapshot.tests + 迭代 testResults
      expect(material.tests).toContain('snapshot: tsc 0');
      expect(material.tests).toContain('vitest run: 12 passed');
      // next_actions 派生：末次 met → 收尾
      expect(material.next_actions[0]).toContain('验收已 met');
      // current_state = 任务状态 + 迭代数 + snapshot.currentState
      expect(material.current_state).toContain('任务状态：pending');
      expect(material.current_state).toContain('已完成迭代：2');
    } finally {
      fs.rmSync(queueRoot, { recursive: true, force: true });
      fs.rmSync(iterRoot, { recursive: true, force: true });
    }
  });

  it('collectHandoffMaterial 无迭代/无快照时给安全缺省，nextActions 指向第一轮', () => {
    const material = collectHandoffMaterial({
      task: { id: 'task_x', goal: '目标 X', acceptance: [], projectRoot: '/tmp/p', status: 'pending' },
    });
    expect(material.completed).toEqual([]);
    expect(material.changed_files).toEqual([]);
    expect(material.decisions).toEqual([]);
    expect(material.next_actions).toEqual(['开始第一轮迭代（从 handoff.goal 起）']);
    expect(material.current_state).toContain('已完成迭代：0');
  });
});

describe('engine/handoff — 从 handoff 启动（新 Session 恢复，task 067）', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir('cah-handoff-start-');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('seedSessionFromHandoff 向新 Session 注入起始上下文：goal/completed/next_actions + blockers/decisions 透传 + handoff id 可查', async () => {
    const store = new HandoffStore({ handoffsRoot: root });
    const handoff = store.create(fullMaterial(), { now: 5_000, id: 'handoff_5000_11223344' });

    const session = await Session.open({ workspaceRoot: root, sessionId: 'sess_handoff_test' });
    const seeded = await seedSessionFromHandoff(session, handoff);
    try {
      expect(seeded.handoffId).toBe('handoff_5000_11223344');
      expect(seeded.records).toHaveLength(1);
      const record = seeded.records[0]!;
      expect(record.type).toBe('user/message');
      expect((record as { source?: string }).source).toBe('handoff');
      const content = (record as { content: string }).content;
      // 起始上下文注入：goal/completed/next_actions
      expect(content).toContain('goal: 实现 computeFee 并补测试');
      expect(content).toContain('completed:');
      expect(content).toContain('- 完成导出 computeFee');
      expect(content).toContain('next_actions:');
      expect(content).toContain('- 运行全量 vitest');
      // blockers/decisions 透传
      expect(content).toContain('blockers:');
      expect(content).toContain('- 验收需要评审通过');
      expect(content).toContain('decisions:');
      expect(content).toContain('- 采用 decimal 而非 float 计费');
      // current_state/changed_files/tests/evidence 内联可查 + handoff id 可回读持久记录
      expect(content).toContain('current_state:');
      expect(content).toContain('- packages/fee/src/index.ts');
      expect(content).toContain('- vitest run packages/fee: 12 passed');
      expect(content).toContain('handoff-id: handoff_5000_11223344');
      // 会话日志真源可回放（新 Session 首条记录即 handoff 上下文）
      const replay = session.replay();
      expect(replay).toHaveLength(1);
      expect(replay[0]!.type).toBe('user/message');
      // 完整记录持久可查（current_state/changed_files/tests/evidence 全量在 store）
      const stored = store.get(handoff.id)!;
      expect(stored.current_state).toBe('实现已落盘，待验收');
      expect(stored.changed_files).toHaveLength(2);
      expect(stored.tests).toContain('vitest run packages/fee: 12 passed');
      expect(stored.evidence).toContain('12 tests passed');
    } finally {
      await session.close();
    }
  });

  it('handoffStartContext 纯函数：§12 九字段全量内联，空字段给占位', () => {
    const rec = buildHandoff(fullMaterial({ completed: [], blockers: [] }));
    const text = handoffStartContext(rec);
    expect(text).toContain('<handoff-resume>');
    expect(text).toContain('handoff-id:');
    expect(text).toContain('completed:');
    expect(text).toContain('（无）');
    expect(text).toContain('</handoff-resume>');
  });

  it('handoffToTaskSeed 映射 061-064 运行链 LoopTask 形状：goal/acceptance 透传', () => {
    const rec = buildHandoff(fullMaterial());
    const seed = handoffToTaskSeed(rec);
    expect(seed).toEqual({
      id: 'task_1000_aabbccdd',
      goal: '实现 computeFee 并补测试',
      acceptance: ['导出 computeFee', '测试全绿'],
    });
    // 无 taskId 时退化为 handoff id（新任务从 handoff 起跑）
    const noTask = buildHandoff(fullMaterial({ taskId: undefined }));
    expect(handoffToTaskSeed(noTask).id).toBe(noTask.id);
  });
});

describe('engine/handoff — 触发条件（066 budget / 会话长度阈值，task 067）', () => {
  it('shouldGenerateHandoff：budget 比例（0.9 缺省，晚于 Compaction 0.8）触发', () => {
    expect(HANDOFF_THRESHOLD_RATIO).toBeGreaterThan(0.8); // 先 compact 后 reset
    expect(shouldGenerateHandoff(9_000, 10_000, 10)).toEqual({ generate: true, reason: 'budget' });
    expect(shouldGenerateHandoff(8_000, 10_000, 10)).toEqual({ generate: false, reason: null });
    expect(shouldGenerateHandoff(9_000, 10_000, 10, { thresholdRatio: 0.95 })).toEqual({
      generate: false,
      reason: null,
    });
  });

  it('shouldGenerateHandoff：会话长度阈值触发 + force 手动触发 + 非法阈值 fail loud', () => {
    expect(HANDOFF_LENGTH_THRESHOLD).toBe(1500);
    expect(shouldGenerateHandoff(100, 10_000, 1_500)).toEqual({ generate: true, reason: 'length' });
    expect(shouldGenerateHandoff(100, 10_000, 1_499)).toEqual({ generate: false, reason: null });
    expect(shouldGenerateHandoff(100, 10_000, 0, { force: true })).toEqual({ generate: true, reason: 'manual' });
    expect(() => shouldGenerateHandoff(100, 10_000, 0, { thresholdRatio: 1.2 })).toThrow(/thresholdRatio/);
    expect(() => shouldGenerateHandoff(100, 10_000, 0, { lengthThreshold: 0 })).toThrow(/lengthThreshold/);
  });

  it('handoffSeamState：065 Goal UI 可见 seam —— 纯状态（generate/reason/latestHandoffId）', () => {
    const state = handoffSeamState({
      taskId: 'task_1',
      estimateTokens: 9_500,
      contextWindow: 10_000,
      recordCount: 42,
      latestHandoffId: 'handoff_5000_11223344',
    });
    expect(state.generate).toBe(true);
    expect(state.reason).toBe('budget');
    expect(state.taskId).toBe('task_1');
    expect(state.latestHandoffId).toBe('handoff_5000_11223344');
    const idle = handoffSeamState({ estimateTokens: 1_000, contextWindow: 10_000, recordCount: 10 });
    expect(idle.generate).toBe(false);
    expect(idle.reason).toBeNull();
    expect(idle.latestHandoffId).toBeUndefined();
  });
});

describe('engine/handoff — HandoffStore renameWithRetry 收敛（task 114）', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir('cah-handoff-114-');
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('create 在 rename 瞬时 EPERM 下经 helper 有界重试后成功落盘（helper 复用确认）', () => {
    const renameSync = vi.mocked(fs.renameSync);
    renameSync.mockClear();
    renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    renameSync.mockImplementationOnce(() => {
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    });
    const s = new HandoffStore({ handoffsRoot: root });
    const rec = s.create(fullMaterial(), { now: 6_000, id: 'handoff_6000_11223344' });
    expect(rec.id).toBe('handoff_6000_11223344');
    // helper 复用确认：裸 fs.renameSync 第 2 次 EPERM 即抛出；走到 3 次 = renameWithRetry 接管
    expect(renameSync).toHaveBeenCalledTimes(3);
    // 第 3 次真实 rename 生效：跨实例可完整读回
    const fresh = new HandoffStore({ handoffsRoot: root });
    expect(fresh.get(rec.id)!.goal).toBe('实现 computeFee 并补测试');
  });
});
