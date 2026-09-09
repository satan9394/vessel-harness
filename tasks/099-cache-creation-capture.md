# 099 — cache_creation 端到端采集（Anthropic cache write → 统计分项）

- 编号：099
- 状态：待验收
- 优先级：P1（补齐 089 记录的边界：入口已就绪但上游未上报）
- 创建日期：2026-09-08
- 关联：089（cdf1374：cacheWrite 三档计价 + 入口 `cacheCreationTokens?` 已就绪）；046（stream 契约）；050（after_model）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题

089 已实现 cache_creation 计价（`TokenPrice.cacheWrite` + `UsageStore.record(cacheCreationTokens?)` 三档回退），
但**上游未上报**：AnthropicProvider 的 usage 未把 `cache_creation_input_tokens` 传给 core `ChatUsage`，
因此该能力实际采集不到数据（089 卡边界"不改 core"所致）。本卡打通端到端。

## 验收标准（执行器逐条勾选）

- [x] 摸清链路：AnthropicProvider（`packages/llm/src/provider/AnthropicProvider.ts`，含 stream 的 message_delta usage）
      → `ChatUsage` 类型（`packages/shared/src/provider.ts`）→ core AgentLoop `after_model` → UsageProjection /
      UsageStore。确认 cache 字段现缺在哪一环
- [x] `ChatUsage` 增 `cacheCreationTokens?`（类型契约扩展，非新机制；OpenAI 系无此字段则缺省）
- [x] AnthropicProvider 上报：非流式与**流式**（message_start/message_delta 的 `cache_creation_input_tokens`）都映射到
      `ChatUsage.cacheCreationTokens`（含 046 的 stream chunk usage 路径）
- [x] 下游自动生效：`after_model` → UsageProjection/UsageStore 分项计价（089 已就绪，断言真实链路上报后
      `vessel usage` 出现 cacheWrite 分项）
- [x] OpenAI 系（openai-compatible）不误报（无该字段 → undefined，不写 0 假值）；mock provider 可控注入
- [x] 测试 ≥6 例：非流式上报/流式上报/OpenAI 缺省/分项计价/回归（现有 usage 测试不破）；`tsc -b` exit 0 +
      全量 vitest（root 980+ 无回归）+ web 74
- [x] 文档同步（PRICING.md §10 的"待上游上报"更新为已打通；EVENT-SPEC 若涉及 usage 字段说明）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只打通 cache_creation 采集链路（provider → 类型 → core 透传 → 统计）。不做 `input_token_semantics` 归一
  （另议）；不做 091/092 定价管理；不加新依赖。
- 薄核纪律：`ChatUsage` 只是类型契约加字段，**不给 core 加机制**。

## 涉及文件（指针，执行器自行精化）

- `packages/shared/src/provider.ts`（ChatUsage）
- `packages/llm/src/provider/AnthropicProvider.ts`（chat + stream usage 映射）+ `packages/llm/src/stream/parseAnthropic.ts`
- `packages/core/src/agent-loop/AgentLoop.ts`（after_model 已透传 usage，确认无需改）
- `packages/application/src/projections/UsageProjection.ts`、`apps/cli/src/usage/UsageStore.ts`（089 已就绪）
- `configs/pricing.json`（Anthropic cacheWrite 值，089 已补）

## 方法

- 先读链路确认缺口 → 加类型字段 → provider 双路径映射 → 用 mock/注入 provider 测端到端 → 全量验证

## 工作证明（执行器回填：链路取证/改动 diff/流式与非流式映射/测试输出，全部写进本文件，勿留对话里）

### 1. 链路取证 —— 缺口在「类型契约 + provider 映射 + 流式折叠」三处

逐环读过（089 之后的状态）：

