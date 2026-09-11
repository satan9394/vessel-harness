import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CredentialError,
  PlaintextCredentialStore,
  createCredentialStore,
  makeSecretRef,
} from '@vessel/application';
import { createDefaultProviderStore, providerStateRoot } from './defaultStore.js';
import type { ProviderStore } from './ProviderStore.js';

/**
 * defaultStore.recovery.test.ts — 锁死 G-05 第二项修复（BRIEF-06 §2 / RELIABILITY R5）。
 *
 * 契约：**默认路径**（`createDefaultProviderStore()`，即 CLI `vessel run` 与 TUI `runChat()` 共用的
 * 唯一构造路径）下，`secrets.json` 损坏 → **可恢复**：改名隔离留档 `<file>.corrupted-<epochMs>`
 * （原字节保留，绝不删除）+ 一句含路径的 `console.warn` + 以空结构继续（不抛）；
 * 而**显式** `recoverCorrupted: false` 仍是 fail-loud（抛 `CredentialError`），语义不变。
 * 另加 ENOENT（首次运行/空 root）不误伤：不抛、不产生隔离文件、无「损坏」类告警。
 *
 * 隔离纪律（照抄 UsageStore.recovery.test.ts / chat.test.ts 既有写法）：
 *   - 全部落在 `mkdtempSync(os.tmpdir(), 'vessel-provider-recover-')`，并把 `VESSEL_PROVIDER_ROOT`
 *     指到该临时 root —— 默认 store 的 `providers.json` / `secrets.json` 同根，**绝不读写真实 `~/.vessel`**；
 *   - `beforeEach` 快照 `VESSEL_PROVIDER_ROOT`，`afterEach` 还原并清掉临时目录；
 *   - 断言一律「只读目录列举」，不用 unlink/rm 做「检查删除」；
 *   - 本文件不需要任何真实密钥（用例 ② 只用 `sk-fake-not-a-real-key-123` 这类假 key）。
 *
 * 平台说明（重要，勿删）：`createDefaultProviderStore()` 的凭据后端由 `createCredentialStore()` 的
 * **真实探测**决定——Windows 且 PowerShell/DPAPI 可用时选 `WindowsDpapiCredentialStore`，其余退化为
 * `PlaintextCredentialStore`。两条路径的「首次读」时机不同：
 *   - plaintext：构造不读文件（惰性），第一次 `getSync/setSync` 才读 → 由本文件的 ① / ② 触发隔离；
 *   - DPAPI：**构造函数**就经 `readOrCreateEntropy()`（CredentialStore.ts:397、448-452）读一次
 *     `secrets.json` 取应用熵 → 损坏文件在**构造期**就会被读到。
 * 后者目前**没有**把 `recoverCorrupted` 传下去（`readSecretsFile(this.secretsFile)`，无 `{ recover }`），
 * 因此 Windows+DPAPI 机器上用例 ①/② 会 RED —— 这正是 R5 记录的「损坏文件连构造都过不去」在 DPAPI
 * 路径上的残留：G-05 的 `recoverCorrupted: true` 只覆盖了 plaintext 与惰性读。修法是一行：
 * `readOrCreateEntropy()` 内改为 `readSecretsFile(this.secretsFile, { recover: this.recoverCorrupted })`
 * （`CredentialStore.ts:449`）；`readSecretsFile` / `quarantineCorrupted` 本身已备好。
 */

const SECRETS = 'secrets.json';
/** 损坏内容：非 JSON（`readSecretsFile` 的 `invalid JSON` 分支）。 */
const BROKEN = '{oops';
/** 假 key（本用例集不需要、也不使用任何真实密钥）。 */
const FAKE_KEY = 'sk-fake-not-a-real-key-123';

/** 隔离文件列举：`secrets.json.corrupted-<epochMs>`（`quarantineCorrupted` 的命名形态）。 */
function listQuarantined(root: string): string[] {
  return fs.readdirSync(root).filter((n) => n.includes('.corrupted-'));
}

