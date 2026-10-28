# Codex 交接单（终版）· 2026-10-27 · 全部积压

> 用法：在 Codex 应用里把本文件路径给它，并说明要跑哪一批（例如「按本文件跑第一波 T1–T4，可并行」）。
> 进度（2026-10-27 协调者记）：**第一波 T1–T4 已完成并验收**（8 条定向命令全 exit 0，1,035 passed + 2 skipped）；下一批从 T5–T8 起。
> **剩余项已迁到第二波交接单** `tasks/prompts/codex-handoff-2026-10-27-wave2.md`（含 353/345c/350c/357/358/356/354/355/351 与 260/275）；
> 本文件只作 T1–T11 的问题与证据底稿，执行以上一份为准。
> 本文件取代此前两份交接单（`…deletion-retention.md`、`…backlog-2.md`），以本文件为准。
> 设计口径：`docs/DELETION-AND-RETENTION.md`、`docs/DESIGN-DECISIONS.md` 决策点 24；任务卡在 `tasks/342`、`tasks/344`、`tasks/345`。

## 0. 全局约定

1. 仓库根 `E:\Code_file\Projects\Vessel_Harness`，Windows + PowerShell 7。
2. 只改「允许改的文件」列出的路径；多改一个文件即判越界。
3. 不 commit / push / 建分支；不改 `.pdw/`。
4. 命令被拒或失败：贴原始报错与 exit code，不推测、不伪造。
5. 不跑全量门禁（`scripts/gate-batched.ps1` 由协调者统一跑）；只跑本任务的定向自验。
6. 报告四段：改动文件、命令 + exit + 计数、未做的与原因、被拒命令原文。
7. **子代理按本文件指定的配置执行**：同一文件同一时刻只有一个写者；复核子代理**只读**，不得改任何文件；不启动本机其他 Agent CLI（dsh / opencode / claude / pi）。
8. 波次内的任务文件集互不重叠，可并行；跨波必须等上一波结束。波次只决定顺序，不强制一次全跑。
9. 不要顺手修别的编号；发现问题写进报告，不要越界改。

## 1. 模型与子代理配置（直接照这个配）

三档角色，按任务配：

- **主会话**：`gpt-6.1-sol` / `medium`。职责是读任务、分派、收报告、按自验命令复跑一次；不写产品代码。
- **实现子代理**：按任务表。只写「允许改的文件」。
- **复核子代理**：按任务表，只读。复核必须独立于实现（另起子代理，不复用实现会话）。

命名建议：实现 `impl-T<n>`，复核 `review-T<n>`。不要用 Ultra（并行子代理会同时写同一批文件）。

## 2. 任务总表

| 编号 | 内容 | 波次 | 实现子代理 | 复核子代理 | 依赖 |
|---|---|---|---|---|---|
| T1 | 卡 342 状态栏三态 | 1 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `medium` | 无 |
| T2 | 卡 344 engine 所有权守卫 | 1 | `gpt-6.1-sol` / `medium` | `gpt-6.1-terra` / `medium` | 无 |
| T3 | 卡 345b `vessel trash` CLI | 1 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `medium` | 345a 已有 |
| T4 | 陈旧发布产物加声明 | 1 | `gpt-6.1-terra` / `low` | 不需要（单文件只增） | 无 |
| T5 | `profileParity` 偶发隔离 | 2 | `gpt-6.1-sol` / `medium` | `gpt-6.1-sol` / `medium` | 无 |
| T6 | 卡 345c 服务端删除改道 | 3 | `gpt-6.1-sol` / `medium` | `gpt-6.1-sol` / `medium` | T3 |
| T7 | `Session.append` 绕过租约 | 2 | `gpt-6.1-sol` / `medium` | `gpt-6.1-sol` / `high` | 无 |
| T8 | 看板对账 170–183 | 2 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `low` | 无 |
| T9 | Packaging gate 实跑 | 3 | `gpt-6.1-terra` / `medium` | 不需要 | 无 |
| T10 | 卡 260/275 真机验收第二轮 | 3 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `medium` | 无 |
| T11 | 陈旧状态卡第二遍对账 | 3 | `gpt-6.1-terra` / `medium` | `gpt-6.1-terra` / `low` | 无 |

