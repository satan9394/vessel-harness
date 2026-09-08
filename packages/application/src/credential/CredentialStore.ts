import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

/**
 * packages/application/credential/CredentialStore — OS 凭据存储抽象（task 034）。
 *
 * 把 apiKey 这类敏感凭据从 providers.json 明文 JSON 拆到 CredentialStore 抽象，
 * providers.json 只存 secretRef（如 `credential:vessel/<providerId>`）。首期后端：
 *   - WindowsDpapiCredentialStore  — Windows 上用 PowerShell
 *     [System.Security.Cryptography.ProtectedData]::Protect/Unprotect（DPAPI，绑定
 *     当前 Windows 用户），密文 base64 存 `~/.vessel/secrets.json`。
 *   - PlaintextCredentialStore    — secrets.json 明文 + 写入时显式 console.warn。
 *   - createCredentialStore()     — 默认选择：Windows 且 PowerShell/DPAPI 可用 →
 *     DPAPI；否则 plaintext（显式降级，不静默）。
 *
 * 零新 npm 依赖：仅用 node:crypto（熵/编解码）与 node:child_process（调 powershell）。
 *
 * secrets.json 形状（{service,account,cipher}）：
 *   {
 *     "version": 1,
 *     "backend": "windows-dpapi" | "plaintext",
 *     "secrets": [ { "service": "vessel", "account": "deepseek", "cipher": "<b64>" } ]
 *   }
 */

export interface CredentialStore {
  /** 写入/覆盖一项凭据。 */
  set(service: string, account: string, secret: string): Promise<void>;
  /** 读取一项；不存在返回 null。 */
  get(service: string, account: string): Promise<string | null>;
  /** 删除一项（不存在则 no-op）。 */
  delete(service: string, account: string): Promise<void>;
  readonly backend: string;
}

/**
 * 同步后端原语——ProviderStore 的 load()/get()/save() 是同步 API（沿用 014 的
 * 存储封装约定），比 public 异步接口多暴露一层同步读写（setSync/getSync/deleteSync），
 * 供既有同步调用点复用同一套 Secrets 文件；对外消费方用异步的 CredentialStore 即可。
 */
export interface SyncCredentialStore {
  setSync(service: string, account: string, secret: string): void;
  getSync(service: string, account: string): string | null;
  deleteSync(service: string, account: string): void;
  readonly backend: string;
}

/** 同时满足异步（对外）与同步（ProviderStore 内部）两套接口的后端跑批。 */
export type CredentialBackend = CredentialStore &
  SyncCredentialStore &
  Partial<{ probe(): BackendProbe }>;

export function defaultSecretsFile(home = os.homedir()): string {
  return path.join(home, '.vessel', 'secrets.json');
}

export interface CredentialStoreOptions {
  /** 覆盖 secrets.json 路径（测试注入 os.tmpdir() 下临时目录；默认 ~/.vessel/secrets.json）。 */
  secretsFile?: string;
  /** 损坏隔离恢复：存储文件损坏时改名备份（.corrupted-<ts>）并以空结构继续。
   *  false（默认）沿用 034 语义 fail loud。仅对显式开启的调用生效，不静默。 */
  recoverCorrupted?: boolean;
}

interface SecretEntry {
  service: string;
  account: string;
  cipher: string;
}

interface SecretsFileShape {
  version: number;
  backend: string;
  /** DPAPI 用应用熵（base64）；DPAPI 后端首写时派生并持久化，供跨实例解密。 */
  entropy?: string;
  secrets: SecretEntry[];
}

const SECRETS_VERSION = 1;

/** 原子写 secrets.json：<file>.tmp 写完 fsync 后 rename 覆盖（防半写；跨文件改写非删除，安全）。 */
function writeSecretsFile(file: string, data: SecretsFileShape): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (err) {
    throw new CredentialError(
      `write secrets file: cannot create directory for "${file}"`,
      { code: (err as NodeJS.ErrnoException).code, cause: err },
    );
  }
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    throw new CredentialError(
      `write secrets file failed: "${file}"`,
      { code: (err as NodeJS.ErrnoException).code, cause: err },
    );
  }
}

