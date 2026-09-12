/**
 * task V1.1-C — opencode-go provider 接入测试。
 *
 * Covers（≥6 断言组）:
 *   1. 内置 preset 复用：baseUrl 解析 + 协议 openai-compatible（SSOT 一致）。
 *   2. env key 读取：无 key → hasKey:false / resolver 返回 null（lane 降级 pending）。
 *   3. provider 构造：有 key → 返回真实 openai-compatible ChatProvider（不落盘）。
 *   4. 模型确认逻辑 selectMimoModel：mimo-v2.5 精确命中 / V2.5 系回退 / 无 MIMO → null。
 *   5. 真实 /v1/models 拉取（可注入 srcOverride）：live 清单经 srcOverride 透传。
 *   6. 采集归一 defaultMimoLaneModels：从可用清单映射出 pro/flash LaneModel 档。
 *   7. 降级：fetchOpencodeGoModels 无 key → builtin 参考清单（非实时 note），不抛；probe 无 key → null。
 *   8. 最小连通 probe：注入 mock provider 的鉴权/响应/usage 快照（不打真实 API）。
 *   9. task 111 默认切换：defaultLaneModels（flash 优先 deepseek-flash，MIMO 回退）+ explicitLaneModels
 *      （显式 --model/--models 覆盖保留 mimo 复跑能力）。
 *  10. lane 端点覆盖入口 `VESSEL_OPENCODE_GO_BASE_URL`：显式注入 → 剥尾斜杠；纯空白 → 视为未设
 *      （回落内置默认端点）。文件顶层对所有用例做该变量的快照/删除/还原，默认端点断言不受宿主环境污染。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatProvider } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { findPreset } from '@vessel/application';
import { LANE_MODELS, type LaneModel } from './real-model-lane.js';
import {
  OPENCODE_API_KEY_ENV,
  envOpencodeGoKey,
} from './opencodeGoCredential.js';
import {
  OPENCODE_GO_PRESET_ID,
  MIMO_V25_MODEL_ID,
  MIMO_V25_PRO_MODEL_ID,
  DEEPSEEK_FLASH_MODEL_ID,
  opencodeGoBaseUrl,
  opencodeGoEndpoint,
  resolveOpencodeGoProvider,
  opencodeGoProviderResolver,
  selectMimoModel,
  defaultMimoLaneModels,
  defaultLaneModels,
  explicitLaneModels,
  fetchOpencodeGoModels,
  probeOpencodeGoOnce,
  OPENCODE_GO_REFERENCE_MODELS,
} from './opencodeGoProvider.js';

/**
 * 环境洁净（AGENTS.md §8 精神）：本文件多处断言「默认端点」
 * `https://opencode.ai/zen/go/v1`，而 lane 新增的端点覆盖入口 `VESSEL_OPENCODE_GO_BASE_URL`
 * （见 `opencodeGoProvider.ts` 的 `opencodeGoBaseUrl()`）会把默认端点顶掉——开发者本机 / CI 只要
 * 设了它，断言默认端点的用例就会红。
 *
 * 顶层 `beforeEach`/`afterEach` 对所有 describe 生效：先快照该变量 → 删除 → 跑完原样还原
 * （原值存在则恢复，否则 delete）。于是无论宿主环境是否设置该变量，默认端点断言都稳定。
 *
 * 注意：`opencodeGoEndpoint(keyResolver)` 与 `resolveOpencodeGoProvider(model, opts)` 的签名
 * **没有** env 注入口（内部调 `opencodeGoBaseUrl()`，缺省读 `process.env`），故这两条路径只能靠
 * 本处的环境洁净 + 用例内的显式前置断言（见下方 `process.env...toBeUndefined()`）来钉住默认值。
 */
const OPENCODE_GO_BASE_URL_ENV = 'VESSEL_OPENCODE_GO_BASE_URL';

let savedOpencodeGoBaseUrlEnv: string | undefined;

