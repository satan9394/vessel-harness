import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WindowsDpapiCredentialStore } from './CredentialStore.js';

/**
 * packages/application/credential/dpapiArgv.test.ts — 锁死 G-05 修复。
 *
 * 不变量：DPAPI 的密钥/熵材料**只能走 stdin**（execFileSync 的 options.input），
 * **绝不能**出现在 powershell.exe 的 argv（命令行）里——命令行对同机其它进程可见。
 *
 * 纪律（照抄 CredentialStore.test.ts）：
 *   - 临时目录一律 mkdtempSync(path.join(os.tmpdir(), 'vessel-dpapi-'))，afterEach 清理；
 *   - secretsFile 一律指向临时目录，绝不读写真实 ~/.vessel；
 *   - 只用假 key（sk-test-not-a-real-key-123），绝不使用任何真实 API key；
 *   - 前三条用例用 vi.mock('node:child_process') 拦截 execFileSync，不真的起 powershell；
 *     最后一条（真实往返）必须放在文件最后，用 vi.doUnmock + resetModules 拿真实实现，仅 Windows 跑。
 */

// 假材料（全部是本地造出来的，不对应任何真实凭据）。
const FAKE_KEY = 'sk-test-not-a-real-key-123';
const FAKE_KEY_B64 = Buffer.from(FAKE_KEY, 'utf8').toString('base64');
const ENTROPY_B64 = Buffer.from('vessel-dpapi-test-entropy-32bytes', 'utf8').toString('base64');
const FAKE_CIPHER_B64 = Buffer.from('fake-dpapi-cipher-blob', 'utf8').toString('base64');
const PROBE_B64 = Buffer.from('vessel-probe', 'utf8').toString('base64');

// 拦截 node:child_process 的 execFileSync（vi.hoisted 保证 execMock 在 vi.mock 工厂执行前
// 已就绪）；其余导出原样委托真实实现，沿用本仓 113/114 的 node 内建模块 mock 写法
// （vi.spyOn 对 ESM 命名空间导出会报 "Cannot redefine property"）。
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return { ...actual, execFileSync: execMock };
});

type ExecCall = [string, string[], Record<string, unknown>];

/** 只取真正的 DPAPI 调用（powershell.exe ... -Command <script>），忽略其它偶发子进程。 */
function dpapiCalls(): ExecCall[] {
  return (execMock.mock.calls as unknown as ExecCall[]).filter(
    (c) => c[0] === 'powershell.exe' && Array.isArray(c[1]) && c[1].includes('-Command'),
  );
}

/** 命令行全文：命令 + 所有参数直接拼接（无分隔符）——最严格地检查材料是否落在 argv 里。 */
function argvText(call: ExecCall): string {
  return call[0] + call[1].join('');
}

/**
 * 核心断言：`forbidden` 里的任何材料都不得出现在 argv；`required` 里的材料必须全部
 * 出现在 options.input（stdin）里。
 */
function expectMaterialsOnlyOnStdin(
  call: ExecCall,
  forbidden: readonly string[],
  required: readonly string[],
): void {
  const argv = argvText(call);
  for (const material of forbidden) {
    expect(argv).not.toContain(material);
  }
  const opts = call[2];
  expect(Object.prototype.hasOwnProperty.call(opts, 'input')).toBe(true);
  expect(typeof opts.input).toBe('string');
  const stdin = String(opts.input);
  for (const material of required) {
    expect(stdin).toContain(material);
  }
}

