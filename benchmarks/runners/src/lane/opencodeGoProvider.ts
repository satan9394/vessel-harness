/**
 * task V1.1-C — opencode-go provider 接入（真实模型闭环的一半：连接面）。
 *
 * 把「opencode-go 供应商 + OPENCODE_API_KEY 环境变量 + MIMO 目标模型」收敛成一个可注入、
 * 可 mock 的真实 ChatProvider 解析面，供 082 real-model lane 与 084 release gates 消费。
 *
 * 密钥安全铁律：**凭据绝不落盘**。apiKey 只经注入的 keyResolver 读取（task 097 收敛为两条
 * 来源：仓库 CredentialStore 034/069 DPAPI + 环境变量 `OPENCODE_API_KEY`，见
 * `opencodeGoCredential.ts`；**不读任何用户本机应用数据**）；无 key 就不构造 provider，
 * 由 lane/gate 降级为 pending-environment。本模块不做任何写盘/持久化。
 *
 * 复用既有机制：
 *   - 内置 preset `@vessel/application` 的 packages/application/src/providers/presets.data.ts
 *     （id='opencode-go'，protocol='openai-compatible'，baseUrl='https://opencode.ai/zen/go/v1'）。
 *     task 098：该 SSOT 由 apps/cli 下沉到 application 层，runner 不再 import '@vessel/cli'
 *     （消除 cli ↔ bench-runners 的 tsc -b 类型环）。
 *   - task 102：线协议客户端由本目录的 `opencodeGoChatProvider.ts` 提供（Go 端点硬要求
 *     `x-opencode-session` + 具名 User-Agent + 路径分流 + 错误分类）。**不再用通用
 *     `createProvider('openai-compatible')`**——它无法注入自定义头，会被 Go 端点判 400
 *     MissingSessionID（实测见 docs/OPENCODE-KEY-VERIFY.md §4.2）。
 *   - task 103：该实现**上提到 `@vessel/llm`**（`packages/llm/src/provider/OpencodeGoProvider.ts`），
 *     CLI（`vessel run`）/TUI（`vessel chat`）与 lane 共用；本目录的 `opencodeGoChatProvider.ts`
 *     只剩 re-export 外壳（无第二份协议逻辑），本文件无需改动即继续工作。
 *   - @vessel/application 的 fetchOpenAIModels 拉取 /v1/models 清单。
 *
 * 模型确认：真实 GET {base}/v1/models 验证目标模型确切 id。仓库内置的 models.dev
 * 参考快照（docs/ideas/data/models.dev-api.json 的 opencode-go 项）列出 `mimo-v2.5` 与
 * `mimo-v2.5-pro`（以及 mimo-v2-pro / mimo-v2-omni）；live 清单以拉取为准。无 key / 网络
 * 受限时由调用方记录「待非受限环境验证」，本模块只做可注入接线。
 *
 * task 111：lane 默认 flash 档从 `mimo-v2.5` 换成 `deepseek-flash`（110 终对比稳定性 10/10、
 * gate 4 pending→pass）——默认选择由 `defaultLaneModels()` 决定（deepseek-flash 优先，MIMO V2.5 系
 * 回退）；`mimo-v2.5` 显式复跑能力保留（`--model=...` / `--models=...` → `explicitLaneModels()`）。
 */
import { randomUUID } from 'node:crypto';
import type { ChatProvider } from '@vessel/shared';
import { findPreset } from '@vessel/application';
import { fetchOpenAIModels, type ModelSource } from '@vessel/application';
import { envOpencodeGoKey, type OpencodeGoKeyResolver } from './opencodeGoCredential.js';
import {
  OpencodeGoProvider,
  type OpencodeGoFetch,
} from './opencodeGoChatProvider.js';
import type { LaneModel, LaneModelTier } from './real-model-lane.js';

/** opencode-go preset id（对齐 packages/application/src/providers/presets.data.ts）。 */
export const OPENCODE_GO_PRESET_ID = 'opencode-go';

/** MIMO V2.5 目标模型 id（用户指定；live 清单确认后用实际 id 覆盖解析）。 */
export const MIMO_V25_MODEL_ID = 'mimo-v2.5';
/** MIMO V2.5 Pro（同代 Pro 档，备选/Pro 档记录）。 */
export const MIMO_V25_PRO_MODEL_ID = 'mimo-v2.5-pro';