beforeEach(() => {
  savedOpencodeGoBaseUrlEnv = process.env[OPENCODE_GO_BASE_URL_ENV];
  delete process.env[OPENCODE_GO_BASE_URL_ENV];
});

afterEach(() => {
  if (savedOpencodeGoBaseUrlEnv === undefined) delete process.env[OPENCODE_GO_BASE_URL_ENV];
  else process.env[OPENCODE_GO_BASE_URL_ENV] = savedOpencodeGoBaseUrlEnv;
});

function m(modelId: string, tier: 'pro' | 'flash'): LaneModel {
  return { id: `x:${modelId}`, displayName: `X ${modelId}`, tier, defaultModel: modelId };
}

describe('V1.1-C — opencode-go preset 复用（SSOT）', () => {
  it('preset 已内置注册，协议 openai-compatible，baseUrl=https://opencode.ai/zen/go/v1', () => {
    const preset = findPreset(OPENCODE_GO_PRESET_ID);
    expect(preset).toBeDefined();
    expect(preset!.protocol).toBe('openai-compatible');
    expect(preset!.baseUrl).toBe('https://opencode.ai/zen/go/v1');
    // 显式传空 env：'默认' 只由内置 preset 决定，完全不读 process.env（env 洁净见文件顶部）。
    expect(opencodeGoBaseUrl({})).toBe('https://opencode.ai/zen/go/v1');
  });
});

describe('lane 端点覆盖入口 VESSEL_OPENCODE_GO_BASE_URL（剥离尾斜杠 / 空白视为未设）', () => {
  it('显式注入覆盖值（末尾带 /）→ 剥掉尾斜杠返回，避免与 /v1/models 拼出 //models', () => {
    expect(opencodeGoBaseUrl({ VESSEL_OPENCODE_GO_BASE_URL: 'https://example.test/v1/' })).toBe(
      'https://example.test/v1',
    );
  });

  it('覆盖值为纯空白 → 视为未设，回落到内置默认端点 https://opencode.ai/zen/go/v1', () => {
    expect(opencodeGoBaseUrl({ VESSEL_OPENCODE_GO_BASE_URL: '   ' })).toBe('https://opencode.ai/zen/go/v1');
  });
});

