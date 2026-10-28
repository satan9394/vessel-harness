# 170 — 动态自适应上下文压实与 400 溢出自愈防线 (Adaptive Compaction & Overflow Self-Healing)

- 编号：170
- 优先级：P1
- 关联模块：`packages/context`, `packages/core`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地交付与全部门禁完成；待用户验收，Git 未提交
- 创建日期：2026-10-01

---

## 1. 目标与意图

在长会话与大并发任务中，既有的静态比例压实（如单纯按固定记录比或粗糙的 `0.8 * contextWindow`）存在致命缺陷（详见 `docs/research/DSH-DESKTOP-AND-TEAMS.md`）：
1. **忽略最大输出空间与安全缓冲**：未预留单次回合生成的最大输出 Token（$O$）与工具调用缓冲区（$B$），导致压实触发线高于模型上游网关真实的物理墙；
2. **忽略中文 CJK 词元膨胀死区**：CJK 字符常导致实际 Token 数比英文分词多出 1.3 倍左右，导致客户端计算的 Token 计数严重低估；
3. **HTTP 400 溢出直接崩溃**：当上下文意外触及上游硬限制时，系统将其判定为普通网络异常抛出中断，导致耗时数小时的长任务前功尽弃。

本任务旨在建立工业级两道防线：
- **第一道防线（主动自适应压实）**：落地动态阈值公式 $\lfloor \min(W \times 0.8, W - O - B) \rfloor$，并结合 CJK 词元保守校准系数；
- **第二道防线（400 溢出模式拦截与自愈重试）**：在 LLM 调用层通过正则捕获主流大模型供应商的 Context Overflow 错误，将其自动降级为紧凑压实事件并无缝重试（`maxOverflowRetries: 1`）。

---

## 2. 接口与契约规范

### 2.1 自适应压实阈值计算器 (`packages/context/src/compaction/adaptiveThreshold.ts`)

```typescript
export interface AdaptiveCompactionOptions {
  /** 模型声明的上下文窗口大小（如 1,000,000 或 200,000） */
  contextWindow: number;
  /** 单次调用允许的最大输出 Token 数（如 65,536 或 4,096） */
  maxOutputTokens: number;
  /** 安全缓冲垫（默认 65,536，用于吸收工具输出与思维链激增） */
  safetyBufferTokens?: number;
  /** CJK 场景下的安全保守系数（默认 0.85，抵御 CJK 膨胀死区） */
  cjkSafetyRatio?: number;
}

/**
 * 计算动态主动压缩触发线：
 * Threshold = floor(min(CalibratedW * 0.8, CalibratedW - MaxOutput - SafetyBuffer))
 */
export function computeAdaptiveThreshold(opts: AdaptiveCompactionOptions): number;
```

### 2.2 多厂商 400 溢出正则模式与分类器 (`packages/context/src/compaction/overflowClassifier.ts`)

```typescript
export const CONTEXT_OVERFLOW_PATTERNS: RegExp[] = [
  /longer than the model's context length/i,
  /maximum context length/i,
  /context window exceeded/i,
  /prompt is too long/i,
  /token limit exceeded/i,
  /max_tokens.*exceeded/i,
  /too many tokens/i,
];

/**
 * 判定错误是否属于上下文超限溢出错误
 */
export function isContextOverflowError(error: unknown): boolean;
```

### 2.3 溢出自愈重试契约与事件流

在触发 400 溢出并捕获成功时：
1. 记录事件 `compaction:overflow_intercepted` 到 EventBus，标记当前已尝试重试次数；
2. 触发紧急高压实模式（`retainRatio: 0.3`），将最旧的历史记录压缩为紧凑摘要；
3. 允许重试当前 Turn（上限 1 次），若二次溢出则抛出终极异常，严禁死循环。

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：算法与正则逻辑位于 `packages/context` 中，`packages/core` 仅通过注入的决策接口或已有的 EventBus 事件消费，严禁在 core 中直接引入特定 HTTP 状态码枚举或硬编码正则。
2. **严禁调用真机模型**：所有测试用例必须基于 Mock LLM 抛出确定的错误消息（如 `HTTP 400 The input is longer than the model's context length`）进行验证。
3. **零回退与类型安全**：所有新建模块必须导出完整 `.d.ts`，`npx tsc -b` 与 `npm run typecheck:tests` 零报错。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `packages/context/src/compaction/adaptiveCompaction.test.ts`：
     - 验证公式在不同 $W, O, B$ 组合下的精确计算；
     - 验证 CJK 保守系数对死区的压制效果（确保阈值严格小于实际物理墙）；
     - 验证正则白名单对 OpenAI、Anthropic、DeepSeek、Google 等主流报错文本的 100% 覆盖；
     - 验证捕获溢出后的压实与重试机制（重试成功继续，超限安全终止）。
