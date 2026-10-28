# 任务卡 359: `vessel daemon start` 构造期必崩（mesh identity 读到未初始化的 info）

- Status: 待执行（2026-10-28 协调者实测于 HEAD `324cc7d`：`vessel daemon start` 在任何机器上都无法 ready）
- PDW task: none
- 前置：卡 176 的「真实 detached 存活」验收被本缺陷阻断，修完才能验
- 发现方式：协调者子代理按卡 176 的验收步骤在隔离 TEMP 根里真跑 `vessel daemon start`，daemon 子进程启动即退出

## 1. Goal

让 `vessel daemon start` 真的能起来：进程变为 ready、写出 `daemon.json`、能接受带 Bearer 的请求，并且**启动它的终端关闭后仍存活**。

## 2. 症状与根因（已定位，两个独立缺陷）

### 2.1 构造期必抛 `mesh identity must match daemon`（主因，平台无关）

- `apps/local-server/src/server.ts:297` 在**构造时**校验：`opts.mesh.local.nodeId !== opts.daemon.status().instanceId` 就抛 `mesh identity must match daemon`。
- `apps/cli/src/daemon/daemonCommands.ts:76` 声明 `let info: DaemonInfo;`，`:89` 传入 `status: () => ({ ...info, uptimeSeconds: …, memoryBytes: … })`，而 `info` 要到 `:102`（`await server.listen()` **之后**）才赋值。
- 于是构造期 `info` 是 `undefined`，`status().instanceId` 恒为 `undefined`，与 `mesh.local.nodeId`（`instanceId`）不等 → 必抛。
- 因果对照（协调者子代理实测，`%TEMP%\vessel-176-c4b7e0a1\mesh-check.log`）：`status: () => ({})` 抛；`status: () => ({ instanceId })` 不抛；不传 daemon 选项不抛。
- 为什么测试没抓到：`daemonCommands` 的测试都 mock 了 `daemonRuntime.server`，没有任何用例用**真实** `createVesselServer` 构造带 `daemon` 的选项。

### 2.2 `Set-Acl` 依赖调用方的 `PSModulePath`（环境侧，本机必现）

- `apps/local-server/src/daemon/daemonLifecycle.ts:55-58` 用 `powershell.exe`（Windows PowerShell 5.1）执行 `Set-Acl`。
- 从 pwsh 7 启动时，子进程继承 pwsh 7 的 `PSModulePath`，5.1 会把 `Microsoft.PowerShell.Security` 解析到 PS7 目录 → `CommandNotFoundException: Set-Acl` → `daemon start` 直接 exit 1，报 `Command failed: powershell.exe … -EncodedCommand …`。
- 实测矩阵：不重定向任何变量也失败；把 `PSModulePath` 钉回 5.1 经典值（`C:\Program Files\WindowsPowerShell\Modules;C:\WINDOWS\system32\WindowsPowerShell\v1.0\Modules`）后同一调用成功。机器级与用户级 `PSModulePath` 是干净的，所以只有「从 pwsh 7 里启动」才触发。
- 这条是本机 harness 的常态（AGENTS 规定 shell 跑 pwsh 7），不修就永远撞。

## 3. 要做

1. 修 2.1：让构造期能拿到实例身份。允许的两种做法（择一，报告写明理由）：
   - 把 `info` 的身份字段（至少 `instanceId`）在 `createVesselServer` 之前就确定并传进去；或
   - 让 `daemon.status()` 在 `info` 未就绪时回落到 `{ instanceId }`，构造期只比较身份、不依赖完整 info。
   **不要**为了过校验而放宽 `server.ts:297` 的比较（那行是防止 mesh 与 daemon 配错对的守卫）。
2. 修 2.2：`Set-Acl` 调用不得依赖调用方 `PSModulePath`。可选：给子进程显式传干净的 `PSModulePath`、改用 `pwsh -NoProfile`、或改用 `icacls`。报告写明选了哪个以及为什么。
3. 补回归测试（关键）：
   - 用**真实** `createVesselServer({ daemon, mesh, authToken, port: 0 })` 构造一次，断言不抛（现状必红，这正是回归点）；
   - 断言 `daemon.status()` 在 `info` 未就绪时返回的 `instanceId` 与 `mesh.local.nodeId` 相同；
   - 2.2 的行为用一个不依赖机器 `PSModulePath` 的断言覆盖（至少断言传给子进程的环境里 `PSModulePath` 是显式设的，或改用不需要模块的调用）。
4. 真机证明一次（协调者已在 `%TEMP%` 留了可复用脚本，可参考不一定照抄）：
   - 隔离根下 `vessel daemon start --port <空闲端口>` → ready、`daemon.json` 有 pid；
   - 杀掉启动用的 shell 进程，等 2–3 秒，新进程 `daemon status --json` 仍是**同一个 pid** 且 uptime 增长；
   - `/api/health` 200；受保护端点不带 Bearer 401、带 Bearer 非 401；
   - `daemon stop` 后进程消失、端口监听数为 0。

## 4. Acceptance

- A1 `vessel daemon start` 在隔离 TEMP 根下能 ready 并在 `daemon.json` 写出 pid。
- A2 杀掉启动 shell 后：同一 pid 存活、uptime 增长、`/api/health` 200、401/非 401 的行为符合预期。
- A3 新增的真实构造回归用例在**修复前红、修复后绿**，并把修复前的红保留为证据。
- A4 从 pwsh 7 启动也能成功（不依赖调用方 `PSModulePath`）。
- A5 `vessel daemon stop` 后进程消失、端口监听数 0。
- A6 `node node_modules/vitest/vitest.mjs run apps/local-server apps/cli` 与 `tsc -b tsconfig.json`、`tsc -p tsconfig.test.json --noEmit` 均 exit 0。

## 5. Blast Radius

`apps/cli/src/daemon/**`（`daemonCommands.ts` 为主）、`apps/local-server/src/server.ts`（**仅**该身份校验与 `daemon` 选项的接法）、`apps/local-server/src/daemon/daemonLifecycle.ts`、上述对应测试。不碰 `packages/core`、不改 trash/保留语义、不改 Web。

## 6. Expected Evidence

- 修复前后的回归用例输出（红 → 绿），原文保留；
- 真机五步的 pid/uptime/HTTP 状态码与端口计数；
- `%TEMP%` 下的日志路径清单；
- 被拒/失败命令原文（如有）。

## 7. Result

待执行。发现过程与机器证据在卡 176 的 2026-10-28 段；协调者已确认这不是环境问题而是代码缺陷（构造期读到未初始化的 `info`），同一 HEAD 上任何机器都会复现。
