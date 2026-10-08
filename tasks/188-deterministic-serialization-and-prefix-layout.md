# 188 — 请求负载确定性序列化与前缀三段式分层 (Deterministic Canonical Serialization & Tripartite Prefix Layout)

- 编号：188
- 优先级：P1
- 关联模块：`packages/llm`, `packages/context`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验收（2026-10-08，Epic 191 终局门禁与独立复核闭环）
- 创建日期：2026-10-07

---

## 1. 目标与意图

在天枢（Tianshu Harness）的深度研报（`docs/research/TIANSHU-AND-MODS-INTEGRATION-OUTLOOK.md`）中，前缀缓存工程实现了 98–99% 的 KV Cache 命中率，为长周期自主 Agent 节省了 90–95% 的 Token 成本并显著压降首字生成延迟（TTFT）。

在 Vessel 现行架构中，存在两项隐式击穿缓存的关键缺陷：
1. **对象键序列非确定性（Key Ordering Jitter）**：JavaScript V8 引擎在对象序列化（`JSON.stringify`）时，由属性插入顺序决定键顺序。不同轮次动态构建的 Tool Schemas 与请求元数据对象容易产生字节流微小差异，导致大模型网关的 KV Cache 完全失效；
2. **前缀布局混杂与微回合抖动**：易变的动态工具结果或反思规则若直接插在系统提示词前半部，会导致后续所有静态指令的 Cache 整体失效；同时，如果在 Tool Use 内部微回合（Micro-turns）触发历史压缩（Compaction），会彻底摧毁上一轮已经建立的缓存前缀。

本任务旨在建立**前缀缓存经济学基座**：
1. **确定性规范序列化（Canonical JSON Serialization）**：实现深度递归键排序与数值规范化（`canonicalJson` / `stableStringify`），应用于所有 Tool Schema 注入与请求载荷；
2. **前缀三段式分层架构（Tripartite Prefix Architecture）**：
   - `stablePrefix`（跨会话/轮次持久复用）：系统核心角色定位、绝对架构红线、静态工具 Schema 签名；
   - `scopedPrefix`（会话级相对稳定）：项目级约束规约（`AGENTS.md` / `HANDOFF.md`）、已持久化经验规则（`ReflectiveRule`）；
   - `volatileSuffix`（轮次易变后缀）：当前微回合动态工具输出、临时文件快照与增量消息；
3. **上下文压缩边界硬守卫（Compaction Boundary Guard）**：确保历史压实仅在用户新意图回合边界（`turnIndex === 0`）触发，严禁在微回合内部重写历史破坏前缀。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 确定性序列化 (`packages/llm/src/canonical/canonicalJson.ts`)

```typescript
export function canonicalJson(value: unknown): string;
export function stableStringify(value: unknown): string;
```
- 对所有对象键按 Unicode 码点升序深度递归排序；
- 对浮点数与特殊字符遵循 RFC 8785 (JSON Canonicalization Scheme) 规范化；
- 保证相同的逻辑数据结构必然生成 100% 字节一致的 JSON 文本。

### 2.2 前缀三段式构建器 (`packages/context/src/builder/TripartitePrefixBuilder.ts`)

```typescript
export interface TripartitePrefixOptions {
  coreRoleInstructions: string;
  architectureConstraints: string[];
  toolSchemas: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  projectRules?: string;
  reflectiveLessons?: string[];
  ephemeralContext?: string;
}

export interface TripartitePrefixResult {
  stablePrefix: string;
  scopedPrefix: string;
  volatileSuffix: string;
  fullPrompt: string;
  prefixByteHash: string; // SHA-256 of stablePrefix for cache monitoring
}

export class TripartitePrefixBuilder {
  build(options: TripartitePrefixOptions): TripartitePrefixResult;
}
```

### 2.3 压缩边界守卫 (`packages/context/src/compaction/CompactionBoundaryGuard.ts`)

```typescript
export class CompactionBoundaryGuard {
  static canTriggerCompaction(state: {
    turnIndex: number;
    hasPendingToolCalls: boolean;
    activeMicroTurn: boolean;
  }): boolean;
}
```
- 仅当 `turnIndex === 0` 且 `hasPendingToolCalls === false` 且 `activeMicroTurn === false` 时返回 `true`；微回合内一律返回 `false`。

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：`packages/core` 保持 0 侵入，序列化与前缀组装完全在 `packages/llm` 与 `packages/context` 完成；
2. **确定性测试**：编写严格的打乱键序测试，验证无论对象以何种属性顺序传入，`canonicalJson` 输出均完全一致；
3. **包管理器铁律**：锁定 npm，严禁引入第三方外部重型序列化库，纯 TS 紧凑实现。

---

## 4. 完成门禁 (DoD)

1. 定向测试全绿：
   - `npx vitest run packages/llm/src/canonical/canonicalJson.test.ts`
   - `npx vitest run packages/context/src/builder/TripartitePrefixBuilder.test.ts`
   - `npx vitest run packages/context/src/compaction/CompactionBoundaryGuard.test.ts`
2. 类型检查通过：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0

## 阶段交证（2026-10-07）

- canonical 实现位于 llm，context 使用已声明的内部 workspace 依赖与 project reference；未引入第三方依赖。独立评审指出早期 shared 归属不符合本卡 §3.1，已迁回指定外层模块。
- 实际请求链覆盖 OpenAI、Anthropic、OpencodeGo；ContextBuilder 三段布局与稳定字节哈希接线，项目快照跨压缩保留，反思经验按意图冻结。
- 主会话与隔离子会话 pressure/overflow 压缩统一受边界守卫约束；core 零改动。
- RFC 8785 使用 UTF-16 键排序；数值、Unicode、非法输入和键序抖动均有测试。
- 专项 **5 文件 / 45 passed**；上下文/供应商回归 **16 文件 / 163 passed**；`tsc -b`、`typecheck:tests` exit 0。
- 原始输出：`evidence/sessions/2026-10-07-v2.1/phase188.log`、`phase188-regression.log`。最终门禁由 Epic 191 统一执行。
- 架构修复后专项 **45 passed**、相关回归 **182 passed**，构建与测试类型检查 exit 0；证据 `phase188-architecture-repair*.log`。context/agents 内部 llm 依赖与 package-lock 已离线同步；最终 `npm ci` 门禁将保留旧 node_modules 后执行，避免自动删除。