/** DeepSeek Flash 目标模型 id（task 111：lane 默认 flash 档；110 终对比稳定性 10/10）。 */
export const DEEPSEEK_FLASH_MODEL_ID = 'deepseek-flash';

/** 匹配“MIMO V2.5 系”模型 id 的正则（用于在 live 清单里挑最接近的目标）。 */
export const MIMO_V25_RE = /mimo[.-]v?2\.5/i;

/**
 * 解析 opencode-go 的 baseUrl（不存在则抛——注册不应缺失）。
 *
 * **本函数是 lane 唯一的端点覆盖入口**：环境变量 `VESSEL_OPENCODE_GO_BASE_URL`（trim 后非空）
 * 优先于内置 preset 的 baseUrl，用于把发布门禁的 real-model lane（task 082/097/102）指向自有的
 * OpenAI 兼容端点（`GET /v1/models` + `POST /v1/chat/completions`，例如 CI 网关 / 自建服务）。
 * 覆盖值末尾的 `/` 会被剥掉（避免拼出 `//models`）。
 *
 * **未设置该环境变量、或值为纯空白时，行为与改动前逐字一致**：仍解析内置 preset 并返回其
 * baseUrl，preset 缺失或协议不符仍抛同一错误。**默认值/注册表均未改动。**
 *
 * 作用域仅限 lane：产品运行时的 provider 解析（`@vessel/application` 的 preset 注册表、
 * CLI/TUI 的 provider 选择、`@vessel/llm` 的 `OPENCODE_GO_DEFAULT_BASE_URL` 常量）都不经过
 * 本函数，因此不受该环境变量影响。
 *
 * `env` 参数仅供测试注入，可选且缺省 `process.env`，既有调用点无需改动。
 */
export function opencodeGoBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  // 显式覆盖：用于把门禁的 real-model lane 指向自有 OpenAI 兼容端点（例如 CI/自建网关）。
  // 默认（未设置/空白）行为与改动前逐字一致。
  const override = env.VESSEL_OPENCODE_GO_BASE_URL?.trim();
  if (override) {
    // 按扫描剥尾斜杠，不用 `/\/+$/`（`$` 锚点使其为多项式 — CodeQL js/polynomial-redos）。
    let base = override;
    while (base.endsWith('/')) base = base.slice(0, -1);
    return base; // 剥尾斜杠，避免与路径拼出 `//models`
  }
  const preset = findPreset(OPENCODE_GO_PRESET_ID);
  if (!preset || preset.protocol !== 'openai-compatible') {
    throw new Error(`opencode-go preset 未注册或协议非 openai-compatible（preset id=${OPENCODE_GO_PRESET_ID}）`);
  }
  return preset.baseUrl;
}

/**
 * 凭据来源（task 097）：**只有两条**——① CredentialStore（034/069 DPAPI + secretRef，
 * 用户经 `vessel provider add` / setup 向导主动写入）；② 环境变量 `OPENCODE_API_KEY`。
 * 实现见 `opencodeGoCredential.ts`（不读任何用户本机应用数据）。本模块只消费 resolver。
 */

/** opencode-go 真实 provider 的组装参数（供单测与诊断复现）。 */
export interface OpencodeGoEndpoint {
  baseUrl: string;
  /** 协议（固定 openai-compatible）。 */
  protocol: 'openai-compatible';
  /** 延迟解析的 apiKey（无 key 时为 undefined）。 */
  apiKey?: string;
  /**
   * 有 key → true（provider 可构造）；无 key → false（lane 降级 pending）。
   *
   * 判据 = **空/纯空白一律按"没有 key"**，与 `opencodeGoCredential.ts` 的 `hasKeyValue`
   * 同口径（也是全仓「有没有值」的统一判据）。内置的两条来源（env / CredentialStore）已按它
   * 收敛，但本函数的 `keyResolver` 是**可注入的自定义 resolver**：旧写法 `apiKey.length > 0`
   * 会把 `'   '` 判成有 key ⇒ lane 拿一个纯空白密钥去真连端点（401/挂死），而不是按契约
   * 降级 `pending-environment`。
   * 非空白值**逐字返回、不 trim**（密钥是逐字值，trim 属于值变换；本处只统一"有没有值"）。
   */
  hasKey: boolean;
}

