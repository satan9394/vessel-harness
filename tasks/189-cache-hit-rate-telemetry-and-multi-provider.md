# 189 — 多供应商真实缓存计费命中率与多维透视 (Billed Cache Hit Rate Metrics & Telemetry)

- 编号：189
- 优先级：P1
- 关联模块：`packages/llm`, `packages/shared`, `packages/application`, `apps/cli`, `apps/web`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验收（2026-10-08，Epic 191 功能与门禁闭环；历史删除纪律偏差保留）
- 创建日期：2026-10-07

---

## 1. 目标与意图

各大模型供应商（Anthropic、OpenAI、DeepSeek、Google）均已支持 Prompt Caching（前缀缓存），但各家 API 返回的用量字段结构各异，传统客户端往往只记录 `input_tokens` 与 `output_tokens`，导致用户无法感知前缀缓存的实际收益。

本任务旨在建立**跨供应商的统一缓存计量与可观察性体系**：
1. **多供应商缓存指标标准化解析**：
   - Anthropic：解析 `cache_read_input_tokens`（读取命中）与 `cache_creation_input_tokens`（写入创建）；
   - OpenAI：解析 `prompt_tokens_details.cached_tokens`；
   - DeepSeek：解析 `prompt_cache_hit_tokens` 与 `prompt_cache_miss_tokens`；
2. **计算真实计费命中率（`billedHitRate`）与成本节省**：
   - 基于价格表精准推算因命中缓存而节省的美元金额（例如 Anthropic 缓存读取仅需 10% 成本，节省 90%）；
3. **缓存漂移与击穿告警（Cache Drift Detection）**：
   - 当在同一会话的连续交互中，由于提示词中间被修改导致命中率从高位（如 >80%）骤降为 0 时，记录 `audit/cache_drift` 事件，帮助开发者定位破环缓存的代码位置；
4. **CLI 与 Web 端多维可视化**：
   - Web 界面用量条（`UsageBar`）与会话详情展示缓存命中率标签（如 `⚡ Cache 92%`）及省钱统计；
   - CLI 提供 `vessel usage --cache` 查看整体缓存经济学指标。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 缓存计量数据契约 (`packages/shared/src/cacheMetrics.ts`)

```typescript
export interface CacheUsageMetrics {
  promptTokens: number;
  cachedTokens: number;
  creationTokens: number;
  billedHitRate: number; // 0.0 ~ 1.0
  estimatedSavingsUsd: number;
  provider: string;
  model: string;
}

export function extractProviderCacheMetrics(rawUsage: Record<string, unknown>, provider: string, model: string): CacheUsageMetrics;
```

### 2.2 缓存击穿检测器 (`packages/llm/src/discovery/CacheDriftDetector.ts`)

```typescript
export interface CacheDriftAlert {
  sessionId: string;
  previousHitRate: number;
  currentHitRate: number;
  previousPrefixHash?: string;
  currentPrefixHash?: string;
  droppedTokens: number;
  timestamp: number;
}

export class CacheDriftDetector {
  check(sessionId: string, metrics: CacheUsageMetrics, prefixHash?: string): CacheDriftAlert | null;
}
```

### 2.3 投影与 Web 契约 (`packages/application/src/projections/types.ts` & `apps/web/src/api.ts`)

- `UsageSummary` 扩充 `cachedTokensTotal: number` 与 `overallCacheHitRate: number`；
- Web 端在会话顶部与消息元数据中呈现绿色 Cache 节约徽章。

---

## 3. 架构红线与禁做准则

1. **薄核铁律**：`packages/core` 保持 0 改动，指标抽取在 `packages/llm` 流解析时完成，投影聚合在 `packages/application`；
2. **离线单测**：所有单测使用确定性 Mock 响应载荷，严禁发起真实公网网络请求；
3. **安全与脱敏**：计量记录中严禁记录任何 API Key、Prompt 真实文本或敏感信息。

---

## 4. 完成门禁 (DoD)

1. 定向测试全绿：
   - `npx vitest run packages/llm/src/discovery/cacheMetrics.test.ts`
   - `npx vitest run packages/application/src/projections/cacheUsageProjection.test.ts`
   - `npx vitest run --root apps/web apps/web/src/components/__tests__/UsageBarCache.test.tsx`
2. 类型与构建通过：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run -w @vessel/web build -- --emptyOutDir false` exit 0

## 阶段交证（2026-10-07）

- Anthropic/OpenAI/DeepSeek/Google wire 指标纯函数解包位于 shared；流式父/隔离子会话使用 llm decorator 保全指标，不改 core、不新增第三方依赖。
- 命中率按明确上报 prompt token 加权，混合未测量记录不猜口径；读取节省复用现有价格解析。新行可选 billableInputTokens 保证投影/持久统计/recompute 同价，旧行算法不改写。
- CLI `usage --cache`、Web 会话/消息徽章与 server-priced SSE 已接线；model/usage 可持久回放指标，audit/cache_drift 记录前后哈希及掉落量。既有 Web 重新选择会话不加载消息历史，本卡不宣称已有完整历史 UI 回放。
- 专项根 **2 文件 / 17 passed**、Web **1 文件 / 4 passed**；供应商/CLI 用量回归 **11 文件 / 257 passed**；构建与测试类型检查 exit 0。
- 证据：`evidence/sessions/2026-10-07-v2.1/phase189*.log`。
- **执行偏差**：执行器三次未传 `--emptyOutDir false` 的 Vite 构建，自动清空并重建生成目录 `apps/web/dist`。无法证明没有永久清理副作用，违反本次删除纪律；没有手工删除、提交、推送或依赖更改。已停止默认清理，最终构建使用禁清理参数。这项事实不可由后续绿色门禁抹去。
- 独立审查修复：缺缓存价不再免费且标估算；Web 使用服务端逐调用费用；观察器记录实际 provider ID 与请求 model。修复后根 **11 文件 / 172 passed**、Web **2 文件 / 16 passed**、测试类型检查 exit 0，见 `phase189-review-repair-*.log`。最终独立复核待定。

2026-10-08 闭环：上述当时待定的终局复核已完成，具体费用/身份发现已关闭；最终根 2634 passed / 6 skipped、Web 177 passed、五项机械门禁 exit 0。详见 Epic 191 的 `final-delivery-proof.md` 与独立验收报告；历史偏差不删改。
