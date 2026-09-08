# 055 — Lead / Developer / Reviewer presets（三角色默认实例）

- 状态：已合入
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：054（AgentPreset spec，前置须先合入）；056（TaskRouter Auto）；057（TeamRuntime）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8.1-8.3（L992-1080）

## 目标

基于 054 的 AgentPreset schema 落地三个默认 preset 实例（Lead / Developer / Reviewer）。
角色 = 配置，不新增 runtime primitive。角色与模型解绑（preset 只声明 model_tier，具体模型
解析归 056/provider 层）。映射点（tools/write/canDelegate → 既有运行时开关）在本卡落地。

## 验收标准（执行器逐条勾选）

- [x] packages/agents/src/presets/ 提供默认集：lead/developer/reviewer 三个 AgentPreset 实例
      （语义对齐 §8.1：lead=orchestrator/modelTier pro/canDelegate、developer=generator/modelTier
      pro|fast/write:true、reviewer=evaluator/modelTier review/write:false）
- [x] 能力映射落地：preset 的 write/canDelegate/tools 映射到既有运行时开关（tool 可见性、
      delegate 允许、budget 等——以仓库现状为准，映射方式记录设计选择）；054 若只留映射点则本卡接线
- [x] 与 @vessel/shared / compose / configs 兼容；默认模型 tier→model 的解析若仓库已有 provider
      catalog 机制则接上，无则留给 056
- [x] 测试：三实例形状/能力映射/注册查取，新增 ≥5 例；全量 vitest/tsc 绿（426+054 新增数 无回归）
- [x] 文档同步（preset 说明里三角色默认值）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做三角色实例 + 能力映射。TaskRouter（056）、TeamRuntime（057）、UI（060）各自成卡。

## 涉及文件（指针，执行器自行精化）

- packages/agents/src/presets/（054 建的 types/registry + 本卡新增默认实例文件）
- 能力开关所在处（EvaluatorAgent/SubagentManager/tool 可见性机制，见 054 侦察结论）
- packages/agents/src/index.ts 导出

## 方法

- 读 §8.1-8.3；054 验收后在其 registry 上注册默认集；映射点逐一接既有开关并测试

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 改动文件与 diff 摘要

| 文件 | 改动 |
|---|---|
| `packages/agents/src/presets/defaults.ts`（新增） | 三角色默认实例：`LEAD_PRESET_INPUT`（orchestrator/pro/canDelegate:true）、`DEVELOPER_PRESET_INPUT`（generator/pro/write:true）、`REVIEWER_PRESET_INPUT`（evaluator/review/write:false）；`DEFAULT_AGENT_PRESETS` 输入集；`DEFAULT_{LEAD,DEVELOPER,REVIEWER}_PRESET` 规范化冻结实例；`createDefaultPresetRegistry()` / `seedDefaultPresets(registry)` |
| `packages/agents/src/presets/capabilities.ts`（新增） | 能力映射层（纯函数）：`presetCapabilityDirective`（显式意图提取）、`applyPresetToolFace`（tools allow-list intersection → write:false 只保留 read 权限工具 → canDelegate:false 剔除 Subagent 工具，均 shrink-only）、`policyProfileForPreset`（write:false → 'read-only' 降档意图）；`SUBAGENT_TOOL_NAME='Subagent'` |
| `packages/agents/src/subagent/SubagentManager.ts` | 接线：`SubagentManagerOptions.presetLookup?`（presetId → AgentPreset）；`delegate()` 中当 `req.preset` 命中 lookup 时先按 `applyPresetToolFace` 收窄子代理工具面，再叠加显式 toolFilter（两者 shrink-only）；未注入 lookup 或标签未命中 → 行为与旧版一致（preset 仅标签透传） |
| `packages/agents/src/index.ts` | 导出 `./presets/capabilities.js` 与 `./presets/defaults.js` |
| `packages/agents/src/presets/role-presets.test.ts`（新增） | 13 例新测试（见下） |
| `docs/AGENT-PRESETS.md` | §3.1 默认三角色实例表（含 design 选择：developer 取单值 pro、未声明字段不落键、tools 未声明）；§5 映射点表改为接线状态（tools/write ✅055、canDelegate ◑、modelTier ⏳056）；header 范围说明更新 |
| `tasks/055-three-role-presets.md` | 本工作证明回填 + 状态改待验收 |

