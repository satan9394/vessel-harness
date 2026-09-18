import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SessionRegistry } from '@vessel/application';
import { main } from '../cli.js';

/**
 * `vessel diff [<id>|--last]` —— 会话改动的**只读**提示。
 * root 用 `VESSEL_SESSION_ROOT` 注入临时目录；工作区也用临时目录，绝不碰真实 ~/.vessel。
 */
function capture(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const a = vi.spyOn(console, 'log').mockImplementation((...x: unknown[]) => void logs.push(x.join(' ')));
  const b = vi.spyOn(console, 'error').mockImplementation((...x: unknown[]) => void logs.push(x.join(' ')));
  return { logs, restore: () => { a.mockRestore(); b.mockRestore(); } };
}

function jsonFrom(logs: string[]): unknown {
  const parsed = logs
    .map((l) => {
      try {
        return JSON.parse(l) as unknown;
      } catch {
        return undefined;
      }
    })
    .filter((v) => v !== undefined);
  expect(parsed.length).toBeGreaterThanOrEqual(1);
  return parsed[parsed.length - 1];
}

/** Write a session log with the tool calls a run would have produced. */
function writeLog(workspaceRoot: string, id: string, records: unknown[]): void {
  const dir = path.join(workspaceRoot, '.harness', 'sessions', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.jsonl'), records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
}

describe('vessel diff — 只读改动提示', () => {
  let home: string;
  let ws: string;
  let oldRoot: string | undefined;
  let oldHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-diff-home-'));
    ws = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-diff-ws-'));
    oldRoot = process.env.VESSEL_SESSION_ROOT;
    process.env.VESSEL_SESSION_ROOT = home;
  });

  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_SESSION_ROOT;
    else process.env.VESSEL_SESSION_ROOT = oldRoot;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(ws, { recursive: true, force: true });
  });

  it('列出 Write/Edit 触碰的文件与 shell，--json 只出一段可解析 JSON', async () => {
    const reg = new SessionRegistry({ vesselHome: home });
    const meta = reg.create({ workspaceRoot: ws });
    writeLog(ws, meta.id, [
      { type: 'tool/call', toolCallId: 't1', toolName: 'Write', arguments: { path: 'src/a.ts', content: 'x' } },
      { type: 'tool/call', toolCallId: 't2', toolName: 'Edit', arguments: { path: 'src/a.ts', old_string: 'x', new_string: 'y' } },
      { type: 'tool/call', toolCallId: 't3', toolName: 'Write', arguments: { file_path: 'src/b.ts', content: 'z' } },
      { type: 'tool/call', toolCallId: 't4', toolName: 'Shell', arguments: { command: 'rm -rf tmp' } },
      { type: 'tool/call', toolCallId: 't5', toolName: 'Read', arguments: { path: 'src/a.ts' } },
      { type: 'tool/result', toolCallId: 't1', toolName: 'Write', content: 'ok' },
    ]);

    const c = capture();
    const code = await main(['diff', meta.id, '--json']);
    const body = jsonFrom(c.logs) as {
      sessionId: string;
      workspaceRoot: string;
      touched: Array<{ path: string; tool: string; count: number }>;
      shellCommands: string[];
    };
    c.restore();
    expect(code).toBe(0);
    expect(body.sessionId).toBe(meta.id);
    expect(body.workspaceRoot).toBe(path.resolve(ws));
    // a.ts counted twice (Write+Edit), b.ts once via file_path; Read ignored
    expect(body.touched).toEqual([
      { path: 'src/a.ts', tool: 'Write', count: 2 },
      { path: 'src/b.ts', tool: 'Write', count: 1 },
    ]);
    expect(body.shellCommands).toEqual(['rm -rf tmp']);
  });

  it('--last 取最近一条；人类模式含只读声明', async () => {
    const reg = new SessionRegistry({ vesselHome: home, now: (() => { let t = 1_000_000; return () => (t += 7); })() });
    const older = reg.create({ workspaceRoot: ws });
    writeLog(ws, older.id, [{ type: 'tool/call', toolCallId: 't1', toolName: 'Write', arguments: { path: 'old.ts' } }]);
    const newer = reg.create({ workspaceRoot: ws });
    writeLog(ws, newer.id, [{ type: 'tool/call', toolCallId: 't2', toolName: 'Write', arguments: { path: 'new.ts' } }]);

    const c = capture();
    const code = await main(['diff', '--last']);
    const text = c.logs.join('\n');
    c.restore();
    expect(code).toBe(0);
    expect(text).toContain(newer.id);
    expect(text).toContain('new.ts');
    expect(text).toContain('只读提示');
  });

  it('未知会话 id ⇒ exit 2', async () => {
    const c = capture();
    const code = await main(['diff', 'sess_does_not_exist']);
    c.restore();
    expect(code).toBe(2);
  });
});
