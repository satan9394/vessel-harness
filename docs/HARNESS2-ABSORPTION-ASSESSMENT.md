# Harness² 可吸收优点评估（面向 Vessel）

> 文档性质：外部项目对照评估 + 吸收路线建议。**不包含任何代码改动**。
> 状态：待研究（未立项、未排期）。开工前需用户拍板选一项，见 `HANDOFF.md` §3.2「待研究」。
> 评估对象：`google-research/harness2`（本地副本 `E:\Code_file\Projects\harness2`，论文 arXiv 2610.14224，Apache-2.0）。
> 吸收方：本仓库 Vessel（Composable Agent Harness）。
> 结论依据：五个维度的只读代码分析 + 关键结论回源交叉验证。**全部为静态阅读，未运行 Harness²，也未运行 Vessel 测试**；文中一切"现状"均为源码可证的事实，凡属推断均已标注。
> 读者：接手实施的人或 Agent。若只读一节，读 §3 与 §6。
> 配套文档：`docs/HARNESS2-AGENT-BRIEF.md`（给接手实施 Agent 的对齐提示词，与本报告成对使用）。

---

## 1. 一句话结论

Harness² 值得吸收的是**方法论与产物契约**，不是它的 Python 代码：把"harness"做成可校验、可 diff、可回滚的树；用匿名对照实验决定采纳；把证据落成文件、让模型自己读；判分失败与真失败严格区分。Vessel 在工程治理、事件溯源、策略硬执法上明显更强，缺的是**自我改进闭环**与**证据工程纪律**。

同时，Harness² 有三块东西是论文实验台专用（4k/3k 预算恒等式、三个商业 benchmark adapter、跨任务经验库的自动入库），直接搬会破坏 Vessel 的既有硬约束，见 §7。

---

## 2. 分析方法与可信度

采用五维度并行的只读分析，每个维度只读一侧或对照两侧，最后汇总交叉验证。

| 维度 | Harness² 侧证据 | Vessel 侧对照 |
|---|---|---|
| A 递归方法论核心 | `core/recursion.py`、`selection.py`、`library.py`、`ledger.py`、`prompts_en.py`、`tree.py` | `engine/LoopEngine.ts`、`behavior/*`、`engine/selection.ts` |
| B 证据工程与可恢复性 | `core/context.py`、`runmark.py`、`judge.py`、`report.py`、`schedule.py` | `core/session/*`、`context/*`、`engine/iteration-store.ts`、`telemetry/*` |
| C 评测接缝与基准方法论 | `core/spec.py`、`benchmarks/{jobbench,lab,workbuddy}.py`、`scripts/check_provenance.py` | `benchmarks/runners/src/contracts/*`、`report/report.ts`、`docs/BENCHMARK-SPEC.md` |
| D 工程化与外部 agent 接入 | `substrate/*`、`core/proposer.py`、`config.py`、`preflight.py`、`i18n.py` | `packages/llm/*`、`apps/cli/src/commands/doctorCommand.ts`、`docs/*-ADAPTER.md` |
| E 吸收方现状地图 | — | 14 个包的依赖图、Loop/Behavior/Context/Policy/Runtime/Benchmark/Telemetry |

汇总阶段回源修正了两处容易误传给实施者的表述：

1. `BehaviorIR` 实际位于 `packages/behavior/src/ir/BehaviorIR.ts`，不在 `src/` 根目录；编译器在 `src/compiler/`。
2. Vessel 的 `engine/selection.ts` 与 Harness² 的 `core/selection.py` **同名不同义**。前者是 `selectTaskFor`（任务 → 类别 → preset 路由），后者是候选匿名化选优。任何移植都必须改名，否则后续维护会持续误读。

---

## 3. 建议吸收清单（按优先级）

优先级判据：`收益 × 确定性 ÷ (改造成本 + 风险)`。P0 为纯增量、不触碰行为语义；P1 需要设计或接线；P2 收益间接。

### P0-1 判分失败不计 0（ungraded 语义）

动机。Vessel 的 `RunResult.metrics.success` 承担了两个互不相同的含义：`runner.ts` 侧是"断言行全过"，`contracts/vessel.ts` 侧是"没抛错且 finalText 非空"。`docs/RELEASE-GATES.md` 已经指出 gate 的 passed 与具体场景判据之间存在落差。于是"判分器崩了"和"真的没通过"在数据上不可区分，成功率会被系统性拉低。

