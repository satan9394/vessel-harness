import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renameWithRetry } from '@vessel/shared';
import { envRoot } from '../envRoot.js';

/**
 * apps/cli/src/mcp/config.ts — MCP server 声明的用户级配置读取器
 * （G-11 MCP 半，BRIEF-13；范式照抄 `providers/ProviderStore.ts`）。
 *
 * 单一事实源：`~/.vessel/mcp.json`，形如
 *
 *     { "servers": [ { "name": "demo", "command": "npx", "args": ["-y", "..."],
 *                      "env": {}, "cwd": "." } ] }
 *
 * ## 根解析优先级（与 ProviderStore / UsageStore 同源语义）
 *
 *     new McpConfigStore({ rootDir })   ← 显式注入最高优先（测试隔离用）
 *       > process.env.VESSEL_MCP_ROOT
 *       > defaultMcpRoot() = ~/.vessel
 *
 * `defaultMcpRoot()` 是**纯路径计算**，不读 env（便于断言）；读 env 的是
 * `resolveMcpRoot()` 与构造函数。env 为空/纯空白时视为未设置——否则
 * `VESSEL_MCP_ROOT=` 会让配置静默落到进程 CWD，属于"看起来生效、其实写错地方"。
 *
 * ## 损坏策略：ENOENT 静默 / 损坏 fail-loud
 *
 *   - **ENOENT → 返回 `[]` 且不报错**：首次运行没有配置文件是正常状态，不是错误。
 *     报错会让 `vessel run` 在"从没用过 MCP"的机器上直接挂掉。
 *   - **JSON 非法 / 结构非法 / 重复 name → throw**：文件存在即代表用户意图，
 *     此时静默返回空表 = "文案说接上了、实际没接"的假绿（本仓反复踩过）。
 *     配置错误必须在读取期就暴露，而不是拖到 registry 的 `tool already registered`
 *     才炸（那时已丢失"是哪个文件哪一项写错了"的上下文）。
 *   - 其余 IO 错误（EACCES / EISDIR / …）**原样上抛**，不吞成空表。
 *
 * ## 边界：本模块**不构造 transport**
 *
 * 这里只产出**可序列化描述**（`McpServerConfig[]`）。真正 `new StdioTransport(...)`
 * 由 compose 侧（`packages/application/src/compose.ts`，已依赖 `@vessel/tools`）
 * 用 `resolveSpawnCommand()` + `StdioTransport` 构造，`apps/cli` 因此**不新增**
 * 对 `@vessel/tools` 的依赖边（AGENTS.md §5 依赖纪律；package.json 只声明
 * `@vessel/application` / `@vessel/local-server`）。
 *
 * ## 原子写
 *
 * `ProviderStore.writeJsonAtomic`（`ProviderStore.ts:485-491`）是**私有实现**，跨文件
 * 不可达，故就地实现等价逻辑：`mkdirSync(recursive)` + 写 `<file>.tmp` +
 * `renameWithRetry`（来自 `@vessel/shared`，apps/cli 已在 `usage/UsageStore.ts`、
 * `guide/settings.ts` 等多处这样用）。**不含**备份轮转与凭据解析——那是
 * ProviderStore 独有的需求，此处照抄即过度设计。
 */

/** 配置文件名（相对 rootDir）。 */
export const MCP_CONFIG_FILENAME = 'mcp.json';

/** 单个 MCP server 的声明（stdio 传输）。 */
export interface McpServerConfig {
  /** server 名（**唯一键**）：注册出的工具名为 `mcp__<name>__<tool>`。 */
  name: string;
  /** 可执行命令（`npx` / `node` / 绝对路径…）。 */
  command: string;
  /** 透传给 command 的参数（默认不二次解析，除非命中 shell 白名单）。 */
  args?: string[];
  /** 叠加在 `process.env` 之上的环境变量（同名覆盖）。 */
  env?: Record<string, string>;
  /** 子进程工作目录（缺省继承父进程）。 */
  cwd?: string;
}

