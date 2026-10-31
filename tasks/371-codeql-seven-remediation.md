# 任务卡 371: CodeQL 剩余 7 条告警——按已定性的方案修掉

- Status: 已验收（2026-10-31；本地全量 17/17 通过，CodeQL 重扫待推送后确认）
- PDW task: none
- 来源：卡 370 的 7 条剩余告警。子代理逐条读了源码、核了 CodeQL 查询源码里 `executesArrayAsShell` 的判定条件、并用极端输入实测了复杂度，结论如下（**这是决定，不是候选**）。

## 1. 决策（每条都定了怎么修）

| alert | 规则 | 位置 | 定性 | 决定 |
|---|---|---|---|---|
| 15 / 16 | `js/shell-command-constructed-from-input`（error） | `packages/tools/src/git/Worktree.ts:62` | **误报实体、真结构隐患**：git 全程 argv、`shell` 从未开启；但 `runCommand` 的 `shell: opts.shell ?? false` 让 CodeQL 认定「可能开 shell」，于是 argv 被视为会被拼进命令行 | **拆 spawn 点**：`runCommand` 彻底不出现 `shell` 键，新增 `runShellCommand(commandLine)` 作为唯一字面量 `shell: true` 的出口；`Worktree.ts` 一行不改 |
| 14 | `js/shell-command-injection-from-environment`（warning） | `packages/runtime/src/process/Process.ts:62` | **有条件成立**：程序名来自环境路径（`%SystemRoot%`、`process.execPath`），今天无调用方同时传 `shell:true`，但契约上允许 | 同一处拆分即关闭；不额外 sanitize、**不许**用 `JSON.stringify` 之类假转义 |
| 18 | `js/polynomial-redos` | `apps/cli/src/providers/providerFactory.ts:136` | **真问题**：`/\/+$/` 在「长斜杠段 + 后面还有字符」时二次方（实测 1000/2000/4000 → 0.65/2.18/8.56ms） | 换成索引回退的 `withoutTrailingSlashes()`，O(n)，语义逐字等价 |
| 19 | `js/polynomial-redos` | `apps/cli/src/ui/TerminalStatusLine.ts:3` | **真问题**：OSC 分支 `[^\x07]*` 允许吞掉 `ESC`，与终止符 `\x1b\\` 自相矛盾；实测 `"\x1b]".repeat(n)` 二次方（1.35/5.52/19.95ms）。**顺带修一个现有缺陷**：OSC 链接后面的正文会被一起删掉（`\x1b]8;;url\x1b\\link\x1b]8;;\x1b\\` 现状输出空串，应为 `link`） | `[^\x07]` → `[^\x07\x1b]`；并补一条「OSC 之后正文保留」的测试 |
| 20 | `js/polynomial-redos` | `packages/memory/src/reflection/autonomousReflection.ts:36` | **真问题**：`core.*import` 的 `.*` 无界、`detail` 无长度上限；实测 `"core"×8000` = 126.6ms 且二次方 | `core[^\n\r\u2028\u2029]{0,200}import`（`.` 的字符集本来就排除这四个行终止符，只加了 200 字符窗口）。若重扫仍判 ReDoS，改用手写单次扫描（sheet 里给了现成实现） |
| 21 | `js/polynomial-redos` | `packages/shared/src/toolPins.ts:8` | **真问题**：`\d+\.\d+\.\d+` 每个起点重扫数字串，输入是外部 CLI 的 `--version` stdout（不可控）；实测 8KB 数字 = 32ms 且二次方 | 三个分量改有界量词 `\d{1,9}`（远超真实版本号位数），整串扫描变线性 |

## 2. Goal

按上表修完 7 条，**不弱化任何语义**：

1. 进程派生只有两个出口，且语义互不混淆：argv 一条（无 `shell` 键）、整条命令行一条（字面量 `shell: true`）。给 `runCommand` 传 `shell:true` 变成立即报错（收紧契约，全仓无此调用）。
2. 四条 ReDoS 全部改成本质线性，且输入语义不变（`#19` 还顺手修掉 OSC 吞正文的 bug）。
3. 修复后 7 条告警在重扫时消失；若 `runShellCommand` 这个**有意为之**的 shell 边界又冒出 `js/shell-command-constructed-from-input`，按「单一有意边界」dismiss（评论措辞写在 sheet 里），不算未完成。

## 3. Acceptance

- A1 `packages/runtime/src/process`、`packages/runtime/src/sandbox`、`packages/tools/src/tools.test.ts`、`packages/tools/src/git/worktree.test.ts` 全绿；`npx tsc -b tsconfig.json` exit 0。
- A2 四条 ReDoS 单测全绿；新增/保留的边界测试：`#18` 的尾斜杠去重、`#19` 的「OSC 后正文保留」、`#21` 的超长数字仍能解析首个版本号、`#20` 的「同句 core…import 命中 / 隔行不命中」。
- A3 `runCommand` 传 `shell:true` 会 reject 的用例（新增），断言错误信息指向 `runShellCommand`。
- A4 全量门禁 17/17 exit 0（Node 26，`scripts/gate-batched.ps1`）。
- A5 没有为了让告警消失而放宽目标：不给 `runCommand` 加 `shell?: false` 字面量假装修、不把正则换成 `includes` 丢失边界、不在测试里跳过用例。
- A6 报告里给出每条告警「改前 → 改后」的复杂度或边界说明（能复现的数字最好）。

