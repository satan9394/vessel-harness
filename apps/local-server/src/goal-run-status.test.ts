import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { IterationStore, ProjectTaskQueue } from '@vessel/engine';
import { ProjectRegistry, SessionRegistry } from '@vessel/application';
import type { ChatProvider, ChatRequest, ChatResponse } from '@vessel/shared';
import { createVesselServer, goalRunStatusFor, type VesselServer } from './server.js';
import { GoalSeam } from './goalSeam.js';
import type { GoalRunResult } from './goalSeam.js';

/**
 * BRIEF-21（失败被上报为成功 · HTTP 面 · Goal run）—— `POST /api/goal/tasks/:id/run`
 * 对**结构性失败**曾恒回 **HTTP 200**：`GoalSeam.runTask` 用同一个 `GoalRunResult` 承载两种
 * 完全不同的结局，而路由（改前 `server.ts:632`）只无条件 `json(res, 200, { result })`：
 *
 * - 领域裁决（`outcome` = `met` / `not_met` / `stopped`）：run **跑完了**，迭代已 persist、
 *   队列已 settle —— 「评估结论未达成」不是运行失败；
 * - **结构性失败**（`outcome` = `error`）：`goalSeam.ts:329-345` 的 catch —— generate /
 *   evaluate / 工作区抛异常，run **根本没跑完**，任务被 `queue.requeue` 退回 pending 等重试，
 *   原因落在 `error` 字段上（`'error'` 只由那个 catch 产出，见 `goalSeam.ts:83`）。
 *
 * 只看状态码的客户端（`curl -f`、fetch 的 `res.ok`、HTTP 中间件）因此把"跑崩了、被 requeue"
 * 读成和"跑完了、结论 not_met"一样的成功。本文件把裁决钉死：`error` ⇒ 500（与
 * `turnStatusFor('error')` 同族），`met`/`not_met`/`stopped` ⇒ 200 且 **body 逐字不变**。
 *
 * 用例全部走**真实生产路径**：HTTP → 路由 → `GoalSeam.runTask` → LoopEngine（真实
 * RealGeneratorAdapter / RealEvaluatorAdapter / TempDirWorkspaceFactory），只有注入的
 * `ChatProvider` 是假的（不碰真实网络、不碰真实模型、不碰 `~/.vessel`）。
 *
 * 「删哪行会红」逐条写在每个 `it` 的注释里；判别性的核心是 ① 与 ②：
 * ① 钉住 error ⇒ 非 2xx（旧实现 `json(res, 200, …)` 恒 200 ⇒ 红），
 * ② 是**负对照** —— met / not_met / stopped 必须仍是 200 且 body 逐字不变
 * （"把所有结论都变成错误码"的实现在 ② 红）。
 */

const POLICY = path.resolve('configs/policy.default.yaml');

/**
 * 确定性 provider：每次 `chat()` 直接返回给定文本。generator（developer 成员）与
 * evaluator（reviewer 成员）跑在同一个 providerId 上，因此这一句话同时充当
 * 「产出文本」与「评审结论 JSON」—— 由调用方按用例需要喂 met / not_met 结论。
 */
class ScriptedProvider implements ChatProvider {
  readonly id = 'scripted';
  calls = 0;
  constructor(private readonly reply: string) {}

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    return {
      content: this.reply,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens: 1, outputTokens: 1 },
    };
  }
}

/**
 * 结构性失败注入：模型调用直接抛错。不实现 `stream()` ⇒ 走 `chat()` 分支，抛点唯一。
 *
 * 传导链（每一跳都能在源码里核对）：`RealGeneratorAdapter.run` → `TeamRuntime.runTeam`
 * 捕获成员失败 ⇒ `outcome !== 'completed'` ⇒ `fail('developer run failed: …')`
 * （real-generator-adapter.ts:293-296）⇒ 异常穿过 `LoopEngine.runTask` / `engine.run()`
 * ⇒ `GoalSeam.runTask` 的 catch（goalSeam.ts:329-345）⇒ `{ outcome: 'error', error }`。
 */
class ThrowingProvider implements ChatProvider {
  readonly id = 'throwing';
  calls = 0;

  async chat(_request: ChatRequest): Promise<ChatResponse> {
    this.calls += 1;
    throw new Error('BOOM: model call exploded');
  }
}

/**
 * ②d 专用的 seam 替身：`'stopped'` 在**真实链路**上不可达 —— `goalSeam.ts:327` 把
 * LoopEngine 的 `'stopped'` 折叠成 `'not_met'`（`report?.outcome === 'met' ? 'met' : 'not_met'`）。
 * 这个替身**只覆盖 `runTask` 的返回值**（一个字段），被测的路由本身仍是生产代码，
 * 目的仅是给"负对照"补上这一档 outcome。
 */
