# EVALUATION-REPORT-22 — 独立对抗复评（BRIEF-16 1C / R-1 force-push fail-closed）

立场：先假设修复是表面的、可绕过的。方式：**静态审查，未复跑任何命令**（只读代码与测试）。
指挥侧实测证据（tsc 0 / 1487 passed / E2E stderr 提示 / 探针 6 deny 5 allow）本轮未复核，仅作对照。

## 片 1：1C「mock 运行期可见」— 判定 **ACCEPT（代码正确）**，但测试真实性未闭合

1. **同源判定：成立。** CLI `usingMockProvider = realProvider === null`（`cli.ts:594`）与随后 `provider = realProvider ?? new MockProvider(...)`（`cli.ts:595-620`）共用同一变量，不存在第二个事实源；TUI `usingMockProvider = true` 唯一赋值点就在 `new MockProvider(...)` 同分支内（`chat.ts:419-433`），真实 provider 走 `else` 显式置 false（`chat.ts:446-449`）。
2. **真实 provider 零字节：成立。** 两处渲染出口在 `usingMock === false` 时 `return finalText`（`cli.ts:557`、`chat.ts:340`），提示受 `if (usingMockProvider)` / `if (!mockNoticeShown)` 门控（`cli.ts:696`、`chat.ts:442-445`）。
3. **出口枚举（独立核对）：** CLI 非空最终回复只有 `cli.ts:702` 一条，经 `renderFinalReply`。TUI 三条分支：`interrupted`（`chat.ts:696`，无最终回复）、有文本（`chat.ts:700`，经 `renderTurnReply`）、空文本（`chat.ts:701` 直接 `io.write('(无文本回复)')`）。**最后一条绕过了 `renderTurnReply`**；CLI 侧 `renderFinalReply` 也在 `if (!finalText)` 早退（`cli.ts:556`），即在 usingMock 判断**之前**返回。结论：mock 空回复在两端**都不带标记**——与 BRIEF-16「每条 mock 回复都有可辨识前缀」的 AC 有缝隙（危害低：提示行仍在，且非模型文本）。
4. **幂等：成立。** `startsWith(MOCK_REPLY_MARK)` 判前缀（`cli.ts:558`、`chat.ts:341`），`fallbackText` 自带标记不会叠两层；真实文本即使以该串开头也不会误判（`usingMock=false` 时根本不进该分支）。CLI/TUI 各自持一份常量（`cli.ts:540-542` / `chat.ts:325-327`）确为**逐字重复**，反向 import 成环的理由成立；但双份副本无编译期约束，改一处不会红（低危漂移风险）。
5. **stderr 契约：部分成立、部分空转。** `console.error(MOCK_PROVIDER_NOTICE)`（`cli.ts:696`）确走 stderr，stdout 只有人类回复。但 **`run` 今天并没有 `--json` 信封**：`--json` 在 USAGE 中只承诺给只读命令（`cli.ts:120`），`cmdRun` 全程不调 `isJson/emitJson`——所以「`--json` 的 stdout 只有一段 JSON 不被破坏」是**对未来的承诺，不是被验证的现状**（无害，但被当成已验证事实）。TUI 提示走 stdout 是**唯一可选**（`ChatSessionIO` 无 stderr 面，`io.write → console.log`，`chat.ts:171-173`）：交互场景可接受；代价是录制到的 TUI 文本流里提示与回复同一通道。
6. **测试真实性：不成立（本轮最大问题）。** 全仓 **0 处**断言 `MOCK_PROVIDER_NOTICE` / `TUI_MOCK_PROVIDER_NOTICE` / `未连接真实模型`（仅 PRODUCT-STATE.md 自述）。唯一触碰标记的两条断言（`policyStatus.test.ts:347,379`）跑的是 prompt `hi` → 走 `fallbackText` 分支，而该文案**本来就以标记开头**（`cli.ts:618`），即**没有 `renderFinalReply` 也绿**，对新增代码零判别力。真正的新路径（Read 回显 `已通过 Read 工具读取工作区文件…`，`cli.ts:613`）只有指挥的手工 E2E，**仓内无断言** → BRIEF-16 AC2「断言具体字符串」未落地。所谓「真 provider 加标记必红」的说法**为假**：`cli.test.ts:171` 与 `opencodeGoCli.test.ts:187` 都用 `toContain('CLI-106-MARKER')`/`toContain('GO-MOCK-PONG')`，无脑加前缀仍然全绿——负对照当前**不成立**。
7. 边界（不构成缺陷）：`run --bench` 用 mock 但不打提示（`cli.ts:749+`，非「最终回复」出口）；`resume` 的 TUI 分支经 `runChat`（`cli.ts:2021`）已被覆盖。

**片 1 未闭合（按严重度）**：P1 —— ①AC2 无断言：补一条「无 provider 配置 + `--prompt '总结 README'` → stdout 回复以 `（mock 离线冒烟）` **开头**，且 stderr 含提示串」；②把真 provider 的负对照从 `toContain` 改 `toEqual`/`not.toContain('mock 离线冒烟')`。P3 —— ③TUI 空回复与 CLI 空回复的标记口径统一或显式声明豁免。

