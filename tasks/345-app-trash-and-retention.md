# 任务卡 345: 应用内暂存区、7 天保留期与 `vessel trash`

- Status: 已验收（2026-10-28）：345a、345b、345c、345d、345e 均已验收；前置收口卡 346 亦已验收。345e 由协调者另用真实 `serve` + 独立 CLI `restore` 复现（运行中 serve 首次 GET 即可见，仅新增合并）
- 实现方式：拆成 T3/T4/T5 三段交由 Codex 应用执行，指令见 `tasks/prompts/codex-handoff-2026-10-27-deletion-retention.md`（T3 `gpt-6.1-sol`/medium、T4 `gpt-6.1-terra`/medium、T5 `gpt-6.1-sol`/medium，必须按序）
- PDW task: none
- 依据：`docs/DESIGN-DECISIONS.md` 决策点 24、`docs/DELETION-AND-RETENTION.md` §3/§4

## 1. Goal

让「删掉的东西能找回来，到期再永久清」成为一条真链路：会话与产物的删除先进暂存区（可 restore），默认 7 天后由 `vessel trash purge` 永久删除；系统回收站不再被会话目录占用。

## 2. 要做的事

1. 暂存区模块（`packages/application/src/deletion/trash.ts`，与 343 的原语配合）：
   - 根：`<workspace>/.harness/trash/` 与 `<vesselHome>/trash/`；
   - 条目目录 `<UTC时间戳>-<短id>/` + `entry.json`（`id/origin/kind/reason/deletedAt/expiresAt/sizeBytes`）；
   - 同卷 `rename`，跨卷「复制 → 校验 → 源进暂存/回收」，任何一步都不直接永久删除源；
   - `restore(id)`：目标已存在则拒绝，不覆盖。
2. 会话删除改道：`apps/local-server/src/server.ts` 的 `DELETE /api/sessions/:id` 由「`recycleDaemonPath(sessionDir)`」改为「移入 trash」，HTTP 成功语义、索引先移后删的顺序、失败回滚都保持卡 259 的契约；`session_recycle_failed` 保留给「连暂存都失败」。
3. 保留期与清理：默认 7 天（`VESSEL_TRASH_TTL_DAYS` 或 `settings.json#retention.trashDays`，`0` = 不自动清）；触发点 `vessel serve` 启动 + daemon 每日 tick + 手工 `vessel trash purge`；清理前写 `retention/purge` 审计事件（条目 id / origin / expiresAt / 字节数 / 结果）。
4. CLI：`vessel trash list`（默认表格，`--json`）、`restore <id|path>`、`purge [--dry-run] [--older-than <days>] [--force]`；HTTP 只读：`GET /api/trash`（同源、不含凭据、不带删除动作）。
5. 防护：清理范围 realpath 必须仍在 trash 根内、条目必须有 `entry.json`、符号链接逃逸拒绝、`--all` 类批量必须 `--force` 且先 dry-run。**不读写系统回收站。**

## 3. Not Doing

- 不做云同步、不做按大小淘汰、不做整盘定时清空。
- 不改 `evidence/` 与 `docs/` 的自动清理（它们只有显式删除时进 trash）。
- 不改卡 259 已定的「索引先移 → 目录后删 → 失败回滚」顺序与错误码语义（只换删除去向）。
- 不做 Web 端 UI（本轮只 CLI + 只读 HTTP）。

## 4. Acceptance

1. 单测：A/B/C 分类路由各一条；跨卷回退；TTL 边界（到期前 1s 不删、到期后 1s 删）；`restore` 往返；目标已存在时拒绝；`..` 与符号链接逃逸被拒；缺 `entry.json` 的目录不被 purge。
2. 集成：`DELETE /api/sessions/:id` 后会话目录出现在 `.harness/trash/`，列表里消失；`restore` 后重新出现在列表；`purge --dry-run` 列出到期项且不删；`purge` 删除并落审计事件。
3. 真实进程（Windows）：`vessel serve` + 夹具工作区跑一遍上面的集成路径，回收站里不再出现会话目录。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`scripts/gate-batched.ps1` 全绿；卡 259/261 的既有删除用例在新去向下一并更新并通过。

## 5. Blast Radius

新增 `packages/application/src/deletion/`；改 `apps/local-server` 的删除路径、`apps/cli` 的 `trash` 命令与 USAGE、`packages/shared` 的 settings 键；改卡 259/261 相关测试与文档；`docs/DELETION-AND-RETENTION.md` 落地为「已实现」。

## 6. Expected Evidence

单测与集成测试名单、`trash list/restore/purge --dry-run/purge` 的实际输出、审计事件样例、回收站前后对比（会话目录不再入回收站）、门禁退出码。

## 7. Result

待执行。

### 345a · T3 暂存区模块

