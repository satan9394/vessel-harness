/**
 * task 097 — opencode-go 凭据来源测试（两条来源：env / CredentialStore）。
 *
 * 取代 V1.1-F 的 `ccSwitchCredential.test.ts`（该套 16 例围绕「读取用户本机 CC Switch
 * 应用数据库」构建，已随模块移除；见 tasks/097-credential-source-fix.md）。
 *
 * Covers（全部 mock/注入，杜绝真实密钥 / 真实 DPAPI / 真实网络）:
 *   1. 来源收敛：只暴露两条来源常量 + service/account 约定（`credential:vessel/opencode-go`）。
 *   2. env 来源：`OPENCODE_API_KEY` 命中 / 空值 → undefined（lane pending）。
 *   3. CredentialStore 来源：读得到 → 优先于 env；读不到 → env 回退；均空 → 注入兜底。
 *   4. 健壮性：store 后端抛错（DPAPI 不可用）→ 不抛，落到下一级来源。
 *   5. 注入面：store / createStore / env / fallback 全可注入（单测不碰真实凭据）。
 *   6. **不读用户本机应用数据**：临时目录自建 `.cc-switch` fixture（非真实 db）不被读取；
 *      且仓库源码树守卫——无 `.cc-switch` / `cc-switch.db` / `node:sqlite` 运行时引用。
 *   7. 与 082 lane 集成：无 key → pending-environment/degraded；注入 mock provider → passed。
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatProvider } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import {
  OPENCODE_API_KEY_ENV,
  OPCODE_GO_CRED_SERVICE,
  OPCODE_GO_CRED_ACCOUNT,
  OPENCODE_GO_CREDENTIAL_SOURCES,
  envOpencodeGoKey,
  credentialStoreOpencodeGoKey,
  credentialAwareOpencodeGoKey,
} from './opencodeGoCredential.js';
import {
  resolveOpencodeGoProvider,
  opencodeGoProviderResolver,
} from './opencodeGoProvider.js';
import { runRealModelLane, type LaneModel } from './real-model-lane.js';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

function laneModel(id: string, tier: 'pro' | 'flash'): LaneModel {
  return { id, displayName: `X ${id}`, tier, defaultModel: id };
}

/** 记录 getSync 实参的假 store（绝不落盘）。 */
function spyStore(value: string | null) {
  const getSync = vi.fn((_service: string, _account: string) => value);
  return { store: { getSync }, getSync };
}

describe('097 — 凭据来源收敛（仅 env / CredentialStore 两条）', () => {
  it('来源常量恰两条，且 secretRef 约定为 credential:vessel/opencode-go', () => {
    expect(OPENCODE_GO_CREDENTIAL_SOURCES).toHaveLength(2);
    expect(OPENCODE_GO_CREDENTIAL_SOURCES[0]).toContain('CredentialStore');
    expect(OPENCODE_GO_CREDENTIAL_SOURCES[0]).toContain(`credential:${OPCODE_GO_CRED_SERVICE}/${OPCODE_GO_CRED_ACCOUNT}`);
    expect(OPENCODE_GO_CREDENTIAL_SOURCES[1]).toContain(OPENCODE_API_KEY_ENV);
    expect(OPENCODE_API_KEY_ENV).toBe('OPENCODE_API_KEY');
    expect(OPCODE_GO_CRED_SERVICE).toBe('vessel');
    expect(OPCODE_GO_CRED_ACCOUNT).toBe('opencode-go');
  });

  it('env 来源：OPENCODE_API_KEY 命中；空字符串 → undefined（lane 降级 pending）', () => {
    const hit = credentialAwareOpencodeGoKey({ env: { [OPENCODE_API_KEY_ENV]: 'sk-env' } });
    expect(hit()).toBe('sk-env');
    const blank = credentialAwareOpencodeGoKey({ env: { [OPENCODE_API_KEY_ENV]: '' } });
    expect(blank()).toBeUndefined();
    const missing = credentialAwareOpencodeGoKey({ env: {} });
    expect(missing()).toBeUndefined();
  });

  it('CredentialStore 来源：读得到优先于 env；读不到 → env 回退；均空 → fallback', () => {
    const both = credentialAwareOpencodeGoKey({
      store: { getSync: () => 'sk-store' },
      env: { [OPENCODE_API_KEY_ENV]: 'sk-env' },
    });
    expect(both()).toBe('sk-store');

    const envOnly = credentialAwareOpencodeGoKey({
      store: { getSync: () => null },
      env: { [OPENCODE_API_KEY_ENV]: 'sk-env' },
    });
    expect(envOnly()).toBe('sk-env');

    const fallback = credentialAwareOpencodeGoKey({
      store: { getSync: () => null },
      env: {},
      fallback: () => 'sk-fallback',
    });
    expect(fallback()).toBe('sk-fallback');
  });

  it('credentialStoreOpencodeGoKey 读 vessel/opencode-go（实参断言）', () => {
    const { store, getSync } = spyStore('sk-from-store');
    const r = credentialStoreOpencodeGoKey(store);
    expect(r()).toBe('sk-from-store');
    expect(getSync).toHaveBeenCalledWith(OPCODE_GO_CRED_SERVICE, OPCODE_GO_CRED_ACCOUNT);
  });

  it('store 后端抛错（DPAPI 不可用）→ 不抛，落到 env / undefined', () => {
    const throwing = { getSync: () => { throw new Error('DPAPI backend unavailable'); } };
    const r = credentialStoreOpencodeGoKey(throwing);
    expect(r()).toBeUndefined();
    const aware = credentialAwareOpencodeGoKey({ store: throwing, env: { [OPENCODE_API_KEY_ENV]: 'sk-env' } });
    expect(aware()).toBe('sk-env');
  });

  it('createStore 注入：构造期取一次 store（不注入即不读任何东西）', () => {
    const createStore = vi.fn(() => ({ getSync: () => 'sk-lazy' }));
    const r = credentialAwareOpencodeGoKey({ createStore, env: {} });
    expect(createStore).toHaveBeenCalledTimes(1);
    expect(r()).toBe('sk-lazy');
    expect(createStore).toHaveBeenCalledTimes(1);
  });

  it('envOpencodeGoKey 是函数且只读 env（不写盘）', () => {
    expect(envOpencodeGoKey).toBeTypeOf('function');
    expect(OPENCODE_GO_CREDENTIAL_SOURCES.join(' ')).not.toMatch(/cc-switch|sqlite/i);
  });
});