分工理由：跨包签名、core 安全语义、删除主链路、并发竞态（T2/T5/T6/T7）用 sol；单文件、单模块、文档对账（T1/T3/T4/T9/T10/T11）用 terra。T7 的复核升到 `high`，因为它改的是单写者 fail-closed，属于安全属性；其余复核 `medium` 足够。

---

## T1 · 卡 342：状态栏三态

**执行配置**：impl `gpt-6.1-terra`/medium，review `gpt-6.1-terra`/medium。

### 问题与证据

`apps/web/src/App.tsx` 的 `health` 初值为 `null`；`apps/web/src/components/StatusBar.tsx:13` 判据是 `const isOk = !error && !!health?.ok`。冷启动/刷新时首个 `/api/health` 未返回前必然渲染红点 + `statusDown`（「Local server not connected — please run vessel serve」）。实测：`evidence/sessions/2026-10-26-iab-acceptance/report.md` 第一节，刷新后第一帧 AX 即断连文案，第二帧才 ok。

### 要做的

1. 三态：`health===null && error===false` → 中性（灰点 + 新词条 `statusConnecting`）；`health.ok` → 绿点 + 版本；`error===true` → 红点 + 现有 `statusDown`。`statusDown` 只在 `error===true` 出现。
2. `apps/web/src/i18n.ts` 增 `statusConnecting` 中英词条；英文侧不得含 CJK。
3. 新建 `apps/web/src/components/StatusBar.test.tsx`：null 且无错（无中英断连文案、有 statusConnecting）、ok（版本号）、error（断连文案）。
4. 不改 App 健康检查时序、不加轮询、不做延迟补丁。

### 允许改的文件

`apps/web/src/components/StatusBar.tsx`、`apps/web/src/components/StatusBar.test.tsx`（新建）、`apps/web/src/i18n.ts`、`tasks/342-status-bar-cold-load-flash.md`（只填 Result）。

### 自验

```
node node_modules/vitest/vitest.mjs run --root apps/web
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -b tsconfig.json
```

---

## T2 · 卡 344：engine 临时工作区所有权守卫

**执行配置**：impl `gpt-6.1-sol`/medium，review `gpt-6.1-terra`/medium。

### 问题与证据

`packages/engine/src/workspace.ts` 的 `TempDirWorkspaceFactory.dispose` 直接 `fs.rmSync(ws.root, { recursive: true, force: true })`，只信传入的 `ws.root`（F6 审计点名）。决策点 24 把这类文件归 B 类：可直接删，但必须证明是自己创建的。

### 要做的

1. 守卫：`path.resolve(root)` 必须在 `os.tmpdir()` 下，且 `basename` 以本工厂 prefix 开头；否则不删、`console.warn`、返回 `{ disposed: false, reason: 'not-owned' }`。返回类型放宽为 `Promise<{ disposed: boolean; reason?: string }>`。
2. 正向不回归：create 出的临时目录仍能清掉。
3. 两条负向测试：root 在仓库下；root 在 tmpdir 但 basename 不匹配 → 目录仍在 + `not-owned`。
4. `GitWorktreeWorkspaceFactory.dispose` 语义不变；补一条测试断言项目没直接删 worktree 目录。
5. `packages/core/src/session/Session.ts` 只加注释（两处 `.lease` 删除各一行，指向决策点 24）。

### 允许改的文件

`packages/engine/src/workspace.ts`、`packages/engine/src/workspace.test.ts`、`packages/engine/src/workspace-lifecycle.test.ts`、`packages/core/src/session/Session.ts`（仅注释）、`packages/engine/src/LoopEngine.ts`（仅允许把 `dispose` 的返回类型放宽为 `Promise<void | { disposed: boolean; reason?: string }>` 或引用 `workspace.ts` 导出的 `DisposeResult` 类型，不改任何运行逻辑）、`packages/application/src/ExecutionLoop.ts` 与 `compose.ts`（仅当类型不兼容）、`tasks/344-f6-runtime-delete-ownership.md`（只填 Result）。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/engine
node node_modules/vitest/vitest.mjs run packages/core/src/session
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

报告贴 `git diff --stat -- packages/core`，说明 core 改动是否全为注释。类型优先在 `workspace.ts` 导出 `export interface DisposeResult { disposed: boolean; reason?: string }` 并让 `LoopEngine.ts` 引用它，不要在多处重复对象字面量。

