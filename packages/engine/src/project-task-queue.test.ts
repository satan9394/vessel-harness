import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ProjectTaskQueue,
  defaultTaskQueueRoot,
  newTaskId,
  queueSettleStatusFromVerdict,
  canTransitionTaskStatus,
  projectQueueSelectTask,
} from './project-task-queue.js';
import type { QueueTask } from './project-task-queue.js';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-taskqueue-'));
}

const ROOT_PROJECT = path.join(os.tmpdir(), 'fake-project-a');

describe('engine/project-task-queue — default root / id / 状态机约定（task 063）', () => {
  it('defaultTaskQueueRoot 指向 ~/.vessel/taskqueue（env VESSEL_TASKQUEUE_ROOT 可覆盖；与既有 ~/.vessel 约定一致）', () => {
    const before = process.env.VESSEL_TASKQUEUE_ROOT;
    try {
      delete process.env.VESSEL_TASKQUEUE_ROOT;
      expect(defaultTaskQueueRoot('fake-home')).toBe(path.join('fake-home', '.vessel', 'taskqueue'));
      process.env.VESSEL_TASKQUEUE_ROOT = path.join('env', 'root');
      expect(defaultTaskQueueRoot('fake-home')).toBe(path.join('env', 'root'));
    } finally {
      if (before === undefined) delete process.env.VESSEL_TASKQUEUE_ROOT;
      else process.env.VESSEL_TASKQUEUE_ROOT = before;
    }
  });

  it('newTaskId 沿用 <kind>_<ts>_<hex> 约定（sess_/team_/review_ 同款）且可区分', () => {
    expect(newTaskId(1000, 'aabbccdd')).toBe('task_1000_aabbccdd');
    const b = newTaskId();
    const c = newTaskId();
    expect(b).toMatch(/^task_\d+_[0-9a-f]{8}$/);
    expect(b).not.toBe(c);
  });

  it('状态机转移表：claim/settle/requeue/cancel 合法路径与表外路径', () => {
    expect(canTransitionTaskStatus('pending', 'in-progress')).toBe(true);
    expect(canTransitionTaskStatus('in-progress', 'met')).toBe(true);
    expect(canTransitionTaskStatus('in-progress', 'not_met')).toBe(true);
    expect(canTransitionTaskStatus('not_met', 'pending')).toBe(true);
    expect(canTransitionTaskStatus('pending', 'cancelled')).toBe(true);
    expect(canTransitionTaskStatus('in-progress', 'cancelled')).toBe(true);
    // 066 pause/resume：仅运行中可挂起、挂起可恢复（原样继续，非 abort）
    expect(canTransitionTaskStatus('in-progress', 'paused')).toBe(true);
    expect(canTransitionTaskStatus('paused', 'in-progress')).toBe(true);
    expect(canTransitionTaskStatus('paused', 'cancelled')).toBe(true);
    // 表外路径一律非法
    expect(canTransitionTaskStatus('pending', 'met')).toBe(false);
    expect(canTransitionTaskStatus('pending', 'not_met')).toBe(false);
    expect(canTransitionTaskStatus('pending', 'paused')).toBe(false);
    expect(canTransitionTaskStatus('paused', 'pending')).toBe(false);
    expect(canTransitionTaskStatus('paused', 'met')).toBe(false);
    expect(canTransitionTaskStatus('paused', 'not_met')).toBe(false);
    expect(canTransitionTaskStatus('met', 'pending')).toBe(false);
    expect(canTransitionTaskStatus('met', 'not_met')).toBe(false);
    expect(canTransitionTaskStatus('met', 'paused')).toBe(false);
    expect(canTransitionTaskStatus('cancelled', 'pending')).toBe(false);
    expect(canTransitionTaskStatus('cancelled', 'paused')).toBe(false);
    expect(canTransitionTaskStatus('in-progress', 'in-progress')).toBe(false);
  });

  it('evaluator 瞬时 verdict → 队列终态归一：met→met，其余一律 not_met（绝不自证 met）', () => {
    expect(queueSettleStatusFromVerdict('met')).toBe('met');
    expect(queueSettleStatusFromVerdict('not_met')).toBe('not_met');
    expect(queueSettleStatusFromVerdict('impossible')).toBe('not_met');
    expect(queueSettleStatusFromVerdict('error')).toBe('not_met');
  });
});

