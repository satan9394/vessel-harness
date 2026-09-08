# 058 — Internal Reviewer flow（内部评审真流程）

- 状态：待验收
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：055（reviewer preset）；057（TeamRuntime 骨架，前置）；061-062（Wave 3 真 adapter 延伸）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8（reviewer 角色=evaluator/no-write，
  model_tier review）+ 项目既有 Evaluator/评审机制

## 目标

Internal Reviewer flow：developer/generator 产出（改动的文件、diff、测试结果）交给 reviewer
（evaluator 角色）按验收标准评估 → 输出 met / not_met（+ 理由/反馈）；not_met 时反馈回到生成侧
（rework 循环基础）。复用既有 Evaluator Agent 与既有 delegate/调用机制，不新造 primitive。

## 验收标准（执行器逐条勾选）

- [x] Reviewer 调用流程：给定产出上下文（任务+验收标准+改动摘要+测试结果）→ reviewer preset 化
      Agent 评估 → 结构化结论 met/not_met + 理由 + 建议（输出形状可注入/可断言）
- [x] 与 057 TeamRuntime 集成：generator 完成 → reviewer 评估的骨架真正可用（e2e：mock generator
      产出 → reviewer 判 not_met → 反馈可见）
- [x] 会话/记录可区分 reviewer 的产出与反馈（团队可观测性延续 057 投影）
- [x] 复用既有 EvaluatorAgent / AgentLoop / delegate 机制（不改写 core）；评估判据与验收标准来源
      明确（任务卡/任务对象的验收标准字段——查现有 Task/Evaluation 模型）
- [x] 测试：met/not_met 判定、反馈形状、与 TeamRuntime 集成、异常路径，新增 22 例；全量
      vitest/tsc 绿（496 基线 → 518 全绿 零回归）
- [x] 文档同步（Internal Review 流程说明 → docs/INTERNAL-REVIEW.md 新建 + TEAM-RUNTIME.md /
      EVENT-SPEC.md 同步）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做内部评审真流程。External Review（059）、自动重试循环（Wave 3 真 adapter）不在本卡。

## 涉及文件（指针，执行器自行精化）

- packages/agents（Evaluator/EvaluatorAgent、delegate、presets）
- 057 TeamRuntime（若已建）
- 任务/验收标准模型（tasks/ 卡模型或包内 Evaluation/Task 类型）

## 方法

- 读 §8 与既有 EvaluatorAgent；复用机制把"产出→评审→met/not_met"跑通并测试

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 执行器回填（2026-09-09 隔离子代理；本环境 vitest/tsc 可直跑，全程本地验证无受限降级）

### 改动文件 + diff 摘要

| 文件 | 改动 |
|---|---|
| `packages/shared/src/events.ts` | 载荷扩展（058）：`TeamReviewVerdict`/`TeamReviewConclusion`（verdict/reason/unmet/suggestions/evidence，payload 镜像）；`TeamMemberSummary` 增可选 `review`（结构化评审结论经 team_end 上投影） |
| `packages/agents/src/evaluator/Evaluator.ts` | `EvaluatorVerdict` 增可选 `unmet?`/`suggestions?`（review 输出模式扩展，deterministic/LL evaluator 不设即缺省） |
| `packages/agents/src/evaluator/EvaluatorAgent.ts` | `EvaluationRequest.review?`（review 输出模式：prompt 要求 unmet/suggestions）、`EvaluatorAgentOptions.agentPreset?`（B10 记录标注）；`REVIEW_OUTPUT_SCHEMA` 导出；`parseVerdict` 导出为单一容错解析（review/verdict 同源，解析失败 → verdict 'error'，缺省空数组） |
| `packages/agents/src/reviewer/conclusion.ts`（新建） | 领域结论协议：`ReviewConclusion ≡ TeamReviewConclusion` 类型镜像 + `REVIEW_OUTPUT_SCHEMA` 再导出 + `parseReviewConclusion`（委托 EvaluatorAgent.parseVerdict，单一实现不漂移） |
| `packages/agents/src/reviewer/InternalReviewer.ts`（新建） | 独立 Internal Review 调用流程：构造期强校验 reviewer preset（role=evaluator + write:false，055 语义）、工具面 applyPresetToolFace shrink-only、会话 agentPreset='reviewer'；`review(input)` 组装产出上下文（改动文件/diff/测试结果/产出自述）→ 复用 EvaluatorAgent review 模式 → ReviewConclusion；provider/loop/session 异常 catch 为 verdict 'error'（评审失败是结论不是异常）；`renderProductionContext` 纯函数 |
| `packages/agents/src/team/types.ts` | `TeamRunRequest.acceptance?: readonly string[]`（任务对象验收标准字段，与 LoopTask/Plan acceptance 同形） |
| `packages/agents/src/team/TeamRuntime.ts` | evaluate 阶段真流程：acceptance 进 reviewer prompt（无则明示按任务自行判断）；成员产出按 review JSON schema 回复；evaluate 成员完成后 `parseReviewConclusion(output)` → `TeamMemberSummary.review`（top-level 与 delegate 形态一视同仁；解析失败 verdict 'error' 不崩、不改 run outcome） |
| `packages/application/src/projections/types.ts` | `TeamPhaseRow` 增可选 `review?: TeamReviewConclusion` |
| `packages/application/src/projections/TeamProjection.ts` | team_end 逐成员闭合时把 `m.review` 复制到阶段行（评审结论直接可读可断言，不靠解析文本） |
| `packages/agents/src/index.ts` | 导出 reviewer 模块 |
| `docs/INTERNAL-REVIEW.md`（新建） | Internal Review 流程说明（结论协议/两种调用形态/验收标准映射/范围边界） |
| `docs/TEAM-RUNTIME.md` | §3/§6 注明 058 已接线（acceptance → evaluate prompt → 结构化 review 上成员摘要/投影） |
| `docs/EVENT-SPEC.md` | §5.H 补注：T03 team_end 成员摘要可选 `review`（TeamReviewConclusion payload 镜像） |