describe('WindowsDpapiCredentialStore — DPAPI 材料只走 stdin（G-05）', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-dpapi-'));
    file = path.join(dir, 'secrets.json');
    execMock.mockReset();
    execMock.mockReturnValue(FAKE_CIPHER_B64);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('set() 写路径：argv 不含密钥明文/其 base64/熵 base64，材料只出现在 options.input', async () => {
    const store = new WindowsDpapiCredentialStore({ secretsFile: file, entropyB64: ENTROPY_B64 });
    expect(store.secretsPath).toBe(file); // 绝不碰真实 ~/.vessel

    await store.set('vessel', 'test-account', FAKE_KEY);

    const calls = dpapiCalls();
    expect(calls).toHaveLength(1); // 一次写入 = 一次 Protect，无多余子进程调用
    const call = calls[0]!;

    // 先确认确实走的是 Protect 路径（否则下面的 argv 断言没有意义）。
    expect(call[1].join(' ')).toContain('ProtectedData');
    expect(call[1].join(' ')).not.toContain('Unprotect');

    // 核心：命令行里没有任何材料。
    expectMaterialsOnlyOnStdin(
      call,
      [FAKE_KEY, FAKE_KEY_B64, ENTROPY_B64],
      [FAKE_KEY_B64, ENTROPY_B64],
    );
    expect(JSON.parse(String(call[2]!.input))).toEqual({
      payload: FAKE_KEY_B64,
      entropy: ENTROPY_B64,
    });
    // stdin 里放的是 base64，明文本身连 stdin 都不出现。
    expect(String(call[2]!.input)).not.toContain(FAKE_KEY);
  });

  it('get() 读路径：argv 不含密文/熵材料，二者只出现在 options.input', async () => {
    const store = new WindowsDpapiCredentialStore({ secretsFile: file, entropyB64: ENTROPY_B64 });
    await store.set('vessel', 'test-account', FAKE_KEY);

    // 读路径单独计量：让 mock 的 Unprotect 返回明文 base64，便于断言往返可用。
    execMock.mockReset();
    execMock.mockReturnValue(FAKE_KEY_B64);
    await expect(store.get('vessel', 'test-account')).resolves.toBe(FAKE_KEY);

    const calls = dpapiCalls();
    expect(calls).toHaveLength(1); // 一次读取 = 一次 Unprotect
    const call = calls[0]!;
    expect(call[1].join(' ')).toContain('Unprotect');

    // 核心：密文（上一步 Protect 的产物）与熵都不得进 argv。
    expectMaterialsOnlyOnStdin(
      call,
      [FAKE_KEY, FAKE_KEY_B64, ENTROPY_B64, FAKE_CIPHER_B64],
      [FAKE_CIPHER_B64, ENTROPY_B64],
    );
    expect(JSON.parse(String(call[2]!.input))).toEqual({
      payload: FAKE_CIPHER_B64,
      entropy: ENTROPY_B64,
    });
  });

  it('probe() 自检：两条 DPAPI 调用（Protect + Unprotect）同样 argv 无材料', () => {
    execMock.mockReset();
    execMock.mockReturnValueOnce(FAKE_CIPHER_B64).mockReturnValueOnce(PROBE_B64);
    const store = new WindowsDpapiCredentialStore({ secretsFile: file, entropyB64: ENTROPY_B64 });

    expect(store.probe()).toEqual({ backend: 'windows-dpapi', available: true });

    const calls = dpapiCalls();
    expect(calls).toHaveLength(2);
    expect(calls[0]![1].join(' ')).toContain('ProtectedData');
    expect(calls[1]![1].join(' ')).toContain('Unprotect');
    expectMaterialsOnlyOnStdin(
      calls[0]!,
      [PROBE_B64, ENTROPY_B64],
      [PROBE_B64, ENTROPY_B64],
    );
    expectMaterialsOnlyOnStdin(
      calls[1]!,
      [FAKE_CIPHER_B64, ENTROPY_B64],
      [FAKE_CIPHER_B64, ENTROPY_B64],
    );
  });
});

describe('WindowsDpapiCredentialStore — 真实 DPAPI 往返（不 mock node:child_process）', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-dpapi-'));
    file = path.join(dir, 'secrets.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // 本用例必须放在文件最后：vi.doUnmock 会解除本文件的文件级 mock。
  // 非 Windows（process.platform !== 'win32'）→ it.skipIf 直接跳过：DPAPI 只存在于 Windows。
  it.skipIf(process.platform !== 'win32')(
    '真实 ProtectedData 往返：假 key 写入临时 store 后读回一致（非 Windows 跳过）',
    async () => {
      vi.doUnmock('node:child_process');
      vi.resetModules();
      const { WindowsDpapiCredentialStore: RealStore } = await import('./CredentialStore.js');
      const { execFileSync: realExecFileSync } = await import('node:child_process');

      // Windows 上无 PowerShell / 无 ProtectedData：不作伪结论，直接返回（等同跳过）。
      try {
        realExecFileSync(
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
      } catch {
        return;
      }

      const store = new RealStore({ secretsFile: file });
      await store.set('vessel', 'test-account', FAKE_KEY);
      await expect(store.get('vessel', 'test-account')).resolves.toBe(FAKE_KEY);

      // 落盘的是密文：明文与明文 base64 都不得出现在 secrets.json 里。
      const raw = fs.readFileSync(file, 'utf8');
      expect(raw).not.toContain(FAKE_KEY);
      expect(raw).not.toContain(FAKE_KEY_B64);
    },
  );
});
