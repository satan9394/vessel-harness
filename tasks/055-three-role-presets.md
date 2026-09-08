# 055 — Lead / Developer / Reviewer presets（三角色默认实例）

- 状态：待执行
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

- [ ] packages/agents/src/presets/ 提供默认集：lead/developer/reviewer 三个 AgentPreset 实例
      （语义对齐 §8.1：lead=orchestrator/modelTier pro/canDelegate、developer=generator/modelTier
      pro|fast/write:true、reviewer=evaluator/modelTier review/write:false）
- [ ] 能力映射落地：preset 的 write/canDelegate/tools 映射到既有运行时开关（tool 可见性、
      delegate 允许、budget 等——以仓库现状为准，映射方式记录设计选择）；054 若只留映射点则本卡接线
- [ ] 与 @vessel/shared / compose / configs 兼容；默认模型 tier→model 的解析若仓库已有 provider
      catalog 机制则接上，无则留给 056
- [ ] 测试：三实例形状/能力映射/注册查取，新增 ≥5 例；全量 vitest/tsc 绿（426+054 新增数 无回归）
- [ ] 文档同步（preset 说明里三角色默认值）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做三角色实例 + 能力映射。TaskRouter（056）、TeamRuntime（057）、UI（060）各自成卡。

## 涉及文件（指针，执行器自行精化）

- packages/agents/src/presets/（054 建的 types/registry + 本卡新增默认实例文件）
- 能力开关所在处（EvaluatorAgent/SubagentManager/tool 可见性机制，见 054 侦察结论）
- packages/agents/src/index.ts 导出

## 方法

- 读 §8.1-8.3；054 验收后在其 registry 上注册默认集；映射点逐一接既有开关并测试

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
