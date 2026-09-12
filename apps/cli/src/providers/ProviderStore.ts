import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderName } from '@vessel/llm';
import { assertCostMultiplier, DEFAULT_COST_MULTIPLIER, renameWithRetry } from '@vessel/shared';
import {
  parseSecretRef,
  makeSecretRef,
  type SyncCredentialStore,
} from '@vessel/application';
import { envRoot } from '../envRoot.js';

/**
 * apps/cli/providers/ProviderStore — 供应商配置 SSOT 存储（task 014）。
 *
 * 单一事实源（SSOT）：用户级 ~/.vessel/providers.json + ~/.vessel/current.json
 * （沿用项目 memory/skills 已用的 ~/.vessel 用户目录约定，不另造 ~/.cah）。
 *
 * 约定：
 *   - mock 是内置默认供应商（id='mock'），永不写进 providers.json、不可
 *     add/remove；list() 时作为首项内置显示；getCurrent() 缺省 'mock'。
 *   - 密钥安全（task 034 起）：apiKey **不再明文落 providers.json**。写入时经
 *     CredentialStore 存成 `secretRef`（`credential:vessel/<id>`），Windows 上
 *     走 DPAPI 加密的 secrets.json（其他平台显式降级 plaintext 并打印告警）；
 *     读取时经 store 解析回 apiKey，旧 providers.json 里的明文 apiKey 在加载时
 *     自动迁入 store 并从配置中移除。风险提示：plaintext 降级后端下
 *     secrets.json 仍可被能读 ~/.vessel 的进程读到——这是显式降级，不是默认。
 *   - 原子写：先写 <file>.tmp 再 rename 覆盖，防半写状态（crash 时最多
 *     残留 .tmp，原文件保持完整）。
 *   - 校验 fail-loud：重复 id、非法 protocol、add 时缺 model 一律 throw。
 *
 * protocol 字段直接复用 @vessel/llm 的 ProviderName（'mock'|'openai-compatible'
 * |'anthropic'），与 createProvider() 工厂天然对齐，015-018 的 CLI 命令可
 * 直接消费（list 出的配置 → createProvider(config.protocol, config)）。
 */

/**
 * 候选端点（task 096）：同一供应商的多个 baseUrl（容灾/加速候选）。
 *
 * 语义：`baseUrl` 仍是**默认端点**（`vessel run` 用它的那个）；`endpoints` 是
 * **候选池**，供 `vessel provider endpoint test` 测速排序给出建议。缺省（未配
 * endpoints）时候选池 = [baseUrl]（见 `effectiveEndpoints`）。
 */
export interface ProviderEndpoint {
  /** 端点 URL，与 baseUrl 同格式 */
  url: string;
  /** 可选标签（如 'cn' / 'us' / 'proxy'），仅用于展示 */
  label?: string;
}

export interface ProviderConfig {
  /** 唯一 id（键；'mock' 为内置保留） */
  id: string;
  /** 展示名 */
  name: string;
  /** 线协议，与 @vessel/llm ProviderName 对齐 */
  protocol: ProviderName;
  /** endpoint URL（openai-compatible / anthropic 需要）——**默认端点** */
  baseUrl?: string;
  /**
   * 候选端点池（task 096）。非空时 `effectiveEndpoints()` 以它为准；为空/缺省时
   * 回退到 `[baseUrl]`。**测速只给建议，绝不自动改 `baseUrl`**。
   */
  endpoints?: ProviderEndpoint[];
  /**
   * API 密钥——task 034 起默认不再明文写 providers.json：写入时经 CredentialStore
   * 存到 secretRef（`credential:vessel/<id>`），apiKey 字段清明文。保留本字段向后
   * 兼容读取：有 apiKey 用 apiKey；有 secretRef 则经 store 解析出 apiKey（get/load
   * 返回时都带 apiKey）。旧 providers.json 含明文 apiKey → 加载时自动迁入 store。
   */
  apiKey?: string;
  /** 凭据引用（`credential:<service>/<account>`）；与 apiKey 互斥，存 apiKey 后写 secretRef。 */
  secretRef?: string;
  /** 默认模型名（add 时必填） */
  model: string;
  /** 可选：可用模型清单（fetch 后缓存/用户维护） */
  models?: string[];
  /**
   * 成本倍率（task 094）：中转/代理加价场景。
   *
   * 语义：**只乘计费总额**（`总额 = 分项合计 × 倍率`），不改分项单价
   * （input/output/cacheRead/cacheWrite 的每 1M tokens 价一律不动）。
   * 缺省 1；必须是非负有限数字，非法值 fail loud（见 `assertValid`）。
   */
  costMultiplier?: number;
  /** 可选备注 */
  note?: string;
}