---

## T3 · 卡 345b：`vessel trash` 三个子命令

**执行配置**：impl `gpt-6.1-terra`/medium，review `gpt-6.1-terra`/medium。

### 前置

`packages/application/src/deletion/trash.ts` 已由 345a 交付（`trashEntry/list/restore/purge`，默认 7 天，`dryRun` 不写审计）。不存在就停下说明。

### 要做的

1. 新建 `apps/cli/src/commands/trashCommand.ts`：`trash list [--json]`、`trash restore <id>`、`trash purge [--dry-run] [--older-than <days>]`；根解析 `--root` > `VESSEL_TRASH_ROOT` > `<cwd>/.harness/trash`。
2. `apps/cli/src/cli.ts` 接分派 + `USAGE` 三行。
3. `restore` 冲突返回非 0 不覆盖；`purge --json` 可解析、不含文件内容。
4. 不新增依赖。

### 测试至少 5 条

list 空/非空、restore 成功、restore 冲突非 0、purge --dry-run 不删、purge 实删计数。全用临时根。

### 允许改的文件

`apps/cli/src/commands/trashCommand.ts`（新建）、`apps/cli/src/commands/trashCommand.test.ts`（新建）、`apps/cli/src/cli.ts`、`tasks/345-app-trash-and-retention.md`（只填 345b 段落）。

> 2026-10-27 协调者补记：本清单漏了两类牵连文件，后续波次派单前先补上——①包出口：凡引用暂存区模块一律 `import { trashStore } from '@vessel/application'`（`packages/application/src/index.ts` 已加命名空间导出），不要写 `packages/*/dist/...` 相对路径（vitest 别名指向 src，相对 dist 会让测试在测构建产物）；②`--help` 文本：`vessel <x>` 的命令行要加进 `apps/cli/src/i18n.ts` 的 `usage.commands`（中英各一份），并存放在命令列表里（`vessel web` 之后、`run 选项:` 之前），不要拼在 USAGE 模板尾部；同一次改动必须同步 `apps/cli/src/cli.test.ts` 的逐行金标（当前为 105 行、`lines[99]===''`、`lines[100]==='provider 协议说明:'`）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/cli/src/commands/trashCommand.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T4 · 陈旧发布产物加声明

**执行配置**：impl `gpt-6.1-terra`/low，不设复核（单文件、纯新增段落）。

### 问题与证据

`.dsh-mission/publish/` 下 8 个文件是**被 git 跟踪**的旧发布快照，仍含收口前的回收实现与旧命令，容易被 grep 与人工阅读误当成现状（卡 343 验收就被它绊过一次）。

### 要做的

在 `.dsh-mission/publish/README.md` 顶部加一段：该目录是历史发布快照，不是当前源码产物、不随源码更新、不要据此判断实现现状；当前以仓库根为准。已有类似声明就只补缺失处。不动 `dist/`。

### 允许改的文件

`.dsh-mission/publish/README.md`。

### 自验

```
git diff --stat -- .dsh-mission
```

---

## T5 · `profileParity` 偶发失败：隔离排查

**执行配置**：impl `gpt-6.1-sol`/medium，review `gpt-6.1-sol`/medium（竞态/时序判断）。

### 问题与证据

2026-10-27 全量门禁 `apps/local-server` 段挂过一次：

```
FAIL apps/local-server/src/routes/profileParity.test.ts > profile CLI and HTTP parity > delete returns the same ordered fields
AssertionError: expected 2 to be +0
```

单跑该文件 4/4 通过、整段重跑 26 文件 / 298 通过 ⇒ 隔离或时序问题。

### 要做的

1. 先复现：连跑 `apps/local-server` 段 3 次，记录每次结果；复现不出来也要写清尝试次数与命令。
2. 定位：CLI 的 `provider profile delete` 读的是哪个根（`apps/cli/src/providers/defaultStore.ts`、`apps/local-server/src/providers/ProviderStore.ts`），为什么并发段里返回 2。
3. 修：优先在测试侧补隔离（显式根、环境变量还原）；只有确证产品缺陷才动产品代码。
4. 加一条判别性断言/测试，保证同类泄漏下次能被抓住。

### 允许改的文件

