# Codex 交接单 · 2026-10-27 · 删除与保留 / 状态栏三态

> 用法：在 Codex 应用里把这个文件的路径给它，或直接说「按 `tasks/prompts/codex-handoff-2026-10-27-deletion-retention.md` 执行任务 N」。
> 本文件是**执行指令**，不是设计文档：设计口径在 `docs/DELETION-AND-RETENTION.md` 与 `docs/DESIGN-DECISIONS.md` 决策点 24，任务卡在 `tasks/342`、`tasks/344`、`tasks/345`。

**最短用法**：把下面这一段连同你要跑的任务号发给 Codex 应用即可。

```text
仓库 E:\Code_file\Projects\Vessel_Harness。严格按 tasks/prompts/codex-handoff-2026-10-27-deletion-retention.md 执行 T3（卡 345a）。
守则、允许改的文件、自验命令、报告格式都以该文件为准；不要做别的任务，不要 commit。
```

## 0. 全局约定（每个任务都适用）

1. 仓库根：`E:\Code_file\Projects\Vessel_Harness`，Windows + PowerShell 7。所有相对路径相对仓库根。
2. **只改「允许改的文件」里列出的路径**。多改一个文件，这一轮就算没交付——runner 与协调者都会按 scope 判越界。
3. **不 commit、不 push、不建分支、不改 `.pdw/`**。
4. 命令被沙箱或审批拒绝时，把**原始报错**写进报告，不要推测「应该能过」，也不要伪造 exit code。
5. 不跑全量门禁（`scripts/gate-batched.ps1` 由协调者跑）。你只跑本任务列出的定向自验。
6. 报告固定四段：改动文件清单、每条自验命令 + exit + 测试计数、未做的与原因、被拒绝命令的原文。
7. 不要顺手做别的卡。看到其他卡的 TODO 不要动，最多在报告里写一行。
8. 同一时刻只跑一个任务；有依赖的三个（T3 → T4 → T5）必须按顺序。
9. **子代理默认关闭，但可被你的指令显式打开**：`.codex/config.toml` 里 `multi_agent = true`，默认子代理是 `gpt-6-luna`/`high`，另有具名 `pdw_explorer`（只读探索）与 `pdw_ui_verifier`（浏览器验收）。没有明确要求时按单线程执行，不要调用 `spawn_agent`；若本次指令里明确写了「用合适的子 Agent」，则按用户要求执行，但必须满足：同一文件同一时刻只有一个写者；实现一个子代理、独立只读复核另一个子代理；不启动本机其他 Agent CLI（dsh / opencode / claude / pi）。

## 1. 任务总表（模型与档位由你选，下表只是建议）

| 任务 | 卡 | 内容 | 建议模型 | 建议深度 | 依赖 |
|---|---|---|---|---|---|
| T1 | 342 | Web 状态栏冷启动误报断连 | `gpt-6.1-terra` | `medium` | 无 |
| T2 | 344 | engine 临时工作区所有权守卫 + core 注释 | `gpt-6.1-sol` | `medium` | 无 |
| T3 | 345a | 应用内暂存区模块 + 单测 | `gpt-6.1-sol` | `medium` | 无 |
| T4 | 345b | `vessel trash list/restore/purge` | `gpt-6.1-terra` | `medium` | T3 |
| T5 | 345c | 服务端删除改道 + serve 启动清理 | `gpt-6.1-sol` | `medium` | T3、T4 |

模型与思考深度你自己定，上表只是按「文件数 + 边界清晰度」给的建议：单文件、边界清楚（T1、T4）用小模型就够；跨包签名、删除主链路、跨卷回退（T2、T3、T5）建议用能扛返工的。无论选哪个，**不要开 Ultra**——那是并行子代理模式，会同时写同一批文件，和全局约定第 9 条冲突。

每个任务跑完先停一下，把报告贴回给协调者验收，再跑下一个；T3 → T4 → T5 必须按顺序。

## T1 · 卡 342：状态栏三态

### 背景（最小事实）

`apps/web/src/App.tsx` 的 `health` 初值是 `null`；`apps/web/src/components/StatusBar.tsx:13` 的判据是 `const isOk = !error && !!health?.ok`。所以冷启动/刷新时，第一个 `/api/health` 回来之前必然渲染成红点 + `statusDown`（「Local server not connected — please run vessel serve」）。实测证据：`evidence/sessions/2026-10-26-iab-acceptance/report.md` 第一节，刷新后第一帧 AX 就是断连文案，下一帧才变 ok。

### 要做的

1. `StatusBar` 改三态：
   - `health === null && error === false` → 中性态（灰点 + 新词条 `statusConnecting`）；
   - `health.ok` → 绿点 + 版本号（现有逻辑）；
   - `error === true` → 红点 + 现有 `statusDown` 文案。
   `statusDown` 只在 `error === true` 时出现。
