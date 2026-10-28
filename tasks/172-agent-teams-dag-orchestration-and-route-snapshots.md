# 172 — Agent-Teams 反应式 DAG 编排拓扑与队员模型快照隔离 (Agent-Teams DAG & Route Snapshotting)

- 编号：172
- 优先级：P1
- 关联模块：`packages/agents`, `packages/shared`, `packages/application`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地交付与全部门禁完成；待用户验收，Git 未提交
- 创建日期：2026-10-01

---

## 1. 目标与意图

在多 Agent 协同体系中，Vessel 既有的 `TeamRuntime`（任务 057）主要基于固定的线性阶段节拍（`orchestrator` $\to$ `generator` $\to$ `evaluator`），在面对复杂研发工程时存在显著局限（详见 `docs/research/DSH-DESKTOP-AND-TEAMS.md`）：
1. **无法表达非线性依赖**：现实工程中多个互不依赖的模块应当并发生成，再汇聚到集中评估节点；线性节拍无法支持复杂 DAG（有向无环图）拓扑；
2. **缺乏方案预审门禁（Approve & Run）**：编排阶段直接启动执行并消耗 Token，用户无法在团队正式开跑前预览 Roster 分工与 DAG 步骤并进行干预；
3. **队员模型路由漂移（Route Drift）**：当系统全局默认模型或队长模型发生切换时，若队员模型引用的是动态指针，将导致执行中途的异步队员模型风格、思考深度与上下文窗口发生剧烈漂移，引发 Prompt 不匹配与指令理解偏离。

本任务旨在借鉴 DSH Agent-Teams 的核心机制，为 Vessel 注入工业级团队编排能力：
- **反应式 DAG 调度引擎**：定义显式任务状态机（`pending` $\to$ `ready` $\to$ `claimed` $\to$ `running` $\to$ `completed` / `failed`），基于事件驱动（`task:settled`）响应式推进，杜绝死锁与空转轮询；
- **方案预审门禁（Approve & Run 契约）**：支持两阶段执行——第一阶段生成 Staged 计划与 Roster 拓扑；第二阶段经显式确认（用户点击或 API 调用）后才正式激活异步执行；
- **建队时刻模型路由快照隔离（Route Snapshotting）**：在建队初始阶段，对每个队员的 Provider、Model 与 Reasoning 配置进行深拷贝快照封存，确保无论外部全局如何切源，队员在整个生命周期内执行路线恒定不变。

---

## 2. 接口与契约规范

### 2.1 队员模型路由快照契约 (`packages/shared/src/types/team.ts` 或 `packages/agents/src/team/types.ts`)

```typescript
export interface MemberModelRouteSnapshot {
  providerId: string;
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  temperature?: number;
  snapshottedAt: number;
}

export interface ResolvedTeamMember {
  memberId: string;
  presetId: string;
  role: 'orchestrator' | 'generator' | 'evaluator';
  routeSnapshot: MemberModelRouteSnapshot;
}
```

### 2.2 DAG 任务节点与拓扑状态机 (`packages/agents/src/team/dag/types.ts`)

```typescript
export type TeamTaskStatus = 'pending' | 'ready' | 'claimed' | 'running' | 'completed' | 'failed';

export interface TeamDagTask {
  id: string;
  title: string;
  description: string;
  assignedRole: 'generator' | 'evaluator';
  /** 前置依赖的任务 ID 列表 */
  dependencies: string[];
  status: TeamTaskStatus;
  claimedBy?: string; // memberId
  result?: {
    output: string;
    artifacts: string[];
  };
  error?: string;
}

export interface TeamPlanStage {
  id: string;
  roster: ResolvedTeamMember[];
  tasks: TeamDagTask[];
  status: 'staged' | 'approved' | 'rejected' | 'running' | 'finished';
  createdAt: number;
  approvedAt?: number;
}
```

### 2.3 反应式 DAG 调度器 (`packages/agents/src/team/dag/DagScheduler.ts`)

```typescript
export class TeamDagScheduler {
  constructor(private readonly stage: TeamPlanStage, private readonly eventBus: EventBus);

  /** 推进调度：检查依赖完成情况，将满足条件的 pending 任务转为 ready */
  evaluateReadiness(): TeamDagTask[];

  /** 认领就绪任务并派发给对应角色队员 */
  claimTask(taskId: string, memberId: string): void;

  /** 任务完成结算并触发级联就绪检查 */
  settleTask(taskId: string, result: { output: string; artifacts: string[] }): void;

  /** 检查整个 DAG 是否已收敛（全部完成或任一阻断性失败） */
  isSettled(): boolean;
}
```

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：DAG 拓扑与编排调度完全位于 `packages/agents/src/team/`，禁止向 `packages/core` 引入团队或 DAG 数据结构。
2. **严禁调用真机 Agent**：测试必须完全通过构造离线内存 Task 与 Mock 成员执行器进行驱动，严禁调用本机真实 `claude`/`codex`/`dsh`/`opencode`。
3. **严格保证 DAG 拓扑无环**：在构建或校验 DAG 时必须包含循环依赖检测算法（环检测），若发现循环引用直接抛出 `CyclicDependencyError` 快速失败。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `packages/agents/src/team/dag/dagScheduler.test.ts`：
     - 验证菱形依赖（Diamond DAG: A -> B, C -> D）的正确就绪流转与并发推进；
     - 验证循环依赖（A -> B -> A）的即时报错与拦截；
     - 验证失败任务（Failed Task）引发的下游依赖熔断阻断。
   - 编写并通过 `packages/agents/src/team/teamRouteSnapshot.test.ts`：
     - 验证团队建队后切换全局 Provider/Model 配置时，队员 `routeSnapshot` 严格保持不变且后续回合依然使用快照路由。
   - 编写并通过 `packages/agents/src/team/teamApproveAndRun.test.ts`：
     - 验证 Staged 状态下不触发异步执行，调用 `approve()` 后正式开始调度推进。
2. **回归门禁**：
   - `npx vitest run packages/agents` 全部通过；
   - `npx tsc -b tsconfig.json` exit 0。

## 5. 交付证据（2026-10-01）

- DAG 环检测、菱形并发、失败传播与状态机已落地；定向调度测试 4 passed。模型快照与 Approve & Run 测试纳入 Epic 全量门禁。
- 对抗评审修复 evaluator 依赖证据、拒绝结果保留、stage/member 事件归属与 300 字符外部预览。
- API、路由透传与限制见 docs/V1.5-IMPLEMENTATION-NOTES.md；最终门禁见任务 174。

已验收（2026-10-27 对账，仅本地 DAG、快照与审批契约；本次 `dagScheduler.test.ts`、`teamRouteSnapshot.test.ts`、`teamApproveAndRun.test.ts` 三套及 `chunkedSession.test.ts` 合计 24 passed；同批长会话套件使整条命令 exit 1，不能称整批通过，详见卡 354 Result / `t8-v15-b.log`；源码 `packages/agents/src/team/dag/DagScheduler.ts:9`、`packages/agents/src/team/TeamRuntime.ts:104`、`:139`，独立分支、环检测、失败传播、实际路由透传和未批准不执行均有本次通过断言。）
