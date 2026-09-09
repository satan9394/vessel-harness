import {
  createProvider,
  providerNameForConfig,
  opencodeGoErrorHint,
  opencodeGoKindFromMessage,
  OPENCODE_GO_PROVIDER_ID,
  type OpencodeGoErrorKind,
} from '@vessel/llm';
import type { ChatProvider } from '@vessel/shared';
import { findPreset } from '@vessel/application';

/**
 * apps/cli/providers/providerFactory — CLI/TUI 的**唯一** provider 构造路径（task 103）。
 *
 * 背景：`vessel run` / `vessel chat` 过去用 `createProvider(cfg.protocol, …)` 构造客户端，
 * 对 opencode-go（preset id `opencode-go`，线协议仍是 `openai-compatible`）会走通用
 * OpenAI 兼容客户端——缺 `x-opencode-session` → Go 端点 400 `MissingSessionID`。
 *
 * 本模块把「配置/显式参数 → provider 名 + baseUrl + apiKey + model」收敛成一条解析，
 * 再交给 `@vessel/llm` 的 `createProvider`：preset id `opencode-go` 自动解析为专用
 * provider（`OpencodeGoProvider`：稳定 session 头 + 具名 UA + 错误分类）。
 * **协议逻辑只有一份**（`packages/llm/src/provider/OpencodeGoProvider.ts`），
 * CLI / TUI / benchmark lane 共用；本文件不含任何 wire 细节。
 *
 * 密钥安全：apiKey 只从调用方传入（flags / env / CredentialStore 解析结果）在进程内流转，
 * 本模块不读盘、不写盘、不打印 key。
 */

/** 需要真实网络端点的 provider 名（其余按离线 mock 处理）。 */
export const REAL_PROVIDER_NAMES: ReadonlySet<string> = new Set<string>([
  'openai-compatible',
  'anthropic',
  OPENCODE_GO_PROVIDER_ID,
]);

/** 已存供应商配置的最小面（ProviderStore.ProviderConfig 的子集）。 */
export interface ProviderPlanConfig {
  id?: string;
  protocol?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface ProviderPlanInput {
  /** 已存供应商配置（有则以其 id/protocol 决定 provider 名） */
  config?: ProviderPlanConfig;
  /** 显式 --provider（无配置时用它决定 provider 名） */
  explicitProvider?: string;
  /** 覆盖项（优先级最高：flags > env > config） */
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

/** 解析结果：给 `createProvider` 用的 provider 名 + 端点参数。 */
export interface ProviderPlan {
  /** provider 名（可能是 `opencode-go`；mock 为 'mock'） */
  providerName: string;
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string;
  /** 是否为真实网络 provider（false → 调用方走离线 mock 脚本） */
  real: boolean;
}

/** opencode-go preset 的 baseUrl（preset 是 SSOT；未显式配端点时兜底）。 */
export function opencodeGoPresetBaseUrl(): string | undefined {
  return findPreset(OPENCODE_GO_PROVIDER_ID)?.baseUrl;
}

/**
 * 解析 provider 方案。
 *
 * provider 名优先级：已存配置的 id/protocol（`providerNameForConfig`，preset id
 * `opencode-go` → 专用 provider）> 显式 `--provider` > `mock`。
 * 端点/baseUrl/apiKey/model 优先级：显式参数 > 已存配置 > opencode-go preset 兜底 baseUrl。
 */
export function planProvider(input: ProviderPlanInput): ProviderPlan {
  const providerName = input.config
    ? providerNameForConfig(input.config)
    : (input.explicitProvider ?? 'mock');
  const baseUrl =
    input.baseUrl ??
    input.config?.baseUrl ??
    (providerName === OPENCODE_GO_PROVIDER_ID ? opencodeGoPresetBaseUrl() : undefined);
  return {
    providerName,
    baseUrl,
    apiKey: input.apiKey ?? input.config?.apiKey,
    model: input.model ?? input.config?.model ?? 'mock-model',
    real: REAL_PROVIDER_NAMES.has(providerName),
  };
}

/** plan 的 baseUrl 是否缺失（调用方据此给出 `--base-url` 提示并退出）。 */
export function missingBaseUrl(plan: ProviderPlan): boolean {
  return plan.real && !plan.baseUrl;
}

/**
 * 用 plan 构造真实 provider（mock / 无端点 → null，调用方自行构造离线 provider）。
 *
 * `sessionId`：opencode-go 的会话 id（同一会话稳定）。TUI 一个会话生成一次，
 * 于是同会话内换模型/重建 harness 仍复用同一个 `x-opencode-session`；省略则每次构造一个新 UUID。
 */
export function buildRealProvider(plan: ProviderPlan, opts: { sessionId?: string } = {}): ChatProvider | null {
  if (!plan.real) return null;
  if (!plan.baseUrl) throw new Error(`${plan.providerName} 需要 base-url（--base-url / VESSEL_BASE_URL / vessel provider add）`);
  return createProvider(plan.providerName, {
    baseUrl: plan.baseUrl,
    apiKey: plan.apiKey,
    model: plan.model,
    ...(opts.sessionId ? { sessionId: opts.sessionId } : {}),
  });
}

/**
 * 面向用户的错误描述：opencode-go 的已分类错误附一句可操作提示，其余错误原样返回
 * （不改变既有 CLI 文案）。
 *
 * 注意：AgentLoop 会用 `new Error(...)` 重新包装 provider 错误，`kind` 字段会丢，
 * 所以这里除了读 `err.kind`，还会从稳定的错误文案里还原 kind。
 */
export function describeProviderError(err: unknown): string {
  const message = (err as Error)?.message ?? String(err);
  const kind = (err as { kind?: OpencodeGoErrorKind }).kind ?? opencodeGoKindFromMessage(message);
  if (!kind) return message;
  const hint = opencodeGoErrorHint(kind);
  return hint ? `${message}\n  提示：${hint}` : message;
}