- Status: T3 自验完成、独立静态复核 PASS（待协调者整卡验收）；未启动 T4/T5，未 commit/push、未改 `.pdw/`、未跑全量门禁。
- 执行模式：personal-dev-workflow 宿主辅助模式；用户本次明确要求子 Agent，覆盖交接单 §0.9 的旧禁止条款。同一文件同一时刻一个写者。
- 模型路由：实现 `gpt-6.1-sol` / `medium`（选型表：需要协调、预计返工的复杂技术工作；删除与跨卷主链路）；独立只读复核 `gpt-6.1-terra` / `medium`（边界明确、基于给定材料的复核）。由宿主提供模型，不启动本机 Agent CLI；不请求 Fast、不使用 Ultra。
- 唯一实现写者：T3 实现子 Agent，仅写 `packages/application/src/deletion/trash.ts` 与 `trash.test.ts`；协调者仅填本段。
- 跨卷口径：用户本次确认复制并校验后将源移入源卷内应用暂存区，保留独立 `entry.json`，由该根独立管理 TTL；永不触碰系统回收站。任一步失败时原路径源数据保持不变。
- 交证日期：2026-10-27；仅 T3 自验及独立复核完成，整卡 345 尚未验收；全量门禁仍由协调者另跑。
- 改动文件：`packages/application/src/deletion/trash.ts`、`packages/application/src/deletion/trash.test.ts`，以及本 345a 结果段。
- 实现：同步 API `trashEntry/list/restore/purge`；条目布局 `<root>/<UTC时间戳>-<短id>/{entry.json,data}`。同卷 rename，跨卷 SHA-256 树形/字节校验后将源保留在 `dirname(target)/.harness/trash`，返回 `sourceBackup: { root, id }`；备份独立 TTL、可 list/restore/purge。没有新增依赖或后台任务。
- 保留期：默认 7 天、环境变量与显式 TTL 支持 0（`expiresAt: null`）；按 T3 的到期硬约束，`olderThanDays` 只追加年龄过滤，不能提前清掉未到期/无限保留条目。dryRun 不创建或改写审计文件；实际 purge 先追加 pending 审计、删除后追加结果。路径/元数据/链接校验失败计 skipped，恢复冲突拒绝覆盖。
- 独立复核：Terra/medium 发现两处初稿违反 T3（年龄筛选提前到期、dryRun 写审计），均已定向修复，最终静态复核 PASS。新增单测 24 条；主会话独立复跑 exit 0，1 文件 / 24 passed。