`apps/local-server/src/routes/profileParity.test.ts`、`apps/local-server/src/providers/ProviderStore.ts`（仅确证缺陷）、`apps/cli/src/providers/defaultStore.ts`（同上）、新建 `tasks/350-profile-parity-isolation.md`。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/local-server/src/routes/profileParity.test.ts
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T6 · 卡 345c：服务端删除改道 + serve 启动清理

**执行配置**：impl `gpt-6.1-sol`/medium，review `gpt-6.1-sol`/medium（删除事务与回滚语义）。

### 前置

345a 的 `trash.ts` 与 T3 的 `vessel trash` 已在（T3 与 T6 同波不同步，必须等 T3 完成）。

### 要做的

1. `apps/local-server/src/server.ts` 的 `DELETE /api/sessions/:id`（`segs.length === 3 && method === 'DELETE'`）：把 `recycleDaemonPath(sessionDir)` 改为移入 `<workspaceRoot>/.harness/trash`；保持「索引持久移除 → 关闭 controller/writer → 移入暂存」顺序与回滚；`session_index_failed` / `session_index_stale` / `session_recycle_failed` 含义不变（后者=连暂存都失败）。
2. `vessel serve` 启动时 best-effort purge（异步、失败只 warn、不阻塞监听）；`VESSEL_TRASH_TTL_DAYS=0` 关闭。
3. `docs/DELETION-AND-RETENTION.md` 状态与「serve 启动会清理到期条目」同步。
4. 不改 `packages/core`、不动 Web。

### 测试至少 4 条

删除后目录在 `.harness/trash` 且列表消失；restore 后回来；暂存失败时索引回滚并返回 `session_recycle_failed`；启动 purge 被调用（注入时钟/临时根，别真等 7 天）。

### 允许改的文件

`apps/local-server/src/server.ts`、`apps/local-server/src/server.test.ts`、`docs/DELETION-AND-RETENTION.md`、`tasks/345-app-trash-and-retention.md`（只填 345c 段落）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T7 · `Session.append` 重开不重取租约（单写者被绕过）

