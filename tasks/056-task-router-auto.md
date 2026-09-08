# 056 — TaskRouter 默认 Auto（用户只选 Auto/Fast/Pro，默认 Auto）

- 状态：待执行
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

- [ ] TaskRouter 默认 Auto 模式（现状：TaskRouter 已有但需手动选模型；查 packages 内 TaskRouter
      现状后接默认路径）
- [ ] Auto 解析链落地：任务分类（现有 task category 机制，见 tasks/006-task-category 相关既有实现）
      → 选角色（小/中/复杂 → Single / Dev+Rev / Lead+Dev+Rev）→ 选 tier → 解析 provider/model
      （tier→model 映射接 provider catalog/模型配置；未配置时给清晰默认与提示）
- [ ] 用户显式 Fast/Pro 时绕过 classify 直达对应 tier；UI 展示实际选择 + Pin for session（pin 语义：
      本 session 锁定该选择不再自动重判；web/CLI seam 最小接线，UI 打磨不在此卡）
- [ ] 测试：默认 Auto/分类到角色/tier 解析/显式覆盖/pin，新增 ≥6 例；全量 vitest/tsc 绿
      （426+054+055 新增数 无回归）
- [ ] 文档同步（TaskRouter Auto 用法）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

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

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
