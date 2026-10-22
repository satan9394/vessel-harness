# 任务卡 257: 修复 apps/web 的 typecheck 门禁（10 条诊断清零）

**状态**: 已实现，门禁通过
**创建时间**: 2026-10-22
**执行者**: OpenCode
**协调者**: OpenCode

---

## 1. Goal (目标)

`npm run -w @vessel/web typecheck` 归零。该门禁不在 `tsc -b` 的图内（`apps/web` 是独立 noEmit 配置），
长期没人跑，导致「全量测试绿」与「类型门禁红」同时成立而无人发现。

## 2. 事实基线（可复核）

- `git show 949f394:...` 版本（卡 254 之后、卡 255 之前）：`tsc -p apps/web/tsconfig.json` 报 **11** 条诊断。
- 卡 255 提交 `8034500` 之后：**10** 条（其中 `refCell` 未使用那条随改动消失）。
- 结论：这 10 条是历史欠账，不是卡 255 引入；卡 255 只是让总数从 11 降到 10。

## 3. 改动（均为类型层，无运行时行为变化）

1. `apps/web/src/App.tsx`：删除未使用的 `localizedValue`、`RailArea`、`ACTIVE_UI_MODULES` 导入。
2. `apps/web/src/components/layout/Rail.tsx`：删除未使用的 `toggleTheme` 导入。
3. `apps/web/src/components/card222.test.tsx`：三条 `ActivityRunView` 夹具补 `needsApproval: false`。
4. `apps/web/src/api.ts`：`testProvider` 入参放宽为 `Pick<…> & Partial<Pick<AddProviderInput, 'name' | 'models'>>`。
   理由：服务端 `providerRoutes.test` 用 `input.name` 定位已存供应商以复用已存凭据（免输直测，卡 250 的 F2）；
   旧类型不允许 `name`，等于类型与运行时契约不一致。**不放宽就会误删 `name`、打掉免输直测**。
5. `apps/web/src/components/ConversationView.interaction.test.tsx`：`sessionUpdatedSpy` 明确为 `Mock<() => void>`；
   `className` 比较改 `String(node.props.className ?? '')`。

## 4. Not Doing (非目标)

- 不改 `apps/web` 的运行时逻辑、不动 UI 结构、不重排组件。
- 不加宽泛的 `any` 或 `@ts-expect-error` 压诊断。
- 不顺手做审计报告里的 P0（虚假完成、删除一致性），另开卡。

## 5. Acceptance Criteria (验收标准)

- `npm run -w @vessel/web typecheck` 退出码 0。
- `npm run test:web` 全绿（51 文件 / 424 项）。
- `npx tsc -b tsconfig.json` 退出码 0。
- `npm run -w @vessel/web build` 退出码 0。

## 6. Blast Radius (影响面)

`apps/web/src/App.tsx`、`apps/web/src/api.ts`、`apps/web/src/components/layout/Rail.tsx`、
`apps/web/src/components/card222.test.tsx`、`apps/web/src/components/ConversationView.interaction.test.tsx`。

## 7. Result

四项门禁全绿后提交；详见提交信息与 `evidence/task257/`。
