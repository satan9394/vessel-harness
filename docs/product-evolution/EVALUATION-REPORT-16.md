# EVALUATION-REPORT-16 — Round 13（G-11 MCP 半）独立验收

> 对抗立场（先假设实现有错/E2E 假绿）。**静态审查，未复跑任何命令**（未跑 tsc / vitest / CLI）；指挥侧数据仅交叉参考。
> 基线 `20f4c73`。工作树另有 **untracked** `apps/cli/src/mcp/config.test.ts`。

## 验收 1 — 真跨进程：**通过**（有"静默退化为零验证"缺口）
- 判别性在协议断言之前：`child.pid` 存在、`!== process.pid`、`pidAlive()`（`packages/tools/src/mcp/stdioTransport.e2e.test.ts:179-184`）；同进程假传输无 `child` 必挂。
- 真执行：`registry.execute('mcp__demo__add',{a:20,b:22})` 断言 `content==='42'`、`error===undefined`（`:206-213`），非只查工具名。
- 反假绿守卫存在（`:267-282`）：读自身源码禁同进程传输/协议核心字面名。**局限**：只挡两个已知标识符，内联自实现可绕过。
- **缺口**：两条 E2E 均 `it.skipIf`（`:237` 需 PATH 有 npx 且本地 `node_modules/.bin/tsx` 在；`:251` 需解析到 tsx CLI）。两者都缺时只剩纯函数/守卫用例，**无任何断言要求"至少一条真进程路径跑过"** → 套件照旧 exit 0，而本切片唯一硬缺口零验证。skip 可见 ≠ 被验证。
- 修复：加 `expect(NPX_E2E_AVAILABLE || TSX_CLI !== null).toBe(true)`。

## 验收 2 — Windows shim：**通过**（附 1 处与 brief 偏差）
- 仅 `win32 && SHELL_SHIMS.has(command)` 才 `shell:true`（`packages/tools/src/mcp/McpClient.ts:45-54`）；构造器只在 `opts.shell` 时传 shell（`:84`）；全仓无无条件 shell（`connections.ts:79-84` 的 shell 来自该解析器）。
- 三态测试齐备：win32 白名单内 `:287,:302-306`、非 win32 `:288-289`、白名单外含 `.cmd` `:292-300`。
- **偏差**：brief §27 要求非白名单"`npx`→`npx.cmd` 直连 spawn"，实现无后缀回退；Node 安全修复后 `spawn('x.cmd')` 无 shell 会 EINVAL，而 `:296-299` 把该不可用路径断言成正确行为。修复：win32+非白名单+`.cmd/.bat` 明确报错，或按 brief 回退。

## 验收 3 — 降级四断言：**无法判定（无仓内测试）**，代码层成立
- `packages/application/src/compose.ts:257-274`：逐连接 try/catch（(a) 不抛）、`:268-269` warn+`mcpFailures` 名与 reason（(b)）、`:263` 仅 `initialize` 成功后才注册（(c) 失败 server 无 `mcp__*`）、registry `:248` 已装内置工具且循环不改它（(d)）。
- 但 `mcpFailures|createMcpConnections|McpConfigStore|applyMcpConnections` 在全部 `*.test.ts` **零命中**：四断言无机器证据。指挥 CLI E2E 只间接覆盖 (a)(b)（exit 0 + 「已跳过」），文本证不了 (c)(d)。须补一条 `composeHarness({mcp:[坏连接]})` 单测断言四件事。

## 验收 4 — 配置 fail-loud：**通过**（测试未提交）
- 读取期即抛：JSON `apps/cli/src/mcp/config.ts:224`、根非对象 `:228`、`servers` 非数组 `:233`、重复名 `:243`、逐项 `:137-181`；ENOENT→`[]` `:216`；其余 IO 上抛 `:217`；根解析 `opts>env>~/.vessel` `:195`，空 env 视为未设置 `:90-95`（不落 CWD）。
- `apps/cli/src/mcp/config.test.ts`（355 行）覆盖 ①→⑨，文案与实现逐字对上。**风险**：`git status` 为 `??`，按 HEAD 交付即丢失覆盖 → 纳入提交。

