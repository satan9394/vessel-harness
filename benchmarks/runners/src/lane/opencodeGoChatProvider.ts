/**
 * task 102 → task 103 — opencode-go 线协议客户端的 **lane 侧入口（re-export 外壳）**。
 *
 * task 102 曾把实现写在本文件里（485 行），只有 benchmark lane 能用；CLI/TUI 仍走通用
 * `OpenAICompatibleProvider`，对 Go 端点 400 `MissingSessionID`（见 docs/OPENCODE-KEY-VERIFY.md §4.2）。
 * task 103 按「方案 A」把实现**上提到 `@vessel/llm`**
 * （`packages/llm/src/provider/OpencodeGoProvider.ts`），CLI（`vessel run`）、TUI（`vessel chat`）
 * 与 lane **共用同一份协议实现**——单一事实源，本文件不再含任何协议逻辑，只保留 lane 侧
 * 既有的 import 路径（`./opencodeGoChatProvider.js`）不被打断。
 *
 * 新增代码请直接 import `@vessel/llm`；本外壳只为兼容既有 lane 代码/测试而存在。
 */
export {
  OPENCODE_GO_PROVIDER_ID,
  OPENCODE_GO_DEFAULT_BASE_URL,
  OPENCODE_GO_USER_AGENT,
  OPENCODE_GO_SESSION_HEADER,
  OPENCODE_GO_DEFAULT_MAX_TOKENS,
  OPENCODE_GO_ROUTE_RULES,
  OpencodeGoProvider,
  OpencodeGoError,
  classifyOpencodeGoError,
  resolveOpencodeGoRoute,
  sanitizeWireSnippet,
  extractWireErrorType,
  extractWireErrorMessage,
  toOpencodeGoWireMessages,
  parseOpencodeGoChatCompletion,
  opencodeGoErrorHint,
  opencodeGoKindFromMessage,
} from '@vessel/llm';

export type {
  OpencodeGoRoute,
  OpencodeGoWire,
  OpencodeGoRouteSupport,
  OpencodeGoRouteRule,
  OpencodeGoRouteInfo,
  OpencodeGoErrorKind,
  OpencodeGoErrorInit,
  OpencodeGoFetch,
  OpencodeGoProviderOptions,
  OpencodeGoCompletion,
} from '@vessel/llm';
