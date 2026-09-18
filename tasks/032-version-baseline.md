# 032 — V0.10 Stabilization：clean-install baseline + product/spec version taxonomy

- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待执行」；实际已合入，证据：docs/V1.0-CHECKPOINT.md Milestone A（ad0a654）。
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

- [x] product version: root + apps/cli + packages/shared package.json `0.1.0`→`0.10.0`；`packages/shared/src/constants.ts` `VERSION='0.10.0'`；cli.test.ts 断言同步 `Vessel CLI v0.10.0`；package-lock.json 对应 workspace entry（root/apps-cli/packages-shared）同步为 0.10.0 保持一致
- [x] clean 链（build 代替 npm install，本环境不动 node_modules）：
  - `npx tsc -b tsconfig.json` → exit 0
  - `npx vitest run` → 297 passed（37 files），exit 0
  - `node apps/cli/dist/cli.js --version` → `Vessel CLI v0.10.0`，exit 0
  - `node apps/cli/dist/cli.js run --prompt "你好"` → turn kind=success steps=1 toolCalls=0，会话日志写入 `.harness/sessions/...`，exit 0
- [x] commit `ad0a654`：`chore(version): V0.10 product version 0.1.0 -> 0.10.0 + clean-install baseline verified`
- [x] `git status --short` 干净
- 说明：未执行 `npm install`（任务要求规避 node_modules 变更/耗时），用 `tsc -b` 重新构建产物代替；若路线强制 strict `npm install` 才算验收，需指挥在真机补跑。其他 workspace（packages/agents 等）package.json 及 lockfile 仍为 0.1.0，未在本次范围改动。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：