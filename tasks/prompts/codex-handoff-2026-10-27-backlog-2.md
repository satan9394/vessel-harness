# Codex 交接单（第二批）· 2026-10-27 · 积压问题全量

> 用法：在 Codex 应用里把本文件路径给它，并说明要跑哪几个编号，例如「按本文件跑 T1、T2、T3（互不冲突，可并行）」。
> 本文件是执行指令。设计口径见 `docs/DELETION-AND-RETENTION.md`、`docs/DESIGN-DECISIONS.md` 决策点 24；任务卡见 `tasks/342`、`tasks/344`、`tasks/345`。
> 上一批交接单（T1–T5）已完成 T3；本文件不重复已完成项，编号从本文件重新起算。

## 0. 全局约定

1. 仓库根 `E:\Code_file\Projects\Vessel_Harness`，Windows + PowerShell 7。
2. 只改「允许改的文件」里列出的路径；多改一个文件即判越界。
3. 不 commit / push / 建分支；不改 `.pdw/`。
4. 命令被拒或失败，贴原始报错与 exit code，不要推测、不要伪造。
5. 不跑全量门禁（`scripts/gate-batched.ps1` 由协调者统一跑）；只跑本任务的定向自验。
6. 报告四段：改动文件、命令 + exit + 计数、未做的与原因、被拒命令原文。
7. **子代理按你的指令执行**：本批允许你按任务选择合适模型与思考深度、派实现与独立复核子代理。硬约束只有两条——**同一文件同一时刻只有一个写者**；**复核子代理只读**，不得改文件。不要启动本机其他 Agent CLI（dsh / opencode / claude / pi）。
8. 不要顺手修别的编号；发现问题写进报告。
9. 同一波（见 §1）内的任务文件集互不重叠，可并行；跨波必须等上一波完成。

## 1. 任务总表

| 编号 | 内容 | 建议模型 | 建议深度 | 波次 | 依赖 |
|---|---|---|---|---|---|
| T1 | 卡 342：StateBar 三态（状态栏误报断连） | `gpt-6.1-terra` | `medium` | 1 | 无 |
| T2 | 卡 344：engine 临时工作区所有权守卫 | `gpt-6.1-sol` | `medium` | 1 | 无 |
| T3 | 卡 345b：`vessel trash` 三个子命令 | `gpt-6.1-terra` | `medium` | 1 | 345a 已存在 |
| T4 | 陈旧发布产物 `.dsh-mission/publish` 标注 | `gpt-6.1-terra` | `low` | 1 | 无 |
| T5 | `profileParity` 偶发失败的隔离修复 | `gpt-6.1-sol` | `medium` | 2 | 无 |
| T6 | 卡 345c：服务端删除改道 + serve 启动清理 | `gpt-6.1-sol` | `medium` | 2 | T3 |
| T7 | `Session.append` 重开不重取租约（单写者被绕过） | `gpt-6.1-sol` | `medium` | 2 | 无 |
| T8 | 看板对账：170–183 的「待验收」 | `gpt-6.1-terra` | `medium` | 2 | 无 |
| T9 | Packaging release gate 实跑一次 | `gpt-6.1-terra` | `medium` | 3 | 无 |
| T10 | 卡 260/275：真实浏览器验收（第二轮） | `gpt-6.1-terra` | `medium` | 3 | 无 |
| T11 | 陈旧状态卡第二遍对账（071/119/149/196/217/281/mission-02） | `gpt-6.1-terra` | `medium` | 3 | 无 |

模型与深度只是建议，你按实际难度选。不要选 Ultra（并行子代理会同时写同一批文件）。

---

## T1 · 卡 342：状态栏三态（Web）

### 问题与证据

`apps/web/src/App.tsx` 的 `health` 初值为 `null`；`apps/web/src/components/StatusBar.tsx:13` 的判据是 `const isOk = !error && !!health?.ok`。冷启动/刷新时首个 `/api/health` 未返回前，必然渲染成红点 + `statusDown`（「Local server not connected — please run vessel serve」）。实测见 `evidence/sessions/2026-10-26-iab-acceptance/report.md` 第一节：刷新后第一帧 AX 就是断连文案，第二帧才变 ok。

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

### 问题与证据

`packages/engine/src/workspace.ts` 的 `TempDirWorkspaceFactory.dispose` 直接 `fs.rmSync(ws.root, { recursive: true, force: true })`，只信传入的 `ws.root`——F6 审计点名这句。决策点 24 把这类文件归 B 类：可直接删，但必须证明是自己创建的。

### 要做的

