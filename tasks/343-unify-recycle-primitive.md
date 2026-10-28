# 任务卡 343: 回收原语统一（四份拷贝收成一份）

- Status: 已完成（2026-10-26，协调者复跑门禁验收；代码由越界的 341 任务写成，独立复核任务两次 blocked 未跑成，见 §7）
- PDW task: 20261027060836-f98021（review 版，blocked ×2）

## 1. Goal

把仓库里四份各自实现的「Windows SendToRecycleBin / macOS Finder / Linux gio trash」收成一个可测的原语，后续 344/345 才有唯一入口可接。

现在的位置：`apps/local-server/src/daemon/daemonLifecycle.ts:73`（`recycleDaemonPath`，会话删除在用）、`packages/runtime/src/sandbox/backend/isolated-directory.ts:43`、`apps/cli/src/migrate.ts:157`、`packages/agents/src/external/ExternalAgentRuntime.ts:714`。四份的引号转义、平台分支、失败语义各不相同，其中至少两份失败时静默吞掉。

## 2. 落点

`packages/shared/src/deletion/recycle.ts`（先例：`packages/shared/src/vesselHome.ts` 也是 shared 里的实现）。**不放 `packages/core`**：core 只依赖 shared 的类型，不引入 spawn。

导出：

```ts
export type RecycleResult =
  | { ok: true; target: string }
  | { ok: false; reason: 'unsupported-platform' | 'not-found' | 'failed'; detail: string };
export async function recyclePath(target: string, opts?: { run?: SpawnLike }): Promise<RecycleResult>;
```

- 平台：win32 → PowerShell + `Microsoft.VisualBasic.FileIO.FileSystem`（目录用 `DeleteDirectory`、文件用 `DeleteFile`，单引号转义为 `''`）；darwin → `osascript` Finder；其它 → `gio trash --`。
- 单引号、换行、`$`、反引号出现在路径里必须仍然正确（现有四份里有两份没转义 `$`）。
- 不存在即 `not-found`（幂等），不抛。
- 允许注入 spawn 以便单测，不 mock 真实回收站。

## 3. Not Doing

- 不改任何调用方的业务语义：迁移完成后四处行为与现在等价（失败时仍然是 warn / 拒绝，按调用方现状）。
- 不做暂存区（那是 345 的事），不引入 TTL。
- 不新增依赖。

## 4. Acceptance

1. 四处调用点全部改为调用 `recyclePath`，仓库内不再有第二份 `SendToRecycleBin` 字面（`grep` 只应命中新原语与文档）。
2. 单测覆盖：win32/darwin/linux 三条命令形态、路径含单引号与 `$`、目录与文件分支、目标不存在、子进程非零退出、spawn 抛错。全部用注入的假 spawn，不触碰真实回收站。
3. 既有相关测试不回归：`apps/local-server`（含 daemon 回收）、`apps/cli` 的 migrate、`packages/agents` 的 external runtime、`packages/runtime` 的 sandbox。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`scripts/gate-batched.ps1` 全绿。

## 5. Blast Radius

新增 `packages/shared/src/deletion/`；改四个调用点与其测试；四处对应的 `package.json` 依赖与 `tsconfig` references（runtime → shared 已有，无需新增）。

## 6. Expected Evidence

`grep SendToRecycleBin` 结果、单测名单与断言摘要、四段测试计数、门禁退出码。

## 7. Result

已完成（2026-10-26），门禁 17 步全绿。

新增 `packages/shared/src/deletion/recycle.ts`：`recyclePath(target, { run?, platform? })`，返回 `ok:true` 或 `ok:false` + `reason: unsupported-platform | not-found | failed`。win32 按目录/文件分 `DeleteDirectory` / `DeleteFile`，darwin 走 Finder，其它 Unix 走 `gio trash --`；PowerShell 字面量只把 `'` 双写（`$` 与反引号在单引号内本就字面），AppleScript 转义 `\` 与 `"`；符号链接拒绝、不存在即 `not-found`、子进程非零或抛错都归 `failed`。

四处调用点已收口：`daemonLifecycle.recycleDaemonPath`、`migrate.defaultRecycle`（保留非 win32 抛 `RecycleUnsupportedError` 的语义）、`isolated-directory.dispose`（仍幂等、不抛）、`ExternalAgentRuntime.moveToSystemTrash`（保留 Linux 的 XDG trash 兜底，删除本地 `runExecutable`）。

证据：
- 单测 `packages/shared/src/deletion/recycle.test.ts`：11 条（10 通过 + 1 条符号链接用例在 Windows 跳过）。
- 相关四段测试：`migrate` / `daemonLifecycle` / `daemonRecycle.windows` / `Sandbox` / `recycle` 共 58 条，56 通过 2 跳过。
- `npx tsc -b` exit 0；`npm run typecheck:tests` exit 0。
- 全量门禁 `scripts/gate-batched.ps1`：17 步全部 exit 0（shared+core 277 / llm 336 / behavior+context 164 / tools+policy 327 / runtime+memory 206 / skills+agents 194 / telemetry+engine 221 / application 277 / cli 772 / local-server 298 / benchmarks 527 / root-index 14 / web-root 519，三处 tsc 干净，离线 conformance 25/25、$0）。
- `grep SendToRecycleBin` 在源码里只剩新原语与其单测；`apps/` 下仅剩通知功能用的 `osascript`（与本卡无关）。`.dsh-mission/publish/dist/cli.js` 是旧的发布产物，未重建。

**执行来源与边界**：本卡由一个「PDW 迭代」会话越界执行（原计划应由协调者按卡派单），代码**未提交**。撤回方式见 `HANDOFF.md` §0「待用户执行」：5 个源文件 `git checkout --`、`packages/shared/src/deletion/` 进回收站、本卡与 `tasks/README` 两行改回「待执行」。

### 协调者复核（2026-10-26）

- 代码来历：本卡实现由卡 341 的任务 20261027055203-e382e8 在越界状态写成（runner 判 out-of-scope），不是本卡自己派出来的 develop 轮；所以「实现者自验」这一段只作参考，验收以协调者复跑为准。
- 独立复核未跑成：20261027060836-f98021（review 契约）两次 blocked，原因都是我的契约与既有事实冲突（A4 要求 grep SendToRecycleBin 只剩原语，但仓库里有已跟踪的旧发布产物 .dsh-mission/publish/dist/cli.js 与大量历史；A5 禁止真调回收站，但既有 daemonRecycle.windows.test.ts 本来就真回收自建临时目录）。因此本卡**没有**经过 review 角色的独立判定，这一点如实记录，不当成已复核。
- 协调者实测（本机，2026-10-26）：scripts/gate-batched.ps1 17 步中 16 步 exit 0，local-server 因 profileParity.test.ts > delete returns the same ordered fields（xpected 2 to be 0）挂一次；单独重跑该文件 4/4 通过，整段重跑 26 文件 / 298 通过、exit 0。判定为与本次改动无关的偶发，未在本卡修，已在 HANDOFF 记一笔。
- 与实现者自述的数字对照一致：shared+core 31 文件 / 276 通过 + 1 跳过（277）、runtime+memory 206（205+1 跳过）、application 277（275+2 跳过）、web 519、离线 conformance 25/25；三处 tsc 与 	ypecheck:tests 均 exit 0。
- 结论：原语与四处迁移按卡面成立，可以接 344/345；缺的是独立复核，若后续有高风险改动再补 audit。