## 片 2：R-1 force-push fail-closed — 判定 **REJECT**（仍有可静态构造的绕过形）

1. **触发条件精确性：与声明的硬边界一致。** 会 deny（推断）：`xargs git push …`、`timeout 60 git push …`、`watch git push …`、`man git push`、`echo git push`（未加引号的独立 token）、`docker run img git push …`、`sh script.sh`/`bash -e build.sh`（`Compiler.ts:393`）、≥5 层包装且带签名（`:378-382`）、递归超限带签名（`:440-444`）。不会 deny：`git log --grep push`（段首 git 走精确判定，`:396`）、`npm run push`/`echo a+b`/`xargs ls`（无 git+push 签名，`:401`）、`echo "git push --force"`（引号粘成单 token，`mentionsGitPush` 不认）、`git push origin main`（`sudo git push origin main` 亦为 allow）。与指挥实测的 5 allow 一致。
2. **仍有绕过形（静态推演；前两条是新增、未被任何注释承认）：**
   - **① 续行符（高危，实机可执行）**：`git push ^`+换行+`--force origin main`（Windows cmd.exe，`shellTool.ts:44/70` 确认走 cmd）与 `git push \`+换行+`--force origin main`（POSIX `/bin/sh`）。`splitShellSegments` 只把 `\`+换行当转义字符吞掉、把 `^`+换行当普通字符（`Compiler.ts:128-132,138`），tokenizer 产出 `"\n--force"`（`Compiler.ts:171-176`）→ `isForcePushOption` 不认 → **allow**，而真实 shell 会拼成 `git push --force`。**未在「余下边界」清单里，属漏网。**
   - **② git alias 走私（中）**：`git -c alias.p='push --force' p` —— `-c` 在 `GIT_GLOBAL_VALUE_OPTS`（`Compiler.ts:102-105`）被跳值，`tokens[i]` 为 `p` ≠ `push` → **allow**；git 实际执行别名内的 push --force。`alias.p='!git push --force'` 同理。
   - ③ `CMD='git push --force'; sh -c "$CMD"`（`shellDashCArg` 递归后只见 `$CMD`）、`printf 'git push --force' | sh`、`git push $'\x2d\x2dforce'` —— 均 **allow**，属注释已承认的变量/stdin/命令替换边界（`Compiler.ts:426-434`），本轮未修，如实记录。
3. **过度拦截是否可接受：可接受，但实现者可更精确。** `xargs git push origin main` / `timeout 60 git push origin main` 被 deny，代价是误拦正常发布命令；但它是 `deny` 规则、只在放宽会话里当唯一防线，漏放代价远大于误拦。更精确的替代：仅在「无法解引用的间接层」**且段内出现 force 形状 token（`-f`/`--force*`/`+refspec`）或 alias/脚本文件不可知**时 deny，普通 push 放行——与现有 ①②的修法可合并。
4. **测试：两侧都有覆盖，无永真断言。** 该拦：`compilerMatcher.test.ts:316-351`（⑪⑫⑬）、端到端 ⑭`:353-383`；不该拦：⑧`:275-286`、⑩`:309-313`、⑫`:334-340`、⑬`:348-350`、⑭`:379-382`。判别力真实（`toBe(false)` 与正向同文件）。缺口：① ②与「普通 push 被过度拦截」这一已知代价**无锁**，回退不会红。
5. **回归作用域：干净。** `detectForcePush` 只挂在 `git:force-push` 一条内置规则上（`Compiler.ts:642-656`，全仓唯一调用点 `:654`）；`shellCommandPredicate` 的 `*` 语义未被触碰（`:36-47`，注释 `:59-61` 与现实一致）。S006 判据 `pattern: "force"`（`benchmarks/scenarios/S006.yaml:10`）对 `git:force-push` 与 `shell-force-push` 两个 ruleRef 仍成立。

**片 2 最小修复方向（按优先级）**：P0 —— ①在 `splitShellSegments`/`tokenizeShellSegment` 入口先规范化续行（cmd `^`+CRLF、sh `\`+LF、PowerShell 反引号）为空白，再分段；并补 ② `git -c alias.*=…` 或子命令非 `push` 但 token 里出现 `+refspec`/force 选项时 fail-closed。P1 —— ③补两侧测试：续行与 alias 必须 deny，`xargs git push origin main` 的 deny 作为**已知代价**显式锁定（写明这是有意为之），避免静默回归。

## 总判

- 片 1（1C）：**ACCEPT**（实现同源、无双出口绕过；未闭合项为 AC2 测试缺失与真假负对照，不阻断功能）。
- 片 2（R-1）：**REJECT**（`+refspec`/`env -S`/`eval`/`sh script.sh`/深包装确已闭合，但**续行符**与 **git alias** 两条可直接执行的绕过形仍未覆盖，且不在自述边界清单内）。