2. **回归门禁**：
   - `npx vitest run packages/context` 全部通过；
   - `npx tsc -b tsconfig.json` exit 0。

## 5. 实施与工作证明（2026-10-01）

- `adaptiveThreshold.ts` 实现精确预算公式与默认 CJK `0.85`、缓冲 `65,536`；非法预算抛出 `RangeError`。预算耗尽时保留公式的负阈值（对非负 token 估算立即触发），不采用研究伪代码中的 `1000` 上抬下限。小窗口可显式配置 `compactionBudget.safetyBufferTokens`。
- `overflowClassifier.ts` 白名单覆盖字符串、SDK `status`/`statusCode` 与嵌套 `error.message/code`；明确上下文溢出允许附带输出预算说明，429/TPM 限流及纯输出参数错误不误压实。缺少上下文语义的 `token limit exceeded` / `too many tokens` 仅在显式状态 400 下识别。
- `overflowRecovery.ts` 统一两处生产组合根（`application/compose`、`agents/subagent/IsolatedRuntime`）的注入恢复；Core 不依赖 Context 或供应商正则。当前逻辑请求最多恢复一次，压实采用 `retainRatio: 0.3`，重建实际模型请求；主动压实后同样重新组装，修复此前返回旧 envelope 的问题。
- 紧凑 `compaction:overflow_intercepted` 事件先持久后广播，仅含请求 ID / 重试次数；重试前刷新 `request/header` 与上下文计数。流式已透出文本、思考或工具增量后拒绝重放，防止重复显示或工具执行。
- 正常压实保留既有 `0.16` 尾部比例与工具调用/结果配对边界。失败终止沿用 AgentLoop 既有抛错契约（并非伪造成功回合）。
- 无依赖安装、网络请求、真实 Agent、提交或删除用户数据；测试仅清理自己创建的系统临时目录。

验证（最后一次源码编辑后）：

- `npx vitest run packages/context packages/core/src/agent-loop packages/agents/src/subagent/subagent.test.ts packages/application/src`：33 文件，287 passed + 2 skipped，exit 0；新定向文件包含 29 项测试。
- `npx tsc -b tsconfig.json`：exit 0。
- `npm run typecheck:tests`：exit 0。
- Epic 双 Root 全量测试与 Web 构建由任务 174 统一执行并记录。

独立审查修复（最后一次修复后重新验证）：

- 注入纯分类谓词 `modelErrorRecovery.isOverflowError`；已判定上下文溢出在恢复额度耗尽或流式已有输出时直接走终止记录，禁止通用网络重试扩大一次恢复额度。测试采用默认 `llmRetry` 与带 `150000` 的真实错误文案，防止通用 `5xx` 分类误识别 token 数的回归。
- 输出预算优先级为显式 `compactionBudget` → 已生效 Provider 的 `defaultMaxOutputTokens` → `4096`，阈值与请求共用同一预算，保留供应商已有默认值。隔离运行时测试验证默认 `8192` 与显式 `4096` 的请求字段及主动压实差异。
- `npx vitest run packages/context packages/core/src/agent-loop packages/agents/src/subagent/subagent.test.ts`：18 文件 / 139 passed，exit 0。
- `npx tsc -b tsconfig.json` 与 `npm run typecheck:tests`：均 exit 0。

已验收（2026-10-27 对账，仅本地确定性功能：动态阈值/CJK 校准、溢出识别、单次恢复及重复溢出终止；本次 `node node_modules/vitest/vitest.mjs run packages/context/src/compaction/adaptiveCompaction.test.ts packages/tools/src/mcp/boundedStdio.test.ts packages/tools/src/mcp/lazyProxy.test.ts apps/cli/src/mcp/mcpCommands.test.ts packages/application/src/mcp/connections.test.ts` exit 0，58 passed + 2 skipped；源码 `packages/context/src/compaction/adaptiveThreshold.ts:8`、`packages/context/src/compaction/overflowRecovery.ts:15`；原始日志与逐卡映射见卡 354 Result，不代表本次重跑历史全门禁。）