| 环节 | 文件 | 089 后状态 | 缺口 |
| --- | --- | --- | --- |
| Anthropic 非流式 | `packages/llm/src/provider/AnthropicProvider.ts:262-266` | `usage` 已解析 `cache_read_input_tokens`，**没有** `cache_creation_input_tokens` | ✗ 缺映射（`AnthropicResponseBody.usage` 类型里其实已有该字段，只是没用） |
| Anthropic 流式 | `packages/llm/src/stream/parseAnthropic.ts:33-34,117-126` | `message_start.message.usage` 类型**不含** `cache_creation_input_tokens`；`anthropicUsageChunk()` 只映射 input/output/cacheRead | ✗ 类型 + 映射双缺 |
| 类型契约 | `packages/shared/src/provider.ts:54-58,80` | `ChatUsage` 与 `StreamChunk['usage']` 都只有 `cacheReadTokens?` | ✗ 缺字段 |
| core 流式折叠 | `packages/core/src/agent-loop/AgentLoop.ts:484-488` | usage chunk 逐字段 last-wins 折叠 input/output/cacheRead | ✗ 缺 cacheCreation 折叠（流式上报在此丢失） |
| core after_model | `packages/core/src/agent-loop/AgentLoop.ts:273,292` | `bus.emit('after_model', {..., usage: response.usage})` 直接透传 | ✓ 无需改 |
| 统计下游 | `UsageProjection.ts:77-78`、`UsageStore.record`（`cacheCreationTokens?`）、`compose.ts:303-313` | 089/090 已就绪，**本次零改动** | ✓ 无需改 |
| 价目 | `configs/pricing.json` / `configs/model-catalog.json` | 089 已补 `cacheWrite` | ✓ 无需改 |

结论：**缺口不在 core after_model，也不在统计层**，而在「Anthropic 双路径没上报 + 类型契约没字段 + 流式折叠没接」。

### 2. 改动清单（源码 5 处 + 测试 5 文件 + 文档 2 处）

源码：

- `packages/shared/src/provider.ts`：`ChatUsage` 增 `cacheCreationTokens?: number`（带契约注释：缺省 = 未上报，
  禁止写 0）；`StreamChunk` 的 `usage` 成员同步加该字段。
- `packages/llm/src/stream/parseAnthropic.ts`：`AnthropicEventData.message.usage` 补
  `cache_creation_input_tokens?`；`anthropicUsageChunk()` 形参补该字段并映射到 `cacheCreationTokens`。
- `packages/llm/src/provider/AnthropicProvider.ts`：非流式 `usage.cacheCreationTokens = data.usage?.cache_creation_input_tokens`。
- `packages/core/src/agent-loop/AgentLoop.ts`：`consumeStream()` 的 `case 'usage'` 增一行
  `if (chunk.cacheCreationTokens !== undefined) usage.cacheCreationTokens = chunk.cacheCreationTokens;`
  —— 这是**类型契约透传**（与相邻三行同形），不是新机制；不加此行则流式上报在 core 丢字段。
- `packages/llm/src/provider/MockProvider.ts`：`MockProviderOptions.usage?: ChatUsage` 可注入；`chat()`/`stream()`
  共用 `this.usage()`；流式 usage chunk 只带**实际有值**的字段（默认形状仍是 `{inputTokens,outputTokens}`，
  不给 undefined/0 补位）。

测试（新增 13 例，覆盖卡上要求的 5 类）：

- `packages/llm/src/provider/anthropic-provider.test.ts` +2：非流式映射 2095；wire 缺字段 → `undefined`（且断言 `not.toBe(0)`）。
- `packages/llm/src/stream/parseAnthropic.test.ts` +2：`message_start.message.usage.cache_creation_input_tokens` → chunk；
  `message_delta` 无该字段 → `undefined`（不 clobber 语义）。
- `packages/llm/src/provider/streamProvider.test.ts` +4：Anthropic SSE 两帧（message_start 带 2095 / message_delta 只带 output）
  逐帧断言；OpenAI `chat()` 与 `stream()` 均 `undefined`；MockProvider 注入生效 + 默认形状无补位键。
- `packages/core/src/agent-loop/AgentLoop.stream.test.ts` +1：三帧 usage 折叠后 `model_stream_end.usage` 与
  `after_model.usage` 都含 `cacheCreationTokens: 2095`（回归：原 4 字段用例不变）。
- `apps/cli/src/usage/cache-creation-e2e.test.ts` **新增 4 例**（端到端）：MockProvider（注入 usage）→ 真实 AgentLoop
  → `after_model` → UsageProjection + UsageStore 双路径：
  ① UsageStore `totals().cacheCreationTokens === 2095` 且 `costBreakdown.cacheWriteUsd = 2095/1M×3.75`（explicit 档，
  `cacheWriteDerivedCostUsd === 0`）；② UsageProjection 同额分项、`cacheWritePriceSource === 'explicit'`、两条路径
  `costUsd` 相等；③ 无该字段 → 分项 0、成本不含写入（不误报）；④ 默认 mock（100/20）回归。

