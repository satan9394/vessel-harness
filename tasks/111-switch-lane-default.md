# 111 — lane 默认模型切换：mimo-v2.5 → deepseek-flash

- 编号：111
- 状态：待执行
- 优先级：P1（110 建议 + 指挥采纳；改善 real-model lane 稳定性）
- 创建日期：2026-09-10
- 关联：110（1b076e2：deepseek 全场景 10/10、收敛快）；108/109（wire 修复打通 deepseek）；
      docs/REAL-MODEL-LANE.md；082 lane；084 gate 4
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 目标

把 082 real-model lane 的**默认模型**从 `mimo-v2.5` 换成 `deepseek-flash`（110 终对比：稳定性 10/10 全过 vs
mimo 恒有失败、收敛快；成本更高已记录）。**只改默认值 + 相关文档/常量**，不动协议/判据；暴露 `--models`
覆盖以保留 mimo 复跑能力。

## 验收标准（执行器逐条勾选）

- [ ] 定位 lane 默认模型常量/默认参数（`benchmarks/runners/src/lane/`：defaultLaneModels 或等价，102/110 用过
      `--models`）——把默认从 mimo-v2.5 改为 deepseek-flash（**保留显式 --models=mimo-v2.5 覆盖能力**）
- [ ] 相关默认（如推理预算/路径声明：deepseek 走 /chat/completions 已由 109 支持）核对无遗漏
- [ ] 文档同步：`docs/REAL-MODEL-LANE.md` 默认模型节（写明：默认 deepseek-flash，理由=稳定性；成本特性注明：
      单轮最高 $0.94 vs mimo $0.59；`--models=mimo-v2.5` 可复跑）；若 release-report 或 gate 文档引默认也同步
- [ ] 测试：默认值断言（CLI 无 --models 时 resolve 到 deepseek-flash；显式 --models=mimo-v2.5 覆盖）；`tsc -b`
      exit 0 + 全量 vitest（1166+ 无回归）+ web 82
- [ ] **可选（尽力而为）**：真实 lane 默认跑 1 个场景确认默认生效（key 从 CredentialStore；不强制，若环境受限注明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只改默认模型 + 文档 + 默认断言。不动协议/判据/pricing；不做 UI；不加依赖。
- 密钥不落盘（CredentialStore/env；输出只许指纹）。

## 涉及文件（指针，执行器自行精化）

- `benchmarks/runners/src/lane/`（默认模型常量：opencodeGoProvider.ts / lane 驱动 index 或 run 脚本）
- `docs/REAL-MODEL-LANE.md`

## 方法

- 读 110 报告与 lane 默认定义 → 改默认 → 断言/文档 → 全量验证

## 工作证明（执行器回填：改了什么/默认断言/文档 diff/测试结果，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：