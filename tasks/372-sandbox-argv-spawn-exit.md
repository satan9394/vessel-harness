# 任务卡 372: 把沙箱的任意 argv 出口拆成独立 spawn 点（CodeQL #15/#16）

- Status: 执行中（2026-10-31）
- PDW task: none
- 来源：卡 371 的验收发现。卡 371 的「去掉 `runCommand` 的 `shell` 键」对 #15/#16 无效，原因已定位（见
  `evidence/sessions/2026-10-31-codeql-seven/codeql-rescan-2026-10-31.md`）：CodeQL 对 `spawn` 的
  `isIndirectCommandArgument` 判定只看「可执行文件是不是 `cmd.exe /c` / `sh -c`」，不看 `shell` 选项。
  沙箱的 Windows 逃逸探针用 argv 跑 `cmd.exe /c`，与 `Worktree` 共用同一个 `runCommand` 节点，于是该节点整体
  被判为「间接 shell 执行」，`Worktree` 的 `path.resolve(...)` 就成了「拼 shell 命令的路径」。

## 1. 决定

- 新增第三个、也是唯一一个「执行调用方给的任意可执行文件 + argv」的派生出口
  `runDirectedCommand(command, args, opts)`，与 `runCommand`（内部已知程序 + 已知 argv）、
  `runShellCommand`（整条命令行）并列，三者各自持有自己的 `spawn(...)` 调用点。
- `PlatformSandboxRunner` 的默认 `run` 改为 `runDirectedCommand`；`WindowsRestrictedRunner` 继承它
  （它拿的是同一个注入值）。`runCommand` 的调用方只剩「已知程序」：`Worktree`（git）、POSIX 的
  `bwrap`/`sandbox-exec` 探测与包装、以及测试里的 `process.execPath`/`/usr/bin/sandbox-exec`。
- **不做**：不在 `runCommand` 上加 `shell: false` 之类假装修；不改 `Worktree.ts`；不给 `spawn` 加变量间接
  以躲分析；不删/跳过任何测试；不改沙箱行为（`cmd.exe /c` 仍必须能跑，逃逸探针不能弱化）。

## 2. Goal

`runCommand` 的 spawn 节点不再有 `cmd.exe /c` / `sh -c` 调用方，从而 #15/#16 在重扫时消失；沙箱仍按原语义
执行任意 argv（含 `cmd.exe /c`）。

## 3. Acceptance

- A1 `runDirectedCommand` 与 `runCommand` 语义一致（同样拒绝 `opts.shell`、同样走 `supervise`），新增一条
  「`runDirectedCommand` 传 `shell:true` 会 reject」用例。
- A2 沙箱执行路径不变：`Sandbox.run` / `PlatformSandboxRunner.execute` / `WindowsRestrictedRunner` 的
  shell 与 argv 语义、隔离与审计事件都不变；相关测试全绿。
- A3 本地用与 GitHub 相同的工具链（CodeQL 2.27.3 + `javascript-queries` 2.4.8）跑
  `Security/CWE-078/UnsafeShellCommandConstruction.ql`，`Worktree.ts` 的两条 `path concatenation` 结果消失。
- A4 `npx tsc -b`、`npm run typecheck:tests`、全量 `scripts/gate-batched.ps1` 17/17 exit 0。
- A5 推分支重扫，确认 #15/#16 在 PR head 上消失；`#22`（warning）是否仍在另记，它属有意边界。

## 4. Blast Radius

`packages/runtime/src/process/Process.ts`、`packages/runtime/src/index.ts`（`export *` 已覆盖，无需改）、
`packages/runtime/src/process/Process.test.ts`、`packages/tools/src/execution/sandbox/platformSandbox.ts`、
`packages/tools/src/execution/sandbox/windowsRestricted.ts`（同类「任意 argv」执行器，默认值一并改）及其测试。
**禁止**改 `packages/tools/src/git/Worktree.ts`、`packages/tools/src/mcp/McpClient.ts`、
`packages/core`、`apps/web`、CI 配置。

## 5. Result

待执行。