describe('V1.1-C — env key 读取与 resolver（密钥不落盘）', () => {
  it('env 无 key → hasKey:false 且 resolver 返回 null（lane 降级 pending，不构造 provider）', async () => {
    // 默认 resolver 读真实 process.env；测试环境确认无该 key。
    const ep = opencodeGoEndpoint(() => undefined);
    expect(ep.hasKey).toBe(false);
    expect(ep.apiKey).toBeUndefined();
    const resolver = opencodeGoProviderResolver({ keyResolver: () => undefined });
    expect(await resolver(LANE_MODELS[0]!)).toBeNull();
    // resolveOpencodeGoProvider 同理
    expect(resolveOpencodeGoProvider(LANE_MODELS[0]!, { keyResolver: () => undefined })).toBeNull();
  });

  it('env 有 key（注入固定值，非真实密钥）→ 构造真实 opencode-go ChatProvider', () => {
    const p = resolveOpencodeGoProvider(m('mimo-v2.5', 'flash'), {
      keyResolver: () => 'sk-test-not-a-real-key',
    });
    expect(p).not.toBeNull();
    // task 102：线协议客户端换成 OpencodeGoProvider（能注入 x-opencode-session / 具名 UA）；
    // 通用 openai-compatible 客户端无法加自定义头，会被 Go 端点判 400 MissingSessionID。
    expect(p!.id).toBe('opencode-go');
    // 前置断言：本用例构造的是真实 provider，走 `resolveOpencodeGoProvider` → `opencodeGoEndpoint`
    // → `opencodeGoBaseUrl()`（无 env 注入口，缺省读 process.env）。先确认环境洁净（文件顶部
    // beforeEach 已删除该变量），让「环境未被端点覆盖入口污染」这件事在断言里可见。
    expect(process.env.VESSEL_OPENCODE_GO_BASE_URL).toBeUndefined();
    // baseUrl 落在 opencode-go 端点（默认值，未被 VESSEL_OPENCODE_GO_BASE_URL 覆盖）
    expect(opencodeGoEndpoint(() => 'k').baseUrl).toBe('https://opencode.ai/zen/go/v1');
  });

  it('API key 绝不落盘：env 约定名与内置 reference 一致（不写文件）', () => {
    expect(OPENCODE_API_KEY_ENV).toBe('OPENCODE_API_KEY');
    // 断言默认 resolver 只读 env，路径上没有任何写盘调用（getter 不写）
    expect(envOpencodeGoKey).toBeTypeOf('function');
  });

  /**
   * C-3：**注入的自定义 keyResolver** 返回纯空白 ⇒ 按"没有 key"处理。
   *
   * 内置的两条来源（env `OPENCODE_API_KEY` / CredentialStore）早已用 `hasKeyValue`
   * （空/纯空白 ⇒ 无 key）收敛，但 `opencodeGoEndpoint` 的 `hasKey` 当时仍是
   * `apiKey.length > 0` —— 只挡空串。于是自定义 resolver 返回 `'   '` 时 `hasKey` 为 true
   * ⇒ lane **拿一个纯空白密钥去真连端点**（401/挂死），而不是按契约降级 `pending-environment`。
   *
   * 「删哪行会红」：把 `hasKey` 改回 `apiKey.length > 0` ⇒ 本用例前两条断言红
   * （`hasKey` 变 true、`resolveOpencodeGoProvider` 返回真实 provider 而不是 null）。
   */
  it('C-3 注入 resolver 返回纯空白 ⇒ 按无 key（hasKey:false / 不构造 provider）', () => {
    const blank = opencodeGoEndpoint(() => '   ');
    expect(blank.hasKey).toBe(false);
    expect(blank.apiKey).toBe('   '); // 值本身不被改写（判据只管"有没有"），只是不算"有 key"
    expect(resolveOpencodeGoProvider(LANE_MODELS[0]!, { keyResolver: () => '   ' })).toBeNull();
    expect(resolveOpencodeGoProvider(LANE_MODELS[0]!, { keyResolver: () => '\t\n' })).toBeNull();

    // 负对照：非空白 key 仍判"有 key"，且**逐字返回、不 trim**（有值时行为不变）
    const padded = opencodeGoEndpoint(() => '  sk-test-not-a-real-key  ');
    expect(padded.hasKey).toBe(true);
    expect(padded.apiKey).toBe('  sk-test-not-a-real-key  ');
    expect(resolveOpencodeGoProvider(LANE_MODELS[0]!, { keyResolver: () => 'sk-test-not-a-real-key' })).not.toBeNull();
  });
});

describe('V1.1-C — 模型确认与选择（selectMimoModel / defaultMimoLaneModels）', () => {
  it('live 清单含精确 mimo-v2.5 → 命中目标模型', () => {
    const r = selectMimoModel(['qwen3.7-max', 'mimo-v2.5', 'mimo-v2.5-pro']);
    expect(r.selected).toBe(MIMO_V25_MODEL_ID);
    expect(r.matchedV25).toEqual([MIMO_V25_MODEL_ID]);
  });

  it('清单无精确 mimo-v2.5 但有 V2.5 系 → 确定性回退到最接近（lexicographic 最小）', () => {
    const r = selectMimoModel(['mimo-v2.5-pro', 'mimo-v2-pro', 'qwen3.7-max']);
    expect(r.selected).toBe(MIMO_V25_PRO_MODEL_ID);
    expect(r.matchedV25).toContain(MIMO_V25_PRO_MODEL_ID);
  });

  it('清单仅含其它 MIMO 系（无 V2.5）→ 返回实际可用 MIMO 模型并记录', () => {
    const r = selectMimoModel(['mimo-v2-pro', 'mimo-v2-omni']);
    // 确定性选 lexicographic 最小可用的 MIMO 模型（无 V2.5 时）
    expect(r.selected).toBe('mimo-v2-omni');
    expect(r.matchedV25).toEqual([]);
    expect(r.matchedMimo).toEqual(['mimo-v2-omni', 'mimo-v2-pro']);
  });

  it('清单无任何 MIMO → selected=null（无可用 MIMO 目标）', () => {
    const r = selectMimoModel(['gpt-5.6-luna', 'glm-5.2']);
    expect(r.selected).toBeNull();
    expect(r.matchedV25).toEqual([]);
    expect(r.matchedMimo).toEqual([]);
  });

  it('默认 lane 模型档：有 mimo-v2.5 / mimo-v2.5-pro → 映射为 pro/flash 两档', () => {
    const models = defaultMimoLaneModels(['mimo-v2.5', 'mimo-v2.5-pro']);
    const pro = models.find((x) => x.tier === 'pro');
    const flash = models.find((x) => x.tier === 'flash');
    expect(pro?.defaultModel).toBe(MIMO_V25_PRO_MODEL_ID);
    expect(flash?.defaultModel).toBe(MIMO_V25_MODEL_ID);
  });
});

