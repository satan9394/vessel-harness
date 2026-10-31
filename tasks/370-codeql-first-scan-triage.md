# 任务卡 370: 首次全量 CodeQL 扫描暴露的 9 条告警（逐条定性）

- Status: 待执行（2026-10-31，远端追平后首次对 169 个提交做完整扫描）
- PDW task: none
- 来源：PR #46 合并进 `main` 后，CodeQL 对该分支跑完全量分析，开出 9 条告警（此前这些代码从未被扫描过，所以不是回归，是**首次暴露**）。

## 1. 告警清单（2026-10-31 实测）

| # | 规则 | 级别 | 位置 | 初步看法 |
|---|---|---|---|---|
| 16 / 15 | `js/shell-command-constructed-from-input` | error | `packages/tools/src/git/Worktree.ts:62` | 该函数用 argv 数组调用注入的 runner，不是拼 shell 字符串；但 `opts.path` 是外部输入，且 Windows 下 `.cmd` shim 可能走 `shell:true`。**先确认 runner 实现再定性**，别直接改成白名单 |
| 14 | `js/shell-command-injection-from-environment` | warning | `packages/runtime/src/process/Process.ts:62` | 同上族，看是否来自环境变量拼接 |
| 21 | `js/polynomial-redos` | warning(high) | `packages/shared/src/toolPins.ts:8` | 版本号解析正则 |
| 20 | `js/polynomial-redos` | warning(high) | `packages/memory/src/reflection/autonomousReflection.ts:36` | 反思文本截取正则 |
| 19 | `js/polynomial-redos` | warning(high) | `apps/cli/src/ui/TerminalStatusLine.ts:3` | 终端 ANSI/状态栏解析 |
| 18 | `js/polynomial-redos` | warning(high) | `apps/cli/src/providers/providerFactory.ts:136` | provider 输入归一化 |
| 17 | `js/stack-trace-exposure` | warning | `apps/local-server/src/server.ts:213` | 与 2026-09-18 已 dismiss 的 #10 同族（当时理由：只绑 127.0.0.1、返回 message 不返回 stack）。核对 213 行是否仍然只返回 message |
| 13 | `js/insufficient-password-hash` | warning | `packages/shared/src/execution.ts:33` | 大概率是 token/指纹的非密码用途，需确认后按「误报」dismiss 并写理由 |

## 2. Goal

把这 9 条逐条定性：**能安全修的修，属误报的带理由 dismiss，剩下的开子项**。不为了清零而放宽语义：

1. ReDoS 四条：先确认每处正则的实际输入上界（是否真能被长输入驱动）；能改写成线性等价形式的就改，不能的要在代码里加输入长度上限（并测试）。
2. shell 三条：确认 runner 是否 `shell:false`。若确实走 shell（Windows `.cmd` shim），按既有做法（`resolveSpawnCommand` + 参数原样传递）而不是拼接字符串。
3. `stack-trace-exposure`：核对是否只返回 `message`；是则按 #10 的理由 dismiss 并在卡里留同样口径。
4. `insufficient-password-hash`：确认用途；非凭据场景 dismiss（写明为什么不是凭据）。

## 3. Acceptance

- A1 9 条每条都有结论（修 / dismiss + 理由 / 另开子项），结论落在这张卡里。
- A2 修过的：有对应测试，且全量门禁 17/17 exit 0。
- A3 dismiss 的：用 `gh api --method PATCH repos/satan9394/vessel-harness/code-scanning/alerts/<n> -f state=dismissed -f dismissed_reason="..." -f dismissed_comment="..."`，理由与卡里一致。
- A4 收尾时 `code-scanning/alerts?state=open` 的条数与卡里「剩余」一致，不允许「为了 0 条而全 dismiss」。

## 4. Blast Radius

`packages/shared`、`packages/memory`、`packages/tools`、`packages/runtime`、`apps/cli`、`apps/local-server` 的相关文件与测试。禁止顺手改无关逻辑；禁止把安全判据改松。

## 5. Result

部分处理（2026-10-31，协调者）：**2 条已定性并 dismiss，7 条待做**。

- **#13 `js/insufficient-password-hash` → false positive（已 dismiss）**。`packages/shared/src/execution.ts:33` 的 `sha256(canonical(value))` 是**工具参数指纹**，用于 ExecutionPermit 的防重放比对：同一 permit 换参数就不能通过。这里没有密码、没有凭据，取值必须可复现，用慢 KDF 反而是错的。dismiss 理由原文已写进告警。
- **#17 `js/stack-trace-exposure` → won't fix（已 dismiss）**。与 2026-09-18 已 dismiss 的 #10 同族：`apps/local-server/src/server.ts:213` 只是 `res.end(JSON.stringify(body))` 这个通用 sink，实际下发的是 `{error, message}`，服务只绑 `127.0.0.1`，调用方是同机 CLI/TUI；stack 从不上线。理由与 #10 保持一致，避免同一件事两套口径。
- **剩余 7 条待做**：15/16（`js/shell-command-constructed-from-input`，`packages/tools/src/git/Worktree.ts:62`，同一位置两处）、14（`js/shell-command-injection-from-environment`，`packages/runtime/src/process/Process.ts:62`）、18–21（`js/polynomial-redos`：`toolPins.ts:8`、`autonomousReflection.ts:36`、`TerminalStatusLine.ts:3`、`providerFactory.ts:136`）。这批要按 §2 的顺序做：先确认 shell 那三处是否真走 shell（Windows `.cmd` shim），再逐条看正则的输入上界，能改写成线性等价的就改、不能的加长度上限并补测试。
- 收尾时 `code-scanning/alerts?state=open` 实测 **7 条**，与本段一致。
