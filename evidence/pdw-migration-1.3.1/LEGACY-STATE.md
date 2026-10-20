# 旧 PDW 状态存档与续接台账（LEGACY-STATE）

> 用途：personal-dev-workflow 1.3.1-local 运行器**不读取**旧版状态。本文件把旧状态整理成可人工接手的形式，
> 保留原始记录、明确「哪些是已验证的旧结论、哪些仍未完成」，并说明**不做自动转换**。
> 生成时间：2026-10-16。迁移来源与验证见同目录 `MIGRATION.md` 与 `validation/`。

## 0. 真实性边界（先读这段）

- 旧控制器 = `personal-dev-workflow` v1.0.0 自带脚本 `.agent-state` 控制器（`scripts/runstate.js`）。
  权威依据：新版 `references/runtime.md` 明写「不再把旧 run-state 计数当作这套新调度器的状态源」。
- **没有自动转换工具。** `.agent-state/run-state.json`、根 `RUN_STATE.md`、`tasks/*.md` 的预算/状态**不能**冒充
  新版 `.pdw/tasks/<id>/state.json`。本次迁移**未**伪造任何 `.pdw/tasks` 条目、**未**写入 `accepted_local`。
- 旧版「已验收 / accepted」结论**只对当时的产物与其 commit 有效**；它**不能**批准之后任何新修改
  （PDW 1.3.1 的 `accepted_local` 要求「复核期间产物未变化」，源码/契约漂移即失效）。
- 旧预算**不会被重置或绕过**：旧余额原样记在下面；新任务用**每卡冻结**的独立限额，二者不混算。

## 1. 冻结快照（原始记录，未删改）

原文件**保持在原位**（`.agent-state/`、`RUN_STATE.md`、`tasks/`），另在 `backup/` 留一份迁移时点的只读快照：

| 快照文件 | 原路径 | 迁移时点 SHA-256 |
|---|---|---|
| `backup/run-state.json.pre-migration` | `.agent-state/run-state.json` | `dc9f77a1e1c2b6f1961c10c963c36b8e311a4fbb43bd0eafb57bf228bbe61a36` |
| `backup/RUN_STATE.md.pre-migration` | `RUN_STATE.md` | `9d96e32c7abb887c2040269cc453fcda691b0295c6d8069f7964e3eef500078b` |
| `backup/AGENTS.md.pre-migration` | `AGENTS.md` | `e99f95fa7e09cf9077d7cbe2b9694fe081bb956d5f98ad00a7a1512223736633` |
| `backup/gitignore.pre-migration` | `.gitignore` | `5dab05fecdfb89426e96d563ec9b0e5d0412737197f63937be165bdc28397191` |
| `backup/personal-dev-workflow-v1.0.0/`（27 文件） | `.agents/skills/personal-dev-workflow/`（已移出） | 见该目录内 `MANIFEST.sha256` |

注意：迁移时 `RUN_STATE.md` 停在 revision 249，而 `.agent-state/run-state.json` 已到 revision 253 —— 二者**本已漂移**，
本次迁移未去「修正」同步（改旧状态=重写历史，禁止）。真实断点以 `.agent-state/run-state.json` 为准。

## 2. 当前目标（旧 Mission，原文照抄）

- **Mission**：`V2.6 Pure i18n & Visual Model Hub (Epic 214)`，旧状态 `completed`。
- **旧 Definition of Done**（7 条，均标记完成）：
  1. Task 210 Comprehensive i18n & Pure Localization implemented and verified
  2. Task 211 Local Server Provider Store & Models API implemented and verified
  3. Task 212 Web Provider Settings Modal & Connection Tester implemented and verified
  4. Task 213 Session Model Picker & Dynamic Switching implemented and verified
  5. Task 214 Epic V2.6 Master Integration & Regression passes
  6. Thin Core absolute zero modification: packages/core diff is 0 lines
  7. Dual-root tests (`npm run test:all`), tsc build, and web build exit 0
- **旧 Out of scope**：External Agent real execution；Git push（纯本地，2026-10-06 规约）；永久删除；修改 `packages/core`。

> 说明：旧 Mission 之后还有未登记进 `run-state.workset` 的后续交付（Card 215–222，以及未提交的 Card 223）。
> 它们的权威记录在 `tasks/` 与 `evidence/sessions/`，不在旧 run-state 的 workset 里。

## 3. 已完成工作与其原始证据（引用，不重抄）

旧 `workset` 共 13 项全 `completed`（210–222）。逐项业务证据在仓库现成位置：

