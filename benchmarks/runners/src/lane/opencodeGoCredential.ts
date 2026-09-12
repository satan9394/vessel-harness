/**
 * task 097 — opencode-go 凭据来源（收敛为两条：环境变量 / 仓库 CredentialStore）。
 *
 * 背景（用户明确纠正）：V1.1-F 曾把「读取**用户本机安装的 CC Switch 应用数据库**」当成凭据
 * 来源（模块 `ccSwitchCredential.ts`，已移除；历史路径见 tasks/V1.1-F-real-model-verify.md）。
 * 学习对象是 cc-switch **开源项目的模块设计**（见 `docs/ideas/CC-SWITCH-MODULE-STUDY.md`），
 * 不是去动用户本机应用数据——task 097 已把该路径整体移除，本模块是 lane 唯一的凭据来源面。
 *
 * 允许的凭据来源（**仅此两条**，均可注入 / 可 mock）：
 *   1) 环境变量 `OPENCODE_API_KEY`（进程环境，不落盘）；
 *   2) 仓库 CredentialStore（034/069：Windows DPAPI 密文 + `secretRef`，用户经
 *      `vessel provider add` / `vessel setup` 向导**主动写入** `~/.vessel/secrets.json`）。
 *
 * 明令禁止（本模块不提供任何入口）：读取用户本机**应用数据**——CC Switch 应用库、
 * 其它 CLI 的配置/密钥文件、浏览器/桌面应用存储等。本模块**不 import `node:fs`**，
 * 不读任何文件；只有注入的 store 实现会碰它自己的密文库（`~/.vessel/secrets.json`）。
 *
 * 密钥安全铁律：明文 key 只在进程内流转（resolver 返回值 / provider 构造参数），
 * 绝不写日志 / 报告 / git。返回的诊断信息只含布尔与来源名。
 */

/** 密钥环境变量约定（唯一事实源；不读写磁盘）。 */
export const OPENCODE_API_KEY_ENV = 'OPENCODE_API_KEY';

/** 凭据 service 名（provider 配置经 secretRef `credential:vessel/<account>` 引用）。 */
export const OPCODE_GO_CRED_SERVICE = 'vessel';
/** 凭据 account 名（本仓库 opencode-go 供应商的统一凭据键）。 */
export const OPCODE_GO_CRED_ACCOUNT = 'opencode-go';

/**
 * 允许的凭据来源清单（诊断/报告用文案；不含密钥）。
 * 顺序即 resolver 的优先级：CredentialStore → env。
 */
export const OPENCODE_GO_CREDENTIAL_SOURCES: readonly string[] = [
  `CredentialStore (034/069 DPAPI, secretRef credential:${OPCODE_GO_CRED_SERVICE}/${OPCODE_GO_CRED_ACCOUNT})`,
  `env ${OPENCODE_API_KEY_ENV}`,
];

/** 密钥读取注入点（默认环境变量；测试注入固定值，不碰真实凭据）。 */
export type OpencodeGoKeyResolver = () => string | undefined;

/**
 * 「有没有 key」的唯一判据：`undefined` / `''` / 纯空白 一律按**没有** key。
 *
 * 为什么：此前 env 分支与 store 分支都用 `length > 0`，于是 `OPENCODE_API_KEY='   '`
 * （shell 里清空变量的常见写法 / CI 里被空白覆盖的 secret）**算有 key** ⇒ lane 拿一个
 * 纯空白的密钥去真连端点（401/挂死），而不是按契约降级 `pending-environment`。
 * 同族口径：状态根用 `envRoot`（空/纯空白 ⇒ 未设置），这里对密钥用同一条判据。
 *
 * **与非空白值的取舍（有意）**：判据只统一「有没有值」，**非空白的 key 逐字返回、不 trim**。
 * 密钥是逐字值（DPAPI 库里存的是什么就发什么），trim 属于「值变换」而非「判据统一」，
 * 会改变已发布行为（负对照口径：「有值时行为逐字不变」）。
 * `envRoot()` 不适用于这里：它读 `process.env[name]`，而本模块必须支持注入的 `env` 对象。
 */
function hasKeyValue(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

/** 默认 keyResolver：只读 env，绝不落盘（空/纯空白 ⇒ 无 key）。 */
export const envOpencodeGoKey: OpencodeGoKeyResolver = () => {
  const v = process.env[OPENCODE_API_KEY_ENV];
  return hasKeyValue(v) ? v : undefined;
};

/**
 * CredentialStore 读取 key：读 `credential:<service>/<account>` 存的那一项（DPAPI 密文，
 * 明文只在进程内）。store 可注入（测试 mock）；读不到 / 后端不可用 → undefined（绝不抛）。
 * 用同步 `getSync` 对齐 `OpencodeGoKeyResolver` 的同步签名（034/069 CredentialBackend
 * 同时提供 sync/async 两套）。**只读**——写入由用户在 `vessel provider add` / setup 向导里
 * 主动完成，本模块不写盘。
 */
export function credentialStoreOpencodeGoKey(
  store: { getSync(service: string, account: string): string | null },
  service = OPCODE_GO_CRED_SERVICE,
  account = OPCODE_GO_CRED_ACCOUNT,
): () => string | undefined {
  return () => {
    try {
      const v = store.getSync(service, account);
      // 空/纯空白 ⇒ 无 key（同一判据 `hasKeyValue`；旧写法 `v.length > 0` 会放空白过去）
      return hasKeyValue(v) ? v : undefined;
    } catch {
      // 后端不可用（如 DPAPI 解密失败 / 密文库损坏）→ 交给下一级来源，不抛。
      return undefined;
    }
  };
}

/**
 * 组合 key resolver：先读 CredentialStore（034/069 DPAPI 加密落库，同步 getSync），
 * 再回退环境变量 `OPENCODE_API_KEY`，最后回退注入的兜底 resolver（正常为 undefined →
 * lane 降级 pending-environment）。测试可注入 store/env/fallback；不注入时由调用方传入
 * `createStore`（如 `createCredentialStore()`），构造期只取一次。
 */
export function credentialAwareOpencodeGoKey(opts: {
  store?: { getSync(service: string, account: string): string | null };
  createStore?: () => { getSync(service: string, account: string): string | null };
  env?: NodeJS.ProcessEnv;
  fallback?: OpencodeGoKeyResolver;
} = {}): OpencodeGoKeyResolver {
  const env = opts.env ?? process.env;
  const fallback = opts.fallback ?? (() => undefined);
  const store = opts.store ?? opts.createStore?.();
  const credResolver = store ? credentialStoreOpencodeGoKey(store) : undefined;
  return () => {
    // 1) CredentialStore（DPAPI 加密落库）优先
    if (credResolver) {
      const fromStore = credResolver();
      if (hasKeyValue(fromStore)) return fromStore;
    }
    // 2) 环境变量回退（空白按「没有」处理，继续落到兜底/降级）
    const fromEnv = env[OPENCODE_API_KEY_ENV];
    if (hasKeyValue(fromEnv)) return fromEnv;
    // 3) 注入兜底（正常为 undefined → lane 降级 pending）
    return fallback();
  };
}