/**
 * 参考配置：providers.json 里**只留 secretRef**——这样默认 store 的 `load()` 才会真的走到
 * 凭据层（`resolveSecrets` → `credentialStore.getSync`），从而触发 `secrets.json` 的读取。
 */
const SECRET_REF_CONFIG = {
  id: 'ds',
  name: 'DeepSeek',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  secretRef: makeSecretRef('vessel', 'ds'),
};

describe('默认 ProviderStore 的 secrets.json 损坏恢复（G-05 / BRIEF-06 §2）', () => {
  let dir: string;
  let savedRoot: string | undefined;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vessel-provider-recover-'));
    savedRoot = process.env.VESSEL_PROVIDER_ROOT;
    process.env.VESSEL_PROVIDER_ROOT = dir; // 临时 root：默认 store 整体隔离，不碰真实 ~/.vessel
  });

  afterEach(() => {
    if (savedRoot === undefined) delete process.env.VESSEL_PROVIDER_ROOT;
    else process.env.VESSEL_PROVIDER_ROOT = savedRoot;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** 铺一个损坏的 `secrets.json` + 一个只用 secretRef 的 `providers.json`（触发默认路径的凭据读）。 */
  const seedBroken = (): void => {
    fs.writeFileSync(path.join(dir, SECRETS), BROKEN, 'utf8');
    fs.writeFileSync(
      path.join(dir, 'providers.json'),
      JSON.stringify([SECRET_REF_CONFIG], null, 2),
      'utf8',
    );
  };

  it('① 默认路径可恢复：不抛 + 改名隔离留档（原字节）+ 原文件让位 + warn 含 secrets.json', () => {
    seedBroken();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let store: ProviderStore | undefined;
    expect(() => {
      store = createDefaultProviderStore();
    }).not.toThrow();
    if (!store) return; // 构造即抛：见文件头「平台说明」（DPAPI 的 readOrCreateEntropy 未传 recover）
    const s: ProviderStore = store;

    expect(providerStateRoot()).toBe(dir); // 隔离前提：默认根 = 临时 root
    expect(s.rootDir).toBe(dir);

    // 经默认路径读凭据（providers.json 的 secretRef → CredentialStore.getSync）——不得抛错
    expect(() => s.load()).not.toThrow();
    const list = s.load();
    expect(list).toHaveLength(1);
    expect(list[0]!.secretRef).toBe(SECRET_REF_CONFIG.secretRef);
    expect(list[0]!.apiKey).toBeUndefined(); // 「空结构继续」：解析不出 key，而不是抛错
    expect(listQuarantined(dir)).toHaveLength(1); // 重复读不再产生第二份隔离文件

    const quarantined = listQuarantined(dir);
    expect(quarantined[0]!.startsWith(`${SECRETS}.corrupted-`)).toBe(true);
    // 留档 = 损坏内容原字节原样（隔离改名而非删除）
    expect(fs.readFileSync(path.join(dir, quarantined[0]!), 'utf8')).toBe(BROKEN);
    // 原文件已改名让位（后续写盘不会用空结构覆盖唯一数据源）
    expect(fs.existsSync(path.join(dir, SECRETS))).toBe(false);

    const warns = warn.mock.calls.flat().join(' | ');
    expect(warn).toHaveBeenCalled();
    expect(warns).toContain(SECRETS);
    expect(warns).toContain('.corrupted-'); // 确系「隔离」告警，而不是别的 warn 蒙混过关
  });

  it('② 恢复后仍可用：经默认路径重录 key 能读回；隔离文件仍在（留档，不删）', () => {
    seedBroken();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = createDefaultProviderStore();

      // 用户重录 key：经默认路径写入（save → stripSecretForPersist → CredentialStore.setSync）
      // 注意：seedBroken() 已在 providers.json 里占了 id 'ds'（SECRET_REF_CONFIG），这里必须换成未占用 id，
      // 否则 ProviderStore.add 会以 duplicate provider id 拒绝（本用例要验的是「重录可读回」，不是重复 id 校验）。
      store.add({
        id: 'ds2',
        name: 'DeepSeek',
        protocol: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
        apiKey: FAKE_KEY,
      });
      expect(store.get('ds2')?.apiKey).toBe(FAKE_KEY); // 恢复后功能完好，不是「只不崩」

      // 损坏文件仍在隔离位置、内容未变（删除铁律：只改名留档）
      const quarantined = listQuarantined(dir);
      expect(quarantined).toHaveLength(1);
      expect(fs.readFileSync(path.join(dir, quarantined[0]!), 'utf8')).toBe(BROKEN);
      // 新的 secrets.json 已重建（不再是损坏内容）
      expect(fs.existsSync(path.join(dir, SECRETS))).toBe(true);
      expect(fs.readFileSync(path.join(dir, SECRETS), 'utf8')).not.toContain(BROKEN);
    } finally {
      warn.mockRestore();
    }
  });

  it('③ 显式 recoverCorrupted:false 仍 fail-loud：throw CredentialError，且不隔离、不静默', () => {
    const secretsFile = path.join(dir, SECRETS);
    fs.writeFileSync(secretsFile, BROKEN, 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // (a) 直接构造：plaintext 后端惰性读 → 构造不抛，**读取**即抛（fail-loud 的触发点）
      const direct = new PlaintextCredentialStore({ secretsFile, recoverCorrupted: false });
      expect(() => direct.getSync('vessel', 'ds')).toThrow(CredentialError);
      expect(() => direct.getSync('vessel', 'ds')).toThrow(/corrupted/i);
      expect(() => direct.getSync('vessel', 'ds')).toThrow(secretsFile);

      // (b) 工厂路径：显式 false + 强制 plaintext（注入探测 → 跨平台确定），选项原样透传
      const viaFactory = createCredentialStore({
        secretsFile,
        isWindows: true,
        isDpapiAvailable: false,
        recoverCorrupted: false,
        onWarn: () => {},
      });
      expect(viaFactory.backend).toBe('plaintext');
      expect(() => viaFactory.getSync('vessel', 'ds')).toThrow(CredentialError);

      // 不静默恢复：损坏文件原样保留，没有任何隔离文件，也没有任何 warn
      expect(listQuarantined(dir)).toEqual([]);
      expect(fs.readFileSync(secretsFile, 'utf8')).toBe(BROKEN);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('④ ENOENT（空 root / 无 secrets.json）不误伤：不抛、无隔离文件、无「损坏」告警', () => {
    // 只有 providers.json（secretRef）→ 默认路径读到的是「凭据文件不存在」
    fs.writeFileSync(
      path.join(dir, 'providers.json'),
      JSON.stringify([SECRET_REF_CONFIG], null, 2),
      'utf8',
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let store: ProviderStore | undefined;
    expect(() => {
      store = createDefaultProviderStore();
    }).not.toThrow();
    if (!store) return;
    const s: ProviderStore = store;

    const list = s.load();
    expect(list).toHaveLength(1);
    expect(list[0]!.apiKey).toBeUndefined(); // 无凭据文件 = 空结果，不是错误
    expect(listQuarantined(dir)).toEqual([]); // 不该凭空产生隔离文件
    expect(fs.existsSync(path.join(dir, SECRETS))).toBe(false); // 只读不写：不凭空造文件

    // 平台差异：无 OS 凭据后端时工厂会打一句 plaintext 降级告警（含 secrets.json 字样，但与损坏无关）。
    // 这里断言的是**没有**任何「损坏 / 隔离」类告警；Windows+DPAPI 下 warn 一次都不会被调用。
    expect(warn.mock.calls.flat().join(' | ')).not.toMatch(/corrupted|损坏|隔离/);
  });
});
