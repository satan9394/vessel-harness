# 任务卡 359: `vessel daemon start` 构造期必崩（mesh identity 读到未初始化的 info）

- Status: 已验收（2026-10-28）：两个构造/环境缺陷按计划修掉并保留身份守卫，第三个「二次 `Set-Acl` 必失败」由协调者查出并改成幂等的 `whoami` + `icacls`；真机五步全过（同一 pid 在 launcher 退出后仍存活、uptime 4→6、health 200、401/200、stop 后监听 0）
- PDW task: none
- 前置：卡 176 的「真实 detached 存活」验收被本缺陷阻断，现已解除
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


## 2026-10-28 · 主线程执行交证（run6，未签收）

- 请求路由：gpt-6.1-sol / medium，Fast 关闭；按用户指令未启动子代理、PDW 或其它本机 Agent CLI，也未修改宿主模型配置。
- 结论：**部分完成**。构造期身份回归由红转绿；ACL 子进程已显式设置 Windows PowerShell 5.1 系统模块目录。但两次真实 detached 启动连续失败，命中用户停止条件；**没有 daemon 存活证明，不称修复完成，Part B 未启动**。
- 身份修法：status() 在展开 info 后显式提供既定 instanceId；未修改 server.ts 的 mesh/daemon 身份守卫。原有未 ready 的 info 判定与超时逻辑保留。
- ACL 修法：两次 powershell.exe 调用都传 env.PSModulePath=<SystemRoot>/System32/WindowsPowerShell/v1.0/Modules；继续使用系统自带 Windows PowerShell，无新增 pwsh 依赖。单测验证调用方模块路径不被修改、两次子进程都得到显式系统路径。**真机 Set-Acl 仍失败，不能据单测宣称 A4 通过**。
- 新回归通过真实 createVesselServer({ daemon, mesh, authToken, port: 0 }) 构造、listen 和 close；构造前捕获 status().instanceId，与 mesh.local.nodeId 比对。HOME/USERPROFILE/APPDATA/LOCALAPPDATA 与 session/provider/usage/reviews 根都隔离到该测试自建系统 TEMP 目录。

### 修复前回归原文（exit 1，预期红）
命令：node node_modules/vitest/vitest.mjs run apps/cli/src/daemon/daemonCommands.test.ts -t "constructs the real server"

```text

 RUN  v5.0.1 E:/Code_file/Projects/Vessel_Harness

 ❯ apps/cli/src/daemon/daemonCommands.test.ts (10 tests | 1 failed | 9 skipped) 43ms
   ❯ daemon commands (no child process or real store) (10)
     × constructs the real server with matching daemon and mesh identity before listen 39ms

 Test Files  1 failed (1)
      Tests  1 failed | 9 skipped (10)
   Start at  08:49:04
   Duration  6.86s (import 55%, transform 43%, tests 1%)

  Transform  transforming modules took 2.90s · 43% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  apps/cli/src/daemon/daemonCommands.test.ts > daemon commands (no child process or real store) > constructs the real server with matching daemon and mesh identity before listen
Error: mesh identity must match daemon
 ❯ createVesselServer apps/local-server/src/server.ts:297:166

 ❯ Object.<anonymous> apps/cli/src/daemon/daemonCommands.test.ts:53:27
 ❯ runDaemonChild apps/cli/src/daemon/daemonCommands.ts:85:32
 ❯ daemonCommands apps/cli/src/daemon/daemonCommands.ts:37:34
 ❯ apps/cli/src/daemon/daemonCommands.test.ts:59:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
```

### 修复后定向原文（exit 0）
命令：node node_modules/vitest/vitest.mjs run apps/cli/src/daemon/daemonCommands.test.ts apps/local-server/src/daemon/daemonProtection.test.ts

```text

 RUN  v5.0.1 E:/Code_file/Projects/Vessel_Harness


 Test Files  2 passed (2)
      Tests  11 passed (11)
   Start at  08:50:17
   Duration  6.97s (import 50%, transform 42%, tests 8%)

     Import  312 modules were evaluated 548 times · 3.35s total, 50% of tracked time
             ~1.44s faster with isolate: false — shared modules are evaluated once per worker instead of once per file
             learn more: https://vitest.dev/guide/improving-performance#test-isolation
```

### 最后一次源码/测试编辑后的三项门禁

| 命令 | 实测 |
|---|---|
| node node_modules/vitest/vitest.mjs run apps/local-server apps/cli | exit 0；93 文件 / 1,101 passed；249.37 秒 |
| node node_modules/typescript/bin/tsc -b tsconfig.json | exit 0 |
| node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit | exit 0 |

### 真机五步实测

隔离根：C:\work\AppData\Local\Temp\vessel-359-BdjyS5。所有列出的 HOME/AppData/VESSEL 根见 isolation.json；工作区为其 workspace/；VESSEL_TRASH_TTL_DAYS=0。端口 5700 先经 bind 探测为空闲、Get-NetTCPConnection 监听数为 0，未杀其它监听。