文档：

- `docs/PRICING.md` §10：删「尚未接通」，新增 §10.1 记录链路、message_start/message_delta 语义、undefined 不写 0、mock 注入。
- `docs/EVENT-SPEC.md` A09 实现注记：补 usage 折叠字段即 `ChatUsage` 契约（含 `cacheCreationTokens` 的合并语义）。

### 3. 流式 / 非流式映射细节

- **非流式**：`POST /v1/messages` → `data.usage.cache_creation_input_tokens` → `ChatResponse.usage.cacheCreationTokens`
  （与 `cache_read_input_tokens` 同形，不做 `?? 0`）。
- **流式**：Anthropic 只在 `message_start.message.usage` 里报 `cache_creation_input_tokens`；`message_delta.usage` 只带
  `output_tokens`。`anthropicUsageChunk()` 对两帧都产出 usage chunk，但 delta 帧的 `cacheCreationTokens` 是 `undefined`，
  `AgentLoop` 逐字段 last-wins 折叠时 `!== undefined` 才赋值 → **前一帧的 2095 不会被清掉**（新增用例显式断言两帧取值）。
- **OpenAI 系**：`prompt_tokens_details.cached_tokens` 是**读**侧，无写侧概念 → 字段缺省，不补 0。

### 4. 验证输出（本机 Windows / Node v24）

```
$ npx tsc -b tsconfig.json
EXIT=0

$ npx vitest run packages/llm/src/stream/parseAnthropic.test.ts packages/llm/src/provider/anthropic-provider.test.ts \
    packages/llm/src/provider/streamProvider.test.ts packages/core/src/agent-loop/AgentLoop.stream.test.ts \
    apps/cli/src/usage/cache-creation-e2e.test.ts
 ✓ parseAnthropic.test.ts (9)  ✓ anthropic-provider.test.ts (10)  ✓ streamProvider.test.ts (12)
 ✓ AgentLoop.stream.test.ts (11)  ✓ cache-creation-e2e.test.ts (4)
 Test Files 5 passed (5) | Tests 46 passed (46)   EXIT=0

$ npx vitest run            # 根仓库全量
 Test Files  1 failed | 95 passed (96)
      Tests  1 failed | 995 passed | 1 skipped (997)
 失败项 = packages/runtime/src/sandbox/backend/process-tree.test.ts
   "real Windows timing-window enumeration > attaches a pre-spawned grandchild into the job and enumerates it"
   Error: Test timed out in 30000ms.（已知 process-tree 时序 flaky，基线即记录在案）

$ npx vitest run packages/runtime/src/sandbox/backend/process-tree.test.ts   # 单跑复现
 ✓ 11 passed (11)  EXIT=0   → 确认是并发负载下的 30s 超时，非本卡回归（本卡未触碰 runtime/sandbox）

$ cd apps/web && npx vitest run
 Test Files 8 passed (8) | Tests 74 passed (74)   EXIT=0
```

对比基线：root 由 980 passed + 1 skipped → 995 passed + 1 skipped（新增 13 例 + 期间其他卡入账），
唯一失败项是既知 flaky 且单跑通过；web 74 不变；`tsc -b` exit 0。

### 5. 范围边界 / 踩坑

- **未做（守边界）**：`input_token_semantics` 归一（cache 写入不从 inputTokens 扣减，与 090 一致）；
  091/092 定价管理；GUI 侧展示（`apps/web/src/components/UsageBar.tsx`、`apps/local-server` 的 `usage` SSE
  仍只有 cacheRead —— 属展示层，未纳入本卡，建议另开小卡）。
- **薄核纪律**：core 只加 1 行字段折叠（同一 switch 内、与相邻三行同形），无新 import、无新机制、无跨层依赖。
- **踩坑**：`MockProvider` 默认 usage 必须保持 `{inputTokens,outputTokens}` 两键——`AgentLoop.stream.test.ts:216`
  与 `streamProvider.test.ts:170` 用 `toEqual` 断言整体形状，补 undefined 键虽被 `toEqual` 容忍，但会让
  「有没有上报」的语义变模糊，故流式 chunk 用条件展开只放有值字段。
- 环境：全量 vitest 走后台 job 一次跑完（无 EPERM/spawn 问题）；未使用任何永久删除命令。
- 提交：见本卡末尾「提交」行。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
