# 032 — V0.10 Stabilization：clean-install baseline + product/spec version taxonomy

- 状态：待执行
- 优先级：P0（Milestone A 首发）
- 创建日期：2026-09
- 关联：路线文档 §十六 V0.10 任务1、2、§八 版本问题；goal（V1.0 产品化）

## 目标

1. **product version 规范化**：区分 Product Version 与 Spec Version。root package.json `version` 与 apps/cli `version` 从 0.1.0 统一升级到与路线一致（建议 `0.10.0`，为 V1.x 让路；具体值以路线为准或选一个清晰基线）。`vessel --version` 输出随之更新。
2. **clean-install 基线验证**：在 Windows 原环境跑一遍文档 §V0.10 验收命令链：`npm install && npm run build && npm test && vessel --version && vessel run mock` 全通过，并留证。

## 验收标准

- [ ] root + apps/cli package.json version 从 0.1.0 改为 0.10.0（或路线强调的统一值），`vessel --version` 输出含该版本
- [ ] ARCHITECTURE.md / DESIGN-DECISIONS 等文档若混用 product/spec version，加注或澄清（至少不误导）
- [ ] clean 验收链在 Windows 跑通：npm install → npm run build → npm test（297+ 绿）→ vessel --version → vessel run mock 冒烟
- [ ] 全量 vitest/tsc 绿；git 提交
- [ ] 卡置"待验收"

## 方法

- 改 root/package.json + apps/cli/package.json 的 `"version": "0.1.0"` → `"0.10.0"`；若 VERSION 常量从 @vessel/shared 取，确认它读的是哪个、是否要同步（不改 shared 的语义，只对齐版本字符串）
- 跑 clean 链验证并留证据输出
- 注意：不改行为，仅版本与验证

## 工作证明（执行器回填）

- [ ] version diff / clean 链每个命令的真实输出 / vitest 数 / tsc / vessel --version

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：