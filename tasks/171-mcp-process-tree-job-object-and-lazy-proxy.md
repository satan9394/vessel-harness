# 171 — MCP 进程树 Job Object 绑定、disabled 规范化与延迟代理 (MCP Process Tree Confinement & Lazy Proxy)

- 编号：171
- 优先级：P1
- 关联模块：`packages/tools`, `packages/runtime`, `apps/cli`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地交付与全部门禁完成；待用户验收，Git 未提交
- 创建日期：2026-10-01

---

## 1. 目标与意图

在长生命周期与高频重载（Reload）场景下，MCP（Model Context Protocol）工具服务极易出现严重内存泄漏（详见 `docs/research/OPENCODE-V2-ARCHITECTURE.md`）：
1. **Windows 孙进程泄漏**：MCP 服务常通过 `.cmd` 启动（如 `npx`、全局包或批处理文件），单纯对直接子进程调用 `child.kill()` 或关闭标准输入，无法关闭其派生的孙进程（如 `node.exe`、`chrome-devtools-mcp`），导致孤儿进程常驻并堆积至数 GB 内存；
2. **缺乏标准停用态（disabled）**：既有配置只有新增与删除，导致暂时不用的重型 MCP 服务无法按需停用，每次启动都会强行派生并拉起；
3. **即时无条件拉起（Eager Spawn）**：只要配置了 MCP 工具，无论当前会话是否需要，一律在初始化时 `spawn` 进程并握手，造成高昂的启动开销与内存常驻。

本任务旨在借鉴 OpenCode V2 的治理经验，在 Vessel 中落地三大防护：
- **内核级进程树绑定（Windows Job Object）**：在 `StdioTransport` 启动时，若处于 Windows 平台，自动将其挂入既有的 `WindowsJobObject` 内核沙箱，赋予 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 属性；
- **配置级规范化 `disabled` 支持**：扩展 `vessel mcp` CLI 子命令，支持 `vessel mcp disable <name>` 与 `vessel mcp enable <name>`，实现零进程占用的安全休眠；
- **延迟唤醒代理（Lazy Proxy）**：实现 `LazyMcpClientProxy`，在冷启动时仅注册静态 Schema/Manifest，直到首次命中 `callTool` 或按需刷新时才拉起物理进程，并在长时间闲置后支持自动回收。

---

## 2. 接口与契约规范

### 2.1 配置契约扩展 (`apps/cli/src/mcp/config.ts`)

```typescript
export interface McpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** 显式停用标记：为 true 时系统不拉起进程，工具从 Registry 中下线 */
  disabled?: boolean;
}
```

CLI 子命令扩展：
- `vessel mcp disable <name>`：将指定 server 的 `disabled` 置为 `true`，退出码 0（若不存在则退出码 2）；
- `vessel mcp enable <name>`：将指定 server 的 `disabled` 置为 `false`（或删除该字段），退出码 0。

### 2.2 进程树受控传输层 (`packages/tools/src/mcp/BoundedStdioTransport.ts`)

```typescript
export interface BoundedStdioTransportOptions {
  env?: Record<string, string>;
  cwd?: string;
  shell?: boolean;
  /** 是否启用 Windows Job Object 绑定（Windows 下缺省为 true） */
  useJobObject?: boolean;
  /** 关闭后强制 SIGKILL 兜底延迟（默认 2000ms） */
  killTimeoutMs?: number;
}
```
- 在 Windows 下拉起子进程后，若获取到 `child.pid`，同步/异步绑定至 `WindowsJobObject` 句柄；
- 在 `close()` 被调用时，先行关闭 stdin，随后触发 Job Object 终止，最后在 2000ms 后执行二次 `SIGKILL` 兜底，确保整棵孙进程树 100% 被清理。

### 2.3 延迟唤醒 MCP 客户端代理 (`packages/tools/src/mcp/LazyMcpClientProxy.ts`)

