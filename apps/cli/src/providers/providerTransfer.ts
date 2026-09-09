import { makeSecretRef } from '@vessel/application';
import { PROVIDER_PROTOCOLS, type ProviderConfig, type ProviderEndpoint, type ProviderStore } from './ProviderStore.js';

/**
 * apps/cli/providers/providerTransfer — 供应商配置导入导出（task 095）。
 *
 * 安全铁律（本模块的全部存在理由）：**导出永不含明文密钥**。
 *   - 导出时 `apiKey` 字段一律剥离；原本带密钥的条目改写成 `secretRef`
 *     （`credential:<service>/<id>` 占位或原 secretRef 引用）——引用不是秘密，
 *     它只指向**本机**凭据库，跨机器导入后需要重新录入密钥。
 *   - `--with-secrets` **直接拒绝**（见 cli.ts 的 export 分支）：本项目没有任何
 *     「明文导出」路径。密钥迁移走 CredentialStore（DPAPI 加密的 secrets.json）
 *     或环境变量，不走配置文件。
 *   - 导入时文件里若出现明文 `apiKey`（手写文件/第三方工具产物）→ 一律**剥离**
 *     并在结果里报告，绝不写进 providers.json。
 *
 * 冲突策略（导入）：
 *   - `skip`（默认）：同名 id 保留本地配置，文件里的被跳过；
 *   - `overwrite`：以文件内容覆盖本地，但**文件未带密钥时保留本地 secretRef 绑定**
 *     （避免覆盖把本机密钥引用弄丢）；
 *   - 非交互 CLI 不做「询问」：默认跳过，要覆盖显式 `--on-conflict overwrite`。
 */

/** 导出文件标识（kind 字段，防止把任意 JSON 当供应商配置导入）。 */
export const PROVIDER_EXPORT_KIND = 'vessel-provider-export';
/** 导出文件版本（不兼容变更时 +1；导入遇到未知版本 fail loud）。 */
export const PROVIDER_EXPORT_VERSION = 1;

/** 导出条目：与 ProviderConfig 同形，但**没有 apiKey**。 */
export type ExportedProvider = Omit<ProviderConfig, 'apiKey'>;

/** 导出文件结构（信封）。 */
export interface ProviderExportFile {
  kind: typeof PROVIDER_EXPORT_KIND;
  version: number;
  /** 导出时刻（ISO 8601） */
  exportedAt: string;
  /** 恒为 true：本文件不含任何明文密钥（机器可读的自我声明） */
  redacted: true;
  /** 被剥离的密钥条目数（仅计数，不含内容） */
  keysRedacted: number;
  /** 导出时的当前默认供应商 id（导入不自动套用，仅供参考） */
  current: string;
  /** 条目数 = providers.length */
  count: number;
  providers: ExportedProvider[];
}

/** 导入冲突策略。 */
export type ImportConflictStrategy = 'skip' | 'overwrite';

export interface ImportOptions {
  /** 同名 id 冲突策略（默认 'skip'）。 */
  onConflict?: ImportConflictStrategy;
  /** 只演练不写盘（默认 false）。 */
  dryRun?: boolean;
}

export interface ImportResult {
  /** 新增的 provider id */
  added: string[];
  /** 覆盖的 provider id（onConflict='overwrite'） */
  overwritten: string[];
  /** 跳过的 provider id（同名冲突 + 内置 mock） */
  skipped: string[];
  /** 被剥离明文 apiKey 的 provider id */
  strippedKeys: string[];
  /** 是否真的写盘（dryRun 时 false） */
  written: boolean;
}

/** 导入文件非法（结构/版本/条目）时抛出的错误。 */
export class ProviderImportError extends Error {}

/**
 * 单条配置脱敏：剥离 apiKey；原本有密钥但无 secretRef 的条目补一个
 * `credential:<service>/<id>` 占位引用（指向本机凭据库，不是密钥本身）。
 */
export function redactProvider(cfg: ProviderConfig, service: string): { entry: ExportedProvider; hadKey: boolean } {
  const { apiKey, ...rest } = cfg;
  const entry: ExportedProvider = { ...rest };
  const hadKey = typeof apiKey === 'string' && apiKey.length > 0;
  if (hadKey && !entry.secretRef) {
    entry.secretRef = makeSecretRef(service, cfg.id);
  }
  // 兜底：secretRef 字段里塞了非 `credential:` 的东西（手工编辑/第三方产物）
  // 一律替换成占位引用，避免任何形态的明文密钥被导出。
  if (entry.secretRef !== undefined && !entry.secretRef.startsWith('credential:')) {
    entry.secretRef = makeSecretRef(service, cfg.id);
  }
  return { entry, hadKey };
}

/** 构造导出信封（读 store，不写任何东西）。 */
export function buildExport(store: ProviderStore, opts: { now?: Date } = {}): ProviderExportFile {
  const now = opts.now ?? new Date();
  const configs = store.load(); // 不含内置 mock（mock 永不持久化）
  let keysRedacted = 0;
  const providers = configs.map((c) => {
    const { entry, hadKey } = redactProvider(c, store.credentialService);
    if (hadKey) keysRedacted += 1;
    return entry;
  });
  const file: ProviderExportFile = {
    kind: PROVIDER_EXPORT_KIND,
    version: PROVIDER_EXPORT_VERSION,
    exportedAt: now.toISOString(),
    redacted: true,
    keysRedacted,
    current: store.getCurrent(),
    count: providers.length,
    providers,
  };
  // 自我校验：序列化结果里不允许出现 apiKey 字段（脱敏回归的硬断言）。
  if (JSON.stringify(file).includes('"apiKey"')) {
    throw new Error('export 自检失败：导出内容仍含 apiKey 字段（脱敏逻辑有 bug，拒绝输出）');
  }
  return file;
}

