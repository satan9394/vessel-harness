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
  opencodeGoEndpoint,
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

  /**
   * 第 2 条：`OPENCODE_API_KEY='   '`（纯空白）此前被当密钥用。
   *
   * 生产调用点：
   *   - `opencodeGoProvider.ts:107` `opencodeGoEndpoint(keyResolver = envOpencodeGoKey)` 与
   *     `:160` `opencodeGoProviderResolver`（缺省 resolver = `envOpencodeGoKey`）→
   *     `hasKey = apiKey.length > 0` ⇒ `'   '` 算有 key ⇒ 构造真实 provider 去真连端点；
   *   - `run-release-gates.ts:1838/1848/1851`、`run-opencode-lane.ts:94/106/109` 也各自读
   *     `envOpencodeGoKey()` / store key 后比 `length > 0`；
   *   - `run-v11f-verify.ts:43` 同型。
   * 旧实现四处都用 `length > 0` 判「有没有 key」（env 分支裸读、store 分支、aware 组合的两行）
   * 都把纯空白放过去；把 `hasKeyValue(...)` 换回 `length > 0`（或把 `envOpencodeGoKey` 还原成
   * 裸读 `process.env[...]`）⇒ ①②③ 立即红。
   */
  it('#2 空/纯空白 key ⇒ 与「无 key」同解（降级 pending），非空白 key 逐字不变', () => {
    // ① 判别性：空白 env / 空白 store 值都不算 key
    expect(credentialAwareOpencodeGoKey({ env: { [OPENCODE_API_KEY_ENV]: '   ' } })()).toBeUndefined();
    expect(credentialAwareOpencodeGoKey({ store: { getSync: () => '   ' }, env: {} })()).toBeUndefined();
    expect(credentialStoreOpencodeGoKey({ getSync: () => '\t \n' })()).toBeUndefined();
    expect(credentialStoreOpencodeGoKey({ getSync: () => '' })()).toBeUndefined();

    // ①-b 空白来源按「没有」处理 ⇒ 继续落下一级（而不是「有 key 但内容是空白」）
    expect(
      credentialAwareOpencodeGoKey({ store: { getSync: () => '   ' }, env: { [OPENCODE_API_KEY_ENV]: 'sk-env' } })(),
    ).toBe('sk-env');
    expect(
      credentialAwareOpencodeGoKey({ env: { [OPENCODE_API_KEY_ENV]: '  ' }, fallback: () => 'sk-fallback' })(),
    ).toBe('sk-fallback');

    // ③ 端到端（lane 面）：空白 key ⇒ hasKey=false ⇒ provider 不构造 ⇒ pending-environment，
    //    绝不拿纯空白去真连端点。
    const blankResolver = credentialAwareOpencodeGoKey({ env: { [OPENCODE_API_KEY_ENV]: '   ' } });
    expect(opencodeGoEndpoint(blankResolver).hasKey).toBe(false);
    expect(resolveOpencodeGoProvider(laneModel('mimo-v2.5', 'flash'), { keyResolver: blankResolver })).toBeNull();

    // ② 负对照：非空白 key 逐字不变（判据只统一「有没有值」，不改写密钥本身）
    expect(credentialAwareOpencodeGoKey({ env: { [OPENCODE_API_KEY_ENV]: ' sk-env ' } })()).toBe(' sk-env ');
    expect(credentialStoreOpencodeGoKey({ getSync: () => ' sk-store ' })()).toBe(' sk-store ');
  });

  it('#2 默认 envOpencodeGoKey（真实 process.env 路径）：空/纯空白 ⇒ undefined，非空逐字', () => {
    const saved = process.env[OPENCODE_API_KEY_ENV];
    try {
      process.env[OPENCODE_API_KEY_ENV] = '   ';
      expect(envOpencodeGoKey()).toBeUndefined(); // 旧实现返回 '   ' ⇒ 直接去真连
      process.env[OPENCODE_API_KEY_ENV] = '';
      expect(envOpencodeGoKey()).toBeUndefined();
      delete process.env[OPENCODE_API_KEY_ENV];
      expect(envOpencodeGoKey()).toBeUndefined();
      process.env[OPENCODE_API_KEY_ENV] = '  sk-raw  '; // 负对照：非空白逐字（不 trim）
      expect(envOpencodeGoKey()).toBe('  sk-raw  ');
    } finally {
      if (saved === undefined) delete process.env[OPENCODE_API_KEY_ENV];
      else process.env[OPENCODE_API_KEY_ENV] = saved;
    }
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
    // task 102：Go 端点线协议客户端（可注入 x-opencode-session / 具名 UA）
    expect(p!.id).toBe('opencode-go');
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