describe('097 — 不读取任何用户本机应用数据', () => {
  it('临时目录自建 .cc-switch fixture（非真实 db）不被读取：无 env/store → undefined', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cred-home-'));
    const fakeAppDir = path.join(home, '.cc-switch');
    fs.mkdirSync(fakeAppDir, { recursive: true });
    const fakeDb = path.join(fakeAppDir, 'cc-switch.db');
    fs.writeFileSync(fakeDb, 'not-a-real-database', 'utf8');

    const r = credentialAwareOpencodeGoKey({
      env: { HOME: home, USERPROFILE: home, [OPENCODE_API_KEY_ENV]: '' },
    });
    expect(r()).toBeUndefined();
    // fixture 原样保留（本模块只读它自己的来源，从不触碰用户应用数据）
    expect(fs.readFileSync(fakeDb, 'utf8')).toBe('not-a-real-database');
    fs.rmSync(home, { recursive: true, force: true });
  });

  it('仓库源码树守卫：无 .cc-switch / cc-switch.db / node:sqlite / DatabaseSync 引用', () => {
    const roots = [
      path.join(REPO_ROOT, 'apps', 'cli', 'src'),
      path.join(REPO_ROOT, 'apps', 'local-server', 'src'),
      path.join(REPO_ROOT, 'apps', 'web', 'src'),
      path.join(REPO_ROOT, 'packages'),
      path.join(REPO_ROOT, 'benchmarks', 'runners', 'src'),
    ];
    // 本测试文件自身包含这些字面量（作为检测 needle），故排除全部 *.test.ts。
    const needles = ['.cc-switch', 'cc-switch.db', 'node:sqlite', 'DatabaseSync'];
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
        } else if (/\.(ts|tsx|mts|cts|js|mjs|cjs)$/.test(e.name) && !/\.test\.[cm]?tsx?$/.test(e.name)) {
          const text = fs.readFileSync(p, 'utf8');
          for (const n of needles) {
            if (text.includes(n)) offenders.push(`${path.relative(REPO_ROOT, p)} :: ${n}`);
          }
        }
      }
    };
    for (const r of roots) walk(r);
    expect(offenders).toEqual([]);
  });
});

describe('097 — 凭据来源 ↔ 082 lane 集成（有 key 实跑 / 无 key 降级 pending）', () => {
  it('无 key（env/store 皆空）→ lane pending-environment、degraded', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cred-lane-'));
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

  it('有 CredentialStore key → provider 可构造（baseUrl=opencode-go preset）', () => {
    const p = resolveOpencodeGoProvider(laneModel('mimo-v2.5', 'flash'), {
      keyResolver: credentialAwareOpencodeGoKey({ store: { getSync: () => 'sk-t' }, env: {} }),
    });
    expect(p).not.toBeNull();
    expect(p!.id).toBe('openai-compatible');
  });

  it('注入 mock provider → lane 可跑并采集 §15 L3（passed）', async () => {
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-cred-lane-'));
    const mockProvider: ChatProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: '097-CRED-LANE' } }],
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
