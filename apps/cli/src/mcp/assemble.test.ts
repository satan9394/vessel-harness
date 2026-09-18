import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleMcpConnections } from './assemble.js';
import type { McpServerConfig } from './config.js';

const CLI_SRC = fileURLToPath(new URL('../cli.ts', import.meta.url));
const CHAT_SRC = fileURLToPath(new URL('../tui/chat.ts', import.meta.url));
const ASSEMBLE_SRC = fileURLToPath(new URL('./assemble.ts', import.meta.url));

describe('mcp/assemble — 唯一装配实现', () => {
  it('无 server ⇒ ok 且空连接/空失败', () => {
    const res = assembleMcpConnections(() => []);
    expect(res).toEqual({ ok: true, connections: [], failures: [] });
  });

  it('load 抛错（配置损坏）⇒ ok:false + message（由调用方决定 fail-loud 还是告警）', () => {
    const res = assembleMcpConnections(() => {
      throw new Error('mcp file corrupted (invalid JSON)');
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toContain('corrupted');
  });

  it('正常 server ⇒ 建出连接、无失败', () => {
    const servers: McpServerConfig[] = [{ name: 'demo', command: 'node', args: ['server.js'] }];
    const res = assembleMcpConnections(() => servers);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.connections.map((c) => c.serverName)).toEqual(['demo']);
      expect(res.failures).toEqual([]);
    }
  });

  it('win32 下非白名单 .cmd ⇒ 计入 failures（不 spawn），其它平台不触发', () => {
    const servers: McpServerConfig[] = [{ name: 'shim', command: 'my-server.cmd' }];
    const res = assembleMcpConnections(() => servers);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    if (process.platform === 'win32') {
      expect(res.failures.map((f) => f.serverName)).toEqual(['shim']);
      expect(res.connections).toEqual([]);
    } else {
      // 非 win32：判定不适用，按普通命令建连接
      expect(res.failures).toEqual([]);
    }
  });
});

/**
 * 静态守卫：装配只有一份实现。
 *
 * 改前 `cli.ts` 与 `tui/chat.ts` 各写一份「load → shim 分区 → createMcpConnections → 汇总
 * failures」，只差错误策略 —— 只改一面会无声分叉。此用例断言两侧都**只调用**共享入口，
 * 且 `createMcpConnections(` / `windowsShimHint(` 的**调用**只出现在共享模块里。
 * （改回内联 ⇒ 本用例红。）
 */
describe('mcp/assemble — 单实现守卫（防两份实现分叉）', () => {
  const cli = fs.readFileSync(CLI_SRC, 'utf8');
  const chat = fs.readFileSync(CHAT_SRC, 'utf8');
  const assemble = fs.readFileSync(ASSEMBLE_SRC, 'utf8');

  it('cli.ts 与 tui/chat.ts 都只调用 assembleMcpConnections', () => {
    expect(cli).toContain('assembleMcpConnections(');
    expect(chat).toContain('assembleMcpConnections(');
  });

  it('createMcpConnections( 的调用只在共享模块', () => {
    expect(assemble).toContain('createMcpConnections(');
    expect(cli).not.toContain('createMcpConnections(');
    expect(chat).not.toContain('createMcpConnections(');
  });

  it('windowsShimHint( 的调用只在共享模块（判定本体在叶子模块）', () => {
    expect(assemble).toContain('windowsShimHint(');
    expect(cli).not.toContain('windowsShimHint(');
    expect(chat).not.toContain('windowsShimHint(');
  });
});
