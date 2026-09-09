import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, ChatRequest, ChatResponse, PolicyArtifacts } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { parseReviewConclusion, PresetRegistry } from '@vessel/agents';
import { LoopEngine, type EvaluateContext, type IterationResult, type LoopTask } from './LoopEngine.js';
import { createTaskQueue, queueSelectTask } from './taskQueue.js';
import { TempDirWorkspaceFactory } from './workspace.js';
import { RealGeneratorAdapter } from './real-generator-adapter.js';
import { RealEvaluatorAdapter, type RealEvaluatorAdapterOptions } from './real-evaluator-adapter.js';

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

function tempDir(prefix = 'cah-eval-062-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function textResponse(text: string): ChatResponse {
  return { content: text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 10, outputTokens: 10 } };
}

/** 评审结论 JSON —— 形状与 058 TeamReviewConclusion 一致（测试里 mock reviewer 的输出）。 */
const MET_JSON = JSON.stringify({
  verdict: 'met',
  evidence: ['src/out.ts 导出存在'],
  reason: '产出满足验收标准',
  unmet: [],
  suggestions: [],
});
const NOT_MET_JSON = JSON.stringify({
  verdict: 'not_met',
  unmet: ['src/out.ts 未导出 run（AC-062 未满足）'],
  suggestions: ['补 export run 并加单测'],
  reason: '初版产出未满足验收标准',
  evidence: ['src/out.ts'],
});

/** 验收标准（评审判据来源 —— 独立于 generator 产出措辞，可区分断言）。 */
const ACCEPTANCE = ['AC-062: src/out.ts 导出 run'];
/** 产出满足标记：只出现在"达标的 generator 产出"里，不出现在验收标准文本中。 */
const SATISFIED = 'AC-062 满足';
const SATISFIED_OUTPUT = `DEV: src/out.ts 已导出 run（${SATISFIED}），单测 3/3 通过`;
const UNSATISFIED_OUTPUT = 'DEV: 初版草稿 —— src/out.ts 尚未导出 run，无测试';

/** content-gated reviewer：prompt 命中满足标记 → met，否则 fallback not_met（判据由内容驱动）。 */
function gatedReviewer(metNeedle: RegExp | string, metText = MET_JSON, notMetText = NOT_MET_JSON): ChatProvider {
  return new MockProvider([{ when: metNeedle, response: { text: metText } }], { model: 'rev-model', fallbackText: notMetText });
}

/** 只读 stub —— chat 即抛（模拟 provider 中断 / 评审会话失败路径）。 */
function outageProvider(): ChatProvider {
  return {
    id: 'outage',
    chat: async () => {
      throw new Error('simulated provider outage');
    },
  };
}

function opts(overrides: Partial<RealEvaluatorAdapterOptions> = {}): RealEvaluatorAdapterOptions {
  return {
    providers: { rev: gatedReviewer(/NEVER-MATCHES-062/) },
    policyArtifacts: artifacts(),
    reviewerProviderId: 'rev',
    reviewerModel: 'rev-model',
    ...overrides,
  };
}

function devProvider(text: string): ChatProvider {
  return new MockProvider([{ when: /.*/, response: { text } }], { model: 'pro-model' });
}

