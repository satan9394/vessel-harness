# 037 — 抽出 @vessel/application（Composition Root 从 CLI 移到共享应用层）

- 状态：待执行
- 优先级：P0（Milestone B 首发；路线"问题 1"）
- 创建日期：2026-09
- 关联：路线 §四 Application Layer、§五/六 Surface、卡 038 等；goal（V1.0 产品化）

## 目标

把 `apps/cli/src/compose.ts`（282 行，当前 Composition Root）迁移为独立 workspace 包 `packages/application/`，让 CLI 与未来 Web 共用同一 Harness 组合，避免两套 wiring。**不是重构 core，只是把组合逻辑抽成可复用应用层。**

## 验收标准

- [ ] 新建 `packages/application/`（package.json name `@vessel/application`，tsconfig 并入 workspace）
- [ ] `src/compose.ts`（从 apps/cli 移来）+ `src/index.ts` 导出 composeHarness 与相关类型
- [ ] apps/cli 改为 `import { composeHarness } from '@vessel/application'`（删掉 apps/cli 本地 compose.ts；删除走回收站，或先留转发再删按纪律）
- [ ] 所有依赖随迁（compose 只依赖 @vessel/* 各包，无 CLI 内部耦合——指挥已侦察确认）
- [ ] `npm install` 重建 workspace 软链；`npx tsc -b` + `npx vitest run` 全绿（297+ 无回归）
- [ ] `vessel run` / `vessel` 交互仍正常（冒烟）
- [ ] 卡置"待验收"

## 涉及

- 新建 `packages/application/{package.json,tsconfig.json,src/compose.ts,src/index.ts}`
- 删/迁 `apps/cli/src/compose.ts`
- 更新 `apps/cli/src/cli.ts`、`tui/chat.ts` 等 compose import

## 依赖

- 依赖零环纪律：application 只依赖 @vessel/* 各包，不反向依赖 cli
- 删除铁律：本地 compose.ts 删除走回收站（`[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile`）

## 方法（指挥预研）

- compose.ts 已只依赖 @vessel/*（无 CLI 内部 import），属纯移动 + 包骨架
- 移动后 apps/cli 的 cli.ts/chat.ts import 路径从 `./compose.js` 改 `@vessel/application`
- 保留 SessionController/RunController 抽离到 Milestone 更晚（038/039），本卡先只搬 compose + 建包

## 工作证明（执行器回填）

- [ ] 包结构 diff / 测试 / tsc / 冒烟

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：