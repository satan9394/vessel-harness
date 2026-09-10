# 108 — 真实模型对比：deepseek-flash vs mimo-v2.5（收敛稳定性）

- 编号：108
- 状态：待执行
- 优先级：P0（用户指定：换模型验证长工具链收敛）
- 创建日期：2026-09-10
- 关联：102（5af2dfc：opencode-go 协议 + mimo-v2.5 真实跑通；长工具链收敛不稳）；103（afac81a：协议上提
  packages/llm SSOT）；105（e064209：key 已入库 CredentialStore）；082 lane；084 gate 4
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

用户指定改用 opencode-go 端点的 **`deepseek-flash`** 模型跑真实 lane，与 mimo-v2.5 对比**长工具链收敛稳定性**
（102 观察到 mimo-v2.5 同场景跨次 passed/failed，失败模式=finalText 空 + 工具调用到 MAX_STEPS_PER_TURN=64）。

## 前置事实（勿重复摸索）

- 端点 `https://opencode.ai/zen/go/v1`；**DeepSeek 走 `/chat/completions` 路径**（102 记录：chat/completions 承载
  GLM/Kimi/LongCat/DeepSeek/MiMo/Hy/Omen）；协议需 `x-opencode-session`（103 已上提 packages/llm SSOT，CLI/lane 共用）
- key 已在 CredentialStore（105 入库，`same=true`；`--key-source=store`/`auto` 即可，**不要再收 key**）
- 102 已产出 mimo-v2.5 基线报告：`benchmarks/reports/real-model-lane-1788964714845.md`（10 场景 9/1）、
  `real-model-lane-1788968940484.md`（gate 4 9/1）等；mimo 长工具链收敛不稳

## 验收标准（执行器逐条勾选）

- [ ] 先用最小 probe 确认 `deepseek-flash` 在 `/v1/models` 清单中存在、走 `/chat/completions` 可用
      （POST 最小聊天，200 + usage；确认是否推理模型→max_tokens 预算）
- [ ] **同场景集对比**：用 102 相同的 LANE_SCENARIOS 子集跑 `deepseek-flash`（082 lane，`--key-source=store`），
      产出 `benchmarks/reports/real-model-lane-<ts>-deepseek-flash.md`；**对同一失败场景重跑 ≥2 次**判断跨次稳定性
- [ ] 对比表：mimo-v2.5 vs deepseek-flash（同场景 passed/failed、finalText 状态、工具步数、失败模式、usage/耗时）
- [ ] 084 gate 4（judgeRealModelLaneWithNonConvergence）：deepseek-flash 下 pass/pending 如实标注（不伪造）
- [ ] 结论与建议：deepseek-flash 是否更稳定/更适合长工具链场景；是否应把 lane 默认模型从 mimo-v2.5 换掉
      （**只建议不改默认**，除非用户已授权——本卡用户指定测试，改默认需另行确认）
- [ ] `npx tsc -b tsconfig.json` exit 0 + 全量 vitest（1153+ 无回归）+ web 82
- [ ] 文档同步（REAL-MODEL-LANE：deepseek-flash 对比结论）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做真实模型对比测试 + 报告 + 建议。不改协议/判据默认值；不做 UI；不加依赖。
- 密钥不落盘（从 CredentialStore/env 读）；报告不含 key。
- 真实调用配额最小化（probe + 场景集 × 1-2 次）。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/`（082 lane 驱动 + OpencodeGoProvider SSOT，103）
- `benchmarks/runners/src/release-gates/`（084 gate 4）
- 报告：`benchmarks/reports/real-model-lane-*.md`
- 参考：102 的 mimo 基线报告 + `docs/OPENCODE-KEY-VERIFY.md` + `docs/REAL-MODEL-LANE.md`

## 方法

- probe 确认模型 → 同场景集跑 deepseek-flash（含跨次重跑）→ 对比表 → gate 4 → 结论建议 → 文档

## 工作证明（执行器回填：probe 结果/全场景 tabla/跨次稳定性/mimo 对比/gate 4/建议，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：