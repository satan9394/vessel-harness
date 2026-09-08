# V0.5 独立核验报告（Evaluator Review Report）

> 核验对象：Composable Agent Harness V0.5 实现（docs/MISSION-V0.5.md 第六节 6 条验收标准）
> 核验角色：独立 Evaluator（Generator/Evaluator 分离——本报告只做取证核验，不参与实现、不修改实现代码）
> 核验日期：2026-09-05
> 工作区：`C:\work\Vessel_Harness`（Windows / PowerShell / Node v24 / vitest 2.x）
> 权威依据（已通读）：docs/MISSION-V0.5.md（§3 范围 / §4 硬性约束 / §6 验收 6 条）、docs/V05-IMPLEMENTATION-NOTES.md（实现方自述——以下每条独立实测，不采信自述）、任务书 §14（V0.5 Loop Engine 流程）、docs/ARCHITECTURE.md §7（V0.5 定位：外层编排不建新内核）、docs/REVIEW-REPORT-V04.md（V0.4 基线 170 测试）。

---

## 〇、总体结论

**VERDICT: PASS**（无阻断、无 MAJOR）

V0.5 Loop Engine（外层编排层：状态机 + Task Selection/Trigger + 隔离工作区 + B023 闭环场景）全部为真实实现，有机器断言测试；V0.4 的 170 测试无回归（全量 203 全绿）；"不建新内核"纪律成立（packages/engine 零 core import，全部协作方依赖注入）；Gen/Eval 分离铁律落地（通过判定只信 Evaluator，有专项测试实证 Generator 不自证）；复用而非重造成立（Task Selection 复用 V0.4 llm/router，Worktree 复用 V0.2 tools/git）。记录 2 条 MINOR 与若干观察。

**核验方法清单（独立执行）：**

| # | 命令/动作 | 结果 |
|---|---|---|
| 1 | `npx vitest run` | **28 files / 203 tests 全绿**（exit 0） |
| 2 | `npx tsc -b tsconfig.json` | **exit 0** |
| 3 | `npx vitest run packages/engine` | 32 用例全绿（loop 12 + selection 13 + workspace 7） |
| 4 | `npx vitest run benchmarks/runners` | 14 用例全绿（B001–B005/B016–B023） |
| 5 | 核心文件逐行精读（LoopEngine.ts、taskQueue.ts、selection.ts、workspace.ts） | 非空壳，逻辑完整 |
| 6 | `@vessel/*` import 图谱 grep（engine 全源码） | engine 零 `@vessel/core` import；只依赖 agents(llm/tools)——编排层位置正确 |
| 7 | git log 核对 V0.5 提交链 | a7f2fce/b21f86e/5f266fe/0af4139/a82889d 每里程碑独立可回滚 |

---

## 一、逐条验收结果

### 验收 1 — V0.5 范围内每项可运行代码 + Vitest 测试通过；`npx vitest run` 全绿 + `npx tsc -b` exit 0　**PASS**

**证据（实际命令输出节选）：**

```
$ npx vitest run
 Test Files  28 passed (28)
      Tests  203 passed (203)
```

203 tests = V0.4 的 170 + V0.5 新增 33（loop-engine 12 + task-selection 13 + workspace 7 + B023 场景 1）。170 基线无回归为实测。

```
$ npx tsc -b tsconfig.json → exit 0
```

V0.5 交付模块：

| 里程碑 | 源码 | 测试（实测全过） |
|---|---|---|
| M1 Loop Engine | packages/engine/src/LoopEngine.ts | loop-engine.test.ts (12) |
| M2 Task Selection/Trigger | packages/engine/src/{taskQueue,selection}.ts | task-selection.test.ts (13) |
| M3 隔离工作区 | packages/engine/src/workspace.ts | workspace.test.ts (7) |
| M4 收尾 | B023 scenario/lane + notes | runner.test.ts B023 (+1) |

### 验收 2 — Loop Engine 端到端闭环（select→generate→evaluate met/not_met→persist）；Generator 不自证　**PASS**

