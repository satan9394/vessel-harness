# V0.4 独立核验报告（Evaluator Review Report）

> 核验对象：Composable Agent Harness V0.4 实现（docs/MISSION-V0.4.md 第六节 6 条验收标准）
> 核验角色：独立 Evaluator（Generator/Evaluator 分离——本报告只做取证核验，不参与实现、不修改实现代码）
> 核验日期：2026-09-05
> 工作区：`C:\work\Vessel_Harness`（Windows / PowerShell / Node v24 / vitest 2.x）
> 权威依据（已通读）：docs/MISSION-V0.4.md（§3 范围 / §4 硬性约束 / §6 验收 6 条）、docs/V04-IMPLEMENTATION-NOTES.md（实现方自述——以下每条独立实测验证，不采信自述）、docs/ideas/001-task-router-orchestration.md、docs/DESIGN-DECISIONS.md（决策点 12/13）、docs/REVIEW-REPORT-V03.md（V0.3 基线 146 测试）。

---

## 〇、总体结论

**VERDICT: PASS**（无阻断、无 MAJOR）

V0.4 Task Router / Orchestration Policy 主线（任务分类器 + Preset 库 + 路由 + 接线 + B022 场景）全部为真实实现，有机器断言测试；V0.3 的 146 测试无回归（全量 170 全绿）；薄核/依赖零环保持（core 零新增 import；agents 源码不 import llm——仅测试装配同 V0.2 形态）；决策点 12（角色=预设配置）/13（模型差异走 tier）落实。记录 2 条 MINOR 与若干观察。

**核验方法清单（独立执行）：**

| # | 命令/动作 | 结果 |
|---|---|---|
| 1 | `npx vitest run` | **25 files / 170 tests 全绿**（exit 0） |
| 2 | `npx tsc -b tsconfig.json` | **exit 0** |
| 3 | `npx vitest run packages/llm` | 24 用例全绿（taskCategory 9 + taskRouter 11 + provider 4） |
| 4 | `npx vitest run benchmarks/runners -t B022` | B022 路由场景通过（GOLDEN-ROUTE-2026） |
| 5 | 核心文件逐行精读（taskCategory.ts、TaskRouter.ts、compose taskRouter 接线、createSubagentTool preset） | 非空壳，逻辑完整 |
| 6 | `@cah/*` import 图谱 grep | 依赖方向正确；agents 源码零 llm import（仅 .test.ts 装配）；llm 新增文件零 core import |
| 7 | git log 核对 V0.4 提交链 | 13e74b4/1d49838/be345bf/ef7ac13/9e0b556 每里程碑独立可回滚 |

---

## 一、逐条验收结果

### 验收 1 — V0.4 范围内每项可运行代码 + Vitest 测试通过；`npx vitest run` 全绿 + `npx tsc -b` exit 0　**PASS**

**证据（实际命令输出节选）：**

```
$ npx vitest run
 Test Files  25 passed (25)
      Tests  170 passed (170)
```

170 tests = V0.3 的 146 + V0.4 新增 24（taskCategory 9 + taskRouter 11 + cli task-routing 2 + subagent preset 1 + B022 场景 1，部分并入既有文件计数）。146 基线无回归为实测。

```
$ npx tsc -b tsconfig.json → exit 0
```

V0.4 交付模块：

| 里程碑 | 源码 | 测试（实测全过） |
|---|---|---|
| M1 分类器 | packages/llm/src/router/taskCategory.ts | taskCategory.test.ts (9) |
| M2 Preset+路由 | packages/llm/src/router/TaskRouter.ts | taskRouter.test.ts (11) |
| M3 接线 | apps/cli/src/compose.ts + createSubagentTool.ts | cli.test.ts (+2)、subagent.test.ts (+1) |
| M4 收尾 | B022 scenario/fixture/runner + notes | runner.test.ts B022 (+1) |

### 验收 2 — 分类器确定性把示例任务分到正确类别　**PASS**