| 范围 | 权威证据 |
|---|---|
| V2.6 Epic 214（210–214） | `evidence/sessions/2026-10-11-v2.6/PROOF.md`、`accepted-gates.json`、`completion-audit.json` |
| Card 215 模型拉取/Schema | `evidence/sessions/2026-10-11-card215/PROOF.md` |
| Card 216 Archify 架构可视化 | `tasks/216-archify-architecture-visualization-and-doc-drift-repair.md`、`docs/diagrams/` |
| Card 217 / 218 / 219 / 220 / 221 / 222 | `evidence/sessions/2026-10-1{2,3,4}-card2xx/PROOF.md` |
| 历史 v2.3–v2.5 | `evidence/sessions/2026-10-08-v2.3/`、`2026-10-09-v2.4/`、`2026-10-10-v2.5/` |
| 冻结 Mission 档案 | `evidence/missions/mission-0{2,3}/RUN_STATE.md`、`run-state.json` |

旧 `lastVerifiedCommit`：`bd4a0b8`（run-state）/ `dd8e72c`（RUN_STATE.md，已漂移）；迁移时 `HEAD = c7dc8e2`（`main`）。
**迁移未提交、未推送任何内容。**

## 4. 未完成事项（真实断点，未伪造完成）

1. **在飞交付：任务卡 223** — `tasks/223-web-ui-visual-overhaul-and-design-skills.md`。
   状态：`apps/web` 视觉重构 P1–P8 已落地**未提交**（迁移时 `git status` 有 13 个已改文件 + 若干未跟踪文件）。
   PDW 1.3.1 **没有**为它建任何 `.pdw/tasks` 条目 —— 它属于旧/手工会话流程，需人工决定是否转为 PDW 卡。
2. **旧协调者/Worker**：迁移时**无活动协调者、无 Worker、无 `run.lock`**（`.agent-state/run-state.json` 的 `workers.active: 0`；
   `.dsh-mission` 与 `epic167/epic174` 状态文件全 `completed`）。因此**不存在两套运行器争抢同一任务**的场景；无需切换动作。
3. **HANDOFF 未完成清单**（人工项 U1–U5、可推进项 A1–A4）原样保留，见 `HANDOFF.md` §3，本次未改动其内容。

## 5. 预算（旧口径，原样保留；不继承、不重置）

旧 `run` 级（至 `.agent-state/run-state.json` revision 253）：

| 项 | 已用 / 上限 | 余量 |
|---|---|---|
| epoch | 0 / 3 | 3 |
| cards | **10 / 10** | **0（已耗尽）** |
| repairs | 2 / 5 | 3 |
| workersSpawned | **10 / 10** | **0（已耗尽）** |
| research | 0 / 2 | 2 |
| activeWorkers（gauge） | 0 / 3 | 3 |
| maxSubagentDepth | — | 1 |

旧 `mission` 级：runs `1 / 8`（余 7）、cards `10 / 20`（余 10）、repairs `2 / 15`（余 13）。

**新版如何记账**：PDW 1.3.1 的限额是**每张任务卡在 `new` 时冻结**的上限（`.pdw/config.json` 当前给
`max_cli_calls 8` / `max_repairs 1` / `call_timeout 600s` / `task_timeout 3600s`），在卡内计
`calls_used / repairs_used / elapsed_ms`，**换对话不重置**。它**不是**旧余额的延续，因此：
- 不要拿旧「余量」去放宽新配额，也不要用新配额掩盖旧限额已耗尽的事实；
- 若新任务实际需要更多调用，按 SKILL 让协调者**显式**在契约/卡上写明理由后再定，而不是默默跨卡共享。

## 6. 需要继续旧工作时怎么做（不建议「续写旧状态」）

1. 需要继续的**业务目标**从 §2/§3/§4 取，**不要**把旧 run-state 当即可续跑的机器状态。
2. 用 PDW 1.3.1 建**新**卡：写契约 JSON（`goal` / `mode` / `scope` / `acceptance` / `checks`）→ `new --from`。
   把 §2 的 DoD 或 §4 的在飞目标转成 `acceptance` 条目，`scope` 只列真正要动的路径。
3. 旧证据（PROOF.md 等）在新卡里只作**输入引用**；「旧已通过」**不**等于新产物通过 —— 新卡必须真实跑 `checks` + 独立复核。
4. 任务卡 223 若转为 PDW 卡：先提交或冻结当前 `apps/web` 工作树，再建卡；否则基线漂移会让新证据立即失效。