### 新增测试数与命令输出

- 新增 22 例：reviewer/internal-reviewer.test.ts 15 + team-runtime.test.ts +5 +
  teamProjection.test.ts +1 + team-runtime.e2e.test.ts +1。
- 覆盖：met/not_met 判定、反馈形状（unmet/suggestions/evidence）、产出上下文与验收标准注入
  （mock 命中证明可注入/可断言）、reviewer preset 只读面 + agentPreset 记录可区分、provider
  崩溃/非 JSON/空 goal 异常路径、TeamRuntime 中/复杂阵容集成（结论上成员摘要 + delegate 形态）、
  投影阶段行带结构化 review、bus 事件可观察。
- 定向：`npx vitest run packages/agents/src/reviewer packages/agents/src/team
  packages/agents/src/evaluator packages/application/src/projections/teamProjection.test.ts
  packages/application/src/team/team-runtime.e2e.test.ts` → 7 files / 53 passed。
- 全量：`npx vitest run` → **62 files / 518 tests all passed**（基线 496 + 本卡 22，
  VITEST_EXIT:0，零回归）；`npx tsc -b tsconfig.json --pretty false` → **TSC_EXIT:0**。

### 设计选择与理由

1. **结论协议单一事实源 = EvaluatorAgent.parseVerdict / REVIEW_OUTPUT_SCHEMA**：reviewer 角色 ≡
   evaluator（055 presets 判别），评审 JSON 协议归 evaluator agent form，reviewer/conclusion.ts
   只做领域类型镜像 + 再导出 —— 三处消费方（EvaluatorAgent review 模式、TeamRuntime evaluate
   成员、InternalReviewer）共用同一解析与 schema 行，杜绝协议漂移。
2. **InternalReviewer 是调用流程不是新 primitive**：构造 EvaluatorAgent（其自身复用
   IsolatedRuntime/AgentLoop/Session）跑隔离只读会话，只加 reviewer preset 语义校验 +
   工具面收窄 + agentPreset 标注；异常路径统一回 error 结论（不抛）——评审失败是结论不是异常，
   且 error 永不等于 met（Generator 不得自证完成）。
3. **TeamRuntime 集成不改 run 语义**：not_met 是评审结论不是运行失败 → run outcome 仍
   'completed'，结论与原始产出都在 evaluate 成员摘要（review 结构化 + output 原文可回读）；
   解析失败 verdict 'error' 也不崩（与 EvaluatorAgent error verdict 语义一致）。057 既有
   断言（marker 命中、阶段序、delegate 关系）不受影响 —— 新增 review 字段纯增量。
4. **验收标准来源明确**：TeamRunRequest.acceptance / InternalReviewInput.acceptance 与既有
   engine LoopTask.acceptance、planner acceptance 同形结构字段；没有新造 Task 模型。
5. **投影层零解析**：TeamProjection 直接把 TeamMemberSummary.review 复制到阶段行 —— 评审
   结论/反馈是结构数据（可断言、060 UI 可直接渲染），不必在投影侧解析 review 文本。
6. 会话可区分延续 057：TeamRuntime 成员会话 B10 已有 agentPreset='reviewer'（source team /
   subagent）；独立 InternalReviewer 会话 B10 source='evaluator' + agentPreset='reviewer'。

### 踩坑记录

- 首版把 review JSON 解析再写一份到 reviewer/conclusion.ts，随即发现与 EvaluatorAgent.parseVerdict
  双实现漂移风险 → 改为结论协议归 evaluator、reviewer 侧委托单实现（dedupe）。
- Reviewer preset 构造强校验一度想放宽（允许任意 write），但与 §8 "reviewer=evaluator/no-write"
  冲突 → 构造期 fail loud（role=evaluator + write:false），preset 语义由运行时保证而非只靠 prompt。
- TeamRuntime 解析时机放在"成员完成且 phase=evaluate"后、push 前 —— 曾担心 delegate 形态下
  review 挂不上，实测 top-level 与 delegate（SubagentManager.delegate result.output）两条路径
  都拿到 output 字符串，同一解析点覆盖两种形态。
- 首轮定向测试 2 例失败均因断言字符串过细（期望 'not a valid review JSON'，实得 parseVerdict
  的 'not a valid verdict JSON'）→ 放宽断言为 'not a valid'（解析错误措辞归属单一实现，断言不锁字）。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
