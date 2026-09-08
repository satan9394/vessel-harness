# RealGeneratorAdapter —— 真实 Generator 接入 LoopEngine（task 061）

> 实现卡：`tasks/061-real-generator-adapter.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §11（L1184-1228：LoopEngine 已完整，写真实 adapter 不重写；真实链 Task Selection → Worktree →
> Developer Agent → Tests → Reviewer → met/not_met → retry → persist）。
> 前置：054/055（AgentPreset + 三角色实例）、056（TaskRouter Auto）、057（TeamRuntime 单成员/多成员）、
> 058（acceptance 进 evaluate / Internal Review 结论）。
> 代码位置：`packages/engine/src/real-generator-adapter.ts`（adapter + 证据扫描纯函数），
> seam 契约在 `packages/engine/src/LoopEngine.ts`（`LoopEngineDeps.generate` /
> `GenerateContext` / `GeneratorOutput` / `LoopTask`）。

## 1. 一句话

把 054-058 建的 preset 化 Developer Agent（generator，经 TeamRuntime **单成员阵容**）接到
LoopEngine 的 Generator seam 上：**任务（goal + acceptance）→ 隔离 workspace → developer 产出 →
测试/磁盘证据 → 结论可回读**。不重写 LoopEngine、不写 core、不新造 Agent primitive。

```text
LoopEngine iteration
  └─ generate(ctx)                      ← RealGeneratorAdapter.generate（engine seam）
       ├─ 快照 workspace（证据基线，排除 .git/.harness/.vessel/node_modules）
       ├─ TeamRuntime.runTeam（单成员 roster = developer/generator，隔离会话 source 'team'）
       ├─ 产出文本 = developer finalText（自述，供 Evaluator 核验，不自证）
       └─ 后快照 diff → artifactPaths（只信盘上新建/改动的事实）
```

## 2. 为什么放 engine / 复用 TeamRuntime 单成员

- **接入点是 engine 的 generate seam**：LoopEngine 只要求注入 `(ctx) => Promise<GeneratorOutput>`，
  RealGeneratorAdapter 就是这个「调用方真实实现」。engine 已有对 agents 的既有引用
  （LoopEngine 类型 import `EvaluatorVerdict`；selection.ts import `@vessel/llm` 值）——
  本文件把 agents/TeamRuntime 组合进来，不新增包、不新增 npm 依赖。
- **复用不重写**：developer 会话由 057 TeamRuntime 驱动（成员跑在既有 AgentLoop/Session 上），
  角色能力面（write:true / 工具 shrink-only）由 055 preset + capabilities 收窄；
  不配 orchestrator → 单成员路径，不走 delegate。
- **Generator/Evaluator 分离**：`output`/`artifactPaths` 是给 Evaluator（062 RealEvaluatorAdapter）
  核验的**数据**；`acceptance` 只透传（形状对齐 `LoopTask.acceptance`），**不进 developer 自评**，
  与 058 语义一致（developer prompt 只带任务，验收标准留 evaluate 侧）。

## 3. 构造与接线

```ts
import { LoopEngine } from '@vessel/engine';
import { RealGeneratorAdapter } from '@vessel/engine'; // 同一包导出

const generator = new RealGeneratorAdapter({
  providers: { pro, fast },     // providerId → ChatProvider（developer 查表）
  policyArtifacts,              // 编译后策略产物（compilePolicyYaml，与既有会话一致）
  tools,                        // developer 可见工具面（preset 能力面 shrink-only 收窄）
  developerPresetId: 'developer', // 缺省；必须 role=generator（reviewer/lead 构造期 fail loud）
  developerProviderId: 'pro',
  developerModel: 'deepseek-v4',
  developerTier: 'pro',           // 档位意图（展示/审计）
  presetRegistry?, bus?, stableSections?, policyGuidance?, maxSteps?,
});