```typescript
export class LazyMcpClientProxy implements McpTransport {
  constructor(
    private readonly serverName: string,
    private readonly factory: () => Promise<McpTransport>,
    private readonly staticTools?: McpToolDescriptor[],
  );

  request<T = unknown>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
  /** 获取当前物理进程是否已经处于激活状态 */
  isSpawned(): boolean;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：`packages/core` 保持零侵入，所有 MCP 传输与代理逻辑严格限制在 `packages/tools/src/mcp/` 与 `apps/cli/` 中。
2. **严禁引入 C++ 原生编译依赖**：严禁引入 `node-pty` 或未经验证的第三方原生 npm 扩展，必须完全复用 Vessel 现有基于纯 Node 的 `WindowsJobObject` 实现。
3. **安全删除与临时文件纪律**：测试中创建的临时目录必须位于 `os.tmpdir()` 下且在 `afterEach` 中干净清理。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `packages/tools/src/mcp/boundedStdio.test.ts`：
     - 验证 Windows 平台下子孙进程树能够被连根拔起（无孤儿进程泄漏）；
     - 验证在关闭与异常退出时资源可靠释放。
   - 编写并通过 `packages/tools/src/mcp/lazyProxy.test.ts`：
     - 验证未调用工具前 `isSpawned()` 为 `false`；
     - 验证首次请求自动触发 `factory` 实例化并派生进程；
     - 验证静态 tools 列表缓存时无需拉起进程即可返回列表。
   - 更新并跑通 `apps/cli/src/mcp/mcpCommands.test.ts`：
     - 验证 `vessel mcp disable` / `enable` 状态落盘与往返正确性。
2. **回归门禁**：
   - `npx vitest run packages/tools` 全部通过；
   - `npx tsc -b tsconfig.json` exit 0。

## 5. 交付证据（2026-10-01）

- `BoundedStdioTransport` 继承既有 `StdioTransport`，不复制 JSON-RPC。Windows 使用真实 `createJobObject` 契约；请求等绑定完成，补挂绑定前的子孙进程，检查挂载数量。关闭、退出、绑定失败与处置失败统一收尸；失败回退复用 runtime 的 `defaultKillWindowsTree`。晚到 Job 句柄仍清理，显式 close 传播处置失败。
- `LazyMcpClientProxy` 单飞建连、延迟真实握手、失败后可重试，关闭竞争中的晚到传输仍收尸。配置可携带经校验的 `staticTools`：有清单时 compose 的 initialize/tools/list 均不启动物理进程，首次 tools/call 唤醒；无清单时真实 Schema 发现需要唤醒，不能凭空注册工具。
- `disabled` 布尔字段校验与原子往返；CLI enable/disable、缺失名称 exit 2、list 停用提示；CLI/TUI 共用装配与 application 桥接均跳过停用 server。
- `npx vitest run packages/tools/src/mcp/boundedStdio.test.ts packages/tools/src/mcp/lazyProxy.test.ts`：2 文件，13 passed。进程树使用内存假对象，覆盖预绑定孙进程、部分挂载失败、late attach、dispose 失败、exit/error、请求与定时器清理；清理后假树存活数为 0。不调用真机 Agent 或网络。
- `npx vitest run packages/tools packages/application/src/mcp/connections.test.ts apps/cli/src/mcp packages/runtime/src/proxy/virtualProxy.test.ts`：14 文件，152 passed + 5 skipped（既有 opt-in 探针）；包含真实 compose 冷注册与首次唤醒证据，已在 P1 修复后重跑。
- `npx tsc -b tsconfig.json`、`npm run typecheck:tests`：exit 0。未增加依赖或锁文件。
- 本卡保留既有 Job Object 异步绑定机制与原有最大 30 秒 readiness；attach 期间关闭会先启动 stdio 的 2 秒根进程兜底，再等待晚到句柄完成清理。Epic 最终双 root 全量与 Web build 由 174 顺序执行。
- 对抗评审 P1 修复：部分挂载时先处置 Job 可能杀死父/中间进程，随后按父链枚举看不到逃逸孙进程。现在保留挂载前观测的 PID，错误收尸复用 `terminatePids` 独立处理这些 PID；用 `process.kill(pid, 0)` 验证消失（允许 2 秒异步退出），不能把返回的已终止 PID 列表冒充最终存活度。忠实内存进程图 `123 → 124 → 125` 中删除 `123/124` 后树枚举确实找不到 `125`，保留 PID 收尸仍消灭 `125`；拒绝终止的负例明确让 close 失败。

已验收（2026-10-27 对账，仅本地 mock 进程树契约、延迟唤醒与 enable/disable 往返；本次定向 MCP/CLI/装配与 adaptiveCompaction 共 5 文件 58 passed + 2 skipped，exit 0，完整命令见卡 354 Result / `t8-v15-a.log`；源码 `packages/tools/src/mcp/BoundedStdioTransport.ts:13`、`packages/tools/src/mcp/LazyMcpClientProxy.ts:4`；真实 Windows 进程树/原生 2 秒时延仍未由这些 mock 测试建立，原有限制保留。）