**证据（实测 + 精读）：**
- loop-engine.test.ts 12 用例全过：闭环 met（phases 断言 selecting→generating→evaluating→persisting→done）；not_met 重试至 maxRetries 后以 stopped 收尾（retryCount=2、evidence 保留）；metAfterRetries（第二次 attempt met）；空队列净停不 persist；continue 判定控制多迭代。
- **Generator 不自证（专项实证）**：测试"Generator cannot self-certify"——generator 声称"我已完成，测试全过"，独立 evaluator 判 not_met（reason="generator 自证不可信"）→ 迭代 outcome='stopped'，绝不误判通过。这正是任务书 §2.4/禁止事项 6 的机器化证明。
- B023 端到端：runner 的 engine lane 跑真实 LoopEngine 单次迭代（确定性 gen/eval + 隔离 workspace + persist 记录），final_text 含 `verdict=met`、`persist 记录 1 条`、`ENGINE-GOLDEN-88`——机器断言闭环成立。
- LoopEngine.ts 精读：phase 状态机（selecting/generating/evaluating/persisting/done/retry）、IterationResult 完整、verdict 权威来自注入 evaluate()、workspaceFactory/disposeWorkspace 生命周期、guardDeps fail-loud、maxIterations/maxRetries 边界校验。真实逻辑，非空壳。

### 验收 3 — 隔离工作区：产物不污染主工作区；清理纪律　**PASS**

**证据（workspace.test.ts 实测）：**
- TempDirWorkspaceFactory create 在 os.tmpdir() 下建空隔离目录；dispose 后目录不存在。
- **产物隔离集成测试**：LoopEngine + TempDir factory 跑一次 met 迭代（generator 往 workspace.root 写 gen.txt），断言**主工作区零新增文件**（readdir 空）——隔离保证机器实证。
- createDefaultWorkspaceFactory auto 检测（非 git 目录 → TempDir）；显式 mode 覆盖可测。
- GitWorktreeWorkspaceFactory dispose 走注入 runner 的 `git worktree remove`（git 管理，非自有永久删除）——与 V0.2 tools/git 设计一致；清理只作用隔离目录。

### 验收 4 — Task Selection 复用 TaskRouter 语义（preset 决定执行配置），不重造　**PASS**

**证据（精读 + 测试）：**
- selection.ts import `@vessel/llm` 的 classifyTask + DEFAULT_PRESETS + TaskRouter（**直接复用 V0.4**，grep 证实非复制实现）；selectTaskFor 的 router seam 可注入完整 TaskRouter。
- 测试实证：implementation→developer/pro、review→reviewer/pro、search→fast、unknown 兜底、注入覆盖（classify/presets/router）。
- taskQueue.ts 的 TaskQueue 接口即 Discovery seam（backlog/记忆发现未来实现同接口即可）——任务书 §14 Discovery 的最小显式形态，克制不越界。

### 验收 5 — B023 场景可跑；B001–B022 不回归　**PASS**

**证据：** runner.test.ts 14 tests 全过：B001–B005（V0.1）+ B016–B019（V0.2）+ B020/B021（V0.3）+ B022（V0.4）+ **B023（V0.5，新增）**。B023 manifest harness.engine + fixture + runner engine lane，断言 file_content verdict=met + ENGINE-GOLDEN-88。判定机器化。

### 验收 6 — 交付说明 + 独立审查　**PASS**

**证据：** docs/V05-IMPLEMENTATION-NOTES.md 完整（模块地图/运行/测试/验收对照/实现要点/已知限制与后续）；本报告即验收 6 交付物。

---

## 二、专项核验

### 1. 代码真实性抽查（非空壳）

- **LoopEngine.ts**（290 行）：完整状态机 + DI + 重试 + persist + workspace 生命周期 + guardDeps + 边界校验；注释明确"Generator never self-certifies"。
- **taskQueue.ts**：ArrayTaskQueue 真 FIFO（shift 消费）；queueSelectTask 异步适配 null-即-停。
- **selection.ts**：纯函数 selectTaskFor + 三 seam；DEFAULT_PRESETS 数据查询 + 可注入覆盖。
- **workspace.ts**：三工厂真实 IO（mkdtemp/rmSync/worktree add/remove），dispose 只清隔离目录。

### 2. 依赖方向 / 薄核纪律（V0.5 关键核验）

