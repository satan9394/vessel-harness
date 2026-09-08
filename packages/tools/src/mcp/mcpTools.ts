import type { ToolExecutionResult, ToolInputSchema, ToolSpec } from '@vessel/shared';
import type { ToolRegistry } from '../registry/Registry.js';
import type { McpClient, McpToolDescriptor } from './McpClient.js';

export interface RegisteredMcpTool {
  /** canonical name: mcp__<server>__<tool> (ARCHITECTURE §6.3 / D3 decision point 7) */
  name: string;
  tool: ToolSpec;
}

/**
 * tools/mcp — dynamic MCP tool registration (ARCHITECTURE §4.5 tools/mcp,
 * MISSION V0.2-M4). Remote tools register into the SAME registry as builtin
 * tools, so they flow through the same pipeline: BeforeTool → Policy Engine
 * → Execute → AfterTool. Deny rules / denied_tools on `mcp__<server>__<tool>`
 * names therefore apply like any other tool.
 */
export async function registerMcpTools(
  registry: ToolRegistry,
  serverName: string,
  client: McpClient,
): Promise<RegisteredMcpTool[]> {
  const descriptors = await client.listTools();
  const registered: RegisteredMcpTool[] = [];
  for (const desc of descriptors) {
    const tool = mcpToolToSpec(serverName, desc, client);
    registry.register(tool);
    registered.push({ name: tool.name, tool });
  }
  return registered;
}

export function mcpToolToSpec(serverName: string, desc: McpToolDescriptor, client: McpClient): ToolSpec {
  const name = `mcp__${serverName}__${desc.name}`;
  const inputSchema: ToolInputSchema = {
    type: 'object',
    properties: (desc.inputSchema?.properties as Record<string, unknown>) ?? {},
    required: Array.isArray(desc.inputSchema?.required) ? desc.inputSchema.required.map(String) : undefined,
  };
  return {
    name,
    description: desc.description ? `[MCP ${serverName}] ${desc.description}` : `MCP tool ${desc.name} from ${serverName}`,
    family: 'other',
    // MCP tools default to workspace-write; policy rules can narrow/deny per name
    requiredPermission: 'workspace-write',
    exclusive: false,
    inputSchema,
    async execute(args, ctx) {
      try {
        // task 050 boundary: don't start a new RPC once the turn is interrupted
        if (ctx?.signal?.aborted) {
          return interruptedResult(serverName, desc.name);
        }
        const res = await withSignal(client.callTool(desc.name, args), ctx?.signal);
        const text = (res.content ?? [])
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text)
          .join('\n');
        return {
          content: text || '(no text content)',
          error: res.isError ? { errorClass: 'TOOL_FAILURE', message: 'MCP tool returned isError' } : undefined,
          meta: { mcpServer: serverName, mcpTool: desc.name },
        };
      } catch (err) {
        if (ctx?.signal?.aborted) return interruptedResult(serverName, desc.name);
        return {
          content: '',
          error: { errorClass: 'TOOL_FAILURE', message: `MCP call failed (${serverName}/${desc.name}): ${(err as Error).message}` },
          meta: { mcpServer: serverName, mcpTool: desc.name },
        };
      }
    },
  };
}

/** Tool result used when the turn was interrupted before/during the MCP call. */
function interruptedResult(serverName: string, toolName: string): ToolExecutionResult {
  return {
    content: '',
    error: { errorClass: 'TOOL_FAILURE', message: 'interrupted' },
    meta: { mcpServer: serverName, mcpTool: toolName, interrupted: true },
  };
}

/**
 * Race a promise against a turn signal (task 050). When the signal aborts
 * first, the caller's await rejects ('interrupted') instead of waiting out a
 * possibly long RPC; the underlying request keeps running best-effort and its
 * late resolution is discarded (no unhandled rejection — handlers attached).
 */
function withSignal<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new Error('interrupted'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('interrupted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}