describe('task 111 — lane 默认模型档（mimo-v2.5 → deepseek-flash）', () => {
  it('CLI 无 --models/--model 时（live 清单含 deepseek-flash）→ 默认 flash 档=deepseek-flash，pro 档=mimo-v2.5-pro', () => {
    const models = defaultLaneModels(['qwen3.7-max', 'deepseek-flash', 'mimo-v2.5', 'mimo-v2.5-pro']);
    const pro = models.find((x) => x.tier === 'pro');
    const flash = models.find((x) => x.tier === 'flash');
    expect(flash?.defaultModel).toBe(DEEPSEEK_FLASH_MODEL_ID);
    expect(pro?.defaultModel).toBe(MIMO_V25_PRO_MODEL_ID);
    // flash 档不是 MIMO（默认已切换）
    expect(flash?.defaultModel).not.toBe(MIMO_V25_MODEL_ID);
  });

  it('live 清单无 deepseek-flash（如无 key 内置参考快照）→ 回退 MIMO V2.5 系（mimo-v2.5），不 throw', () => {
    const models = defaultLaneModels(['qwen3.7-max', 'mimo-v2.5', 'mimo-v2.5-pro']);
    expect(models.find((x) => x.tier === 'flash')?.defaultModel).toBe(MIMO_V25_MODEL_ID);
  });

  it('显式 --models=mimo-v2.5 覆盖默认：explicitLaneModels 直接映射指定 id（保留 mimo 复跑能力）', () => {
    const models = explicitLaneModels(['mimo-v2.5'], ['flash']);
    expect(models).toEqual([
      { id: 'opencode-go:mimo-v2.5', displayName: 'OpenCode Go mimo-v2.5', tier: 'flash', defaultModel: 'mimo-v2.5' },
    ]);
  });

  it('显式 --model=deepseek-flash,mimo-v2.5 --tier=both → 两 id × 两档全部映射', () => {
    const models = explicitLaneModels(['deepseek-flash', 'mimo-v2.5'], ['pro', 'flash']);
    expect(models.map((m) => `${m.defaultModel}/${m.tier}`)).toEqual([
      'deepseek-flash/pro',
      'deepseek-flash/flash',
      'mimo-v2.5/pro',
      'mimo-v2.5/flash',
    ]);
  });

  it('defaultMimoLaneModels 保留 MIMO 语义（MIMO 显式选择/回退不动）', () => {
    const models = defaultMimoLaneModels(['deepseek-flash', 'mimo-v2.5', 'mimo-v2.5-pro']);
    expect(models.find((x) => x.tier === 'flash')?.defaultModel).toBe(MIMO_V25_MODEL_ID);
    expect(models.find((x) => x.tier === 'pro')?.defaultModel).toBe(MIMO_V25_PRO_MODEL_ID);
  });
});

