# V0.4 Implementation Notes — Composable Agent Harness 第四阶段交付说明

> 阶段：第四阶段（MISSION-V0.4.md）· 验收状态：见文末 · 日期：2026-09-05
> 总指挥签发任务：在 V0.3（146 测试）之上增量实现 **Task Router / Orchestration Policy 主线**（docs/ideas/001，oh-my-openagent 启发）——用户表达任务意图，Harness 决定"派谁/用什么模型做"。

---

## 1. 模块地图（V0.4 增量，相对 V0.3）

```text
packages/llm/src/router/
  taskCategory.ts      V0.4-M1 任务类别分类器：TaskCategory（implementation/simple_fix/search/
                       review/planning/architecture/unknown）+ classifyTask（确定性关键字规则，
                       离线可测）+ TaskClassifier seam（LLM 分类预留，默认 DeterministicTaskClassifier）
  TaskRouter.ts        V0.4-M2 Preset 库 + 路由：AgentPresetRef{category,agentPreset,modelTier,
                       description}；DEFAULT_PRESETS（数据，决策点 12：角色=预设配置）；TierModelMap
                       （tier→provider/model 绑定，决策点 13：模型差异走 tier）；TaskRouter.resolve：
                       显式 hints 优先，否则 classifyTask→preset→tier→(provider,model)；可注入
                       presets/tierModel/classify
packages/agents/src/subagent/createSubagentTool.ts  V0.4-M3 Subagent 工具 preset 选项透传
                       （delegate 已有 preset 字段 V0.2 预留）+ meta 回显
apps/cli/src/compose.ts              V0.4-M3 接线：taskRouter 选项（providers+tierModel+taskPrompt）
                       → 会话 provider/model 按任务自动路由；暴露 taskRouter/routedCategory；
                       无 taskPrompt 即显式钉死（向后兼容）
benchmarks/
  scenarios/B022.yaml                V0.4 场景：实现类任务路由到 pro tier（GOLDEN-ROUTE-2026）
  fixtures/B022/task.md
  runners/src/{types,manifest,runner}.ts   harness.taskRouter 支持（双 offline mock provider lane）
docs/V04-PROGRESS.md                 里程碑进度
```

## 2. 运行方式

```powershell
npx tsc -b tsconfig.json
npx vitest run                       # 全量 170 用例（offline，无网络）
npx vitest run packages/llm          # llm 包（24 用例：taskCategory 9 + taskRouter 11 + provider 4）
npx vitest run benchmarks/runners    # runner 13 用例（B001–B005/B016–B022）
```

## 3. 测试与覆盖（验收 1）

`npx vitest run` → **25 文件 / 170 用例全绿**（V0.3 基线 146 + V0.4 新增 24）：

| 模块 | 覆盖 |
|---|---|
| llm/taskCategory (9) | 各类别分类/未知兜底/规则优先级/seam 适配/类别集完整性 |
| llm/taskRouter (11) | 类别→tier 路由/显式优先/未知兜底/category 覆盖/未知 provider 抛错/可注入 |
| apps/cli (task routing, +2) | compose taskPrompt 路由到 pro provider；无 taskPrompt 保持显式 |
| agents/subagent (+1) | Subagent 工具 preset 透传 delegate + meta 回显 |
| benchmarks B022 (+1) | 实现类任务经 TaskRouter 路由到 pro tier，GOLDEN-ROUTE-2026 机器断言 |

## 4. 验收对照（MISSION-V0.4 第六节 6 条）

1. **可运行代码 + Vitest 通过**：✔ 170/170；`npx tsc -b` exit 0
2. **分类器确定性**：✔ taskCategory.test 实证实现/搜索/审查/规划/架构/简单修复分到正确类别，未知兜底
3. **TaskRouter 路由**：✔ taskRouter.test + cli.test 实证类别→(provider,model)；显式 hints/显式 provider 优先
4. **preset 可配置**：✔ DEFAULT_PRESETS 是数据；presets/tierModel/classify 可注入；agents 侧 preset 只是标签透传（未硬编码模型供应商绑定进 agents）
5. **B022 可跑 + 不回归**：✔ B022 实测 success=true（GOLDEN-ROUTE-2026）；B001–B021 不回归（runner 13 用例全绿）
6. **交付说明 + 独立审查**：✔ 本文档 + docs/REVIEW-REPORT-V04.md

## 5. 实现要点（与 DESIGN-DECISIONS/ARCHITECTURE 的对应）

- **角色 = 预设配置，机制先于角色**（决策点 12）：V0.4 不新建任何 agent 机制——TaskRouter 的 agentPreset 引用既有 preset 概念（SubagentManager.delegate 的 preset 字段 V0.2 已预留），工具层补透传；preset 是数据（DEFAULT_PRESETS），新增角色/类别不改机制代码。
- **模型差异走 tier，不进模板**（决策点 13）：TierModelMap 是唯一 provider/model 绑定点；类别→tier（implementation→pro、simple-fix→fast、review→pro 独立评审语义）；Behavior 编译管线（决策点 14）不受影响——TaskRouter 是"任务→模型/角色"的编排层，补在 llm/router，不触碰 behavior 编译。
- **显式配置永远优先**：TaskRouter.resolve 显式 hints 优先；compose 无 taskPrompt 即不路由（向后兼容，SimpleRouter 调用方零改动）。
- **确定性优先 + LLM seam**：分类器默认关键字规则（离线可测，无网络依赖）；TaskClassifier 接口预留 LLM 分类，不默认启用。
- **薄核/依赖零环**：TaskRouter/分类器只在 llm 包（依赖 shared 类型）；core 零新增 import；agents 只加工具透传；接线全在组合根 compose + runner。
- **不抄 OmO 角色名**：类别命名参考任务书 V0.5 Task Selection 语义（implementation/search/review/planning/architecture），preset 标签用通用角色词（developer/explorer/reviewer/planner/architect）。

## 6. 已知限制与后续

1. **分类器是确定性关键字版**：覆盖常见中文/英文任务词，但复杂/歧义任务可能落 unknown（兜底 pro）。LLM 分类 seam 已留（TaskClassifier），V0.5 可接。
2. **live 双 provider 路由未跑真实模型**：B022 是 offline 双 mock lane 机器断言；真实多 provider 路由需 live 端点配置（与 V0.1–V0.3 同限制）。
3. **Subagent preset 目前是标签**：delegate 透传 preset 标签并记录，但 preset→toolFilter/模型的完整执行语义（如 reviewer 自动只读）未实现——那是角色库的完整化，V0.5 候选。
4. **V0.5 建议**：Task Router 接 V0.5 Loop Engine 的 Task Selection（任务书第十四节：Trigger→Discovery→Task Selection→Worktree→Generator→Evaluator→Persist）；可继续子代理（send_message/interrupt，EVENT-SPEC A25 预留）；LLM 分类器；角色库完整执行语义。

## 7. 独立核验

docs/REVIEW-REPORT-V04.md（独立 Evaluator 按 MISSION-V0.4 第六节 6 条逐条核验，Gen/Eval 分离）。