1. 守卫：`path.resolve(root)` 必须在 `os.tmpdir()` 下，且 `basename` 以本工厂 prefix 开头；否则不删、`console.warn`、返回 `{ disposed: false, reason: 'not-owned' }`。返回类型放宽为 `Promise<{ disposed: boolean; reason?: string }>`。
2. 正向不回归：create 出的临时目录仍能清掉。
3. 两条负向测试：root 在仓库下；root 在 tmpdir 但 basename 不匹配 → 目录仍在 + `not-owned`。
4. `GitWorktreeWorkspaceFactory.dispose` 语义不变；补一条测试断言项目没直接删 worktree 目录。
5. `packages/core/src/session/Session.ts` **只加注释**（两处 `.lease` 删除各一行，指向决策点 24）。

### 允许改的文件

`packages/engine/src/workspace.ts`、`packages/engine/src/workspace.test.ts`、`packages/engine/src/workspace-lifecycle.test.ts`、`packages/core/src/session/Session.ts`（仅注释）、`packages/application/src/ExecutionLoop.ts` 与 `compose.ts`（仅当类型不兼容）、`tasks/344-f6-runtime-delete-ownership.md`（只填 Result）。

### 自验

```
node node_modules/vitest/vitest.mjs run packages/engine
node node_modules/vitest/vitest.mjs run packages/core/src/session
node node_modules/vitest/vitest.mjs run packages/application
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

报告里贴 `git diff --stat -- packages/core`，说明 core 改动是否全为注释。

---

## T3 · 卡 345b：`vessel trash` 三个子命令

### 前置

`packages/application/src/deletion/trash.ts` 已由 345a 交付（`trashEntry/list/restore/purge`，默认 7 天，`dryRun` 不写审计）。不存在就停下说明。

### 要做的

1. 新建 `apps/cli/src/commands/trashCommand.ts`：`trash list [--json]`、`trash restore <id>`、`trash purge [--dry-run] [--older-than <days>]`；根解析 `--root` > `VESSEL_TRASH_ROOT` > `<cwd>/.harness/trash`。
2. `apps/cli/src/cli.ts` 接命令分派 + `USAGE` 三行。
3. `restore` 冲突（原路径存在）返回非 0 且不覆盖；`purge --json` 可解析、不含文件内容。
4. 不新增依赖。

### 测试至少 5 条

list 空/非空、restore 成功、restore 冲突非 0、purge --dry-run 不删、purge 实删计数。全部用临时根。

### 允许改的文件

`apps/cli/src/commands/trashCommand.ts`（新建）、`apps/cli/src/commands/trashCommand.test.ts`（新建）、`apps/cli/src/cli.ts`、`tasks/345-app-trash-and-retention.md`（只填 345b 段落）。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/cli/src/commands/trashCommand.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T4 · 陈旧发布产物标注

### 问题与证据

`.dsh-mission/publish/dist/cli.js` 等 8 个文件是**被 git 跟踪**的旧发布快照，里面还留着收口前的回收实现（旧 `SendToRecycleBin` 拼串、旧 profile 命令）。它不是当前源码的产物，却会被 grep 与人工阅读误当成现状（卡 343 的验收就被它绊过一次）。

### 要做的

只做标注，不删、不重建：
1. 在 `.dsh-mission/publish/README.md` 顶部加一段声明：该目录是历史发布快照，**不是当前源码的产物、不随源码更新、不要据此判断实现现状**；当前源码与门禁以仓库根为准。
2. 如果 `README.md` 里已有类似声明，只在缺失处补齐。
3. 不动 `dist/` 下任何文件。

### 允许改的文件

`.dsh-mission/publish/README.md`。

### 自验

```
git diff --stat -- .dsh-mission
```
（应只有 README.md 一个文件、只增不改语义）

---

## T5 · `profileParity` 偶发失败：先把隔离查清

### 问题与证据

2026-10-27 的全量门禁里 `apps/local-server` 段挂过一次：

```
FAIL apps/local-server/src/routes/profileParity.test.ts > profile CLI and HTTP parity > delete returns the same ordered fields
AssertionError: expected 2 to be +0
```

单独跑该文件 4/4 通过、整段重跑 26 文件 / 298 通过，说明是**隔离或时序**问题而不是断言写错。测试用 `mkdtemp` + `VESSEL_PROVIDER_ROOT` 做隔离，但 CLI 侧 `main()` 可能读到别的根或进程级状态。

### 要做的

1. 先复现：连续跑 `node node_modules/vitest/vitest.mjs run apps/local-server` 3 次，记录每次都结果；复现不出来也要写清尝试次数与命令。
2. 定位：明确 CLI 端 `provider profile delete` 读的是哪个根（`apps/cli/src/providers/defaultStore.ts` 与 `apps/local-server/src/providers/ProviderStore.ts`），以及为什么会在并发段里返回 2（命令失败）。
3. 修：让测试与实现都不依赖进程级共享状态——优先在测试侧补全隔离（例如显式传入 store 根或补 `VESSEL_*` 环境变量的还原），只有确证是产品缺陷才动产品代码。
4. 加一条判别性断言或测试，保证下次同类泄漏会被抓住（而不是靠肉眼）。

### 允许改的文件

`apps/local-server/src/routes/profileParity.test.ts`、`apps/local-server/src/providers/ProviderStore.ts`（仅当确证产品缺陷）、`apps/cli/src/providers/defaultStore.ts`（同上）、`tasks/` 下新建一张卡 `tasks/350-profile-parity-isolation.md`。

### 自验

```
node node_modules/vitest/vitest.mjs run apps/local-server/src/routes/profileParity.test.ts
node node_modules/vitest/vitest.mjs run apps/local-server
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

