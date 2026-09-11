# IMPLEMENTATION-BRIEF-13 — CLI 面 MCP 配置入口（G-11 之 MCP 半，P2）

> Round 13 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-11 + MCP 落点侦察（本题独立侦察，结论见下）。
> **定位：把"已有能力的出口"接上**，不是新能力。库级管道早已通（`compose.ts` 的 `mcp` + `registerMcpTools` + `mcp__<server>__<tool>` 命名），但 `apps/cli` 内 `grep Mcp|MCP` **零命中**——用户只能编程接入。

## 目标

1. 用户能用 `~/.vessel/mcp.json` 声明 MCP server，`vessel run` 与 TUI 生效。
2. 扩 `StdioTransport` 支持任意 command（当前只认 `process.execPath`）。
3. 单个 server 起不来**降级但不静默**（可见、可判定、可解释）。

## 用户场景

用户想接一个 MCP server（如 `npx -y @some/mcp-server`）→ 现状：**无任何 CLI 入口**，只能改代码。期望：写 `~/.vessel/mcp.json`，跑 `vessel run --prompt "..."` 后模型能调用 `mcp__<name>__<tool>`；server 配错时看到**明确的降级提示**（含 server 名与原因），其余工具照常可用。

## 当前问题（证据，来自侦察）

- `packages/tools/src/mcp/McpClient.ts:48-52`：`StdioTransport` 硬编码 `spawn(process.execPath, [serverPath, ...args])` → 只能跑 Node 脚本，**无法跑 `npx`/任意命令**。**爆炸半径 0**：全仓 `new StdioTransport` 零命中（benchmark 走 in-process transport）。
- `apps/cli` 内零 MCP 引用（`cli.ts` 约 `:284-298` 的 `composeOpts`、`chat.ts:320-333` 的 `buildHarness` 都无 `mcp:`）。
- `McpClient.ts:53`：`input: child.stdout ?? process.stdin` —— stdout 缺失时**静默 fallback 到本进程 stdin**（永远读不到行，只能等 `close()` 的 2s 兜底）→ 需改为**显式 throw**。
- Windows：`spawn('npx')` 无 shell 会 ENOENT（`npx.cmd` shim）。仓库既有解法见 `run-release-gates.ts:83-96`（`shell:true`）、`shellTool.ts:70`。
- **最易漏的资源泄漏**：`buildHarness` 会被 `/permission`、`/model` 变更**重建**（`chat.ts` 约 `:290`）→ 若每次新建 transport，server 会被**重复 spawn**；须由 `harness.close()`（`compose.ts:365`）回收，或在 `buildHarness` 外层缓存连接。

## 理想行为

1. **`StdioTransport` 扩签名**：`constructor(command: string, args: string[] = [], opts?: { env?; cwd?; shell? })` → `spawn(command, args, { stdio, windowsHide: true, ...(shell ? { shell: true } : {}), env: env ? { ...process.env, ...env } : undefined, cwd })`。旧的 `node serverPath` 语义由调用方显式传 `process.execPath`（**保持向后兼容**）。
2. **Windows 命令解析**：**不要无条件 `shell: true`**（args 会被二次解析 → 来自用户配置的参数失控 = 命令注入风险）。仅对白名单命令（`npx`/`npm`/`pnpm`/`yarn`/`uvx`）在 win32 下用 `shell: true`，其余按 `npx` → `npx.cmd` 方式直连 `spawn`；请在回复里说明你的取舍。
3. **`input` 兜底改显式**：`child.stdout` 缺失时 **throw**（不要 fallback 到 `process.stdin`）。
4. **配置文件** `~/.vessel/mcp.json`（root 解析 `VESSEL_MCP_ROOT` > `~/.vessel`）：形如 `{ "servers": [ { "name": "demo", "command": "npx", "args": ["-y", "..."], "env": {} } ] }`。
   - **照抄 `ProviderStore.ts` 的范式**：root/env 覆盖（`:200-213`，**显式 opts 优先于 env**）、路径 getter、`writeJsonAtomic`（`:485-491`，`.tmp` + `renameWithRetry`）、损坏策略（ENOENT → 空表不报错；JSON/结构非法 → **fail-loud throw**）、逐项校验（`:628-673` 的 `assertValid` 风格）。
   - **不要**照抄备份轮转与凭据解析（过度设计）。
   - **重复 server name 在读取时就 throw**（不要等到 `Registry.register` 的 `tool already registered` 才炸）。