const engine = new LoopEngine(
  {
    selectTask,
    generate: (ctx) => generator.generate(ctx),   // ← Generator seam 真接线
    evaluate,                                      // 062 前用确定性 stub/DeterministicEvaluator
    persist,
    workspaceFactory,                              // 真实 developer 必须有隔离目录（064 worktree / TempDir）
    disposeWorkspace,
  },
  // 不传 = 默认 maxIterations=1 / maxRetries=1（§11.1；放宽留 066 Goal/Loop 模式）
);
const report = await engine.run();
```

构造期守卫（fail loud，对应调用方 bug）：developerProviderId 必填且已绑定、developerModel 非空、
policyArtifacts/tools 必给、developerPresetId 必须解析为 `role:'generator'`。
运行期守卫：无隔离 workspace（root 空/不存在）→ 拒绝；developer 会话失败（`outcome:'failed'`）→
抛 `RealGeneratorAdapter: developer run failed: …`（不静默转成功产出）。

## 4. 产出形状与结论回读

engine seam 方法 `generate(ctx)` 返回 `GeneratorOutput { output, artifactPaths? }`；
每次调用把完整记录压进 adapter 历史，调用方可回读：

| `GeneratorRunRecord` 字段 | 含义 |
|---|---|
| `taskId` / `goal` / `acceptance` | 任务对象（acceptance 透传，062/063 消费） |
| `output` | developer 产出文本（= `developer.output`，自述） |
| `artifactPaths` | 磁盘证据：运行期间新建/改动文件（相对路径；只信盘上事实，不信自述清单） |
| `developer` | 成员摘要：memberId/role/sessionId/status/durationMs/output —— 会话级结论 |
| `teamRunId` | TeamRuntime run id（审计/投影关联点） |
| `iteration` / `attempt` | engine 迭代/尝试编号（重试可回放） |

```ts
await generator.generate(ctx);
const rec = generator.lastRun;      // 结论可回读
generator.runs;                     // 按序历史（retry 每尝试一笔）
```

### 证据纪律（artifactPaths）

改动证据 = developer 运行**前后**两次 `scanWorkspaceFiles` 快照的 diff
（`diffWorkspaceSnapshots`，纯函数）：只收录**磁盘上新建或内容变化的文件**，相对路径排序稳定；
`.git` / `.harness`（会话日志）/ `.vessel` / `node_modules` 默认排除（`DEFAULT_EXCLUDE_DIRS` 可覆盖）。
developer 在文本里"声称改了 src/x.ts"而磁盘没动 → `artifactPaths` 保持 `[]`——**自述不是证据**。

## 5. 默认自治受限（§11.1）

- adapter 本身每次 `generate()` 只跑 **ONE 个有界 developer 运行**（单回合单成员、无内部
  retry/iteration 循环；回合上限 = AgentLoop `maxSteps`，缺省机械硬顶）。
- `maxIterations = 1` / `maxRetries = 1` 由 **LoopEngine 默认选项**实施（本文件不重复实现循环），
  测试验证：队列两个任务 + 不传选项 → 只消费第一个任务（maxIterations=1）；attempt1 not_met →
  恰一次重试 → attempt2 met（maxRetries=1）。放宽机制（Goal/Loop Mode、budget/pause/resume）留 066。

## 6. 范围边界

- 只做 Generator 侧真 adapter；Evaluator 真 adapter（062，对称包装 058 reviewer）、持久
  TaskQueue/IterationStore（063）、worktree 生命周期（064）、预算放宽（066）各自成卡。
- 062 消费本卡产出：`EvaluateContext`（engine 自带 `task.acceptance` + `generatorOutput`）+ 记录回读。

## 7. 测试

`packages/engine/src/real-generator-adapter.test.ts`（9 例）：engine seam 输入→产出→回读；
直接入口同形状；acceptance 透传；异常路径（无 workspace / provider 未绑定 / 非 generator preset /
developer 会话失败）；证据扫描纯函数；**LoopEngine 默认上限生效 e2e**（真 developer 会话 + 确定性
evaluator，恰一次重试、只跑一个任务）；多次调用无状态泄漏。