/** 序列化为可落盘/可打印的文本（末尾换行）。 */
export function serializeExport(file: ProviderExportFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/**
 * 解析导入文件（fail loud）：
 *   - 信封 `{kind, version, providers}`（本项目导出格式）；
 *   - 裸数组 `[{id, ...}]`（宽容读取：手写/第三方工具的最小形态）。
 * 版本不认识 → 抛错；条目结构非法 → 抛错。
 */
export function parseImportFile(
  text: string,
  source = 'import file',
): { providers: ProviderConfig[]; keysStrippedInFile: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ProviderImportError(`${source} 不是合法 JSON: ${(err as Error).message}`);
  }
  let entries: unknown[];
  if (Array.isArray(raw)) {
    entries = raw;
  } else if (typeof raw === 'object' && raw !== null) {
    const env = raw as Partial<ProviderExportFile>;
    if (env.kind !== PROVIDER_EXPORT_KIND) {
      throw new ProviderImportError(`${source} 缺少 kind="${PROVIDER_EXPORT_KIND}"（不是本项目的供应商导出文件）`);
    }
    if (env.version !== PROVIDER_EXPORT_VERSION) {
      throw new ProviderImportError(
        `${source} 版本不支持: ${String(env.version)}（本工具支持 version=${PROVIDER_EXPORT_VERSION}）`,
      );
    }
    if (!Array.isArray(env.providers)) {
      throw new ProviderImportError(`${source} 缺少 providers 数组`);
    }
    entries = env.providers;
  } else {
    throw new ProviderImportError(`${source} 结构非法（应为对象或数组）`);
  }

  const providers: ProviderConfig[] = [];
  const keysStrippedInFile: string[] = [];
  const seen = new Set<string>();
  for (const [i, item] of entries.entries()) {
    if (typeof item !== 'object' || item === null) {
      throw new ProviderImportError(`${source} providers[${i}] 不是对象`);
    }
    const c = item as Record<string, unknown>;
    for (const field of ['id', 'name', 'protocol', 'model'] as const) {
      if (typeof c[field] !== 'string' || (c[field] as string).trim() === '') {
        throw new ProviderImportError(`${source} providers[${i}].${field} 必须是非空字符串`);
      }
    }
    if (!PROVIDER_PROTOCOLS.includes(c.protocol as ProviderConfig['protocol'])) {
      throw new ProviderImportError(
        `${source} providers[${i}].protocol 非法: "${String(c.protocol)}"（可用: ${PROVIDER_PROTOCOLS.join(', ')}）`,
      );
    }
    const id = c.id as string;
    if (seen.has(id)) {
      throw new ProviderImportError(`${source} 里 provider id 重复: "${id}"`);
    }
    seen.add(id);
    // 明文 apiKey 一律剥离（不进入结果，也绝不落盘）；其余字段按白名单挑选，
    // 避免第三方文件里的未知字段被顺手写进 providers.json。
    if (typeof c.apiKey === 'string' && c.apiKey.length > 0) keysStrippedInFile.push(id);
    const entry: ProviderConfig = {
      id,
      name: c.name as string,
      protocol: c.protocol as ProviderConfig['protocol'],
      model: c.model as string,
    };
    if (typeof c.baseUrl === 'string') entry.baseUrl = c.baseUrl;
    if (typeof c.secretRef === 'string') entry.secretRef = c.secretRef;
    if (Array.isArray(c.models)) entry.models = c.models.filter((m): m is string => typeof m === 'string');
    if (typeof c.note === 'string') entry.note = c.note;
    if (c.costMultiplier !== undefined) entry.costMultiplier = c.costMultiplier as number;
    if (c.endpoints !== undefined) entry.endpoints = c.endpoints as ProviderEndpoint[];
    providers.push(entry);
  }
  return { providers, keysStrippedInFile };
}

/**
 * 合并导入：读 store → 按策略合并 → 全量校验后一次原子写盘（dryRun 不写）。
 *
 * 合并规则：
 *   - 内置 id 'mock' 一律跳过（不可持久化）；
 *   - 同名冲突按 `onConflict`（默认 skip）；overwrite 时文件未带 secretRef 而本地
 *     有 → 保留本地 secretRef（密钥绑定不因覆盖而丢）；
 *   - 文件里的明文 apiKey 已在上一步剥离，合并结果里不存在明文密钥。
 */
export function importProviders(
  store: ProviderStore,
  text: string,
  opts: ImportOptions = {},
  source = 'import file',
): ImportResult {
  const strategy = opts.onConflict ?? 'skip';
  const parsed = parseImportFile(text, source);
  const existing = store.load();
  const next = [...existing];
  const result: ImportResult = {
    added: [],
    overwritten: [],
    skipped: [],
    strippedKeys: [...parsed.keysStrippedInFile],
    written: false,
  };
  for (const incoming of parsed.providers) {
    if (incoming.id === 'mock') {
      result.skipped.push('mock');
      continue;
    }
    const idx = next.findIndex((c) => c.id === incoming.id);
    if (idx < 0) {
      next.push(incoming);
      result.added.push(incoming.id);
      continue;
    }
    if (strategy === 'skip') {
      result.skipped.push(incoming.id);
      continue;
    }
    const local = next[idx]!;
    const merged: ProviderConfig = { ...incoming };
    if (!merged.secretRef && local.secretRef) merged.secretRef = local.secretRef;
    next[idx] = merged;
    result.overwritten.push(incoming.id);
  }
  // 没有任何实际变更（全是跳过）→ 不写盘（避免无意义的重写与备份）。
  const changed = result.added.length > 0 || result.overwritten.length > 0;
  if (opts.dryRun || !changed) return result;
  store.save(next);
  result.written = true;
  return result;
}
