import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, PolicyArtifacts } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { TeamRuntime } from '@vessel/agents';
import { TeamProjection } from '../projections/TeamProjection.js';

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

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cah-team-e2e-'));
}

function prov(entries: { when: RegExp | string; text: string }[], model: string): ChatProvider {
  return new MockProvider(
    entries.map((e) => ({ when: e.when, response: { text: e.text } })),
    { model },
  );
}

describe('TeamRuntime × TeamProjection e2e（057 → 060 数据源）', () => {
  let workspace: string;
  beforeEach(() => {
    workspace = tempDir();
  });
  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it('中阵容真跑：投影呈现 run/阶段（gen→eval 顺序）/成员回合与产出', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    projection.attach(bus);
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'DEV-E2E: 已实现功能' }], 'pro-model'),
        review: prov([{ when: /DEV-E2E/, text: 'REV-E2E-MET' }], 'review-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });

    const summary = await runtime.runTeam({
      task: '实现一个导出功能',
      route: {
        complexity: 'medium',
        roles: ['developer', 'reviewer'],
        roleModels: [
          { role: 'developer', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'reviewer', tier: 'review', providerId: 'review', model: 'review-model' },
        ],
      },
    });

    const state = projection.state()!;
    expect(summary.outcome).toBe('completed');
    expect(state.status).toBe('done');
    expect(state.outcome).toBe('completed');
    expect(state.roster.map((m) => m.memberId)).toEqual(['developer', 'reviewer']);
    expect(state.phases.map((p) => p.phase)).toEqual(['generate', 'evaluate']);
    expect(state.phases[0]).toMatchObject({ memberId: 'developer', status: 'completed' });
    expect(state.phases[1]).toMatchObject({ memberId: 'reviewer', status: 'completed', outputPreview: expect.stringContaining('REV-E2E-MET') });
    // top-level 成员回合逐成员归属
    expect(state.turns.map((t) => t.memberId)).toEqual(['developer', 'reviewer']);
    expect(state.delegates).toHaveLength(0);
  });

  it('复杂阵容真跑：投影呈现 delegate 关系（lead → developer / reviewer）与 delegate 产出', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    projection.attach(bus);
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        lead: prov([{ when: /.*/, text: 'PLAN-E2E' }], 'lead-model'),
        dev: prov([{ when: /PLAN-E2E/, text: 'IMPL-E2E: done' }], 'dev-model'),
        rev: prov([{ when: /IMPL-E2E/, text: 'REV-E2E: pass' }], 'rev-model'),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });

    const summary = await runtime.runTeam({
      task: '做一个复杂架构重构',
      route: {
        complexity: 'complex',
        roles: ['lead', 'developer', 'reviewer'],
        roleModels: [
          { role: 'lead', tier: 'pro', providerId: 'lead', model: 'lead-model' },
          { role: 'developer', tier: 'pro', providerId: 'dev', model: 'dev-model' },
          { role: 'reviewer', tier: 'review', providerId: 'rev', model: 'rev-model' },
        ],
      },
    });

    const state = projection.state()!;
    expect(summary.outcome).toBe('completed');
    expect(state.phases.map((p) => p.memberId)).toEqual(['lead', 'developer', 'reviewer']);
    // lead 是 top-level 成员（turn 可观测）；developer/reviewer 由子代理执行 → 无 turn 行、有 delegate 关系行
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.memberId).toBe('lead');
    expect(state.delegates).toHaveLength(2);
    expect(state.delegates.map((d) => d.preset)).toEqual(['developer', 'reviewer']);
    expect(state.delegates.every((d) => d.parentMemberId === 'lead')).toBe(true);
    expect(state.delegates.every((d) => d.status === 'done' && d.isError === false)).toBe(true);
    expect(state.delegates[0]?.outputPreview).toContain('IMPL-E2E');
    expect(state.delegates[1]?.outputPreview).toContain('REV-E2E');
    // 阶段行产出预览来自 team_end 的逐成员摘要
    expect(state.phases[1]?.outputPreview).toContain('IMPL-E2E');
    expect(state.phases[2]?.outputPreview).toContain('REV-E2E');
  });

  it('058 Internal Review e2e：mock generator → reviewer not_met → 评审结论可见于投影阶段行', async () => {
    const bus = new EventBus();
    const projection = new TeamProjection();
    projection.attach(bus);
    const runtime = new TeamRuntime({
      workspaceRoot: workspace,
      providers: {
        pro: prov([{ when: /.*/, text: 'IMPL-REV-NM: 已实现导出（改动 src/out.ts）' }], 'pro-model'),
        review: prov(
          [
            {
              when: /IMPL-REV-NM/,
              text: '{"verdict":"not_met","unmet":["AC-2 测试结果未提供"],"suggestions":["补跑单测并附输出"],"reason":"缺测试证据","evidence":["tests/out.test.ts"]}',
            },
          ],
          'review-model',
        ),
      },
      policyArtifacts: artifacts(),
      tools: [],
      bus,
    });

    const summary = await runtime.runTeam({
      task: '实现导出功能',
      acceptance: ['AC-1: src/out.ts 导出 run', 'AC-2: 提供测试结果'],
      route: {
        complexity: 'medium',
        roles: ['developer', 'reviewer'],
        roleModels: [
          { role: 'developer', tier: 'pro', providerId: 'pro', model: 'pro-model' },
          { role: 'reviewer', tier: 'review', providerId: 'review', model: 'review-model' },
        ],
      },
    });

    expect(summary.outcome).toBe('completed');
    expect(summary.members[1]?.review?.verdict).toBe('not_met');
    const state = projection.state()!;
    expect(state.status).toBe('done');
    expect(state.outcome).toBe('completed');
    const revRow = state.phases[1]!;
    expect(revRow.memberId).toBe('reviewer');
    // 结构化评审结论直接可见（可断言，无需解析文本）；原始反馈 JSON 亦在 outputPreview
    expect(revRow.review).toMatchObject({ verdict: 'not_met', unmet: ['AC-2 测试结果未提供'], suggestions: ['补跑单测并附输出'] });
    expect(revRow.outputPreview).toContain('"not_met"');
    expect(summary.members[1]?.review?.suggestions).toContain('补跑单测并附输出');
  });
});