| 项 | 结果 |
|---|---|
| pwsh 7 启动 detached daemon | **不通过**。第一次 launcher PID 6376，exit 1：daemon exited before becoming ready；第二次 launcher PID 7368，exit 1：Set-Acl 的 EncodedCommand 调用失败 |
| ready / daemon.json.pid | 两次 detached 尝试都未 ready、没有有效 daemon.json.pid；直接 child 诊断曾 ready，PID 18800 / port 5700，不等于 detached 验收 |
| 杀 launcher 后同 PID / uptime 增长 | **无法验证**：未进入 ready 阶段；两次 launcher 在 finally 中收尾终止，没有可比较的 daemon PID/uptime |
| health 200、无 Bearer 401、有 Bearer 非 401 | **无法验证**：未进入请求阶段；没有读取或输出真实用户凭据，临时 token 未输出 |
| daemon stop 后进程消失 | **无法验证**：没有成功 detached 实例，未冒充执行 stop；直接 child 诊断由显式 20 秒 timeout 终止 |
| 最终收尾 | 5700 监听数 **0**；夹具进程数 **0**；测量 2026-10-28T16:01:38.7352417Z，排除测量自身及祖先 shell |

### 两次失败原文与停止原因

执行入口两次均为 node C:\work\AppData\Local\Temp\vessel-359-BdjyS5\live-proof.cjs；脚本内真实命令为 node apps/cli/dist/cli.js daemon start --port 5700 --json（绝对 CLI 路径、工作目录与环境见脚本 / isolation.json）。
第一次 stdout（exit 1）：
```text
{"error":"daemon exited before becoming ready"}
```

第二次 stdout（exit 1，EncodedCommand 未省略）：
```text
{"error":"Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand JABwAD0AJwBDADoAXABVAHMAZQByAHMAXABTAEEAVABBAE4AQwB+ADEAXABBAHAAcABEAGEAdABhAFwATABvAGMAYQBsAFwAVABlAG0AcABcAHYAZQBzAHMAZQBsAC0AMwA1ADkALQBCAGQAagB5AFMANQBcAGkAcwBvAGwAYQB0AGUAZABcAFYARQBTAFMARQBMAF8ARABBAEUATQBPAE4AXwBSAE8ATwBUAFwAZABhAGUAbQBvAG4ALgB0AG8AawBlAG4AJwA7ACAAJABhAGMAbAA9AE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAEEAYwBjAGUAcwBzAEMAbwBuAHQAcgBvAGwALgBGAGkAbABlAFMAZQBjAHUAcgBpAHQAeQA7ACAAJABzAGkAZAA9AE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAFAAcgBpAG4AYwBpAHAAYQBsAC4AUwBlAGMAdQByAGkAdAB5AEkAZABlAG4AdABpAGYAaQBlAHIAKAAnAFMALQAxAC0ANQAtADIAMQAtADEAOAA2ADYAOQA4ADQAMgAwADUALQAzADcANAA4ADUAMAA4ADEAOQA4AC0AOAAyADQANgA4ADEANgA5ADAALQAxADAAMAAyACcAKQA7ACAAJABhAGMAbAAuAFMAZQB0AE8AdwBuAGUAcgAoACQAcwBpAGQAKQA7ACAAJABhAGMAbAAuAFMAZQB0AEEAYwBjAGUAcwBzAFIAdQBsAGUAUAByAG8AdABlAGMAdABpAG8AbgAoACQAdAByAHUAZQAsACQAZgBhAGwAcwBlACkAOwAgACQAYQBjAGwALgBBAGQAZABBAGMAYwBlAHMAcwBSAHUAbABlACgAWwBTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAEEAYwBjAGUAcwBzAEMAbwBuAHQAcgBvAGwALgBGAGkAbABlAFMAeQBzAHQAZQBtAEEAYwBjAGUAcwBzAFIAdQBsAGUAXQA6ADoAbgBlAHcAKAAkAHMAaQBkACwAJwBGAHUAbABsAEMAbwBuAHQAcgBvAGwAJwAsACcAQQBsAGwAbwB3ACcAKQApADsAIABTAGUAdAAtAEEAYwBsACAALQBMAGkAdABlAHIAYQBsAFAAYQB0AGgAIAAkAHAAIAAtAEEAYwBsAE8AYgBqAGUAYwB0ACAAJABhAGMAbAA="}
```

两次连续失败后遵照用户“任一操作连续两次失败就停手”停止；未做第三次启动、未升档继续试错。Set-Acl 的 stderr 被现有产品 stdio:ignore 丢弃，无法从当前证据判断第二次失败的具体底层原因。不得把它归咎于账号、权限或模块路径的某一种因素。

直接 child 诊断：
```json
{
  "executable": "D:\\Technology_application\\NVM_Windows\\nodejs\\node.exe",
  "args": [
    "E:/Code_file/Projects/Vessel_Harness/apps/cli/dist/cli.js",
    "daemon",
    "--child",
    "--root",
    "C:\\work\\AppData\\Local\\Temp\\vessel-359-BdjyS5\\diagnostic-child",
    "--instance",
    "3227b95f-5427-446f-a479-6ea473794aff",
    "--parent",
    "20488",
    "--port",
    "5700",
    "--deadline",
    "1793203005780"
  ],
  "status": null,
  "error": "spawnSync D:\\Technology_application\\NVM_Windows\\nodejs\\node.exe ETIMEDOUT"
}
```