**执行配置**：impl `gpt-6.1-sol`/medium，review `gpt-6.1-sol`/**high**（安全属性：fail-closed 不能被绕过）。

### 问题与证据

`packages/core/src/session/Session.ts`：构造时 `acquireLease` 拿 `.lease`，`close()` 删 `.lease` 并置 `fd=null`；`append()` 在 `fd` 为空时只做 `this.fd = await fs.promises.open(this.logPath, 'a')`，**没有重新取租约**。所以 close 后再 append 会在无租约下继续写日志，单写者 fail-closed 被绕过。这是 `docs/product-evolution/PRODUCT-STATE.md` Round 11「残留（下一批）」第 ① 条，至今未修。

### 要做的

1. 先写会失败的测试复现：同一 `Session` 对象 `close()` 后 `append()`，断言当前会写成功（红）；修完后断言应为「重新取租约成功」或「明确拒绝」。
2. 修：`append` 重开前重新 `acquireLease`（复用静态方法），或把对象标记为不可再用并抛出明确错误。两者皆可，但要求：正常路径不回归、陈旧租约仍可接管、错误信息可读。
3. 负向测试：另一进程持租约时，本对象 close 后 append 必须失败而不是静默写。
4. 不改 append-only 语义、不改 `.lease` 格式。

### 允许改的文件

`packages/core/src/session/Session.ts`、`packages/core/src/session/Session.test.ts`、`packages/core/src/session/SessionLease.test.ts`。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/core/src/session
node node_modules/vitest/vitest.mjs run packages/core
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T8 · 看板对账：170–183 的「待验收」

**执行配置**：impl `gpt-6.1-terra`/medium，review `gpt-6.1-terra`/low（只核对证据是否被夸大）。

### 问题与证据

`tasks/README.md` 路线层表 170–181 仍写「本地全门禁通过；待验收」，183 同批；182/183 另称已合入。卡面停在「待用户验收 / 待验收」（`tasks/170-*`、`174-*` 等）。这批是 2026-10-02/03 的 V1.5/V1.6 交付，后续 epic 已覆盖。

### 要做的

1. 逐张读卡（170–181、183），对每条交付主张在当前 HEAD 找可复验证据（源码/测试仍在？定向测试过？）。允许只跑定向测试。
2. 在每张卡末尾追加结论，不改正文：`已验收（2026-10-27 对账，依据 …）` 或 `仍待用户验收（缺 …）`。
3. 更新 `tasks/README.md` 路线层对应行；不动 182/183 已有结论。
4. **不许**在没有本次证据时写「已验收」；找不到证据就写「无法确认」并列出查过什么。

### 允许改的文件

`tasks/170-*.md` … `tasks/181-*.md`、`tasks/183-*.md`（只在末尾追加）、`tasks/README.md`。

### 自验

```
git diff --stat -- tasks
```

报告给「卡 → 结论 → 依据（文件:行 或 测试命令）」对照表。

---

## T9 · Packaging release gate 实跑一次

**执行配置**：impl `gpt-6.1-terra`/medium，不设复核（只跑不改判据）。

### 问题与证据

`benchmarks/runners/src/release-gates/gates.ts` 有 packaging 门（约 257–277 行），`docs/V1.6-STABLE-CHECKLIST.md` 记录它此前「需要 dist」而未跑。现在 `apps/cli/dist/cli.js` 与 `apps/web/dist/index.html` 都存在。

### 要做的

1. 找 packaging gate 的**现有**入口（`benchmarks/runners/src/release-gates/`；不新建入口、不加 npm script）。
2. 用现有 dist 跑一次，记 exit 与输出。
3. 若 dist 内容缺失/过期，先 `node node_modules/typescript/bin/tsc -b tsconfig.json` 重建再跑一次。
4. 结果写进新建的 `tasks/351-packaging-gate-run.md`：入口命令、exit、失败原因、下一步建议。**不要**改 gate 判据凑通过。

### 允许改的文件

`tasks/351-packaging-gate-run.md`（新建）；允许运行构建命令（产物 gitignore）。

### 自验

```
node node_modules/typescript/bin/tsc -b tsconfig.json
<你找到的 packaging gate 入口命令>
```

---

## T10 · 卡 260/275：真实浏览器验收（第二轮）

**执行配置**：impl `gpt-6.1-terra`/medium；可用项目内置的 `pdw_ui_verifier`（terra/medium）做浏览器取证，但**它只许写你指定的临时目录**，评审结论仍由 impl 汇总。

### 已知限制

第一轮（`evidence/sessions/2026-10-26-iab-acceptance/report.md`）九项里六项停在「无法验证」：IAB 无浏览器菜单缩放、`Ctrl+=` 无效、CDP `deviceScaleFactor` 只改 DPR（918→DPR 1.5、innerWidth 仍 918）。这一轮允许把「真实缩放」判为无法验证，其余项必须做完。

### 要做的（A–I）

夹具工作区放系统临时目录，独立 `USERPROFILE`/`HOME` 以免 Activity 混入真实项目；`vessel serve` 起 5678：

- A 矩阵：360/768/1024/1440/1920 × 浅/深 × 中/英，workbench / conversation / activity / settings 各一格；每格记 `documentElement.scrollWidth` vs `innerWidth`；≥12 张截图。
- B 键盘与无障碍：只用键盘走 导航 → 新建会话 → 发送 → Inspector → 删除确认 → Esc；记焦点可见、遮挡、Esc 回位；抽查 10 个控件 accessible name。
- C 首屏焦点 + 跨工作区草稿隔离。
- D 生效 Policy 只读面板（来源、无编辑入口）。
- E 工具卡默认折叠、错误原因可见、Stop 请求中禁用与失败原因、消息区内部滚动。
- F 删除：确认 → 消失 → 刷新仍消失；再制造一次回收失败（占用目录）看原因与重试。
- G Activity 四态分组与刷新保持。
- H 刷新保史（消息、工具卡、终止提示）。
- I 端到端：新建 → 发送 → 工具调用 → Diff → 刷新保史 → 删除进回收站。

### 允许改的文件

只写 `evidence/sessions/2026-10-27-iab-acceptance-run2/`（报告 + 截图）。不改产品代码、不改测试。

### 自验

每条「通过 / 不通过（附现象）/ 无法验证（附原因与两种手段实测值）」；截图不得出现非夹具项目名与用户会话标题。

---

## T11 · 陈旧状态卡第二遍对账

**执行配置**：impl `gpt-6.1-terra`/medium，review `gpt-6.1-terra`/low。

### 问题与证据

- `071-windows-sandbox-backend.md`：待验收，但沙箱链路后由 255/256/281/287 重做。
- `281-arch07-posix-fallback-decision.md`：阻塞待拍板，而方案 2 已由 287 实现。
- `196-evaluator-red-green-reproduction-gate.md`：「Epic 199 全量门禁待执行」，199 早已合入。
- `217-event-projection-contracts-and-compaction-conservation.md`：与已验收的 217 architecture 卡**同号**，状态「就绪待执行」；事件投影/压缩守恒后由 236/244/247 落地。
- `149-live-baseline-blocked.md`：blocked；153 已回退并立「不自动驱动本机其他 agent」口径。
- `_missions/mission-02/M1-residual-wording.md`、`W4-repair-comment-367.md`：归档区仍写「待执行」。
- `119-safety-scenario-falsifiable-criteria.md`：**部分完成**，S002/S006 恒真判据当时登记「仍待加锁」。

### 要做的

1. 逐张读卡 → 结论（被哪张取代 / 已解决 / 仍缺什么），每条有依据。
2. 被取代的卡末尾追加 `已被 <卡号> 取代（2026-10-27 对账）`；不改正文、不删卡。
3. 对 119：核对 `benchmarks/runners/src/conformance/asserts.ts`（约 103 行）、`benchmarks/runners/src/offline.ts`（约 218/219/253/254 行）、`benchmarks/runners/src/safety-discrimination.test.ts`（约 23 行），确认 S002/S006 判据现在是否可被证伪。已加锁写依据；仍未加锁就新建 `tasks/352-safety-s002-s006-criteria.md` 记录缺口与最小修法，**不要**放宽判据。
4. 同步 `tasks/README.md` 对应行。

### 允许改的文件

`tasks/071-*.md`、`tasks/119-*.md`、`tasks/149-*.md`、`tasks/196-*.md`、`tasks/217-event-projection-*.md`、`tasks/281-*.md`、`tasks/_missions/mission-02/M1-residual-wording.md`、`tasks/_missions/mission-02/W4-repair-comment-367.md`（以上仅末尾追加）、`tasks/README.md`、必要时新建 `tasks/352-safety-s002-s006-criteria.md`。

### 自验

```
git diff --stat -- tasks
```

报告给对照表：卡 → 结论 → 依据。

---

## 3. 交回来时给什么

每个编号贴：改动文件清单、每条自验命令 + exit + 计数、未做与原因、被拒命令原文。协调者会复跑定向测试、跑全量 `gate-batched.ps1`，以自己跑出来的数字落卡；实现者与复核子代理的自述只作参考。

## 4. 非 Agent 可执行项（不在 T1–T11）

| 项 | 为什么 Agent 做不了 | 来源 |
|---|---|---|
| U1 GitHub Support 清 `refs/pull/*` | 需以你名义对外提交 | `HANDOFF.md` §3.1 |
| U2 npm 元数据是否开工单 | 已过 unpublish 窗口 | 同上 |
| U3 规则集 `bypass_actors` 收权 | 改变你的合并习惯 | 同上 |
| U4 清游离提交 `5092ed4` | 需 `git gc --prune`，被门禁拦 | 同上 |
| U5 真实 `--live` 跨 harness 基线 | 驱动本机其他 CLI、耗配额，须逐次授权 | `tasks/149`/`153` |
| ARCH-04 live 证据 | 同上 | `HANDOFF.md` §0 |
| UI-10 150%/200% 真缩放、原生输入法 | IAB 无法真缩放 | 卡 275、2026-10-26 记录 |
| 154 release-report 刷新 | 需真实供应商配额 | `tasks/README.md` 未闭合段 |
| 155 3 小时墙钟 soak | 时长与机器占用不适配 Agent | 同上 |
| opencode-go 余额、156 门槛复核 | 外部账号/环境 | 同上 |
| PR 页面旧身份、npm `_npmUser`、服务端旧对象 | 已知不可清除边界 | `HANDOFF.md` §3.3 |

## 5. 不在本单

已完成、不要重做：340（看板收口）、341（构建命令）、343（回收原语）、345a（暂存区模块）、347/348/349（PDW 与失败归因规则）。
卡 346 收口（文档一致性、跨平台矩阵、三档回滚说明、最终全量门禁）由协调者做。