/**
 * 读 secrets.json；不存在 → 空结构。
 *
 * 损坏时有两种边界策略：
 *   - recover=false（默认）→ fail loud，抛 CredentialError（延续 034 语义）。
 *   - recover=true  → 把损坏文件动态改名为 `<file>.corrupted-<epochMs>` 备份（改名留档，
 *     非删除），记录一次 console.warn，再以空结构继续。适用于"凭据可重建、服务不被
 *     单个损坏文件打死"的场景，由创建方按成本/合规取向显式开启。
 */
function readSecretsFile(file: string, opts: { recover?: boolean } = {}): SecretsFileShape {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { version: SECRETS_VERSION, backend: 'plaintext', secrets: [] };
    throw new CredentialError(`read secrets file failed: "${file}"`, {
      code: e.code,
      cause: err,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    if (opts.recover) {
      return quarantineCorrupted(file, `invalid JSON (${(err as Error).message})`);
    }
    throw new CredentialError(`secrets file corrupted (invalid JSON): ${file}`, { cause: err });
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { secrets?: unknown }).secrets)
  ) {
    const msg = 'expected {version,backend,secrets[]}';
    if (opts.recover) return quarantineCorrupted(file, msg);
    throw new CredentialError(`secrets file corrupted (${msg}): ${file}`);
  }
  return raw as SecretsFileShape;
}

/**
 * 把损坏的 secrets 文件改名隔离到 `<file>.corrupted-<epochMs>`（动态重命名留档，
 * 符合回收站纪律——不删除任何内容），返回空结构并 console.warn。
 */
function quarantineCorrupted(file: string, why: string): SecretsFileShape {
  const bak = `${file}.corrupted-${Date.now()}`;
  try {
    fs.renameSync(file, bak);
    // eslint-disable-next-line no-console
    console.warn(
      `[credential] secrets 文件损坏（${why}）已隔离备份到 "${bak}"，凭据被重置为空；请核对后重建。`,
    );
  } catch (err) {
    // 备份失败也不静默：仍以空结构继续，但明确告警。
    // eslint-disable-next-line no-console
    console.warn(
      `[credential] secrets 文件损坏（${why}）且备份失败：${(err as Error).message}；以空结构继续，原文件保留。`,
    );
  }
  return { version: SECRETS_VERSION, backend: 'plaintext', secrets: [] };
}

/** 凭据存储领域错误：携带底层 fs/OS errno（code）供上层分级处理。 */
export class CredentialError extends Error {
  readonly code?: string;
  constructor(message: string, opts: { code?: string; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'CredentialError';
    this.code = opts.code;
  }
}

// ---------------------------------------------------------------------------
// secretRef 约定：`credential:<service>/<account>`（account 可为空，如 instanceof）。
// ---------------------------------------------------------------------------

export const SECRET_REF_PREFIX = 'credential:';

export function makeSecretRef(service: string, account: string): string {
  return `${SECRET_REF_PREFIX}${service}/${account}`;
}

export function parseSecretRef(
  ref: string,
): { service: string; account: string } | null {
  if (!ref.startsWith(SECRET_REF_PREFIX)) return null;
  const body = ref.slice(SECRET_REF_PREFIX.length);
  const slash = body.indexOf('/');
  if (slash === -1) return { service: body, account: '' };
  return { service: body.slice(0, slash), account: body.slice(slash + 1) };
}

// ---------------------------------------------------------------------------
// PlaintextCredentialStore
// ---------------------------------------------------------------------------

/**
 * 明文后端（跨平台降级）：secrets.json 直接存明文。写入时 console.warn 显式提示
 * "明文存储凭据，建议 OS 凭据管理器"。仅作显式降级用，用户可清楚感知。
 */
export class PlaintextCredentialStore implements CredentialBackend {
  readonly backend = 'plaintext';
  private readonly secretsFile: string;
  private readonly recoverCorrupted: boolean;

  constructor(opts: CredentialStoreOptions = {}) {
    this.secretsFile = opts.secretsFile ?? defaultSecretsFile();
    this.recoverCorrupted = opts.recoverCorrupted ?? false;
  }

  get secretsPath(): string {
    return this.secretsFile;
  }

  /** 运行时可用性自检：明文后端总是可用（无外部依赖）。 */
  probe(): BackendProbe {
    return { backend: this.backend, available: true };
  }