| T3 指定自验命令（最终源码编辑后） | exit | 测试计数 / 结果 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run packages/application` | 0 | 35 文件；299 passed + 2 skipped（301 总计） |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 干净；无测试计数，主会话另行复跑 exit 0 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 干净；无测试计数，主会话另行复跑 exit 0 |

- 原始自验日志：`%TEMP%/vessel-t345a-application.log`、`vessel-t345a-tsc-build.log`、`vessel-t345a-tsc-tests.log`、`vessel-t345a-focused.log`。application 原始日志由主会话读取核对；不将实现者自验充作整卡全量验收。
- 产物 SHA-256：`trash.ts` = `2000334a28eaa92c6de8345fa89db509d84281df9a3c038d86b068e473eda2bd`；`trash.test.ts` = `3a2ef200bee8fe9f94f88994969e501d8098e7ef5857d12b49848c5dd714d555`。
- 范围核对：主会话建立并核对 `%TEMP%/vessel-t345a-baseline-1793084191396.json`，79 个原有改动文件哈希全部未变，新出现的范围外文件 0；未改卡片本段之外内容。
- 未做与边界：不执行 T4/T5、不接 CLI/HTTP/包出口、不更新整卡状态或 README、不跑全量门禁、不 commit。跨卷使用 EXDEV 模拟及复制/校验/源归档失败注入，未做真实双卷测试；失败保留 pending 目录并 skipped，同卷恢复保留元数据空壳，跨卷恢复保留原 trash 副本。初次文件符号链接夹具被 Windows EPERM 拒绝创建，改用 junction 夹具后通过；这不是最终自验失败。

#### 被拒绝的补充命令（原文）

该主会话补充探针在执行前被 PreToolUse hook 拦截，未创建夹具，未取得 exit code，也不计作通过。没有绕过拦截；指定三条自验与独立定向复跑均正常执行。

```text
Command blocked by PreToolUse hook: ⛔ HOOK 已拦截危险命令：Node.js fs.rm/fs.unlink/fs.rmdir 是永久删除（不进回收站），请改用回收站命令. Command: node --import tsx --input-type=module -e 'import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert/strict"; import { trashEntry, list, restore, purge } from "./packages/application/src/deletion/trash.ts"; const base = fs.mkdtempSync(path.join(os.tmpdir(), "vessel-t345a-independent-")); try { const root = path.join(base, "trash"); const target = path.join(base, "artifact.bin"); const bytes = Buffer.from([0, 255, 10, 13, 128]); fs.writeFileSync(target, bytes); const first = trashEntry({ root, target, kind: "artifact", reason: "independent-verification", ttlDays: 1 }); assert.equal(first.sizeBytes, bytes.length); assert.equal(list({ root }).entries.length, 1); restore({ root, id: first.id }); assert.deepEqual(fs.readFileSync(target), bytes); const second = trashEntry({ root, target, kind: "artifact", reason: "independent-verification", ttlDays: 1 }); const atExpiry = new Date(second.expiresAt); assert.equal(purge({ root, dryRun: true, now: atExpiry }).entries.length, 1); assert.equal(fs.existsSync(path.join(root, "_purge.jsonl")), false); assert.equal(purge({ root, now: atExpiry }).purged.length, 1); assert.equal(fs.existsSync(path.join(root, second.id)), false); const records = fs.readFileSync(path.join(root, "_purge.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line)); assert.equal(records[0].ok, false); assert.equal(records.at(-1).ok, true); console.log("Independent binary-file roundtrip, exact-expiry purge, dry-run immutability, audit order: PASS (4 scenarios)"); } finally { fs.rmSync(base, { recursive: true, force: true }); }'
```

#### 协调者复核（2026-10-27，独立于实现者自述）

- 代码：`packages/application/src/deletion/trash.ts`（12.7 KB）与 `trash.test.ts`（11.7 KB）已读；`purge` 的到期判据是 `expiresAt !== null && Date.parse(expiresAt) <= now` **且** 可选的 `deletedAt + olderThanDays*DAY <= now`，即 `olderThanDays` 只能进一步收窄、不能提前删未到期条目；`dryRun` 在写审计前 `return`，`_purge.jsonl` 只由真实 purge 追加。这两条正是独立复核提出的问题，已修，不是口头承诺。
- 实测（协调者，本机）：`node node_modules/vitest/vitest.mjs run packages/application` → exit 0，35 文件 / 299 passed + 2 skipped（新增 24 条）；`tsc -b` exit 0；`tsc -p tsconfig.test.json --noEmit` exit 0。与实现者自述一致。
- 跨卷口径：用户本轮确认「源卷内应用暂存区」，实现按此落地（`sourceBackup: { root, id }`，独立 `entry.json` 与 TTL），`docs/DELETION-AND-RETENTION.md` §3 已同步。真实双卷未实测，只有 EXDEV 模拟，这一点保留。
- 未接过：345b（CLI）、345c（服务端改道）与整卡全量门禁；本卡状态仍为「待执行」。

### 345b · T3 trash CLI

- Status: T3 自验完成、独立静态复核 PASS；整卡 345 尚未验收。
- 路由：实现与独立复核均为 `gpt-6.1-terra` / `medium`，依据交接单中单模块 CLI 任务；未启用 Fast 或 Ultra。原生宿主辅助模式，单写者。
- 改动：`apps/cli/src/commands/trashCommand.ts`、`trashCommand.test.ts`、`apps/cli/src/cli.ts`；接入 list、restore、purge 及三行帮助，根优先级为 `--root`、环境变量、工作区默认路径。JSON 仅输出元数据或错误；独立复核发现无效 `--older-than` 的 JSON 输出缺失，已修并增加回归测试，最终复核 PASS。
- 最终源码编辑后自验：`node node_modules/vitest/vitest.mjs run apps/cli/src/commands/trashCommand.test.ts` exit 0（1 文件 / 7 passed）；`node node_modules/typescript/bin/tsc -b tsconfig.json` exit 0；`node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` exit 0。日志位于系统临时目录 `vessel-wave1-wVrbzr` 的 `t3-vitest-repair.log`、`t3-tsc-build.log`、`t3-tsc-test.log`；初版测试日志保留为 `t3-vitest.log`。
- SHA-256：`trashCommand.ts` `61d17a42053bff2141e647211260fe60963c3d23c7b25eb057a011995c0f73e5`；`trashCommand.test.ts` `49fe8794f07be21bd176b00e1b0a52286954f0b74100bffcf3d618718eeff78f`；`cli.ts` `9eb862a114d581e8c64437810cd503dde8c2368ed041bcf7588973dea16e53f1`。
- 边界：未跑全量门禁、未修改包出口或依赖、未接服务端、未改整卡状态或索引、未 commit/push。被拒命令：无。

#### 协调者验收（2026-10-27，独立复跑 + 一处纠正）

- **纠正 1（我改的，3 个文件）**：`trashCommand.ts` 与 `trashCommand.test.ts` 原来从 `../../../../packages/application/dist/deletion/trash.js` 相对导入。这有两处问题：一是绕开 `@vessel/application`（`vitest.config.ts` 把该别名的所有包都指向 `src/index.ts`），全仓没有第二处这种写法；二是让这条 CLI 测试事实上在测**构建产物**，而 `npm run test:all` 不先构建，`dist` 一落后测试就会假绿——正是 `AGENTS.md`「dist 会落后于 src」那条坑。
  - 改法：`packages/application/src/index.ts` 增 `export * as trashStore from './deletion/trash.js'`（命名空间导出，避免 `list`/`restore`/`purge` 这类通名与其他 application 导出冲突）；`trashCommand.ts`、`trashCommand.test.ts` 改为 `import { trashStore } from '@vessel/application'`，调用点加 `trashStore.` 前缀。行为零变化。
  - 这一点原实现者没错：T3 的允许清单里没有包出口文件，它只能绕；清单写漏了，记在交接单缺陷里。
- **纠正 2（我改的，3 个文件，门禁发现）**：全量门禁 `cli` 段红一条——`apps/cli/src/cli.test.ts` 的「中文 help 逐行金标」写死 102 行，T3 的 USAGE 加了三行变 105。查下来不只是数字：那三行被追加在 `usage.commands` 之后，落到了 `run 选项:` 块里面（`--json` 行之后、`provider 协议说明` 之前），位置本身是错的。
  - 改法：三条 `vessel trash ...` 移进 `apps/cli/src/i18n.ts` 的 `usage.commands`（中英各一份，紧跟 `vessel web` 之后、`run 选项:` 之前），`cli.ts` 的 USAGE 模板恢复原样；`cli.test.ts` 的金标更新为 105 行、`lines[99]===''`、`lines[100]==='provider 协议说明:'`，并把 `vessel trash purge ...` 那一行加进逐行断言。
  - 复验：`tsc -b` exit 0；`vitest run apps/cli/src/cli.test.ts` exit 0、1 文件 / **137 passed**；`node apps/cli/dist/cli.js --lang zh --help` 里三行位于 `vessel web` 之后，`--lang en --help` 仍零 CJK 且含三条 trash 行。
  - 这一条同样是派单清单的问题：`apps/cli/src/cli.test.ts`、`apps/cli/src/i18n.ts` 都会被「加三行 USAGE」牵连，T3 的允许清单里没有它们，实现者按规则不能改，只能留给协调者。
- 代码复核：`trash list/restore/purge` 三子命令、`--root` > `VESSEL_TRASH_ROOT` > `<cwd>/.harness/trash` 的根优先级、非法参数（含 `--older-than` 非数字）返回 2 且 `--json` 下给可解析错误、`restore` 冲突非 0 不覆盖——均在实现里；JSON 输出只含元数据，不含 `data/` 内容。
- 独立复跑（日志 `%TEMP%\opencode\wave1-verify\`）：`vitest run apps/cli/src/commands/trashCommand.test.ts` exit 0、1 文件 / **7 passed**；`tsc -b`、`tsc -p tsconfig.test.json --noEmit` exit 0（均在我的改动之后跑）。
- 真实进程冒烟（`tsc -b` 重建 dist 之后，走 `apps/cli/dist/cli.js`）：`trash list --root <tmp>` → `Trash is empty.` exit 0；`trash purge --dry-run --json --root <tmp>` → `{"entries":[],"purged":[],"skipped":[]}` exit 0；`trash bogus` → usage 到 stderr、exit 2。
- 未接过：345c（服务端删除改道 + serve 启动清理）与整卡全量门禁。

### 345c · T6 服务端删除改道 + serve 启动清理

- Status: 已验收（2026-10-27：服务端删除改道 + serve 启动清理；首轮因测试夹具红、经授权只改测试后转绿，`server.ts` 哈希未变）
- 实现方式：PDW `implement`（DeepSeek high）+ `review`（DeepSeek max），契约 `.pdw/contracts/345c-server-trash-routing.json`
- 依赖：345a（`trash.ts`）与 345b（CLI）已完成并验收

要做的：

1. `apps/local-server/src/server.ts` 的 `DELETE /api/sessions/:id`（`segs.length === 3 && method === 'DELETE'`，约 L884–923）：把 `recycleDaemonPath(sessionDir)` 改为移入 `<workspaceRoot>/.harness/trash`，保持「索引持久移除 → 关闭 controller/writer → 移入暂存」的顺序与失败回滚；`session_index_failed` / `session_index_stale` / `session_recycle_failed` 含义不变（后者＝连暂存都失败）。
2. `vessel serve` 启动时 best-effort purge：异步、失败只 `warn`、不阻塞监听；`VESSEL_TRASH_TTL_DAYS=0` 时不清。
3. `docs/DELETION-AND-RETENTION.md` 的状态与「serve 启动会清理到期条目」同步。
4. 测试至少 4 条：删除后目录在 `.harness/trash` 且列表消失；restore 后回来；暂存失败时索引回滚并返回 `session_recycle_failed`；启动 purge 被调用（注入时钟/临时根，别真等 7 天）。

#### Result（2026-10-27，波次 A / T6）

- **自验 FAIL，已停在 T6；未进入 T13/T14，整卡未验收。** Codex 应用辅助模式，唯一实现写者 `gpt-6.1-sol` / `high`（删除主链路、事务与回滚）；独立只读复核 `gpt-6.1-sol` / `medium`，按第二波交接单路由，无 Fast/Ultra。
- 修改文件仅 `apps/local-server/src/server.ts`、`server.test.ts`、`docs/DELETION-AND-RETENTION.md`，另仅填写本 345c 结果。删除接 `import { trashStore } from '@vessel/application'`，持久移除索引 → 等待关闭 writer/controller → `trashEntry`，根为会话工作区 `.harness/trash`，既有回滚及错误码保留。监听成功后 `setImmediate` best-effort purge，缺根跳过、TTL=0 不调用、抛错只 warn。
- 新增 startup 到期/未到期、TTL=0、缺根、失败 warning 4 条，以及目录日志 restore 往返用例；既有删除/索引/回滚/并发/writer 断言改接同步且具真实类型的 trash API。restore 仅恢复目录/日志，不自动重建已删除索引，本段不宣称 HTTP 列表恢复或整卡 345 完成。

| 最后源码编辑后的自验命令 | exit | 结果 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run apps/local-server` | 1 | 26 文件：25 passed / 1 failed；301 passed / 2 failed（303）；118.85s |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 未运行 | 首条门禁失败即停 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 未运行 | 首条门禁失败即停 |