/** 解析 opencode-go 端点状态（复用内置 preset baseUrl + 注入 key）。 */
export function opencodeGoEndpoint(keyResolver: OpencodeGoKeyResolver = envOpencodeGoKey): OpencodeGoEndpoint {
  const apiKey = keyResolver();
  return {
    baseUrl: opencodeGoBaseUrl(),
    protocol: 'openai-compatible',
    apiKey,
    // 「有没有 key」的唯一判据：`undefined`/`''`/纯空白 ⇒ 无 key（同 `hasKeyValue`）。
    // 旧写法 `apiKey.length > 0` 只挡空串 ⇒ 自定义 resolver 返回 `'   '` 时仍会真连。
    hasKey: typeof apiKey === 'string' && apiKey.trim() !== '',
  };
}

/** opencode-go 真实 provider 的构造选项（协议修正的可注入面）。 */
export interface OpencodeGoResolveOptions {
  keyResolver?: OpencodeGoKeyResolver;
  /** 会话 id（缺省生成 UUID）；同一 lane 会话的所有模型/重试共用同一个值。 */
  sessionId?: string;
  /** 具名 User-Agent（缺省 OPENCODE_GO_USER_AGENT）。 */
  userAgent?: string;
  /** 缺省 max_tokens（推理模型需留思维链预算）。 */
  defaultMaxTokens?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  /** 测试注入的 fetch 替身（生产用全局 fetch）。 */
  fetchImpl?: OpencodeGoFetch;
}

/** 无 key / 不可达时返回 null（lane pending），否则构造一个 opencode-go ChatProvider。 */
export function resolveOpencodeGoProvider(
  model: LaneModel,
  opts: OpencodeGoResolveOptions = {},
): ChatProvider | null {
  const ep = opencodeGoEndpoint(opts.keyResolver);
  if (!ep.hasKey) return null;
  return new OpencodeGoProvider({
    baseUrl: ep.baseUrl,
    apiKey: ep.apiKey,
    model: model.defaultModel,
    sessionId: opts.sessionId,
    userAgent: opts.userAgent,
    defaultMaxTokens: opts.defaultMaxTokens,
    timeoutMs: opts.timeoutMs,
    maxAttempts: opts.maxAttempts,
    fetchImpl: opts.fetchImpl,
  });
}

/**
 * opencode-go 可注入的真实 lane provider resolver（直接给 082 lane / 084 gate 用）。
 * **会话语义**：resolver 创建时生成一个 session id（一个 lane 会话一个稳定 UUID），
 * 之后为每个模型构造的 provider 都复用它；provider 内部的退避重试同样复用该 id。
 */