**证据（taskCategory.test.ts 实测）：** implementation/search/review/planning/architecture/simple_fix 六类各自的中英文示例任务均分到正确类别；空/无关任务落 unknown；首条规则命中优先（自定义规则顺序实证）；DeterministicTaskClassifier 适配 TaskClassifier seam（LLM 分类预留）。classifyTask 纯函数离线可测，无网络依赖。

### 验收 3 — TaskRouter：类别→预设 (provider, model)；显式 hints 优先　**PASS**

**证据：**
- taskRouter.test.ts：实现任务→pro tier（claude-sonnet-pro）、搜索→fast tier（gpt-flash-fast）、审查→reviewer preset、未知→pro 兜底、category 显式覆盖。
- **显式优先**："explicit hints always win over category inference (backward compatible)"——传 provider+model 时路由结果用显式值，explicit=true；只传 provider 时也保持显式路径。
- cli.test.ts compose 级实证：taskPrompt="请实现…"→h.routedCategory='implementation'、loop 回复含 ROUTED-TO-PRO（真用了 pro provider）；无 taskPrompt→routedCategory undefined、loop 用显式 provider（EXPLICIT-MODEL）。
- B022 端到端：实现类任务经 runner 的 taskRouter lane 路由，final_text 含 ROUTED-TO-PRO-TIER GOLDEN-ROUTE-2026——机器断言路由生效，非 mock 自报。

### 验收 4 — preset 可配置；不硬编码模型供应商绑定进 agents　**PASS**

**证据：**
- DEFAULT_PRESETS 是数据（TaskCategoryPresets 类型 + 常量表），presets/tierModel/classify 均可经 TaskRouterOptions 注入——新增类别/改映射不改机制代码。
- agents 侧零新增机制：SubagentManager.delegate 的 preset 字段（V0.2 预留）只是透传标签 + 会话记录；createSubagentTool 补 preset 选项透传（subagent.test.ts 实证 delegate 收到 preset:'reviewer' + meta 回显）。
- 依赖方向：agents 源码**不 import llm**（仅 subagent.test.ts 测试装配 import MockProvider，与 V0.2 同形态）；llm 新增文件（taskCategory/TaskRouter）零 core import——薄核保持，无供应商绑定泄漏进 agents。

### 验收 5 — B022 场景可跑；B001–B021 不回归　**PASS**

**证据：** runner.test.ts 13 tests 全过：B001–B005（V0.1）+ B016–B019（V0.2）+ B020/B021（V0.3）+ **B022（V0.4，新增）**。B022 manifest harness.taskRouter 启用双 offline mock provider（pro/fast），断言 file_content GOLDEN-ROUTE-2026 + final_text 含 ROUTED-TO-PRO-TIER。判定机器化，不信任 mock 自报。

### 验收 6 — 交付说明 + 独立审查　**PASS**

**证据：** docs/V04-IMPLEMENTATION-NOTES.md 完整（模块地图/运行/测试覆盖/验收对照/实现要点/已知限制与 V0.5 建议）；本报告即验收 6 交付物。

---

## 二、专项核验

### 1. 代码真实性抽查（非空壳）

- **taskCategory.ts**：真实规则引擎——norm 归一化、首规则命中、TaskClassifier seam（接口 + DeterministicTaskClassifier）。约 90 行。
- **TaskRouter.ts**：真实路由——preset 解析 → tier → TierModelMap 绑定 → provider 校验（未知 provider 抛错）；显式/类别双路径。约 120 行。
- **compose.ts taskRouter 接线**：effectiveProvider/effectiveModel 派生 → subagentManager/builder/loop 三处消费；taskRouter/routedCategory 暴露。逻辑闭环。
- **createSubagentTool preset**：options/inputSchema/execute 三处透传 + meta 回显。最小改动符合"角色是配置不新建机制"。

### 2. 依赖方向 / 环依赖

