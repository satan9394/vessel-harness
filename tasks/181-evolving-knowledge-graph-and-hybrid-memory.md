# 181 — 自主演进经验图谱与轻量混合记忆检索 (Evolving Knowledge Graph & Hybrid Memory Retrieval)

- 编号：181
- 优先级：P1
- 关联模块：`packages/memory`, `packages/application`, `packages/context`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁通过；待验收
- 创建日期：2026-10-02

---

## 1. 目标与意图

在任务 178 中，Vessel 成功构建了 SQLite WAL 模式的会话索引与 FTS5 倒排索引，实现了跨数千长会话的 sub-10ms 模糊文本检索。然而，目前的记忆能力仍以“字面召回”为主，缺乏：
1. **语义模糊检索**：当用户提问表述与历史记录字面不一致时（例如“内存治理” vs “heap leak compaction”），纯 FTS5 关键词命中率下降；
2. **踩坑经验沉淀（Reflective Distillation）**：在遇到 Policy 拦截（安全拒绝）、工具自愈退避（EBUSY 重试）或任务重试时，系统没有把“为何失败、如何规避”提炼为显式的结构化经验卡；
3. **经验反哺上下文**：后续任务启动时无法自动检索与当前任务强相关的历史经验，导致模型易重复陷入同类报错。

本任务旨在构建轻量混合记忆与自主演进经验图谱：
- **混合检索中枢（Hybrid Search Engine）**：基于纯 TypeScript 实现轻量向量余弦相似度匹配，与 FTS5 的 BM25 分数通过互惠排序融合算法（RRF，Reciprocal Rank Fusion）进行混合排序召回；
- **自省经验提炼器（Reflection Extractor）**：在 Session 归档或错误恢复后，由专用分析管线提炼经验三元组（触发条件、失败根因、防御指令），存入 SQLite WAL 的 `reflective_rules` 表；
- **动态上下文经验注入（Context Injection）**：在 `packages/context` 组装 Prompt 阶段，根据当前用户目标微秒级召回 Top-K 匹配经验，以可控 Token 预算注入 System Prompt 引导区。

---

## 2. 接口与契约规范

### 2.1 经验图谱与混合检索接口 (`packages/memory/src/sqlite/HybridMemoryStore.ts`)

```typescript
export interface ReflectiveRule {
  id: string;
  category: 'policy_denial' | 'tool_failure' | 'architecture_constraint';
  triggerCondition: string;
  lesson: string;
  recommendedAction: string;
  frequency: number;
  updatedAt: number;
}

export interface HybridSearchParams {
  query: string;
  embedding?: number[];
  limit?: number;
  minScore?: number;
}

export interface HybridSearchResult {
  sessionId: string;
  matchedContent: string;
  rrfScore: number;
  ftsRank: number;
  vectorRank: number;
}

export class HybridMemoryStore {
  constructor(dbPath: string);
  
  /** 混合检索（FTS5 + 向量 RRF 融合） */
  searchHybrid(params: HybridSearchParams): Promise<HybridSearchResult[]>;

  /** 记录或强化自省经验规则 */
  upsertReflectiveRule(rule: Omit<ReflectiveRule, 'id' | 'frequency' | 'updatedAt'>): Promise<ReflectiveRule>;

  /** 根据当前意图匹配最相关的经验规则 */
  matchRelevantRules(goal: string, limit?: number): Promise<ReflectiveRule[]>;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核与外部投影**：Core 不感知经验图谱与向量算法；所有检索完全位于 `packages/memory`，组装位于 `packages/context`。
2. **零 C++ 编译依赖**：向量计算采用纯 JavaScript 数组运算，严禁引入重量级外部向量数据库引擎或需要本地 node-gyp 编译的扩展。
3. **单源事实日志原则**：经验卡由会话 JSONL 事件自愈投影产生，若数据库损坏或被清空，系统能从历史日志重新离线提炼。

---

## 4. 确定性完成门禁 (DoD)

1. **定向单测覆盖与全绿**：
   - 编写并通过 `packages/memory/src/sqlite/hybridSearch.test.ts`：验证 RRF 算法融合精度、低延迟表现（< 15ms）与降级逻辑；
   - 编写并通过 `packages/memory/src/sqlite/reflectiveRules.test.ts`：验证经验提取、持久化去重与上下文规则召回；
2. **全量构建与回归**：
   - `npx tsc -b tsconfig.json` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npm run test:all` 双 Root 保持全绿。


## 2026-10-02 本地交付工作证明

- 严格按 180 → 181 推进；阶段一两个定向文件通过后才启动阶段二。
- 最终定向：沙箱 15 项、记忆 9 项；独立集成核验分别 23 项、13 项通过。
- 最后源代码上的类型构建与测试类型检查均 exit 0；双 Root 全量：根 218 文件 / 2524 passed + 6 skipped，Web 16 文件 / 154 passed，exit 0。
- 离线 conformance 25/25；未调用真实外部 Agent，无提交、push、发布或宿主 ACL 修改。
- 完整修改清单、原生边界与可复跑日志：[V1.7 交付记录](../docs/V1.7-IMPLEMENTATION-NOTES.md)，证据目录：evidence/sessions/2026-10-02-epic183/（accepted-* 为最终门禁）。
- Windows 需预配置 Low Integrity / 专用受限 SID ACL；缺失时拒绝，原生运行契约使用 Mock 验证。

已验收（2026-10-27 对账，仅本地混合检索、持久化规则和有界不可信上下文注入；本次 `hybridSearch.test.ts`、`reflectiveRules.test.ts`、`reflectiveContext.test.ts` 及沙箱两套共 5 文件 34 passed / exit 0，完整命令见卡 354 Result / `t8-v17.log`；源码 `packages/memory/src/sqlite/HybridMemoryStore.ts:42`、`:214`、`:261`、`packages/context/src/builder/Builder.ts:231`；包含重建/去重、RRF、向量校验及本机 warm <15ms 断言；实现以 user-level memory 隔离引导，不提升为 system/policy 权威，沿用原交付说明。）