Harness² 的机制。`core/judge.py` 用 `graded=False` / `frac=None` 表达未判分，模块顶部明写"judge 失败是 None，不是 0，且 None 从分母中剔除"；`core/report.py:summarise` 的分母只取 graded 行，`n_ungraded` 单列。

Vessel 落点与改法。
- `benchmarks/runners/src/contracts/types.ts`：新增**可选**字段 `score?: { n_passed: number; n_criteria: number; all_pass: boolean; graded: boolean; reason?: string }`，与 `metrics` 并列，不改动既有 14 项必填字段。
- `benchmarks/runners/src/contracts/validate.ts`：校验 `graded === false` 时 `n_passed`/`n_criteria` 可为 0 但不参与聚合；保持 fail-loud 风格。
- `benchmarks/runners/src/report/report.ts`：`deriveSummary`（当前第 308 行）与 `aggregateRows`（当前第 344 行）增加 `ungraded` 计数；`successRate` 分母改为 `passed + failed`（即 graded 数），`pending`/`skipped` 维持现状。
- `docs/BENCHMARK-SPEC.md` §2.4：补"每个 run 的判分结果字段"。

前置条件。先定清三态边界：`ungraded`（判分器失败/未运行）、`pending`（环境未就绪）、`skipped`（能力不支持）互不重叠。Vessel 已有 pending/skipped 语义，这是最容易出现两套统计标准的地方。

风险。契约加字段会连带五个外部 adapter、`benchmarks/runners/src/release-gates/gates.ts` 的精确枚举计数、以及部分 snapshot 测试。建议按"可选字段 + 缺省视为 graded=true"处理，把破坏面压到零。

验收信号。构造一个判分器抛异常的 fixture，报告里出现 `ungraded=1`，`successRate` 与不含该行时完全相同。

工作量。契约 + 聚合 + 文档，约 0.5–1 人日；补测试 0.5 人日。

---

### P0-2 读边界防泄漏

动机。benchmark 的价值取决于被测评的 harness 看不见判据。Vessel 现在是 `copyDir(fixtureDir, workspace)` 整包复制（`benchmarks/runners/src/runner.ts:866`），fixture 里任何 `RUBRICS.json`、`tests/**`、`solution/**` 都会一并进入工作区。目前只有 B003 的 `hidden` 是"run 后注入"（同文件 971 行附近），正面方向没有闸。

Harness² 的机制。三层：
- `BenchSpec.leak_globs` 由 `context.assert_no_leak_paths` 在复制时过滤，并在 `context.build` 末尾整体复查；
- `context.assert_no_grader_verdicts` 用 `GRADER_VERDICT_MARKERS` 扫文件名与正文；
- `recursion._accept_tree` 在采纳新 harness 前再跑一次 `assert_tree_has_no_grader_verdicts`，并在 `library.Library.add` 处同样拦截。

Vessel 落点与改法。
- `benchmarks/runners/src/runner.ts`：在 `copyDir` 之后、`hidden` 注入之前插入 `assertNoLeakPaths(workspace, manifest.leakGlobs)`。
- `benchmarks/runners/src/manifest.ts`：新增 `leakGlobs?: string[]`，同步 `KNOWN_KEYS` / `PASS_KEYS` 与 `spec-manifest-parity.test.ts`。
- 各 `benchmarks/scenarios/B0xx.yaml` 按需声明，不要全局默认。

风险与红线。**不要移植 Harness² 的英文词表**（`benchmark`/`evaluation`/`grader`/`rubric`/`score`）。Vessel 的判据文本是中文 yaml，且 `docs/`、`tasks/` 里正常会出现这些英文词，词表会大面积误伤。应改成"结构化白名单 + 路径 glob"，文本扫描最多作为 warn。

验收信号。故意在 fixture 放一个 `RUBRICS.json`，未声明 `leakGlobs` 时运行应报错并列出路径；声明后该文件不出现在 workspace。

工作量。1–1.5 人日（含 manifest 校验链）。

---

### P0-3 跨配置不复用缓存（harness 指纹）

动机。`runmark.py` 的 `.adapt_complete` 同时记录"这次 rollout 真的跑完了"和"产出它的 harness 长什么样"（SHA1 指纹，排除 `__pycache__`/`.pyc`）。指纹不匹配就不复用，`why_not` 给出人类可读理由。Vessel 的 `LayeredContextCache.contextDependencyHash` 只覆盖内存中的请求组装，rollout 层的 run 目录没有任何"配置身份"，改完 harness 再跑可能读到旧结果。

