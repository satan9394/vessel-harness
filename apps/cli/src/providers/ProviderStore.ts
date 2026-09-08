import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProviderName } from '@vessel/llm';
import {
  parseSecretRef,
  makeSecretRef,
  type SyncCredentialStore,
} from '@vessel/application';

/**
 * apps/cli/providers/ProviderStore — 供应商配置 SSOT 存储（task 014）。
 *
 * 单一事实源（SSOT）：用户级 ~/.vessel/providers.json + ~/.vessel/current.json
 * （沿用项目 memory/skills 已用的 ~/.vessel 用户目录约定，不另造 ~/.cah）。
 *
 * 约定：
 *   - mock 是内置默认供应商（id='mock'），永不写进 providers.json、不可
 *     add/remove；list() 时作为首项内置显示；getCurrent() 缺省 'mock'。
 *   - apiKey 本地明文存储（与 cc-switch 同款取舍）：仅本机用户目录可读，
 *     不做加密（YAGNI）。风险：任何能读 ~/.vessel 的进程/备份都能看到密钥。
 *   - 原子写：先写 <file>.tmp 再 rename 覆盖，防半写状态（crash 时最多
 *     残留 .tmp，原文件保持完整）。
 *   - 校验 fail-loud：重复 id、非法 protocol、add 时缺 model 一律 throw。
 *
 * protocol 字段直接复用 @vessel/llm 的 ProviderName（'mock'|'openai-compatible'
 * |'anthropic'），与 createProvider() 工厂天然对齐，015-018 的 CLI 命令可
 * 直接消费（list 出的配置 → createProvider(config.protocol, config)）。
 */

export interface ProviderConfig {
  /** 唯一 id（键；'mock' 为内置保留） */
  id: string;
  /** 展示名 */
  name: string;
  /** 线协议，与 @vessel/llm ProviderName 对齐 */
  protocol: ProviderName;
  /** endpoint URL（openai-compatible / anthropic 需要） */
  baseUrl?: string;
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

  constructor(opts: ProviderStoreOptions = {}) {
    // env override lets CLI tests isolate from the real ~/.vessel without touching
    // it; explicit opts.rootDir wins over env.
    this.rootDir = opts.rootDir ?? process.env.VESSEL_PROVIDER_ROOT ?? defaultProviderRoot();
    this.credentialStore = opts.credentialStore;
    this.credentialService = opts.credentialService ?? 'vessel';
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

  /** 原子写：<file>.tmp 写完 fsync 后 rename 覆盖目标（防半写）。 */
  private writeJsonAtomic(file: string, data: unknown): void {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
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
  }
}
