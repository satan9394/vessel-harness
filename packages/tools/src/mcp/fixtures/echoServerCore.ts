/**
 * Local stdio MCP demo server core (MISSION V0.2-M4).
 * Pure protocol logic shared by the runnable stdio server (echo-server.ts)
 * and the in-process test transport. Tools: echo / add.
 */
export interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_DEMO_TOOLS: McpToolDescriptor[] = [
  {
    name: 'echo',
    description: '回显输入文本',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'add',
    description: '两个整数相加',
    inputSchema: {
      type: 'object',
      properties: { a: { type: 'number' }, b: { type: 'number' } },
      required: ['a', 'b'],
    },
  },
];

/** Handle one JSON-RPC request (method/params) → result payload. */
export function handleMcpRequest(method: string, params: unknown): unknown {
  const p = (params ?? {}) as Record<string, unknown>;
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'echo-server', version: '1.0.0' },
      };
    case 'tools/list':
      return { tools: MCP_DEMO_TOOLS };
    case 'tools/call': {
      const name = String(p.name ?? '');
      const args = (p.arguments ?? {}) as Record<string, unknown>;
      if (name === 'echo') {
        return { content: [{ type: 'text', text: String(args.text ?? '') }] };
      }
      if (name === 'add') {
        const a = Number(args.a ?? 0);
        const b = Number(args.b ?? 0);
        return { content: [{ type: 'text', text: String(a + b) }] };
      }
      throw new Error(`unknown tool: ${name}`);
    }
    case 'notifications/initialized':
      return null;
    default:
      throw new Error(`unknown method: ${method}`);
  }
}
