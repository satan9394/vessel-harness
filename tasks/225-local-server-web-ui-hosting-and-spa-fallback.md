# T225 — Local Server 静态托管与 Web UI 生产直连（SPA 路由回退与 dist 优先探测）

- Status: 已完成（2026-10-18，按 PDW 契约自主推进：Codex 实现 + 独立星球角色隔离，OpenCode 对抗复核 pass）
- Mode: develop（功能完善与基础设施对齐）
- Source: human-requested（"简单把自己设定一下目标任务，然后该怎么分配执行，就自主推进执行。记住：Codex写代码，每一个都有自个儿的星球，严格按照Skill予以执行"）
- Risk: low（局限于 apps/local-server 静态文件服务与测试；packages/core 零修改；不破坏既有 API）

## Goal

彻底消除 `AGENTS.md` 与走查报告中记录的历史缺陷（"vessel serve / vessel web 不提供本 Web UI，只能开 Vite dev"）：
1. 在 `apps/local-server/src/server.ts` 中实现默认静态目录双重探测：当未显式指定 `staticDir` 时，优先探测 `apps/web/dist`（若存在且含 `index.html` 则作为静态根目录），无 dist 时优雅回退至既有 `apps/local-server/public` 演示着陆页。
2. 在 `serveStatic` 中增加单页应用（SPA）路由回退支持：对非 `/api/` 且无文件扩展名的页面导航请求（或 Accept 头含 `text/html` 的非存在资源路径），回退返回 `index.html`（HTTP 200），使前端路由（`/activity`、`/studio`、`/settings`、`/tasks` 等）在无 Vite dev 的情况下可直接刷新访问。
3. 对缺失的静态资产（如 `.js`、`.css`、`.png`）依然精准返回 404 `{ error: "not_found" }`；严格保持既有路径穿越（Path Traversal）安全拦截（403 forbidden）。
4. 编写并运行严谨的定向单测套件，验证 dist 优先探测、SPA 页面路由回退、静态资源 404 及安全穿越防御。

## Not Doing / Constraints

- **不**修改 `packages/core`（Thin Core 铁律，改动行数严格为 0）。
- **不**破坏既有 `/api/` 路由、SSE 事件流、Daemon 鉴权与中间件。
- **不**提交 / 推送至 Git 远程（保持纯本地开发纪律）。
- **不**进行永久删除（删除走回收站；临时测试目录遵循书面例外）。
- **不**破坏既有测试基线。

## Acceptance Criteria

### 1. 静态目录解析与 SPA 回退
- [x] 默认目录探测：在未指定 `staticDir` 时，若 `apps/web/dist/index.html` 存在则自动选用 `apps/web/dist`，否则使用 `apps/local-server/public`（`resolveStaticDir` 实现并导出，覆盖存在/缺失/无效判定）。
- [x] SPA 客户端路由回退：向未匹配具体文件的页面路径（如 `/activity`、`/studio`、`/settings`、`/tasks`）发起 GET 请求时，正确返回 `index.html`（HTTP 200，`Content-Type: text/html; charset=utf-8`）。
- [x] 静态资源 404：对不存在的具体文件扩展名请求（如 `/assets/missing.js`、`/favicon-missing.png`）返回 404 `{ error: "not_found" }`，不误命中 SPA 回退。
- [x] 穿越安全防护：包含 `..` 的路径穿越探测在 WHATWG URL 规范化前直接拦截，硬拦截并返回 403 `{ error: "forbidden" }`（支持 `/../secret`、`/%2e%2e/`、`/%2e%2e%2f` 等多种编码向量）。

### 2. 自动化测试与验证
- [x] 在 `apps/local-server/src/server.test.ts` 中新增覆盖上述四项特性的专项测试套件（19 项静态单测覆盖）。
- [x] `npx vitest run apps/local-server/src/server.test.ts` 全部通过（43 passed）。
- [x] `npx tsc -b tsconfig.json` 与 `npm run typecheck:tests` 编译退出码 0。
- [x] 全量 `npm run test:all` 双 Root 无回归（根 289 文件 3056 passed + Web 40 文件 340 passed，总计 3396 项全部通过，0 失败）。

## Blast Radius

- `apps/local-server/src/server.ts`（导出 `resolveStaticDir`，补齐 rawPath 穿越 403 防御与 SPA 回退）
- `apps/local-server/src/server.test.ts`（新增 19 项静态托管、路由回退与安全测试）
- `tasks/225-local-server-web-ui-hosting-and-spa-fallback.md`
- `tasks/README.md`（状态登记）

## Expected Evidence

- 定向测试输出日志：`apps/local-server/src/server.test.ts` 43 passed (exit 0)
- 编译与类型检查日志：`tsc -b` exit 0, `typecheck:tests` exit 0
- 全量回归日志：`npm run test:all` 3396 passed (exit 0)
- 独立复核结果（OpenCode `commandgota/deepseek/deepseek-v4.1-flash#max` 对抗评审通过，verdict: pass）

## Result

- 交付状态：**accepted_local**（PDW 任务 ID：`20261018084924-70fefd`）。
- 实施角色：
  - `scan`: OpenCode（`commandgota/deepseek/deepseek-v4.1-flash`）——完成静态托管现状剖析与调用链路定位。
  - `test-plan`: OpenCode（`commandgota/deepseek/deepseek-v4.1-flash`）——衍生测试矩阵并识别 URL 规范化前穿越拦截与扩展名定序要点。
  - `implement`: Codex（`gpt-6.1-sol`，思考深度 `medium`）——独立在沙箱会话中实现 `resolveStaticDir`、URL 规范化前原始路径校验、SPA 回退逻辑以及 19 项定向测试。
  - `review`: OpenCode（`commandgota/deepseek/deepseek-v4.1-flash#max`）——独立对抗性复查，核实全部 4 条验收标准通过且无 high/blocker 缺陷。
- 自动化验证门禁：
  - `npx vitest run apps/local-server/src/server.test.ts`：43 passed（43），退出码 0。
  - `npx tsc -b tsconfig.json`：退出码 0。
  - `npm run typecheck:tests`：退出码 0。
  - `npm run test:all`：根 289 文件 3056 passed + web 40 文件 340 passed = 3396 passed, 6 skipped，退出码 0。
  - `npm run -w @vessel/web build`：退出码 0（构建耗时 1.04s）。
