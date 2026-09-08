# 056 — TaskRouter 默认 Auto（用户只选 Auto/Fast/Pro，默认 Auto）

- 状态：待验收
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：054/055（preset 体系，前置）；057（TeamRuntime 用路由决定团队规模）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §10（L1140-1182）+ §8.2 路由（小→Single / 中→Developer+Reviewer / 复杂→Lead+Developer+Reviewer）

## 目标

TaskRouter 进入默认产品路径：用户只选 Auto / Fast / Pro，**默认 Auto**；内部按
classify category → choose role → choose tier → resolve provider/model 解析；UI 显示实际选择
（如 Auto → DeepSeek V4 Pro）并允许 Pin for this session。角色选择与任务复杂度挂钩（§8.2）。

## 验收标准（执行器逐条勾选）

- [x] TaskRouter 默认 Auto 模式（现状：TaskRouter 已有但需手动选模型；查 packages 内 TaskRouter
      现状后接默认路径）—— 新 AutoTaskRouter（llm/router/autoRouter.ts，从 @vessel/llm 导出）默认
      `mode:'auto'`；compose 的 ComposeOptions.taskRouter 默认 Auto 并暴露实际选择（见下）
- [x] Auto 解析链落地：任务分类（现有 task category 机制，见 tasks/006-task-category 相关既有实现）
      → 选角色（小/中/复杂 → Single / Dev+Rev / Lead+Dev+Rev）→ 选 tier → 解析 provider/model
      （tier→model 映射接 provider catalog/模型配置；未配置时给清晰默认与提示）
      —— 每步独立纯函数（classifyCategory/complexityForCategory/rolesForComplexity/roleTierFor/
      resolveTierBinding）均可注入、可单测；未配置档位回落默认档 + hints，默认档缺失抛错列已配置档
- [x] 用户显式 Fast/Pro 时绕过 classify 直达对应 tier；UI 展示实际选择 + Pin for session（pin 语义：
      本 session 锁定该选择不再自动重判；web/CLI seam 最小接线，UI 打磨不在此卡）
      —— compose seam（CLI/web 后端共用组装根）：ComposeOptions.taskRouter.{mode,pin} +
      ComposedHarness.route（AutoRoute，routeSelectionLabel → 「auto → <model>」）；compose 集成测试 5 例实证
- [x] 测试：默认 Auto/分类到角色/tier 解析/显式覆盖/pin，新增 ≥6 例；全量 vitest/tsc 绿
      （426+054+055 新增数 无回归）—— autoRouter.test.ts 20 例 + cli.taskrouter-auto.test.ts 5 例；
      全量 vitest / tsc -b 结果见"工作证明"
- [x] 文档同步（TaskRouter Auto 用法 + tier→model 解析说明）—— 新建 docs/TASKROUTER-AUTO.md；
      AGENT-PRESETS.md §5/§6 状态与决策同步
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 聚焦路由解析链 + 默认接线。TeamRuntime 真跑三角色（057）、UI 打磨（060）不在本卡。

## 涉及文件（指针，执行器自行精化）

- 现有 TaskRouter 实现位置（packages/agents 或相关，054/055 侦察后应已明确）
- packages/agents/src/presets/（054/055 的 preset/tier 定义）
- provider/model 解析（provider catalog 机制、configs/pricing 或 model 配置）
- CLI/web 的模型选择 seam

## 方法

- 读 §10 与 §8.2；先看 TaskRouter 现状与 compose 接线，把 Auto 设为默认分支
- classify→role→tier→model 每步可测（注入分类器与 model 解析便于单测）

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 执行器回填（2026-09-08，隔离子代理完成）

### 改动文件 + diff 摘要

| 文件 | 改动 |
|---|---|
| `packages/llm/src/router/autoRouter.ts`（新建） | AutoTaskRouter + RouteMode(auto/fast/pro 默认 auto) + TaskComplexity + DEFAULT_CATEGORY_COMPLEXITY / DEFAULT_COMPLEXITY_ROLES(§8.2) / DEFAULT_ROLE_TIERS(§8.3) + TierBindings 开放档绑定 + 解析链纯函数（classifyCategory/complexityForCategory/rolesForComplexity/roleTierFor/resolveTierBinding） + AutoRoute{roles,roleModels,primary,hints,pinned} + routeSelectionLabel + pinCurrent/isPinned/unpin |
| `packages/llm/src/index.ts` | `export * from './router/autoRouter.js'` |
| `packages/llm/src/router/autoRouter.test.ts`（新建） | 20 用例（见下测试清单） |
| `packages/application/src/compose.ts` | ComposeOptions.taskRouter 增加 `bindings?(扩展档)/mode?(默认 auto)/pin?`；内部 TaskRouter → AutoTaskRouter（默认 Auto 分支）；ComposedHarness 暴露 `route?: AutoRoute` + taskRouter 类型换 AutoTaskRouter；触发条件 = taskPrompt 或显式 fast/pro，保持"无触发=显式 provider/model"旧契约 |
| `apps/cli/src/cli.taskrouter-auto.test.ts`（新建） | compose seam 集成 5 用例（默认 Auto 全链 / 显式 Pro 绕过 / 显式 Fast / pin / review 档未配置提示 + bindings 扩展） |
| `docs/TASKROUTER-AUTO.md`（新建） | TaskRouter Auto 用法 + tier→model 解析分层说明 + compose seam 示例 |
| `docs/AGENT-PRESETS.md` | §5 modelTier 行 ⏳→✅（056 autoRouter 交付）；§6 类别 agentPreset 标签解析决策后移 057 并记录 |
| `tasks/056-task-router-auto.md` | 本卡（状态/验收勾选/工作证明） |

