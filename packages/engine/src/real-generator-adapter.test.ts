import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, PolicyArtifacts } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { LoopEngine, type EvaluateContext, type IterationResult, type LoopTask } from './LoopEngine.js';
import { createTaskQueue, queueSelectTask } from './taskQueue.js';
import { TempDirWorkspaceFactory } from './workspace.js';
import {
  RealGeneratorAdapter,
  scanWorkspaceFiles,
  diffWorkspaceSnapshots,
  type RealGeneratorAdapterOptions,
} from './real-generator-adapter.js';
import type { EvaluatorVerdict } from '@vessel/agents';

const POLICY_YAML = `
policy:
  version: 1
  profile: workspace-write
  approval: never
  filesystem:
    protected: ['.git', '.git/**']
  shell:
    deny: ['destructive-delete']
  tools:
    deny: []
  guidance:
    - 只调用显式允许的工具
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

function tempDir(prefix = 'cah-gen-061-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function prov(text: string): ChatProvider {
  return new MockProvider([{ when: /.*/, response: { text } }], { model: 'pro-model' });
}

/** 只读 stub —— chat 即抛（模拟 provider 中断 / 会话失败路径）。 */
function outageProvider(): ChatProvider {
  return {
    id: 'outage',
    chat: async () => {
      throw new Error('simulated provider outage');
    },
  };
}

function opts(overrides: Partial<RealGeneratorAdapterOptions> = {}): RealGeneratorAdapterOptions {
  return {
    providers: { pro: prov('') },
    policyArtifacts: artifacts(),
    tools: [],
    developerProviderId: 'pro',
    developerModel: 'pro-model',
    ...overrides,
  };
}

describe('engine — RealGeneratorAdapter (task 061)', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('input→output→readback：任务（含验收标准）进 generate seam → 产出文本 + 完整记录可回读', async () => {
    const generator = new RealGeneratorAdapter(
      opts({ providers: { pro: prov('DEV-061: 已实现导出功能，改动 src/out.ts，单测通过。') } }),
    );
    const ctx = {
      task: { id: 't61', goal: '实现导出功能', acceptance: ['AC-1: src/out.ts 导出 run', 'AC-2: 提供测试结果'] } as LoopTask,
      iteration: 1,
      attempt: 1,
      workspace: { root: workspace },
    };
    const output = await generator.generate(ctx);

    // engine seam 契约形状
    expect(output.output).toContain('DEV-061');
    expect(output.artifactPaths).toEqual([]); // developer 只是"声称"文件 —— 磁盘无改动 → 无证据（不自证）
    // 记录回读：taskId/acceptance/session/teamRunId/output 齐全
    expect(generator.runs).toHaveLength(1);
    const rec = generator.lastRun!;
    expect(rec.taskId).toBe('t61');
    expect(rec.goal).toBe('实现导出功能');
    expect(rec.acceptance).toEqual(['AC-1: src/out.ts 导出 run', 'AC-2: 提供测试结果']);
    expect(rec.teamRunId).toMatch(/^team_/);
    expect(rec.developer).not.toBeNull();
    expect(rec.developer!.memberId).toBe('developer');
    expect(rec.developer!.role).toBe('generator');
    expect(rec.developer!.status).toBe('completed');
    expect(rec.developer!.sessionId).toBeTruthy();
    expect(rec.developer!.output).toContain('DEV-061');
    expect(rec.output).toBe(rec.developer!.output);
    expect(rec.iteration).toBe(1);
    expect(rec.attempt).toBe(1);
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('run() 直接入口（不经 engine ctx）同形状产出记录（id/goal/acceptance/workspaceRoot）', async () => {
    const generator = new RealGeneratorAdapter(opts({ providers: { pro: prov('DEV-STANDALONE: done') } }));
    const rec = await generator.run({
      id: 'ts',
      goal: '做一个独立任务',
      acceptance: ['AC-X'],
      workspaceRoot: workspace,
    });
    expect(rec.taskId).toBe('ts');
    expect(rec.output).toContain('DEV-STANDALONE');
    expect(rec.developer!.phase).toBe('generate');
    expect(rec.acceptance).toEqual(['AC-X']);
    expect(generator.runs.map((r) => r.taskId)).toEqual(['ts']);
  });

  it('acceptance 透传形状对齐 LoopTask：developer 收不到验收自评，但记录保留供 Evaluator（062）消费', async () => {
    const generator = new RealGeneratorAdapter(opts({ providers: { pro: prov('DEV: 实现完成') } }));
    const acceptance = ['G1: 功能可用', 'G2: 有测试'];
    const rec = await generator.run({ id: 'ta', goal: '实现', acceptance, workspaceRoot: workspace });
    expect(rec.acceptance).toEqual(acceptance);
    // 单成员 developer 阵容里没有 reviewer —— 记录无 review 字段、无自评结论
    expect(rec.developer!.review).toBeUndefined();
  });

  it('异常路径：无隔离 workspace → 拒绝（真实 developer 必须跑在隔离目录里）', async () => {
    const generator = new RealGeneratorAdapter(opts({ providers: { pro: prov('x') } }));
    await expect(generator.run({ id: 't', goal: 'g', workspaceRoot: '' })).rejects.toThrow(/workspace/);
    await expect(generator.run({ id: 't', goal: 'g', workspaceRoot: workspace + '/does-not-exist' })).rejects.toThrow(/workspace/);
  });

  it('异常路径：developer provider 未绑定 / 非 generator preset → 构造期 fail loud', () => {
    expect(() => new RealGeneratorAdapter(opts({ providers: {}, developerProviderId: 'nope' }))).toThrow(/not bound/);
    expect(() => new RealGeneratorAdapter(opts({ developerPresetId: 'reviewer' }))).toThrow(/generator/);
    expect(() => new RealGeneratorAdapter(opts({ developerProviderId: '' }))).toThrow(/developerProviderId/);
    expect(() => new RealGeneratorAdapter(opts({ developerModel: '  ' }))).toThrow(/developerModel/);
  });

  it('异常路径：developer 会话失败（provider 中断）→ run 拒绝并带阶段错误，不静默产出', async () => {
    const generator = new RealGeneratorAdapter(opts({ providers: { outage: outageProvider() }, developerProviderId: 'outage' }));
    await expect(generator.run({ id: 'tf', goal: '实现', workspaceRoot: workspace })).rejects.toThrow(/failed/);
    expect(generator.runs).toHaveLength(0); // 失败运行不留"成功"记录
  });

  it('证据机制：磁盘改动进入 artifactPaths，排除目录/无改动不算证据（只信盘上事实）', () => {
    const before = scanWorkspaceFiles(workspace);
    // 新建 + 修改 + 排除目录内变化
    fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(workspace, '.harness', 'sessions', 's1'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'src', 'out.ts'), 'export const run = () => 1;\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'node_modules', 'dep.js'), 'changed\n', 'utf8');
    fs.writeFileSync(path.join(workspace, '.harness', 'sessions', 's1', 'session.jsonl'), '{}', 'utf8');
    const after = scanWorkspaceFiles(workspace);

    expect([...after.keys()]).toEqual(['src/out.ts']);
    const changed = diffWorkspaceSnapshots(before, after);
    expect(changed).toEqual(['src/out.ts']);

    // 修改既有文件 → diff 命中；无改动 → 空
    const before2 = scanWorkspaceFiles(workspace);
    fs.writeFileSync(path.join(workspace, 'src', 'out.ts'), 'export const run = () => 2;\n', 'utf8');
    const after2 = scanWorkspaceFiles(workspace);
    expect(diffWorkspaceSnapshots(before2, after2)).toEqual(['src/out.ts']);
    expect(diffWorkspaceSnapshots(after2, after2)).toEqual([]);
  });

  it('默认上限生效（§11.1，maxIterations=1/maxRetries=1）：真 generator 接 LoopEngine —— 恰一次重试、只跑一个任务', async () => {
    const generator = new RealGeneratorAdapter(
      opts({ providers: { pro: prov('DEV-REAL: 实现完成；产出 src/x.ts；测试全绿 GOLDEN-61') } }),
    );
    const queue = createTaskQueue<LoopTask>([
      { id: 't1', goal: '实现真实任务', acceptance: ['GOLDEN-61'] },
      { id: 't2', goal: '第二个任务（不应被消费）', acceptance: [] },
    ]);
    const persisted: IterationResult[] = [];
    const wsFactory = new TempDirWorkspaceFactory('cah-gen-061-loop-');
    const genCalls: number[] = [];
    const engine = new LoopEngine(
      {
        selectTask: queueSelectTask(queue),
        generate: async (ctx) => {
          genCalls.push(ctx.attempt);
          return generator.generate(ctx);
        },
        evaluate: async (ctx: EvaluateContext): Promise<EvaluatorVerdict> =>
          ctx.attempt >= 2 && ctx.generatorOutput.output.includes('GOLDEN-61')
            ? { verdict: 'met', evidence: ['GOLDEN-61 in developer output'], reason: 'acceptance present on retry' }
            : { verdict: 'not_met', evidence: ['attempt gate'], reason: `attempt ${ctx.attempt} review rejects (maxRetries=1 demo)` },
        persist: async (r) => {
          persisted.push(r);
        },
        workspaceFactory: (t) => wsFactory.create(t),
        disposeWorkspace: (ws) => wsFactory.dispose(ws),
      },
      // 不传 maxIterations/maxRetries —— 默认 1/1（§11.1；放宽留 066）
    );

    const report = await engine.run();

    // maxIterations=1：第二个排队任务从未被 select 消费
    expect(report?.iteration).toBe(1);
    expect(report?.taskId).toBe('t1');
    expect(queue.size).toBe(1);
    // maxRetries=1：attempt1 not_met → 恰好一次重试 → attempt2 met
    expect(genCalls).toEqual([1, 2]);
    expect(report?.outcome).toBe('met');
    expect(report?.result.verdict).toBe('met');
    expect(report?.result.retryCount).toBe(2);
    expect(report?.result.metAfterRetries).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.verdict).toBe('met');
    // adapter 历史回读两笔（真实 developer 会话各一次），taskId 均为 t1
    expect(generator.runs).toHaveLength(2);
    expect(generator.runs.map((r) => r.taskId)).toEqual(['t1', 't1']);
    expect(generator.runs.map((r) => r.attempt)).toEqual([1, 2]);
    expect(generator.runs.every((r) => r.developer?.sessionId)).toBe(true);
    expect(generator.runs.every((r) => r.output.includes('GOLDEN-61'))).toBe(true);
  });

  it('默认上限之下 alsoContinue=false：met 后即停（第二任务留在队列，供 063 持久队列接力）', async () => {
    const generator = new RealGeneratorAdapter(opts({ providers: { pro: prov('DEV-OK: 完成 GOLDEN-OK') } }));
    const queue = createTaskQueue<LoopTask>([
      { id: 'q1', goal: '任务一', acceptance: ['GOLDEN-OK'] },
      { id: 'q2', goal: '任务二', acceptance: [] },
    ]);
    const wsFactory = new TempDirWorkspaceFactory('cah-gen-061-stop-');
    const engine = new LoopEngine(
      {
        selectTask: queueSelectTask(queue),
        generate: (ctx) => generator.generate(ctx),
        evaluate: async ({ generatorOutput }): Promise<EvaluatorVerdict> =>
          generatorOutput.output.includes('GOLDEN-OK')
            ? { verdict: 'met', evidence: ['GOLDEN-OK'], reason: 'acceptance present' }
            : { verdict: 'not_met', evidence: [], reason: 'missing' },
        persist: async () => {},
        workspaceFactory: (t) => wsFactory.create(t),
        disposeWorkspace: (ws) => wsFactory.dispose(ws),
      },
      { maxIterations: 1, maxRetries: 1 },
    );
    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    expect(report?.result.retryCount).toBe(1); // 首attempt即met → 无重试
    expect(generator.runs).toHaveLength(1);
    expect(queue.size).toBe(1);
  });

  it('多次调用无跨调用状态泄漏：每次 generate 独立会话，runs 历史按序累积', async () => {
    const generator = new RealGeneratorAdapter(opts({ providers: { pro: prov('DEV: 迭代产出') } }));
    await generator.run({ id: 'a', goal: 'A', workspaceRoot: workspace });
    const ws2 = tempDir();
    try {
      await generator.run({ id: 'b', goal: 'B', workspaceRoot: ws2 });
    } finally {
      fs.rmSync(ws2, { recursive: true, force: true });
    }
    expect(generator.runs.map((r) => r.taskId)).toEqual(['a', 'b']);
    expect(generator.runs[0]!.developer!.sessionId).not.toBe(generator.runs[1]!.developer!.sessionId);
  });
});
