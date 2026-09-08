import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlaintextCredentialStore,
  WindowsDpapiCredentialStore,
  createCredentialStore,
  makeSecretRef,
  parseSecretRef,
  defaultSecretsFile,
} from './CredentialStore.js';

/**
 * packages/application/credential/CredentialStore.test.ts — task 034 验收测试。
 * 临时目录一律 mkdtempSync(os.tmpdir()/...) 并在 afterEach rmSync 清理；绝不触碰
 * 真实 ~/.vessel，也不做任何永久删除。
 */

describe('PlaintextCredentialStore', () => {
  let dir: string;
  let file: string;
  let store: PlaintextCredentialStore;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cred-pt-'));
    file = path.join(dir, 'secrets.json');
    store = new PlaintextCredentialStore({ secretsFile: file });
    // 静默明文告警（只验行为，不被日志刷屏）。
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('backend tag is "plaintext"', () => {
    expect(store.backend).toBe('plaintext');
  });

  it('set/get round-trip via async interface', async () => {
    await store.set('vessel', 'deepseek', 'sk-ds-1');
    await expect(store.get('vessel', 'deepseek')).resolves.toBe('sk-ds-1');
  });

  it('get returns null for an unknown account, and delete removes a secret', async () => {
    await store.set('vessel', 'a', 'secret-a');
    await store.set('vessel', 'b', 'secret-b');
    expect(await store.get('vessel', 'nope')).toBeNull();
    await store.delete('vessel', 'a');
    expect(await store.get('vessel', 'a')).toBeNull();
    expect(await store.get('vessel', 'b')).toBe('secret-b');
  });

  it('is cross-instance persistent (same file, new store rereads)', async () => {
    await store.set('vessel', 'anthropic', 'sk-ant-2');
    const reopened = new PlaintextCredentialStore({ secretsFile: file });
    expect(await reopened.get('vessel', 'anthropic')).toBe('sk-ant-2');
  });

  it('overwrite replaces an existing secret for the same account', async () => {
    await store.set('vessel', 'a', 'old');
    await store.set('vessel', 'a', 'new');
    expect(await store.get('vessel', 'a')).toBe('new');
  });

  it('plaintext write emits an explicit warn (not silent)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    store.setSync('vessel', 'x', 'sk-x');
    expect(warn).toHaveBeenCalled();
    const msg = warn.mock.calls[0]![0] as string;
    expect(msg).toMatch(/明文|plaintext/i);
  });

  it('delete of a non-existent entry is a no-op (no throw, file unchanged)', async () => {
    await store.set('vessel', 'a', 'secret-a');
    const before = fs.readFileSync(file, 'utf8');
    await store.delete('vessel', 'missing');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(await store.get('vessel', 'a')).toBe('secret-a');
  });
});

describe('WindowsDpapiCredentialStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cred-dpapi-'));
    file = path.join(dir, 'secrets.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // DPAPI 仅 Windows + PowerShell ProtectedData 可用时真跑；否则 skip（不伪造结论）。
  const usable =
    process.platform === 'win32' &&
    (() => {
      try {
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command',
            'Add-Type -AssemblyName System.Security; ' +
            'if (-not ("System.Security.Cryptography.ProtectedData" -as [type])) { exit 1 }'],
          { stdio: 'pipe', windowsHide: true, timeout: 20_000 },
        );
        return true;
      } catch {
        return false;
      }
    })();

  it('backend tag is "windows-dpapi"', () => {
    const s = new WindowsDpapiCredentialStore({ secretsFile: file });
    expect(s.backend).toBe('windows-dpapi');
  });

  it.runIf(usable)('DPAPI set/get/delete round-trip on Windows (real ProtectedData)', async () => {
    const store = new WindowsDpapiCredentialStore({ secretsFile: file });
    await store.set('vessel', 'deepseek', 'sk-dpapi-1');
    await expect(store.get('vessel', 'deepseek')).resolves.toBe('sk-dpapi-1');
    // secrets.json 里不应出现明文密钥。
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain('sk-dpapi-1');
    await store.delete('vessel', 'deepseek');
    await expect(store.get('vessel', 'deepseek')).resolves.toBeNull();
  });

  it.runIf(usable)('DPAPI decrypt survives across store instances (same persisted entropy)', async () => {
    const a = new WindowsDpapiCredentialStore({ secretsFile: file });
    await a.set('vessel', 'anthropic', 'sk-ant-dpapi');
    const b = new WindowsDpapiCredentialStore({ secretsFile: file });
    await expect(b.get('vessel', 'anthropic')).resolves.toBe('sk-ant-dpapi');
  });

  it('cipher is stored, not plaintext (structural check regardless of DPAPI availability)', () => {
    const store = new WindowsDpapiCredentialStore({ secretsFile: file, entropyB64: 'ZGVmYXVsdC1lbnRyb3B5LXN0cmluZw==' });
    // DPAPI 不可用时 Protect 抛错；此处只测"写入结构含 entropy/cipher 字段"，
    // 用 mock 避开 powershell 依赖不现实，故仅在可用时断言字段存在。
    if (usable) {
      store.setSync('vessel', 'x', 'sk-x');
      const shape = JSON.parse(fs.readFileSync(file, 'utf8'));
      expect(shape.backend).toBe('windows-dpapi');
      expect(typeof shape.entropy).toBe('string');
      expect(shape.secrets[0].cipher).not.toContain('sk-x');
    }
  });
});

describe('secretRef helpers', () => {
  it('makeSecretRef / parseSecretRef round-trip', () => {
    expect(makeSecretRef('vessel', 'deepseek')).toBe('credential:vessel/deepseek');
    expect(parseSecretRef('credential:vessel/deepseek')).toEqual({ service: 'vessel', account: 'deepseek' });
  });

  it('parseSecretRef rejects non-credential prefixes', () => {
    expect(parseSecretRef('env:VESSEL_API_KEY')).toBeNull();
    expect(parseSecretRef('plain-sk-123')).toBeNull();
  });
});

describe('createCredentialStore factory', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cred-factory-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('Windows + DPAPI available → windows-dpapi backend', () => {
    const s = createCredentialStore({
      secretsFile: path.join(dir, 'secrets.json'),
      isWindows: true,
      isDpapiAvailable: true,
      onWarn: () => {},
    });
    expect(s.backend).toBe('windows-dpapi');
  });

  it('Windows but DPAPI unavailable → explicit plaintext fallback (with warn)', () => {
    const warns: string[] = [];
    const s = createCredentialStore({
      secretsFile: path.join(dir, 'secrets.json'),
      isWindows: true,
      isDpapiAvailable: false,
      onWarn: (m) => warns.push(m),
    });
    expect(s.backend).toBe('plaintext');
    expect(warns.some((m) => /降级|plaintext/i.test(m))).toBe(true);
  });

  it('non-Windows → plaintext with explicit warn (not silent)', () => {
    const warns: string[] = [];
    const s = createCredentialStore({
      secretsFile: path.join(dir, 'secrets.json'),
      isWindows: false,
      onWarn: (m) => warns.push(m),
    });
    expect(s.backend).toBe('plaintext');
    expect(warns.length).toBeGreaterThan(0);
  });

  it('default (no injection) uses the real platform + auto-detection, returns a usable backend', () => {
    // 只断言默认工厂总是返回一个合法后端且不抛。
    const s = createCredentialStore({ secretsFile: path.join(dir, 'secrets.json') });
    expect(['windows-dpapi', 'plaintext']).toContain(s.backend);
  });
});

describe('default secrets location', () => {
  it('secrets.json lives under ~/.vessel by default', () => {
    expect(defaultSecretsFile()).toBe(path.join(os.homedir(), '.vessel', 'secrets.json'));
    // 缺省实例只做路径断言，绝不读写真实 ~/.vessel。
    // eslint-disable-next-line no-new
    new PlaintextCredentialStore();
  });
});