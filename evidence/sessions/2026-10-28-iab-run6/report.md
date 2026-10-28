# 2026-10-28 run6 · 有序执行停止报告

**结论：Part A 部分完成；真实 detached 启动两次连续失败，按用户停止条件结束。Part B 全部无法验证，未启动浏览器。没有任何整卡“已验收”结论。**

执行方式：主线程；用户请求 gpt-6.1-sol / medium、Fast 关闭；无子代理、无本机其它 Agent CLI、无提交/推送/分支。遵循 PDW 的证据/交接边界，按用户显式要求未启动 PDW 工作流。没有调整或额外探测宿主模型。

## 1. 每项判据实测

| 项目 | 结论 | 实测值 / 文件 |
|---|---|---|
| A3 构造回归 | 通过 | 真实 createVesselServer，修复前 mesh identity must match daemon；修复后通过；完整原文见卡 359 与 TEMP regression-before.log / regression-green.log |
| A6 指定测试与类型门禁 | 通过 | 最后一次源码/测试编辑后：93 文件 / 1,101 passed，249.37 秒，exit 0；两项 tsc exit 0 |
| A1 detached ready | 不通过 | 两次 start exit 1；launcher PID 6376 / 7368，未取得 daemon PID |
| A2 shell 死后同 PID / uptime / HTTP | 无法验证 | ready 前失败；pid/uptime/200/401/非401 均无有效读数 |
| A4 pwsh 7 ACL 真机 | 不通过 | 第二次 Set-Acl EncodedCommand 非零；显式 PSModulePath 的单测绿不能替代真机 |
| A5 daemon stop | 无法验证 | 无成功 detached 实例，未执行 stop；收尾监听和夹具进程均为 0 |
| B1 Tab 到第二会话删除 | 无法验证 | 未启动 B；activeElement=null |
| B1 Enter → Cancel 焦点 | 无法验证 | 没有焦点矩形或新截图 |
| B1 Esc → 触发按钮 | 无法验证 | 未操作 |
| B1 再 Enter | 无法验证 | 未操作 |
| B1 Shift+Tab | 无法验证 | 未操作 |
| B1 Enter / 取消与确认路径 | 无法验证 | 未操作 |
| B1 1440×900 整屏 / Console | 无法验证 | screenshot count=0，viewport=null，consoleErrors=null（不是 []） |
| B2 StagedBanner | 无法验证 | 没有 UI 会话、没有同源 POST、没有 roster/routeSnapshot/按钮截图 |
| B2 ≥3 节点状态色与连线 | 无法验证 | 没有运行或截图，不伪造状态 |
| B2 抽屉依赖/300字摘要/产物链接 | 无法验证 | 未操作 |
| B2 Approve & Run 状态转换 / Console | 无法验证 | 未操作，consoleErrors=null |
| B3 继承 B1/B2 | 无法验证 | 没有新的浏览器通过证据 |
| B3 双 Root 全量 | 引用协调者证据 | 卡 179 已载：npm run test:all exit 0；根 333 文件 / 3,694 passed + 8 skipped，web 59 / 528；本次未重跑 |

原始数据：[measurements.json](measurements.json)、[commands.json](commands.json)。历史几何五例通过记录维持原样，未重跑，也未拿来替代键盘或视口。

## 2. dist 新鲜度

Part A 已执行两轮 tsc -b（最后一次在最终测试编辑后 exit 0）。Part B 的 tsc + npm run -w @vessel/web build 尚未启动，因为 A 的真实启动门禁失败；**没有本次 Web dist mtime/asset 引用或“拍的是新 UI”凭据**。未调用 build:clean，未重复 geometry build。

## 3. 端口与进程收尾

