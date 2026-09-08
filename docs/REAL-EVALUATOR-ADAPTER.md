# RealEvaluatorAdapter —— 真实 Evaluator 接入 LoopEngine（task 062）

> 实现卡：`tasks/062-real-evaluator-adapter.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §11（L1184-1228：LoopEngine 已完整，写真实 adapter 不重写；真实链 Task Selection → Worktree →
> Developer Agent → Tests → Reviewer → met/not_met → retry → persist）。
> 前置：061（`RealGeneratorAdapter`：seam/GeneratorRunRecord/默认上限，对称前置）、
> 058（`InternalReviewer` + `TeamReviewConclusion` 结构化评审结论）、055（reviewer preset 只读面）。
> 代码位置：`packages/engine/src/real-evaluator-adapter.ts`（adapter；对称 061 的 engine seam 接入），
> seam 契约在 `packages/engine/src/LoopEngine.ts`（`LoopEngineDeps.evaluate` /
> `EvaluateContext` / `GeneratorOutput`）。

## 1. 一句话

把 058 建的 preset 化 Reviewer（InternalReviewer，evaluator 只读面）接到 LoopEngine 的 Evaluator
seam 上：**generator 产出（061 GeneratorRunRecord：output + 磁盘证据 artifactPaths + 测试结果）
+ 验收标准 → reviewer（058 InternalReviewer）→ met/not_met + 理由 + 建议（TeamReviewConclusion）
→ 回读给 loop 决策 retry/met**。不重写 LoopEngine、不写 core、不新造 Agent primitive、不新造结论/解析。

```text
LoopEngine iteration
  └─ evaluate(ctx)                     ← RealEvaluatorAdapter.evaluate（engine seam）
       ├─ 组装评审对象：goal / acceptance（唯一判据）/ generator 产出文本
       │    + 磁盘证据（061 artifactPaths 相对路径 → 绝对只读证据路径）+ 测试结果摘要
       ├─ InternalReviewer（058：EvaluatorAgent review 模式，reviewer preset 只读面收窄）
       │    └─ 会话判 met / not_met / impossible / error → ReviewConclusion（TeamReviewConclusion 形状）
       └─ conclusion → EvaluatorVerdict 契约（verdict/evidence/reason/unmet/suggestions）回 loop
```

## 2. 为什么放 engine / 复用 058

- **接入点是 engine 的 evaluate seam**：LoopEngine 只要求注入 `(ctx) => Promise<EvaluatorVerdict>`，
  RealEvaluatorAdapter 就是这个「调用方真实实现」。engine 已有对 agents 的既有引用（061 同源：
  LoopEngine type-import `EvaluatorVerdict`；real-generator-adapter.ts 值-import TeamRuntime/presets）——
  本文件把 agents/InternalReviewer 组合进来，不新增包、不新增 npm 依赖。
- **复用 058 不重造**：评审由 `InternalReviewer`（内部复用 EvaluatorAgent/AgentLoop/Session +
  `parseVerdict` 单一解析实现）执行；结论形状 = 058 `TeamReviewConclusion`
  （verdict/reason/unmet/suggestions/evidence，恒有值）；reviewer 角色语义（evaluator/no-write/
  只读证据面）来自 055 reviewer preset（`write:false` → shrink-only 只保留 `requiredPermission==='read'`
  工具，Read/Glob/Grep 可核验磁盘证据）。**本文件零解析逻辑** —— met/not_met 语义与 058 一致
  （Generator 不得自证完成：error 如实暴露、绝不误判 met）。
- **Generator/Evaluator 分离**：061 的 `output`/`artifactPaths` 是给本 adapter 核验的**数据**；
  `acceptance` 只从任务对象透传进评审 prompt（唯一评审判据来源），不进 developer 自评（061 已保证）。

## 3. 构造与接线（对称 061）

```ts
import { LoopEngine, RealGeneratorAdapter, RealEvaluatorAdapter } from '@vessel/engine';

const generator = new RealGeneratorAdapter({ providers, policyArtifacts, tools, developerProviderId: 'pro', developerModel });
const evaluator = new RealEvaluatorAdapter({
  providers,                 // providerId → ChatProvider（reviewer 查表）
  policyArtifacts,           // 编译后策略产物
  tools?,                    // 缺省 = InternalReviewer 只读探索面（Read/Glob/Grep，绑每次 evaluate 的 workspace）
  reviewerPresetId: 'reviewer', // 缺省；必须 role=evaluator 且 write:false（构造期 fail loud）
  reviewerProviderId: 'pro',
  reviewerModel: 'deepseek-v4',
  presetRegistry?, bus?, stableSections?, policyGuidance?,
});

