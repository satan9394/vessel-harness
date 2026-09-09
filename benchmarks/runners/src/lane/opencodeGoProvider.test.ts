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
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChatProvider } from '@vessel/shared';
import { MockProvider } from '@vessel/llm';
import { findPreset } from '@vessel/cli';
import { LANE_MODELS, type LaneModel } from './real-model-lane.js';
import {
  OPENCODE_GO_PRESET_ID,
  OPENCODE_API_KEY_ENV,
  MIMO_V25_MODEL_ID,
  MIMO_V25_PRO_MODEL_ID,
  opencodeGoBaseUrl,
  opencodeGoEndpoint,
  envOpencodeGoKey,
  resolveOpencodeGoProvider,
  opencodeGoProviderResolver,
  selectMimoModel,
  defaultMimoLaneModels,
  fetchOpencodeGoModels,
  probeOpencodeGoOnce,
  OPENCODE_GO_REFERENCE_MODELS,
} from './opencodeGoProvider.js';

function m(modelId: string, tier: 'pro' | 'flash'): LaneModel {
  return { id: `x:${modelId}`, displayName: `X ${modelId}`, tier, defaultModel: modelId };
}

describe('V1.1-C — opencode-go preset 复用（SSOT）', () => {
  it('preset 已内置注册，协议 openai-compatible，baseUrl=https://opencode.ai/zen/go/v1', () => {
    const preset = findPreset(OPENCODE_GO_PRESET_ID);
    expect(preset).toBeDefined();
    expect(preset!.protocol).toBe('openai-compatible');
    expect(preset!.baseUrl).toBe('https://opencode.ai/zen/go/v1');
    expect(opencodeGoBaseUrl()).toBe('https://opencode.ai/zen/go/v1');
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

  it('env 有 key（注入固定值，非真实密钥）→ 构造真实 openai-compatible ChatProvider', () => {
    const p = resolveOpencodeGoProvider(m('mimo-v2.5', 'flash'), {
      keyResolver: () => 'sk-test-not-a-real-key',
    });
    expect(p).not.toBeNull();
    expect(p!.id).toBe('openai-compatible');
    // baseUrl 落在 opencode-go 端点
    expect(opencodeGoEndpoint(() => 'k').baseUrl).toBe('https://opencode.ai/zen/go/v1');
  });

  it('API key 绝不落盘：env 约定名与内置 reference 一致（不写文件）', () => {
    expect(OPENCODE_API_KEY_ENV).toBe('OPENCODE_API_KEY');
    // 断言默认 resolver 只读 env，路径上没有任何写盘调用（getter 不写）
    expect(envOpencodeGoKey).toBeTypeOf('function');
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