---

## T6 · 卡 345c：服务端删除改道 + serve 启动清理

### 前置

345a 的 `trash.ts` 与 T3 的 `vessel trash` 已在。

### 要做的

1. `apps/local-server/src/server.ts` 的 `DELETE /api/sessions/:id`（`segs.length === 3 && method === 'DELETE'`）：把 `recycleDaemonPath(sessionDir)` 改为移入 `<workspaceRoot>/.harness/trash`；保持「索引持久移除 → 关闭 controller/writer → 移入暂存」顺序与回滚语义；`session_index_failed` / `session_index_stale` / `session_recycle_failed` 含义不变（后者=连暂存都失败）。
2. `vessel serve` 启动时 best-effort purge（异步、失败只 warn、不阻塞监听）；`VESSEL_TRASH_TTL_DAYS=0` 关闭。
3. `docs/DELETION-AND-RETENTION.md`：状态与「serve 启动会清理到期条目」同步。
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

### 问题与证据

`packages/core/src/session/Session.ts`：构造时 `acquireLease` 拿 `.lease`，`close()` 删 `.lease` 并置 `fd=null`；但 `append()` 在 `fd` 为空时只做 `this.fd = await fs.promises.open(this.logPath, 'a')`，**没有重新取租约**（见该函数 `if (!this.fd)` 分支）。所以「close 之后再 append」会在没有租约的情况下继续写日志，单写者 fail-closed 被绕过。这条是 `docs/product-evolution/PRODUCT-STATE.md` Round 11「残留（下一批）」的第 ① 条，至今未修。

### 要做的

1. 先写一条会失败的测试复现：同一 `Session` 对象 `close()` 后 `append()`，断言当前实现会写成功（红），修完后断言应「要么重新取租约成功、要么明确拒绝」。
2. 修：`append` 重开前重新 `acquireLease`（复用现有静态方法），或者在 `close()` 后把对象标记为不可再用并抛出明确错误。两种都行，但必须保持：正常路径不回归、陈旧租约仍能被接管、错误信息可读。
3. 补一条负向测试：另一个进程持有租约时，本对象 close 后 append 必须失败而不是静默写入。
4. 不要改 append-only 语义、不改 `.lease` 文件格式。

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

### 问题与证据

`tasks/README.md` 的路线层表里 170–181 仍写「本地全门禁通过；待验收」，183 同一批；但 182/183 已被标「已合入」，卡面也停在「待用户验收 / 待验收」（`tasks/170-*`、`tasks/174-*` 等）。这批是 2026-10-02/03 的 V1.5/V1.6 交付，后续 epic 已经覆盖，状态没有回填。

### 要做的

1. 逐张读卡（170–181、183），对每条交付主张在当前 HEAD 找**可复验的证据**：相关源码/测试是否仍在、对应测试是否通过。允许只跑定向测试，不跑全量。
2. 按证据落结论写入每张卡末尾（不改正文）：`已验收（2026-10-27 对账，依据 …）` 或 `仍待用户验收（缺 …）`。
3. 更新 `tasks/README.md` 路线层对应行的状态；不要动 182/183 已有结论。
4. **不许**在没有本次证据时写「已验收」；找不到证据就写「无法确认」并列出查过什么。

### 允许改的文件

`tasks/170-*.md` … `tasks/181-*.md`、`tasks/183-*.md`（只在末尾追加）、`tasks/README.md`。

### 自验