  private read(): SecretsFileShape {
    return readSecretsFile(this.secretsFile, { recover: this.recoverCorrupted });
  }

  set(service: string, account: string, secret: string): Promise<void> {
    this.setSync(service, account, secret);
    return Promise.resolve();
  }

  get(service: string, account: string): Promise<string | null> {
    return Promise.resolve(this.getSync(service, account));
  }

  delete(service: string, account: string): Promise<void> {
    this.deleteSync(service, account);
    return Promise.resolve();
  }

  setSync(service: string, account: string, secret: string): void {
    const file = this.read();
    file.backend = this.backend;
    file.version = SECRETS_VERSION;
    const existing = file.secrets.find(
      (s) => s.service === service && s.account === account,
    );
    const entry: SecretEntry = { service, account, cipher: secret };
    if (existing) {
      existing.cipher = secret;
    } else {
      file.secrets.push(entry);
    }
    writeSecretsFile(this.secretsFile, file);
    // 显式降级提示（不静默）——只在真正写明文时告警。
    // eslint-disable-next-line no-console
    console.warn(
      '[credential] 明文存储凭据（plaintext 后端）：secret 未加密落盘 ~/.vessel/secrets.json。建议用 OS 凭据管理器后端。',
    );
  }

  getSync(service: string, account: string): string | null {
    const file = this.read();
    const entry = file.secrets.find((s) => s.service === service && s.account === account);
    return entry ? entry.cipher : null;
  }

  deleteSync(service: string, account: string): void {
    const file = this.read();
    const next = file.secrets.filter((s) => !(s.service === service && s.account === account));
    if (next.length === file.secrets.length) return; // no-op
    file.secrets = next;
    writeSecretsFile(this.secretsFile, file);
  }
}

// ---------------------------------------------------------------------------
// WindowsDpapiCredentialStore
// ---------------------------------------------------------------------------

/** PowerShel script 片段：加载 .NET ProtectedData（DPAPI，CurrentUser 作用域）。 */
function protectedDataReadyCheck(): boolean {
  try {
    const r = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Add-Type -AssemblyName System.Security; ' +
          'if (-not ("System.Security.Cryptography.ProtectedData" -as [type])) { exit 1 }',
      ],
      { stdio: 'pipe', windowsHide: true, timeout: 20_000 },
    );
    return r.length === 0;
  } catch {
    return false;
  }
}

/**
 * DPAPI 后端整段失败（powershell 不可用/EACCES/超时）时抛的领域错误，供上唤醒 fail-over。
 */
export interface DpapiFailureInfo {
  readonly reason: 'not-ready' | 'protect' | 'unprotect';
  readonly code?: string;
}

/** 归一 DPAPI 调用失败为带 reason 的 CredentialError，便于 fail-over/诊断（不吞错）。 */
function dpapiCall(
  reason: DpapiFailureInfo['reason'],
  fn: () => string,
): string {
  try {
    return fn();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const msg =
      reason === 'not-ready'
        ? 'DPAPI backend not ready'
        : reason === 'protect'
          ? 'DPAPI Protect failed'
          : 'DPAPI Unprotect failed';
    throw new CredentialError(`[windows-dpapi] ${msg}`, {
      code: typeof e.code === 'string' ? e.code : 'DPAPI_' + reason,
      cause: err,
    });
  }
}

/** Base64(bytes) → DPAPI Protect(CurrentUser) → Base64 密文。 */
function dpapiProtect(plainB64: string, entropyB64: string): string {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '[Convert]::ToBase64String(' +
    '[System.Security.Cryptography.ProtectedData]::Protect(' +
    `[Convert]::FromBase64String('${plainB64}'), ` +
    `[Convert]::FromBase64String('${entropyB64}'), ` +
    "'CurrentUser'))";
  const r = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    timeout: 30_000,
  });
  return r.trim();
}