### 测试输出（命令：`npx vitest run` 全量）

- 新增 13 例全绿（`role-presets.test.ts`：§8.1 语义锚定 / 默认集形状 / 归一化与 get 一致 / 重复注册抛错 / seed / reviewer 只读面映射 / tools allow-list shrink-only / 空 allow-list / policyProfileForPreset / lead 不过滤 / delegate 接线 reviewer 收窄 / developer 不缩 / lookup 缺省兼容 / 未知标签透传）。
- 全量：`Test Files 55 passed (55)，Tests 450 passed (450)`（基线 437 + 本卡 13，无回归；含子代理并发/CLI/benchmark 既有用例）。
- 类型：`npx tsc -b tsconfig.json --pretty false` → exit 0。

### 设计选择与理由

1. **developer 的 modelTier 注册为单值 'pro'**：§8.1 的 `pro|fast` 是「档位随任务复杂度浮动」的意图，不是单值档位；preset 只注册默认档，降档选择归 056 TaskRouter（与 llm/router `ModelTier`/`TierModelMap` 一致）。此点在代码注释 + AGENT-PRESETS §3.1 记录。
2. **tier→model 绑定未在 055 接**：仓库现有 provider catalog 机制（`llm/router TaskRouter.TierModelMap`）只有 pro/fast/mini 三档、属 llm 层任务路由而非角色层；054/055 明确 review 档绑定与角色 tier 解析归 056/provider 层，故本卡只声明档位意图，不引跨层依赖（分层纪律：agents 不依赖 llm 运行时）。
3. **能力映射的接线点选择 SubagentManager.delegate（presetLookup 可选注入）**：这是 agents 包内唯一既有、可观察的「角色 → 会话构造」运行时开关（子代理工具面 shrink-only），且零破坏（不注入即旧行为）。EvaluatorAgent 的只读面先例（createReadOnlyExplorationTools）作为 reviewer `write:false` 映射的等价物被复用引用，未改其代码。顶层会话注册 Subagent 工具 / TeamRuntime 组装留给 057。
4. **write 映射到工具可见性（read 权限面）+ profile 意图两层**：`applyPresetToolFace` 在可见性层剔除写权限工具（等价 EvaluatorAgent 只读面先例）；`policyProfileForPreset` 只输出 'read-only' 意图数据，落到 PolicyArtifacts.profile 的接线在 057/会话构造方——preset 不直接改 policy 文件，遵守「机制层权威裁决、preset 只收窄」。
5. **canDelegate 语义**：`canDelegate:false` → 从可见面剔除 Subagent 工具；子代理无论 preset 始终无 Subagent 工具（SubagentManager 硬编码剔除）+ maxDepth 上限 fail-closed，因此 `canDelegate:true`（lead 编排）只表示「不因 preset 剔除」，顶层是否注册由组装方（057）决定。测试覆盖 false 剔除与 true 保留。
6. **测试的可观察性**：接线测试用真实 mock 子代理 + Write 工具，断言 reviewer 委派下文件不落盘（Write 被只读面剔除 → unknown tool）而 developer/未注入/未知标签下正常落盘，证明映射真实作用于运行时而非仅形状。

### 踩坑记录

- `applyPresetToolFace` 首版把入参 `readonly ToolSpec[]` 直接赋给 `let out` 再 filter 返回，tsc 报 TS4104（readonly 不可赋给 mutable 数组）；改为 `[...tools]` 拷贝起步。
- 无其他环境性故障（vitest/tsc 均可直跑，未触发 EPERM/管道限制）。

## 验收结论（指挥回填）

- [x] 合入（commit 0b66b2c）
- 备注：指挥独立复核——全量 vitest 55 文件 450 测试全绿（437+13，零回归）、npx tsc -b 0 错误，与执行器自报一致。
  设计认可：三角色默认实例（defaults.ts）语义对齐 §8.1；能力映射走 shrink-only 收窄（applyPresetToolFace/
  policyProfileForPreset），接线点选 SubagentManager.delegate 可选 presetLookup（零破坏）；reviewer 只读面复用
  EvaluatorAgent 先例；developer 取单值 pro（浮动意图归 056）；tier→model 与 TeamRuntime 组装留 056/057。
  测试以真实 mock 子代理验证映射可观察性（reviewer 委派下 Write 不落盘）。下一张：056（TaskRouter 默认 Auto）。