```
git diff --stat -- tasks
```
并在报告里给出「每张卡 → 结论 → 依据（文件:行 或 测试命令）」的对照表。

---

## T9 · Packaging release gate 实跑一次

### 问题与证据

`benchmarks/runners/src/release-gates/gates.ts` 有 packaging 门（约 257–277 行），`docs/V1.6-STABLE-CHECKLIST.md` 记录它此前「需要 dist」而未跑。现在 `apps/cli/dist/cli.js` 与 `apps/web/dist/index.html` 都存在。

### 要做的

1. 找到 packaging gate 的**现有**执行入口（`benchmarks/runners/src/release-gates/`，别新建入口、别加 npm script）。
2. 用现有 dist 跑一次，记录 exit 与输出。
3. 如果发现它需要的 dist 内容缺失或过期，先 `node node_modules/typescript/bin/tsc -b tsconfig.json` 重建，再跑一次。
4. 把两次结果写进 `tasks/351-packaging-gate-run.md`（新建），包含：入口命令、exit、失败原因（若有）、下一步建议。**不要**改 gate 的判据来凑通过。

### 允许改的文件

`tasks/351-packaging-gate-run.md`（新建）。如必须重建 dist，允许运行构建命令（产物 gitignore）。

### 自验

```
node node_modules/typescript/bin/tsc -b tsconfig.json
<你找到的 packaging gate 入口命令>
```

---

## T10 · 卡 260/275：真实浏览器验收（第二轮）

### 前置与已知限制

第一轮（`evidence/sessions/2026-10-26-iab-acceptance/report.md`）九项里六项停在「无法验证」：IAB 无浏览器菜单缩放、`Ctrl+=` 无效、CDP `deviceScaleFactor` 只改 DPR（918→DPR 1.5，innerWidth 仍 918）。这一轮允许把「真实缩放」判为无法验证，但**必须**把其余项做完。

### 要做的（A–I 九项，逐项给结论）

用夹具工作区（系统临时目录，独立 `USERPROFILE`/`HOME` 以免 Activity 混入真实项目），`vessel serve` 起在 5678：

- A 视觉矩阵：360/768/1024/1440/1920 × 浅/深 × 中/英，workbench / conversation / activity / settings 各一格；每格记 `documentElement.scrollWidth` vs `innerWidth`；至少 12 张截图。
- B 键盘与无障碍：只用键盘走 导航 → 新建会话 → 输入并发送 → 打开 Inspector → 删除确认 → Esc；记焦点可见性、遮挡、Esc 回位；抽查 10 个控件的 accessible name。
- C 首屏焦点 + 跨工作区草稿隔离。
- D 生效 Policy 只读面板（来源、无编辑入口）。
- E 工具卡默认折叠、错误原因可见、Stop 请求中禁用与失败原因、消息区内部滚动。
- F 删除：确认 → 消失 → 刷新仍消失；再制造一次回收失败（占用目录）看具体原因与重试。
- G Activity 四态分组（completed / cancelled / interrupted / failed）与刷新保持。
- H 刷新保史（消息、工具卡、终止提示）。
- I 端到端：新建 → 发送 → 工具调用 → Diff → 刷新保史 → 删除进回收站。

### 允许改的文件

只允许写 `evidence/sessions/2026-10-27-iab-acceptance-run2/`（报告 + 截图）。**不改产品代码、不改测试。**

### 自验

报告里每条给「通过 / 不通过（附现象）/ 无法验证（附原因与两种手段实测值）」；截图中不得出现非夹具项目名与用户会话标题。

---

## T11 · 陈旧状态卡第二遍对账（071 / 119 / 149 / 196 / 217 / 281 / mission-02）

### 问题与证据

除了 170–183，还有几张卡停在旧状态且已被后续工作取代，或需要单独判断：

- `tasks/071-windows-sandbox-backend.md`：状态「待验收（指挥验收）」，但沙箱链路后来由 255 / 256 / 281 / 287 重做。
- `tasks/281-arch07-posix-fallback-decision.md`：状态「阻塞 — 需要用户拍板」，而方案 2（默认拒绝 + `VESSEL_ALLOW_UNSANDBOXED=1` 放行）已由卡 287 实现并交付。
- `tasks/196-evaluator-red-green-reproduction-gate.md`：状态「Epic 199 全量门禁待执行」，而 199 早已合入。
- `tasks/217-event-projection-contracts-and-compaction-conservation.md`：状态「就绪待执行（2026-10-12）」，与同号的 `217-architecture-improvement-plan-implementation.md` 并存；事件投影/压缩守恒后来由 236 / 244 / 247 落地。
- `tasks/149-live-baseline-blocked.md`：blocked（外部 adapter 与真实 CLI 不匹配），后续 153 已回退并立「不自动驱动本机其他 agent」口径。
- `tasks/_missions/mission-02/M1-residual-wording.md`、`W4-repair-comment-367.md`：归档区里仍写「待执行」。
- `tasks/119-safety-scenario-falsifiable-criteria.md`：**部分完成**，S002 / S006 的恒真判据当时登记为「仍待加锁」；后续判别性测试可能已覆盖，需要核实。