/** Base64 密文 → DPAPI Unprotect(CurrentUser) → Base64 明文。 */
function dpapiUnprotect(cipherB64: string, entropyB64: string): string {
  const script =
    'Add-Type -AssemblyName System.Security; ' +
    '[Convert]::ToBase64String(' +
    '[System.Security.Cryptography.ProtectedData]::Unprotect(' +
    `[Convert]::FromBase64String('${cipherB64}'), ` +
    `[Convert]::FromBase64String('${entropyB64}'), ` +
    "'CurrentUser'))";
  const r = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true,
    timeout: 30_000,
  });
  return r.trim();
}

/**
 * Windows DPAPI 后端：PowerShell ProtectedData（CurrentUser）加密，密文 base64 存
 * secrets.json。仅 Windows + DPAPI 可用时用（由工厂探测）；调用前须已确权。
 * 不存在/损坏 → get 返回 null；Protect/Unprotect 调 powershell 出错 → throw
 * （调用方显式降级，不静默吞错）。
 */
export class WindowsDpapiCredentialStore implements CredentialBackend {
  readonly backend = 'windows-dpapi';
  private readonly secretsFile: string;
  private readonly recoverCorrupted: boolean;
  /** 应用层熵（base64）：随文件持久化，Protect/Unprotect 同值才能解（跨实例稳定）。 */
  private entropyB64: string;

  constructor(opts: CredentialStoreOptions & { entropyB64?: string } = {}) {
    this.secretsFile = opts.secretsFile ?? defaultSecretsFile();
    this.recoverCorrupted = opts.recoverCorrupted ?? false;
    // 注入优先（测试）；否则沿用文件里已持久化的熵，没有则派生新的。
    this.entropyB64 = opts.entropyB64 ?? this.readOrCreateEntropy();
  }

  get secretsPath(): string {
    return this.secretsFile;
  }

  /**
   * 运行时可用性自检：用当前熵做一次真实 Protect/Unprotect 往返。powershell
   * 缺失/权限拒绝/DPAPI 失效 → available=false + 原因（不抛，供上层 fail-over）。
   */
  probe(): BackendProbe {
    try {
      const probePlain = 'vessel-probe';
      const cipher = dpapiCall('protect', () =>
        dpapiProtect(Buffer.from(probePlain, 'utf8').toString('base64'), this.entropyB64),
      );
      const plainB64 = dpapiCall('unprotect', () => dpapiUnprotect(cipher, this.entropyB64));
      if (Buffer.from(plainB64, 'base64').toString('utf8') !== probePlain) {
        return { backend: this.backend, available: false, reason: 'DPAPI round-trip mismatch' };
      }
      return { backend: this.backend, available: true };
    } catch (err) {
      const e = err as CredentialError;
      return {
        backend: this.backend,
        available: false,
        reason: e.code === 'EPERM' || e.code === 'EACCES' ? 'permission denied' : e.message,
      };
    }
  }

  private read(): SecretsFileShape {
    return readSecretsFile(this.secretsFile, { recover: this.recoverCorrupted });
  }

  set(service: string, account: string, secret: string): Promise<void> {
    this.setSync(service, account, secret);
    return Promise.resolve();
  }

  get(service: string, account: string): Promise<string | null> {
    return Promise.resolve(this.getSync(service, account));
  }

  delete(service: string, account: string): Promise<void> {
    this.deleteSync(service, account);
    return Promise.resolve();
  }

  /** 沿用文件已持久化的熵；无则派生随机熵并持久化。 */
  private readOrCreateEntropy(): string {
    const existing = readSecretsFile(this.secretsFile);
    if (existing.entropy) return existing.entropy;
    return randomBytes(32).toString('base64');
  }

  setSync(service: string, account: string, secret: string): void {
    const file = this.read();
    file.backend = this.backend;
    file.version = SECRETS_VERSION;
    if (!file.entropy) file.entropy = this.entropyB64;
    else this.entropyB64 = file.entropy;
    const plainB64 = Buffer.from(secret, 'utf8').toString('base64');
    const cipher = dpapiCall('protect', () => dpapiProtect(plainB64, this.entropyB64));
    const existing = file.secrets.find((s) => s.service === service && s.account === account);
    if (existing) {
      existing.cipher = cipher;
    } else {
      file.secrets.push({ service, account, cipher });
    }
    if (!file.entropy) file.entropy = this.entropyB64;
    writeSecretsFile(this.secretsFile, file);
  }

