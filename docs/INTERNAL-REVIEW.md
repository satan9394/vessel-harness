# Internal Review —— 内部评审真流程（task 058）

> 实现卡：`tasks/058-internal-reviewer.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §8（reviewer 角色 = evaluator / no-write / model_tier review）。前置：054/055（AgentPreset +
> 三角色实例）、056（路由）、057（TeamRuntime 骨架 + TeamProjection）。
> 代码位置：
> - `packages/agents/src/reviewer/`（conclusion.ts / InternalReviewer.ts）—— 评审协议 + 独立调用流程；
> - `packages/agents/src/evaluator/EvaluatorAgent.ts` —— 复用为评审 agent（review 输出模式）；
> - `packages/agents/src/team/TeamRuntime.ts` —— gen→eval 骨架上的 evaluate 阶段（058 接线）；
> - `packages/shared/src/events.ts` —— TeamMemberSummary.review（结构化结论经 team_end 上投影）。

## 1. 一句话

Internal Review 真流程：generator/developer 的产出（改动的文件、diff、测试结果、产出自述）
交给 **reviewer（evaluator 角色，preset 只读面 write:false）** 按任务的**验收标准**独立评估，
产出**结构化结论** `verdict(met/not_met/impossible/error) + reason + unmet + suggestions +
evidence`；not_met 的 unmet/suggestions 即回读给生成侧的反馈（Wave 3 rework 循环的输入）。
复用 EvaluatorAgent / AgentLoop / delegate / preset 机制，不新造 Agent primitive、不改写 core。

## 2. 结论协议（单一事实源）

评审结论 JSON schema 与容错解析在 `agents/src/reviewer/conclusion.ts`（其实现委托
`evaluator/EvaluatorAgent.parseVerdict` —— evaluator 与 reviewer 同一解析，绝不漂移）：

```json
{"verdict":"met|not_met|impossible|error","evidence":["..."],"reason":"...",
 "unmet":["..."],"suggestions":["..."]}
```

- `verdict`：产出是否满足任务/验收标准；**not_met 时** `unmet`=未满足的验收标准、
  `suggestions`=给生成方的改进建议；都不需要时给空数组。
- 模型输出前后可有叙述，只要含一行合法 JSON 即可；**解析失败 → verdict 'error'**
  （如实暴露，绝不误判 met —— Generator 不得自证完成，Generator/Evaluator 分离铁律）。
- 类型：`agents/reviewer` 的 `ReviewConclusion` ≡ `@vessel/shared` 的 `TeamReviewConclusion`
  （事件/投影载荷镜像，字段逐一对应，避免 agents 与 shared 漂移）。

## 3. 两种调用形态（同一条协议）

### 3.1 独立 InternalReviewer（`agents/src/reviewer/InternalReviewer.ts`）

一次评审 = 一次 EvaluatorAgent review 调用（隔离只读会话，复用 IsolatedRuntime/AgentLoop）：

```ts
const reviewer = new InternalReviewer({
  workspaceRoot, provider, model, policyArtifacts,
  bus?,                    // 可选：评审事件（subagent_start/stop 镜像）可观察
  preset?,                 // 缺省 = reviewer preset（role=evaluator, write:false）
});
const conclusion: ReviewConclusion = await reviewer.review({
  goal: '实现 src/fee.js 导出 computeFee',       // 任务目标（任务对象字段）
  acceptance: ['src/fee.js 导出 computeFee', ...], // 验收标准（任务对象 acceptance 字段）
  changes: { files: ['src/fee.js'], diffSummary: '…', testResults: 'tests 3/3' }, // 产出上下文
  generatorOutput: '完成…',                        // generator 产出自述
  evidencePaths: ['src/fee.js'],                   // 只读证据（Read/Glob/Grep 可核验）
});
```

- reviewer preset 语义在构造期强校验：role 必须 evaluator、write 必须 false（只读证据面），
  工具面经 `applyPresetToolFace` shrink-only 收窄（055 机制）；评审会话 B10
  `session/created{source:'evaluator', agentPreset:'reviewer'}` 可区分 reviewer 产出。
- 异常路径不抛：provider/loop/session 失败、goal 为空、模型输出非 JSON → 返回
  `verdict:'error'` 结论（评审失败是结论不是异常），绝不把失败当 met。

### 3.2 TeamRuntime evaluate 阶段（`agents/src/team/TeamRuntime.ts`，057 → 058 接线）

- `runTeam` 的 `TeamRunRequest` 新增可选 `acceptance`（任务对象验收标准字段）；
- evaluate 成员的阶段 prompt 内嵌任务/验收标准/Generator 产出 + `REVIEW_OUTPUT_SCHEMA`
  （要求只回一行 review JSON）；
- 成员完成且 phase=evaluate 时，产出按同协议解析为 `TeamMemberSummary.review`（结构化结论），
  raw 文本仍保留在 `output`（反馈可回读）；
- `team_end` 成员摘要携带 review → TeamProjection 阶段行直接带 `review` 字段（可断言，
  消费方无需解析文本）。evaluate 成员仍按 roster 形态执行：小/中阵容为 top-level 会话、
  复杂阵容为 lead 的 delegate 子代理 —— 结论解析对两种形态一视同仁。

## 4. 验收标准 → 结论映射

评审 prompt 明确把任务 + 每条验收标准 + 产出上下文交给 reviewer；reviewer 不信任自证，
可经只读工具核验磁盘证据。`not_met` 结论的 `unmet`/`suggestions` 就是返回给生成侧的回读反馈
（TeamRuntime 投影可见、InternalReviewer 返回值可见）；自动重试循环（not_met → 反馈 → 再产出）
属 Wave 3（061-062），本卡不实现。

## 5. 范围边界（058 不做）

- External Review（059：External Gemini/AGY handoff adapter）不在本卡；
- 自动 rework 循环（根据 review 反馈自动重产出）不在本卡（结构化反馈已为其备好输入）；
- 不改写 core / AgentLoop / Evaluator contract；不新造 Agent primitive。
