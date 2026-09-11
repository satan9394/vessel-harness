import { StdioTransport, resolveSpawnCommand } from '@vessel/tools';

/**
 * packages/application/src/mcp/connections.ts — MCP 声明 → compose 可消费连接的桥接
 * （G-11 MCP 半 / BRIEF-13）。
 *
 * ## 为什么这个桥接放在 application，而不是 apps/cli
 *
 * 构造 transport 需要 `import { StdioTransport, resolveSpawnCommand } from '@vessel/tools'`，
 * 这是一条**依赖边**：桥接放在哪个包，就要求哪个包在 package.json 里声明 `@vessel/tools`。
 *
 *   - `apps/cli/package.json` 只声明 `@vessel/application` 与 `@vessel/local-server`
 *     （AGENTS.md 硬性约束 5「模块化单体、依赖零环」）。在 apps/cli 里构造 transport
 *     等于凭空新增 `apps/cli → @vessel/tools` 的边，且与"进程入口只做组合"的分层相悖。
 *   - `packages/application` **已经合法依赖** `@vessel/tools`（`compose.ts:5` 就在导入
 *     `McpClient` / `registerMcpTools` / `McpTransport`）。把构造放这里，
 *     **不新增任何依赖边**，只是把已有的边用起来。
 *
 * 职责因此切成三段，各自单一：
 *
 *   1. `apps/cli/src/mcp/config.ts`：只读**可序列化声明**（`~/.vessel/mcp.json`）并校验，
 *      不 import `@vessel/tools`；
 *   2. 本模块：声明 → `StdioTransport`（唯一的 `@vessel/tools` 接触点）；
 *   3. `compose.ts:246-250`：`new McpClient(conn.transport, conn.serverName)` 消费，
 *      形状即 `ComposeMcpConnection { serverName, transport }`（`compose.ts:35-38`）。
 *
 * ## 失败语义（BRIEF-13）：单个 server 失败 → 降级但不静默
 *
 * 每个 server **单独 try/catch**：抛错只把该 server 记进 `failures`（含原因），
 * 其余 server 照常返回连接。一个坏的 MCP server 不能拖垮整个 harness 启动。
 *
 * 但"降级"必须**可见**：`failures` 随结果一起返回，调用方负责把它打印出来
 * （本模块是纯函数，不 `console.warn`、不写 stderr、不读全局状态——输出通道由调用方
 * 决定，与仓库 `cmdSessionsList` 的 io seam 风格一致）。
 *
 * 配置本身非法（缺 name/command、args 非字符串数组、重复 name…）由读取器在更早阶段
 * fail-loud（见 `apps/cli/src/mcp/config.ts` 的文件头），不在这里兜底重校验。
 */

/** 一个 MCP server 的声明式描述（与 apps/cli/src/mcp/config.ts 的 McpServerConfig 结构兼容）。 */
export interface McpServerDescriptor {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** 建立失败但已降级的 server：`reason` 是原始错误的 message，供调用方原样展示。 */
export interface McpConnectionFailure {
  serverName: string;
  reason: string;
}

/** 成功建立的连接 / 建立失败但已降级的 server。 */
export interface McpConnectionsResult {
  connections: { serverName: string; transport: StdioTransport }[];
  failures: McpConnectionFailure[];
}

/**
 * 把声明式描述变成 compose 可消费的连接。
 *
 * 失败语义（BRIEF-13）：**单个 server 建立失败 → 降级但不静默**——
 * 该 server 进 `failures`（含原因），其余照常返回；调用方负责把 failures 打印出来。
 * 配置本身非法由读取器在更早阶段 fail-loud，不在这里兜。
 *
 * 纯函数：不打印、不抛（除非入参本身不是数组这类调用方 bug）、不改入参。
 */
export function createMcpConnections(servers: McpServerDescriptor[]): McpConnectionsResult {
  const connections: McpConnectionsResult['connections'] = [];
  const failures: McpConnectionFailure[] = [];

  for (const s of servers) {
    // 每个 server 独立作用域：任一环节抛错都被本层的 catch 收住，
    // 循环继续跑下一个 server（单点失败不传播）。
    try {
      // win32 下 npx/npm/pnpm/yarn/uvx 是 .cmd shim，需 shell: true；其余直连 spawn。
      const { command, shell } = resolveSpawnCommand(s.command);
      const transport = new StdioTransport(command, s.args ?? [], {
        shell,
        env: s.env,
        cwd: s.cwd,
      });
      connections.push({ serverName: s.name, transport });
    } catch (err) {
      // 不 rethrow、不打印：记下原因，交给调用方决定输出通道。
      failures.push({ serverName: s.name, reason: (err as Error).message });
    }
  }

  return { connections, failures };
}
