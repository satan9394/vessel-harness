import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  MCP_CONFIG_FILENAME,
  McpConfigStore,
  defaultMcpRoot,
  resolveMcpRoot,
  type McpServerConfig,
} from './config.js';

/**
 * config.test.ts — `apps/cli/src/mcp/config.ts`（McpConfigStore，288 行纯配置读取器）的
 * 校验与原子写验收。该文件此前零覆盖，全部行为只靠静态审查，本文件按 AGENTS.md §7
 * “新功能必须有 Vitest 测试”补齐；断言一律以 `config.ts` 的**真实实现**为准
 * （导出的 `MCP_CONFIG_FILENAME` / `defaultMcpRoot` / `resolveMcpRoot` / `McpConfigStore`，
 *  以及 `load()` / `save()` 的实际抛错文案）。
 *
 * 契约（来自 config.ts:25-49 的“损坏策略”）：
 *   - ENOENT → `load()` 返回 `[]` 且**不报错**（首次运行没有 mcp.json 是正常状态）；
 *   - JSON 非法 / 结构非法（根非对象、`servers` 非数组或缺失）/ 逐项校验失败 /
 *     重复 `name` → **throw**（文件存在即代表用户意图，静默空表 = 假绿）；
 *   - 其余 IO 错误（EACCES/EISDIR…）原样上抛，不吞成空表（本文件不伪造该类 IO）；
 *   - 根解析优先级：显式 `opts.rootDir` > `VESSEL_MCP_ROOT` > `defaultMcpRoot()`；
 *     `VESSEL_MCP_ROOT` 为 `''` / 纯空白时**视为未设置**（否则配置会静默落到进程 CWD）；
 *   - `save()` 全量校验 + `<file>.tmp` + rename 的原子写（不含备份轮转）。
 *
 * 隔离纪律（照抄 UsageStore.recovery.test.ts / defaultStore.recovery.test.ts）：
 *   全部落在 `mkdtempSync(os.tmpdir(), 'vessel-mcpcfg-')`，并把 `VESSEL_MCP_ROOT` 快照/还原；
 *   **绝不读写真实 `~/.vessel`**。用例 ⑦ 断言 `rootDir === defaultMcpRoot()`（纯路径计算），
 *   而**不**断言等于真实 home 路径，避免依赖具体机器。
 */

/** 把原始文本写进该 store 的 `mcp.json`（父目录按需创建）。 */
function writeRaw(store: McpConfigStore, text: string): void {
  fs.mkdirSync(store.rootDir, { recursive: true });
  fs.writeFileSync(store.configFile, text, 'utf8');
}

/** 把对象序列化后写进该 store 的 `mcp.json`。 */
function writeJson(store: McpConfigStore, value: unknown): void {
  writeRaw(store, JSON.stringify(value));
}

/** 目录里的 `.tmp` 残留（原子写的临时文件；正常提交后应为空）。 */
function listTmp(root: string): string[] {
  return fs.readdirSync(root).filter((n) => n.endsWith('.tmp'));
}

