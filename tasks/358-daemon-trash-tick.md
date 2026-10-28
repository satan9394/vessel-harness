# 任务卡 358: daemon 每日 tick 清理到期条目

- Status: 已验收（2026-10-27 验收：Codex 实现 + 独立复核 PASS，协调者复跑 daemon 4 文件 / 32 passed、local-server 26 / 312、两处 tsc exit 0，全量门禁 17 步全绿）
- PDW task: none（交接单 `tasks/prompts/codex-handoff-2026-10-27-wave2.md` 的 T14，`gpt-6.1-sol`/medium）
- 前置：卡 345c（serve 启动清理）已完成，两者共用同一根规则

## 1. Goal

`docs/DELETION-AND-RETENTION.md` §4 写的触发点是「`vessel serve` 启动 + daemon 每日 tick + 手工」，但
`apps/local-server/src/daemon/daemonLifecycle.ts` 里搜 `purge` / `trash` **零命中**——每日 tick 从未接。
serve 启动那半由 345c 补；本卡补 daemon 这半，让「7 天到期自动清」在常驻场景真的会发生。

## 2. 要做的事

1. 在 daemon 生命周期里加每日 tick：到点调用一次 `trashStore.purge`（根与 345c 一致），失败只记录、不重试到阻塞。
2. tick 必须能被既有 `stop()` 清掉，不得留下定时器让进程无法退出（这是最容易漏的一条）。
3. 保留 `VESSEL_TRASH_TTL_DAYS=0` 关闭语义：为 0 时不注册 tick 或 tick 内直接返回，报告写清选了哪种。
4. 测试 ≥2 条：注入可控时钟/短间隔，断言到点触发一次；`stop()` 后不再触发（可用计数或假时钟推进验证）。
5. 不改 daemon 既有 `recycleDaemonPath` 的回收语义（那只管 daemon 自己的 pid/状态文件）。

## 3. Not Doing

- 不做「按小时/按大小」清理，不做后台常驻循环以外的调度。
- 不把 purge 挪进 `vessel serve` 之外的 UI 触发。
- 不改 `trash.ts` 的 TTL 判定（已由 345a 定）。

## 4. Acceptance

1. 到期条目在 daemon 运行期间会被清掉；未到期条目不动。
2. `VESSEL_TRASH_TTL_DAYS=0` 时不清理（有测试证据）。
3. `stop()` 之后定时器不再触发，进程可正常退出（有测试证据）。
4. `vitest run apps/local-server/src/daemon` 与 `vitest run apps/local-server` 全绿，两处 tsc 干净。
5. `docs/DELETION-AND-RETENTION.md` §4 的「触发点」与实现一致（若实现只做 tick 不做别处，就照实写）。

## 5. Blast Radius

`apps/local-server/src/daemon/daemonLifecycle.ts`、`daemonLifecycle.test.ts`、`docs/DELETION-AND-RETENTION.md`。
无依赖变化、无 Web 改动。

## 6. Expected Evidence

两条测试的计数、`daemon` 段与 `local-server` 段 exit、两处 tsc exit、`stop()` 后不再触发的证据。

## 7. Result

- T14 定向自验与独立只读复核 PASS（2026-10-27）；仅填本 Result，不改卡面或索引。实现 `gpt-6.1-sol` / `medium`，复核 `gpt-6.1-terra` / `medium`（交接单：生命周期与定时器并发）；Codex 应用辅助模式，无 Fast/Ultra，同一时刻只有一个写者。
- 修改 `daemonLifecycle.ts`、`daemonLifecycle.test.ts`、`docs/DELETION-AND-RETENTION.md`：常驻子进程的 `gracefulDaemonStop` 工厂注册 24 小时 interval，`unref()`；根 `(workspace ?? process.cwd())/.harness/trash`，第四参数只作可选工作区注入。现有 `runDaemonChild` 调用该工厂，daemon 服务端当前无显式 workspace，两者默认均为启动 cwd。短命的 `DaemonLifecycle` 启动客户端不持有定时器，类本身与原 `recycleDaemonPath` 均与本轮开始的备份字节一致。
- tick 检查 TTL=0 即返回，缺根静默跳过，purge 抛错只 warn，无立即重试；返回的 stop 在开始关闭之前清除 interval，即使 close 失败/挂起也不会继续清理，既有关闭幂等与强制退出语义保留。
- 新增 6 条假时钟用例：24 小时前 1ms 不触发、到点精确触发一次并真实删除到期/保留未到期 payload；正常/失败/挂起关闭各一条；TTL=0 保留已到期条目；失败只警告一次且不立即重试。所有清理夹具为本测试 mkdtemp 工作区，关闭后推进两天无 purge，timer count 为 0，未加 sleep 或削弱断言。

