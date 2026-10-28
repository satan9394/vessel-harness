# 任务卡 344: F6 收口（运行时临时文件的所有权守卫 + 例外落地）

- Status: 已验收（2026-10-27 验收：T2 实现 + 独立复核，协调者独立复跑 engine 17 文件 / 180 passed、session 3 / 24、application 35 / 301（299+2 skipped）、三处 tsc exit 0；core 改动仅 2 行注释）
- 实现方式：交由 Codex 应用执行，指令见 `tasks/prompts/codex-handoff-2026-10-27-deletion-retention.md` 的 T2（`gpt-6.1-sol` / `medium`）
- PDW task: none
- 依据：`docs/DESIGN-DECISIONS.md` 决策点 24、`docs/DELETION-AND-RETENTION.md` §2/§4

## 1. Goal

按决策点 24 的 B 类口径收口 F6：`.lease` 与 engine 临时工作区**不改成回收站**，但要把「谁知道自己在删什么」补上——现在的 `TempDirWorkspaceFactory.dispose` 直接 `fs.rmSync(ws.root, { recursive: true, force: true })`，只信传进来的 `ws.root`，审计 F6 点名的正是这一点。

## 2. 要做的三件事

1. `packages/engine/src/workspace.ts` 的 `TempDirWorkspaceFactory.dispose` 加所有权守卫：只删「由本工厂创建且位于 `os.tmpdir()` 之下、basename 以本工厂 prefix 开头」的目录；不满足则**不删**、返回结构化拒绝（`{ disposed: false, reason: 'not-owned' }`）+ warn，绝不静默。
2. `GitWorktreeWorkspaceFactory.dispose` 保持 `git worktree remove`，但在注释与 `docs/DELETION-AND-RETENTION.md` 里登记为「git 托管删除」，并补一条测试断言 dispose 只调用注入的 git runner、项目自己不发删除命令。
3. `packages/core/src/session/Session.ts:113,278` 的 `.lease` 删除**保持不变**（B 类，允许直接删），补一行注释指向决策点 24，并补/保留两条测试：陈旧租约能被接管、`close()` 之后同进程可重新打开。

## 3. Not Doing

- 不给 core 加回收依赖、不改 `Session` 的公开签名、不把 `.lease` 改进回收站或暂存区。
- 不改 `runControl`/`AgentLoop` 的任何租约语义；fail-closed 行为不变。
- 不顺手重构 engine 的 workspace 工厂接口。

## 4. Acceptance

1. 传入一个不在 `os.tmpdir()` 之下、或 basename 不匹配 prefix 的 `ws.root` 时，`dispose` 不删除任何东西，返回 `not-owned` 并 warn；真实临时目录仍能正常清理。
2. 新增/保留的测试三条全过：非我所有拒绝、正常临时目录清理、陈旧租约接管 + 关闭后重开。
3. `packages/core` 的改动只允许注释（`git diff --stat -- packages/core` 的插入行必须全部是注释/空行，且无删除行）——若必须动逻辑，停下报 blocker。
4. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`scripts/gate-batched.ps1` 全绿。

## 5. Blast Radius

`packages/engine/src/workspace.ts` 与其测试、`packages/core/src/session/Session.ts`（仅注释）与既有测试、`docs/DELETION-AND-RETENTION.md` §4。

## 6. Expected Evidence

拒绝路径的实际返回值与 warn 文本、三条测试名、`git diff` 的 core 段落、门禁退出码。

## 7. Result

- Implementation route: `gpt-6.1-sol` / `medium`, host auxiliary mode; T2 cross-package ownership/security work; Fast/Ultra off.
- Added resolved temp-root containment and factory-prefix checks; refusal warns and returns `{ disposed: false, reason: 'not-owned' }`, successful temp cleanup returns `{ disposed: true }`.
- Added repository-root and mismatched-temp-prefix refusal tests; retained positive cleanup and lease coverage; git-runner test now verifies the directory contents remain when the injected runner performs no removal.
- `git diff --stat -- packages/core`: exit 0, `packages/core/src/session/Session.ts | 2 ++`; 1 file changed, 2 insertions, comments only, no deletions or logic changes.
- User explicitly authorized the sole additional file exception: `packages/engine/src/LoopEngine.ts`, one type line only. `git diff -- packages/engine/src/LoopEngine.ts` exit 0 confirms `disposeWorkspace?: (ws: Workspace) => Promise<void>;` changed to `disposeWorkspace?: (ws: Workspace) => Promise<void | { disposed: boolean; reason?: string }>;`; no runtime changes.
- Ordered self-checks after the last code edit (2026-10-27):
  - `node node_modules/vitest/vitest.mjs run packages/engine`: exit 0; 17 files, 180 passed.
  - `node node_modules/vitest/vitest.mjs run packages/core/src/session`: exit 0; 3 files, 24 passed (including stale lease reclamation and reopen after close).
  - `node node_modules/vitest/vitest.mjs run packages/application`: exit 0; 35 files, 299 passed, 2 skipped.
  - `node node_modules/typescript/bin/tsc -b tsconfig.json`: exit 0, no diagnostics.
  - `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit`: exit 0, no diagnostics.
- Logs: `C:\work\AppData\Local\Temp\vessel-wave1-wVrbzr\t2-{engine,core-session,application,tsc-build,tsc-tests}.log`.
- Not done: full gate (coordinator-owned), application/compose edits (unnecessary), lifecycle-test edits (existing coverage retained), stronger creation registration or realpath/junction ownership checks (outside the final handoff). The implemented guard checks resolved lexical temp-root containment and basename prefix only; it does not prove actual factory creation or resolve intermediate junctions.
- Rejected commands: none. Read-only discovery found stale `apps/cli/src/compose.ts` path (rg error 2) and a PowerShell literal wildcard path (rg error 123); no application/compose edits required.

#### 协调者验收（2026-10-27，独立复跑）

- 代码复核：`workspace.ts` 的守卫是 `path.resolve(root)` 相对 `os.tmpdir()` 的**词法**包含判断（空相对路径、`..`、`..\`、绝对路径一律拒）＋ `basename` 前缀判断；不符合则 `console.warn` 并返回 `{ disposed: false, reason: 'not-owned' }`，命中才 `fs.rmSync`。`GitWorktreeWorkspaceFactory.dispose` 仍只走 `git worktree remove`，新增用例断言注入的假 git runner 不删目录时文件仍在。`packages/core/src/session/Session.ts` 两处 `.lease` 删除各加一行注释，逻辑零改动（`git diff --stat -- packages/core` = 1 文件 / 2 insertions / 0 deletions，两行均以 `//` 开头）。
- 独立复跑（我的命令，日志 `%TEMP%\opencode\wave1-verify\`）：engine exit 0、17 文件 / **180 passed**；core session exit 0、3 文件 / 24 passed；application exit 0、35 文件 / 299 passed + 2 skipped；`tsc -b`、`tsc -p tsconfig.test.json --noEmit`、`tsc -p apps/web/tsconfig.json --noEmit` 全 exit 0。
- `LoopEngine.ts` 授权边界核对：`git diff` 显示新增/删除各 1 行，内容就是那一行类型。`benchmarks/runners` 与 `apps/local-server/goalSeam.ts` 的调用点无需改动，靠放宽后的返回类型通过。
- 边界（保留，不当已解决）：守卫只做词法判断，不做 realpath/junction 解析，也不记录「哪个工厂创建了它」；因此同名前缀的目录在 tmpdir 下仍会被删。这是交接单 T2 的既定范围，要更强保证需另立卡。