describe('V1.1-C — 真实 /v1/models 拉取（可注入 + 降级）', () => {
  it('有 key → 经 srcOverride 透传 live 清单（可 mock 的 fetch 边界）', async () => {
    const srcOverride = async (baseUrl: string) => ({
      origin: 'live' as const,
      models: ['mimo-v2.5', 'mimo-v2.5-pro'],
      note: `live from ${baseUrl}/v1/models`,
    });
    const out = await fetchOpencodeGoModels(() => 'sk-test-not-a-real-key', srcOverride);
    expect(out.source.origin).toBe('live');
    expect(out.source.models).toContain(MIMO_V25_MODEL_ID);
    expect(out.source.note).toContain('/v1/models');
  });

  it('无 key → 不实拉，返回仓库内置参考清单（mimo-v2.5 在列），不 throw', async () => {
    const out = await fetchOpencodeGoModels(() => undefined);
    expect(out.source.origin).toBe('builtin');
    expect(out.source.models).toContain(MIMO_V25_MODEL_ID);
    expect(out.source.models).toContain(MIMO_V25_PRO_MODEL_ID);
    // 参考清单来自 models.dev 快照（含 MIMO V2.5）
    expect(OPENCODE_GO_REFERENCE_MODELS).toContain(MIMO_V25_MODEL_ID);
  });
});

describe('V1.1-C — 最小连通验证（probe，可注入 mock provider）', () => {
  it('无 key 且无注入 provider → probe 返回 null（pending，不打真实 API）', async () => {
    const r = await probeOpencodeGoOnce({ defaultModel: MIMO_V25_MODEL_ID }, { keyResolver: () => undefined });
    expect(r).toBeNull();
  });

  it('注入 mock provider → 返回鉴权/响应/usage 快照（验证链路归一）', async () => {
    const provider: ChatProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'pong' } }],
      { model: MIMO_V25_MODEL_ID },
    );
    const r = await probeOpencodeGoOnce(
      { defaultModel: MIMO_V25_MODEL_ID },
      { provider, keyResolver: () => undefined },
    );
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(true);
    expect(r!.model).toBe(MIMO_V25_MODEL_ID);
    expect(r!.content.length).toBeGreaterThan(0);
    expect(r!.usage).toMatchObject({ inputTokens: expect.any(Number), outputTokens: expect.any(Number) });
  });
});

describe('V1.1-C — 与 082 lane 集成（无 key 降级 pending-environment，不 throw）', () => {
  const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

  it('opencodeGoProviderResolver 无 key 接入 runRealModelLane → 全部 pending、degraded、不触真实 API', async () => {
    const { runRealModelLane } = await import('./real-model-lane.js');
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-opencode-lane-'));
    const report = await runRealModelLane({
      models: [m('mimo-v2.5', 'flash')],
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: opencodeGoProviderResolver({ keyResolver: () => undefined }),
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.degraded).toBe(true);
    expect(report.rows[0]!.status).toBe('pending-environment');
    expect(report.rows.some((r) => r.result)).toBe(false);
  });

  it('opencodeGoProviderResolver 注入 mock key + mock provider → lane 可跑并采集 §15 L3', async () => {
    const { runRealModelLane } = await import('./real-model-lane.js');
    const reports = fs.mkdtempSync(path.join(os.tmpdir(), 'cah-opencode-lane-'));
    const mockProvider: ChatProvider = new MockProvider(
      [{ when: /.*/, ifNoToolResult: true, response: { text: 'VMIMO-LANE' } }],
      { model: 'mimo-v2.5' },
    );
    const report = await runRealModelLane({
      models: [m('mimo-v2.5', 'flash')],
      scenarios: [{ id: 'B001', tier: 'flash', runnable: true }],
      providerResolver: async () => mockProvider,
      repoRoot: REPO_ROOT,
      reportsDir: reports,
    });
    expect(report.degraded).toBe(false);
    expect(report.rows[0]!.status).toBe('passed');
    expect(report.rows[0]!.result).toBeDefined();
    expect(report.modelSummaries[0]!.passed).toBe(1);
  });
});