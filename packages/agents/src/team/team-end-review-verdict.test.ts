import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ChatProvider, PolicyArtifacts, TeamEndPayload } from '@vessel/shared';
import { EventBus } from '@vessel/core';
import { MockProvider } from '@vessel/llm';
import { compilePolicyYaml } from '@vessel/policy';
import { TeamRuntime } from './TeamRuntime.js';

/**
 * M13 的**生产侧契约**（BRIEF-A）：`Telemetry` 把 `team_end` 载荷里 evaluate 成员的
 * `review.verdict` 当作「评估器拒绝」的唯一可观测面计数（见 `packages/telemetry/src/Telemetry.ts`
 * 的类注释「M13 evaluatorRejects 的生产者」与 `telemetry.test.ts` ⑩⑪⑫）。本文件把那条
 * **生产者⇄消费者契约**钉在生产侧——消费端的用例只能用自造载荷证明"给了就会计"，
 * 只有这里能证明"真实跑出来的 `team_end` 里真的有 `review.verdict`"。
 *
 * 反向保护：`TeamReviewConclusion` 的 verdict 词表若漂移（例如多出一个不在
 * `{met, not_met, impossible, error}` 里的值），消费端的过滤会**静默少计**（少计是本仓明令禁止的
 * 失败模式，见 `countRetry`）。故本文件顺带把词表逐字钉住。
 *
 * 「删哪行会红」：
 *   - 删掉 `TeamRuntime.runTeam` 里把 evaluate 成员产出解析成 `summary.review` 的那一行
 *     ⇒ ①② 红（`team_end` 载荷里不再有 `review` ⇒ telemetry 侧 M13 恒 0）；
 *   - 把 review 只放进 `TeamRunSummary` 而不进 `team_end` 载荷（例如 emit 一份剥离 review 的副本）
 *     ⇒ ①② 红；
 *   - 给非 evaluate 成员也挂上 `review` ⇒ ① 的"只有 evaluate 成员带 review"断言红。
 */
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

function prov(entries: { when: RegExp | string; text: string }[], model: string): ChatProvider {
  return new MockProvider(
    entries.map((e) => ({ when: e.when, response: { text: e.text } })),
    { model },
  );
}

/** 事件磁带：只观察 `team_end`（M13 的输入面），不参与任何裁决。 */
function tape(bus: EventBus): { ends: TeamEndPayload[] } {
  const ends: TeamEndPayload[] = [];
  bus.on('team_end', (payload) => {
    ends.push(payload as TeamEndPayload);
  }, 'tap:team_end');
  return { ends };
}

async function runReview(
  workspace: string,
  reviewerText: string,
): Promise<{ ends: TeamEndPayload[]; summaryReview: unknown }> {
  const bus = new EventBus();
  const runtime = new TeamRuntime({
    workspaceRoot: workspace,
    providers: {
      pro: prov([{ when: /.*/, text: 'IMPL-8-DONE: 完成' }], 'pro-model'),
      review: prov([{ when: /IMPL-8-DONE/, text: reviewerText }], 'review-model'),
    },
    policyArtifacts: artifacts(),
    tools: [],
    bus,
  });
  const t = tape(bus);
  const summary = await runtime.runTeam({
    task: '做一个导出',
    roster: [
      { memberId: 'developer', presetId: 'developer', model: 'pro-model', providerId: 'pro' },
      { memberId: 'reviewer', presetId: 'reviewer', model: 'review-model', providerId: 'review' },
    ],
  });
  return { ends: t.ends, summaryReview: summary.members[1]?.review };
}

describe('agents/team — M13 生产侧：`team_end` 载荷里携带 evaluate 成员的 review.verdict', () => {
  const tempDirs: string[] = [];
  const newWorkspace = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-team-m13-'));
    tempDirs.push(d);
    return d;
  };
  let workspace: string;
  beforeEach(() => {
    workspace = newWorkspace();
  });
  afterEach(() => {
    for (const d of tempDirs) fs.rmSync(d, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  it('① 判 not_met 时：恰好一次 team_end，其中**只有** evaluate 成员带 review，且 verdict 在拒绝词表里', async () => {
    const { ends, summaryReview } = await runReview(
      workspace,
      '{"verdict":"not_met","unmet":["错误路径未覆盖"],"suggestions":["补 401/500 分支用例"],"reason":"验收标准 2 未满足","evidence":["tests/login.test.ts"]}',
    );

    expect(ends).toHaveLength(1); // 一次 team_run 一次 team_end（消费端按事件逐次计数）
    const members = ends[0]!.members;
    const withReview = members.filter((m) => m.review !== undefined);
    expect(withReview).toHaveLength(1); // 只有 evaluate 成员带 review ⇒ M13 不会把 generator 也算进去
    expect(withReview[0]!.phase).toBe('evaluate');
    expect(withReview[0]!.role).toBe('evaluator');
    expect(withReview[0]!.review!.verdict).toBe('not_met');
    // 事件载荷与返回摘要**是同一个事实**（消费端读事件、调用方读摘要，两处必须一致）
    expect(summaryReview).toEqual(withReview[0]!.review);
    // 消费端的过滤词表：四个 verdict，M13 只数除 met 之外的三个
    expect(['met', 'not_met', 'impossible', 'error']).toContain(withReview[0]!.review!.verdict);
  });

  it('② 反例（消费端必须**不**计的那种）：判 met ⇒ 载荷里同样是 review.verdict=met', async () => {
    const { ends } = await runReview(
      workspace,
      '{"verdict":"met","unmet":[],"suggestions":[],"reason":"符合验收","evidence":[]}',
    );
    const evaluate = ends[0]!.members.filter((m) => m.phase === 'evaluate');
    expect(evaluate).toHaveLength(1);
    expect(evaluate[0]!.review?.verdict).toBe('met');
  });

  it('③ 词表逐字：review.verdict 只取四个值之一（多出第五个 ⇒ 消费端静默少计 ⇒ 这里先红）', async () => {
    for (const verdict of ['not_met', 'met', 'impossible', 'error']) {
      const { ends } = await runReview(
        newWorkspace(),
        `{"verdict":"${verdict}","unmet":[],"suggestions":[],"reason":"r","evidence":[]}`,
      );
      const v = ends[0]!.members.find((m) => m.phase === 'evaluate')?.review?.verdict;
      expect(v).toBe(verdict);
    }
  });
});
