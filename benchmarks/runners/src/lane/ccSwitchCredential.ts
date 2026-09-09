/**
 * task V1.1-F — CC Switch → CredentialStore 凭据转接（读 opencode-go 条目网络 / 密钥）。
 *
 * 目标：从 CC Switch 配置里读取 opencode-go（OpenCode Go）供应商的 baseURL + API key，
 * 经仓库 CredentialStore（034/069，Windows DPAPI）**加密落库**（~/.vessel/secrets.json
 * 只存密文），再提供给 provider 运行时读取。**明文密钥绝不落盘 / 写 git / 写日志 / 写报告。**
 *
 * CC Switch 配置探查（实测于本机 2026-09-08）：
 *   - 配置主体不再是旧文案猜测的 `~/.cc-switch/config.json`，而是 SQLite 库：
 *     `~/.cc-switch/cc-switch.db`，表 `providers`，`app_type='opencode'`。
 *   - 相关的 opencode-go 条目（实际两条：id=`zs`/`zl`，name="OpenCode Go"）其内容存于
 *     `settings_config` JSON：协议 `@ai-sdk/openai-compatible`，
 *     `options.baseURL=https://opencode.ai/zen/go/v1`，
 *     `options.apiKey` 采用 opencode 的 **`{file:<path>}` 文件引用**语法（引用了
 *     `~/.config/opencode/secrets/{hs,zl}-api-key` 两个真实 key 文件），而非内联明文。
 *     因此「读 key」= 解析 `{file:...}` 引用 → 读对应的 key 文件（进程内，不落盘）。
 *
 * 复用既有机制：
 *   - `@vessel/application` 的 `createCredentialStore`（034/069：Windows DPAPI / plaintext
 *     显式降级）；本模块只在 **Windows + DPAPI 可用** 时把 key 加密落库，绝不写明文。
 *   - baseUrl 仍以仓库内置 preset（apps/cli presets.data.ts id='opencode-go'）为 SSOT；
 *     本模块的 CC Switch 探查用于「确认该供应商对应的真实 baseURL + 取出 key」，两者对齐后库内
 *     preset 为准。若 CC Switch baseUrl 与 preset 不一致，以 CC Switch 为准并记录（不臆断）。
 *
 * 密钥安全铁律：`migrateOpencodeGoCredential()` 只把 apiKey 交给注入的 store.set()（DPAPI 加密），
 * 返回值**不含** key；任何调试输出/报告只写布尔/长度/来源，绝不含密钥片段。
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 凭据 service 名（provider 配置经 secretRef `credential:vessel/<account>` 引用）。 */
export const OPCODE_GO_CRED_SERVICE = 'vessel';
/** 凭据 account 名（本仓库 opencode-go 供应商的统一凭据键）。 */
export const OPCODE_GO_CRED_ACCOUNT = 'opencode-go';

/** 默认 CC Switch SQLite 库路径（可注入覆盖升）。 */
export function defaultCcSwitchDbPath(home = os.homedir()): string {
  return path.join(home, '.cc-switch', 'cc-switch.db');
}

/** opencode-go preset 期望的线上 baseURL（仓库 preset SSOT；探查时对齐用）。 */
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1';

/**
 * 表 `providers` 中一行的最小投影（app_type / settings_config）。
 * 由真实的 SQLite reader 或测试注入的 fake reader 提供。
 */
export interface CcSwitchProviderRow {
  id: string;
  app_type: string;
  name: string;
  /** settings_config 的原始 JSON 字符串。 */
  settings_config: string;
  is_current: boolean;
  provider_type?: string;
}

/**
 * opencode 的 settings_config JSON 形状（AI SDK provider 配置）。
 * 只取本模块关心的字段；其余（models 等）透传忽略。
 */
export interface OpencodeSettingsConfig {
  npm?: string;
  name?: string;
  options?: { baseURL?: string; apiKey?: string; setCacheKey?: unknown };
  models?: Record<string, unknown>;
}