仅使用隔离 TEMP workspace，端口 5700 先检查为空闲。两次 launcher 由 live-proof.cjs 的 finally 终止；直接 child 诊断曾 ready（PID 18800、port 5700），随后因显式 20 秒 spawnSync timeout 终止，不能冒充 shell-survival 或 daemon stop。最终 2026-10-28T16:01:38.7352417Z：5700 监听数 **0**、夹具进程数 **0**；见 [cleanup.json](cleanup.json)。未杀用户现有监听，没有打开 B 的 serve、provider 或浏览器。

## 4. 逐条失败 / 被拒命令

没有工具自动审批拒绝，也没有 IAB 调用（不能写成 IAB 不可用）。以下为真实失败与预期红，细节和原始输出保留在 TEMP：

```json
{
  "command": "node node_modules/vitest/vitest.mjs run apps/cli/src/daemon/daemonCommands.test.ts -t \"constructs the real server\"",
  "exit": 1,
  "expected": true,
  "log": "C:\\work\\AppData\\Local\\Temp\\vessel-359-BdjyS5\\regression-before.log"
}
```


```json
{
  "command": "node node_modules/vitest/vitest.mjs run apps/cli/src/daemon/daemonCommands.test.ts apps/local-server/src/daemon/daemonProtection.test.ts",
  "exit": 1,
  "expected": false,
  "log": "C:\\work\\AppData\\Local\\Temp\\vessel-359-BdjyS5\\regression-after.log",
  "reason": "Initial test mock omitted execFile; repaired with a typed partial module mock."
}
```


