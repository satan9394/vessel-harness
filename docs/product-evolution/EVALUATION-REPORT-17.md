# EVALUATION-REPORT-17 — Round 13 复评（G-11 MCP 半 FIX 复核）

> 对抗立场：先假设修复是表面。**静态审查，未复跑任何命令**（无 tsc / vitest / git / CLI）；指挥侧数据（129 文件 / 1388 passed）仅作交叉参考，未采信。
> 首轮 REJECT 依据：`docs/product-evolution/EVALUATION-REPORT-16.md`。复评基线：工作树现状（PRODUCT-STATE 称 FIX 提交 `b98bfc0`）。

## 1. 孤儿进程 + 超时 —— 代码层**通过**，测试层**不完整**
- `close()`：`killTimer` 2s SIGKILL 于 `McpClient.ts:208-210` 布置，**唯一**解除点是 `:211-213` 的 `once('exit')/once('error')`；50ms 快返路径 `:215-226` 只 `finish()` resolve，**不再 clearTimeout** → 首轮缺陷 A 真修。✅
- `request()` 超时：`:171-182` 默认 5000ms，超时 `pending.delete(id)` + `closed=true` + 带方法名的 reason，无悬挂 resolver/定时器。✅ `initialize()` 双层：transport 层 + `withTimeout`（`:249-264` / `:268-284`）。✅
- **新风险（未测）**：`listTools()/callTool()`（`:286-293`）不过超时参数 → 所有 `tools/call` 吃 5s 默认值，且一次超时**永久** `closed=true`。真实 MCP 工具调用 >5s 即失败并使该 server 余下会话全废（旧行为是无限等）。`McpClient.ts:20` "任何 transport 都不会永久挂起" 是过头声明（`listTools/callTool` 无 `withTimeout` 兜底）。
- **超时路径零测试**：`mcp.test.ts:29-42` 走 in-process；`stdioTransport.e2e.test.ts:418-445` 测的是"服务器立刻退出"（'exit' 事件路径），**不是** setTimeout reject 路径。R16 必须补齐 #2 的后半"补'存活但不响应'测试"**未做**。❌

## 2. cli.ts close 兜底 / win32 `.cmd` —— **部分通过**
- `cli.ts:374-386`：`composeHarness` 抛错时逐个 `conn.transport.close()`，再原样 rethrow；成功路径行为不变（仍走 `:430-432 finally harness.close()`）。✅ 与 TUI `chat.ts:353-386` 对称。
- `.cmd` 可操作原因：`cli.ts:243-250`（`windowsShimHint`，白名单逐字对齐 `resolveSpawnCommand`），在 `:274-277` 生效并走"已跳过"通道。✅
- **缺口**：TUI 侧 `chat.ts:250-263` **未接** `windowsShimHint` → win32 非白名单 `.cmd` 在 TUI 仍直连 spawn 得含糊错误。首轮该项的修复面只覆盖 CLI。⚠️

## 3. 测试入库与覆盖 —— 验收 3 **通过**，验收 5 **仍未做**
- `packages/application/src/mcp/connections.test.ts:215-286`：验收 3 (a)(b)(c)(d) 四断言齐 + `:263-273` 成功对照组（证明 3c 空集非假绿）+ `:230-250` warn 可见性。✅（注入的是 `createInProcessTransport` 接口层故障，接口契约成立；真 stdio 降级仍只有默认跳过的 opt-in 探针 `:288-330`。）
- **验收 5 仓内仍零测试**：`apps/cli/src/tui/chat.test.ts` 全文 **无 `mcp` 命中**；无重建路径测试。R16 必须补齐 #3 的"验收 5 重建无累积子进程测试"**未做**。❌
- **首轮"缺陷 B"未修**（R16 §验收5）：`chat.ts:464-483` 重建失败仍 `harness = previous`，而 `previous.close()` 已在 `:466` 执行 → 旧 registry 仍列 `mcp__*`、client 全 closed，工具"可见但调用必失败"，无任何提示。此为产品级未闭合项，非仅测试缺口。❌
- **配置测试**：`apps/cli/src/mcp/config.test.ts`（360 行）在盘；`.gitignore` 不排除测试；`.git/index` 文本含 `apps/cli/src/mcp/config.test.ts`（对照：不存在的同形路径零命中）→ **已入索引**，"交付即丢"风险已解。⚠️ 索引层证据，HEAD 是否含该条目需 `git ls-files` 复核（本轮未跑命令）。
- **重试判别力**：`isRetryableEnvFailure`（e2e `:130-137`）**先**按 `name === 'AssertionError'` 排除，再匹配环境性正则 → 断言失败永不重试；`throwIfTransportFlake` 只转环境性失败。✅ 判别断言完整保留：`instanceof StdioTransport` / `child.pid !== process.pid` / `pidAlive` / `'42'` / `'STDIO-E2E-OK'`（`:242-247`、`:258-259`、`:278-289`）；anti-fake-green 源码守卫 `:368-383` 仍在（局限同 R16：只挡两个字面名）。