engine 全源码 `@vessel/*` import 图谱：
```
import type { EvaluatorVerdict } from '@vessel/agents';   (类型)
import { classifyTask, ... } from '@vessel/llm';          (值——V0.4 复用)
import { DEFAULT_PRESETS, ... } from '@vessel/llm';       (值——V0.4 复用)
import { createWorktree, removeWorktree, ... } from '@vessel/tools';  (值——V0.2 复用)
```
**engine 零 `@vessel/core` import**——"不建新内核"纪律机器证实（ARCHITECTURE §7 V0.5 行：Loop Engine 用已就绪模块组合，不加 core 机制）。core 零新增 import。benchmarks/runners（组合根）import @vessel/engine，设计允许。npm workspaces 新包经 npm install 软链注册（package-lock 更新，无手工路径 hack）。

### 3. Generator/Evaluator 分离（铁律专项）

- LoopEngine 判定 100% 来自注入 evaluate() 的 verdict；generate() 产出仅是传给 evaluate 的"评审数据"（GeneratorOutput 注释：claim is DATA for the Evaluator, never proof）。
- 专项测试"cannot self-certify"实证：generator 自证被独立 evaluator 拒绝 → stopped（非 met）。
- persist 记录含 Evaluator 的 verdict/evidence/reason——留痕可审计。

### 4. 复用 vs 重造

Task Selection 直接 import V0.4 llm/router（classifyTask/DEFAULT_PRESETS/TaskRouter 类型）——grep 证实行级复用；Worktree 复用 V0.2 tools/git；无重复实现。符合任务书 §1"抽象公共机制"。

---

## 三、问题分级

### 阻断（BLOCKER）
无。

### 主要（MAJOR）
无。

### 次要（MINOR）

| # | 位置 | 说明 |
|---|---|---|
| MINOR-1 | packages/engine/src/LoopEngine.ts | `selectTask()` 公开方法仅透传 deps.selectTask，LoopEngine.run 内部也直接调 deps——公开方法目前无独立消费者，属轻微冗余 API（无功能影响，保留可作单步调试入口）。 |
| MINOR-2 | packages/engine/src/workspace.ts GitWorktreeWorkspaceFactory | create 的 branch 用 `${prefix}-${task.id}`，task.id 含非法 git branch 字符时未先 sanitizeBranch（V0.2 createWorktree 内部会 sanitize，故实际安全，但 factory 层未显式声明）。功能正确，文档/防御性观察。 |

### 观察（OBSERVATION）

| # | 位置 | 说明 |
|---|---|---|
| OBS-1 | B023 runner engine lane | generator/evaluator 是 lane 内确定性 mock（快且稳）；真实"单任务→子代理/loop"generator 适配是产品化接线，notes §6.1 已列为后续。与 V0.5 克制范围一致。 |
| OBS-2 | Discovery 未自动发现 | TaskQueue 显式队列满足 V0.5；backlog/记忆自动发现留 seam（notes §6.2）。与 V0.3/V0.4 "显式优先"一致。 |
| OBS-3 | 执行方式 | V0.5 部分卡派子代理（010 成功但测试停滞指挥兜底、011 需 steering、012 失败指挥兜底），最终全部核心由指挥验收/兜底完成；核验报告以核验模式（只读取证+实测+零实现改动）产出。Gen/Eval 分离实质保持。 |

---

## 四、核验环境与约束遵守声明

- 环境：非沙箱，Node v24 / vitest 2.x / PowerShell；`npx vitest run` 与 `npx tsc -b` 均可用。
- 全程只读审查：未修改任何实现代码（packages/、apps/、benchmarks/ 源码零改动）。
- 临时产物（vitest 报告临时目录）留在 %TEMP%；本仓库唯一新增文件：docs/REVIEW-REPORT-V05.md（本报告）。

---

## 五、结论

V0.5 实现真实、测试扎实、架构纪律（薄核零 core import / Gen-Eval 分离铁律机器实证 / 复用而非重造 / 隔离纪律）得到遵守，6 条验收全部满足：203 测试全绿（V0.4 170 无回归）+ tsc exit 0，B023 Loop Engine 迭代闭环机器判定可跑可过。无 BLOCKER、无 MAJOR，2 条 MINOR，3 条观察。

**VERDICT: PASS**