2. `apps/web/src/i18n.ts` 增 `statusConnecting` 的中英词条，风格与相邻词条一致；英文侧不得出现 CJK。
3. 新建 `apps/web/src/components/StatusBar.test.tsx`，至少三条：
   - `health=null` 且无错：既没有英文断连文案，也没有中文断连文案，且出现 `statusConnecting`；
   - `health.ok`：出现版本号；
   - `error=true`：出现断连文案。
   中英各验一次关键文案。
4. 不改 App 的健康检查时序、不加轮询、不做「延迟两秒再报错」这类时间补丁。

### 允许改的文件

- `apps/web/src/components/StatusBar.tsx`
- `apps/web/src/components/StatusBar.test.tsx`（新建）
- `apps/web/src/i18n.ts`
- `tasks/342-status-bar-cold-load-flash.md`（只填 `## 7. Result`）

### 自验（贴命令 + exit + 计数）

```
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -b tsconfig.json
```

## T2 · 卡 344：engine 临时工作区所有权守卫

### 背景（最小事实）

`packages/engine/src/workspace.ts` 的 `TempDirWorkspaceFactory.dispose` 直接 `fs.rmSync(ws.root, { recursive: true, force: true })`，只信传进来的 `ws.root`——F6 审计点名的正是这一句。按 `docs/DESIGN-DECISIONS.md` 决策点 24，这类运行时临时文件归 B 类：可以「直接删」，但必须证明是自己创建的。

### 要做的

1. `dispose` 加所有权守卫：仅当 `path.resolve(root)` 位于 `os.tmpdir()` 之下、且 `basename` 以本工厂 prefix 开头时才删；否则不删、`console.warn` 一行、返回 `{ disposed: false, reason: 'not-owned' }`。
   - 返回类型放宽为 `Promise<{ disposed: boolean; reason?: string }>`；忽略返回值的既有调用方不受影响。
2. 正向不回归：`create` 出来的临时目录仍能被清掉。
3. 新增两条负向测试：
   - `root` 在仓库目录下；
   - `root` 在 tmpdir 但 `basename` 不以 prefix 开头。
   两条都断言「目录仍存在 + `reason === 'not-owned'`」。
4. `GitWorktreeWorkspaceFactory.dispose` 不改语义（仍调用注入的 git runner 的 `removeWorktree`），补一条测试断言项目自己没有直接删 worktree 目录（传假 runner 时目录仍在）。
5. `packages/core/src/session/Session.ts` **只允许加注释**：两处 `.lease` 删除各加一行指向 `docs/DESIGN-DECISIONS.md` 决策点 24。若发现必须改逻辑，停下报 blocked。

### 允许改的文件

- `packages/engine/src/workspace.ts`
- `packages/engine/src/workspace.test.ts`
- `packages/engine/src/workspace-lifecycle.test.ts`
- `packages/core/src/session/Session.ts`（仅注释）
- `packages/application/src/ExecutionLoop.ts`、`packages/application/src/compose.ts`（仅当签名变化导致类型不兼容）
- `tasks/344-f6-runtime-delete-ownership.md`（只填 `## 7. Result`）

### 自验（贴命令 + exit + 计数）

```
node node_modules/vitest/vitest.mjs run packages/engine
node node_modules/vitest/vitest.mjs run packages/core/src/session
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

报告里额外贴一段 `git diff --stat -- packages/core` 的输出，并说明 core 的改动是否全是注释。

## T3 · 卡 345a：应用内暂存区模块

### 背景（最小事实）

决策点 24 定了「用户可感知的数据先进应用内暂存区，默认 7 天后永久删」。这一步只做模块与单测；CLI 与服务端接线是 T4、T5。

### 要做的（新建 `packages/application/src/deletion/trash.ts` + 单测）

1. `trashEntry({ root, target, kind, reason, ttlDays })`：
   - 把 `target` 移入 `<root>/<UTC时间戳>-<短id>/`；
   - 同卷用 `rename`；跨卷时「复制 → 校验 → 回收源」，任一步失败则整个操作失败且**源保持不变**；
   - 写 `entry.json`：`{ id, origin, kind, reason, deletedAt, expiresAt, sizeBytes }`。
2. `list({ root })`、`restore({ root, id })`（原路径已存在必须拒绝，不覆盖）、`purge({ root, dryRun, olderThanDays, now? })`（只处理 `expiresAt <= now` 的条目；`dryRun` 只返回清单）。
3. TTL 默认 7 天；环境变量 `VESSEL_TRASH_TTL_DAYS`（整数，`0` 表示不自动清）覆盖。
4. 防护：`realpath` 必须仍在 trash 根内；条目必须自带 `entry.json`；符号链接或指向根外的 junction 一律拒绝并计入 skipped；**永不读写系统回收站**。
5. 每次 purge 追加一行到 `<root>/_purge.jsonl`：`{ ts, id, origin, bytes, ok, reason? }`。
6. 不新增依赖、不引入数据库、不起后台任务。

### 测试至少 8 条

正常移入 + `entry.json` 字段、TTL 到期前 1s 不删 / 到期后 1s 删、`dryRun` 不删、`restore` 往返、`restore` 冲突拒绝、realpath 逃逸拒绝、缺 `entry.json` 不删、跨卷回退失败时源不变。测试一律用 `os.tmpdir()` 下自建目录。

### 允许改的文件

- `packages/application/src/deletion/trash.ts`（新建）
- `packages/application/src/deletion/trash.test.ts`（新建）
- `tasks/345-app-trash-and-retention.md`（只填 345a 段落）

### 自验（贴命令 + exit + 计数）

```
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## T4 · 卡 345b：vessel trash 三个子命令

