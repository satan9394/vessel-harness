# MISSION V0.5 — Composable Agent Harness V0.5 执行任务书（Loop Engine）

> 总指挥签发（2026-09-05，自主开发，personal-dev-workflow，子代理执行优先）。
> V0.1–V0.4 已全部验收 PASS（170 测试，REVIEW-REPORT-V0{1,2,3,4}.md）。
> 工作区：`C:\work\Vessel_Harness`。

---

## 一、本阶段目标

实现任务书第十四节 **V0.5 Loop Engine**（最后一个版本里程碑）：
Trigger → Discovery → Task Selection → Worktree → Generator → Evaluator → Persist → Next Iteration。

ARCHITECTURE §7 明确定位：**Loop Engine = Harness 外层循环**——用 V0.1–V0.4 已建的全部机制组合成持续迭代层，**不建新内核**（Generator=单会话 loop；Evaluator=agents/evaluator；Worktree=Git 集成；Persist=memory/session；Task Selection=V0.4 TaskRouter）。事件面词汇已在 V0.1 预留（轮次/委派），Loop Engine 是消费方编排。

## 二、V0.1–V0.4 交接现状（可用机制清单，Loop Engine 的积木）

- core/agent-loop：单会话权威薄 loop（read→tool→answer、纯文本即停、max_steps 硬顶）。
- agents/evaluator：Evaluator 契约（met/not_met/impossible/error + DeterministicEvaluator + LLEvaluator）+ EvaluatorAgent（隔离只读评审）。
- agents/subagent：SubagentManager（隔离会话委派、并发 1–3、结果契约）+ IsolatedRuntime。
- agents/planner：Planner（createPlan/injectPlan/executePlan，步骤验收驱动 Evaluator）。
- tools/git/Worktree：Git worktree（createWorktree/removeWorktree/listWorktrees，GitRunner 可注入）。
- memory：ProjectStore（项目记忆）+ ScopedMemoryStore（user/project/local）+ LearnedStore（suggest）。
- llm/router：TaskRouter（任务分类→preset→tier→provider/model）+ classifyTask。
- skills：Skill 工具 + SkillSearch。
- policy/runtime/context/telemetry：软硬约束、执行、上下文组装、指标。
- apps/cli/compose + benchmarks/runners：组合根 + headless 跑法。

## 三、V0.5 范围（Loop Engine 编排层，克制增量）

1. **Loop Engine 核心**：外层循环状态机——一次"迭代"= 一个候选任务的完整生命周期：选择任务 → 准备隔离工作区（worktree 或临时目录）→ Generator 执行（子代理/独立会话跑单任务）→ Evaluator 独立评审（met 通过 / not_met 带证据打回）→ Persist（记忆/产物落盘）→ 决定继续/停止。作为新包或 apps/cli 内编排模块（不建新内核，复用既有 loop）。
2. **Trigger + Discovery + Task Selection**：迭代输入源——显式任务队列 + （可选）从 backlog/记忆发现候选；Task Selection 用 V0.4 TaskRouter 语义（任务→类别→preset 决定执行者配置）。
3. **Worktree / 隔离工作区**：每迭代在隔离目录执行（git worktree 当仓库可用，否则临时目录）；产物与主工作区隔离，避免迭代间污染。
4. **Generator/Evaluator 闭环**：每迭代 Generator 产出 → 独立 Evaluator 评审（not_met 打回重试至上限或记录）；复用 agents/evaluator + subagent 机制。
5. **Persist**：每迭代结果（verdict、证据、产物路径）写入项目记忆/迭代日志；失败与成功都留痕。
6. **收尾**：benchmark 场景（B023：单次 Loop Engine 迭代闭环）+ V05-IMPLEMENTATION-NOTES.md + 独立核验 REVIEW-REPORT-V05.md。

明确不做（超出任务书 / 克制）：真实多任务调度 UI、跨仓库自动化、自动学习闭环（V0.4 learned 已 suggest-only，Loop Engine 只消费不自动写用户区）、Web UI、20-Agent Team。

## 四、硬性约束（同 V0.1–V0.4）

1. clean-room；薄核（Loop Engine 是编排层，不 import core 内部、不加 core 机制）；依赖零环。
2. Generator/Evaluator 分离：Loop Engine 的通过判定必须来自 Evaluator，不得由 Generator/loop 自证。
3. 无永久删除（回收站）；不 force push；TypeScript；Windows/PowerShell。
4. 新功能必须有 Vitest 测试；170 用例不得回归；B001–B022 不回归。
5. 每迭代的隔离工作区（worktree/临时目录）用后清理须走回收站纪律或留在 %TEMP%（不永久删除工作区用户数据）。

## 五、建议里程碑（任务卡形式）

- **V0.5-M1** Loop Engine 核心状态机（选任务→隔离执行→评审→落盘→继续判定）+ 确定性测试（用 mock generator/evaluator）。
- **V0.5-M2** Task Selection 接入（用 TaskRouter 语义选执行 preset）+ Trigger/Discovery 最小形态（任务队列）。
- **V0.5-M3** Worktree/隔离工作区（仓库可用 git worktree，否则临时目录）+ 产物隔离 + 测试。
- **V0.5-M4** 收尾：B023 benchmark（一次迭代闭环机器断言）+ V05-IMPLEMENTATION-NOTES.md + 独立核验 PASS。

## 六、验收标准

1. V0.5 范围内每项有可运行代码 + Vitest 测试；`npx vitest run` 全绿（≥170）+ `npx tsc -b` exit 0。
2. Loop Engine 端到端：一次迭代（选任务→Generator→Evaluator met/not_met→Persist）闭环可跑，not_met 带证据打回（测试实证，Generator 不自证）。
3. 隔离工作区：迭代产物不污染主工作区（测试实证）；清理走回收站/%TEMP%。
4. Task Selection 复用 TaskRouter 语义（preset 决定执行配置），不新造轮子。
5. B023 场景可跑；B001–B022 不回归。
6. 交付说明（V05-IMPLEMENTATION-NOTES.md）+ 独立审查 PASS（REVIEW-REPORT-V05.md）。

## 七、执行纪律

- tasks/ 拆卡 010+；优先派隔离子代理执行；子代理卡死 → 指挥会话直接实现兜底并记教训。
- 遇环境/技术问题自主解决，不询问用户（用户已授权全自主）。
- 每卡验证（vitest+tsc）+ git 提交；进度写 docs/V05-PROGRESS.md。

## 八、汇报格式

结论 / 改动文件清单 / 验证证据 / 下一步。
