/**
 * task V1.1-F — CC Switch 凭据转接 + CredentialStore 集成测试。
 *
 * Covers（≥6 组，全部 mock/注入，杜绝真实 DB / 真实密钥 / 真实 DPAPI）:
 *   1. CC Switch 库探查（注入 fake reader）：定位 opencode-go 条目 → baseURL + {file} 引用。
 *   2. `{file:...}` 引用解析 → 进程内读 key 文件（注入 mock fileReader）；`~/` 展开。
 *   3. 内联明文 / `{env:NAME}` / 空字段 → 正确解析或 null。
 *   4. 凭据转接 migrate：经注入 CredentialStore.set 加密落库（断言只传 service/account/secret，
 *      返回对象不含 key，reason 不含 key）。
 *   5. resolver 集成：credentialStoreOpencodeGoKey / credentialAwareOpencodeGoKey 从 store 读 key、
 *      env 回退、均空 → undefined（lane 降级 pending）。
 *   6. 与 084/lane 集成：credential-aware resolver 有 key → lane 可跑采集；无 key → pending-environment。
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatProvider } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import type {
  CcSwitchProviderRow,
  CcSwitchReader,
} from './ccSwitchCredential.js';
import {
  OPCODE_GO_CRED_SERVICE,
  OPCODE_GO_CRED_ACCOUNT,
  OPENCODE_GO_BASE_URL,
  defaultCcSwitchDbPath,
  probeCcSwitchOpencode,
  toCcSwitchOpencodeRef,
  pickOpencodeRow,
  resolveApiKeyField,
  migrateOpencodeGoCredential,
} from './ccSwitchCredential.js';
import {
  credentialStoreOpencodeGoKey,
  credentialAwareOpencodeGoKey,
  resolveOpencodeGoProvider,
  opencodeGoProviderResolver,
} from './opencodeGoProvider.js';
import { runRealModelLane, type LaneModel } from './real-model-lane.js';

function row(id: string, cfg: unknown, isCurrent = 0): CcSwitchProviderRow {
  return {
    id,
    app_type: 'opencode',
    name: 'OpenCode Go',
    settings_config: JSON.stringify(cfg),
    is_current: isCurrent === 1,
  };
}

function opencodeCfg(over: { baseURL?: string; apiKey?: string } = {}): object {
  return {
    npm: '@ai-sdk/openai-compatible',
    name: 'OpenCode Go',
    options: { baseURL: OPENCODE_GO_BASE_URL, apiKey: '{file:~/.config/opencode/secrets/hs-api-key}', ...over },
    models: { 'mimo-v2.5': {}, 'mimo-v2.5-pro': {} },
  };
}

function fakeReader(rows: CcSwitchProviderRow[]): CcSwitchReader {
  return { readOpencodeRows: () => rows };
}

/** 记录所有 set() 调用的假 CredentialStore（绝不落盘，只做实参捕获）。 */
function recordStore() {
  const sets: Array<{ service: string; account: string; secret: string }> = [];
  const store = {
    set: vi.fn(async (service: string, account: string, secret: string) => {
      sets.push({ service, account, secret });
    }),
    get: vi.fn(async () => null),
    _sets: sets,
  };
  return store;
}

function laneModel(id: string, tier: 'pro' | 'flash'): LaneModel {
  return { id, displayName: `X ${id}`, tier, defaultModel: id };
}

describe('V1.1-F — CC Switch 库探查（注入 fake reader）', () => {
  it('定位 opencode-go 条目 → baseURL + {file} key 引用（is_current 优先）', async () => {
    const rows = [
      row('sid-old', opencodeCfg({ apiKey: '{file:~/.config/opencode/secrets/old' }), 0),
      row('sid-current', opencodeCfg(), 1),
    ];
    const ref = await probeCcSwitchOpencode({ reader: fakeReader(rows) });
    expect(ref).not.toBeNull();
    expect(ref!.rowId).toBe('sid-current');
    expect(ref!.baseUrl).toBe(OPENCODE_GO_BASE_URL);
    expect(ref!.apiKeyField).toBe('{file:~/.config/opencode/secrets/hs-api-key}');
  });

  it('无条目 → null（不抛）', async () => {
    expect(await probeCcSwitchOpencode({ reader: fakeReader([]) })).toBeNull();
    expect(toCcSwitchOpencodeRef(undefined)).toBeNull();
  });

  it('pickOpencodeRow：无 current 时取第一条', () => {
    const rows = [row('a', opencodeCfg()), row('b', opencodeCfg())];
    expect(pickOpencodeRow(rows)!.id).toBe('a');
  });

  it('默认 db 路径在 ~/.cc-switch/cc-switch.db（与实测一致）', () => {
    expect(defaultCcSwitchDbPath('C:\\Users\\t')).toBe('C:\\Users\\t\\.cc-switch\\cc-switch.db');
  });
});