### 新增测试数与命令输出

- autoRouter.test.ts：**20 例**（默认 Auto / isRouteMode / 小中复杂三档角色 / tier 解析含 review /
  显式 Fast/Pro 绕过 classify / pin 锁定+显式覆盖+unpin 恢复 / pin 前抛错指引 / 未配置档回落+hints /
  默认档缺失抛错列已配置 / provider 缺失抛错 / 解析链纯函数逐级 / 分类器注入 / 显式 category /
  routeSelectionLabel / 空任务 unknown→medium）
- cli.taskrouter-auto.test.ts：**5 例**（compose seam，真 loop 跑通验证 primary provider/model 生效）
- 命令输出（本机 vitest v2.1.9 可直跑，非受限环境）：
  `npx vitest run packages/llm/src/router/autoRouter.test.ts` → `20 passed (20)`；
  `npx vitest run apps/cli/src/cli.taskrouter-auto.test.ts` → `5 passed (5)`；
  定向回归 `npx vitest run packages/llm apps/cli/src/cli.test.ts packages/engine/src/task-selection.test.ts`
  → `109 passed (10 files)`（含旧 V0.4 路由两用例不回归）
- 全量验证：`npx tsc -b tsconfig.json` → `TSC_EXIT:0`；全量 `npx vitest run` 结果见下（执行器收尾时回填计数）

### 全量 vitest / tsc 结果

- 全量 `npx vitest run` → **57 files / 475 tests all passed**（基线 450 + 本卡新增 25：autoRouter 20 +
  compose seam 5；VITEST_EXIT:0，零失败零回归）
- 全量 `npx tsc -b tsconfig.json --pretty false` → **TSC_EXIT:0**

### 解析链设计选择与分层理由（tier→model 归属）

1. **放 llm/router 新建 autoRouter.ts，TaskRouter.ts（V0.4）原样不动**：V0.4 TaskRouter 的类别 preset 表
   语义被 engine/selection、bench 既有消费方依赖；056 是其产品化包装层（默认 Auto 的选择器），
   新模块独立可测、零回归风险（全量验证佐证）。
2. **默认数据表与 V0.4 主档等价**：类别→复杂度映射（small→fast、medium/pro、complex/pro、unknown→medium）
   保证 compose/bench 既有路由行为不回退（B022 implementation→pro 金标不变，定向+全量回归佐证）。
3. **tier→model 绑定归属 provider/config 层**：autoRouter 只声明档位意图 + 开放 `TierBindings`
   （`Record<string,{providerId,model}>`，含 review 档），由调用方注入——本层零模型名写死；
   compose 把 legacy tierModel 与 taskRouter.bindings 合并（扩展档优先）。未配置档位回落默认档 'pro'
   + hints 提示（不改默认；要专属评审模型就配 bindings.review）；默认档也缺则抛错列已配置档，fail loud。
4. **角色只透传 preset id 字符串**（lead/developer/reviewer，与 agents/presets registry 对齐），
   llm 不 import agents（分层铁律）；角色→AgentPreset 规格解析与 per-role 会话构造归 057。
5. **pin 语义**：pinCurrent() 锁定最近一次 Auto 解析（无结果抛错带指引）；pin 后 Auto resolve 直接返回
   锁定选择不再分类；显式 Fast/Pro 是用户最新意图不被 pin 吞。compose 侧 pin:true 组装时即锁定
   （本 session 一次路由）。
6. **seam 最小接线**：只动 compose（CLI run/chat 与 web 后端都经它组装）+ CLI 测试装配，
   未改 apps/web UI、未改 SessionController（UI 打磨 060 / TeamRuntime 057 的边界）。
7. **范围边界遵守**：未实现 TeamRuntime 三角色真跑（057）、未加 provider profile 配置文件机制、
   未加新依赖、未动 core/agents 运行时。

### 踩坑记录

- pin 最初设计 resolve 后可直接 pinCurrent()，但 resolve 未持久化最近 Auto 结果 → 补 `lastAutoRoute`
  字段（resolveAuto 每次落盘，pinCurrent 锁 lastAutoRoute），测试暴露后修复。
- 显式 fast/pro 需要无 taskPrompt 也能 compose 触发路由 → compose 触发条件改为
  `Boolean(taskPrompt) || mode∈{fast,pro}`，保住 cli.test "无 taskPrompt=显式钉死"旧契约（回归绿佐证）。
- vitest 在本会话可直跑（无 EPERM），全程本地验证；无受限环境降级记录。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
