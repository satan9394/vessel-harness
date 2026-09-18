import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { dispatchSlash, type ChatSessionIO } from './chat.js';
import { ProviderStore } from '../providers/ProviderStore.js';

/**
 * TUI 斜杠命令 `/mcp` 与 `/diff`（G-13：TUI/CLI 命令面一致）。
 * `VESSEL_MCP_ROOT` 注入临时目录，绝不读写真实 ~/.vessel。
 */
function stubIO(): ChatSessionIO {
  return { readLine: async () => null, write: () => {} };
}

describe('TUI slash — /mcp 与 /diff（G-13 一致性）', () => {
  let root: string;
  let home: string;
  let oldMcp: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-slash-'));
    home = path.join(root, 'home');
    fs.mkdirSync(home, { recursive: true });
    oldMcp = process.env.VESSEL_MCP_ROOT;
    process.env.VESSEL_MCP_ROOT = home;
  });

  afterEach(() => {
    if (oldMcp === undefined) delete process.env.VESSEL_MCP_ROOT;
    else process.env.VESSEL_MCP_ROOT = oldMcp;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('/mcp：空配置给提示；有配置列出 name/command/args', async () => {
    const store = new ProviderStore({ rootDir: home });
    const empty = await dispatchSlash('/mcp', { store, io: stubIO(), sessionWorkspace: root });
    expect(empty?.output).toContain('未配置');

    fs.writeFileSync(
      path.join(home, 'mcp.json'),
      JSON.stringify({ servers: [{ name: 'demo', command: 'npx', args: ['-y', 'server'] }] }),
      'utf8',
    );
    const listed = await dispatchSlash('/mcp', { store, io: stubIO(), sessionWorkspace: root });
    expect(listed?.output).toContain('demo');
    expect(listed?.output).toContain('npx -y server');
  });

  it('/mcp：损坏文件不崩，返回错误文本', async () => {
    const store = new ProviderStore({ rootDir: home });
    fs.writeFileSync(path.join(home, 'mcp.json'), '{ not json', 'utf8');
    const res = await dispatchSlash('/mcp', { store, io: stubIO(), sessionWorkspace: root });
    expect(res?.output).toContain('[mcp]');
  });

  it('/diff：无会话日志 ⇒ 如实提示（不假装有改动）', async () => {
    const store = new ProviderStore({ rootDir: home });
    const res = await dispatchSlash('/diff', { store, io: stubIO(), sessionWorkspace: root });
    expect(res?.output).toContain('尚无日志');
  });

  it('/diff：有日志 ⇒ 列出 Write/Edit 触碰文件与 shell，并声明只读', async () => {
    const store = new ProviderStore({ rootDir: home });
    const log = path.join(root, 'session.jsonl');
    fs.writeFileSync(
      log,
      [
        JSON.stringify({ type: 'tool/call', toolCallId: 't1', toolName: 'Write', arguments: { path: 'a.ts' } }),
        JSON.stringify({ type: 'tool/call', toolCallId: 't2', toolName: 'Shell', arguments: { command: 'ls' } }),
        JSON.stringify({ type: 'tool/result', toolCallId: 't1', toolName: 'Write', content: 'ok' }),
      ].join('\n') + '\n',
      'utf8',
    );
    const res = await dispatchSlash('/diff', {
      store,
      io: stubIO(),
      sessionWorkspace: root,
      sessionLogPath: log,
      sessionId: 'sess_test',
    });
    expect(res?.output).toContain('a.ts');
    expect(res?.output).toContain('ls');
    expect(res?.output).toContain('只读提示');
  });
});