describe('V1.1-F — {file}/{env}/明文 apiKey 字段解析（进程内，绝不含 key 落盘）', () => {
  it('{file:...} 引用按注入 fileReader 读取明文（进程内）', () => {
    const key = resolveApiKeyField('{file:~/.config/opencode/secrets/hs-api-key}', {
      fileReader: (p) => (p.endsWith('hs-api-key') ? 'sk-file-key-trimmed  \n' : null),
      home: 'C:\\Users\\t',
    });
    expect(key).toBe('sk-file-key-trimmed');
  });

  it('{file:~/...} 的 ~ 展开到 homedir', () => {
    let seenPath = '';
    resolveApiKeyField('{file:~/secrets/k}', {
      fileReader: (p) => {
        seenPath = p;
        return 'k';
      },
      home: 'C:\\Users\\t',
    });
    expect(seenPath).toBe('C:\\Users\\t\\secrets\\k');
  });

  it('{env:NAME} 读环境变量', () => {
    const env = { OPENCODE_API_KEY: 'sk-env' };
    expect(resolveApiKeyField('{env:OPENCODE_API_KEY}', { env })).toBe('sk-env');
  });

  it('内联明文 sk-... 直接用；空/未知大括号 → null', () => {
    expect(resolveApiKeyField('sk-inline-direct')).toBe('sk-inline-direct');
    expect(resolveApiKeyField('  ')).toBeNull();
    expect(resolveApiKeyField('{unk:whatever}')).toBeNull();
    expect(resolveApiKeyField(undefined)).toBeNull();
  });
});

describe('V1.1-F — 凭据转接 migrate → CredentialStore 加密落库（无明文泄漏）', () => {
  it('成功：写入 service/account/secret，返回不含 key', async () => {
    const store = recordStore();
    const res = await migrateOpencodeGoCredential({
      store,
      reader: fakeReader([row('m1', opencodeCfg())]),
      keyFileReader: () => 'sk-real-secret',
    });
    expect(res.synced).toBe(true);
    expect(res.baseUrl).toBe(OPENCODE_GO_BASE_URL);
    expect(res.rowId).toBe('m1');
    expect(JSON.stringify(res)).not.toContain('sk-'); // 返回值绝不含 key
    expect(store._sets).toHaveLength(1);
    expect(store._sets[0]!.service).toBe(OPCODE_GO_CRED_SERVICE);
    expect(store._sets[0]!.account).toBe(OPCODE_GO_CRED_ACCOUNT);
    expect(store._sets[0]!.secret).toBe('sk-real-secret'); // 仅进 store，不落盘明文
  });

  it('库无条目 → synced=false + reason（不抛、不写 store）', async () => {
    const store = recordStore();
    const res = await migrateOpencodeGoCredential({ store, reader: fakeReader([]) });
    expect(res.synced).toBe(false);
    expect(res.reason).toContain('无 opencode-go 条目');
    expect(store._sets).toHaveLength(0);
  });

  it('key 文件不可读（{file} 缺失）→ synced=false + reason，原因不含 key', async () => {
    const store = recordStore();
    const res = await migrateOpencodeGoCredential({
      store,
      reader: fakeReader([row('m2', opencodeCfg())]),
      keyFileReader: () => null,
    });
    expect(res.synced).toBe(false);
    expect(res.reason).toContain('无法解析');
    expect(store._sets).toHaveLength(0);
  });
});

describe('V1.1-F — CredentialStore / credentialAware resolver 集成（env 回退 + 可注入）', () => {
  it('credentialStoreOpencodeGoKey 从 mock store 读 vessel/opencode-go', () => {
    const store = { getSync: vi.fn(() => 'sk-from-store') as () => string | null };
    const r = credentialStoreOpencodeGoKey(store);
    expect(r()).toBe('sk-from-store');
  });

  it('credentialAwareOpencodeGoKey：store 有值优先；无则 env 回退；均空 → undefined', () => {
    const store = { getSync: () => null };
    const noStoreKey = credentialAwareOpencodeGoKey({ store, env: { OPENCODE_API_KEY: 'sk-env' } });
    // store.getSync 返回 null → env 命中
    expect(noStoreKey()).toBe('sk-env');
    const storeKey = credentialAwareOpencodeGoKey({ store: { getSync: () => 'sk-store' }, env: { OPENCODE_API_KEY: 'sk-env' } });
    expect(storeKey()).toBe('sk-store');
    const emptyBoth = credentialAwareOpencodeGoKey({ store: { getSync: () => null }, env: {} });
    expect(emptyBoth()).toBeUndefined();
  });

  it('有 store key → resolveOpencodeGoProvider 构造真实 provider（baseUrl=opencode-go）', () => {
    const p = resolveOpencodeGoProvider(laneModel('mimo-v2.5', 'flash'), {
      keyResolver: credentialAwareOpencodeGoKey({ store: { getSync: () => 'sk-t' } }),
    });
    expect(p).not.toBeNull();
    expect(p!.id).toBe('openai-compatible');
  });
});

describe('V1.1-F — 凭据转接 ↔ 082 lane 集成（有 key 实跑 / 无 key 降级 pending）', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

  it('credentialAware resolver 无 key → lane pending-environment、degraded', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-ccswitch-lane-'));
    const report = await runRealModelLane({
      models: [laneModel('mimo-v2.5', 'flash')],
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: opencodeGoProviderResolver({
        keyResolver: credentialAwareOpencodeGoKey({ store: { getSync: () => null }, env: {} }),
      }),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.degraded).toBe(true);
    expect(report.rows[0]!.status).toBe('pending-environment');
  });

  it('credentialAware resolver 有 store key → lane 可跑并采集 §15 L3（passed）', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-ccswitch-lane-'));
    const mockProvider: ChatProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'V1.1-F-LANE' } }],
      { model: 'mimo-v2.5' },
    );
    const report = await runRealModelLane({
      models: [laneModel('mimo-v2.5', 'flash')],
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: async () => mockProvider,
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.degraded).toBe(false);
    expect(report.rows[0]!.status).toBe('passed');
    expect(report.modelSummaries[0]!.passed).toBe(1);
  });
});