/**
 * Local stdio MCP demo server (MISSION V0.2-M4) — runnable fixture.
 * Speaks JSON-RPC 2.0 over stdin/stdout (line-delimited), the MCP stdio
 * transport shape. Run with:
 *   npx tsx packages/tools/src/mcp/fixtures/echo-server.ts
 * (after `npm run build`, also: node packages/tools/dist/mcp/fixtures/echo-server.js)
 */
import * as readline from 'node:readline';
import { handleMcpRequest } from './echoServerCore.js';

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg: { id?: unknown; method?: string; params?: unknown } | null = null;
  try {
    msg = JSON.parse(trimmed) as { id?: unknown; method?: string; params?: unknown };
  } catch {
    return; // malformed frame — ignore
  }
  if (msg.id === undefined) return; // notification — no reply
  const reply: Record<string, unknown> = { jsonrpc: '2.0', id: msg.id };
  try {
    reply.result = handleMcpRequest(String(msg.method ?? ''), msg.params);
  } catch (err) {
    reply.error = { code: -32601, message: (err as Error).message };
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
});

rl.on('close', () => {
  process.exit(0);
});