/** CC Switch 探查读出的「OpenCode Go」条目（已解析 key 引用路径，但未读 key 文件）。 */
export interface CcSwitchOpencodeRef {
  /** providers.id（多条目时取 is_current=1 优先，否则取第一个）。 */
  rowId: string;
  name: string;
  baseUrl: string;
  /**
   * apiKey 字段原始值。可能是内联 `sk-...`（罕见）或 `{file:<path>}` 文件引用。
   * 不为 undefined 仅表示"字段存在"；是否真的能得到明文由 resolve\* 决定。
   */
  apiKeyField?: string;
}

/**
 * SQLite 只读查询适配器（便于测试注入 fake，避免单测碰真实 DB / node:sqlite 实验警告）。
 * 对外只暴露一次"取 opencode provider 行"的查询。
 */
export interface CcSwitchReader {
  /** 查询 OpenCode Go 条目：返回 `providers` 表里 name/应用层匹配 opencode 的行。 */
  readOpencodeRows(): CcSwitchProviderRow[] | Promise<CcSwitchProviderRow[]>;
}

/**
 * 真实 reader：读 `~/.cc-switch/cc-switch.db`，取 `app_type='opencode'` 且 name 匹配
 * 'opencode'（大小写不敏感，含 'OpenCode Go'）的行。只读（SELECT），不改库。
 * node:sqlite 是实验性 API；通过动态 import 惰性加载（vitest/vite 无法静态解析 node:sqlite
 * 的 builtin id，测试注入 fake reader 不会触发这里）。
 */
export class SqliteCcSwitchReader implements CcSwitchReader {
  private readonly dbPath: string;
  constructor(dbPath = defaultCcSwitchDbPath()) {
    this.dbPath = dbPath;
  }
  async readOpencodeRows(): Promise<CcSwitchProviderRow[]> {
    const { DatabaseSync } = await import('node:sqlite');
    if (!fs.existsSync(this.dbPath)) return [];
    const db = new DatabaseSync(this.dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          `SELECT id, app_type, name, settings_config, is_current, provider_type
             FROM providers
            WHERE lower(app_type) = 'opencode' AND lower(name) LIKE '%opencode%'`,
        )
        .all() as Array<{
        id: unknown;
        app_type: unknown;
        name: unknown;
        settings_config: unknown;
        is_current: unknown;
        provider_type: unknown;
      }>;
      return rows.map((r) => ({
        id: String(r.id),
        app_type: String(r.app_type),
        name: String(r.name),
        settings_config: String(r.settings_config),
        is_current: Number(r.is_current) === 1,
        provider_type: typeof r.provider_type === 'string' ? r.provider_type : undefined,
      }));
    } finally {
      db.close();
    }
  }
}

function parseSettingsConfig(raw: string): OpencodeSettingsConfig | null {
  try {
    const o = JSON.parse(raw) as OpencodeSettingsConfig;
    if (typeof o !== 'object' || o === null) return null;
    return o;
  } catch {
    return null;
  }
}

/** 在 rows 里挑出当前激活（is_current）的那条，否则取第一条。 */
export function pickOpencodeRow(rows: CcSwitchProviderRow[]): CcSwitchProviderRow | undefined {
  return rows.find((r) => r.is_current) ?? rows[0];
}

/** 解析一条 opencode provider 行为 `CcSwitchOpencodeRef`（不读文件内明文）。 */
export function toCcSwitchOpencodeRef(
  row: CcSwitchProviderRow | undefined,
): CcSwitchOpencodeRef | null {
  if (!row) return null;
  const cfg = parseSettingsConfig(row.settings_config);
  if (!cfg || !cfg.options) return null;
  const baseUrl = cfg.options.baseURL?.replace(/\/+$/, '') || OPENCODE_GO_BASE_URL;
  return {
    rowId: row.id,
    name: cfg.name ?? row.name,
    baseUrl,
    apiKeyField: cfg.options.apiKey,
  };
}

/**
 * 把 opencode 的 apiKey 字段解析成明文 key：
 *   - `{file:<path>}` → 读对应 key 文件（进程内；path 支持 `~/` → 展开到 homedir）。
 *   - `{env:<NAME>}` → 读环境变量。
 *   - 内联 `sk-...` 明文 → 直接用（兼容旧配置）。
 *   - 其它 → null。
 * `fileReader` 可注入（测试 mock），默认读文件；`env` 可注入（默认 process.env）。
 * 绝不落盘、不打印 key。
 */