export interface ProviderStoreOptions {
  /** 覆盖存储根目录（测试注入 os.tmpdir() 下临时目录；默认 ~/.vessel） */
  rootDir?: string;
  /**
   * CredentialStore（同步后端）+ 凭据 service 名。提供后：add/save 会把 apiKey 移入
   * store 写 secretRef，load/get 解析 secretRef 回 apiKey，并自动迁移旧明文 apiKey。
   * 不提供则不启用凭据抽象（纯向后兼容路径，明文字段照原样读写）。
   */
  credentialStore?: SyncCredentialStore;
  /** 凭据 service 名（默认 'vessel'），secretRef ＝ `credential:<service>/<id>`。 */
  credentialService?: string;
  /**
   * 备份保留份数（task 095）：每次**写盘前**把旧文件复制到 `<root>/backups/`，
   * 每类文件各保留 N 份（默认 5；0 = 不备份）。缺省可用环境变量
   * `VESSEL_PROVIDER_BACKUP_KEEP` 覆盖，显式 opts 优先级最高。
   *
   * 环境变量口径（`envRoot`，与同概念的 `UsageStore.resolveBackupKeep()` 的
   * `VESSEL_USAGE_BACKUP_KEEP` 一致）：未设置/空串/纯空白 ⇒ **默认 5**；其余 trim 后解析。
   * 不能写 `envKeep === undefined ? 5 : parseBackupKeep(envKeep)`：`Number('') === 0` ⇒
   * `VESSEL_PROVIDER_BACKUP_KEEP=`（shell 里"清空变量"的常见写法）会**静默把备份数设成 0
   * = 关掉备份**——空值的默认行为本该是"用默认值"，而不是"关掉保护"。
   */
  backupKeep?: number;
}

/** 备份保留份数默认值（task 095）。 */
export const DEFAULT_BACKUP_KEEP = 5;

/** 备份文件名形如 `providers.2026-09-09T12-34-56-789Z.json`。 */
const BACKUP_STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z(?:-(\d+))?$/;

/** 一条备份的元信息（task 095）。 */
export interface ProviderBackupInfo {
  /** 备份的源文件类型（providers / current） */
  kind: string;
  /** 备份文件绝对路径 */
  file: string;
  /** 备份时刻（ISO 8601，取自文件名） */
  takenAt: string;
  /** 文件 mtime（同毫秒时间戳时的排序兜底） */
  mtimeMs: number;
}

/** 备份时间戳（文件名安全：冒号/点换成短横；字典序 = 时间序）。 */
function backupStamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

/** 解析备份文件名 → {kind, takenAt}；不匹配返回 null。 */
function parseBackupName(name: string): { kind: string; takenAt: string } | null {
  if (!name.endsWith('.json')) return null;
  const body = name.slice(0, -'.json'.length);
  const dot = body.indexOf('.');
  if (dot <= 0) return null;
  const kind = body.slice(0, dot);
  const stamp = body.slice(dot + 1);
  const m = BACKUP_STAMP_RE.exec(stamp);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  return { kind, takenAt: `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z` };
}