原始失败（完整输出保留于下方日志）：

```text
FAIL DELETE /api/sessions/:id clears session, stops controller, and enforces origin check
AssertionError: expected false to be true // Object.is equality
apps/local-server/src/server.test.ts:649:85
expect(fs.existsSync(path.join(root, entries[0]!.id, 'data', 'session.jsonl'))).toBe(true);

FAIL restores a trashed session directory with the original log bytes
Error: ENOENT: no such file or directory, open 'C:\work\AppData\Local\Temp\cah-local-server-uuIfJ3\workspace\.harness\sessions\sess_1793098121780_968a1c10\session.jsonl'
apps/local-server/src/server.test.ts:671:26
const logBefore = fs.readFileSync(path.join(sessionDir, 'session.jsonl'));
```

- 失败原因已核对源码：Session 日志懒创建，两个新夹具未 append/runTurn 就断言 `session.jsonl` 存在。未修夹具、未放宽断言、未加 sleep/retry、未重跑。
- 独立复核另有 P1：现有部分 `server.test.ts` 夹具创建 server 时没有传临时 `workspace`（如当前 L320），新增启动清理因而指向仓库 cwd 的 `.harness/trash`。本次执行前该根不存在，未观察到真实数据删除；修复应隔离普通夹具的启动清理，专用 retention 用例仍实测真实 purge。静态复核其余事务顺序、导入、TTL 与文档边界符合 T6；有此发现与红门禁，不记 PASS。
- 证据：`C:/work/AppData/Local/Temp/vessel-wave-a-KgYB0Y/T6-01-local-server.log`、`T6-result.json`、`T6-artifact-hashes.json`。原执行会话 20062 已 exit 1，无重复启动。
- SHA-256：`server.ts` = `1ed7e0eee0b586d0c52c629a407a6a5c656a29d95795329546a255d1ffad04d4`；`server.test.ts` = `e542b58a185a34a000c94cc5e454edbd52c30de1980c470b52b780d4ae0cf076`；删除文档 = `d03fb05d9ecd4aacce3616592cad2712029322cba6d0a38d2bcd7905e9e3a965`。
- 未做：失败后的修复与类型检查、T13/T14、整卡真实进程/全量门禁、commit/push/分支、`.pdw/` 与技能修改。被拒命令：无；一次补丁上下文不匹配，未产生修改。

