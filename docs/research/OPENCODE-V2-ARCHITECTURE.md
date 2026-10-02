# OpenCode V2 系列（v2.0.x / 2.0.20）核心架构演进与内存治理机制深度调研与技术备份

> 编制日期：2026-10-01  
> 状态：规范归档 / 参考备份（docs/research 权威技术资产）  
> 关联：`Notes/2026/09/NOTES_20260929.md`、`NOTES_20260930.md`、`packages/tools/src/mcp/`、`packages/runtime/src/sandbox/backend/`

---

## 1. 调研背景与历史痛点剖析

在 OpenCode 2.0.x（尤其是升级至 2.0.19 / 2.0.20 之前）的实际工程落地与长周期服务运行中，本地常驻服务（`opencode serve --service`）曾面临极为严重的进程与内存膨胀问题。

### 1.1 2.7GB MCP 进程泄漏真实案例（2026-09-29 事故取证）
在本地连续排障与服务重载（`opencode reload`）过程中，系统进程数由 341 激增至 383，可用物理内存由 6.48GB 跌至 5.85GB。经深入追查父子进程树，锁定真凶为 OpenCode 自身派生的 MCP 子进程群：
- `mcp-server-windows-x64.exe`（Pencil MCP）：**19 个副本**（~172MB）
- `cmd.exe`（用于拉起 shim 的命令解释器）：**19 个副本**（~169MB）
- `node.exe`（Chrome DevTools MCP）：**19 个副本**（~2029MB，单实例约 112MB）
- `conhost.exe`（控制台宿主）：**45 个副本**（~296MB）
- **内存总计白白吞噬 2.7GB**。

### 1.2 泄漏底层根因：重载断连与孤儿进程树
在传统 Node.js 子进程管理中：
1. **Windows 管道断开无法级联杀死子孙进程**：通过 `child.kill('SIGKILL')` 仅向直接子进程发出 `TerminateProcess`。若 MCP Server 经由 `.cmd` 批处理 shim 启动（如 `npx` 或 npm 全局包），直接子进程为 `cmd.exe`，`cmd.exe` 被杀后，其所派生的真实目标进程（如 `node.exe`、`chrome-devtools-mcp`）脱离父进程管控，变为孤儿进程常驻。
2. **Reload 仅重建上层客户端连接，未做底层收尸**：旧版在执行 reload 时，仅在内存中抛弃或重新实例化 MCP 客户端连接，既有管道的 stdio 关闭无法驱动外部第三方 MCP 服务可靠自尽，导致每次 reload 均全量再派生一批新实例。

---

## 2. OpenCode V2 核心架构演进与治理机制

OpenCode 在 V2.0 系列中全面重构了配置重载、进程拓扑、内存管控与插件扩展机制，核心演进归纳为以下四大维度：

### 2.1 规范化位置重载与显式进程级联清理（`/api/location/reload`）
OpenCode V2 在服务端正式引入了确定的重载契约：
```json
{
  "post": {
    "tags": ["location"],
    "operationId": "location.reload",
    "summary": "Reload configuration",
    "description": "Shut down and rebuild every loaded location. Pending permissions and forms are cancelled; running sessions continue with fresh services at the next step boundary. Emits location.shutdown for client recovery and responds once all replacement builds settle."
  }
}
```
- **两阶段重载契约**：先广播 `location.shutdown`，强制取消所有挂起的交互权限请求与表单；
- **子进程收尸闭环**：对所有活动连接发起有序关闭（`stdin.end()` 发送 EOF -> 50ms 优雅退出宽限 -> 2000ms 强制 `SIGKILL` 兜底定时器），且在 Windows 下将子进程严格挂载至内核 Job Object。

### 2.2 配置级 `disabled` 停用标记与按需延迟唤醒（Lazy Waking）
针对本地低频或重型 MCP 工具（如 `chrome-devtools`、`pencil`），V2 确立了配置规范：
1. **配置语义原生支持 `disabled`**：
   ```json
   {
     "mcp": {
       "servers": {
         "pencil": {
           "command": "C:\\Users\\...\\mcp-server-windows-x64.exe",
           "disabled": true
         },
         "chrome-devtools": {
           "command": "chrome-devtools-mcp.cmd",
           "args": ["--no-usage-statistics"],
           "disabled": true
         }
       }
     }
   }
   ```
2. **延迟唤醒代理（Lazy Proxy）**：
   - 启动时仅加载工具名称与静态 Schema 描述符（或读取缓存的 Manifest），不立即 `spawn` 真实进程；
   - 首次命中 `tools/call` 或具体工具调用时，按需懒拉起（On-Demand Spawn）；空闲超时后自动回收。

