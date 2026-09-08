# 027 — 移除 cah 别名 + CAH_* 环境变量 → VESSEL_*

- 状态：已合入（0eb0d89，移除 cah 别名 + CAH_*→VESSEL_*）
- 优先级：P0
- 创建日期：2026-09
- 关联：goal-0b579936；依赖 026（同批改名）

## 目标

- bin 移除 `cah` 别名（只保留 `vessel`）；description 去掉 alias cah 字样
- 环境变量 `CAH_MODEL/CAH_BASE_URL/CAH_API_KEY/CAH_PROVIDER_ROOT` → `VESSEL_MODEL/VESSEL_BASE_URL/VESSEL_API_KEY/VESSEL_PROVIDER_ROOT`（代码全改，CAH_ 零残留）
- 交互/帮助/问候语去掉"别名 cah"字样
- 文档（VESSEL/PROVIDER-*/TEST-REPORT/ideas）的 cah 命令与 CAH_ 引用全面清除

## 验收标准

- [ ] `grep -r "cah"`（源码 apps/packages 排除 dist/node_modules）→ 0（或仅历史注释允许？不——要求彻底，0 残留）
- [ ] `grep -r "CAH_"`（全仓排除 node_modules/.git/dist）→ 0
- [ ] bin 只有 vessel
- [ ] `vessel --help/--version` 无 "cah" 字样
- [ ] tsc/vitest 全绿
- [ ] 卡置"待验收"

## 涉及文件

- apps/cli/package.json（bin）、apps/cli/src/cli.ts、chat.ts、providers/ProviderStore.ts、setup.ts
- docs/*.md、docs/ideas/*.md、docs/VESSEL.md

## 依赖

- 026

## 工作证明（执行器回填）

- [ ] 残留 grep 0 / tsc / vitest

## 验收结论（指挥回填）

- [x] 已合入
- 备注：
