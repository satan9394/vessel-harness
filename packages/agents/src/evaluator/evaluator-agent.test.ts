import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { EvaluatorAgent, createReadOnlyExplorationTools } from './EvaluatorAgent.js';
import { SubagentManager } from '../subagent/SubagentManager.js';

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-evalagent-'));
}

function jsonProvider(verdictJson: string): MockProvider {
  return new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: verdictJson } }], { model: 'eval-model' });
}

describe('V0.2-M3 evaluator agent — independent review form', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('rejects a generator output with met/not_met + evidence in an isolated session', async () => {
    const bus = new EventBus();
    const started: string[] = [];
    bus.on('subagent_start', (p) => {
      started.push((p as { childSessionId: string }).childSessionId);
    });
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"not_met","evidence":["src/fee.js 缺少 computeFee"],"reason":"产物不存在"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
      bus,
    });
    const v = await agent.evaluate({
      goal: '实现 computeFee',
      generatorOutput: '我已完成实现，全部通过。（自证无效）',
      acceptance: ['src/fee.js 导出 computeFee'],
    });
    expect(v.verdict).toBe('not_met');
    expect(v.evidence).toContain('src/fee.js 缺少 computeFee');
    expect(v.reason).toBe('产物不存在');
    expect(started).toHaveLength(1);
  });

  it('passes when the isolated evaluator finds the artifact satisfies acceptance', async () => {
    fs.writeFileSync(path.join(workspace, 'result.txt'), 'ANSWER-2026', 'utf8');
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      // evaluator reads the disk evidence first, then verdicts met
      provider: new MockProvider(
        [
          { when: /读|read/i, ifNoToolResult: true, response: { toolCalls: [{ name: 'Read', arguments: { path: 'result.txt' } }] } },
          { when: /.*/, minToolResults: 1, response: { text: '{"verdict":"met","evidence":["result.txt 内容为 ANSWER-2026"],"reason":"磁盘证据确认"}' } },
        ],
        { model: 'eval-model' },
      ),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await agent.evaluate({
      goal: '产出 ANSWER-2026',
      generatorOutput: '完成了',
      acceptance: ['result.txt 含 ANSWER-2026'],
      evidencePaths: ['result.txt'],
    });
    expect(v.verdict).toBe('met');
    expect(v.evidence.join()).toContain('ANSWER-2026');
  });

  it('returns error verdict when the evaluator output is not valid JSON (fail loud, no false pass)', async () => {
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('评审结论：不合格'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await agent.evaluate({ goal: 'g', generatorOutput: 'done' });
    expect(v.verdict).toBe('error');
  });

  it('the evaluator tool set is read-only (no file_write family)', () => {
    const tools = createReadOnlyExplorationTools(workspace);
    expect(tools.some((t) => t.family === 'file_write')).toBe(false);
    expect(tools.some((t) => t.name === 'Write')).toBe(false);
    expect(tools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read']);
    const agent = new EvaluatorAgent({ workspaceRoot: workspace, provider: jsonProvider('{"verdict":"met","evidence":[],"reason":"ok"}'), model: 'm', policyArtifacts: artifacts() });
    expect(agent.visibleTools.map((t) => t.name).sort()).toEqual(['Glob', 'Grep', 'Read']);
  });

  it('Generator/Evaluator separation end-to-end: subagent generates, EvaluatorAgent independently judges', async () => {
    // generator child produces an artifact text (its own session)
    const bus = new EventBus();
    const genProvider = new MockProvider([{ when: /.*/, ifNoToolResult: true, response: { text: '实现了 computeFee：return amount*0.1' } }], { model: 'gen-model' });
    const genManager = new SubagentManager({ workspaceRoot: workspace, provider: genProvider, model: 'gen-model', policyArtifacts: artifacts(), tools: [], bus });
    const gen = await genManager.delegate({ prompt: '实现 computeFee 并汇报', delegationDepth: 0 });
    expect(gen.stopReason).toBe('completed');

    // independent evaluator agent (separate session, read-only) judges the artifact
    const evalAgent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"not_met","evidence":["没有测试通过证据"],"reason":"验收要求隐藏测试全绿，无证据"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await evalAgent.evaluate({
      goal: 'computeFee 通过隐藏测试',
      generatorOutput: gen.output,
      acceptance: ['隐藏测试全绿'],
    });
    // the evaluator's verdict governs — the generator cannot self-certify
    expect(v.verdict).toBe('not_met');
    expect(gen.output).toContain('computeFee');
  });

  it('the evaluator session is isolated and recorded as source=evaluator', async () => {
    const agent = new EvaluatorAgent({
      workspaceRoot: workspace,
      provider: jsonProvider('{"verdict":"met","evidence":[],"reason":"ok"}'),
      model: 'eval-model',
      policyArtifacts: artifacts(),
    });
    const v = await agent.evaluate({ goal: 'g', generatorOutput: 'x' });
    expect(v.verdict).toBe('met');
    // find the evaluator session log (only one session dir: .harness/sessions/*)
    const sessionsDir = path.join(workspace, '.harness', 'sessions');
    const dirs = fs.readdirSync(sessionsDir);
    expect(dirs).toHaveLength(1);
    const log = fs.readFileSync(path.join(sessionsDir, dirs[0]!, 'session.jsonl'), 'utf8');
    expect(log).toContain('"source":"evaluator"');
  });
});