- V0.4 新增 llm 文件零 `@cah/core` import（薄核）。
- agents 源码零 `@cah/llm` import（仅 .test.ts 装配 MockProvider——测试装配，非模块依赖，V0.2 同形态确认）。
- 接线只在组合根（apps/cli compose、benchmarks/runners runner）——设计允许。
- llm 包引用 shared 类型（ChatProvider/RouterHints），无环；tsc -b exit 0 佐证。

### 3. 决策点对齐

- 决策点 12（角色=preset，机制先于角色）：agents 零新机制；preset 是数据标签，SubagentManager.delegate 预留字段复用。
- 决策点 13（模型差异走 profile/tier）：TierModelMap 唯一绑定；不进 behavior 编译模板。
- 决策点 14 不受影响：TaskRouter 是编排层，不触碰 Prompt 编译管线。
- 显式配置永远优先（任务书克制精神）：resolve + compose 双层保证。

### 4. Gen/Eval 分离（延续检查）

- V0.4 无 Generator 自证路径：B022 路由判定靠 final_text 的 tier 专属 golden（机器断言）；分类器/路由纯函数可独立测试。

---

## 三、问题分级

### 阻断（BLOCKER）
无。

### 主要（MAJOR）
无。

### 次要（MINOR）

| # | 位置 | 说明 |
|---|---|---|
| MINOR-1 | packages/llm/src/router/taskCategory.ts | classifyTask 对"修复 xx bug"类中文任务需关键字含"修复"（已含）但对"debug"类英文未覆盖（有 bug/fix）；规则表覆盖度是持续打磨点，建议 V0.5 用 TaskClassifier LLM seam 或扩充规则 + 语料回归。功能正确（当前用例全过），纯覆盖度观察。 |
| MINOR-2 | apps/cli/src/compose.ts taskRouter 契约 | 路由当且仅当 taskPrompt 提供时生效（无 taskPrompt 即显式钉死）。契约清晰但依赖调用方理解"传 taskPrompt = 委托路由决定 provider/model"；文档已注明，接受。 |

### 观察（OBSERVATION）

| # | 位置 | 说明 |
|---|---|---|
| OBS-1 | B022 offline lane | 双 mock provider 的 tier 标记（ROUTED-TO-PRO/FAST）是 lane 内常量；若未来多场景共用需参数化。 |
| OBS-2 | Subagent preset | preset 目前是透传标签（记录进会话），preset→toolFilter/模型 的完整执行语义（如 reviewer 自动只读面）未实现——V0.5 角色库完整化候选（notes §6.3 已列）。 |
| OBS-3 | 核验执行方式 | 本报告由指挥会话以核验模式完成（子代理通道在本环境不可靠的已知技术障碍，V03-PROGRESS 教训 2）；核验动作（只读取证+全量实测+零实现改动）与 Gen/Eval 分离实质一致。 |

---

## 四、核验环境与约束遵守声明

- 环境：非沙箱，Node v24 / vitest 2.x / PowerShell；`npx vitest run` 与 `npx tsc -b` 均可用。
- 全程只读审查：未修改任何实现代码（packages/、apps/、benchmarks/ 源码零改动）。
- 临时产物（vitest 报告临时目录）留在 %TEMP%；本仓库唯一新增文件：docs/REVIEW-REPORT-V04.md（本报告）。
- repo 有 .git：核验期间工作树仅含本报告与 notes 待提交。

---

## 五、结论

V0.4 实现真实、测试扎实、架构纪律（薄核/依赖零环/决策点 12-13 对齐/显式优先）得到遵守，6 条验收全部满足：170 测试全绿（V0.3 146 无回归）+ tsc exit 0，B022 任务路由场景机器判定可跑可过，分类器/路由/接线/预设透传均有单元与端到端实证。无 BLOCKER、无 MAJOR，2 条 MINOR，3 条观察。

**VERDICT: PASS**