Vessel 落点与改法。
- 新建 `packages/engine/src/fingerprint.ts`：输入 harness 源码树（`packages/*/src`、`configs/*.yaml`、`package-lock.json` 的哈希），排除 `dist`、`node_modules`、`.harness`。
- `packages/engine/src/iteration-store.ts`：`meta.json` 的 `iterations[]` 条目**新增** `harnessFingerprint?: string`（不要改既有字段语义，保持回放兼容）。
- `benchmarks/runners/src/runner.ts`：run 结束时写入标记文件（如 `<runDir>/.run-complete.json`，含 `version` 与 `fingerprint`），resume 读取时校验。

风险。
- 指纹粒度。算得太细（含时间戳、锁文件变动）会天天失效，等于没有缓存；只算 harness 源码树 + 行为/策略配置即可。
- Vessel 的存储根是分裂的：session 在 `<workspaceRoot>/.harness/sessions/<id>`，iteration/handoff 在 `~/.vessel/*`。单一指纹无法统一失效，**先只作用于 benchmark run 目录**，不要一次改全部。

验收信号。同一 harness 连跑两次命中缓存；改一行 `configs/behavior.default.yaml` 后第二次强制重跑。

工作量。原型 1 人日，接入 runner 0.5 人日。

---

### P0-4 跑前工具链门禁

动机。Harness² 的 `preflight.check` 在第一次 rollout 前强制调用，且做两件 Vessel 现在没做的事：依赖按 `DEPENDENCY_PINS` 钉死、用 `git apply --reverse --check` 验证补丁确实在位（`install.clone` 拒绝 HEAD ≠ pin）。

Vessel 现状。`probeCodexEnv`（`benchmarks/runners/src/adapters/codex.ts:136`）只判断 `--version` 能退出 0；`docs/RELEASE-GATES.md` 已经指出仅凭退出码无法区分版本。`apps/cli/src/commands/doctorCommand.ts` 已有 `DoctorCheckItem { name, category, status, message, remedy }` 这套结构，但没有"外部 CLI 版本 = 预期"和"派生配置未过期"两项。

Vessel 落点与改法。
- 新增 `configs/tool-pins.json`：`{ "codex": ">=0.144 <0.146", "opencode": "..." }`。
- `benchmarks/runners/src/adapters/*.ts` 的 `probe*Env`：解析 `--version` 并与 pin 比对，返回 `{ ok, found, expected, remedy }`。
- 复用 `doctorCommand` 的检查项结构，新增 category `toolchain`；`runner.ts` 在 prepare 阶段调用，失败则整批 `pending-environment` 而非 failed。

风险。CI 机器通常没有外部 CLI。门禁必须能返回"skip/pending"，不能直接红；否则 CI 天天挂。

验收信号。故意改 `tool-pins.json` 的版本范围，跑 benchmark 应先报 pending 并给出 remedy，而不是跑到一半失败。

工作量。1 人日。

---

### P1-1 把 `ExecutionRun` 接进 `LoopEngine`（预算合流）

这条严格说不是"从 Harness² 吸收"，而是借它的 `ledger.py` 反照出 Vessel 自己的缺口。事实：`packages/engine/src/execution-run.ts` 的 `ExecutionRun` 是唯一同时实现 token、成本、步数、连续错误配额的对象，但它只被 `packages/application/src/ExecutionLoop.ts` 和自身测试引用；`LoopEngine.ts` 只 import 了 `EvaluatorVerdict`、`RunControl` 和 `StagnationBreakError`，一次都没碰 `ExecutionRun`。也就是说，迭代层的"预算"目前只有 `maxIterations` / `maxRetries`（默认 1/1）。

改法。在 `LoopEngine` 的 iteration 边界注入 `ExecutionRun`（构造参数可选，缺省不改变现有行为），让每轮 generate/evaluate 的调用计入同一份预算；`iteration-store` 的 `meta.json` 记录该轮的预算快照与耗尽原因。

不要照搬的。`ledger.py` 的 `assert_identity` 会硬断言 `R=4k`、`P=3k`，那是论文的成本恒等式。Vessel 只应做"记录 + 越界 warn"，不做硬断言。