### 前置

`packages/application/src/deletion/trash.ts` 必须已存在（T3 交付）。不存在就停下说明，不要自己补。

### 要做的

1. 新建 `apps/cli/src/commands/trashCommand.ts`：
   - `vessel trash list [--json]`
   - `vessel trash restore <id>`
   - `vessel trash purge [--dry-run] [--older-than <days>]`
   - 根目录解析顺序：`--root` > `VESSEL_TRASH_ROOT` > `<cwd>/.harness/trash`。
2. 在 `apps/cli/src/cli.ts` 的命令分派里接上 `trash`，并在 `USAGE` 里加三行说明（与相邻命令风格一致）。
3. `restore` 遇到原路径已存在：打印原因并返回非 0，不覆盖。
4. `purge` 默认按 `expiresAt` 判断，`--older-than` 覆盖 TTL；`--dry-run` 只列清单不删。
5. `--json` 输出必须可 `JSON.parse`，且不含文件内容本身。
6. 不新增依赖。

### 测试至少 5 条

`list` 空/非空、`restore` 成功、`restore` 冲突返回非 0、`purge --dry-run` 不删、`purge` 实删并返回计数。测试用临时根，绝不碰真实 `~/.vessel`。

### 允许改的文件

- `apps/cli/src/commands/trashCommand.ts`（新建）
- `apps/cli/src/commands/trashCommand.test.ts`（新建）
- `apps/cli/src/cli.ts`
- `tasks/345-app-trash-and-retention.md`（只填 345b 段落）

### 自验（贴命令 + exit + 计数）

```
node node_modules/vitest/vitest.mjs run apps/cli/src/commands/trashCommand.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## T5 · 卡 345c：服务端删除改道 + serve 启动清理

### 前置

T3 的暂存区模块与 T4 的 CLI 已存在。

### 要做的

1. `apps/local-server/src/server.ts` 的 `DELETE /api/sessions/:id`（`segs.length === 3 && method === 'DELETE'` 那段）：把「`recycleDaemonPath(sessionDir)`」改成「移入该工作区的 `.harness/trash`」；`sessionDir` 现在由 `resolveSessionDir(existing.workspaceRoot, id)` 得到，暂存根取 `<workspaceRoot>/.harness/trash`。
   - 保持卡 259 已定的顺序：索引持久移除 → 关闭 controller/writer → 移入暂存区；
   - 失败回滚与错误码语义不变：`session_index_failed` / `session_index_stale` / `session_recycle_failed`（后者改为「连暂存都失败」）。
2. `vessel serve` 启动时做一次 best-effort purge：异步、失败只 warn、不阻塞监听；TTL 默认 7 天，`VESSEL_TRASH_TTL_DAYS=0` 关闭。
3. 更新 `docs/DELETION-AND-RETENTION.md`：把「实现未开工」改成「已实现」，补一句「serve 启动会清理到期条目」。
4. 不新增依赖、不改 `packages/core`、不动 Web 端。

### 测试至少 4 条

- 删除后会话目录出现在 `.harness/trash` 且列表消失；
- `restore` 后重新出现在列表；
- 暂存失败时索引回滚且返回 `session_recycle_failed`；
- 启动时 purge 被调用（用注入时钟/临时根断言，不要真等 7 天）。

### 允许改的文件

- `apps/local-server/src/server.ts`
- `apps/local-server/src/server.test.ts`
- `docs/DELETION-AND-RETENTION.md`
- `tasks/345-app-trash-and-retention.md`（只填 345c 段落）

### 自验（贴命令 + exit + 计数）

```
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 2. 交回来时给什么

每个任务完成后，把 Codex 的最终报告贴回给协调者，包含：

1. 改动文件清单（逐条路径）；
2. 每条自验命令 + exit code + 测试文件数/用例数；
3. 未做的部分与原因；
4. 被拒绝执行的命令原文。

协调者侧固定动作：按卡复跑同样的定向测试 → 跑 `scripts/gate-batched.ps1` → 把**自己跑出来的**数字写进卡与 `tasks/README.md`；实现者自述只作参考，不作为验收依据。

## 3. 明确不在这份交接单里

- 卡 340–343 已完成（看板对账、341 构建命令、343 回收原语），不要重做；342 之外的东西也不在本单。
- 卡 346（文档一致性、跨平台矩阵、三档回滚说明、最终门禁）由协调者自己做。
- 卡 260 / 275（真实浏览器验收）不在这一轮。
