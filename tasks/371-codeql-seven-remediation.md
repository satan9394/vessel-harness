# 任务卡 371: CodeQL 剩余 7 条告警——按已定性的方案修掉

- Status: 已决策、待执行（2026-10-31；调查已由子代理完成，方案定稿，不再讨论方向）
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

待执行。派单：`tasks/prompts/codex-handoff-2026-10-31-codeql-seven.md`（`gpt-6.1-sol` / medium）。