export function parseBackupKeep(raw: string | number, label = 'backupKeep'): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} 必须是非负整数（收到 "${String(raw)}"；0 = 关闭备份）`);
  }
  return n;
}

export const PROVIDER_PROTOCOLS: readonly ProviderName[] = [
  'mock',
  'openai-compatible',
  'anthropic',
];

/** 内置 mock 供应商：不可删除、不持久化、list 首项 / getCurrent 缺省。 */
export const BUILTIN_MOCK_PROVIDER: ProviderConfig = {
  id: 'mock',
  name: 'mock',
  protocol: 'mock',
  model: 'mock',
  note: 'built-in offline provider (deterministic scripts, never persisted)',
};

/** 默认用户级根目录：~/.vessel（与 ScopedMemoryStore 的 userMemoryRoot 同风格）。 */
export function defaultProviderRoot(home = os.homedir()): string {
  return path.join(home, '.vessel');
}

function isProviderConfig(v: unknown): v is ProviderConfig {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.id === 'string' &&
    typeof c.name === 'string' &&
    typeof c.protocol === 'string' &&
    typeof c.model === 'string'
  );
}

/**
 * ProviderStore — providers.json / current.json 的读写封装。
 *
 * 全部 IO 为同步（小型用户级存储；与 memory/ProjectStore 一致）。路径一律
 * path.join 拼接，不手工拼字符串（Windows 安全）。
 */
export class ProviderStore {
  /** 存储根目录（public：测试注入断言 / CLI 诊断用）。 */
  readonly rootDir: string;
  /** 可选的 CredentialStore 同步后端（启用了凭据抽象时才非空）。 */
  readonly credentialStore?: SyncCredentialStore;
  /** 凭据 service 名（secretRef = `credential:<service>/<id>`）。 */
  readonly credentialService: string;
  /** 备份保留份数（0 = 关闭备份；env 空/纯空白 ⇒ 默认 `DEFAULT_BACKUP_KEEP`）。 */
  readonly backupKeep: number;

  constructor(opts: ProviderStoreOptions = {}) {
    // env override lets CLI tests isolate from the real ~/.vessel without touching
    // it; explicit opts.rootDir wins over env.
    //
    // 唯一口径（`../envRoot.js` → `@vessel/shared` 的 `envRoot`）：`VESSEL_PROVIDER_ROOT`
    // 为空/纯空白 ⇒ **未设置**（回落 defaultProviderRoot()），其余 trim。
    // 兼容前这里是 `?? process.env.VESSEL_PROVIDER_ROOT ?? …`：`VESSEL_PROVIDER_ROOT=`
    // 会让 rootDir='' ⇒ 从**进程 CWD** 读写 providers.json/current.json，而同一次运行的
    // usage/凭据在 `~/.vessel`（`providerStateRoot()` 走的是 envRoot）⇒ 状态根被静默拆成两处。
    this.rootDir = opts.rootDir ?? envRoot('VESSEL_PROVIDER_ROOT') ?? defaultProviderRoot();
    this.credentialStore = opts.credentialStore;
    this.credentialService = opts.credentialService ?? 'vessel';
    // 备份保留份数：同一概念只用一种读法（见 ProviderStoreOptions.backupKeep 注释）。
    // `envRoot` 把 undefined/''/纯空白一律判成「未设置」⇒ 默认 5（**绝不会**静默变成 0）。
    const envKeep = envRoot('VESSEL_PROVIDER_BACKUP_KEEP');
    this.backupKeep =
      opts.backupKeep !== undefined
        ? parseBackupKeep(opts.backupKeep)
        : envKeep === undefined
          ? DEFAULT_BACKUP_KEEP
          : parseBackupKeep(envKeep, 'VESSEL_PROVIDER_BACKUP_KEEP');
  }

  /** 备份目录（`~/.vessel/backups/`，task 095）。 */
  get backupsDir(): string {
    return path.join(this.rootDir, 'backups');
  }

  /** providers.json 的完整路径。 */
  get providersFile(): string {
    return path.join(this.rootDir, 'providers.json');
  }

  /** current.json 的完整路径。 */
  get currentFile(): string {
    return path.join(this.rootDir, 'current.json');
  }

  /** 凭据是否启用：有后端即启用（否则纯明文字段向后兼容）。 */
  get credentialsEnabled(): boolean {
    return this.credentialStore !== undefined;
  }

  /**
   * 读用户配置列表（不含内置 mock）。首次运行无文件 → 返回 []（不报错）；
   * 文件存在但损坏/结构非法 → fail loud。
   *
   * 启用 CredentialStore 时：加载后逐项解析 secretRef→apiKey，并把仍留在
   * providers.json 里的旧明文 apiKey 自动迁入 store＋改写为 secretRef（幂等：迁移后
   * 无剩余明文，下次加载不再触发）。
   */
  load(): ProviderConfig[] {
    const list = this.rawLoad();
    return this.resolveSecrets(list);
  }

  /**
   * 全量校验 + 原子写盘。任一配置非法（重复 id / 非法 protocol / 缺 model）
   * 即 throw，不落盘任何内容。
   *
   * 启用 CredentialStore 时：写盘前把每项的 apiKey 迁入 store（service=credentialService，
   * account=id）并改为 secretRef，providers.json 不再落明文；未启用则原样保留 apiKey
   * 字段（纯向后兼容路径）。
   */
  save(configs: ProviderConfig[]): void {
    const seen = new Set<string>();
    for (const c of configs) {
      this.assertValid(c);
      if (seen.has(c.id)) {
        throw new Error(`duplicate provider id: "${c.id}"`);
      }
      seen.add(c.id);
    }
    const toPersist = configs.map((c) => this.stripSecretForPersist(c));
    this.writeJsonAtomic(this.providersFile, toPersist.filter((c) => c.id !== 'mock'));
  }

  /** 内置 mock 首项 + 用户配置（存储顺序 = 插入顺序）。 */
  list(): ProviderConfig[] {
    return [BUILTIN_MOCK_PROVIDER, ...this.load()];
  }

  /** 查单个配置：内置 mock 也可查；不存在返回 undefined。 */
  get(id: string): ProviderConfig | undefined {
    if (id === 'mock') return BUILTIN_MOCK_PROVIDER;
    return this.load().find((c) => c.id === id);
  }

  /** 新增配置（id 不可为 'mock'）；重复 id / 非法 protocol / 缺 model fail loud。 */
  add(config: ProviderConfig): void {
    if (config.id === 'mock') {
      throw new Error('provider id "mock" is built-in and cannot be added');
    }
    this.assertValid(config);
    const list = this.load();
    if (list.some((c) => c.id === config.id)) {
      throw new Error(`duplicate provider id: "${config.id}"`);
    }
    this.save([...list, config]);
  }

  /** 删除配置（mock 不可删除）；id 不存在 fail loud。 */
  remove(id: string): void {
    if (id === 'mock') {
      throw new Error('provider "mock" is built-in and cannot be removed');
    }
    const list = this.load();
    if (!list.some((c) => c.id === id)) {
      throw new Error(`provider not found: "${id}"`);
    }
    // 在删除前记录 current，避免宽容回退掩盖（删除后 getCurrent 已读不到 id）。
    const wasCurrent = this.getCurrent() === id;
    this.save(list.filter((c) => c.id !== id));
    // 移除的恰是当前默认 → 复位为 mock 缺省（写 current.json，不删文件）。
    if (wasCurrent) {
      this.setCurrent('mock');
    }
  }

  /**
   * 更新已有配置的字段（task 094：`vessel provider set`）。id 不存在 fail loud。
   *
   * `costMultiplier` 用 `'costMultiplier' in patch` 判定：显式传 `undefined` 表示
   * 清除该字段（回到缺省 1），不传则保持原值。合并后仍走 `save()` 的全量校验 + 原子写。
   */
  update(id: string, patch: Partial<Omit<ProviderConfig, 'id'>>): ProviderConfig {
    if (id === 'mock') {
      throw new Error('provider "mock" is built-in and cannot be modified');
    }
    const list = this.load();
    const index = list.findIndex((c) => c.id === id);
    if (index < 0) {
      throw new Error(`provider not found: "${id}"`);
    }
    const current = list[index]!;
    const next: ProviderConfig = { ...current, ...patch, id: current.id };
    if ('costMultiplier' in patch && patch.costMultiplier === undefined) {
      delete next.costMultiplier;
    }
    if ('endpoints' in patch && patch.endpoints === undefined) {
      delete next.endpoints;
    }
    list[index] = next;
    this.save(list);
    return next;
  }

  /** 单个 provider 的成本倍率（094；未设置或不存在 → 缺省 1）。 */
  costMultiplierOf(id: string): number {
    const cfg = this.get(id);
    return cfg?.costMultiplier ?? DEFAULT_COST_MULTIPLIER;
  }

  /** 全部**显式设置**的成本倍率（provider id → 倍率）；缺省 1 的不列出。 */
  costMultipliers(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const cfg of this.load()) {
      if (cfg.costMultiplier !== undefined) out[cfg.id] = cfg.costMultiplier;
    }
    return out;
  }

  /**
   * 有效候选端点（task 096）：配了 `endpoints`（非空）→ 用它；否则回退
   * `[baseUrl]`；两者都没有 → []。`source` 标出该条目来自候选池还是 baseUrl 回退。
   */
  effectiveEndpoints(id: string): (ProviderEndpoint & { source: 'endpoints' | 'baseUrl' })[] {
    const cfg = this.get(id);
    if (!cfg) throw new Error(`provider not found: "${id}"`);
    if (cfg.endpoints !== undefined && cfg.endpoints.length > 0) {
      return cfg.endpoints.map((e) => ({ ...e, source: 'endpoints' as const }));
    }
    return cfg.baseUrl ? [{ url: cfg.baseUrl, source: 'baseUrl' as const }] : [];
  }

  /**
   * 追加候选端点（task 096）。首次追加时把当前 `baseUrl` 物化进候选池首项，
   * 保证「默认端点」不会被候选池挤掉；重复 url / 空 url fail loud。
   */
  addEndpoint(id: string, url: string, label?: string): ProviderEndpoint[] {
    const cfg = this.get(id);
    if (!cfg) throw new Error(`provider not found: "${id}"`);
    if (typeof url !== 'string' || url.trim() === '') {
      throw new Error(`invalid endpoint url: "${String(url)}" (must be a non-empty string)`);
    }
    const pool: ProviderEndpoint[] = this.effectiveEndpoints(id).map((e) => ({
      url: e.url,
      ...(e.label !== undefined ? { label: e.label } : {}),
    }));
    if (pool.some((e) => e.url === url)) {
      throw new Error(`endpoint already exists for provider "${id}": ${url}`);
    }
    pool.push(label !== undefined && label !== '' ? { url, label } : { url });
    const next = this.update(id, { endpoints: pool });
    return next.endpoints ?? pool;
  }

  /** 移除候选端点（按 url 精确匹配）；不存在 fail loud。 */
  removeEndpoint(id: string, url: string): ProviderEndpoint[] {
    const cfg = this.get(id);
    if (!cfg) throw new Error(`provider not found: "${id}"`);
    const pool = this.effectiveEndpoints(id);
    const match = pool.find((e) => e.url === url);
    if (!match) {
      throw new Error(`endpoint not found for provider "${id}": ${url}`);
    }
    if (match.source === 'baseUrl') {
      throw new Error(
        `endpoint "${url}" 是 provider "${id}" 的默认端点（baseUrl），不在候选池里；` +
          `改默认端点请用 vessel provider set ${id} --base-url <url>`,
      );
    }
    const remaining = pool
      .filter((e) => e.url !== url)
      .map((e) => ({ url: e.url, ...(e.label !== undefined ? { label: e.label } : {}) }));
    // 移除后候选池为空、或只剩「与 baseUrl 等价的单条」→ 清空字段，回退 baseUrl 语义
    // （保持 providers.json 最小：不留下与默认端点重复的冗余候选）。
    const redundant = remaining.length === 0 || (remaining.length === 1 && remaining[0]!.url === cfg.baseUrl);
    const next = this.update(id, { endpoints: redundant ? undefined : remaining });
    return next.endpoints ?? [];
  }

  /**
   * 列出备份（task 095），最新在前。目录不存在 → []（不建目录、不报错）。
   */
  listBackups(): ProviderBackupInfo[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.backupsDir);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return [];
      throw err;
    }
    const out: ProviderBackupInfo[] = [];
    for (const name of names) {
      const parsed = parseBackupName(name);
      if (!parsed) continue;
      const file = path.join(this.backupsDir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(file).mtimeMs;
      } catch {
        // 并发改名/删除竞态：mtime 缺失时退化为仅按文件名排序
      }
      out.push({ kind: parsed.kind, file, takenAt: parsed.takenAt, mtimeMs });
    }
    // 最新在前：文件名时间戳优先，同毫秒用 mtime 兜底。
    out.sort((a, b) => {
      if (a.takenAt !== b.takenAt) return a.takenAt < b.takenAt ? 1 : -1;
      if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs;
      return a.file < b.file ? 1 : -1;
    });
    return out;
  }

  /** 设当前默认供应商；id 必须存在（含内置 mock）。 */
  setCurrent(id: string): void {
    if (this.get(id) === undefined) {
      throw new Error(`provider not found: "${id}"`);
    }
    this.writeJsonAtomic(this.currentFile, { id });
  }

  /** 当前默认供应商 id；无 current.json → 缺省 'mock'。 */
  getCurrent(): string {
    let text: string;
    try {
      text = fs.readFileSync(this.currentFile, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return 'mock';
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`current file corrupted (invalid JSON): ${this.currentFile}`, { cause: err });
    }
    if (typeof raw !== 'object' || raw === null || typeof (raw as { id?: unknown }).id !== 'string') {
      throw new Error(`current file corrupted (expected {"id": string}): ${this.currentFile}`);
    }
    const id = (raw as { id: string }).id;
    // 指向的 id 已不存在（手工编辑/外部删除）→ 宽容回退 mock 缺省。
    return this.get(id) !== undefined ? id : 'mock';
  }

  // ---- internal ----

  /** 原子写：<file>.tmp 写完 fsync 后 rename 覆盖目标（防半写）。写前先备份旧文件。
   *  task 113 起 rename 走共享有界重试（EPERM/EBUSY/EACCES，3 次 5/15ms）——
   *  实为治理升级：此前该点无任何重试。 */
  private writeJsonAtomic(file: string, data: unknown): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.backupBeforeWrite(file);
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameWithRetry(tmp, file);
  }

  /**
   * 写盘前备份（task 095）：把目标文件**原样**复制成 `backups/<kind>.<ts>.json`，
   * 每类文件各保留 `backupKeep` 份。
   *
   * 轮转**不做任何删除**（删除铁律：禁止永久删除）——达到上限时把最旧的一份
   * **改名**成新时间戳再覆盖，文件数恒定 ≤ N；改名失败（Windows 偶发 EPERM）
   * 时退化为原地覆盖最旧文件，同样不产生删除动作。备份内容 = 旧文件字节原样，
   * 可直接拷回 providers.json 回滚。
   */
  private backupBeforeWrite(file: string): void {
    if (this.backupKeep <= 0) return;
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(file);
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return; // 首次写：无旧文件可备份
      throw err;
    }
    fs.mkdirSync(this.backupsDir, { recursive: true });
    const kind = path.basename(file, '.json');
    const existing = this.listBackups().filter((b) => b.kind === kind);
    if (existing.length >= this.backupKeep) {
      // 最旧一份改名 + 覆盖：文件数不变，且不删除任何东西。
      const oldest = existing[existing.length - 1]!.file;
      const target = this.uniqueBackupPath(kind, backupStamp(new Date()));
      try {
        fs.renameSync(oldest, target);
      } catch {
        fs.writeFileSync(oldest, bytes); // 改名失败 → 原地覆盖（仍无删除）
        return;
      }
      fs.writeFileSync(target, bytes);
      return;
    }
    fs.writeFileSync(this.uniqueBackupPath(kind, backupStamp(new Date())), bytes);
  }

  /** 备份路径去重：同毫秒多次写盘时追加 `-1`/`-2` 后缀。 */
  private uniqueBackupPath(kind: string, stamp: string): string {
    let candidate = path.join(this.backupsDir, `${kind}.${stamp}.json`);
    let n = 0;
    while (fs.existsSync(candidate)) {
      n += 1;
      candidate = path.join(this.backupsDir, `${kind}.${stamp}-${n}.json`);
    }
    return candidate;
  }

  /** 读盘 + 校验（不做任何凭据解析/迁移的纯读取）。 */
  private rawLoad(): ProviderConfig[] {
    let text: string;
    try {
      text = fs.readFileSync(this.providersFile, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return [];
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw new Error(`providers file corrupted (invalid JSON): ${this.providersFile}`, { cause: err });
    }
    if (!Array.isArray(raw)) {
      throw new Error(`providers file corrupted (expected array): ${this.providersFile}`);
    }
    // mock 永不持久化：文件里若出现（手工编辑），load 时过滤掉，保证 list 无重复。
    const list: ProviderConfig[] = [];
    for (const item of raw) {
      if (!isProviderConfig(item)) {
        throw new Error(`providers file corrupted (bad entry): ${this.providersFile}`);
      }
      const entry = item as ProviderConfig;
      if (entry.id === 'mock') continue;
      this.assertValid(entry);
      list.push(entry);
    }
    return list;
  }

  /**
   * 凭据解析 + 迁移（load 的核心）：返回读到的配置，每项保证带 apiKey：
   *   - 有明文 apiKey（旧格式）→ 启用 store 时迁入 store 并改 secretRef 写回；
   *     未启用则原样返回。
   *   - 有 secretRef → 经 store 解析出 apiKey（解析失败返回 null）。
   * 迁移是文件改写（原子写 providers.json），不是删除，安全。
   */
  private resolveSecrets(list: ProviderConfig[]): ProviderConfig[] {
    const cred = this.credentialStore;
    if (!cred) return list;
    let migrated = false;
    const resolved: ProviderConfig[] = list.map((c) => {
      const out = { ...c };
      if (typeof c.apiKey === 'string' && c.apiKey.length > 0 && !c.secretRef) {
        // 旧明文 apiKey → 迁入 store，改写为 secretRef。
        cred.setSync(this.credentialService, c.id, c.apiKey);
        out.apiKey = c.apiKey; // 解析结果仍供调用方直接用
        out.secretRef = makeSecretRef(this.credentialService, c.id);
        migrated = true;
      } else if (typeof c.secretRef === 'string' && !c.apiKey) {
        const parsed = parseSecretRef(c.secretRef);
        if (parsed && parsed.service === this.credentialService) {
          out.apiKey = cred.getSync(parsed.service, parsed.account) ?? undefined;
        }
      }
      return out;
    });
    // 有明文迁走 → 把 providers.json 改写为 secretRef（幂等；此后再读无明文）。
    if (migrated) {
      const toPersist = resolved.map((r) => this.stripSecretForPersist(r));
      this.writeJsonAtomic(this.providersFile, toPersist.filter((p) => p.id !== 'mock'));
    }
    return resolved;
  }

  /**
   * 写盘前移除/改写敏感字段：启用 store 时把 apiKey 存进 store 并换成交给
   * providers.json 的 secretRef（apiKey 清明文）；未启用则原样返回。
   */
  private stripSecretForPersist(c: ProviderConfig): ProviderConfig {
    const cred = this.credentialStore;
    if (!cred) return c;
    const out: ProviderConfig = { ...c };
    if (typeof out.apiKey === 'string' && out.apiKey.length > 0 && !out.secretRef) {
      cred.setSync(this.credentialService, out.id, out.apiKey);
      out.secretRef = makeSecretRef(this.credentialService, out.id);
    }
    // 启用 store 时 providers.json 永不落明文。
    delete out.apiKey;
    return out;
  }

  /** 单项校验（fail loud）。 */
  private assertValid(c: ProviderConfig): void {
    if (typeof c !== 'object' || c === null) {
      throw new Error('invalid provider config: not an object');
    }
    if (typeof c.id !== 'string' || c.id.trim() === '') {
      throw new Error(`invalid provider id: "${String(c.id)}" (must be a non-empty string)`);
    }
    if (!PROVIDER_PROTOCOLS.includes(c.protocol)) {
      throw new Error(
        `invalid protocol "${String(c.protocol)}" for provider "${c.id}" ` +
          `(available: ${PROVIDER_PROTOCOLS.join(', ')})`,
      );
    }
    if (typeof c.model !== 'string' || c.model.trim() === '') {
      throw new Error(`provider "${c.id}" requires a non-empty "model"`);
    }
    if (typeof c.name !== 'string' || c.name.trim() === '') {
      throw new Error(`provider "${c.id}" requires a non-empty "name"`);
    }
    // task 094：倍率直接乘在钱上，非法值必须 fail loud（负数 / NaN / Infinity / 非数字）。
    if (c.costMultiplier !== undefined) {
      assertCostMultiplier(c.costMultiplier, `provider "${c.id}" costMultiplier`);
    }
    // task 096：候选端点必须是 {url, label?} 数组，url 非空且不重复。
    if (c.endpoints !== undefined) {
      if (!Array.isArray(c.endpoints)) {
        throw new Error(`provider "${c.id}" endpoints must be an array of {url, label?}`);
      }
      const seenUrls = new Set<string>();
      for (const [i, ep] of c.endpoints.entries()) {
        if (typeof ep !== 'object' || ep === null) {
          throw new Error(`provider "${c.id}" endpoints[${i}] must be an object {url, label?}`);
        }
        if (typeof ep.url !== 'string' || ep.url.trim() === '') {
          throw new Error(`provider "${c.id}" endpoints[${i}].url must be a non-empty string`);
        }
        if (ep.label !== undefined && (typeof ep.label !== 'string' || ep.label.trim() === '')) {
          throw new Error(`provider "${c.id}" endpoints[${i}].label must be a non-empty string when present`);
        }
        if (seenUrls.has(ep.url)) {
          throw new Error(`provider "${c.id}" has duplicate endpoint url: ${ep.url}`);
        }
        seenUrls.add(ep.url);
      }
    }
  }
}