## 4. "测试替实现兜底" —— **成立，属未闭合项**
- `stdioTransport.e2e.test.ts:192-207` 的 `reap()` 仍在 `transport.close()` 返回后自补 `child.kill('SIGKILL')`；`closeAndAssertReaped`（`:293-300`）**先 reap 后断言** → 断言恒真。`connections.test.ts:82-99` 同形。
- 结论：`close()` 自收尸这条**仍无独立于测试兜底的仓内证据**；若有人把 `clearTimeout(killTimer)` 放回 50ms 路径，全套件仍绿。代码已修（§1），但这构成 R16 必须补齐 #1 的验证未闭合。**最小闭合**：新增一条用例——spawn 一个忽略 stdin EOF 的子进程（如 `node -e "process.stdin.resume(); setInterval(()=>{},1e3)"`），只 `await transport.close()`（不 reap），睡 ~2.6s 后断言 `pidAlive(child.pid) === false`。

## 5. 回归面 —— **通过**
- `compose.ts:257-274` 逐 conn try/catch；`:272` 失败即在 `client?.close()` 收子进程；`mcpFailures` 在 `:108` 为**可选**字段，`ComposedHarness` 仅由 `compose.ts:385` 构造（全仓 grep 无第二处字面构造）→ 既有构造点零影响。✅
- `:262 await client.initialize()` 是真行为变化（不实现 initialize 的自定义 transport 由"注册成功"变"warn+跳过"），`fixtures/echoServerCore.ts:33` 已实现 initialize，benchmark in-process 路径不回归。✅
- 指挥侧反向验证（fixture `a+b+1` → E2E 立即红且未被重试掩盖）与静态结论一致：`:132` 的 AssertionError 短路成立。✅

## 结论：**REJECT（窄口径：2 处首轮缺陷已真修，但 4 项"必须补齐"未闭合）**
已修：缺陷 A（孤儿）、`initialize` 永久挂起（双层超时 + pending 清理）、验收 3 四断言、CLI close 兜底、CLI 侧 `.cmd` 可操作报错、`config.test.ts` 入库。
**剩余未闭合项（按严重度）**
1. `chat.ts:464-483` 缺陷 B（重建失败回滚后 MCP 工具假活）**未修**，验收 5 重建路径仍**零测试**。最小修复：回滚分支明确提示 MCP 工具已失效，或重建失败时清掉旧 registry 的 `mcp__*` + 补一条重建测试。
2. E2E"至少一条真进程路径可用"硬断言**未加**（`e2e:341/:353` 仍纯 `skipIf`）→ 无 npx/tsx 时整套仍 exit 0 而该切片零验证。最小修复：`expect(NPX_E2E_AVAILABLE || TSX_CLI !== null).toBe(true)` 放进一个无条件用例。
3. `close()` 自收尸无独立证据（`reap()` 仍替产品兜底，§4）。最小修复见 §4 单条用例。
4. 超时路径无测试（§1）；且 `tools/call` 被 5s 硬超时且一次超时永久关连接 —— 与 `listTools/callTool` 无 `withTimeout` 兜底、`:20` 声明不符。
5. TUI 未接 `windowsShimHint`（§2）。
（观察级：子进程先于 `close()` 退出时 `killTimer` 仍空转到 2s，吊住事件循环约 2s；`connections.test.ts` 文件头 `:20/:24` 行号引用已漂移。）