#### 345c 修复与验收（2026-10-27，授权修复 + 协调者独立复跑）

- 失败后由维护者明确授权「在 T6 允许文件内修夹具、不得改产品行为」，修复只动 `server.test.ts`：两条日志夹具补真实 `appendSync`（等它完成再断言 `session.jsonl`），另给 11 处 server 夹具显式传临时 `workspace`，使启动清理不再指向仓库 cwd。**`server.ts` 在修复期间哈希不变**（`1ed7e0ee…04d4`），未放宽断言、未加 sleep/retry。
- 修复后自验：`vitest run apps/local-server` exit 0、26 文件 / **303 passed**；两条 tsc exit 0。原始失败日志保留在 `T6-01-local-server.log`，未覆盖。
- 我的独立复跑：`apps/local-server` 26 文件 / **312 passed**（T13/T14 又各加了用例），`vitest run apps/local-server/src/daemon` 4 / 32，`tsc -b`、`tsc -p tsconfig.test.json` exit 0。
- 代码复核：删除路径 `trashStore.trashEntry({ root: <session workspace>/.harness/trash, target, kind:'session', reason:'user_delete' })`；「索引先移 → 关 controller/writer → 移入暂存 → 失败还原索引」与三个错误码均未变。启动清理在 `listen()` 成功返回前 `setImmediate` 触发，`VESSEL_TRASH_TTL_DAYS=0` 直接返回、根不存在直接跳过、抛错只 `warn`；测试里断言「端口已可用但 purge 尚未调用」→「下一个 immediate 才调用」，这条正好证明了不阻塞。
- 边界（不宣称）：`trash restore` 只恢复目录与日志字节，不重建已删除的注册表索引，HTTP 列表也不会自动恢复该会话；整卡 345 的「真实进程 + 回收站前后对比」仍待卡 346 收口。

### 345d · W4 T3 会话恢复后重新登记（2026-10-28）

- Status: T3 指定自验通过，独立只读复核 PASS（协调者传达）；本段不改整卡 345 的历史状态，不声称 HTTP 列表即时刷新。
- 路由：实现 `gpt-6.1-sol` / `medium`，依据第四波 §1 的跨 CLI + registry 索引一致性任务；独立复核 `gpt-6.1-terra` / `medium`。原生宿主辅助模式，唯一写者；Fast 关闭，不用 Ultra，不启动本机 Agent CLI、不跑全量门禁、不 commit/push；两条 tsc 由协调者在源码稳定后串行执行。
- 选择 **真恢复**。定位：`packages/application/src/session/SessionRegistry.ts:61` 定义 `sessions.json` / `sessions.metadata.jsonl`，`:119` 以 `VESSEL_SESSION_ROOT`（缺省 `~/.vessel`）为根；`:428` 的 remove 持久化墓碑，`:501` 的 persist 追加 journal 后原子更新兼容 JSON。已有 `:449` 的 restore 要求完整 SessionMeta，而 trash 元数据不含 provider/model/permission，不能从 trash 伪造。新增 `:456` 的 restoreRemoved 只从原注册表 journal 取该 id 最后有效元数据，校验工作区、拒绝重复登记，再复用 restore 持久化，保留原 Topic 与时间戳。
- CLI `apps/cli/src/commands/trashCommand.ts:20`：session 目录成功恢复后才重新登记，成功输出明确指向 `vessel sessions list`；登记失败返回 1、保留已恢复字节，明确提示核对原 `VESSEL_SESSION_ROOT`、保留目录并检查历史元数据，不重复 trash restore。持久化报错可能已经写入 journal，文档要求先 list 检查实际状态；没有虚构 `--reindex` 或声称 list 会自动重建。`trash.ts`、HTTP 层与删除/保留语义未改。
- 安全回归：跨实例持久化列表、Topic/时间戳保全、再次 restore 拒绝且日志字节不变、错误 registry 缺历史时保留目录并报错、登记失败提示、workspace 不匹配与未知 id 不写元数据、旧无效候选后有有效记录再墓碑时可恢复。全部夹具位于系统 TEMP；CLI 测试显式隔离 `VESSEL_SESSION_ROOT`，不触真实用户登记表。