| 最后源码编辑后的自验命令 | exit | 结果 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run apps/local-server/src/daemon` | 0 | 4 文件 / 32 passed |
| `node node_modules/vitest/vitest.mjs run apps/local-server` | 0 | 26 文件 / 312 passed |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 无诊断 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 无诊断 |

- 外层 Vitest 进程仅设 TTL=0 防止其它既有夹具使用 cwd；专用 retention 测试显式覆盖 7/0，真实清理临时根。独立复核核对驻留调用链、原始日志、退出码和 frozen SHA 后 PASS。
- 协调者额外实际进程验证：最终 tsc 后运行 `node C:/work/AppData/Local/Temp/vessel-wave-a-KgYB0Y/T14-unref-proof.mjs`，注册定时器且不调用 stop，进程自然 exit 0（约 1.64 秒），证实 unref 不阻止退出；工作区与 TTL 均限定在测试进程/临时根。脚本和 `T14-unref-proof.log` 保留于同目录，未启动真实 daemon 或其它 Agent。
- 证据：`C:/work/AppData/Local/Temp/vessel-wave-a-KgYB0Y/T14-evidence-manifest.json`、`T14-gate-1.log` 至 `T14-gate-4.log`、`T14-source-hashes.json`、`T14-SHA256SUMS.txt`。SHA-256：daemonLifecycle.ts = `96c3934571ef213c28fd14806f1043cc51ca3d8bb233759660ed98b17eae0a50`；daemonLifecycle.test.ts = `68841d837a6ce748c96b9803af0fb379f2338e936110b1b8742ab35c29006fab`；删除文档 = `07c2d1afa4737386a570528536e6f3c5720d05a4280acdcdb9dde5016bcdfa30`。复核时全部与当前文件一致。
- 未做：真实运行 24 小时（以假时钟真实 payload 清理替代等待）；全量门禁、commit/push/分支、外部 Agent CLI、范围外源码或依赖修改。被拒/失败自验命令：无。

#### 协调者验收（2026-10-27，独立复跑）

- 代码复核：`gracefulDaemonStop(close, exit, timeoutMs, workspace?)` 内 `setInterval(…, 86_400_000)` + `.unref()`，tick 里先判 `VESSEL_TRASH_TTL_DAYS === '0'`、再 `existsSync` 守卫、`purge` 包 try/catch 只 warn；返回的 `stop()` 第一件事是 `clearInterval(retention)`，之后才走既有关闭与强制退出。`recycleDaemonPath` 改为走 `@vessel/shared` 的 `recyclePath` 是卡 343 的既有改动，不在本卡引入。
- 调用链核对：`apps/cli/src/daemon/daemonCommands.ts:91` 调用时**没有**传第四参数，子进程 `cwd` 由 launcher 继承（`daemonCommands.ts:12` 的 `cwd: process.cwd()`），因此 daemon 的清理根＝启动它的目录。这不是缺陷而是口径：`vessel daemon start` 没有 `--workspace`，要与 `vessel serve --workspace` 完全对齐得另立卡；已在 `docs/DELETION-AND-RETENTION.md` 照实写明，没有写成「与 serve 等价」。
- 我自己的复跑：`vitest run apps/local-server/src/daemon` exit 0、4 文件 / **32 passed**；`vitest run apps/local-server` 26 / **312**；两处 tsc exit 0；全量门禁 17 步全绿。
- 边界（不宣称）：没有真跑 24 小时，用的是假时钟 + 真实临时 payload；没有做 detached 常驻 daemon 的端到端（只验证了驻留调用链与 unref 不阻塞退出）。