5. **接线**：`cli.ts` 的 `composeOpts` 与 `chat.ts` 的 `buildHarness` 各加 `mcp:`（类型见 `compose.ts:35-37`，只需构造 `{ serverName, transport }`）。
6. **降级语义（分区，不一刀切）**：
   - 配置结构非法 → **fail-loud**（对齐 ProviderStore 口径）；
   - **单个 server 起不来/initialize 失败 → 降级**：`console.warn` 含 **server 名 + 原因**，跳过该 server，其余照常；返回可判定结构（如 `{ serverName, ok: false, reason }` 列表）并打印。
   - **禁止静默 catch**（本仓反复踩过"文案说接上了、实际没接"的假绿）。

## 涉及模块

`packages/tools/src/mcp/McpClient.ts`（传输层）、新增 `apps/cli/src/mcp/config.ts`（读取器）、`apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`、相应测试。

## 不能破坏什么

- `sanitizeErrorBody` 无关；本切片不碰 `packages/llm`。
- 既有 in-process transport 路径与 benchmark（`runner.ts:305-309`）行为不变。
- `tsc -b` 0；全量 `vitest`（现 **126 文件 / 1325+ passed + 1 skipped**）全绿。
- 测试隔离（AGENTS.md §8）：注入 `VESSEL_MCP_ROOT`；不碰真实 `~/.vessel`。
- 无新依赖。

## 验收标准（**必须真跨进程**）

1. **端到端（判别性）**：临时 root 写 `mcp.json` 指向 `packages/tools/src/mcp/fixtures/echo-server.ts`（**真 spawn**）→ `registry.listVisible()` 含 `mcp__demo__add`，**且** `execute({ toolName: 'mcp__demo__add', arguments: { a: 20, b: 22 } })` 返回 `content === '42'`、`error === undefined`。
   - **必须证明走的是 `StdioTransport`（真子进程）**，不得用 `createInProcessTransport`/`handleMcpRequest` 冒充（那等于绕过本切片唯一的硬缺口）。
2. **Windows shim 判别**：win32 下 `command: 'npx'` 能成功（非 win32 skip 并注明）。
3. **降级四断言**：(a) `composeHarness` **不抛**；(b) 降级列表含该 server 且 `reason` 非空；(c) registry 内**无** `mcp__*`；(d) 内置工具（如 `Read`）**仍可见**。
4. **配置 fail-loud**：`mcp.json` 非法 JSON / 结构非法 / **重复 server 名** → 明确报错（读取期即抛）。
5. **无重复 spawn**：`/permission` 或 `/model` 触发 harness 重建后，**不应**出现同 server 的多个存活子进程（给出你的验证方式与结论）。
6. `tsc -b` 0；全量 vitest 绿。

## 错误场景

- command 不存在 → 降级 + 明确原因（不得挂起）。
- server 启动后不响应 `initialize` → 超时降级（复用既有 `close()` 2s 兜底语义，但**必须可见**）。
- `VESSEL_MCP_ROOT` 指向不可写位置 → 读取报错、不影响其它功能。

## 测试要求

- 小卡串行（传输层 → 读取器 → 接线 → 测试）；执行器不跑命令，由指挥复跑 `tsc` + 全量 vitest + **真实 CLI E2E**（临时 root + echo-server，跑 `vessel run` 后确认工具可见/可执行；另跑一条坏配置确认降级可见）。
- 完成后交独立静态 Evaluator 复核（重点：验收 1 是否真跨进程、验收 5 的 spawn 泄漏是否真被处置）。