| 最后源码编辑后的命令 | exit | 计数 / 结果 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run apps/cli/src/commands/trashCommand.test.ts packages/application/src/session/SessionRegistry.test.ts` | 0 | 2 文件 / 30 passed（CLI 10 + registry 20）；协调者独立复跑相同计数、exit 0 |
| `node node_modules/vitest/vitest.mjs run packages/application` | 0 | 36 文件 / 323 passed + 3 skipped（326），214.74s |
| `node node_modules/vitest/vitest.mjs run apps/cli` | 0 | 65 文件 / 782 passed，274.97s |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 协调者执行；无诊断，重建 dist 后再做真实 CLI 证明 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 协调者执行；无诊断 |
| `node --experimental-strip-types %TEMP%/vessel-wave4-t3-fixture.mts` | 0 | 隔离夹具，四个独立 `node apps/cli/dist/cli.js` 进程；见下文 |

- **实测回答「恢复后 vessel sessions list 里能不能看到它」：能。** 协调者最后重建 dist 后，独立 CLI 进程 `sessions list --json` 先返回 `sessions: []`（exit 0）；`trash restore <id> --root <fixture-trash>` exit 0；新进程再次 list 返回 `sess_1793175739468_d00ed3ae`，provider/model/permission 与原始元数据相同（exit 0）；重复 restore 同一 trash id 返回 1，`session.jsonl` 仍为原始 `fixture history\n`。夹具 `%TEMP%/vessel-wave4-t3-fixture-NvIXaM` 保留作证，不是对真实用户会话操作；运行中的 HTTP registry 不承诺即时同步。
- 最终证据：`%TEMP%/vessel-wave4-t3-repair-focused.log`、`vessel-wave4-t3-repair-application.log`、`vessel-wave4-t3-repair-cli.log`、`vessel-wave4-t3-repair-real-cli-dist.log`。协调者原始证据在 `%TEMP%/vessel-wave4-baseline-0JOEe1/repair-tsc-build.log`、`repair-tsc-tests.log`、`verify-t3-final-focused.log`，均由协调者实际执行并传达结果。
- 首轮失败与修复如实保留：协调者首轮 test-typecheck exit 1，原文 `apps/cli/src/commands/trashCommand.test.ts(73,35): error TS7006: Parameter 'call' implicitly has an 'any' type.` 与 `(88,35)` 同错，保存在 `vessel-wave4-baseline-0JOEe1/final-tsc-tests.log`。已按真实 console 参数类型 `Parameters<typeof console.log>` 定型，没有 `as any` 或扩大产品接口。独立复核发现首稿遇到旧无效历史候选会提前报错，现改为跳过并增加「无效旧记录 → 有效最新记录 → 墓碑」回归；上述全部最终命令在此修复之后完成。
- 首轮未最终计入的绿结果另存：`vessel-wave4-t3-focused.log`（1 / 10）、`vessel-wave4-t3-final-focused.log`（2 / 29）、`vessel-wave4-t3-application.log`（36 / 322 + 3 skipped）、`vessel-wave4-t3-cli.log`（65 / 782）；最后者在修复前启动，未用来冒充修复后 gate。早期源代码 CLI 探针分别遇到 Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME`（exit 1，`vessel-wave4-t3-real-cli-file.log`）和既有类型导出 `BackendCtor` 的 tsx 加载问题（exit 1，`vessel-wave4-t3-real-cli-src.log`）；改用协调者新构建 dist 后完成真实进程证明。另一次 `tsx -e` exit 0 但日志 0 字节（`vessel-wave4-t3-real-cli.log`），不计作任何成功证明。
- 本次改动仅五个产品/测试/文档文件及本追加段：`apps/cli/src/commands/trashCommand.ts`、`trashCommand.test.ts`、`packages/application/src/session/SessionRegistry.ts`、`SessionRegistry.test.ts`、`docs/DELETION-AND-RETENTION.md`。SHA-256 依次为 `609343af95af46200211bb8ac6596c563def529fba192b5f3beac843ed040b38`、`18f3618d12c183755bdc32d7042501976e6f2d3805437aa6948e76e46b45eb04`、`116f046f1d323d0416554ed38f0b30141815e16ec1cbb1d2f369f87e30002eb9`、`6c8f287dc99dbba56a3f384508b81d07032b6844d42a63b4e10b12067a2c3dfb`、`8e63f7f8cfa8661297ebe9f65abb1db28ebb96291eebcbb26ac8f1f27bd13026`。
- 未做：不改其它任务、不新增卡、不改 trash.ts / HTTP、不跑全量门禁、不写 git；整批验收由协调者负责。原注册表历史已丢失时不猜测身份/权限，需要保留已恢复目录后人工处理；不把提示说成自动恢复。被拒命令：无。

#### 345d 协调者验收（2026-10-28，独立复跑）

- `SessionRegistry.restoreRemoved` 的设计我认可：它从 **registry 自己的 journal**（`registry/session` 记录）取最后一次持久化元数据，逐字段校验后再 `restore()`；**不信任 trash 里的 `entry.json`**。这正好补上卡 346 那条「元数据无来源认证」的顾虑——恢复身份不靠可伪造的外部文件。
- CLI 接线正确：`entry.kind === 'session'` 时用 `path.dirname×3` 还原 workspaceRoot（`<ws>/.harness/sessions/<id>` → `<ws>`），再 `new SessionRegistry().restoreRemoved(...)`；失败时明确提示「目录已还原但登记失败，不要重复 trash restore」，没有假装成功。
- 我自己的复跑：`vitest run apps/cli/src/commands/trashCommand.test.ts` **10/10**（原 7 条 +3）；`vitest run packages/application` **36 文件 / 323 passed + 3 skipped**；`vitest run apps/cli` **65 文件 / 782 passed**；两处 tsc exit 0。
- 真实验证我认它的做法（四个独立 CLI 进程、隔离 registry）：restore 后新进程 list 能看到会话、重复 restore exit 1、`session.jsonl` 字节未变。
- **遗留**：它自己写明「运行中的 HTTP registry 不承诺即时同步」——已交给第五波 V3（要么做增量刷新，要么把限制写进文档并报 blocker），本轮不冒充已解决。

### 345e · W5 V3 运行中 serve 读取 CLI 恢复新增会话（2026-10-28，实现证据，待独立复核）

