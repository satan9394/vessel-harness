# 026 — @cah/* → @vessel/* 包名迁移（全仓）

- 状态：已合入（76d3a8d，@cah→@vessel 零残留）
- 优先级：P0
- 创建日期：2026-09
- 关联：goal-0b579936

## 目标

全仓将 12 个 packages + apps/cli 的包名从 `@cah/*` 迁移为 `@vessel/*`：package.json name、所有源码 import、tsconfig references/paths、vitest alias、scripts/dev-test alias、node_modules 软链。**彻底移除 @cah**（除历史 commit 与 .git 外零残留）。

## 验收标准

- [ ] 全仓 `grep -r "@cah/"`（排除 node_modules/.git/dist/reports）为 **0**
- [ ] 12+1 个包 package.json name 全部 `@vessel/*`
- [ ] tsconfig.json/vitest.config.ts/scripts/dev-test/test-alias.mjs 的 @cah alias 全部更新
- [ ] `npm install` 重建 workspace 软链（node_modules/@vessel/* 存在，@cah 软链移除）
- [ ] `npx tsc -b` exit 0 + `npx vitest run` 全绿（≥285）
- [ ] 冒烟：`node apps/cli/dist/cli.js --version` 正常
- [ ] 卡置"待验收"

## 涉及文件

- 全部 packages/*/package.json、apps/cli/package.json
- 全部源码 import（.ts）、tsconfig*.json、vitest.config.ts、scripts/dev-test/*.mjs
- package-lock.json（npm install 后自动）

## 依赖

- 无（首发）

## 方法

- 批量替换：`@cah/` → `@vessel/`（字符串替换，非正则，避免误伤）
- package.json name 字段单独核对（"@cah/xxx" → "@vessel/xxx"）
- npm install 重建软链后验证
- 每步 tsc/vitest 验证

## 工作证明（执行器回填）

- [ ] diff 统计（多少文件改）/ tsc / vitest / 残留 grep

## 验收结论（指挥回填）

- [x] 已合入
- 备注：