```json
{
  "command": "node C:\\work\\AppData\\Local\\Temp\\vessel-359-BdjyS5\\live-proof.cjs",
  "attempt": 1,
  "exit": 1,
  "result": {
    "startedAt": "2026-10-28T15:55:34.331Z",
    "portChecks": [
      {
        "port": 5700,
        "free": true
      }
    ],
    "port": 5700,
    "listenersBefore": 0,
    "launcherPid": 6376,
    "error": "Error: daemon start exit 1: {\"error\":\"daemon exited before becoming ready\"}\n",
    "finishedAt": "2026-10-28T15:55:48.794Z"
  }
}
```


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
  "exit": null,
  "error": "spawnSync D:\\Technology_application\\NVM_Windows\\nodejs\\node.exe ETIMEDOUT",
  "reason": "Direct child diagnostic reached ready, then the explicit spawnSync timeout (20 seconds) terminated it; this is not detached survival proof."
}
```


```json
{
  "command": "node C:\\work\\AppData\\Local\\Temp\\vessel-359-BdjyS5\\live-proof.cjs",
  "attempt": 2,
  "exit": 1,
  "result": {
    "startedAt": "2026-10-28T15:58:12.440Z",
    "portChecks": [
      {
        "port": 5700,
        "free": true
      }
    ],
    "port": 5700,
    "listenersBefore": 0,
    "launcherPid": 7368,
    "error": "Error: daemon start exit 1: {\"error\":\"Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand JABwAD0AJwBDADoAXABVAHMAZQByAHMAXABTAEEAVABBAE4AQwB+ADEAXABBAHAAcABEAGEAdABhAFwATABvAGMAYQBsAFwAVABlAG0AcABcAHYAZQBzAHMAZQBsAC0AMwA1ADkALQBCAGQAagB5AFMANQBcAGkAcwBvAGwAYQB0AGUAZABcAFYARQBTAFMARQBMAF8ARABBAEUATQBPAE4AXwBSAE8ATwBUAFwAZABhAGUAbQBvAG4ALgB0AG8AawBlAG4AJwA7ACAAJABhAGMAbAA9AE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAEEAYwBjAGUAcwBzAEMAbwBuAHQAcgBvAGwALgBGAGkAbABlAFMAZQBjAHUAcgBpAHQAeQA7ACAAJABzAGkAZAA9AE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAFAAcgBpAG4AYwBpAHAAYQBsAC4AUwBlAGMAdQByAGkAdAB5AEkAZABlAG4AdABpAGYAaQBlAHIAKAAnAFMALQAxAC0ANQAtADIAMQAtADEAOAA2ADYAOQA4ADQAMgAwADUALQAzADcANAA4ADUAMAA4ADEAOQA4AC0AOAAyADQANgA4ADEANgA5ADAALQAxADAAMAAyACcAKQA7ACAAJABhAGMAbAAuAFMAZQB0AE8AdwBuAGUAcgAoACQAcwBpAGQAKQA7ACAAJABhAGMAbAAuAFMAZQB0AEEAYwBjAGUAcwBzAFIAdQBsAGUAUAByAG8AdABlAGMAdABpAG8AbgAoACQAdAByAHUAZQAsACQAZgBhAGwAcwBlACkAOwAgACQAYQBjAGwALgBBAGQAZABBAGMAYwBlAHMAcwBSAHUAbABlACgAWwBTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAEEAYwBjAGUAcwBzAEMAbwBuAHQAcgBvAGwALgBGAGkAbABlAFMAeQBzAHQAZQBtAEEAYwBjAGUAcwBzAFIAdQBsAGUAXQA6ADoAbgBlAHcAKAAkAHMAaQBkACwAJwBGAHUAbABsAEMAbwBuAHQAcgBvAGwAJwAsACcAQQBsAGwAbwB3ACcAKQApADsAIABTAGUAdAAtAEEAYwBsACAALQBMAGkAdABlAHIAYQBsAFAAYQB0AGgAIAAkAHAAIAAtAEEAYwBsAE8AYgBqAGUAYwB0ACAAJABhAGMAbAA=\"}\n",
    "finishedAt": "2026-10-28T15:58:23.845Z"
  }
}
```

第一次 daemon start stdout：
```text
{"error":"daemon exited before becoming ready"}
```

第二次 daemon start stdout（EncodedCommand 未截断）：
```text
{"error":"Command failed: powershell.exe -NoProfile -NonInteractive -EncodedCommand JABwAD0AJwBDADoAXABVAHMAZQByAHMAXABTAEEAVABBAE4AQwB+ADEAXABBAHAAcABEAGEAdABhAFwATABvAGMAYQBsAFwAVABlAG0AcABcAHYAZQBzAHMAZQBsAC0AMwA1ADkALQBCAGQAagB5AFMANQBcAGkAcwBvAGwAYQB0AGUAZABcAFYARQBTAFMARQBMAF8ARABBAEUATQBPAE4AXwBSAE8ATwBUAFwAZABhAGUAbQBvAG4ALgB0AG8AawBlAG4AJwA7ACAAJABhAGMAbAA9AE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAEEAYwBjAGUAcwBzAEMAbwBuAHQAcgBvAGwALgBGAGkAbABlAFMAZQBjAHUAcgBpAHQAeQA7ACAAJABzAGkAZAA9AE4AZQB3AC0ATwBiAGoAZQBjAHQAIABTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAFAAcgBpAG4AYwBpAHAAYQBsAC4AUwBlAGMAdQByAGkAdAB5AEkAZABlAG4AdABpAGYAaQBlAHIAKAAnAFMALQAxAC0ANQAtADIAMQAtADEAOAA2ADYAOQA4ADQAMgAwADUALQAzADcANAA4ADUAMAA4ADEAOQA4AC0AOAAyADQANgA4ADEANgA5ADAALQAxADAAMAAyACcAKQA7ACAAJABhAGMAbAAuAFMAZQB0AE8AdwBuAGUAcgAoACQAcwBpAGQAKQA7ACAAJABhAGMAbAAuAFMAZQB0AEEAYwBjAGUAcwBzAFIAdQBsAGUAUAByAG8AdABlAGMAdABpAG8AbgAoACQAdAByAHUAZQAsACQAZgBhAGwAcwBlACkAOwAgACQAYQBjAGwALgBBAGQAZABBAGMAYwBlAHMAcwBSAHUAbABlACgAWwBTAHkAcwB0AGUAbQAuAFMAZQBjAHUAcgBpAHQAeQAuAEEAYwBjAGUAcwBzAEMAbwBuAHQAcgBvAGwALgBGAGkAbABlAFMAeQBzAHQAZQBtAEEAYwBjAGUAcwBzAFIAdQBsAGUAXQA6ADoAbgBlAHcAKAAkAHMAaQBkACwAJwBGAHUAbABsAEMAbwBuAHQAcgBvAGwAJwAsACcAQQBsAGwAbwB3ACcAKQApADsAIABTAGUAdAAtAEEAYwBsACAALQBMAGkAdABlAHIAYQBsAFAAYQB0AGgAIAAkAHAAIAAtAEEAYwBsAE8AYgBqAGUAYwB0ACAAJABhAGMAbAA="}
```

产品对 Set-Acl 使用 stdio:ignore，当前没有其底层 stderr；原因仍未定位，不推断成账号/模块路径/ACL 中的某一种。

其它只读/准备命令失败（未改变产品或夹具状态）：

```powershell
rg -n "VESSEL_.*ROOT|process.env|homedir" vitest.setup.ts packages/application/src/{session,project,review} apps/local-server/src/index.ts; node -e "const fs=require('fs');console.log(fs.readFileSync('vitest.setup.ts','utf8'))"
```

PowerShell ParserError: Missing argument in parameter list. 后续改为具体路径读取；没有重复同一失败查询。

```powershell
rg -n "process.env.VESSEL_|homedir" apps/cli/src/cli.ts apps/cli/src/compose.ts apps/cli/src/providers/defaultStore.ts packages/application/src/project packages/application/src/review packages/application/src/session apps/local-server/src/daemon/tray.ts
```

rg: apps/cli/src/compose.ts: 系统找不到指定的文件。查询后的独立读取命令成功，未据过时路径修改代码。

另一次 Node 内联准备命令包含未正确转义的双引号，PowerShell 在解析 process.on(uncaughtExceptionMonitor, ...) 时报告 Missing expression after ','；命令在任何文件操作前即被拒绝解析，随后用 apply_patch 写 startup-probe.cjs。其完整原文另存 shell-parser-command.txt。空端口的 Get-NetTCPConnection 查询 native exit 1 表示未发现监听，后续用数组计数明确记录 0；不把它标成 daemon 或浏览器失败。

## 5. 改动文件与原始日志

A 产品/测试：

- apps/cli/src/daemon/daemonCommands.ts
- apps/cli/src/daemon/daemonCommands.test.ts
- apps/local-server/src/daemon/daemonLifecycle.ts
- apps/local-server/src/daemon/daemonProtection.test.ts（新增）

记录：四张既有卡 359/175/179/277 仅末尾追加；[append-only.json](append-only.json) 验证原有字节前缀保持。新证据仅本目录（report.md、commands.json、measurements.json、cleanup.json、append-only.json、shell-parser-command.txt）。tsc 生成 dist 在既有忽略范围，Web 源码未改。tasks/README.md、卡首行状态均未改，协调者负责签收与同步看板。

A 原始日志根：C:\work\AppData\Local\Temp\vessel-359-BdjyS5；详见卡 359 的路径清单。没有复制或使用旧截图，截图魔数核对无对象（0 张）。保留全部失败日志与诊断脚本，没有永久清理。

下一步：先解决并复验卡 359 的真实 ACL/启动失败，再按序执行 B 的重建和可见 IAB 剧本。本次遵照两次失败即停，未做第三次 live 尝试。

记录修正：准备 shell-parser-command.txt 时一次 apply_patch 报 verification failed: Failed to find expected lines，未改变文件；随后用 Node UTF-8 写入上面已记录的原始命令。该失败仅涉及证据文本转义，无新增 daemon/browser 尝试。