- 路由：`gpt-6.1-sol` / `high`，依据第五波 §1「跨进程状态一致性，最容易修错」；Fast 关闭，不用 Ultra；唯一写者，不派子代理、不调用其它 Agent CLI。本段仅交实现与实测，最终验收由协调者另派独立会话执行。
- 定位（本次编辑前）：`apps/local-server/src/server.ts:308` 在服务创建时构造 registry，`:648–651` 的 `GET /api/sessions` 直接调用 `listIndexed`；`packages/application/src/session/SessionRegistry.ts:124–125` 只在构造时读 JSON/journal，`:129–150` 的 `loadJournal` 清空重建内存，`:179–189` 的 `listIndexed` 查询已有 SQL 索引或内存列表，`:456` 的 `restoreRemoved` 仅更新调用者进程。原来没有可复用的「仅合并新增」读取入口，不能在请求里重用 `loadJournal` 覆盖活会话。
- 选择**增量刷新**：增加 `refreshAddedSessions`，首次从 journal 起点读取，此后按字节偏移读取追加内容；只消费完整行，跳过无效记录，按同一批追加中每个 id 的最后有效记录处理墓碑。仅将当前内存缺失且最终不是墓碑的 id 并入内存/Topic 索引，并等待该会话的查询投影完成；已有会话对象、元数据与 controller 保留。并发列表共享同一个刷新 Promise；查询索引已开启时只投影新增会话，没有重建、journal 写入或兼容快照写入。`GET /api/sessions` 在列表查询前等待刷新，不新增 HTTP 写端点。同步更新删除/保留文档的当前行为；历史卡段原文保留。
- 改动文件：`apps/local-server/src/server.ts`、`apps/local-server/src/server.test.ts`、`packages/application/src/session/SessionRegistry.ts`、`packages/application/src/session/SessionRegistry.test.ts`、`docs/DELETION-AND-RETENTION.md`，以及本追加段。未动 `trash.ts`、345c 删除事务、CLI、其它任务/配置/技能；原有脏工作树保留。
- 新回归：同一 HTTP 服务先列出并打开 SQL 索引 → 删除 → 第二个 registry 模拟 CLI 恢复 → 首次列表出现且有日志计数；重复列表不重复。另有已存在活会话不被外部修改覆盖、外部新建后墓碑不被导入、Topic 恢复、并发刷新、后续本地持久化不写回导入会话墓碑、GET 不改 journal/快照/日志；无 SQL 路径与拆在中文 UTF-8 字符中间的半行、无效行后正常新增均覆盖。

