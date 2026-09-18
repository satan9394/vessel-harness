import { createMcpConnections, type ComposeMcpConnection, type McpConnectionFailure } from '@vessel/application';
import { windowsShimHint } from '../windowsShim.js';
import { McpConfigStore, type McpServerConfig } from './config.js';

/**
 * 装配 MCP 连接的**唯一实现**（G-11 / BRIEF-13）。
 *
 * 此前 `cli.ts` 的 `applyMcpConnections` 与 `tui/chat.ts` 的 `loadMcpConnections` 是**两份同款实现**
 * （load servers → win32 shim 分区 → `createMcpConnections` → 汇总 failures），只差错误策略与返回形状
 * —— 正是本仓反复收敛过的「两份实现会无声分叉」类（对照 `windowsShimHint` 的收敛）。
 * 现收敛到这里，调用方只决定**错误策略**：
 *
 *  - CLI：配置损坏 ⇒ fail-loud（把 message 交回调用方，由它决定 exit 1）；
 *  - TUI：配置损坏 ⇒ 只告警、按"没配"继续，不阻断会话。
 *
 * 非致命失败（win32 下 `.cmd`/`.bat` 非 spawn、单个 server 起不来）一律进 `failures`，由调用方打印。
 */

export interface McpAssemblyOk {
  ok: true;
  connections: ComposeMcpConnection[];
  /** 非致命：win32 shim 不可 spawn + `createMcpConnections` 报的逐 server 失败。 */
  failures: McpConnectionFailure[];
}
export interface McpAssemblyErr {
  ok: false;
  /** `McpConfigStore.load()` 的 fail-loud 消息（JSON 损坏 / 结构非法 / 重名）。 */
  message: string;
}
export type McpAssembly = McpAssemblyOk | McpAssemblyErr;

/**
 * 读取并装配 MCP 连接。**不抛**：配置损坏返回 `{ok:false}`，非致命失败进 `failures`。
 * `load` 可注入（测试用）；缺省读 `~/.vessel/mcp.json`（经 `McpConfigStore`）。
 */
export function assembleMcpConnections(load: () => McpServerConfig[] = () => new McpConfigStore().load()): McpAssembly {
  let servers: McpServerConfig[];
  try {
    servers = load();
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
  if (servers.length === 0) return { ok: true, connections: [], failures: [] };

  // win32 下非可执行的 `.cmd`/`.bat` 不 spawn（注释失败），直接计入 failures；
  // 未声明的其它命令照常交给 createMcpConnections（不猜原因）。
  const spawnable: McpServerConfig[] = [];
  const shimFailures: McpConnectionFailure[] = [];
  for (const s of servers) {
    const hint = windowsShimHint(s.command);
    if (hint === null) spawnable.push(s);
    else shimFailures.push({ serverName: s.name, reason: hint });
  }
  const { connections, failures } = createMcpConnections(spawnable);
  return { ok: true, connections, failures: [...shimFailures, ...failures] };
}
