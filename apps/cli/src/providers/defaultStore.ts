import * as path from 'node:path';
import { createCredentialStore, type SyncCredentialStore } from '@vessel/application';
import { ProviderStore, defaultProviderRoot } from './ProviderStore.js';
import { envRoot } from '../envRoot.js';

/**
 * apps/cli/providers/defaultStore — CLI/TUI 的**默认 ProviderStore** 唯一构造路径（task 034 → 106）。
 *
 * 为什么要有这个模块（task 106 发现 2）：`vessel run` 走 `cli.ts` 的 `defaultProviderStore()`
 * （已接 CredentialStore），而 TUI `runChat()` 的兜底分支写成 `new ProviderStore()` —— **没有凭据后端**，
 * 于是 providers.json 里的 `secretRef` 解析不出 `apiKey` → `401 Missing API key`。
 * 现在两条路径共用本工厂：secretRef 的解析能力只有一份实现，不会再各自漂移。
 *
 * 状态根与凭据文件**同根**：`VESSEL_PROVIDER_ROOT` 指向临时目录时，`secrets.json` 也落在该目录，
 * 测试既不会读也不会写真实 `~/.vessel`（task 106 隔离要求；未设该变量时行为与 034 完全一致）。
 */

/** 生效的 provider 状态根（`VESSEL_PROVIDER_ROOT` 覆盖；缺省 `~/.vessel`，与 ProviderStore 同口径）。 */
export function providerStateRoot(): string {
  return envRoot('VESSEL_PROVIDER_ROOT') ?? defaultProviderRoot();
}

export interface DefaultProviderStoreOptions {
  /** 备份保留份数（095）；缺省走 `VESSEL_PROVIDER_BACKUP_KEEP` / 内置默认。 */
  backupKeep?: number;
  /** 覆盖凭据后端（测试注入内存/明文后端，绝不碰真实 secrets.json）。 */
  credentialStore?: SyncCredentialStore;
  /** 覆盖状态根（测试用）；缺省 `VESSEL_PROVIDER_ROOT` / `~/.vessel`。 */
  rootDir?: string;
}

/**
 * 构造默认 ProviderStore：接 CredentialStore（Windows DPAPI 加密，其余平台显式降级明文），
 * providers.json 只留 secretRef、读取时解析回 apiKey。
 */
export function createDefaultProviderStore(opts: DefaultProviderStoreOptions = {}): ProviderStore {
  const rootDir = opts.rootDir ?? providerStateRoot();
  const credentialStore =
    opts.credentialStore ??
    createCredentialStore({
      secretsFile: path.join(rootDir, 'secrets.json'),
      // secrets.json 损坏 → 改名隔离留档 + warn + 空结构继续（G-05 / 可靠性报告 R5）
      recoverCorrupted: true,
    });
  return new ProviderStore({
    rootDir,
    credentialStore,
    ...(opts.backupKeep !== undefined ? { backupKeep: opts.backupKeep } : {}),
  });
}
