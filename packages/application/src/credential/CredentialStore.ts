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
export type CredentialBackend = CredentialStore & SyncCredentialStore;

export function defaultSecretsFile(home = os.homedir()): string {
  return path.join(home, '.vessel', 'secrets.json');
}

export interface CredentialStoreOptions {
  /** 覆盖 secrets.json 路径（测试注入 os.tmpdir() 下临时目录；默认 ~/.vessel/secrets.json）。 */
  secretsFile?: string;
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

/** 读 secrets.json；不存在 → 空结构；损坏 → fail loud。 */
function readSecretsFile(file: string): SecretsFileShape {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return { version: SECRETS_VERSION, backend: 'plaintext', secrets: [] };
    throw err;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`secrets file corrupted (invalid JSON): ${file}`, { cause: err });
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    !Array.isArray((raw as { secrets?: unknown }).secrets)
  ) {
    throw new Error(`secrets file corrupted (expected {version,backend,secrets[]}): ${file}`);
  }
  return raw as SecretsFileShape;
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

  constructor(opts: CredentialStoreOptions = {}) {
    this.secretsFile = opts.secretsFile ?? defaultSecretsFile();
  }

  get secretsPath(): string {
    return this.secretsFile;
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
    const file = readSecretsFile(this.secretsFile);
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
    const file = readSecretsFile(this.secretsFile);
    const entry = file.secrets.find((s) => s.service === service && s.account === account);
    return entry ? entry.cipher : null;
  }

  deleteSync(service: string, account: string): void {
    const file = readSecretsFile(this.secretsFile);
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
  /** 应用层熵（base64）：随文件持久化，Protect/Unprotect 同值才能解（跨实例稳定）。 */
  private entropyB64: string;

  constructor(opts: CredentialStoreOptions & { entropyB64?: string } = {}) {
    this.secretsFile = opts.secretsFile ?? defaultSecretsFile();
    // 注入优先（测试）；否则沿用文件里已持久化的熵，没有则派生新的。
    this.entropyB64 = opts.entropyB64 ?? this.readOrCreateEntropy();
  }

  get secretsPath(): string {
    return this.secretsFile;
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
    const file = readSecretsFile(this.secretsFile);
    file.backend = this.backend;
    file.version = SECRETS_VERSION;
    if (!file.entropy) file.entropy = this.entropyB64;
    else this.entropyB64 = file.entropy;
    const plainB64 = Buffer.from(secret, 'utf8').toString('base64');
    const cipher = dpapiProtect(plainB64, this.entropyB64);
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
    const file = readSecretsFile(this.secretsFile);
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
    const file = readSecretsFile(this.secretsFile);
    const next = file.secrets.filter((s) => !(s.service === service && s.account === account));
    if (next.length === file.secrets.length) return;
    file.secrets = next;
    writeSecretsFile(this.secretsFile, file);
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

export interface CreateCredentialStoreOptions {
  secretsFile?: string;
  /** 覆盖平台探测（测试注入）；默认 process.platform === 'win32'。 */
  isWindows?: boolean;
  /** 覆盖 PowerShell/DPAPI 可用性探测（测试注入）；默认自动探测。 */
  isDpapiAvailable?: boolean;
  /** 降级/选择提示打印器（测试注入静默 spy）；默认 console.warn。 */
  onWarn?: (msg: string) => void;
}

/**
 * 默认选择逻辑：
 *   Windows + DPAPI 可用 → WindowsDpapiCredentialStore（secrets 加密）；
 *   否则 → PlaintextCredentialStore（显式 console.warn，不静默）。
 */
export function createCredentialStore(
  opts: CreateCredentialStoreOptions = {},
): CredentialBackend {
  const isWindows = opts.isWindows ?? process.platform === 'win32';
  const warn = opts.onWarn ?? ((m: string) => console.warn(m));
  const platform = process.platform;

  if (isWindows) {
    const dpapiOk = opts.isDpapiAvailable ?? protectedDataReadyCheck();
    if (dpapiOk) {
      return new WindowsDpapiCredentialStore({ secretsFile: opts.secretsFile });
    }
    warn(
      `[credential] Windows 平台但 PowerShell/DPAPI 不可用（platform=${platform}），` +
        '降级为 plaintext 明文后端，secret 未加密落盘 secrets.json。',
    );
  } else {
    warn(
      `[credential] 当前非 Windows 平台（platform=${platform}），无 DPAPI —— ` +
        '使用 plaintext 明文后端，secret 未加密落盘 secrets.json，建议 OS 凭据管理器。',
    );
  }
  return new PlaintextCredentialStore({ secretsFile: opts.secretsFile });
}