/** `McpConfigStore` 构造选项。 */
export interface McpConfigStoreOptions {
  /** 显式根目录；优先于 `VESSEL_MCP_ROOT` 与 `~/.vessel`（测试隔离入口）。 */
  rootDir?: string;
}

/** 默认根：`~/.vessel`（纯路径计算，**不读 env**）。 */
export function defaultMcpRoot(home: string = os.homedir()): string {
  return path.join(home, '.vessel');
}

/**
 * 生效根：`VESSEL_MCP_ROOT` > `~/.vessel`。
 *
 * 空串 / 纯空白视为未设置（见文件头说明）。
 */
export function resolveMcpRoot(): string {
  return envRootOverride() ?? defaultMcpRoot();
}

/**
 * 读 `VESSEL_MCP_ROOT`；空/纯空白按未设置处理。
 *
 * **Round 123：实现搬到 `../envRoot.js`**（`envRoot('VESSEL_MCP_ROOT')`），
 * 因为本文件此前是**唯一**处理对的地方、而其它四个状态根各写了一遍 `?? 默认值`
 * ⇒ `VESSEL_PROVIDER_ROOT=` 之类会让状态落到进程 CWD。现在**全仓一份口径**。
 * 语义逐字不变，本函数保留为薄封装以免改动调用点。
 */
function envRootOverride(): string | undefined {
  return envRoot('VESSEL_MCP_ROOT');
}

/** 非 null 非数组的对象（JSON 里的 `{...}`）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 供报错信息用的值描述——对任意值都不抛（BigInt / 循环引用安全）。 */
function describeValue(value: unknown): string {
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return JSON.stringify(value);
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${String(value)}n`;
    case 'symbol':
      return 'symbol';
    case 'function':
      return 'function';
    default:
      return value === null ? 'null' : Array.isArray(value) ? 'array' : 'object';
  }
}

/** 必填非空字符串（fail loud）。 */
function requireNonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${where} must be a non-empty string (got ${describeValue(value)})`);
  }
  return value;
}

/**
 * 单项校验 + 归一化（只保留已知字段，忽略多余键以便向前兼容）。
 *
 * `where` 是报错前缀，如 `~/.vessel/mcp.json servers[0]`（load）或
 * `servers[0]`（save）。
 */
function parseServerEntry(raw: unknown, where: string): McpServerConfig {
  if (!isPlainObject(raw)) {
    throw new Error(`${where} must be an object (got ${describeValue(raw)})`);
  }

  const name = requireNonEmptyString(raw.name, `${where}.name`);
  const command = requireNonEmptyString(raw.command, `${where}.command`);
  const entry: McpServerConfig = { name, command };

  const rawArgs = raw.args;
  if (rawArgs !== undefined) {
    if (!Array.isArray(rawArgs)) {
      throw new Error(`${where}.args must be an array of strings (got ${describeValue(rawArgs)})`);
    }
    const args: string[] = [];
    for (const [i, arg] of rawArgs.entries()) {
      if (typeof arg !== 'string') {
        throw new Error(`${where}.args[${i}] must be a string (got ${describeValue(arg)})`);
      }
      args.push(arg);
    }
    entry.args = args;
  }

  const rawEnv = raw.env;
  if (rawEnv !== undefined) {
    if (!isPlainObject(rawEnv)) {
      throw new Error(`${where}.env must be an object of string→string (got ${describeValue(rawEnv)})`);
    }
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawEnv)) {
      if (typeof value !== 'string') {
        throw new Error(`${where}.env[${JSON.stringify(key)}] must be a string (got ${describeValue(value)})`);
      }
      env[key] = value;
    }
    entry.env = env;
  }

  if (raw.cwd !== undefined) {
    // 空串 cwd 等同"没配"，但会被下游静默忽略 → 按配置错误 fail loud。
    entry.cwd = requireNonEmptyString(raw.cwd, `${where}.cwd`);
  }
  return entry;
}