| 最后代码/测试编辑后的命令 | exit | 计数 / 实测 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run packages/application/src/session/SessionRegistry.test.ts apps/local-server/src/server.test.ts` | 0 | 2 文件 / 108 passed，68.15s；首轮聚焦自验 |
| `node node_modules/vitest/vitest.mjs run packages/application` | 0 | 36 文件 / 325 passed + 3 skipped（328），48.40s |
| `node node_modules/vitest/vitest.mjs run apps/local-server` | 0 | 27 文件 / 317 passed，111.66s |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 无诊断，1.82s；真实进程前重建 dist |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 无诊断，2.91s |
| `node %TEMP%/vessel-wave5-v3-aiD4tY/proof.mjs` | 0 | 4.50s；下述真实 serve/独立 CLI/HTTP 证明，原始 argv 与响应在 `proof.json` |

- **实测回答：能看到，而且 serve 没有重启。** 在系统 TEMP 自建 workspace/profile 中，把 `HOME`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`VESSEL_SESSION_ROOT`、`VESSEL_PROVIDER_ROOT`、`VESSEL_USAGE_ROOT`（以及 MCP/settings/daemon 根）全部隔离，设 TTL=0；绑定探针确认空闲后使用 `127.0.0.1:55363`。`node apps/cli/dist/cli.js serve --port 55363 --workspace <fixture-workspace>` 启动 PID **3800**；POST mock 会话与 turn 均成功，先 GET 再 DELETE（200）后 GET 不含被删 id。另起真实 CLI：`node apps/cli/dist/cli.js trash list --root <fixture-trash> --json`（PID 2276，exit 0，1 条）和 `node apps/cli/dist/cli.js trash restore 20261028T121504973Z-9cce9bf4 --root <fixture-trash>`（PID **5740**，exit **0**，stdout 明确 session registered，stderr 空）。
- restore 后**第一次** `GET /api/sessions` 为 200，返回 `sess_1793189704787_31f07ce6` 恰好 1 次，`provider=mock`、`model=v3-restored-fixture`、`permission=read-only`、`recordCount=14`、`totalTokens=120`，原 Topic 与时间戳保留；另一活会话 `sess_1793189704920_bc86ab22` 仍存在。重复 GET 仍只有 1 条。全过程原 serve PID=最终 serve PID=3800，读取期间 `exitCode=null`；两次 GET 前后 journal 与 sessions.json 的 SHA-256 未变，session.jsonl 恢复前后 SHA-256 均为 `7c9a4c7f5c5af85c184024a5f1e8075bd972ef678c2869c1fb0368efc33a241c`，GET 未创建 `.lease`。完成后仅停止自建 serve（SIGTERM），再次 bind 相同端口成功，监听已释放。
- 原始证据仅留 `%TEMP%/vessel-wave5-v3-aiD4tY/`：`proof.mjs`、`proof.json`（所有 HTTP 状态/响应与子进程 argv/exit/PID）、`serve.stdout.log`、`serve.stderr.log`，夹具保留。自验计数如上，不将终端无输出推断为成功或卡死。
- 待复核 artifact SHA-256（非自我验收）：`SessionRegistry.ts`=`cc3bf0ebb222069a5afc7d5636db2bacd9fa9d174fdd994fe060167c4c17287f`；`SessionRegistry.test.ts`=`42bb73d026e67caee35c7de81bb312eb9677c227783722feda3d5e16bac4ad53`；`server.ts`=`36179c03102bdf10a2e41ac4f83d5542910cd2db91b024c2710eb6f71a91493e`；`server.test.ts`=`2c40b62bcafb4cf7346c6edecac18d0093cd7ebb988a0b51ebef6dfc62943e20`；`DELETION-AND-RETENTION.md`=`60fbb4c2cb0f34b8a062017b9cc2e25f5d3ba5628742a74b96037ef5a3089a3f`。
- 未做与原因：不跑全量门禁（第五波 V4 统一执行）、不自出最终 PASS、不改整卡状态/看板、不建卡、不 git add/commit/push/建分支；不为其它进程的已存在会话修改/删除实现双向同步，刷新只服务新增会话可见性。仅恢复目录但 CLI 登记失败、或 serve/CLI 指向不同 registry 根时仍不能导入，文档保留相应排障边界。
- 被拒命令原文：**无**（没有批准审查拒绝）。只读定位时 PowerShell 下 `rg` 的 `vitest.config.*` / `apps/cli/src/commands/serve*` 字面通配参数报 `os error 123`，猜测的 `packages/application/src/session/ProjectRegistry.ts` 等旧路径报不存在；随后用实际文件路径定位，未计作测试结果。一次查看已结束测试 PID 的 `Get-Process -Id 18360,7880` 报进程不存在；其 Vitest 随后的真实结束结果为 exit 0 / 108 passed，没有结束其它进程。
- 收尾检查：卡原始 30,317 字节与第五波开始前基线逐字节相同，仅追加；四个源码/测试文件的定向 `git diff --check -- apps/local-server/src/server.ts apps/local-server/src/server.test.ts packages/application/src/session/SessionRegistry.ts packages/application/src/session/SessionRegistry.test.ts` exit 0。首次复合只读检查最后的原始命令 `Get-NetTCPConnection -State Listen -LocalPort 55363 -ErrorAction SilentlyContinue | Measure-Object | Select-Object Count` 因无监听而令 PowerShell 总 exit 为 1（实际输出 `Count=0`，不是产品失败）；随后显式检查 `$v3Listeners = @(Get-NetTCPConnection -State Listen -LocalPort 55363 -ErrorAction SilentlyContinue); Write-Output ('listeners=' + $v3Listeners.Count); if ($v3Listeners.Count -ne 0) { exit 1 }; exit 0` 得 `listeners=0` / exit 0，基线前缀检查单独执行也 exit 0。

#### 345e 独立复核（2026-10-28）

另起只读 `gpt-6.1-sol` / high 子代理，Fast 关闭，按第五波 §1 执行。结论原文：**Conclusion: V3 PASS. No blocking findings.** 复核覆盖定位、仅新增合并、SQL 增量投影、删除事务不变、文档与追加范围。独立 `node node_modules/vitest/vitest.mjs run packages/application/src/session/SessionRegistry.test.ts apps/local-server/src/server.test.ts`：exit 0，2 文件 / 108 passed（69.25s），原始日志 `%TEMP%/vessel-wave5-v3-review-focused.log`。

复核者另建隔离夹具重放真实 dist 证明：`node %TEMP%/vessel-wave5-v3-review-proof-lRk4iT/proof.mjs` exit 0；serve PID 21616 持续运行，独立 CLI restore PID 10036 exit 0，第一次 GET 中恢复会话出现一次，recordCount=14 / totalTokens=120，重复 GET 不重复；journal/快照/日志未变、无新 lease，端口 59151 释放。原始 `proof.json` 同目录。复核 `git diff --check` 四个源码/测试文件 exit 0；trash.ts 与 CLI 哈希同第五波基线，去掉 V3 GET 的增量调用即可还原 server.ts 基线哈希。五个 artifact 哈希与卡内相符，卡原始 30,317 字节前缀保留。

复核者没有修改仓库、Git 写操作、Agent CLI、建卡或全量门禁。被拒命令：无。辅助只读 rg 使用字面通配路径 `packages/memory/src/index*` 报 os error 123，随后按真实路径读取。边界仍为仅同步新增，其他进程修改/删除不双向同步；不同 registry 根或 CLI 登记失败仍不能自动导入。

#### 345e 协调者验收（2026-10-28，独立复跑 + 自建真实进程）

- 代码我读过：`refreshAddedSessions()` 按字节偏移增量读 registry journal（`record.type === 'registry/session'` 逐字段校验、墓碑 `metadata === null` 跳过、只消费完整行），只把「内存里没有且最终不是墓碑」的 id 并入 `sessions`/topic 索引，并对已开启的 SQL 索引只投影新增；`GET /api/sessions` 在 `listIndexed` 前 `await` 它。已有会话对象与 controller 保留，没有重建、没有 journal 写入、没有快照写入；`trash.ts` 与 345c 删除事务未动。改动落在交接单允许的文件内。
- 我自己的复跑（日志 `%TEMP%\opencode\wave5\`）：`vitest run packages/application` **36 文件 / 325 passed + 3 skipped**；`vitest run apps/local-server` **27 文件 / 317 passed**；`vitest run apps/cli` **65 文件 / 782 passed**；`tsc -b tsconfig.json` 与 `tsc -p tsconfig.test.json --noEmit` 均 exit 0。全量门禁同一份代码上 17 步全绿。
- 真实进程我自己另起了一份（复制自实现者的 `proof.mjs` 到 `%TEMP%\opencode\wave5\v3-proof\`，隔离 `HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`VESSEL_*` 根，`VESSEL_TRASH_TTL_DAYS=0`，端口由系统临时分配 → **60286**）：`node apps/cli/dist/cli.js serve` PID **23000**，全程 `origPid === finalPid === 23000`、`exitCode === null`；POST mock 会话 + turn → GET 可见 → DELETE 200 → GET 不含被删 id → 独立 `trash restore`（PID **16352**，exit 0）→ **第一次** `GET /api/sessions` 即返回 `sess_1793195247393_e89e54dc` 恰好 1 次、`recordCount=14`，另一活会话仍在；重复 GET 仍 1 次。GET 前后 journal 与 `sessions.json` 的 SHA-256 未变、未生成 `.lease`；收尾 SIGTERM 后同一端口可重新 bind（`portAvailableAfterStop=true`）。
- 结论：**345e 验收通过，卡 345 整卡可收**。边界照旧：只同步新增会话；其它进程的修改/删除不双向同步；serve 与 CLI 指向不同 registry 根、或 CLI 登记失败时仍不会自动导入。