export function resolveApiKeyField(
  field: string | undefined,
  opts: {
    fileReader?: (p: string) => string | null;
    env?: NodeJS.ProcessEnv;
    home?: string;
  } = {},
): string | null {
  if (!field || field.trim() === '') return null;
  const fileReader = opts.fileReader ?? ((p: string) => {
    try {
      return fs.readFileSync(p, 'utf8').trim() || null;
    } catch {
      return null;
    }
  });
  const home = opts.home ?? os.homedir();
  const env = opts.env ?? process.env;
  // trim before matching so trailing whitespace (常见于 key 文件) 不干扰
  const f = field.trim();
  const fileMatch = /^\{file:(.+)\}$/.exec(f);
  if (fileMatch) {
    let p = fileMatch[1]!.trim();
    if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    else if (p.startsWith('%USERPROFILE%')) p = path.join(home, p.slice('%USERPROFILE%'.length));
    const raw = fileReader(p);
    // 统一裁剪首尾空白（key 文件常带尾随换行；真实 reader 内部也 trim）
    return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
  }
  const envMatch = /^\{env:([A-Z0-9_]+)\}$/.exec(f);
  if (envMatch) {
    const v = env[envMatch[1]!];
    return typeof v === 'string' && v.length > 0 ? v : null;
  }
  // 内联明文（sk-… / 其它非大括号引用）→ 直接用
  if (f.startsWith('{') === false) return f;
  return null;
}

/** 探查 CC Switch 库里的 OpenCode Go 条目（当前优先），解析出 baseUrl + key 引用。 */
export async function probeCcSwitchOpencode(opts: {
  reader?: CcSwitchReader;
  dbPath?: string;
} = {}): Promise<CcSwitchOpencodeRef | null> {
  const reader = opts.reader ?? new SqliteCcSwitchReader(opts.dbPath);
  const rows = await reader.readOpencodeRows();
  if (rows.length === 0) return null;
  return toCcSwitchOpencodeRef(pickOpencodeRow(rows));
}

/** 迁移失败原因的轻量描述（不含 key 片段）。 */
export interface MigrateResult {
  /** 是否成功把 key 加密写入 CredentialStore。 */
  synced: boolean;
  /** 来源（cc-switch）baseURL（与 preset 对齐确认用），无条目时为 null。 */
  baseUrl: string | null;
  /** 未同步时的原因（不含 key）。 */
  reason?: string;
  /** 命中的 CC Switch rowId（诊断用，不含 key）。 */
  rowId?: string;
}

/**
 * 凭据转接核心：探查 CC Switch → 解析 key（进程内）→ 经 CredentialStore 加密落库。
 * 返回结果**不含 key**；任何写盘都走注入的 store.set()（DPAPI 密文）。无条目/无 key 时
 * synced=false + reason，不抛、不写任何明文。
 */
export async function migrateOpencodeGoCredential(opts: {
  store: Pick<{ set(service: string, account: string, secret: string): Promise<void> }, 'set'>;
  reader?: CcSwitchReader;
  dbPath?: string;
  keyFileReader?: (p: string) => string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
  service?: string;
  account?: string;
}): Promise<MigrateResult> {
  const ref = await probeCcSwitchOpencode({ reader: opts.reader, dbPath: opts.dbPath });
  if (!ref) return { synced: false, baseUrl: null, reason: 'cc-switch 无 opencode-go 条目' };
  const key = resolveApiKeyField(ref.apiKeyField, {
    fileReader: opts.keyFileReader,
    env: opts.env,
    home: opts.home,
  });
  if (!key || key.length === 0) {
    return {
      synced: false,
      baseUrl: ref.baseUrl,
      rowId: ref.rowId,
      reason: 'apiKey 字段无法解析出明文（{file} 引用缺失或不可读）',
    };
  }
  await opts.store.set(opts.service ?? OPCODE_GO_CRED_SERVICE, opts.account ?? OPCODE_GO_CRED_ACCOUNT, key);
  return { synced: true, baseUrl: ref.baseUrl, rowId: ref.rowId };
}