/**
 * task V1.1-C — opencode-go provider 接入（真实模型闭环的一半：连接面）。
 *
 * 把「opencode-go 供应商 + OPENCODE_API_KEY 环境变量 + MIMO 目标模型」收敛成一个可注入、
 * 可 mock 的真实 ChatProvider 解析面，供 082 real-model lane 与 084 release gates 消费。
 *
 * 密钥安全铁律：**凭据绝不落盘**。apiKey 只经注入的 keyResolver 读取（默认
 * process.env.OPENCODE_API_KEY）；无 key 就不构造 provider，由 lane/gate 降级为
 * pending-environment。本模块不做任何写盘/持久化。
 *
 * 复用既有机制：
 *   - 内置 preset `@vessel/application` 的 packages/application/src/providers/presets.data.ts
 *     （id='opencode-go'，protocol='openai-compatible'，baseUrl='https://opencode.ai/zen/go/v1'）。
 *     task 098：该 SSOT 由 apps/cli 下沉到 application 层，runner 不再 import '@vessel/cli'
 *     （消除 cli ↔ bench-runners 的 tsc -b 类型环）。
 *   - @vessel/llm createProvider('openai-compatible', …) 线协议客户端。
 *   - @vessel/application 的 fetchOpenAIModels 拉取 /v1/models 清单。
 *
 * 模型确认：真实 GET {base}/v1/models 验证 MIMO V2.5 确切 id。仓库内置的 models.dev
 * 参考快照（docs/ideas/data/models.dev-api.json 的 opencode-go 项）列出 `mimo-v2.5` 与
 * `mimo-v2.5-pro`（以及 mimo-v2-pro / mimo-v2-omni）；live 清单以拉取为准。无 key / 网络
 * 受限时由调用方记录「待非受限环境验证」，本模块只做可注入接线。
 */
import type { ChatProvider } from '@vessel/shared';
import { createProvider } from '@vessel/llm';
import { findPreset } from '@vessel/application';
import { fetchOpenAIModels, type ModelSource } from '@vessel/application';
import { OPCODE_GO_CRED_SERVICE, OPCODE_GO_CRED_ACCOUNT } from './ccSwitchCredential.js';
import type { LaneModel } from './real-model-lane.js';

/** opencode-go preset id（对齐 packages/application/src/providers/presets.data.ts）。 */
export const OPENCODE_GO_PRESET_ID = 'opencode-go';

/** 密钥环境变量约定（任务卡/模型清单唯一事实源；不读写磁盘）。 */
export const OPENCODE_API_KEY_ENV = 'OPENCODE_API_KEY';

/** MIMO V2.5 目标模型 id（用户指定；live 清单确认后用实际 id 覆盖解析）。 */
export const MIMO_V25_MODEL_ID = 'mimo-v2.5';
/** MIMO V2.5 Pro（同代 Pro 档，备选/Pro 档记录）。 */
export const MIMO_V25_PRO_MODEL_ID = 'mimo-v2.5-pro';

/** 匹配“MIMO V2.5 系”模型 id 的正则（用于在 live 清单里挑最接近的目标）。 */
export const MIMO_V25_RE = /mimo[.-]v?2\.5/i;

/** 从内置 preset 解析 opencode-go 的 baseUrl（不存在则抛——注册不应缺失）。 */
export function opencodeGoBaseUrl(): string {
  const preset = findPreset(OPENCODE_GO_PRESET_ID);
  if (!preset || preset.protocol !== 'openai-compatible') {
    throw new Error(`opencode-go preset 未注册或协议非 openai-compatible（preset id=${OPENCODE_GO_PRESET_ID}）`);
  }
  return preset.baseUrl;
}

/** 密钥读取注入点（默认环境变量；测试注入固定值，不碰真实凭据）。 */
export type OpencodeGoKeyResolver = () => string | undefined;

/** 默认 keyResolver：只读 env，绝不落盘。 */
export const envOpencodeGoKey: OpencodeGoKeyResolver = () => process.env[OPENCODE_API_KEY_ENV];

/**
 * CredentialStore 读取 key（task V1.1-F）：读 `credential:<service>/<account>` 存的那一项
 * （DPAPI 加密落库，明文只在进程内）。store 可注入（测试 mock）；读不到返回 undefined。
 * 用同步 getSync 对齐 `OpencodeGoKeyResolver` 的同步签名（034/069 CredentialBackend 同时
 * 提供 sync/async 两套）。只读、不写盘——写盘由迁移动作（ccSwitchCredential.migrate）负责。
 */