## 验收 5 — 无重复 spawn：**不通过**（2 处真实缺陷 + 无测试）
- 正常路径成立：`apps/cli/src/tui/chat.ts:464-471` 先 close 再重建；链 `compose.ts:389-391` → `McpClient.close()`（`McpClient.ts:182-184`）→ `StdioTransport.close()`（`:137-150`）。"不加缓存"理由成立：缓存会交出 `closed=true` 的 transport（`:129` 恒 reject）。
- **缺陷 A（收尸形同虚设）**：`close()` 在 `:142` 布 2s SIGKILL，却只等 50ms 就 resolve，`:149` **clearTimeout 取消该 SIGKILL**；`:139` 已置 `closed=true` 后续调用直接 return → 不在 50ms 自退的 server 永久成孤儿。E2E 未暴露是因为 `closeAndAssertReaped`/`reap`（`:225-232`/`:129-144`）**在 transport 之外自补 SIGKILL**，测试在替被测代码兜底。修复：等待 exit 期间不要提前 clearTimeout。
- **缺陷 B（重建失败后工具假活）**：`chat.ts:479` 回滚把已 close 的 `previous` 放回 `harness`，其 mcpClients 已死但 registry 仍列 `mcp__*` → 工具可见、调用必 reject。修复：回滚分支可见提示或不复用旧 MCP 工具。
- 次要：`apps/cli/src/cli.ts:332` 已 spawn，`:338 composeHarness` 抛错无 close 兜底（TUI 有）。
- 重建路径零测试（指挥 E2E 是单次 `run`，触发不到 `/permission` 重建）。

## 安全 / 回归
- **args 注入面仍在**：白名单只约束 command；win32+shell 下 args 交 cmd.exe 二次解析（`McpClient.ts:84`），`["tsx","x.ts","& calc"]` 仍可注入。mcp.json 是用户自有文件 → 中低，但"仅靠白名单避免注入"不完全成立。
- `env` 不外泄：reason 只取 `err.message`（`connections.ts:88`、`compose.ts:266`），配置报错只出类型/键名；子进程 stderr 被丢弃（`McpClient.ts:115-117`）——不泄密，但也抹掉 server 自报原因（与"可见"张力）。
- 回归：`compose.ts:262` 新增 `await client.initialize()` 是真行为变化——不实现 initialize 的自定义 transport 由"注册成功"变"warn+跳过"。既有 in-process 路径（`benchmarks/runners/src/runner.ts:305-311` + `echoServerCore.ts:33`）已实现 initialize，无 benchmark 回归；`mcpFailures` 可选且 `ComposedHarness` 仅由 `composeHarness` 构造，零影响。
- **未实现**：brief 错误场景"server 存活但不响应 initialize → 超时降级且可见"缺失——`McpClient.initialize()`（`:165-171`）与 `StdioTransport.request()`（`:128-135`）无超时/AbortSignal，静默 server 让 `composeHarness` **永久挂起**（CLI/TUI 卡死无提示），且缺陷 A 令既有 2s 兜底也不可能生效。

## 结论：**REJECT**（窄口径：2 缺陷 + 必需测试缺失；E2E 非假绿，验收 2/4 扎实）
**必须补齐（按严重度）**
1. `StdioTransport.close()` 不得在 50ms 乐观 resolve 时取消 SIGKILL；返回时子进程必已死。
2. `initialize()` 加超时并走降级，补"存活但不响应"测试。
3. 补验收 3 四断言单测 + 验收 5 重建无累积子进程测试。
4. 提交 `config.test.ts`；E2E 加"至少一条真进程路径可用"硬断言。
5. `cli.ts` 抛错路径补 close 兜底；win32 非白名单 `.cmd/.bat` fail loud 或按 brief 回退。