## 4. Blast Radius

`packages/runtime/src/process/Process.ts`、`packages/runtime/src/sandbox/Sandbox.ts`、`benchmarks/runners/src/asserts.ts`、`apps/cli/src/providers/providerFactory.ts`、`apps/cli/src/ui/TerminalStatusLine.ts`、`packages/memory/src/reflection/autonomousReflection.ts`、`packages/shared/src/toolPins.ts`，以及这些文件对应的测试。**禁止**动 `packages/tools/src/git/Worktree.ts`（本卡刻意一行不改）、禁改 `McpClient` 的 Windows shim 白名单、禁改 `apps/web`、禁改 CI 配置。

## 5. Result

**已验收（2026-10-31，协调者独立复跑；不采信执行方自证）。** 七条修复与 §1 决策逐条一致，没有为了消警放宽判据：

- 结构：`runCommand` 的 spawn 选项里**没有 `shell` 键**，`shell: true` 全仓只剩 `runShellCommand` 一处；`supervise` 从原 74–148 行整段搬出，`onSpawn` 之后与 HEAD 逐字节等价。`Worktree.ts` 零改动；受保护路径 217 个文件比对全未变（`audit-scope.mjs` 复跑：`changed 14`、`protectedUnchanged 217`、`supervisionPreserved true`、manifest `f710c6aa…` 与执行方自报一致）。
- 语义：`Sandbox.run` 的 shell 分支在分配 isolation 之前拒绝非空 argv，随后走 `runShellCommand`；`shellTool` 原本就是 `run(command, [], {shell:true})`，行为不变。四条 ReDoS 的输入语义全部保留（`#19` 顺带修掉 OSC 吞正文：`\x1b]8;;url\x1b\\link\x1b]8;;\x1b\\` 由空串变 `link`）。
- 门禁：聚焦 11 文件 / **155 passed + 1 skipped**（协调者选的超集口径，覆盖执行方两批全部用例）；`npx tsc -b`、`npm run typecheck:tests`、`git diff --check` 均 exit 0；`scripts/gate-batched.ps1` **17/17 exit 0**——根 12 批 335 文件执行 / **3,746 passed + 8 skipped**、web 61 / 543、三处 tsc 0、离线 conformance 25/25（$0）。
- **3,746 与基线 3,726 的差已核清**：差的正好是本卡新增的 20 条测试（3,726 + 20 = 3,746），skipped 仍是 8；`root-index` 重复跑 `sessionIndex.test.ts`（10 条）在基线里本来也算着，所以它只解释「不是去重计数」，不构成增量来源。
- 证据脱敏：执行方的 6 份日志/JSON 里带本机账号路径，已就地改成 `C:\work`（manifest 只覆盖 13 个源/测试文件与卡，不受影响）；
- **未完成项（不影响本卡验收）**：CodeQL 重扫需推送后才见结果；若在 `runShellCommand` 冒出新告警，按 `report.md` 的评论草稿 dismiss（单一有意 shell 边界）。

协调者验收记录（复跑命令与逐条核对）：`evidence/sessions/2026-10-31-codeql-seven/ACCEPTANCE.md`。

## 6. Local execution evidence (2026-10-31)

- Implemented the seven agreed source remediations in the seven allowed production files and six corresponding test files; added 20 tests. Main thread only; no subagents, external agents, commits, pushes, or GitHub alert changes.
- Ordered focused gates: batch 1 exit 0 (79 passed, 1 existing skipped); batch 2 exit 0 (139 passed); both TypeScript builds exit 0. Batch 2 was rerun after the test-typing repair.
- First full gate: exit 1, 16/17 green; tsc-tests found tuple inference errors in the new reflection test table. Repaired only its explicit tuple types, preserving every case and assertion. Failure logs retained.
- Final full gate after the last source/test edit: 17/17 exit 0; root batches 335 file executions / 3746 passed + 8 existing skipped; Web 61 files / 543 passed; three TypeScript checks clean; offline conformance 25/25. Root numbers are invocation totals (the required root-index filter also repeats sessionIndex tests). No added skips or weakened criteria.
- Source/test artifact manifest SHA-256: f710c6aace6796c00947c3904d57a70d0fc1286513fa1a32cd71efa81abcc953. Final scope audit records per-file hashes and confirms protected paths unchanged, argv spawn without shell, and preserved supervision body.
- CodeQL rescan/new-finding status remains UNVERIFIED: no CodeQL CLI available on PATH and no push authorized. The report includes a conditional dismiss-comment draft for the intentional runShellCommand boundary; no alert was dismissed here.
- Report, exact file list, before/after hostile-input timings, both full-gate attempts, focused output, hashes, and scope audit: evidence/sessions/2026-10-31-codeql-seven/report.md.
