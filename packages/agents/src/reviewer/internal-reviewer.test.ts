import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { InternalReviewer, renderProductionContext, type InternalReviewInput } from './InternalReviewer.js';
import { parseReviewConclusion, REVIEW_OUTPUT_SCHEMA } from './conclusion.js';
import { DEFAULT_REVIEWER_PRESET } from '../presets/defaults.js';

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
`;

function artifacts(): PolicyArtifacts {
  return compilePolicyYaml(POLICY_YAML);
}

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-reviewer-'));
}

/** provider 只在 prompt 命中时返回指定文本；否则抛错（证明产出上下文确实到达 reviewer）。 */
function strictProvider(needle: RegExp, text: string): ChatProvider {
  return new MockProvider([{ when: needle, response: { text } }], { model: 'rev-model', fallbackText: '(mock: context missing)' });
}

describe('reviewer/conclusion — 结构化评审结论协议（058）', () => {
  it('解析 not_met 结论：unmet/suggestions/evidence/reason 形状可断言', () => {
    const c = parseReviewConclusion(
      '{"verdict":"not_met","unmet":["src/fee.js 未导出 computeFee"],"suggestions":["补导出并加单测"],"reason":"验收标准 1 未满足","evidence":["src/fee.js"]}',
    );
    expect(c.verdict).toBe('not_met');
    expect(c.unmet).toEqual(['src/fee.js 未导出 computeFee']);
    expect(c.suggestions).toEqual(['补导出并加单测']);
    expect(c.evidence).toEqual(['src/fee.js']);
    expect(c.reason).toBe('验收标准 1 未满足');
  });

  it('解析 met 结论：unmet/suggestions 为空数组（无反馈）', () => {
    const c = parseReviewConclusion('{"verdict":"met","evidence":["src/fee.js"],"reason":"符合验收"}');
    expect(c.verdict).toBe('met');
    expect(c.unmet).toEqual([]);
    expect(c.suggestions).toEqual([]);
  });

  it('非 JSON 输出 → verdict error（如实暴露，不误判 met）', () => {
    const c = parseReviewConclusion('评审结论：产出看起来可以');
    expect(c.verdict).toBe('error');
    expect(c.reason).toContain('not a valid');
  });

  it('review JSON schema 行可由 prompt 复用（EvaluatorAgent review 模式与 TeamRuntime 同源）', () => {
    expect(REVIEW_OUTPUT_SCHEMA).toContain('"verdict"');
    expect(REVIEW_OUTPUT_SCHEMA).toContain('"suggestions"');
  });
});

describe('reviewer/InternalReviewer — Internal Review 调用流程（058）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  const input: InternalReviewInput = {
    goal: '实现 src/fee.js 导出 computeFee',
    acceptance: ['src/fee.js 导出 computeFee', '隐藏测试全绿'],
    changes: {
      files: ['src/fee.js', 'tests/fee.test.js'],
      diffSummary: '+export function computeFee(amount){return amount*0.1}',
      testResults: 'tests/fee.test.js 通过 3/3',
    },
    generatorOutput: '完成 computeFee 实现，改动文件与测试如上。',
  };

  it('reviewer preset 化：只读证据面 + agentPreset=reviewer 记录可区分', async () => {
    const provider = strictProvider(/src\/fee\.js/, '{"verdict":"met","evidence":["src/fee.js"],"reason":"ok"}');
    const reviewer = new InternalReviewer({
      workspaceRoot: workspace,
      provider,
      model: 'rev-model',
      policyArtifacts: artifacts(),
    });
    // reviewer preset 面：write:false → 无 Write/file_write 工具（只读）
    const names = reviewer.visibleTools.map((t) => t.name);
    expect(names.includes('Write')).toBe(false);
    expect(names.includes('Read')).toBe(true);
    expect(reviewer.visibleTools.every((t) => t.requiredPermission === 'read')).toBe(true);

    const c = await reviewer.review(input);
    expect(c.verdict).toBe('met');

    // 评审会话记录 source=evaluator + agentPreset=reviewer（区别于普通 evaluator）
    const sessionsDir = path.join(workspace, '.harness', 'sessions');
    const dirs = fs.readdirSync(sessionsDir);
    expect(dirs).toHaveLength(1);
    const log = fs.readFileSync(path.join(sessionsDir, dirs[0]!, 'session.jsonl'), 'utf8');
    expect(log).toContain('"source":"evaluator"');
    expect(log).toContain('"agentPreset":"reviewer"');
  });

  it('met 判定：产出满足验收标准时 reviewer 判 met，反馈数组为空', async () => {
    const provider = strictProvider(/computeFee/, '{"verdict":"met","evidence":["src/fee.js 导出存在"],"reason":"验收通过"}');
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review(input);
    expect(c.verdict).toBe('met');
    expect(c.reason).toBe('验收通过');
    expect(c.suggestions).toEqual([]);
    expect(c.unmet).toEqual([]);
  });

  it('not_met 判定 + 反馈形状：unmet/suggestions 回读给生成侧', async () => {
    const provider = strictProvider(
      /src\/fee\.js/,
      '{"verdict":"not_met","unmet":["隐藏测试全绿"],"suggestions":["补充边界用例（amount<=0）"],"reason":"导出已实现但测试覆盖不足","evidence":["tests/fee.test.js"]}',
    );
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review(input);
    expect(c.verdict).toBe('not_met');
    expect(c.unmet).toContain('隐藏测试全绿');
    expect(c.suggestions).toEqual(['补充边界用例（amount<=0）']);
    expect(c.evidence).toEqual(['tests/fee.test.js']);
  });

  it('产出上下文可注入/可断言：改动文件/diff/测试结果进入评审 prompt（mock 命中才回 met）', async () => {
    // 上下文缺了任何标记 → mock 回 fallback（非 review JSON）→ verdict error；
    // 上下文完整 → met。以此证明上下文注入 reviewer prompt 可断言。
    const provider = strictProvider(/src\/fee\.js[\s\S]*tests\/fee\.test\.js[\s\S]*amount\*0\.1[\s\S]*3\/3/, '{"verdict":"met","evidence":[],"reason":"上下文完整"}');
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review(input);
    expect(c.verdict).toBe('met');
  });

  it('验收标准来源明确：task.acceptance 列表注入评审 prompt（mock 命中才回 not_met）', async () => {
    const provider = strictProvider(/隐藏测试全绿/, '{"verdict":"not_met","unmet":["隐藏测试全绿"],"suggestions":[],"reason":"测试未跑","evidence":[]}');
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review(input);
    expect(c.verdict).toBe('not_met');
    expect(c.unmet).toEqual(['隐藏测试全绿']);
  });

  it('异常路径 1：provider 崩溃 → 返回 verdict error（评审失败是结论不是异常，不误判 met）', async () => {
    const boomer: ChatProvider = {
      id: 'boom',
      async chat() {
        throw new Error('provider down');
      },
    };
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider: boomer, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review(input);
    expect(c.verdict).toBe('error');
    expect(c.reason).toContain('provider down');
  });

  it('异常路径 2：评审模型输出非 JSON → verdict error（如实暴露）', async () => {
    const provider = strictProvider(/.*/, '评审意见：看起来不错');
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review(input);
    expect(c.verdict).toBe('error');
  });

  it('结构性校验：goal 为空 → error 结论（不启动会话）', async () => {
    const provider = strictProvider(/.*/, '{"verdict":"met","evidence":[],"reason":"x"}');
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts() });
    const c = await reviewer.review({ ...input, goal: '   ' });
    expect(c.verdict).toBe('error');
    expect(c.reason).toContain('goal is required');
    const sessionsDir = path.join(workspace, '.harness', 'sessions');
    expect(fs.existsSync(sessionsDir)).toBe(false);
  });

  it('preset 语义校验：非 evaluator 角色 / 可写 preset 拒绝（reviewer = evaluator/no-write）', () => {
    expect(
      () =>
        new InternalReviewer({
          workspaceRoot: workspace,
          provider: strictProvider(/.*/, '{}'),
          model: 'rev-model',
          policyArtifacts: artifacts(),
          preset: { ...DEFAULT_REVIEWER_PRESET, id: 'writer', role: 'generator', write: true },
        }),
    ).toThrow(/role must be "evaluator"/);
    expect(
      () =>
        new InternalReviewer({
          workspaceRoot: workspace,
          provider: strictProvider(/.*/, '{}'),
          model: 'rev-model',
          policyArtifacts: artifacts(),
          preset: { ...DEFAULT_REVIEWER_PRESET, id: 'w', write: true },
        }),
    ).toThrow(/write:false/);
  });

  it('评审事件可经 bus 观察（subagent_start/stop 镜像，复用 EvaluatorAgent 机制）', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('subagent_start', () => {
      seen.push('start');
    });
    bus.on('subagent_stop', () => {
      seen.push('stop');
    });
    const provider = strictProvider(/src\/fee\.js/, '{"verdict":"met","evidence":[],"reason":"ok"}');
    const reviewer = new InternalReviewer({ workspaceRoot: workspace, provider, model: 'rev-model', policyArtifacts: artifacts(), bus });
    await reviewer.review(input);
    expect(seen).toEqual(['start', 'stop']);
  });

  it('renderProductionContext 组装产出上下文（改动的文件/diff/测试结果分节）', () => {
    const text = renderProductionContext(input);
    expect(text).toContain('改动文件：\n- src/fee.js\n- tests/fee.test.js');
    expect(text).toContain('Diff 摘要：');
    expect(text).toContain('测试结果：');
    expect(text).toContain('Generator 产出自述：');
  });
});
