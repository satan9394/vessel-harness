# 任务卡 226：CLI Serve 工作区自动注册与服务自省增强 (CLI Serve Workspace Auto-Registration & Server Info)

- **状态**：已完成 (2026-10-18，本地验收通过)
- **日期**：2026-10-18
- **执行模型**：Codex (`gpt-6.1-sol`, `reasoning_effort: "medium"`) 独立实现；OpenCode 独立复审；Antigravity 规划调度
- **PDW 任务 ID**：`20261018102744-05f80d` (状态：`accepted_local`)

## 目标 (Goal)

承接任务 225（Local Server 静态托管与 SPA 回退支持），消除 `vessel serve` / `vessel web` 启动后 Web UI 项目下拉列表为空的重大体验割裂：
1. **工作区自动入库**：在 `createVesselServer` 的 `VesselServerOptions` 中显式支持 `workspace?: string` 选项。若提供，服务器启动时自动将其注册至 `ProjectRegistry`（最佳努力尝试，不影响既有报错语义）。使客户端 `GET /api/projects` 在服务首次启动时即可直接获得当前 CLI 所在工作区，Web 工作台无需用户手动复制粘贴绝对路径。
2. **CLI 传参衔接**：在 `apps/cli/src/cli.ts` 的 `startServe` 函数中，将已计算出的 `workspace`（由 `--workspace <dir>` 或 `process.cwd()` 解析得到）传递至 `createVesselServer({ workspace, ... })`。
3. **健康检查扩展**：扩充 `GET /api/health` 响应，增加 `webUi: boolean`（指示当前是否由 `apps/web/dist` 托管真实 Web UI）与 `workspace?: string` 字段，保持强类型与向后兼容。
4. **CLI 帮助与提示完善**：更新 `apps/cli/src/cli.ts` 中的 `USAGE` 帮助文档，标明 `vessel serve` 与 `vessel web` 支持 `--workspace <dir>` 参数。并在 `startServe` 控制台回显中明确 Web UI 托管形态。
5. **严密测试与全量门禁**：在 `apps/local-server/src/server.test.ts` 补充专项测试，验证工作区注册、跨会话/首次启动项目查询及 `/api/health` 增强字段；全仓双 Root 回归测试 100% 绿灯。

## 不做的事 (Not Doing)

- 不修改 `packages/core`（恪守薄核零侵入红线）。
- 不破坏既有 `POST /api/projects/open` 或 `ProjectRegistry` 的持久化与防损坏语义。
- 不引入第三方外部包或破坏 `npm workspaces` 依赖锁。
- 不进行任何永久删除，不执行 `git push`。

## 验收条件 (Acceptance Criteria)

- [x] **AC1**：`VesselServerOptions` 扩展 `workspace?: string` 字段。当实例化 `createVesselServer({ workspace })` 时，`projectRegistry.open(workspace)` 自动执行，`GET /api/projects` 即刻包含该工作区。
- [x] **AC2**：`apps/cli/src/cli.ts` 的 `startServe` 正确将 `workspace` 传给 `createVesselServer`。
- [x] **AC3**：`GET /api/health` 返回包含 `webUi: boolean` 和 `workspace?: string`，且原有字段 `{ ok: true, version: string }` 完全保持兼容。
- [x] **AC4**：`apps/cli/src/cli.ts` 的 `USAGE` 帮助文案更新为包含 `[--workspace <dir>]`。
- [x] **AC5**：`apps/local-server/src/server.test.ts` 包含对 AC1-AC3 的完备定向测试用例，运行全部 pass。
- [x] **AC6**：`tsc -b`、`npm run typecheck:tests`、`npm run test:all`（双 Root）全部 pass，Web 前端构建 exit 0，Thin Core 变动 0 行。

## 爆炸半径 (Blast Radius)

- `apps/local-server/src/server.ts`
- `apps/local-server/src/server.test.ts`
- `apps/local-server/src/daemon/authMiddleware.test.ts`
- `apps/cli/src/cli.ts`
- `apps/cli/src/cli.test.ts`

## 验证与验收记录 (Verification & Acceptance)

- **PDW 流水线运行记录**：
  - `scan`: OpenCode (`commandgota/deepseek/deepseek-v4.1-flash`) 定位 `createVesselServer`、`startServe` 与相关测试
  - `test-plan`: OpenCode 编制 AC1–AC5 矩阵与类型契约断言
  - `implement`: Codex (`gpt-6.1-sol`, `reasoning_effort: "medium"`) 在隔离环境中独立完成编码与单测
  - `review`: OpenCode (`commandgota/deepseek/deepseek-v4.1-flash#max`) 顶格思考独立审查通过（verdict: pass）
- **门禁实测数据**：
  - `npx tsc -b tsconfig.json`: exit 0
  - `npm run typecheck:tests`: exit 0
  - 定向单测 `apps/local-server/src/server.test.ts` (49/49) + `apps/cli/src/cli.test.ts` (107/107) 全部 pass
  - `apps/local-server` 全包测试：20 文件 / 189 passed 全部 pass
  - 前端打包 `npm run -w @vessel/web build -- --emptyOutDir false`: exit 0 (耗时 930ms)
  - 全量回归 `npm run test:all`:
    - Root: 289 文件 / 3,063 passed / 6 skipped (3,069 tests)
    - Web: 40 文件 / 340 passed (340 tests)
    - 合计：**329 文件 / 3,403 项测试全部通过，0 失败**
  - Thin Core 红线：`packages/core` 修改行数严格为 **0**
- **产物与证据**：
  - 任务运行记录：`.pdw/tasks/20261018102744-05f80d/`
  - 报告文件：`.pdw/tasks/20261018102744-05f80d/REPORT.md`