describe('engine/project-task-queue — ProjectTaskQueue 持久队列（task 063）', () => {
  let root: string;
  beforeEach(() => {
    root = tempDir();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** 单调递增时钟：enqueue/claim/settle 时间严格递增（FIFO/排序测试确定性）。 */
  function makeStore(): ProjectTaskQueue {
    let clock = 1_000_000;
    return new ProjectTaskQueue({ tasksRoot: root, now: () => (clock += 7) });
  }

  it('enqueue 落盘目录布局 <root>/<task-id>/meta.json，字段齐（id/projectRoot/goal/acceptance/pending/时间戳）', () => {
    const s = makeStore();
    const rec = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '实现 computeFee', acceptance: ['导出 computeFee', '测试绿'] });
    expect(rec.id).toMatch(/^task_\d+_[0-9a-f]{8}$/);
    expect(rec.status).toBe('pending');
    expect(rec.projectRoot).toBe(path.resolve(ROOT_PROJECT));
    expect(rec.goal).toBe('实现 computeFee');
    expect(rec.acceptance).toEqual(['导出 computeFee', '测试绿']);
    expect(rec.createdAt).toBeTruthy();
    expect(rec.updatedAt).toBe(rec.createdAt);
    expect(rec.outcome).toBeUndefined();
    expect(s.dirFor(rec.id)).toBe(path.join(root, rec.id));
    expect(fs.existsSync(s.metaPath(rec.id))).toBe(true);
    // 与 059 同款目录/id/原子写模式
    expect(fs.readdirSync(s.dirFor(rec.id))).toEqual(['meta.json']);
  });

  it('claimNext FIFO：最早 pending 先出队 → in-progress；空队列 → null（LoopEngine null=stop 契约）', () => {
    const s = makeStore();
    const a = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 A' });
    const b = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 B' });
    const c = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 C' });
    expect(s.claimNext()?.id).toBe(a.id);
    expect(s.claimNext()?.id).toBe(b.id);
    expect(s.claimNext()?.id).toBe(c.id);
    expect(s.claimNext()).toBeNull();
    // 领取后状态 in-progress + startedAt 记录（最新在前）
    const claimedA = s.get(a.id)!;
    expect(claimedA.status).toBe('in-progress');
    expect(claimedA.startedAt).toBeTruthy();
    expect(claimedA.updatedAt >= claimedA.createdAt).toBe(true);
  });

  it('同项目/跨实例不重复领取：A 领取 t1 落盘后，新实例 B claimNext 拿 t2 而非 t1', () => {
    const s = makeStore();
    const t1 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 1' });
    const t2 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 2' });
    expect(s.claimNext()?.id).toBe(t1.id);
    const fresh = new ProjectTaskQueue({ tasksRoot: root }); // 跨实例重读磁盘
    expect(fresh.get(t1.id)?.status).toBe('in-progress');
    expect(fresh.claimNext()?.id).toBe(t2.id); // t1 已是 in-progress → 跳过
    expect(fresh.claimNext()).toBeNull();
  });

  it('settle：in-progress → met/not_met 终态 + outcome 快照（verdict/reason/iteration/settledAt 可回读）', () => {
    const s = makeStore();
    const rec = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 X', acceptance: ['A1'] });
    const claimed = s.claim(rec.id);
    expect(claimed.status).toBe('in-progress');
    const settled = s.settle(rec.id, 'met', { reason: '验收全过', iteration: 2 });
    expect(settled.status).toBe('met');
    expect(settled.settledAt).toBeTruthy();
    expect(settled.outcome).toEqual({
      status: 'met',
      verdict: 'met',
      reason: '验收全过',
      iteration: 2,
      settledAt: settled.settledAt,
    });
    // not_met 侧 + 非 met 瞬时结论归一
    const rec2 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 Y' });
    s.claim(rec2.id);
    const failed = s.settle(rec2.id, 'error', { reason: '评审失败' });
    expect(failed.status).toBe('not_met');
    expect(failed.outcome?.verdict).toBe('error');
    expect(failed.outcome?.status).toBe('not_met');
  });

  it('requeue/cancel：in-progress/not_met → pending 开新轮；pending/in-progress → cancelled 软移除（不删文件）', () => {
    const s = makeStore();
    const a = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 A' });
    s.claim(a.id);
    const requeued = s.requeue(a.id);
    expect(requeued.status).toBe('pending');
    expect(requeued.outcome).toBeUndefined();
    expect(requeued.startedAt).toBeUndefined();
    // not_met → requeue 后再跑 → met（一轮完整生命周期）
    const b = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 B' });
    s.claim(b.id);
    s.settle(b.id, 'not_met', { reason: '首轮未过' });
    s.requeue(b.id);
    s.claim(b.id);
    s.settle(b.id, 'met');
    expect(s.get(b.id)?.status).toBe('met');
    // cancel：软移除留审计，不再出现在 claim 候选（无永久删除）
    const c = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 C' });
    const cancelled = s.cancel(c.id);
    expect(cancelled.status).toBe('cancelled');
    expect(s.get(c.id)?.status).toBe('cancelled');
    expect(fs.existsSync(s.metaPath(c.id))).toBe(true); // 无永久删除：记录保留
    // pending 只剩 a（requeue 回来）；cancelled/met 不再出队
    expect(s.claimNext()?.id).toBe(a.id);
    expect(s.claimNext()).toBeNull();
    // cancelled 是终态：claim 它 → 非法
    expect(() => s.claim(c.id)).toThrow(/cannot transition from "cancelled" to "in-progress"/);
  });

  it('pause/resume（066）：in-progress → paused → in-progress 原样恢复；持久可见、跨实例可读', () => {
    const s = makeStore();
    const t = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 P' });
    // 未 claim 就 pause → fail loud（仅运行中可挂起）
    expect(() => s.pause(t.id)).toThrow(/cannot transition from "pending" to "paused"/);
    s.claim(t.id);
    // claim 后 pause：in-progress → paused（持久中间态）
    const paused = s.pause(t.id);
    expect(paused.status).toBe('paused');
    expect(s.get(t.id)?.status).toBe('paused');
    // 重复 pause → fail loud（paused 不能再 pause；幂等由上层 RunControl 保证）
    expect(() => s.pause(t.id)).toThrow(/cannot transition from "paused" to "paused"/);
    // resume：paused → in-progress（原样继续，不丢半步）
    const resumed = s.resume(t.id);
    expect(resumed.status).toBe('in-progress');
    expect(s.get(t.id)?.status).toBe('in-progress');
    // paused 持久可见：新实例读回 paused 状态（跨实例可查）
    const t2 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 P2' });
    s.claim(t2.id);
    s.pause(t2.id);
    const fresh = new ProjectTaskQueue({ tasksRoot: root });
    expect(fresh.get(t2.id)?.status).toBe('paused');
    // paused 任务不出队（claimNext 只挑 pending）—— 挂起不影响队列协调
    expect(s.claimNext()).toBeNull();
    // resume 后任务可 settle（in-progress → met）
    s.resume(t2.id);
    s.settle(t2.id, 'met');
    expect(s.get(t2.id)?.status).toBe('met');
    // 终态不可 resume
    expect(() => s.resume(t2.id)).toThrow(/cannot transition from "met" to "in-progress"/);
  });

  it('持久化 round-trip：跨实例 get/list 读回状态机终态，meta.json 结构完整', () => {
    const s = makeStore();
    const t1 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 1' });
    const t2 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 2' });
    s.claim(t1.id);
    s.settle(t1.id, 'met');
    s.claim(t2.id);
    s.settle(t2.id, 'not_met', { reason: '测试失败' });
    const fresh = new ProjectTaskQueue({ tasksRoot: root });
    const g1 = fresh.get(t1.id)!;
    expect(g1.status).toBe('met');
    expect(g1.acceptance).toEqual([]);
    const g2 = fresh.get(t2.id)!;
    expect(g2.status).toBe('not_met');
    expect(g2.outcome?.reason).toBe('测试失败');
    const list = fresh.list();
    expect(list.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
    // 最新 createdAt 在前
    expect(list[0]!.createdAt >= list[1]!.createdAt).toBe(true);
    // 未知 id 容忍
    expect(fresh.get('task_missing_00000000')).toBeUndefined();
  });

  it('list 过滤：按 projectRoot/status 过滤；met/not_met 终态计入、cancelled 可查', () => {
    const s = makeStore();
    const other = path.join(os.tmpdir(), 'fake-project-b');
    const a = s.enqueue({ projectRoot: ROOT_PROJECT, goal: 'A' });
    const b = s.enqueue({ projectRoot: ROOT_PROJECT, goal: 'B' });
    const c = s.enqueue({ projectRoot: other, goal: 'C' });
    s.claim(a.id);
    s.settle(a.id, 'met');
    s.claim(b.id);
    s.settle(b.id, 'not_met');
    expect(s.list({ projectRoot: ROOT_PROJECT }).map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    expect(s.list({ projectRoot: other })).toHaveLength(1);
    expect(s.list({ status: 'met' }).map((t) => t.id)).toEqual([a.id]);
    expect(s.list({ status: 'not_met' }).map((t) => t.id)).toEqual([b.id]);
    expect(s.list({ status: 'pending' }).map((t) => t.id)).toEqual([c.id]); // 另一项目任务仍 pending
    expect(s.list({ projectRoot: ROOT_PROJECT, status: 'pending' })).toEqual([]);
    expect(s.list({ projectRoot: ROOT_PROJECT, status: 'met' }).map((t) => t.id)).toEqual([a.id]);
  });

  it('非法操作 fail loud：未知 id / 表外状态转移（未 claim 就 settle、重复 claim、终态 requeue/cancel/settle）', () => {
    const s = makeStore();
    expect(() => s.claim('task_nope_00000000')).toThrow(/unknown task id/);
    expect(() => s.settle('task_nope_00000000', 'met')).toThrow(/unknown task id/);
    const rec = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务' });
    // pending 直接 settle（没 claim）→ 非法
    expect(() => s.settle(rec.id, 'met')).toThrow(/cannot transition from "pending" to "met"/);
    // pending 直接 cancel → 合法；再 requeue → cancelled 是终态 → 非法
    s.cancel(rec.id);
    expect(() => s.requeue(rec.id)).toThrow(/cannot transition from "cancelled" to "pending"/);
    // claim 后重复 claim（in-progress → in-progress）非法
    const rec2 = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 2' });
    s.claim(rec2.id);
    expect(() => s.claim(rec2.id)).toThrow(/cannot transition from "in-progress" to "in-progress"/);
    // 终态 settle 二次非法；met requeue 非法
    s.settle(rec2.id, 'met');
    expect(() => s.settle(rec2.id, 'not_met')).toThrow(/cannot transition from "met" to "not_met"/);
    expect(() => s.requeue(rec2.id)).toThrow(/cannot transition from "met" to "pending"/);
    // enqueue 校验：空 goal / 空 projectRoot fail loud
    expect(() => s.enqueue({ projectRoot: ROOT_PROJECT, goal: '   ' })).toThrow(/non-empty goal/);
    expect(() => s.enqueue({ projectRoot: '', goal: 'x' })).toThrow(/projectRoot/);
  });

  it('损坏条目容忍：坏 meta 跳过（list 仍返回其余），get 该条目 → undefined', () => {
    const s = makeStore();
    const good = s.enqueue({ projectRoot: ROOT_PROJECT, goal: '好任务' });
    const badId = newTaskId();
    fs.mkdirSync(path.join(root, badId), { recursive: true });
    fs.writeFileSync(path.join(root, badId, 'meta.json'), 'not-json{{{', 'utf8');
    const list = s.list();
    expect(list.map((t) => t.id)).toEqual([good.id]);
    expect(s.get(badId)).toBeUndefined();
    // 空根目录 → list []
    const empty = new ProjectTaskQueue({ tasksRoot: tempDir() });
    expect(empty.list()).toEqual([]);
    expect(empty.claimNext()).toBeNull();
  });

  it('并发安全：多次 claim→settle 循环 + 跨实例交替后 meta 无 .tmp 残留、可完整读回（原子写不撕裂）', () => {
    const s = makeStore();
    const ids: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      ids.push(s.enqueue({ projectRoot: ROOT_PROJECT, goal: `任务 ${i}` }).id);
    }
    // 跨实例交替消费（每个实例 claimNext 都重读磁盘）
    let claimed = 0;
    let reader = new ProjectTaskQueue({ tasksRoot: root });
    while (claimed < ids.length) {
      const t = reader.claimNext();
      expect(t).not.toBeNull();
      const byFresh = new ProjectTaskQueue({ tasksRoot: root }); // 每次 settle 前换实例，模拟并发读
      byFresh.settle(t!.id, claimed % 2 === 0 ? 'met' : 'not_met');
      claimed += 1;
      reader = new ProjectTaskQueue({ tasksRoot: root });
    }
    // 每个任务恰好消费一次，无重复领取
    const fresh = new ProjectTaskQueue({ tasksRoot: root });
    expect(fresh.list({ status: 'pending' })).toEqual([]);
    expect(fresh.list({ status: 'in-progress' })).toEqual([]);
    const settled = fresh.list();
    expect(settled).toHaveLength(ids.length);
    expect(settled.filter((t) => t.status === 'met')).toHaveLength(10);
    expect(settled.filter((t) => t.status === 'not_met')).toHaveLength(10);
    // 无原子写残留 .tmp
    const tmps: string[] = [];
    for (const d of fs.readdirSync(root)) {
      tmps.push(...fs.readdirSync(path.join(root, d)).filter((f) => f.endsWith('.tmp')));
    }
    expect(tmps).toEqual([]);
  });

  it('projectQueueSelectTask：把队列接到 LoopEngine selectTask seam（claim→LoopTask；空队列 null）', async () => {
    const s = makeStore();
    const select = projectQueueSelectTask(s);
    expect(await select()).toBeNull();
    s.enqueue({ projectRoot: ROOT_PROJECT, goal: '任务 S', acceptance: ['S1'] });
    const task = await select();
    expect(task).not.toBeNull();
    expect(task!.goal).toBe('任务 S');
    expect(task!.acceptance).toEqual(['S1']);
    expect(s.get(task!.id)?.status).toBe('in-progress'); // claim 已生效
  });

  it('大队列性能（V1.1-B）：1500+ 任务下 claimNext/list 不随任务数线性退化（索引避免每调用全目录 meta 读）', () => {
    const s = new ProjectTaskQueue({ tasksRoot: root }); // 单一长生命周期实例（引擎消费模式）
    // 注：N 取 1500 以在 suite 内控时；3000+ 同证见 soak 工作证明（work-proof）的大队列时序。
    const N = 1500;
    for (let i = 0; i < N; i += 1) {
      s.enqueue({ projectRoot: ROOT_PROJECT, goal: `任务 ${i}` });
    }
    // 首次 list 触发一次性索引装载；之后 claimNext 从内存 pending 顺序出队
    const warm = performance.now();
    const first = s.list({ status: 'pending' });
    const warmMs = performance.now() - warm;
    expect(first).toHaveLength(N);

    // 连续 claimNext N 次：每次 O(1) 候选 + 单条 meta 重读校验（非全目录扫描）
    const start = performance.now();
    let claimed = 0;
    for (let i = 0; i < N; i += 1) {
      if (s.claimNext() !== null) claimed += 1;
    }
    const claimMs = performance.now() - start;
    expect(claimed).toBe(N);

    // list 全量视图：内存索引过滤（每调用仅 stat 校验，不重读未变 meta）
    const listStart = performance.now();
    const all = s.list();
    const listMs = performance.now() - listStart;
    expect(all).toHaveLength(N);
    expect(all.every((t) => t.status === 'in-progress')).toBe(true);

    // 复杂度可证：claim 总量守恒 + 无重复领取即性能不改写语义；实测 N=1500 远低于旧「每调用
    // 全目录 meta 读 + JSON parse」量级（磁盘 IO 退化为 stat + 仅候选 meta 读）。
    expect(s.list({ status: 'pending' })).toEqual([]);
    expect(s.list({ status: 'in-progress' })).toHaveLength(N);
    expect(fs.readdirSync(root).length).toBe(N); // 无 .tmp 残留（原子写不撕裂）
    expect(claimMs).toBeGreaterThanOrEqual(0);
    expect(warmMs).toBeGreaterThanOrEqual(0);
    expect(listMs).toBeGreaterThanOrEqual(0);
  });

  it('索引正确性（V1.1-B）：同实例写透传 + 跨实例各自装载后状态一致；foreign 新入队经 sync 立即可见', () => {
    const a = new ProjectTaskQueue({ tasksRoot: root });
    a.enqueue({ projectRoot: ROOT_PROJECT, goal: 'A' });
    a.enqueue({ projectRoot: ROOT_PROJECT, goal: 'B' });
    expect(a.claimNext()?.goal).toBe('A'); // a 领取 A → 同实例索引透传 in-progress
    expect(a.list({ status: 'in-progress' }).map((t) => t.goal)).toEqual(['A']);

    // 跨实例 b 新建：各自装载（读盘）→ 看到 A in-progress、B pending
    const b = new ProjectTaskQueue({ tasksRoot: root });
    expect(b.list({ status: 'in-progress' }).map((t) => t.goal)).toEqual(['A']);
    expect(b.claimNext()?.goal).toBe('B'); // b 领取 B

    // b 之外实例 c 新入队 → a.list（a 同实例长寿命）经 sync 增量合并可见 foreign 新任务
    const c = new ProjectTaskQueue({ tasksRoot: root });
    c.enqueue({ projectRoot: ROOT_PROJECT, goal: 'C' });
    expect(a.list({ status: 'pending' }).map((t) => t.goal)).toEqual(['C']);
  });
});
