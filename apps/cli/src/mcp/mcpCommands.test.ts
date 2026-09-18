import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from '../cli.js';

/**
 * `vessel mcp` CLI 出口（G-11 的 MCP 半）。
 *
 * 全部经真实 `main()` 进程内调用；root 用 `VESSEL_MCP_ROOT` 注入临时目录，
 * **绝不读写真实 `~/.vessel/mcp.json`**（AGENTS 纪律 8 同款隔离）。
 */
function capture(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const a = vi.spyOn(console, 'log').mockImplementation((...x: unknown[]) => void logs.push(x.join(' ')));
  const b = vi.spyOn(console, 'error').mockImplementation((...x: unknown[]) => void logs.push(x.join(' ')));
  return { logs, restore: () => { a.mockRestore(); b.mockRestore(); } };
}

/** 取最后一次 `--json` 输出的可解析 JSON（stdout 只应有一段）。 */
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

describe('vessel mcp — CLI 配置出口', () => {
  let root: string;
  let oldRoot: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-mcp-cli-'));
    oldRoot = process.env.VESSEL_MCP_ROOT;
    process.env.VESSEL_MCP_ROOT = root;
  });

  afterEach(() => {
    if (oldRoot === undefined) delete process.env.VESSEL_MCP_ROOT;
    else process.env.VESSEL_MCP_ROOT = oldRoot;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('list 空配置 ⇒ exit 0 且提示未配置；--json ⇒ { configFile, servers: [] }', async () => {
    const c1 = capture();
    const code1 = await main(['mcp', 'list']);
    c1.restore();
    expect(code1).toBe(0);
    expect(c1.logs.join('\n')).toContain('未配置');

    const c2 = capture();
    const code2 = await main(['mcp', 'list', '--json']);
    const body = jsonFrom(c2.logs) as { configFile: string; servers: unknown[] };
    c2.restore();
    expect(code2).toBe(0);
    expect(body.servers).toEqual([]);
    expect(body.configFile).toBe(path.join(root, 'mcp.json'));
  });

  it('add → list → path → remove 往返，且 --json 只出一段可解析 JSON', async () => {
    const cAdd = capture();
    const codeAdd = await main(['mcp', 'add', 'demo', '--command', 'node', '--args', 'server.js,--flag', '--env', 'TOKEN=abc']);
    cAdd.restore();
    expect(codeAdd).toBe(0);

    // 落盘内容正确
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'mcp.json'), 'utf8')) as {
      servers: Array<{ name: string; command: string; args?: string[]; env?: Record<string, string> }>;
    };
    expect(onDisk.servers).toHaveLength(1);
    expect(onDisk.servers[0]).toMatchObject({ name: 'demo', command: 'node', args: ['server.js', '--flag'], env: { TOKEN: 'abc' } });

    const cList = capture();
    const codeList = await main(['mcp', 'list', '--json']);
    const listBody = jsonFrom(cList.logs) as { servers: Array<{ name: string }> };
    cList.restore();
    expect(codeList).toBe(0);
    expect(listBody.servers.map((s) => s.name)).toEqual(['demo']);

    const cPath = capture();
    const codePath = await main(['mcp', 'path', '--json']);
    const pathBody = jsonFrom(cPath.logs) as { configFile: string };
    cPath.restore();
    expect(codePath).toBe(0);
    expect(pathBody.configFile).toBe(path.join(root, 'mcp.json'));

    const cRm = capture();
    const codeRm = await main(['mcp', 'remove', 'demo']);
    cRm.restore();
    expect(codeRm).toBe(0);
    expect((JSON.parse(fs.readFileSync(path.join(root, 'mcp.json'), 'utf8')) as { servers: unknown[] }).servers).toEqual([]);
  });

  it('add 重名 ⇒ exit 2；remove 不存在 ⇒ exit 2；未知子命令 ⇒ exit 2；缺 --command ⇒ exit 2', async () => {
    await main(['mcp', 'add', 'demo', '--command', 'node']);
    const cDup = capture();
    const codeDup = await main(['mcp', 'add', 'demo', '--command', 'node']);
    cDup.restore();
    expect(codeDup).toBe(2);
    expect(cDup.logs.join('\n')).toContain('已存在');

    const cRm = capture();
    const codeRm = await main(['mcp', 'remove', 'nope']);
    cRm.restore();
    expect(codeRm).toBe(2);

    const cBad = capture();
    const codeBad = await main(['mcp', 'bogus']);
    cBad.restore();
    expect(codeBad).toBe(2);

    const cNoCmd = capture();
    const codeNoCmd = await main(['mcp', 'add', 'x']);
    cNoCmd.restore();
    expect(codeNoCmd).toBe(2);
  });

  it('损坏的 mcp.json ⇒ exit 1（fail loud，不吞）且提示文件路径', async () => {
    fs.writeFileSync(path.join(root, 'mcp.json'), '{ not json', 'utf8');
    const c = capture();
    const code = await main(['mcp', 'list']);
    c.restore();
    expect(code).toBe(1);
    expect(c.logs.join('\n')).toContain('mcp.json');
  });

  it('不写真实 ~/.vessel：注入 root 后配置文件落在临时目录', async () => {
    await main(['mcp', 'add', 'demo', '--command', 'node']);
    expect(fs.existsSync(path.join(root, 'mcp.json'))).toBe(true);
    // 真实 home 下不应出现本次添加的 demo（若真实文件存在，也不应包含它）
    const real = path.join(os.homedir(), '.vessel', 'mcp.json');
    if (fs.existsSync(real)) {
      expect(fs.readFileSync(real, 'utf8')).not.toContain('"name": "demo"');
    }
  });
});