风险。与"默认自治 1/1"的硬约束不冲突（预算是上限，不是自动放宽），但要在 UI/CLI 上把"为什么停"暴露出来，否则用户会以为卡死。

工作量。1.5–2 人日。

---

### P1-2 候选匿名选优

动机。单候选无法回答"这一版到底比上一版好在哪里"，只会得到"看起来更完整"。Harness² 的 `selection.py` 用 `sha1(task|k|mode)` 稳定洗牌做匿名，先丢弃无产物候选，只让 k 个 final 进池，基线不进池——防止"把自己和空跑比"。

改法。新建 `packages/engine/src/candidate-selection.ts`（**必须避开 `selection.ts` 这个名字**）。输入是同一任务的多份运行产物 + 各自 rollout，输出是排序与选择理由。协议部分可借鉴 ````choice`、`<why>`、`<edits>` 的结构化回复约定，但要用 TypeScript 类型约束而非正则兜底。

前置条件。Vessel 目前是单候选执行形态，需先有"同一任务跑 N 份、产物不截断保留"的运行入口。这一步比选优本身贵。

风险。判据主观。必须先固定 k 与种子，否则结果不可复现。

工作量。入口 2 人日 + 选优 1.5 人日。

---

### P1-3 经验库接线（suggest-only）

现状。`packages/memory/src/learned/LearnedStore.ts` 的 suggest → approve → reject 闸门已经完整，但除 `index.ts` 导出和自身测试外**没有任何消费方**；`packages/memory/src/reflection/autonomousReflection.ts` 已经接在 `packages/application/src/compose.ts` 的 `after_turn` / `team_end` 事件上。

Harness² 的对照。`core/library.py` 存整棵树 + `EXPERIENCE.md`，`has_experience` 要求 cue/lesson/evidence 三项全非空，`INDEX.md` 从磁盘重建，每个 run 的库互相隔离。

改法。只吸收"入库必须有 cue/lesson/evidence 三要素"这条质量门，**不吸收自动入库**。落点 `packages/application/src/compose.ts` 的反思回调：把 reflection 结论转成 `LearnedStore.suggest()`，由用户 approve 后才进入后续 prompt。

红线。Vessel 的硬约束是"自动学习只能 suggest"（`docs/ARCHITECTURE.md` 相关节与 `docs/DESIGN-DECISIONS.md`）。Harness² 的自动采纳**不能**照搬。

工作量。1 人日。

---

### P1-4 可编辑面值化（SurfaceSpec 的最小版）

动机。Harness² 把"不同 agent 框架的差异"全部压成 `SurfaceSpec` 数据（路径、上限、frontmatter 规则、README 种子），并让 `INSTALL_MODES` 成为显式枚举，`BenchSpec.__post_init__` 直接校验。它的 docstring 写得很清楚：换安装方式 = 移动该 benchmark 的基线。

改法。Vessel 只有自托管 `composeHarness` 一种方式，**先只支持一种**，但把它声明成值：`{ name, alwaysOn, installMode, caps }`，放进 `packages/behavior/src/` 或 `packages/application/src/behavior/`。目的是让"改 harness 的哪一部分"有类型可依，为 P1-2 提供输入。

不要做的。四种 install mode（`workspace_agents_md` / `home_dir_jinja` / `workspace_config` / `codex_root`）全搬。Vessel 没有对应 benchmark 支撑，多出来的模式只会变成无人维护的死代码。

工作量。1 人日。

---

### P1-5 resume 目录契约

动机。Harness² 的 `schedule._resume` 逐项复核：status 为 ok、每个请求 mode 有 `chosen_label`、run dir 存在、artifact 非空、`artifacts_intact`、harness tree 在、`harness_fingerprint` 匹配。任一项不满足就不复用，而不是"文件在就算完成"。

改法。在 `benchmarks/runners/src/runner.ts` 的 resume 路径把上述检查函数化，与现有 runDir 布局对齐。Vessel 缺 `artifacts_intact` 的等价物，需要先定义"产物完整"的判据（文件存在 + 非空 + 可选哈希）。

不要做的。`fcntl.flock`。那是 POSIX-only，Vessel 已有 `.lease` 机制（`packages/core/src/session/Session.ts`），Windows 上必须走它。

工作量。1 人日。

---

### P2 级（收益间接，按需再做）

P2-1 三轴分离写进文档。method / substrate / benchmark 三个轴互不引用，`BenchSpec` 是值不是代码路径。Vessel 的 `docs/BENCHMARK-SPEC.md` 已有类似分层但没写成约束，补一节即可，零代码风险。

P2-2 依赖完整性清单。`harness2/scripts/check_provenance.py` 对 47 个依赖逐项 sha256。Vessel 的 `spec-manifest-parity.test.ts` 只校形状不校内容。可在 release gate 8 补一份 fixtures/scenarios 的 sha256 清单。注意 Vessel 的 `benchmarks/runners/src/release-gates/gates.ts` 对 criterion 有精确断言，新增清单要单独成一个 gate 文件，不要改动既有 8 门。

P2-3 i18n 只搬机制。Vessel 现状是三套割裂：CLI 只有 `vessel guide --locale`（`apps/cli/src/commands/guideCommands.ts`，默认 zh），Web 有独立 `apps/web/src/i18n.ts`，CLI 主输出硬编码中文且没有全局 `--lang`，`--lang en --help` 目前会被当成未知 flag。值得搬的三件：参数解析前预扫描（Harness² `i18n.py:bootstrap`，让 `--help` 也本地化）、`t()` 的三级回退（`en` → key 原样）、占位符与协议记号的 parity 测试（`tests/test_i18n.py` 的做法）。骨架约 0.5–1 人日，抽取 + 双语校对 3–5 人日。**不要**合并 Web 与 CLI 的 catalog（node vs browser、`settings.json` vs `localStorage`，合并必炸）。

---

## 4. Harness² 机制速查（供实施时对照，不必通读源码）

| 机制 | 位置 | 一句话 |
|---|---|---|
| 并行递归 | `core/recursion.py:run_parallel` | k 份 INV/DOM 各改一版，再 k 次 agg 合成 |
| 顺序递归 | `core/recursion.py:run_sequential` | 每轮以当前 harness 前推，`compose_round` 产出 checkpoint，回答 KEEP_BASE 即保留 |
| 提议校验与重试 | `recursion._accept_tree` / `_run_stage` | 三重校验（结构/编译、benchmark 不变量、无判分泄漏），失败回灌错误重试一次，仍败则退回基线 |
| 匿名选优 | `core/selection.py` | `sha1(task\|k\|mode)` 洗牌；剔除无产物候选；基线不入池 |
| 经验库 | `core/library.py` | 存整棵树 + EXPERIENCE.md；cue/lesson/evidence 三要素；按 run/mode/domain 隔离 |
| 预算恒等式 | `core/ledger.py` | `R=4k`、`P=3k`；写前查重复 label；不吻合即抛 |
| 证据落盘 | `core/context.py` | 轨迹全文写文件，mission 只给路径与规则；只在单条 observation 截断 |
| 防泄漏断言 | `context.assert_no_grader_verdicts`、`assert_no_leak_paths` | 复制时过滤 + 构建末尾复查 + 采纳前再查 |
| 完成标记 | `core/runmark.py` | `.adapt_complete` 含版本 + harness 指纹；不匹配不复用 |
| 判分与选择解耦 | `core/judge.py` | 方法层不 import 判分；None 不是 0，也不进分母 |
| 断点续跑 | `schedule._resume` | 七项逐一复核，缺一不复用 |
| 三轴分离 | `core/spec.py` | method / substrate / benchmark 互不引用，`BenchSpec` 是值 |
| 外部 CLI 抽象 | `substrate/base.py` | `surface / materialise / execute / read_trajectory / preflight`；launcher 由 adapter 注入 |
| 安装方式即基线 | `spec.py:INSTALL_MODES`、`substrate/*.py` | 换 install mode = 移动基线，必须显式声明 |
| 成本记账到失败 | `core/proposer.py` | `ProposerError(message, attempts, cost_usd)`，失败尝试的成本也带出来 |
| 依赖钉死 | `config.py:DEPENDENCY_PINS`、`preflight.py` | clone 拒绝 HEAD≠pin；`git apply --reverse --check` 验补丁 |
| i18n | `i18n.py`、`locales/*` | 解析顺序 `--lang` → env → en；argparse 前预扫描使 `--help` 本地化 |

---

## 5. Vessel 现状核对（能力矩阵）

| 能力项 | 现状 | 关键文件 | 备注 |
|---|---|---|---|
| 自迭代闭环（改自身 harness 再验证） | 缺失 | `packages/engine/src/LoopEngine.ts` | 全仓未发现运行时写入 `configs/behavior.default.yaml` / `policy.default.yaml` 的代码，也无"自调参 → 回归验证"的环 |
| 迭代证据持久化 | 已有 | `packages/engine/src/iteration-store.ts` | `meta.json` 追加式，存 generator/evaluator 快照、verdict、transition；单进程原子写 |
| 预算账本 | 半成品 | `execution-run.ts`、`run-control.ts` | `ExecutionRun` 存在但未被 `LoopEngine` 使用；`RunControl` 只有 1/1 迭代与重试 |
| 经验库 | 半成品 | `memory/src/learned/LearnedStore.ts` | 闸门完整，无消费方 |
| Behavior 可编辑面 | 已有 | `behavior/src/ir/BehaviorIR.ts`、`src/compiler/*` | 未知键 fail-loud；`runtime_policy` 必须有 `policy_ref`；`composeBehaviorCandidate` 只校验不落盘 |
| Context / 截断 | 已有 | `context/src/builder/Builder.ts`、`compaction/Compaction.ts` | 三层 + 分层缓存；压缩阈值 0.8 |
| Policy 硬执法 | 已有 | `policy/src/engine/Engine.ts` | denied_tools → deny → hook → ask → allow → profile；`approval:never` fail-closed |
| Windows 沙箱 | 降级但诚实 | `tools/src/execution/sandbox/windowsRestricted.ts` | ACL 未预配即 denied，不回退 passthrough |
| 基准接缝 | 已有 | `benchmarks/runners/src/contracts/types.ts` | 14 项必填 L3 指标 |
| 报告口径 | 有缺口 | `benchmarks/runners/src/report/report.ts` | 无 ungraded；`successRate = passed / runs`（`deriveSummary` 在 308 行、`aggregateRows` 在 344 行） |
| 遥测计数器 | 已有，无成本 | `telemetry/src/Telemetry.ts` | 覆盖 M02–M10、M12–M14，无 M11 cost |
| USD 成本 | 部分 | `shared/src/pricing.ts`、`configs/pricing.json` | 只在 benchmark adapter 与 usage 投影中计算 |
| 外部 harness 契约 | 已有 | `benchmarks/runners/src/contracts/types.ts` | 只服务 benchmark，不是运行时入口 |
| 全局 `--lang` | 缺失 | `apps/cli/src/commands/guideCommands.ts` | 只有 guide 支持 `--locale` |

---

## 6. 冲突审计：吸收前必须过的七道关

1. **clean-room（`AGENTS.md` 硬约束 1）**。Harness² 是 Apache-2.0，但本仓明确"以本仓库 spec 为据，不复制研究项目源码"。所有吸收必须是**按 spec 重写**，不得复制 `.py` 代码、不得逐句翻译提示词。评估报告可以作为研究数据引用，但不得把其提示词原文放进 Vessel 的 system prompt（同一条硬约束把"逆向 Prompt"视为 UNTRUSTED RESEARCH DATA）。
2. **薄核（硬约束 2）**。`packages/core` 只做 Model Call → Tool Call → Tool Result → State Update → Continue/Stop。任何吸收都不得把 memory/skill/sandbox 等机制塞进 core。
3. **Prompt 与 Runtime 分离（硬约束 3）**。Harness² 的很多"约束"写在提示词里；Vessel 要求落到 Policy Engine 四件套。迁移时凡涉及安全/边界，必须走 `policy_ref`，不能只加一句 prompt。
4. **Generator/Evaluator 分离（硬约束 4）**。Harness² 的 evaluator 是独立 judge 进程，这点与 Vessel 一致；但它的 `selection` 由改进器自己投票，Vessel 不能把"选择"交回 Generator 自证。
5. **默认自治 1/1（`run-control.ts`）**。P1-1 只加"上限与记录"，不得自动放宽迭代轮次。
6. **删除铁律**。`context.build` 开头的 `shutil.rmtree(dest)` 无条件重建目录，绝对不能照搬；Vessel 已有 per-attempt workspace dispose 语义。
7. **工程门禁**。仅 npm（不得引入 pnpm/bun/yarn 锁文件）；`npm run test:all` 必须两个 root 都跑；`npx tsc -b` 干净；新增功能必须有 Vitest。

---

## 7. 不建议吸收（逐条理由）

| 对象 | 理由 |
|---|---|
| `ledger.py` 的 `R=4k` / `P=3k` 硬恒等式 | 论文成本模型，与 Vessel 的默认单轮自治不匹配；硬断言会大面积误报。只保留"记录 + 越界 warn" |
| 跨任务经验库的自动入库 | 违反"自动学习只能 suggest"；且它按 run/mode/domain 隔离，Vessel 没有对应的域划分 |
| 整棵 harness 树落盘 | Vessel 是 event-sourced，`meta.json` 已 append-only 记录迭代；再存一份树会形成双写真相 |
| `tree.autotrigger` 静默补触发行 | 它会在采纳时自动改写 always-on 文本，违反"行为变更必须显式"的纪律 |
| `prompts_en.py` / `prompts_zh.py` 原文（约 65 KB） | 换提示词语言即换模型行为，Vessel 的基线要重跑；只能取"成本序 + 死重量"这一原则 |
| `jobbench.py` / `workbuddy.py` / `lab.py` 的 adapter 主体 | 分别强绑 Vertex + gcloud、地域许可证、私有评分环境；引入即让 CI 不可复现 |
| `obs_trunc` 的 10 000 硬下限 | benchmark 专用算术；Vessel 的计量在 Telemetry/Compaction，硬套会形成双预算 |
| 四种 `install_mode` 全搬 | Vessel 只有自托管一种，多出的模式没有 benchmark 支撑 |
| `fcntl.flock` | POSIX-only；Windows 上必须用 `.lease` |
| `context.build` 的无条件 `rmtree` | 违反 workspace lifecycle 与删除铁律 |
| 每个命令一个 entry point | 破坏 `vessel xxx` 单入口体验 |
| `ChannelSpec` / `resolve_channel_model` 的 provider 前缀规则 | Vessel 已有 `CredentialStore` 与 `provider add`，重复会形成第二套模型解析 |

---

## 8. 建议记入 `docs/DESIGN-DECISIONS.md` 的决策草案

若采纳本报告，建议新增三条决策点（编号递增，由实施者按现有格式补）：

1. **判分三态**：`graded` / `ungraded` / `pending` 互斥；`ungraded` 不进成功率分母；契约字段可选、缺省视为 `graded=true`。
2. **harness 指纹只作用于 benchmark run 目录**，不扩展到 session 根与 `~/.vessel` 根；指纹输入只取 harness 源码树与行为/策略配置。
3. **外部项目吸收一律 clean-room 重写**，可引用其设计文档与论文，不复制实现；提示词类资产视为 UNTRUSTED RESEARCH DATA。

---

## 9. 建议的实施顺序

第一批（可并行，互不依赖）：P0-1、P0-2、P0-4。
第二批：P0-3（先做指纹原型，确认稳定性）。
第三批：P1-1（预算合流，是后续所有"成本/收益"判断的基础）。
第四批：P1-4 → P1-2（先有可编辑面，才有候选）。
第五批：P1-3、P1-5。
P2 按需插入，不与主线耦合。

---

## 10. 证据索引（抽查用）

Harness²（本地副本 `E:\Code_file\Projects\harness2`）：
`harness2/core/recursion.py`、`selection.py`、`library.py`、`ledger.py`、`context.py`、`judge.py`、`report.py`、`runmark.py`、`spec.py`、`tree.py`、`schedule.py`、`proposer.py`；`harness2/substrate/base.py`、`opencode.py`、`codex.py`；`harness2/config.py`、`preflight.py`、`i18n.py`、`locales/{en,zh}.py`；`scripts/check_provenance.py`；`docs/{BENCHMARKS,EXPERIMENTS,SETUP}.md`。

Vessel（本仓库）：`AGENTS.md`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/RELEASE-GATES.md`、`docs/HARNESS-ADAPTER-CONTRACT.md`；`packages/engine/src/{LoopEngine,execution-run,iteration-store,run-control,selection}.ts`；`packages/behavior/src/{ir/BehaviorIR.ts,compiler/*}`；`packages/context/src/builder/Builder.ts`；`packages/memory/src/{learned/LearnedStore.ts,reflection/autonomousReflection.ts}`；`packages/application/src/{behavior/composeDraft.ts,compose.ts}`；`benchmarks/runners/src/{runner.ts,manifest.ts,contracts/types.ts,report/report.ts,release-gates/gates.ts}`；`apps/cli/src/commands/{doctorCommand.ts,guideCommands.ts}`；`configs/{behavior.default.yaml,policy.default.yaml,pricing.json}`。