### 要做的

1. 逐张读卡 → 判断「已被哪张卡取代 / 仍需处理 / 无法判断」，每条都要有文件或测试作依据。
2. 在被取代的卡末尾追加一行：`已被 <卡号> 取代（2026-10-27 对账）`；不要改正文，不要删卡。
3. 对 119：检查 `benchmarks/runners/src/conformance/asserts.ts`（约 103 行）、`benchmarks/runners/src/offline.ts`（约 218/219/253/254 行）、`benchmarks/runners/src/safety-discrimination.test.ts`（约 23 行），确认 S002/S006 的判据现在是否**可被证伪**。若已加锁，写清依据；若仍未加锁，新建 `tasks/352-safety-s002-s006-criteria.md` 记录缺口与最小修法，**不要**为了让场景变绿去放宽判据。
4. 同步 `tasks/README.md` 里对应的行。

### 允许改的文件

`tasks/071-*.md`、`tasks/119-*.md`、`tasks/149-*.md`、`tasks/196-*.md`、`tasks/217-event-projection-*.md`、`tasks/281-*.md`、`tasks/_missions/mission-02/M1-residual-wording.md`、`tasks/_missions/mission-02/W4-repair-comment-367.md`（以上只在末尾追加）、`tasks/README.md`、必要时新建 `tasks/352-safety-s002-s006-criteria.md`。

### 自验

```
git diff --stat -- tasks
```

报告里给对照表：每张卡 → 结论（被谁取代 / 已解决 / 仍缺什么）→ 依据（路径:行 或 测试命令 + exit）。

## 2. 交回来时给什么

每个编号完成后贴：改动文件清单、每条自验命令 + exit + 计数、未做与原因、被拒命令原文。协调者会复跑定向测试、跑全量 `gate-batched.ps1`，并以自己跑出来的数字落卡；实现者自述不作验收依据。

## 3. 不在本单

- 已完成、不要重做：340（看板收口）、341（构建命令）、343（回收原语）、345a（暂存区模块）、347/348/349（PDW 与归因规则）。
- 卡 346（文档一致性、跨平台矩阵、三档回滚、最终门禁）由协调者做。
- 3 小时 soak、release-report 刷新（要配额）不在本单。

## 4. 非 Agent 可执行项（不在 T1–T11，留给你或外部条件）

这一节是「全部积压」里**不能靠改代码解决**的部分，列全是为了让这份文件真的能当唯一清单用：

| 项 | 为什么 Agent 做不了 | 来源 |
|---|---|---|
| U1 GitHub Support 工单清 `refs/pull/*` 旧对象 | 需以你名义对外提交 | `HANDOFF.md` §3.1 |
| U2 npm 元数据残留是否开工单 | 同上，且已过 unpublish 窗口 | 同上 |
| U3 规则集 `bypass_actors` 是否收权 | 会改变你的合并习惯 | 同上 |
| U4 清游离提交 `5092ed4` | 需 `git gc --prune`，被安全门禁拦 | 同上 |
| U5 真实 `--live` 跨 harness 基线 | 会驱动本机 dsh/opencode/codex/claude/pi，消耗你的配额，须逐次授权 | `tasks/149`/`153` |
| ARCH-04 live 证据 | 同上 | `HANDOFF.md` §0 |
| UI-10 的 150%/200% 缩放与原生输入法 | IAB 无法做真实页面缩放，只能真机 | 卡 275 / 2026-10-26 运行记录 |
| release-report 刷新（154） | 需真实供应商配额 | `tasks/README.md` 未闭合段 |
| 3 小时墙钟 soak（155） | 时长与机器占用不适合交互式 Agent | 同上 |
| opencode-go 余额、Packaging 之外的发布门槛（156） | 外部账号与环境 | 同上 |
| GitHub PR 页面旧身份、npm `_npmUser` 残留、服务端旧对象 | 已知不可清除边界，别再试 | `HANDOFF.md` §3.3 |

T9 只覆盖「Packaging gate 用现有 dist 跑一次」；上面这些不在任何 Agent 任务里。
