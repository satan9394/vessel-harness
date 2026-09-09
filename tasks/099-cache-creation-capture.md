# 099 — cache_creation 端到端采集（Anthropic cache write → 统计分项）

- 编号：099
- 状态：待执行
- 优先级：P1（补齐 089 记录的边界：入口已就绪但上游未上报）
- 创建日期：2026-09-08
- 关联：089（cdf1374：cacheWrite 三档计价 + 入口 `cacheCreationTokens?` 已就绪）；046（stream 契约）；050（after_model）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题

089 已实现 cache_creation 计价（`TokenPrice.cacheWrite` + `UsageStore.record(cacheCreationTokens?)` 三档回退），
但**上游未上报**：AnthropicProvider 的 usage 未把 `cache_creation_input_tokens` 传给 core `ChatUsage`，
因此该能力实际采集不到数据（089 卡边界"不改 core"所致）。本卡打通端到端。

## 验收标准（执行器逐条勾选）

- [ ] 摸清链路：AnthropicProvider（`packages/llm/src/provider/AnthropicProvider.ts`，含 stream 的 message_delta usage）
      → `ChatUsage` 类型（`packages/shared/src/provider.ts`）→ core AgentLoop `after_model` → UsageProjection /
      UsageStore。确认 cache 字段现缺在哪一环
- [ ] `ChatUsage` 增 `cacheCreationTokens?`（类型契约扩展，非新机制；OpenAI 系无此字段则缺省）
- [ ] AnthropicProvider 上报：非流式与**流式**（message_start/message_delta 的 `cache_creation_input_tokens`）都映射到
      `ChatUsage.cacheCreationTokens`（含 046 的 stream chunk usage 路径）
- [ ] 下游自动生效：`after_model` → UsageProjection/UsageStore 分项计价（089 已就绪，断言真实链路上报后
      `vessel usage` 出现 cacheWrite 分项）
- [ ] OpenAI 系（openai-compatible）不误报（无该字段 → undefined，不写 0 假值）；mock provider 可控注入
- [ ] 测试 ≥6 例：非流式上报/流式上报/OpenAI 缺省/分项计价/回归（现有 usage 测试不破）；`tsc -b` exit 0 +
      全量 vitest（root 980+ 无回归）+ web 74
- [ ] 文档同步（PRICING.md §10 的"待上游上报"更新为已打通；EVENT-SPEC 若涉及 usage 字段说明）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

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

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