export function opencodeGoProviderResolver(
  opts: OpencodeGoResolveOptions = {},
): (model: LaneModel) => Promise<ChatProvider | null> {
  const keyResolver = opts.keyResolver ?? envOpencodeGoKey;
  const sessionId = opts.sessionId ?? randomUUID();
  return async (model) => resolveOpencodeGoProvider(model, { ...opts, keyResolver, sessionId });
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

/** 把 pro/flash 两档的选定模型装配成 LaneModel 列表（pro 档优先；flash 与 pro 同 id 时去重）。 */
function assembleLaneModels(
  proModel: string | null | undefined,
  flashModel: string | null | undefined,
): LaneModel[] {
  const out: LaneModel[] = [];
  if (proModel) {
    out.push({ id: `opencode-go:${proModel}`, displayName: `OpenCode Go ${proModel}`, tier: 'pro', defaultModel: proModel });
  }
  if (flashModel && flashModel !== proModel) {
    out.push({ id: `opencode-go:${flashModel}`, displayName: `OpenCode Go ${flashModel}`, tier: 'flash', defaultModel: flashModel });
  }
  return out;
}

/**
 * MIMO 专属选择：pro=尽力选 MIMO V2.5 Pro，flash=尽力选 MIMO V2.5（task 111 前是 lane 默认；
 * 现保留为 MIMO 显式选择/回退语义，`defaultLaneModels` 的 MIMO 回退复用同一确定性逻辑）。
 */
export function defaultMimoLaneModels(
  available: readonly string[],
): LaneModel[] {
  const pro = selectMimoModel(available, { preferred: MIMO_V25_PRO_MODEL_ID, matcher: /mimo[.-]v?2\.5/ });
  const flash = selectMimoModel(available, { preferred: MIMO_V25_MODEL_ID, matcher: /mimo[.-]v?2\.5/ });
  return assembleLaneModels(pro.selected ?? pro.matchedMimo[0], flash.selected ?? flash.matchedMimo[0]);
}

/**
 * 默认 opencode-go lane 模型档（task 111：默认 flash 档 = deepseek-flash；pro 档保持 MIMO V2.5 Pro）。
 * 110 终对比：deepseek-flash 全场景 ×2 双轮 10/10（mimo-v2.5 三轮失败集每次不同、gate 4 恒 pending）
 * → 作为 lane 默认；显式 `--model=mimo-v2.5` / `--models=mimo-v2.5` 仍可覆盖（保留 mimo 复跑能力）。
 * live 清单无 `deepseek-flash`（如无 key 时的内置参考快照）→ 回退既定 MIMO V2.5 系确定性选择，不抛。
 */
export function defaultLaneModels(
  available: readonly string[],
): LaneModel[] {
  const pro = selectMimoModel(available, { preferred: MIMO_V25_PRO_MODEL_ID, matcher: /mimo[.-]v?2\.5/ });
  const flash = selectMimoModel(available, { preferred: MIMO_V25_MODEL_ID, matcher: /mimo[.-]v?2\.5/ });
  const proModel = pro.selected ?? pro.matchedMimo[0];
  const flashModel = available.includes(DEEPSEEK_FLASH_MODEL_ID)
    ? DEEPSEEK_FLASH_MODEL_ID
    : (flash.selected ?? flash.matchedMimo[0]);
  return assembleLaneModels(proModel, flashModel);
}

/**
 * 显式 `--model=...` / `--models=...` 覆盖（task 111：保留 mimo-v2.5 复跑能力）：把逗号分隔的
 * 模型 id 按给定档位（默认 flash）直接映射为 LaneModel，**不经过**默认选择。
 */
export function explicitLaneModels(
  ids: readonly string[],
  tiers: readonly LaneModelTier[],
): LaneModel[] {
  const out: LaneModel[] = [];
  for (const id of ids) {
    for (const t of tiers) {
      out.push({ id: `opencode-go:${id}`, displayName: `OpenCode Go ${id}`, tier: t, defaultModel: id });
    }
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
 * task 102：默认走 OpencodeGoProvider（带 x-opencode-session + 具名 UA），并把 reasoning 长度
 * 一起带回来——mimo-v2.5 是推理模型，`content` 为空但 `reasoning` 有值是常态，需要可见。
 */
export async function probeOpencodeGoOnce(
  model: { defaultModel: string },
  opts: OpencodeGoResolveOptions & { provider?: ChatProvider | null; maxTokens?: number } = {},
): Promise<{
  ok: boolean;
  model: string;
  content: string;
  reasoningChars: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  error?: string;
  errorKind?: string;
} | null> {
  const ep = opencodeGoEndpoint(opts.keyResolver);
  if (!ep.hasKey && opts.provider === undefined) return null;
  const provider =
    opts.provider ??
    new OpencodeGoProvider({
      baseUrl: ep.baseUrl,
      apiKey: ep.apiKey,
      model: model.defaultModel,
      sessionId: opts.sessionId,
      userAgent: opts.userAgent,
      timeoutMs: opts.timeoutMs,
      maxAttempts: opts.maxAttempts,
      fetchImpl: opts.fetchImpl,
    });
  try {
    const res = await provider.chat({
      model: model.defaultModel,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: opts.maxTokens ?? 256,
    });
    const raw = res.raw as { reasoning?: string } | undefined;
    const out: {
      ok: boolean;
      model: string;
      content: string;
      reasoningChars: number;
      usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
      error?: string;
      errorKind?: string;
    } = {
      ok: true,
      model: model.defaultModel,
      content: res.content,
      reasoningChars: raw?.reasoning?.length ?? 0,
      usage: res.usage ?? { inputTokens: 0, outputTokens: 0 },
    };
    return out;
  } catch (err) {
    return {
      ok: false,
      model: model.defaultModel,
      content: '',
      reasoningChars: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      error: (err as Error).message,
      errorKind: (err as { kind?: string }).kind,
    };
  }
}