describe('mcp — McpConfigStore 读取校验 / 根解析 / 原子写（config.ts）', () => {
  let dir: string;
  /** 本用例内额外创建的临时 root（需要独立 root 的用例用）。 */
  const extraDirs: string[] = [];
  let savedRoot: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mcpcfg-'));
    savedRoot = process.env.VESSEL_MCP_ROOT;
  });

  afterEach(() => {
    // env 快照还原：undefined 与空串必须区分对待（空串本身是被测语义的一部分）
    if (savedRoot === undefined) delete process.env.VESSEL_MCP_ROOT;
    else process.env.VESSEL_MCP_ROOT = savedRoot;
    // 只清 mkdtemp 出来的临时目录（测试隔离约定：不碰真实 ~/.vessel）
    for (const d of [dir, ...extraDirs]) fs.rmSync(d, { recursive: true, force: true });
    extraDirs.length = 0;
  });

  const newRoot = (): string => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-mcpcfg-'));
    extraDirs.push(d);
    return d;
  };

  // ---- ① ENOENT 静默 -------------------------------------------------------

  it('① mcp.json 不存在（ENOENT）→ load() 返回 [] 且不抛（首次运行是正常状态）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    expect(fs.existsSync(store.configFile)).toBe(false);
    expect(() => store.load()).not.toThrow();
    expect(store.load()).toEqual([]);
    // 读取不产生副作用：不建文件、不建目录
    expect(fs.existsSync(store.configFile)).toBe(false);
  });

  it('①-b configFile 走 path.join(rootDir, MCP_CONFIG_FILENAME)（Windows 安全拼接）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    expect(MCP_CONFIG_FILENAME).toBe('mcp.json');
    expect(store.configFile).toBe(path.join(dir, 'mcp.json'));
  });

  // ---- ② 合法配置 + 归一化 -------------------------------------------------

  it('② 合法配置 → 1 条、字段逐一对上；未知键被丢弃（只保留已知字段）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    writeRaw(
      store,
      JSON.stringify({
        servers: [
          {
            name: 'demo',
            command: 'npx',
            args: ['-y', 'x'],
            env: { K: 'V' },
            cwd: '/tmp',
            extra: 1, // 未知字段：向前兼容，应被丢弃
          },
        ],
        // 顶层未知键同理
        version: 2,
      }),
    );

    const loaded = store.load();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual({
      name: 'demo',
      command: 'npx',
      args: ['-y', 'x'],
      env: { K: 'V' },
      cwd: '/tmp',
    });
    expect(loaded[0]).not.toHaveProperty('extra'); // 逐字段锁定，而非只比 name
    expect(Object.keys(loaded[0]!).sort()).toEqual(['args', 'command', 'cwd', 'env', 'name']);
  });

  it('②-b 可选字段缺省时不补 undefined 键（args/env/cwd 可省略）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    writeJson(store, { servers: [{ name: 'bare', command: 'node' }] });

    const loaded = store.load();
    expect(loaded).toEqual([{ name: 'bare', command: 'node' }]);
    expect(Object.keys(loaded[0]!).sort()).toEqual(['command', 'name']);
  });

  // ---- ③ JSON 非法 ---------------------------------------------------------

  it('③ JSON 非法（{oops）→ load() throw（invalid JSON，且消息含文件路径）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    writeRaw(store, '{oops');

    expect(() => store.load()).toThrow(/invalid JSON/i);
    expect(() => store.load()).toThrow(/corrupted/i);
    expect(() => store.load()).toThrow(store.configFile); // 报错必须指认是哪个文件
  });

  // ---- ④ 结构非法 ----------------------------------------------------------

  // 结构非法一律走 "mcp file corrupted" 分支（fail-loud，不静默返回 []）——逐例一个用例，
  // 失败时用例名直接指明是哪种结构问题。
  const structuralCases: Array<[string, string, RegExp]> = [
    ['根是数组', JSON.stringify([{ name: 'demo', command: 'npx' }]), /expected \{"servers": \[\.\.\.\]\}/],
    ['根是字符串', JSON.stringify('nope'), /expected \{"servers": \[\.\.\.\]\}/],
    ['根是数字', JSON.stringify(42), /expected \{"servers": \[\.\.\.\]\}/],
    ['servers 是对象', JSON.stringify({ servers: {} }), /"servers" must be an array/],
    ['servers 是字符串', JSON.stringify({ servers: 'demo' }), /"servers" must be an array/],
    ['缺 servers 键（{}）', JSON.stringify({}), /"servers" must be an array/],
  ];

  for (const [label, text, pattern] of structuralCases) {
    it(`④ 结构非法（${label}）→ load() throw`, () => {
      const store = new McpConfigStore({ rootDir: dir });
      writeRaw(store, text);
      expect(() => store.load()).toThrow(pattern);
      expect(() => store.load()).toThrow(/corrupted/i);
      expect(() => store.load()).toThrow(store.configFile); // 报错指认文件
    });
  }

  it('④-b 数组元素非对象（null）→ load() throw（逐项校验分支，定位 servers[0]）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    writeJson(store, { servers: [null] });
    // 注：这一分支的文案来自 parseServerEntry，不含 "corrupted" 字样
    expect(() => store.load()).toThrow(/servers\[0\] must be an object \(got null\)/);
  });

  // ---- ⑤ 逐项校验 ----------------------------------------------------------

  // 逐项校验：`load()` 的 where 前缀是 `<configFile> servers[i]`，故文案里带文件路径 + 下标。
  const itemCases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['name 缺失', { command: 'npx' }, /servers\[0\]\.name must be a non-empty string \(got undefined\)/],
    ['name 空串', { name: '', command: 'npx' }, /servers\[0\]\.name must be a non-empty string/],
    ['name 纯空白', { name: '   ', command: 'npx' }, /servers\[0\]\.name must be a non-empty string/],
    ['name 非字符串', { name: 1, command: 'npx' }, /servers\[0\]\.name must be a non-empty string \(got 1\)/],
    ['command 缺失', { name: 'demo' }, /servers\[0\]\.command must be a non-empty string \(got undefined\)/],
    ['command 空串', { name: 'demo', command: '' }, /servers\[0\]\.command must be a non-empty string/],
    ['args 非数组', { name: 'demo', command: 'npx', args: '-y' }, /servers\[0\]\.args must be an array of strings/],
    ['args 元素非 string', { name: 'demo', command: 'npx', args: ['-y', 1] }, /servers\[0\]\.args\[1\] must be a string \(got 1\)/],
    ['env 非对象', { name: 'demo', command: 'npx', env: ['K'] }, /servers\[0\]\.env must be an object of string→string/],
    ['env 值非 string', { name: 'demo', command: 'npx', env: { K: 1 } }, /servers\[0\]\.env\["K"\] must be a string \(got 1\)/],
    ['cwd 空串', { name: 'demo', command: 'npx', cwd: '' }, /servers\[0\]\.cwd must be a non-empty string/],
    ['cwd 纯空白', { name: 'demo', command: 'npx', cwd: '  ' }, /servers\[0\]\.cwd must be a non-empty string/],
  ];

  for (const [label, entry, pattern] of itemCases) {
    it(`⑤ 逐项校验（${label}）→ load() throw`, () => {
      const store = new McpConfigStore({ rootDir: dir });
      writeJson(store, { servers: [entry] });
      expect(() => store.load()).toThrow(pattern);
    });
  }

  it('⑤-b 第二项才非法 → 报错定位到 servers[1]（不误指第一项）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    writeJson(store, {
      servers: [{ name: 'ok', command: 'npx' }, { name: 'bad', command: '' }],
    });
    expect(() => store.load()).toThrow(/servers\[1\]\.command must be a non-empty string/);
  });

  // ---- ⑥ 重复 name ---------------------------------------------------------

  it('⑥ load()：重复 name → throw（读取期即拦，不拖到 registry 的 already registered）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    writeJson(store, {
      servers: [
        { name: 'demo', command: 'npx' },
        { name: 'demo', command: 'node' },
      ],
    });

    expect(() => store.load()).toThrow(/duplicate server name "demo"/);
    expect(() => store.load()).toThrow(/corrupted/i);
    expect(() => store.load()).toThrow(store.configFile);
  });

  it('⑥-b save()：重复 name → throw，且不落盘任何内容', () => {
    const store = new McpConfigStore({ rootDir: dir });
    const dup: McpServerConfig[] = [
      { name: 'demo', command: 'npx' },
      { name: 'demo', command: 'node' },
    ];

    expect(() => store.save(dup)).toThrow(/duplicate mcp server name: "demo"/);
    expect(fs.existsSync(store.configFile)).toBe(false); // “任一项非法即 throw，不落盘任何内容”
    expect(listTmp(dir)).toEqual([]);
  });

  it('⑥-c save()：逐项非法同样 fail-loud（where 前缀是 servers[i]，无文件路径）', () => {
    const store = new McpConfigStore({ rootDir: dir });
    expect(() => store.save([{ name: 'demo', command: '' }])).toThrow(
      /servers\[0\]\.command must be a non-empty string/,
    );
    expect(() => store.save([{ name: 'demo', command: 'npx', cwd: '' }])).toThrow(
      /servers\[0\]\.cwd must be a non-empty string/,
    );
    expect(fs.existsSync(store.configFile)).toBe(false);
  });

  // ---- ⑦ VESSEL_MCP_ROOT 空串 / 空白 = 未设置 -------------------------------

  it('⑦ VESSEL_MCP_ROOT 空串或纯空白 → 视为未设置，回落 defaultMcpRoot()（不是 ""）', () => {
    for (const raw of ['', '   ', '\t\n']) {
      process.env.VESSEL_MCP_ROOT = raw;
      expect(resolveMcpRoot(), JSON.stringify(raw)).toBe(defaultMcpRoot());
      const store = new McpConfigStore();
      expect(store.rootDir, JSON.stringify(raw)).not.toBe(''); // 关键回归：不得落到 CWD
      expect(store.rootDir, JSON.stringify(raw)).toBe(defaultMcpRoot());
      expect(store.rootDir, JSON.stringify(raw)).not.toBe(raw.trim());
    }
  });

  it('⑦-b VESSEL_MCP_ROOT 未设置 → 同样回落 defaultMcpRoot()；设了值则生效（首尾空白剔除）', () => {
    delete process.env.VESSEL_MCP_ROOT;
    expect(resolveMcpRoot()).toBe(defaultMcpRoot());
    expect(new McpConfigStore().rootDir).toBe(defaultMcpRoot());

    const envRoot = newRoot();
    process.env.VESSEL_MCP_ROOT = envRoot;
    expect(resolveMcpRoot()).toBe(envRoot);
    expect(new McpConfigStore().rootDir).toBe(envRoot);

    process.env.VESSEL_MCP_ROOT = `  ${envRoot}  `; // 非空即生效，两侧空白被 trim
    expect(resolveMcpRoot()).toBe(envRoot);
  });

  // ---- ⑧ 显式 opts 优先于 env ---------------------------------------------

  it('⑧ 显式 opts.rootDir 优先于 VESSEL_MCP_ROOT（测试隔离入口最高优先）', () => {
    const elsewhere = newRoot();
    process.env.VESSEL_MCP_ROOT = elsewhere;

    const store = new McpConfigStore({ rootDir: dir });
    expect(store.rootDir).toBe(dir);
    expect(store.rootDir).not.toBe(elsewhere);

    // 隔离真的生效：save() 只写进显式 root，env 指向的目录一个字节都不动
    store.save([{ name: 'demo', command: 'npx' }]);
    expect(fs.existsSync(store.configFile)).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, MCP_CONFIG_FILENAME))).toBe(false);
    expect(fs.readdirSync(elsewhere)).toEqual([]);
  });

  it('⑧-b 显式空字符串 opts.rootDir 也优先于 env（?? 语义：只有 undefined 才回落）', () => {
    const elsewhere = newRoot();
    process.env.VESSEL_MCP_ROOT = elsewhere;
    // 注意：'' 不是 undefined，`opts.rootDir ?? env ?? default` 会原样采用 ''
    expect(new McpConfigStore({ rootDir: '' }).rootDir).toBe('');
  });

  // ---- ⑨ 原子写 ------------------------------------------------------------

  it('⑨ save() 原子写：文件存在、load() 读回内容等价、目录无 .tmp 残留', () => {
    const store = new McpConfigStore({ rootDir: dir });
    const servers: McpServerConfig[] = [
      { name: 'demo', command: 'npx', args: ['-y', 'x'], env: { K: 'V' }, cwd: '/tmp' },
      { name: 'bare', command: 'node' },
    ];

    store.save(servers);

    // 文件存在且是合法 JSON（末尾带换行，照抄 writeJsonAtomic 的 `${JSON.stringify(...,2)}\n`）
    expect(fs.existsSync(store.configFile)).toBe(true);
    const text = fs.readFileSync(store.configFile, 'utf8');
    expect(text.endsWith('\n')).toBe(true);
    expect(JSON.parse(text)).toEqual({ servers });

    // 读回等价
    expect(store.load()).toEqual(servers);

    // 原子写的临时文件已 rename 掉，不留 .tmp
    expect(listTmp(dir)).toEqual([]);
    expect(fs.existsSync(`${store.configFile}.tmp`)).toBe(false);
  });

  it('⑨-b save() 覆盖写：第二次内容完全替换（旧内容不残留）、仍无 .tmp', () => {
    const store = new McpConfigStore({ rootDir: dir });
    store.save([{ name: 'old', command: 'npx' }]);
    store.save([{ name: 'new', command: 'node', args: ['--version'] }]);

    expect(store.load()).toEqual([{ name: 'new', command: 'node', args: ['--version'] }]);
    expect(fs.readFileSync(store.configFile, 'utf8')).not.toContain('old');
    expect(listTmp(dir)).toEqual([]);
  });

  it('⑨-c save() 递归创建缺失的 rootDir（含多级），未知键同样被丢弃后落盘', () => {
    const nested = path.join(dir, 'nested', 'deeper');
    const store = new McpConfigStore({ rootDir: nested });
    expect(fs.existsSync(nested)).toBe(false);

    store.save([
      { name: 'demo', command: 'npx', extra: 1 } as unknown as McpServerConfig,
    ]);

    expect(fs.existsSync(store.configFile)).toBe(true);
    expect(store.load()).toEqual([{ name: 'demo', command: 'npx' }]); // 未知键不落盘
    expect(listTmp(nested)).toEqual([]);
  });

  it('⑨-d save() → load() 往返：非法输入（servers 非数组）在写盘前即 throw', () => {
    const store = new McpConfigStore({ rootDir: dir });
    expect(() => store.save('nope' as unknown as McpServerConfig[])).toThrow(
      /mcp servers must be an array \(got "nope"\)/,
    );
    expect(fs.existsSync(store.configFile)).toBe(false);
    expect(listTmp(dir)).toEqual([]);
  });
});
