# 任务卡 217：Event Log 投影契约形式化与 Compaction 守恒断言 (Session Projection Contracts & Compaction Conservation)

**状态**：就绪待执行（2026-10-12）  
**负责人**：Codex (Medium/High 思考深度)  
**模式**：standard（一卡一闭环，交证即停）  
**Source**：VESSEL-ARCH-2026-01（ARC-01 与 ARC-09）  
**Risk**：low（纯契约与上下文层加固，`packages/core` 变动严格为 0）  
**前置基线**：HEAD `520492d`（V2.6、Card 215、Card 216 之后）  
**交付证据**：本卡验收记录 + 定向测试 + 门禁实测结果  

---

## 1. 目标与背景

依据架构整改规范 `docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md`（ARC-01 与 ARC-09）：
1. **解耦日志与投影**：形式化区分物理不可变追加事件（Event Log）与模型可见的动态视图（Session Projection），杜绝“原地修改历史”的概念模糊；
2. **Compaction 守恒断言**：在上下文压缩阶段落地形式化守恒定律（Conservation Laws），硬性防止压缩丢失任务目标（Goal）、关键安全拒绝事件（Policy Deny）与孤儿工具调用。

---

## 2. 交付范围与接口契约

### 2.1 packages/shared：形式化 Projection 契约

在 `packages/shared/src/projection.ts`（并在 `packages/shared/src/index.ts` 导出）：

```typescript
export interface SessionProjection {
  readonly sessionId: string;
  readonly revision: number;
  readonly lastEventId: string;
  readonly lastEventSequence: number;
  readonly visibleMessages: readonly unknown[];
  readonly summary?: string;
  readonly compactedRanges: readonly {
    readonly startSeq: number;
    readonly endSeq: number;
    readonly summary: string;
  }[];
  readonly tokenEstimate: number;
  readonly updatedAt: string;
}

export interface CompactionConservationCheckInput {
  readonly originalMessages: readonly {
    role: string;
    content: unknown;
    toolCalls?: unknown[];
    toolCallId?: string;
    metadata?: Record<string, unknown>;
  }[];
  readonly compactedMessages: readonly {
    role: string;
    content: unknown;
    toolCalls?: unknown[];
    toolCallId?: string;
    metadata?: Record<string, unknown>;
  }[];
  readonly preservedGoalPrefix?: string;
  readonly requiredDenialEventIds?: readonly string[];
}
```

### 2.2 packages/context：Compaction 守恒断言函数与异常

在 `packages/context/src/compaction/assertCompactionConservation.ts`：

```typescript
export class CompactionConservationError extends Error {
  constructor(
    public readonly violationType: 'goal_lost' | 'denial_lost' | 'orphaned_tool_call' | 'orphaned_tool_result',
    message: string
  ) {
    super(`Compaction conservation violation [${violationType}]: ${message}`);
    this.name = 'CompactionConservationError';
  }
}

export function assertCompactionConservation(input: CompactionConservationCheckInput): void;
```

**断言法则（Conservation Rules）**：
1. **Goal 守恒**：若原始输入有系统/首条用户任务目标标识，压缩后结果的首条消息必须完整包含该目标前缀或摘要声明；
2. **安全拒绝守恒**：若传入 `requiredDenialEventIds`，压缩后的可见消息或元数据摘要中必须保留对这些拒绝事件的引用，不得将其静默丢弃；
3. **工具配对完整性**：压缩后保留的消息中，任何带有 `toolCalls` 的助手消息，其引用的 `toolCallId` 必须在后续存在对应的工具结果；反之，任何工具结果消息必须在其前序消息中存在对应的调用。

---

## 3. Not Doing / 红线约束

1. **薄核零侵入**：`packages/core` 行修改必须严格为 0；
2. **纯本地开发**：严禁 `git push`，严禁向 npm 发布包；
3. **删除铁律**：除测试自建自理的 `os.tmpdir()` 临时目录外，严禁彻底删除任何文件；
4. **依赖锁定**：包管理器严格锁定 npm，严禁引入非 npm 锁文件；
5. **双 Root 门禁**：测试必须跑通 `npm run test:all`（根 + `--root apps/web`）。

---

## 4. Acceptance Criteria (DoD)

- [ ] `packages/shared/src/projection.ts` 声明并导出上述接口，`packages/shared` 类型编译无报错；
- [ ] `packages/context/src/compaction/assertCompactionConservation.ts` 实现三条守恒定律；
- [ ] `packages/context/src/compaction/assertCompactionConservation.test.ts` 包含全部正面守恒用例与三类违规异常抛出用例；
- [ ] 定向测试 `npx vitest run packages/context/src/compaction/assertCompactionConservation.test.ts` 100% 通过；
- [ ] 全量门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run test:all` 均 exit 0；
- [ ] `git diff --stat packages/core` 变动行数严格为 0。

---

## 5. 验证命令

```powershell
npx vitest run packages/context/src/compaction/assertCompactionConservation.test.ts
npx tsc -b tsconfig.json
npm run typecheck:tests
npm run test:all
git diff --stat packages/core
```


## 2026-10-27 对账（卡 355）

已被 217（217-architecture-improvement-plan-implementation.md）/236/244/247 取代（2026-10-27 对账）。这是同号旧草稿，不是另一张已验收的 architecture 卡。architecture 卡 Result 已交付 SessionProjection 与压缩守恒；236 补状态真实性，244 是副作用日志故障注入证据（不冒充 compaction 实现），247 补 keepID 守恒。现行 shared/src/projection.ts:22-113 与 context/src/compaction/assertCompactionConservation.ts:13-71 包含契约、追加投影及 goal/denial/tool-pair/keepID 守恒；本次 projectionCommit.test.ts 与 assertCompactionConservation.test.ts 纳入 9 文件 / 121 passed、exit 0。旧草稿不再作为待执行接口合同。
