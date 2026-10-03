# 186 — 会话后自主反思与经验提炼引擎 (Post-Session Autonomous Reflection Engine)

- 编号：186
- 优先级：P1
- 关联模块：`packages/memory`, `packages/context`, `packages/engine`, `packages/application`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：待执行
- 创建日期：2026-10-03

---

## 1. 目标与意图

在任务 181 中，Vessel 落地了 `HybridMemoryStore` 和 `ReflectiveRule` 经验规则容器，并在 Prompt 上下文组装阶段实现了 RRF 混合检索引导注入。
但目前的经验规则主要依赖外部直接灌入或测试用桩写入，缺乏一个**全生命周期自动触发的经验沉淀飞轮**。

当 Agent 在长会话中经历了以下过程：
1. 触碰了 Policy 安全红线被 Deny，随后修正了命令；
2. 工具执行抛出异常（如权限拒绝、参数错误、环境路径缺失），经过 1~2 次重试后成功修复；
3. 架构约束检测（如 Thin Core 检查、Clean-room 违规）被 Evaluator 打回并修正。

如果这些珍贵的避坑经验随会话结束而烟消云散，那么在下一个会话中 Agent 依然可能重蹈覆辙。

本任务旨在构建**会话后轻量自省与反思提炼引擎（Post-Session Reflection Engine）**：
1. **反思事件收集器（Failure & Recovery Collector）**：在 Session 生命周期中自动聚合带有「失败-修复」配对特征的事件序列；
2. **轻量提炼规则生成器（Reflective Rule Synthesizer）**：通过纯确定性特征提取或轻量 Evaluator 模型，将复杂的错误轨迹压缩为结构化 `ReflectiveRule`；
3. **经验去重与衰减演进机制**：相同 triggerCondition 的规则自动递增命中频次 `frequency` 并更新 `updatedAt`，超过一定老化阈值或与新规则冲突时支持自然合并；
4. **非阻塞异步写入**：反思引擎在 Session 结束或 Turn 间隙异步后台执行，完全不阻塞主 Agent 回复与用户交互。

---

## 2. 接口契约规范 (Interface-First)

请在 `packages/memory/src/reflection/` 落地实现并导出：

```typescript
export interface SessionTrajectoryEvent {
  type: 'policy_denial' | 'tool_failure' | 'evaluator_reject';
  trigger: string;
  errorDetail: string;
  remedyAction?: string;
  resolved: boolean;
}

export interface ReflectionOptions {
  minSeverity?: number;
  autoPersist?: boolean;
}

export class AutonomousReflectionEngine {
  constructor(private memoryStore: HybridMemoryStore);

  extractLessonsFromTrajectory(events: SessionTrajectoryEvent[]): Promise<Omit<ReflectiveRule, 'id' | 'frequency' | 'updatedAt'>[]>;
  processSessionEnd(sessionId: string, events: SessionTrajectoryEvent[], options?: ReflectionOptions): Promise<ReflectiveRule[]>;
}
```

---

## 3. 架构红线与禁做铁律 (必须遵守)

1. **薄核纯净性**：反思引擎作为 `packages/memory` 的扩展组件，严禁侵入 `packages/core`；
2. **确定性优先与离线安全**：规则提炼默认优先采用基于正则/模式提取的确定性分析器，在没有 LLM 介入时亦能高保真提取 Policy 与 Tool 错误；测试严禁打真实公网或外部 Agent；
3. **回收站纪律**：严禁硬删除；
4. **包管理器锁定**：保持 npm 纯净。

---

## 4. 完成门禁 (DoD)

1. 定向测试通过：
   - `npx vitest run packages/memory/src/reflection/autonomousReflection.test.ts`
2. 类型构建通过：
   - `npx tsc -b tsconfig.json` (exit 0)
   - `npm run typecheck:tests` (exit 0)
3. 全量回归测试双 Root 保持全绿：
   - `npm run test:all`