const engine = new LoopEngine(
  {
    selectTask,
    generate: (ctx) => generator.generate(ctx),
    evaluate: (ctx) => evaluator.evaluate(ctx),   // ← Evaluator seam 真接线（062 前是确定性 stub）
    persist,
    workspaceFactory,
    disposeWorkspace,
  },
  // 不传 = 默认 maxIterations=1 / maxRetries=1（§11.1；放宽留 066）
);
const report = await engine.run();
```

构造期守卫（fail loud，对应调用方 bug）：reviewerProviderId 必填且已绑定、reviewerModel 非空、
policyArtifacts 必给、reviewerPresetId 必须解析为 `role:'evaluator'` 且 `write:false`
（非只读评审面会产出错位阶段 —— 与 061 的 generator preset 守卫对称）。
运行期守卫：无隔离 workspace（root 空/不存在）→ 拒绝；空 generatorOutput → 拒绝
（没有产出就没有评审对象，不静默判 met）。

## 4. 产出形状与结论回读

engine seam 方法 `evaluate(ctx)` 返回 `EvaluatorVerdict`
（`verdict/evidence/reason/unmet/suggestions` —— 058 conclusion 的 1:1 映射，feedback 恒为数组）；
每次调用把完整记录压进 adapter 历史，调用方可回读：

| `EvaluatorRunRecord` 字段 | 含义 |
|---|---|
| `taskId` / `goal` / `acceptance` | 任务对象（acceptance 透传 —— 评审判据回读） |
| `generatorOutput` | 被评产出文本（= 061 GeneratorRunRecord.output 回读：评的是什么） |
| `artifactPaths` | 磁盘证据相对路径（与 061 同形；排序稳定） |
| `evidencePaths` | reviewer 实际可见的**绝对**只读证据路径（artifactPaths 相对 → workspace 解析面） |
| `visibleTools` | 评审会话可见工具名（reviewer preset 只读收窄后；审计 reviewer 面） |
| `conclusion` | **复用 058 ReviewConclusion = TeamReviewConclusion**：verdict/reason/unmet/suggestions/evidence 恒有值 |
| `reviewerPresetId` / `iteration` / `attempt` / `startedAt` / `durationMs` | 评审身份与调用上下文（重试可回放） |

```ts
await evaluator.evaluate(ctx);
const rec = evaluator.lastRun;      // 结论可回读（verdict/unmet/suggestions = retry 决策数据）
evaluator.runs;                     // 按序历史（retry 每尝试一笔）
```

`EvaluatorRunRecord.conclusion.verdict ∈ met/not_met/impossible/error` 与 058 一致；
LoopEngine 按该 verdict 决策：`met` → 收尾 admit；`not_met/impossible/error` → 在 `maxRetries`
内重试（generator 重做后再次评审），超限后以最后 verdict admit 为 `stopped`。LoopEngine 只把
verdict/evidence/reason 写进 `IterationResult`（既有契约）；更全的 unmet/suggestions 反馈留在
adapter 记录里 —— 持久化更丰富反馈归 063 IterationStore。

### 证据纪律（evidencePaths）

评审依据 = 061 产出记录里的 `artifactPaths`（磁盘上**真实新建/改动**的文件，自述不是证据）；
adapter 把相对路径解析为 workspace 下的绝对只读路径交给 reviewer（可经 Read/Glob/Grep 核验）。
测试结果摘要（真实链「Tests」步的独立产出，如 testResults 文本）可选注入评审 prompt；
没有独立测试步时，generator 产出文本中的测试声称按 058 语义作为「自述」进评审（仅供参考，
需用磁盘证据核验，不自证）。

## 5. 默认自治受限（§11.1，沿用 061）

- adapter 本身每次 `evaluate()` 只跑 **ONE 次有界 Internal Review**（无内部 retry/iteration 循环）。
- `maxIterations = 1` / `maxRetries = 1` 由 **LoopEngine 默认选项**实施（本文件不重复实现循环），
  e2e 测试验证：真实 generator + 真实 evaluator adapter + 不传选项 → attempt1 not_met → 恰一次重试
  → attempt2 met（评审调用恰 2 次，零多余）；放宽机制（Goal/Loop Mode、budget）留 066。

## 6. 范围边界

- 只做 Evaluator 侧真 adapter。持久 TaskQueue/IterationStore（063）、自动 retry 循环主体
  （066 budget）各自成卡；本卡不写 TaskQueue/IterationStore、不写 retry 自动循环。
- 061（本卡消费方已就绪）：`GeneratorRunRecord` → `evaluateRun` 字段 1:1 喂入（测试覆盖）。

## 7. 测试

`packages/engine/src/real-evaluator-adapter.test.ts`（9 例）：seam 输入→结论→记录回读
（含 058 conclusion 五字段恒有值 + reviewer 只读面 Read 在列/无 Write）；not_met 反馈形状与
`parseReviewConclusion` 逐字段一致（复用 058，不新造解析）；acceptance 是唯一判据来源（缺判据 →
判不达标）；061 artifactPaths → 绝对只读证据路径进评审 prompt；测试结果摘要进评审 prompt；
reviewer provider 中断 → `verdict:'error'`（评审失败是结论不是异常，不误判 met）；构造/运行期守卫
fail loud；**默认上限 e2e**（真实 generator + 真实 evaluator adapter：not_met → 恰一次重试 → met，
不超 §11.1 上限）；met 首 attempt 即停；061↔062 记录形状对称 + 无跨调用状态泄漏。