describe('engine — RealEvaluatorAdapter (task 062)', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('seam：任务(goal+验收标准) + generator 产出 → InternalReviewer 判 met → EvaluatorVerdict + 记录回读齐全', async () => {
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(SATISFIED) } }));
    const ctx: EvaluateContext = {
      task: { id: 't62', goal: '实现导出功能', acceptance: [...ACCEPTANCE] },
      iteration: 1,
      attempt: 1,
      workspace: { root: workspace },
      generatorOutput: { output: SATISFIED_OUTPUT, artifactPaths: ['src/out.ts'] },
    };
    const v = await evaluator.evaluate(ctx);

    // EvaluatorVerdict（loop 决策数据）：met + reason + 空反馈数组
    expect(v.verdict).toBe('met');
    expect(v.reason).toBe('产出满足验收标准');
    expect(v.unmet).toEqual([]);
    expect(v.suggestions).toEqual([]);
    expect(v.evidence).toEqual(['src/out.ts 导出存在']);

    // 记录回读：taskId/acceptance/iteration/attempt/conclusion/reviewerPresetId 齐全
    expect(evaluator.runs).toHaveLength(1);
    const rec = evaluator.lastRun!;
    expect(rec.taskId).toBe('t62');
    expect(rec.goal).toBe('实现导出功能');
    expect(rec.acceptance).toEqual(ACCEPTANCE);
    expect(rec.iteration).toBe(1);
    expect(rec.attempt).toBe(1);
    expect(rec.workspaceRoot).toBe(path.resolve(workspace));
    expect(rec.generatorOutput).toBe(SATISFIED_OUTPUT);
    expect(rec.conclusion.verdict).toBe('met');
    expect(rec.conclusion.reason).toBe('产出满足验收标准');
    expect(rec.reviewerPresetId).toBe('reviewer');
    expect(rec.durationMs).toBeGreaterThanOrEqual(0);
    // 058 结论形状：verdict/evidence/reason/unmet/suggestions 五字段恒有值（复用 TeamReviewConclusion）
    expect(Object.keys(rec.conclusion).sort()).toEqual(['evidence', 'reason', 'suggestions', 'unmet', 'verdict']);
    // reviewer preset 只读面（write:false shrink-only）：可见工具无写族，Read 在列
    expect(rec.visibleTools).toContain('Read');
    expect(rec.visibleTools).not.toContain('Write');
  });

  it('not_met + 反馈形状：产出未达标 → verdict not_met，unmet/suggestions 原样带出且与 058 parse 语义一致', async () => {
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(SATISFIED) } }));
    const v = await evaluator.evaluateRun({
      id: 't62n',
      goal: '实现导出功能',
      acceptance: ACCEPTANCE,
      workspaceRoot: workspace,
      generatorOutput: UNSATISFIED_OUTPUT, // 无满足标记 → reviewer not_met
      artifactPaths: ['src/out.ts'],
    });
    expect(v.conclusion.verdict).toBe('not_met');
    expect(v.conclusion.unmet).toContain('src/out.ts 未导出 run（AC-062 未满足）');
    expect(v.conclusion.suggestions).toEqual(['补 export run 并加单测']);

    // 复用 058（不新造解析/结论）：同一 reviewer 文本经 parseReviewConclusion 解析后逐字段一致
    const parsed = parseReviewConclusion(NOT_MET_JSON);
    expect(v.conclusion).toEqual(parsed);

    // seam 映射：EvaluatorVerdict 携带同一套 feedback（retry 决策数据可回读）
    const verdict = await new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(SATISFIED) } })).evaluate({
      task: { id: 't62n', goal: 'g', acceptance: ACCEPTANCE },
      iteration: 1,
      attempt: 1,
      workspace: { root: workspace },
      generatorOutput: { output: UNSATISFIED_OUTPUT },
    });
    expect(verdict.verdict).toBe('not_met');
    expect(verdict.unmet).toEqual(v.conclusion.unmet);
    expect(verdict.suggestions).toEqual(v.conclusion.suggestions);
  });

  it('acceptance 是唯一评审判据来源：验收标准注入评审 prompt（gate 命中才判 met；缺判据 → not_met）', async () => {
    // gate 只命中"验收标准"文本（src/out.ts 导出 run —— 产出用 SATISFIED 措辞，不撞判据串）
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(/src\/out\.ts 导出 run/) } }));

    const withCriteria = await evaluator.evaluateRun({
      id: 't-ac',
      goal: '实现导出功能',
      acceptance: ACCEPTANCE,
      workspaceRoot: workspace,
      generatorOutput: SATISFIED_OUTPUT,
    });
    expect(withCriteria.conclusion.verdict).toBe('met'); // 判据到达 → 可判 met

    const withoutCriteria = await evaluator.evaluateRun({
      id: 't-ac',
      goal: '实现导出功能',
      workspaceRoot: workspace, // acceptance 缺省 —— 评审 prompt 无判据节
      generatorOutput: SATISFIED_OUTPUT,
    });
    expect(withoutCriteria.conclusion.verdict).toBe('not_met'); // 无判据 → reviewer 判不达标（如实暴露）
  });

  it('证据面复用：061 artifactPaths 解析为绝对只读证据路径进评审 prompt（只读核验对象）', async () => {
    // 真盘上放一个改动文件（reviewer 只读面可核验对象）
    fs.mkdirSync(path.join(workspace, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'tests', 'out.test.js'), 'it("run"){…}', 'utf8');
    const absEvidence = path.resolve(workspace, 'tests', 'out.test.js');
    // gate = 绝对证据路径（只出现在评审 prompt 的 evidencePaths 节 —— 独立于文件/产出文本）
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(absEvidence) } }));

    const withEvidence = await evaluator.evaluateRun({
      id: 't-ev',
      goal: '实现导出功能',
      acceptance: ACCEPTANCE,
      workspaceRoot: workspace,
      generatorOutput: SATISFIED_OUTPUT, // 文本里不含绝对路径
      artifactPaths: ['tests/out.test.js'],
    });
    expect(withEvidence.conclusion.verdict).toBe('met');
    expect(withEvidence.artifactPaths).toEqual(['tests/out.test.js']);
    expect(withEvidence.evidencePaths).toEqual([absEvidence]);

    // 无磁盘证据 → prompt 无证据节 → 无法按证据核验（fallback not_met，不自证）
    const noEvidence = await evaluator.evaluateRun({
      id: 't-ev',
      goal: '实现导出功能',
      acceptance: ACCEPTANCE,
      workspaceRoot: workspace,
      generatorOutput: SATISFIED_OUTPUT,
      artifactPaths: [],
    });
    expect(noEvidence.conclusion.verdict).toBe('not_met');
  });

  it('测试结果进评审 prompt：独立 testResults 摘要到达 reviewer（mock 命中才判 met）', async () => {
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(/3\/3 passed/) } }));

    const withTests = await evaluator.evaluateRun({
      id: 't-test',
      goal: '实现导出功能',
      acceptance: ACCEPTANCE,
      workspaceRoot: workspace,
      generatorOutput: SATISFIED_OUTPUT, // 产出文本不含 "3/3 passed"
      artifactPaths: ['tests/out.test.js'],
      testResults: 'tests/out.test.js: 3/3 passed',
    });
    expect(withTests.conclusion.verdict).toBe('met'); // 测试结果到达 → 判 met

    const withoutTests = await evaluator.evaluateRun({
      id: 't-test',
      goal: '实现导出功能',
      acceptance: ACCEPTANCE,
      workspaceRoot: workspace,
      generatorOutput: SATISFIED_OUTPUT,
      artifactPaths: ['tests/out.test.js'],
    });
    expect(withoutTests.conclusion.verdict).toBe('not_met'); // 无测试结果摘要 → 判不达标
  });

  it('异常路径：reviewer provider 中断 → evaluate 返回 verdict error（评审失败是结论不是异常；loop 可读 error 决策重试）', async () => {
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { outage: outageProvider() }, reviewerProviderId: 'outage' }));
    const v = await evaluator.evaluate({
      task: { id: 't-err', goal: '实现导出功能', acceptance: ACCEPTANCE },
      iteration: 1,
      attempt: 1,
      workspace: { root: workspace },
      generatorOutput: { output: SATISFIED_OUTPUT },
    });
    expect(v.verdict).toBe('error'); // 不抛 —— 058 语义：评审失败是 error 结论，绝不误判 met
    expect(v.reason).toContain('simulated provider outage');
    // 失败评审也留 trace（结论可回读）
    expect(evaluator.runs).toHaveLength(1);
    expect(evaluator.lastRun!.conclusion.verdict).toBe('error');
  });

  it('异常路径：构造期守卫 fail loud（provider 未绑定 / 非 evaluator preset / write:true / 空字段 / 无 workspace）', async () => {
    // provider 未绑定 / 空 reviewerProviderId / 空 reviewerModel（对称 061 generator 守卫）
    expect(() => new RealEvaluatorAdapter(opts({ providers: {}, reviewerProviderId: 'nope' }))).toThrow(/not bound/);
    expect(() => new RealEvaluatorAdapter(opts({ reviewerProviderId: '  ' }))).toThrow(/reviewerProviderId/);
    expect(() => new RealEvaluatorAdapter(opts({ reviewerModel: ' ' }))).toThrow(/reviewerModel/);
    expect(() => new RealEvaluatorAdapter(opts({ policyArtifacts: undefined as unknown as PolicyArtifacts }))).toThrow(/policyArtifacts/);
    // 非 evaluator 角色 preset（developer=generator）→ evaluator-side 错位拒绝
    expect(() => new RealEvaluatorAdapter(opts({ reviewerPresetId: 'developer' }))).toThrow(/evaluator-side/);
    // role=evaluator 但 write:true → 非只读评审面拒绝
    const registry = new PresetRegistry([{ id: 'rev-w', role: 'evaluator', modelTier: 'review', write: true }]);
    expect(() => new RealEvaluatorAdapter(opts({ presetRegistry: registry, reviewerPresetId: 'rev-w' }))).toThrow(/write:false/);
    // 未知 preset id
    expect(() => new RealEvaluatorAdapter(opts({ reviewerPresetId: 'ghost' }))).toThrow(/ghost/);

    // 运行期守卫：无隔离 workspace → 拒绝；空 generatorOutput → 拒绝
    const evaluator = new RealEvaluatorAdapter(opts());
    await expect(evaluator.evaluateRun({ id: 't', goal: 'g', workspaceRoot: '', generatorOutput: 'x' })).rejects.toThrow(/workspace/);
    await expect(
      evaluator.evaluateRun({ id: 't', goal: 'g', workspaceRoot: workspace, generatorOutput: '   ' }),
    ).rejects.toThrow(/generatorOutput/);
  });

  it('默认上限生效（§11.1，maxIterations=1/maxRetries=1）e2e：真实 generator + 真实 evaluator adapter —— not_met → 恰一次重试 → met，不超上限', async () => {
    // reviewer（真实 InternalReviewer 管线）逐次出牌：评审#1 not_met → #2 met —— 由 evaluator verdict 驱动 retry
    let reviewCalls = 0;
    const reviewProvider: ChatProvider = {
      id: 'rev-script',
      chat: async (request: ChatRequest): Promise<ChatResponse> => {
        const haystack = [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        // 每次评审都必须真实收到判据 + generator 产出（数据没到 → 抛 → error verdict → 测试失败暴露）
        expect(haystack).toContain('GOLDEN-062: ');
        expect(haystack).toContain('Generator 产出自述');
        reviewCalls += 1;
        const text = reviewCalls === 1 ? NOT_MET_JSON.replace('AC-062 未满足', 'GOLDEN-062 未满足') : MET_JSON;
        return textResponse(text);
      },
    };
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: reviewProvider } }));
    const generator = new RealGeneratorAdapter({
      providers: { dev: devProvider('DEV-062: 完成 src/out.ts 导出 run；单测 3/3 通过（GOLDEN-062）') },
      policyArtifacts: artifacts(),
      tools: [],
      developerProviderId: 'dev',
      developerModel: 'pro-model',
    });

    const queue = createTaskQueue<LoopTask>([
      { id: 't1', goal: '实现真实任务', acceptance: ['GOLDEN-062: src/out.ts 导出 run'] },
      { id: 't2', goal: '第二个任务（不应被消费）', acceptance: [] },
    ]);
    const persisted: IterationResult[] = [];
    const wsFactory = new TempDirWorkspaceFactory('cah-eval-062-loop-');
    const genCalls: number[] = [];
    const engine = new LoopEngine(
      {
        selectTask: queueSelectTask(queue),
        generate: async (ctx) => {
          genCalls.push(ctx.attempt);
          return generator.generate(ctx);
        },
        // Evaluator seam = 真实 evaluator adapter（内部跑真 InternalReviewer 会话）
        evaluate: (ctx) => evaluator.evaluate(ctx),
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
    // maxRetries=1：attempt1 not_met → 恰一次重试 → attempt2 met（attempt3 从未发生）
    expect(genCalls).toEqual([1, 2]);
    expect(reviewCalls).toBe(2); // 两次评审、零多余评审
    expect(report?.outcome).toBe('met');
    expect(report?.result.verdict).toBe('met');
    expect(report?.result.retryCount).toBe(2);
    expect(report?.result.metAfterRetries).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.verdict).toBe('met');
    // 评审记录回读两笔（attempt1 not_met + attempt2 met）—— retry 决策数据可回读
    expect(evaluator.runs).toHaveLength(2);
    expect(evaluator.runs.map((r) => r.attempt)).toEqual([1, 2]);
    expect(evaluator.runs.map((r) => r.conclusion.verdict)).toEqual(['not_met', 'met']);
    expect(evaluator.runs[0]?.conclusion.suggestions).toContain('补 export run 并加单测');
    expect(generator.runs.map((r) => r.attempt)).toEqual([1, 2]);
  });

  it('met 首 attempt 即停：maxRetries=1 上限下不再重试（单次评审即收尾）', async () => {
    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(SATISFIED) } }));
    const generator = new RealGeneratorAdapter({
      providers: { dev: devProvider(`DEV: ${SATISFIED_OUTPUT}`) },
      policyArtifacts: artifacts(),
      tools: [],
      developerProviderId: 'dev',
      developerModel: 'pro-model',
    });
    const queue = createTaskQueue<LoopTask>([
      { id: 'q1', goal: '实现导出功能', acceptance: ACCEPTANCE },
      { id: 'q2', goal: '任务二', acceptance: [] },
    ]);
    const wsFactory = new TempDirWorkspaceFactory('cah-eval-062-stop-');
    const genCalls: number[] = [];
    const engine = new LoopEngine(
      {
        selectTask: queueSelectTask(queue),
        generate: async (ctx) => {
          genCalls.push(ctx.attempt);
          return generator.generate(ctx);
        },
        evaluate: (ctx) => evaluator.evaluate(ctx),
        persist: async () => {},
        workspaceFactory: (t) => wsFactory.create(t),
        disposeWorkspace: (ws) => wsFactory.dispose(ws),
      },
      { maxIterations: 1, maxRetries: 1 },
    );
    const report = await engine.run();
    expect(report?.outcome).toBe('met');
    expect(report?.result.retryCount).toBe(1); // 首 attempt 即 met → 无重试
    expect(genCalls).toEqual([1]);
    expect(evaluator.runs).toHaveLength(1);
    expect(evaluator.runs[0]?.conclusion.verdict).toBe('met');
    expect(queue.size).toBe(1);
  });

  it('061↔062 对称：GeneratorRunRecord → evaluateRun 直接入口同形状（062 消费 061 产出，不经 engine ctx）', async () => {
    const generator = new RealGeneratorAdapter({
      providers: { dev: devProvider(SATISFIED_OUTPUT) },
      policyArtifacts: artifacts(),
      tools: [],
      developerProviderId: 'dev',
      developerModel: 'pro-model',
    });
    const rec = await generator.run({ id: 't-hand', goal: '实现导出功能', acceptance: ACCEPTANCE, workspaceRoot: workspace });

    const evaluator = new RealEvaluatorAdapter(opts({ providers: { rev: gatedReviewer(SATISFIED) } }));
    const verdict = await evaluator.evaluateRun({
      id: rec.taskId,
      goal: rec.goal,
      acceptance: rec.acceptance,
      workspaceRoot: rec.workspaceRoot,
      generatorOutput: rec.output,
      artifactPaths: rec.artifactPaths,
      iteration: rec.iteration,
      attempt: rec.attempt,
    });
    // 061 记录字段可直接喂给 062（taskId/goal/acceptance/output/artifactPaths 形状对齐）
    expect(verdict.taskId).toBe('t-hand');
    expect(verdict.acceptance).toEqual(ACCEPTANCE);
    expect(verdict.iteration).toBe(1);
    expect(verdict.attempt).toBe(1);
    expect(verdict.conclusion.verdict).toBe('met');
    expect(verdict.generatorOutput).toContain(SATISFIED);

    // 多次调用无跨调用状态泄漏：每次 evaluateRun 独立评审，runs 历史按序累积
    const ws2 = tempDir();
    try {
      await evaluator.evaluateRun({
        id: 't-hand2',
        goal: '另一个任务',
        workspaceRoot: ws2,
        generatorOutput: UNSATISFIED_OUTPUT,
      });
    } finally {
      fs.rmSync(ws2, { recursive: true, force: true });
    }
    expect(evaluator.runs.map((r) => r.taskId)).toEqual(['t-hand', 't-hand2']);
    expect(evaluator.runs.map((r) => r.conclusion.verdict)).toEqual(['met', 'not_met']);
  });

  it('history 有界环（V1.1-B）：超上限覆盖最旧、保最近 N 条；totalRuns 单调；lastRun 仍可读（retry 决策消费方）', async () => {
    const evaluator = new RealEvaluatorAdapter(
      opts({ providers: { rev: gatedReviewer(SATISFIED) }, historyLimit: 2 }),
    );
    expect(evaluator.historyLimit).toBe(2);
    const ids: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await evaluator.evaluateRun({
        id: `e-${i}`,
        goal: `goal ${i}`,
        workspaceRoot: workspace,
        generatorOutput: i % 2 === 0 ? SATISFIED_OUTPUT : UNSATISFIED_OUTPUT,
      });
      ids.push(r.taskId);
    }
    expect(evaluator.runs.map((r) => r.taskId)).toEqual(['e-2', 'e-3']); // 保最近 2；e-0/e-1 覆盖
    expect(evaluator.totalRuns).toBe(4); // 计数单调
    expect(evaluator.lastRun?.taskId).toBe('e-3'); // 消费方（lastRun 附入 IterationStore）恒得最近
    expect(evaluator.lastRun!.conclusion.verdict).toBe('not_met');
  });
});