class StoppedOutcomeSeam extends GoalSeam {
  override async runTask(taskId: string): Promise<GoalRunResult> {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`goal seam: unknown task id "${taskId}"`);
    return { queueTask: task, outcome: 'stopped' };
  }
}

interface Harness {
  dir: string;
  ws: string;
  server: VesselServer;
  base: string;
}

const started: Harness[] = [];

/** 起一个真实 local server：注入假 provider + 落在 os.tmpdir() 下的队列/迭代库。 */
async function startServer(
  provider: ChatProvider,
  makeSeam?: (dir: string) => GoalSeam,
): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-goal-run-status-'));
  const ws = path.join(dir, 'workspace');
  const home = path.join(dir, 'vessel-home');
  fs.mkdirSync(ws, { recursive: true });

  const goalSeam =
    makeSeam?.(dir) ??
    new GoalSeam({
      queue: new ProjectTaskQueue({ tasksRoot: path.join(dir, 'taskqueue') }),
      iterations: new IterationStore({ iterationsRoot: path.join(dir, 'iterations') }),
    });

  const server = createVesselServer({
    port: 0,
    projectRegistry: new ProjectRegistry({ vesselHome: home }),
    sessionRegistry: new SessionRegistry({ vesselHome: home }),
    goalSeam,
    // 生产组合根在 CLI 侧注入真实 providers；这里注入确定性假 provider（同一个 id
    // `mock`，路由把它作为 developer/reviewer 的 providerId）。
    teamProviders: { mock: provider },
    policySystemPath: POLICY,
    staticDir: ws,
  });
  await server.listen();

  const h: Harness = { dir, ws, server, base: `http://127.0.0.1:${server.port}` };
  started.push(h);
  return h;
}

afterEach(async () => {
  while (started.length > 0) {
    const h = started.pop()!;
    await h.server.close();
    // 测试自建、位于 os.tmpdir() 之下的临时目录（AGENTS.md 书面例外）
    fs.rmSync(h.dir, { recursive: true, force: true });
  }
});