export function credentialStoreOpencodeGoKey(
  store: { getSync(service: string, account: string): string | null },
  service = OPCODE_GO_CRED_SERVICE,
  account = OPCODE_GO_CRED_ACCOUNT,
): () => string | undefined {
  return () => {
    const v = store.getSync(service, account);
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
}

/**
 * 组合 key resolver（task V1.1-F）：先读 CredentialStore（034/069 DPAPI 加密落库，用同步
 * getSync），再回退环境变量 `OPENCODE_API_KEY`，最后回退注入的兜底 resolver（如 undefined）。
 * 测试可注入 store/env/fallback；不注入时构造真实 CredentialStore（Windows DPAPI），但
 * **懒加载 + 尽力而为**（读不到/不可用绝不抛，落到下一级）。
 */
export function credentialAwareOpencodeGoKey(opts: {
  store?: { getSync(service: string, account: string): string | null };
  createStore?: () => { getSync(service: string, account: string): string | null };
  env?: NodeJS.ProcessEnv;
  fallback?: OpencodeGoKeyResolver;
} = {}): OpencodeGoKeyResolver {
  const env = opts.env ?? process.env;
  const fallback = opts.fallback ?? (() => undefined);
  const store = opts.store ?? opts.createStore?.();
  const credResolver = store ? credentialStoreOpencodeGoKey(store) : undefined;
  return () => {
    // 1) CredentialStore（DPAPI 加密落库）优先
    if (credResolver) {
      const fromStore = credResolver();
      if (typeof fromStore === 'string' && fromStore.length > 0) return fromStore;
    }
    // 2) 环境变量回退
    const fromEnv = env[OPENCODE_API_KEY_ENV];
    if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
    // 3) 注入兜底（正常为 undefined → lane 降级 pending）
    return fallback();
  };
}

/** opencode-go 真实 provider 的组装参数（供单测与诊断复现）。 */
export interface OpencodeGoEndpoint {
  baseUrl: string;
  /** 协议（固定 openai-compatible）。 */
  protocol: 'openai-compatible';
  /** 延迟解析的 apiKey（无 key 时为 undefined）。 */
  apiKey?: string;
  /** 有 key → true（provider 可构造）；无 key → false（lane 降级 pending）。 */
  hasKey: boolean;
}

/** 解析 opencode-go 端点状态（复用内置 preset baseUrl + 注入 key）。 */
export function opencodeGoEndpoint(keyResolver: OpencodeGoKeyResolver = envOpencodeGoKey): OpencodeGoEndpoint {
  const apiKey = keyResolver();
  return {
    baseUrl: opencodeGoBaseUrl(),
    protocol: 'openai-compatible',
    apiKey,
    hasKey: typeof apiKey === 'string' && apiKey.length > 0,
  };
}

/** 无 key / 不可达时返回 null（lane pending），否则构造一个 openai-compatible ChatProvider。 */
export function resolveOpencodeGoProvider(
  model: LaneModel,
  opts: { keyResolver?: OpencodeGoKeyResolver } = {},
): ChatProvider | null {
  const ep = opencodeGoEndpoint(opts.keyResolver);
  if (!ep.hasKey) return null;
  return createProvider('openai-compatible', {
    baseUrl: ep.baseUrl,
    apiKey: ep.apiKey,
    model: model.defaultModel,
  });
}

/** opencode-go 可注入的真实 lane provider resolver（直接给 082 lane / 084 gate 用）。 */
export function opencodeGoProviderResolver(
  opts: { keyResolver?: OpencodeGoKeyResolver } = {},
): (model: LaneModel) => Promise<ChatProvider | null> {
  const keyResolver = opts.keyResolver ?? envOpencodeGoKey;
  return async (model) => resolveOpencodeGoProvider(model, { keyResolver });
}

/**
 * 在模型清单中挑“最接近 MIMO V2.5”的可用 id：
 *   1) 命中 `mimo-v2.5` 精确 id → 用它；
 *   2) 命中 mimo[.-]v?2.5（如 mimo-v2.5-pro）→ 取其中似乎最“瘦”的一个（保证确定性，取 lexicographic 最小）；
 *   3) 有任一 mimo-v2.x / mimo 系 → 记录实际可用 MIMO 模型，返回第一个；
 *   4) 无 → 返回 null（无可用 MIMO 目标）。
 * 未命中时由调用方记录实际可用清单并决定回退策略；本函数只做确定性的“最接近”选择。
 */
export function selectMimoModel(
  available: readonly string[],
  opts: { preferred?: string; matcher?: RegExp } = {},
): { selected: string | null; matchedV25: string[]; matchedMimo: string[] } {
  const pref = opts.preferred ?? MIMO_V25_MODEL_ID;
  const matcher = opts.matcher ?? MIMO_V25_RE;
  if (available.includes(pref)) return { selected: pref, matchedV25: [pref], matchedMimo: [pref] };
  const v25 = available.filter((m) => matcher.test(m)).sort();
  if (v25.length > 0) return { selected: v25[0]!, matchedV25: v25, matchedMimo: v25 };
  const mimo = available.filter((m) => /mimo/i.test(m)).sort();
  return { selected: mimo[0] ?? null, matchedV25: [], matchedMimo: mimo };
}

/** 默认 opencode-go 真实模型档：pro=尽力选 MIMO V2.5 Pro，flash=尽力选 MIMO V2.5。 */
export function defaultMimoLaneModels(
  available: readonly string[],
): LaneModel[] {
  const pro = selectMimoModel(available, { preferred: MIMO_V25_PRO_MODEL_ID, matcher: /mimo[.-]v?2\.5/ });
  const flash = selectMimoModel(available, { preferred: MIMO_V25_MODEL_ID, matcher: /mimo[.-]v?2\.5/ });
  const proModel = pro.selected ?? pro.matchedMimo[0];
  const flashModel = flash.selected ?? flash.matchedMimo[0];
  const out: LaneModel[] = [];
  if (proModel) out.push({ id: `opencode-go:${proModel}`, displayName: `OpenCode Go ${proModel}`, tier: 'pro', defaultModel: proModel });
  if (flashModel && flashModel !== proModel) {
    out.push({ id: `opencode-go:${flashModel}`, displayName: `OpenCode Go ${flashModel}`, tier: 'flash', defaultModel: flashModel });
  } else if (flashModel && proModel === undefined) {
    out.push({ id: `opencode-go:${flashModel}`, displayName: `OpenCode Go ${flashModel}`, tier: 'flash', defaultModel: flashModel });
  }
  return out;
}

/**
 * 真实拉取 opencode-go 模型清单（复用 fetchOpenAIModels 的 {base}/v1/models → {base}/models
 * 回退）。key 缺失时返回 builtin 参考清单（models.dev 快照）并标注 note，不抛。
 * `srcOverride` 仅供测试注入（fetchOpenAIModels 内部用全局 fetch；测试在 mock 服务或全局
 * fetch 替身上盖）。
 */
export async function fetchOpencodeGoModels(
  keyResolver: OpencodeGoKeyResolver = envOpencodeGoKey,
  srcOverride?: (baseUrl: string, apiKey?: string) => Promise<ModelSource>,
): Promise<{ source: ModelSource; endpoint: OpencodeGoEndpoint }> {
  const ep = opencodeGoEndpoint(keyResolver);
  if (ep.hasKey) {
    try {
      const src = srcOverride
        ? await srcOverride(ep.baseUrl, ep.apiKey)
        : await fetchOpenAIModels(ep.baseUrl, ep.apiKey);
      return { source: src, endpoint: ep };
    } catch (err) {
      return {
        source: { origin: 'none', models: [], note: `live 拉取失败（待非受限环境验证）：${(err as Error).message}` },
        endpoint: ep,
      };
    }
  }
  // 无 key：给出内置参考清单（models.dev 快照，非实时），供走查模型 id，不烧配额。
  return {
    source: {
      origin: 'builtin',
      models: OPENCODE_GO_REFERENCE_MODELS.slice(),
      note: 'OPENCODE_API_KEY 未注入 → 未实拉；以下为仓库 models.dev 参考快照（非实时），', 
    },
    endpoint: ep,
  };
}

/** 仓库内置参考：models.dev-api.json opencode-go 项（2026-09 快照）的模型 id。 */
export const OPENCODE_GO_REFERENCE_MODELS: readonly string[] = [
  'qwen3.7-max',
  'longcat-2.0',
  'deepseek-v4-flash-vision-exp',
  'qwen3.6-plus',
  'muse-spark-1.2-contributor',
  'minimax-m2.7',
  'kimi-k2.6',
  'glm-5.2',
  'minimax-m2.5',
  'minimax-m3',
  'deepseek-v4-flash',
  'kimi-k2.7-code',
  'grok-4.5',
  'ox-alpha-free',
  'hy3',
  'hy4-preview',
  'omen-alpha',
  'gpt-5.6-luna',
  'kimi-k3',
  'glm-5.3-flash',
  'muse-spark-1.3-contributor',
  'mimo-v2-pro',
  'qwen3.8-flash',
  'grok-4.6',
  'glm-5',
  'mimo-v2-omni',
  'qwen3.8-max',
  'kimi-k2.5',
  'glm-5.1',
  'qwen3.7-plus',
  'deepseek-v4-pro',
  'glm-5.3',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'qwen3.5-plus',
];

/**
 * 最小连通验证：用构造好的真实 provider 发一次最小 chat 调用，返回鉴权/响应/usage 快照
 * （成本最小化，仅验证链路）。provider 可注入（测试用 mock），杜绝在单测里打真实 API。
 * 无 key → return null（调用方记录 pending）。错误 → 返回 {ok:false, error}，不抛。
 */
export async function probeOpencodeGoOnce(
  model: { defaultModel: string },
  opts: { provider?: ChatProvider | null; keyResolver?: OpencodeGoKeyResolver } = {},
): Promise<{ ok: boolean; model: string; content: string; usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }; error?: string } | null> {
  const ep = opencodeGoEndpoint(opts.keyResolver);
  if (!ep.hasKey && opts.provider === undefined) return null;
  const provider =
    opts.provider ??
    createProvider('openai-compatible', { baseUrl: ep.baseUrl, apiKey: ep.apiKey, model: model.defaultModel });
  try {
    const res = await provider.chat({
      model: model.defaultModel,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 4,
    });
    return {
      ok: true,
      model: model.defaultModel,
      content: res.content,
      usage: res.usage ?? { inputTokens: 0, outputTokens: 0 },
    };
  } catch (err) {
    return { ok: false, model: model.defaultModel, content: '', usage: { inputTokens: 0, outputTokens: 0 }, error: (err as Error).message };
  }
}