  getSync(service: string, account: string): string | null {
    const file = this.read();
    if (file.backend !== this.backend || !file.entropy) {
      // backend 标签不符 / 无熵 → 视作不可解，返回 null，别错解。
      return null;
    }
    this.entropyB64 = file.entropy;
    const entry = file.secrets.find((s) => s.service === service && s.account === account);
    if (!entry) return null;
    try {
      const plainB64 = dpapiUnprotect(entry.cipher, this.entropyB64);
      return Buffer.from(plainB64, 'base64').toString('utf8');
    } catch {
      return null;
    }
  }

  deleteSync(service: string, account: string): void {
    const file = this.read();
    const next = file.secrets.filter((s) => !(s.service === service && s.account === account));
    if (next.length === file.secrets.length) return;
    file.secrets = next;
    writeSecretsFile(this.secretsFile, file);
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/** 一次后端可用性探测的结果。 */
export interface BackendProbe {
  readonly backend: string;
  /** 是否可用（可被选中）。 */
  readonly available: boolean;
  /** 不可用时的具体原因（平台不符/依赖缺失/权限等），用于 warn 与诊断。 */
  readonly reason?: string;
}

/** 候选 OS 凭据后端（按优先级序）。 069 首期只装 Windows DPAPI；macOS/Linux 为文档化占位。 */
export type CandidateOsBackend = 'windows-dpapi' | 'macos-keychain' | 'linux-libsecret';

export interface ProbeBackendsOptions {
  isWindows?: boolean;
  isDpapiAvailable?: boolean;
  /** 真实探测某项依赖是否就绪（linux/macos 在无 OS 工具链时置 false + reason）。 */
  probeCommand?: (cmd: string) => boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  engine?: typeof process;
}

/**
 * 探测各 OS 凭据后端可用性。注入项优先（测试），否则按当前平台真实探测：
 *   - windows-dpapi：platform==='win32' 且 PowerShell/ProtectedData 就绪
 *   - macos-keychain：platform==='darwin' 且 security 工具可用
 *   - linux-libsecret：platform==='linux' 且 secret-tool 可用
 * 不可测平台/缺依赖 → available=false + 明确 reason（供 fail-over 与文档化降级）。
 */
export function probeBackends(
  opts: ProbeBackendsOptions = {},
): BackendProbe[] {
  const platform = (opts.engine ?? process).platform;
  const probeCommand =
    opts.probeCommand ??
    ((cmd: string): boolean => {
      try {
        execFileSync(cmd, ['--help'], { stdio: 'ignore', windowsHide: true, timeout: 5_000 });
        return true;
      } catch {
        return false;
      }
    });

  const win = opts.isWindows ?? platform === 'win32';
  const winProbe: BackendProbe =
    win === false
      ? { backend: 'windows-dpapi', available: false, reason: 'not Windows platform' }
      : (opts.isDpapiAvailable ?? protectedDataReadyCheck())
        ? { backend: 'windows-dpapi', available: true }
        : {
            backend: 'windows-dpapi',
            available: false,
            reason: 'PowerShell/ProtectedData unavailable',
          };

  const macProbe: BackendProbe =
    platform === 'darwin'
      ? probeCommand('security')
        ? { backend: 'macos-keychain', available: true }
        : { backend: 'macos-keychain', available: false, reason: 'security tool unavailable' }
      : { backend: 'macos-keychain', available: false, reason: `platform is ${platform}` };

  const linuxProbe: BackendProbe =
    platform === 'linux'
      ? probeCommand('secret-tool')
        ? { backend: 'linux-libsecret', available: true }
        : {
            backend: 'linux-libsecret',
            available: false,
            reason: 'secret-tool (libsecret) unavailable',
          }
      : { backend: 'linux-libsecret', available: false, reason: `platform is ${platform}` };

  return [winProbe, macProbe, linuxProbe];
}

/** 后端实例的构造签名——让选择层与实现解耦，便于按 probe 结果实例化。 */
export type BackendCtor = (opts?: CredentialStoreOptions) => CredentialBackend;

const REGISTERED_BACKENDS: Record<CandidateOsBackend, BackendCtor | undefined> = {
  'windows-dpapi': (o) => new WindowsDpapiCredentialStore(o),
  'macos-keychain': undefined,
  'linux-libsecret': undefined,
};

export interface CreateCredentialStoreOptions {
  secretsFile?: string;
  /** 覆盖平台探测（测试注入）；默认 process.platform === 'win32'。 */
  isWindows?: boolean;
  /** 覆盖 PowerShell/DPAPI 可用性探测（测试注入）；默认自动探测。 */
  isDpapiAvailable?: boolean;
  /** 覆盖后端探测集（测试注入）；默认 probeBackends()。 */
  probes?: BackendProbe[];
  /** 降级/选择提示打印器（测试注入静默 spy）；默认 console.warn。 */
  onWarn?: (msg: string) => void;
  /** 损坏隔离恢复：存储文件损坏时改名备份并以空结构继续（默认 false = fail loud）。 */
  recoverCorrupted?: boolean;
}

export interface BackendSelection {
  backend: string;
  /** 选择的这一层。 */
  kind: 'os' | 'plaintext-fallback';
  /** 降级链路：当前未选中但探测到不可用/被跳过的候选及原因（用于清晰 warn）。 */
  skipped: BackendProbe[];
}

/**
 * 选择可用后端（显式 fail-over）：
 *   优先取探测 available 的最高优先级 OS 后端；若无任何 OS 后端可用 → plaintext
 *   降级路径。每层跳过原因都收集进 skipped，供上层打印清晰 warn（不静默）。
 */
export function selectBackend(
  opts: { probes?: BackendProbe[]; isWindows?: boolean } = {},
): BackendSelection {
  const probes = opts.probes ?? probeBackends({ isWindows: opts.isWindows });
  const available = probes.filter((p) => p.available);
  const skipped = probes.filter((p) => !p.available);
  if (available.length > 0) {
    const first = available.reduce((a, b) => (priorityOf(a.backend) < priorityOf(b.backend) ? a : b));
    return { backend: first.backend, kind: 'os', skipped };
  }
  return { backend: 'plaintext', kind: 'plaintext-fallback', skipped };
}

/** OS 后端期望优先级（数字越小越优先）。非 OS 标签永远排最后。 */
function priorityOf(backend: string): number {
  const order: string[] = ['windows-dpapi', 'macos-keychain', 'linux-libsecret', 'plaintext'];
  const i = order.indexOf(backend);
  return i === -1 ? order.length + 1 : i;
}

/**
 * 默认选择逻辑（fail-over，不静默）：
 *   probe 各 OS 后端 → 首个可用者选中；全不可用 → Plaintext 显式降级 + 逐条 warn
 *   已跳过原因。macOS/Linux 有适配层注册但本机无工具链时，会把探测到的 reason
 *   打进降级说明，供用户在文档对照平台启用。
 */
export function createCredentialStore(
  opts: CreateCredentialStoreOptions = {},
): CredentialBackend {
  const warn = opts.onWarn ?? ((m: string) => console.warn(m));
  const platform = process.platform;
  const probes =
    opts.probes ??
    probeBackends({ isWindows: opts.isWindows, isDpapiAvailable: opts.isDpapiAvailable });
  const selection = selectBackend({ probes });
  const storeOptions: CredentialStoreOptions = {
    secretsFile: opts.secretsFile,
    recoverCorrupted: opts.recoverCorrupted,
  };

  if (selection.kind === 'os') {
    const osCtor = REGISTERED_BACKENDS[selection.backend as CandidateOsBackend];
    if (osCtor) return osCtor(storeOptions);
    // 有文档化适配层但本部署未实现（安全失败）：告警后降级 plaintext。
    warn(
      `[credential] 探测到 OS 凭据后端 "${selection.backend}" 可用但本构建未注册实现，` +
        '降级为 plaintext 明文后端。',
    );
  } else {
    const reasons = selection.skipped.map((p) => `${p.backend}(${p.reason ?? 'reason unknown'})`);
    warn(
      `[credential] 当前平台（${platform}）无可用 OS 凭据后端[${reasons.join('; ')}]，` +
        '降级为 plaintext 明文后端，secret 未加密落盘 secrets.json，建议启用 OS 凭据管理器。',
    );
  }
  return new PlaintextCredentialStore(storeOptions);
}