async function enqueue(h: Harness, projectRoot: string = h.ws): Promise<string> {
  const res = await fetch(`${h.base}/api/goal/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectRoot, goal: '跑一次真实链路', acceptance: ['AC-1 能运行'] }),
  });
  expect(res.status).toBe(201);
  const { task } = (await res.json()) as { task: { id: string } };
  return task.id;
}

function runGoalTask(h: Harness, id: string): Promise<Response> {
  return fetch(`${h.base}/api/goal/tasks/${id}/run`, { method: 'POST' });
}

interface RunBody {
  result: {
    outcome: string;
    error?: string;
    queueTask: { status: string; id: string };
    entry?: unknown;
    record?: unknown;
  };
}

describe('BRIEF-21 — goal run outcome → HTTP status (only the structural error is a failure)', () => {
  it('① 结构性失败（outcome=error）⇒ 500（旧实现恒 200 ⇒ 删掉 goalRunStatusFor 的 error 分支即红），body 仍带 outcome/error', async () => {
    const provider = new ThrowingProvider();
    const h = await startServer(provider);
    const id = await enqueue(h);

    const res = await runGoalTask(h, id);
    const raw = await res.text();
    const body = JSON.parse(raw) as RunBody;

    // 核心判据：只看状态码的客户端（curl -f / res.ok / HTTP 中间件）必须看到失败
    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);

    // body 形状**不变**：仍是 `{ result }`，没有被换成 `{ error: 'goal_run_failed', message }`
    // （后者属于"run 压根没跑起来"，见用例 ③b —— 修法不得把它挪过来）
    expect(Object.keys(body)).toEqual(['result']);
    expect(raw.startsWith('{"result":')).toBe(true);

    // 结构性失败的事实不丢：outcome='error' + 原因文本原样在 result.error 里
    expect(body.result.outcome).toBe('error');
    expect(typeof body.result.error).toBe('string');
    expect(body.result.error).toContain('developer run failed');

    // 结构性失败的旁证①：任务被 requeue 回 pending（等下一轮重试），不是终态
    expect(body.result.queueTask.id).toBe(id);
    expect(body.result.queueTask.status).toBe('pending');

    // 结构性失败的旁证②：run 没跑完 ⇒ 没有迭代 entry/record（那两条只在跑完时出现）
    expect(body.result.entry).toBeUndefined();
    expect(body.result.record).toBeUndefined();

    // 旁证③：失败确实来自模型调用（provider 被真的调用过），不是别处提前炸的
    expect(provider.calls).toBeGreaterThan(0);
  }, 30000);

  it('②a 负对照：outcome=met ⇒ 200 且 body 逐字不变（"一切都变错误码"的实现会红）', async () => {
    const provider = new ScriptedProvider('{"verdict":"met","evidence":["GOLDEN"],"reason":"ok"}');
    const h = await startServer(provider);
    const id = await enqueue(h);

    const res = await runGoalTask(h, id);
    const raw = await res.text();
    const body = JSON.parse(raw) as RunBody;

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(body.result.outcome).toBe('met');
    expect(body.result.queueTask.status).toBe('met');

    // 逐字：仍然是改前的 `json(res, 200, { result })` —— 一个字段都没加/没改/没换包装
    expect(raw).toBe(JSON.stringify({ result: body.result }));
    expect(Object.keys(body)).toEqual(['result']);
    expect(Object.keys(body.result).sort()).toEqual(['entry', 'outcome', 'queueTask', 'record']);
    // 成功路径不得凭空多出 `error` 字段
    expect(body.result.error).toBeUndefined();
  }, 30000);

  it('②b 负对照：outcome=not_met ⇒ 200 且 body 逐字不变（领域裁决不是失败）', async () => {
    const provider = new ScriptedProvider(
      '{"verdict":"not_met","unmet":["AC-1"],"suggestions":[],"reason":"缺证据","evidence":[]}',
    );
    const h = await startServer(provider);
    const id = await enqueue(h);

    const res = await runGoalTask(h, id);
    const raw = await res.text();
    const body = JSON.parse(raw) as RunBody;

    // 「结论未达成」必须仍是成功响应：把它也变成 5xx 是把一种坏换成另一种坏
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(body.result.outcome).toBe('not_met');
    expect(body.result.queueTask.status).toBe('not_met');
    expect(raw).toBe(JSON.stringify({ result: body.result }));
    expect(Object.keys(body)).toEqual(['result']);
    expect(Object.keys(body.result).sort()).toEqual(['entry', 'outcome', 'queueTask', 'record']);
  }, 30000);

  it('②c 映射表逐条钉死（唯一决策点：只有 error 非 2xx）', () => {
    // 删掉 goalRunStatusFor 里 `outcome === 'error' ? 500 : 200` 的 500 分支 ⇒ 本行红；
    // 把它写成"一律 500"⇒ 后三行红。
    expect(goalRunStatusFor('error')).toBe(500);
    expect(goalRunStatusFor('met')).toBe(200);
    expect(goalRunStatusFor('not_met')).toBe(200);
    expect(goalRunStatusFor('stopped')).toBe(200);
  });

  it('②d 负对照（HTTP 面）：outcome=stopped ⇒ 200 且 body 逐字不变', async () => {
    // 'stopped' 在真实链路上被 goalSeam.ts:327 折叠成 'not_met'，故这里用 seam 替身
    // （只覆盖 runTask 的返回值）补齐这一档；路由侧仍是被测的生产代码。
    const h = await startServer(
      new ScriptedProvider('unused — runTask is overridden by the seam double'),
      (dir) =>
        new StoppedOutcomeSeam({
          queue: new ProjectTaskQueue({ tasksRoot: path.join(dir, 'taskqueue') }),
          iterations: new IterationStore({ iterationsRoot: path.join(dir, 'iterations') }),
        }),
    );
    const id = await enqueue(h);

    const res = await runGoalTask(h, id);
    const raw = await res.text();
    const body = JSON.parse(raw) as RunBody;

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(body.result.outcome).toBe('stopped');
    expect(raw).toBe(JSON.stringify({ result: body.result }));
    expect(Object.keys(body)).toEqual(['result']);
    expect(Object.keys(body.result).sort()).toEqual(['outcome', 'queueTask']);
  });

  it('③a 既有 404 分支逐字不变（未知任务 → goal_task_not_found，不是 500/400）', async () => {
    const h = await startServer(new ThrowingProvider());

    const res = await runGoalTask(h, 'nope');
    const raw = await res.text();

    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    // 逐字：字段名/数量/键序与改前一致
    expect(raw).toBe('{"error":"goal_task_not_found","taskId":"nope"}');
  });

  it('③b 既有 400 分支逐字不变（runTask 自身抛出：工作区不存在 → goal_run_failed）', async () => {
    const h = await startServer(new ThrowingProvider());
    // projectRoot 指向一个不存在的目录 ⇒ runTask 在**进 try 之前**就抛
    // （goalSeam.ts:230-232），走路由的 catch ⇒ 400，绝不能被本卡的修复挪成 500
    const id = await enqueue(h, path.join(h.dir, 'no-such-workspace'));

    const res = await runGoalTask(h, id);
    const raw = await res.text();
    const body = JSON.parse(raw) as { error: string; message: string };

    expect(res.status).toBe(400);
    expect(Object.keys(body)).toEqual(['error', 'message']);
    expect(body.error).toBe('goal_run_failed');
    expect(body.message).toContain('owning project workspace does not exist');
  });
});