### 2.3 内存驻留与事件流优化（Event Streaming & Bounded Payloads）
- **会话增量流式化**：摒弃将数万行 JSONL 全量驻留在 Node.js V8 堆内存的做法，改为基于 SQLite WAL 或流式只读读取，降低大上下文长对话下的 GC 停顿与内存驻留；
- **工具输出与媒体载荷边界控制（Bounded Payloads）**：对工具执行返回的标准输出/错误流（stdout/stderr）进行行级和字节级截断（例如默认 32KB/64KB 阈值），防止大文件读取倾倒瞬间撑爆 V8 堆。

### 2.4 插件体系解耦：零宿主导入与鸭子类型（Zero-Host Import）
- **无宿主核心依赖（Zero-Host Import）**：插件模块不得直接 `import { ... } from '@opencode/core'`，而是通过宿主在调用生命周期 Hook 时注入的 Context 对象进行交互；
- **强类型 Hook 拦截域**：将 Hook 严格划分为 `before_tool_call`、`after_tool_call`、`on_event` 等细分域，各域采用明确的策略聚合器（Waterfall / Short-circuit），任何插件内部未捕获异常均有 Fail-Closed 隔离保护。

---

## 3. 对 Vessel_Harness 的直接技术借鉴与落地方案

在 Vessel_Harness 现有架构中：
- `packages/tools/src/mcp/McpClient.ts` 已具备优雅关闭与 `SIGKILL` 2s 兜底，但其 `StdioTransport` 尚未与 Windows Job Object 内核级沙箱打通；
- `packages/runtime/src/sandbox/backend/windows-job-object.ts` 已经拥有成熟的 Windows Job Object 封装（支持 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`），目前仅在 Sandbox 隔离环境与 Outbound 子代理中使用，未赋能给 MCP StdioTransport；
- `vessel mcp` 配置体系与运行时尚未支持 `disabled` 字段，导致配置即启动；
- 工具输出截断尚未形成规范化治理。

### 3.1 核心参考代码备份：带 Windows Job Object 保护的 StdioTransport
以下为经 Clean-Room 适配、适用于 Vessel `packages/tools/src/mcp/` 的参考实现架构：

```typescript
import { spawn, type ChildProcess } from 'node:child_process';
import * as readline from 'node:readline';
import { WindowsJobObject } from '@vessel/runtime/sandbox'; // 复用既有内核沙箱

export interface SecureStdioOptions {
  env?: Record<string, string>;
  cwd?: string;
  shell?: boolean;
  useJobObject?: boolean; // 在 Windows 下默认开启
}

export class BoundedStdioTransport {
  private child: ChildProcess;
  private jobObject?: WindowsJobObject;
  private closed = false;

  constructor(command: string, args: string[], opts: SecureStdioOptions = {}) {
    const isWin = process.platform === 'win32';
    this.child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: opts.shell ?? false,
      windowsHide: true,
    });

    // Windows 平台绑定 Job Object，实现父进程消亡或 close 时秒级连根拔起整棵进程树
    if (isWin && (opts.useJobObject ?? true) && this.child.pid) {
      try {
        this.jobObject = new WindowsJobObject();
        this.jobObject.assignProcess(this.child.pid);
      } catch (err) {
        // 降级容错并记录审计
        console.warn(`[MCP] Failed to bind PID ${this.child.pid} to Job Object:`, err);
      }
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // 1. 关闭标准输入触发常规退出
    this.child.stdin?.end();

    // 2. 双重关停：若存在 Job Object，直接关闭 Job 句柄（触发内核级整树秒杀）
    if (this.jobObject) {
      try {
        await this.jobObject.terminate(0);
      } catch {
        /* ignore */
      }
    }

    // 3. 常规进程级 SIGKILL 兜底
    const killTimer = setTimeout(() => {
      try {
        this.child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, 2000);
    this.child.once('exit', () => clearTimeout(killTimer));
  }
}
```

### 3.2 核心参考代码备份：延迟唤醒 MCP 客户端代理（Lazy Proxy）
```typescript
import type { McpClient, McpToolDescriptor } from './McpClient.js';

export class LazyMcpClientProxy {
  private activeClient: McpClient | null = null;
  private readonly factory: () => Promise<McpClient>;
  private cachedDescriptors: McpToolDescriptor[] | null = null;

  constructor(factory: () => Promise<McpClient>, initialDescriptors?: McpToolDescriptor[]) {
    this.factory = factory;
    this.cachedDescriptors = initialDescriptors ?? null;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    if (this.cachedDescriptors) {
      return this.cachedDescriptors;
    }
    const client = await this.ensureClient();
    this.cachedDescriptors = await client.listTools();
    return this.cachedDescriptors;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const client = await this.ensureClient();
    return client.callTool(name, args);
  }

  private async ensureClient(): Promise<McpClient> {
    if (!this.activeClient) {
      this.activeClient = await this.factory();
    }
    return this.activeClient;
  }

  async close(): Promise<void> {
    if (this.activeClient) {
      await this.activeClient.close();
      this.activeClient = null;
    }
  }
}
```
