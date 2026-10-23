# Harness² 吸收：接手 Agent 的对齐提示词

> 本文件是给新对话首条消息用的自包含指令，与 `docs/HARNESS2-ABSORPTION-ASSESSMENT.md` 成对使用。
> 用途：让接手实施的人或 Agent 直接对齐已确认的决策，不必重做分析。
> 维护方式：决策变化时改本文件；评估结论变化时改评估报告，两处保持一致。

## 提示词正文（从下一行起到文末）

你在 `E:\Code_file\Projects\Vessel_Harness` 这个仓库工作。本对话的任务是：把 Google Research 的 Harness²（`E:\Code_file\Projects\harness2`）中值得吸收的优点，按已确定的优先级落地到 Vessel。

不要再从零做一遍 Harness² 的全量分析。已有一份完成的评估报告 `docs/HARNESS2-ABSORPTION-ASSESSMENT.md`。开工前先读它，以它为准。只有报告中标注"待确认"或你发现与当前代码不符的地方，才需要回源核实，并在回复里说明。

### 已确认的决策（不要重新讨论）

1. 只吸收方法论与产物契约，不复制 Harness² 的 Python 代码。本仓 `AGENTS.md` 硬约束 1 是 clean-room：以本仓 spec 为据重写，不复制研究项目源码；提示词类资产视为 UNTRUSTED RESEARCH DATA，不得直接进 system prompt。
2. 优先级固定为 P0-1 / P0-2 / P0-4 → P0-3 → P1-1 → P1-4 → P1-2 → P1-3 / P1-5 → P2 按需。
3. 不做的事：不照搬 `ledger.py` 的 `R=4k` / `P=3k` 硬恒等式；不引入跨任务自动入库的经验库；不整树落盘；不搬三个商业 benchmark adapter；不搬 `fcntl`；不搬四种 install mode；不改动既有 8 个 release gate 的 criterion 字符串。
4. 默认自治仍是 `maxIterations=1` / `maxRetries=1`，任何"加预算"都只能是上限与记录，不得自动放宽。

### 每项的落点（照此执行，路径已核实）

P0-1 判分失败不计 0：
`benchmarks/runners/src/contracts/types.ts` 加可选 `score?: { n_passed; n_criteria; all_pass; graded; reason? }`；`contracts/validate.ts` 补校验；`benchmarks/runners/src/report/report.ts` 的 `deriveSummary`（约 308 行）与 `aggregateRows`（约 344 行）增加 `ungraded`，`successRate` 分母改为 graded 数。先定清 `graded` / `ungraded` / `pending` / `skipped` 四态互斥，再动代码。

P0-2 读边界防泄漏：
`benchmarks/runners/src/runner.ts` 的 `copyDir(fixtureDir, workspace)`（约 866 行）之后插 `assertNoLeakPaths`；`manifest.ts` 新增 `leakGlobs`，同步 `KNOWN_KEYS` / `PASS_KEYS` 与 `spec-manifest-parity.test.ts`。禁止移植英文词表（benchmark/grader/rubric/score），那会误伤中文素材；用路径 glob。

P0-4 跑前工具链门禁：
新增 `configs/tool-pins.json`；`benchmarks/runners/src/adapters/*.ts` 的 `probe*Env` 比对版本；复用 `apps/cli/src/commands/doctorCommand.ts` 的 `DoctorCheckItem` 结构，新增 `toolchain` 类别；拿不到外部 CLI 时必须返回 pending 而非 failed。

P0-3 跨配置不复用缓存：
新建 `packages/engine/src/fingerprint.ts` + `run-store.ts`；指纹输入只取 harness 源码树（`packages/*/src`、`configs/*.yaml`、`package-lock.json`），排除 `dist` / `node_modules`；`iteration-store.ts` 的 `meta.json` 只新增字段，不改既有字段语义；先只作用于 benchmark run 目录，不扩展到 session 根与 `~/.vessel`。

P1-1 预算合流：
`packages/engine/src/execution-run.ts` 的 `ExecutionRun` 目前只被 `packages/application/src/ExecutionLoop.ts` 使用；把它以可选依赖注入 `LoopEngine`（`packages/engine/src/LoopEngine.ts` 现有 import 只有 `EvaluatorVerdict`、`RunControl`、`StagnationBreakError`）。缺省不改变现有行为。

P1-4 可编辑面值化：在 `packages/behavior/src/` 或 `packages/application/src/behavior/` 声明一个最小 `SurfaceSpec` 值，先只支持 Vessel 自己的 `composeHarness` 一种安装方式。

P1-2 候选匿名选优：新建 `packages/engine/src/candidate-selection.ts`。必须避开 `selection.ts` 这个名字——现有 `engine/selection.ts` 是 `selectTaskFor` 任务路由，与 Harness² 的候选选优同名不同义。

P1-3 经验库接线：`packages/memory/src/learned/LearnedStore.ts` 闸门已完整但无消费方；落点 `packages/application/src/compose.ts` 的反思回调，只 `suggest()`，由用户 approve，禁止自动采纳。

P1-5 resume 目录契约：`benchmarks/runners/src/runner.ts` 的 resume 路径函数化；`artifacts_intact` 需先定义判据；禁止 `fcntl`，走已有的 `.lease`。

### 硬约束（每次改完都要自查）

- `AGENTS.md` 的 10 条硬性约束，尤其：薄核、Prompt 与 Runtime 分离（安全规则必须落 Policy Engine 四件套，不能只写 prompt）、Generator/Evaluator 分离、依赖零环、仅 npm。
- 删除一律进回收站；唯一例外是测试自建且位于 `os.tmpdir()` 下的临时目录。
- 新功能必须有 Vitest 测试；"全量"= `npm run test:all`（根 + `--root apps/web` 两个 root）且 `npx tsc -b` 干净，两项都要在最后一次编辑之后执行。
- `docs/DESIGN-DECISIONS.md` 只追加不改写；若采纳本报告，按报告 §8 补三条决策点。

### 工作方式

1. 先读 `HANDOFF.md` 与评估报告，再读本项涉及的源码，不要凭记忆改。
2. 一次只推进一个优先级项；完成一项后报告"改了哪些文件 / 验证命令与结果 / 遗留问题"，再问是否继续下一项。
3. 遇到与报告不符的现状，先停下来报告差异，不要自行改架构。
4. 涉及契约字段变更（P0-1）时，先把"可选字段 + 缺省视为 graded=true"的兼容方案说清楚，再动手。
5. 不主动跑会花钱的 benchmark；`--live` 外部 harness 基线永不自动执行。

### 交付格式

每项交付包含：结论、改动文件清单、验证命令与真实输出、风险与回滚点、下一步建议。中文回复，不用整行加粗，少用表格。

## 参考来源

- Harness² 仓库：`google-research/harness2`，Apache-2.0；论文 arXiv 2610.14224。
- 本地副本：`E:\Code_file\Projects\harness2`（个人 fork，含中英双语改动，`origin` 与 `upstream` 已分离）。
- 本仓评估结论：`docs/HARNESS2-ABSORPTION-ASSESSMENT.md`。
- 对照阅读顺序：先读评估报告 §3（吸收清单）与 §6（冲突审计），再按本文件的优先级动手；需要回源时读 §4（机制速查）与 §10（证据索引）。