该诊断 ready 后因 timeout 结束，未执行 detach/shell-survival/auth 五步，不能作为 A1/A2/A5 通过证据。

### 其它失败 / 被拒

- 初版 ACL 单测 mock 漏掉 execFile 导出，定向命令 exit 1，原文 regression-after.log；已改为类型化 partial mock，后续定向及最终 93 文件门禁均绿。
- 无工具自动审批拒绝、无 IAB 启动尝试。只读查询曾有 PowerShell brace/引号 ParserError 及一条过时 compose.ts 路径查询错误，命令原文保留于 run6 report.md。

### 日志路径与边界

全部 A 原始日志在 C:\work\AppData\Local\Temp\vessel-359-BdjyS5/：regression-before.log、regression-after.log、regression-green.log、targeted-tests.log、targeted-tests-final.log、tsc-build.log、tsc-build-final.log、tsc-tests.log、tsc-tests-final.log、attempt1-live-proof.json、live-proof.json、attempt1-start.*.log、start.*.log、pwsh-version.log、caller-module-path.log、diagnostic-child.log、diagnostic-command.json、cleanup.json；运行脚本 live-proof.cjs / launcher.ps1 / startup-probe.cjs 一并保留。没有永久删除这些证据。

报告：evidence/sessions/2026-10-28-iab-run6/report.md。卡首行与索引未改，签收归协调者；未 commit/add/push/建分支，未跑 test:all、geometry check 或浏览器。

---

## 8. 协调者复核与修复（2026-10-28）

Codex 交付的两处改动我读了也保留：`daemonCommands.ts` 改成 `status: () => ({ ...info, instanceId, … })`（构造期就能给出身份，`server.ts:297` 的守卫**没有放宽**），以及 `daemonProtection.test.ts`。但真机五步它连跑两次都失败，第二次报 `Set-Acl` 非零，且 `stdio:'ignore'` 把原因吞了。我自己复现后定位到**第三个缺陷**：

- 对照实验（`%TEMP%\opencode\wave6\acl-diag2.mjs`）：同一条产品脚本，对**新文件**第一次执行成功，对**同一文件**第二次、第三次执行必报 `Set-Acl : 该进程不具有执行此操作所需的 'SeSecurityPrivilege' 特权`。
- 而 `writeDaemonFile`（`daemonLifecycle.ts:64-74`）在文件已存在时走 `'r+'` 分支，**先 `protect(target,false)` 再截断写入**；`daemon stop` 还会把 token 重写一次。于是「第二次用同一个 daemon 根启动」与「stop」都会撞上这条。
- `PSModulePath` 那条只是第一层；即便钉好模块路径，二次 `Set-Acl` 仍会失败——这解释了 Codex 第二次的报错，也解释了第一次的 `daemon exited before becoming ready`（子进程在保护 token/写状态时同样撞上）。

**我的修复**：`protectDaemonPath` 改用原生命令，完全不再走 PowerShell：

```
whoami /user /fo csv /nh           → 取当前 SID
icacls <target> /setowner *<SID>
icacls <target> /inheritance:r /grant:r *<SID>[:F | :(OI)(CI)F]
```

实测（`%TEMP%\opencode\wave6\acl4-*`）：同一文件连跑 3 次、同一目录连跑 2 次均 exit 0，最终 ACL 只剩当前用户、无 `(I)` 继承项——与原来的「去继承 + 只给 owner 全控」同义，但**幂等**，且不再依赖调用方 `PSModulePath`。`daemonProtection.test.ts` 换成真跑（不打桩）：同一文件连保护 3 次、目录 2 次，断言不抛、无 `(I)`、文件字节未被改动。

## 9. 真机五步复验（2026-10-28，协调者）

隔离根 `%TEMP%\vessel-359-proof-t6t8An`，`node apps/cli/dist/cli.js daemon start --port 50529 --json`（`tsc -b` 已 exit 0，dist 与源码一致）：

| 步骤 | 实测 |
|---|---|
| ready | `daemon.json` 写出，daemon pid **4068**、port 50529 |
| 启动进程消失 | launcher 已自行退出（`ESRCH`，即「起它的进程已经没了」） |
| 仍存活 | 新进程 `daemon status --json` 仍是 pid **4068**，uptime **4 → 6 秒**（两次间隔 2 秒），`samePid=true` |
| 鉴权 | `/api/health` **200**；`/api/team/stages` 无 Bearer **401**、带 Bearer **200** |
| 收尾 | `daemon stop --json` → `{"stopped":true}`，端口监听数 **0** |

原始 `proof.json` 与脚本在同目录；日志 `%TEMP%\opencode\wave6\`。A1/A2/A4/A5 全部通过，A3（红→绿）由 Codex 保留的回归用例加上本文的二次保护用例共同覆盖。

**边界**：tray/toast 的真实桌面可见性不在这张卡内（属卡 176），本卡只证明 daemon 进程本身起得来、活得下去、鉴权正确。