/**
 * McpConfigStore — `mcp.json` 的读写封装。
 *
 * 全部 IO 同步（小型用户级存储，与 ProviderStore / memory / ProjectStore 一致）；
 * 路径一律 `path.join` 拼接，不手工拼字符串（Windows 安全）。
 */
export class McpConfigStore {
  /** 存储根目录（public：测试注入断言 / CLI 诊断用）。 */
  readonly rootDir: string;

  constructor(opts: McpConfigStoreOptions = {}) {
    // 显式 opts.rootDir 优先于 env；env 覆盖让 CLI 测试无需碰真实 ~/.vessel。
    this.rootDir = opts.rootDir ?? envRootOverride() ?? defaultMcpRoot();
  }

  /** `mcp.json` 的完整路径。 */
  get configFile(): string {
    return path.join(this.rootDir, MCP_CONFIG_FILENAME);
  }

  /**
   * 读配置：文件不存在 → `[]`（不报错）；JSON / 结构非法、重复 `name` → throw。
   *
   * 逐项校验：`name`/`command` 必填非空字符串；`args` 若存在必须是 string[]；
   * `env` 若存在必须是 string→string；`cwd` 若存在必须是非空字符串。
   */
  load(): McpServerConfig[] {
    let text: string;
    try {
      text = fs.readFileSync(this.configFile, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      // 首次运行无文件是正常状态；其余 IO 错误原样上抛（不吞成空表）。
      if (e.code === 'ENOENT') return [];
      throw err;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`mcp file corrupted (invalid JSON): ${this.configFile}`, { cause: err });
    }

    if (!isPlainObject(raw)) {
      throw new Error(`mcp file corrupted (expected {"servers": [...]}): ${this.configFile}`);
    }
    const rawServers = raw.servers;
    if (!Array.isArray(rawServers)) {
      throw new Error(
        `mcp file corrupted (expected {"servers": [...]}, "servers" must be an array): ${this.configFile}`,
      );
    }

    const list: McpServerConfig[] = [];
    const seen = new Set<string>();
    for (const [i, item] of rawServers.entries()) {
      const entry = parseServerEntry(item, `${this.configFile} servers[${i}]`);
      // 读取期即拦重复名：不要拖到 registry 的 `tool already registered` 才炸。
      if (seen.has(entry.name)) {
        throw new Error(`mcp file corrupted (duplicate server name "${entry.name}"): ${this.configFile}`);
      }
      seen.add(entry.name);
      list.push(entry);
    }
    return list;
  }

  /**
   * 全量校验 + 原子写盘（供后续 `mcp add` / `mcp remove` 使用）。
   *
   * 任一项非法或 `name` 重复即 throw，**不落盘任何内容**。
   */
  save(servers: McpServerConfig[]): void {
    if (!Array.isArray(servers)) {
      throw new Error(`mcp servers must be an array (got ${describeValue(servers)})`);
    }
    const seen = new Set<string>();
    const normalized: McpServerConfig[] = [];
    for (const [i, server] of servers.entries()) {
      const entry = parseServerEntry(server, `servers[${i}]`);
      if (seen.has(entry.name)) {
        throw new Error(`duplicate mcp server name: "${entry.name}"`);
      }
      seen.add(entry.name);
      normalized.push(entry);
    }
    this.writeJsonAtomic(this.configFile, { servers: normalized });
  }

  // ---- internal ----

  /**
   * 原子写：`<file>.tmp` 写完后 rename 覆盖目标（防半写；crash 时最多残留 .tmp，
   * 原文件保持完整）。rename 走共享有界重试（EPERM/EBUSY/EACCES）。
   *
   * 就地实现：`ProviderStore.writeJsonAtomic` 是私有实现，跨文件不可达。
   * 不做备份轮转（ProviderStore 的额外需求，此处不需要）。
   */
  private writeJsonAtomic(file: string, data: unknown): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameWithRetry(tmp, file);
  }
}
