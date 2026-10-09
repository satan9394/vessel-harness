# 198 — 变更影响面自适应上下文剪枝 (Impact-Driven Adaptive Context Pruning)

- 编号：198
- 优先级：P1
- 关联模块：`packages/context`, `packages/behavior`, `packages/runtime`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：实现完成，19/19 定向测试、构建与测试类型门禁通过；Epic 全量门禁待 197 性能恢复
- 创建日期：2026-10-08

---

## 1. 目标与意图

在大型多轮自主编码任务中，上下文管理面临两大矛盾：
1. **注意力分散与 Token 浪费**：Agent 在排查过程中阅读的大量辅助文件和长日志持续堆积在 Context Window 中，使关键逻辑信噪比骤降；
2. **缓存雪崩**：粗暴地截断或滚动删除历史消息，会直接破坏 KV Cache 的稳定前缀，导致每次推理都要全额重算。

本任务旨在建立 **Vessel 原生变更影响面自适应上下文剪枝机制（Impact-Driven Context Pruning）**：
- **依赖拓扑引导的影响半径（Blast Radius）分析**：
  - 结合 Git 改动状态与任务 197 的 AST 符号依赖图，计算当前活跃代码的“一级修改文件”与“二级接口依赖”；
- **分层保真度动态修剪（Hierarchical Pruning）**：
  - **Tier 1 (核心活跃区)**：处于影响半径内的文件保留完整内容与精确 Diff；
  - **Tier 2 (弱相关支撑区)**：保留对外导出符号签名（AST Skeleton），剔除内部具体实现行；
  - **Tier 3 (归档背景区)**：长工具输出与历史无关探索转化为轻量结构化摘要（Hash + 结论一句话）；
- **三段式前缀与 KV Cache 零破坏**：
  - 剪枝动作严格限定在动态交互尾部（Dynamic Turns），静态前缀与任务定义区绝对不可变。

---

## 2. 接口契约规范 (Interface-First)

### 2.1 剪枝器与影响分析类型定义 (`packages/context/src/pruning/types.ts`)

```typescript
export interface BlastRadius {
  modifiedFiles: string[];       // Git 变动文件
  directDependencies: string[];  // 依赖图谱一级关联文件
  unrelatedFiles: string[];      // 会话中曾加载但脱离影响半径的文件
}

export interface ContextPruneOptions {
  tokenThreshold: number;        // 触发自适应剪枝的 Token 上限 (e.g. 32000)
  targetTokenBudget: number;     // 剪枝目标水位线 (e.g. 20000)
  preserveRecentTurns: number;   // 尾部强制保留的原生轮数 (Default: 3)
}

export interface PrunedContextResult {
  prunedTokenCount: number;
  originalTokenCount: number;
  blastRadius: BlastRadius;
  prunedTurnsSummary: Array<{
    turnIndex: number;
    action: 'skeletonized' | 'summarized' | 'retained';
  }>;
}

export interface IAdaptiveContextPruner {
  /** 根据当前工作区变更与符号依赖图，计算爆炸半径 */
  computeBlastRadius(modifiedFiles: string[]): Promise<BlastRadius>;

  /** 执行自适应上下文剪枝，输出修剪后的安全上下文 */
  prune(messages: unknown[], options: ContextPruneOptions): Promise<{ messages: unknown[]; result: PrunedContextResult }>;
}
```

---

## 3. 验收标准与测试用例 (DoD)

1. **单元测试 (`packages/context/tests/pruning/adaptivePruning.test.ts`)**：
   - 用例 1：模拟加载了 20 个文件的超长上下文，触发剪枝后，非影响半径文件的实现体被压缩为 AST Skeleton，Token 占用下降 ≥ 40%；
   - 用例 2：验证核心变动文件的实现与最近 3 轮交互内容 100% 完整无损，无截断或乱序；
   - 用例 3：前缀哈希断言：验证剪枝操作前后，三段式前缀的 SHA-256 哈希值完全一致（KV Cache 零破坏）。
2. **机械门禁**：
   - `npm run test:all` 与 `npm run typecheck:tests` 全部通过。

## 4. 交付指针（2026-10-08）

实现与历史失败见 `evidence/sessions/2026-10-08-v2.3/card198-proof.md`；最终修复与 19/19 scoped、`tsc -b` / `typecheck:tests` exit 0 见 `card198-acceptance-repair-proof.md`。测试覆盖 ≥40% Token 降低、静态/任务字节不变、最近三轮、错误及未完成调用、箭头函数签名与原始 Diff 保留。独立评审记录 `review198.md`，修复复核另见 `review198-resolution.md`。Card 199 全量双 Root 和 Web 门禁尚未执行，不宣称 Epic 已完成。
