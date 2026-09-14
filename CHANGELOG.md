# Changelog

本文件遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/) 风格，汇总 **V0.1 → V0.10** 里程碑。历史版本当时以内部命名 `Composable Agent Harness`（CLI 名 `cah`）开发，**V0.9 起全面更名为 Vessel**（自该版本起称 Vessel）。每个版本给出中英双语说明。

> 说明：本文件在 2026-09-13 重建 —— 原文件夹带了一段工具调用残渣，并把 `0.10.0`→`0.4.0` 重复了两遍，导致版本情况无法阅读。重建只做一件事：**去掉残渣与重复，保留两个副本中更完整的一方**（即原先排在后面的那一份），并补齐英文说明。**未新增任何未发生过的条目。**

---

## [0.10.0] - 2026-09

**产品化第一里程碑（Milestone A / Stabilization）**

### Added

- 统一产品版本号 `0.10.0`（原 `apps/cli` 的 `0.1.0` 对齐）与干净安装基线。
- 抽离 `@vessel/application` 组合根（`composeHarness`），CLI 组合入口可移植（task 037）。
- `SessionController` / `ProjectRegistry` / `SessionRegistry`：会话与应用层可编程接口，为后续本地 server/web 打底（task 038）。
- 一次性状态迁移命令 `vessel migrate`：`~/.dsh` → `~/.vessel`（数据复制 + 旧目录进回收站）。
- CLI 入口 `vessel serve`（起本地服务 `127.0.0.1:5678`，不开浏览器）与 `vessel web`（起服务并打开默认浏览器）可用（task 044）。
- 公开产品文档：`README.md`、`LICENSE`、`SECURITY.md`、`CHANGELOG.md`（task 035）。

### Changed

- 项目状态与用户配置根目录由 `~/.dsh` 迁移到 `~/.vessel`；环境变量 `CAH_*` → `VESSEL_*`（存储根 `VESSEL_PROVIDER_ROOT` 等）。
- CLI 帮助文本、版本号、存储路径全面对齐 Vessel 命名。

**English** — First productisation milestone. One product version (`0.10.0`, aligned with what used to be the CLI's `0.1.0`) and a clean-install baseline; the composition root moved into `@vessel/application` (`composeHarness`) so the CLI is no longer the only entry point; session and project registries gave the app layer a programmable surface for the later local server and web UI; `vessel migrate` moved state from `~/.dsh` to `~/.vessel`; `vessel serve` and `vessel web` shipped; and the public documents (README / LICENSE / SECURITY / CHANGELOG) were written.

---

## [0.9.0] - 2026-09

### Added

- 使用统计模块：`UsageStore` 持久化 `~/.vessel/usage.json`（原子写），`vessel usage [--recent <n>]` 展示 tokens / 调用 / 估算成本，按供应商与模型聚合。
- 模型目录与定价：`configs/model-catalog.json`（27 款主流模型；context / 价格），`resolvePrice` 按 模型 > 协议 > default 解析；`vessel pricing [model]` 查询价目。
- `vessel models` 增加 context window 与 USD/1M 价目列（来自模型目录）。
- `VESSEL_USAGE_ROOT` 环境变量隔离 usage 存储（测试/CI）。

### Changed

- **全面更名 Vessel**：CLI bin 统一为 `vessel`（移除 `cah` 别名），包名 `@cah/*` → `@vessel/*`（全仓 217+ 处）、环境变量 `CAH_*` → `VESSEL_*`，操作类文档全面 vessel 化；历史文档 / research 快照保留原文并加"历史快照"标注。
- 协议层、policy、运行时逻辑不变，仅命名与品牌层迁移。

**English** — Usage accounting landed: a persistent `UsageStore` under `~/.vessel`, `vessel usage` for tokens/calls/estimated cost aggregated by provider and model, a 27-model catalog with prices and `vessel pricing`; and the project was renamed from `cah`/`Composable Agent Harness` to **Vessel** across bins, package scopes, environment variables and operational docs, with protocol, policy and runtime logic left untouched.

---

## [0.8.0] - 2026-09

### Added

- 品牌升级 **Vessel**：`VESSEL` ASCII LOGO（CLI/交互会话开始显示）+ SVG 品牌标志（`docs/assets/vessel-logo.svg`）。
- Vessel 六条哲学 IR 化：`configs/behavior.default.yaml` 增 6 条 `vessel.*` IR（prompt_guidance 通道），编译进 stable system；`docs/VESSEL.md` 品牌宣言 + Constitution + 三角色。
- 供应商目录扩充至 **71 个**预填端点（官方国际 / 国产官方 / 聚合 / 本地 / mock），向导 picker 按 `[官方]/[国产]/[国际]/[聚合]/[本地]` 分组搜索。
- UI 主题约定 `docs/UI-THEME.md`：浅色默认 + 系统深色自动适配（`prefers-color-scheme`）。

### Fixed

- 交互 TUI 每轮退出 bug：重建 `makeLineReader`（一次性 line 监听 + FIFO 队列），支持同一 readline 接口连续多轮 + SIGINT 优雅退出。

### Changed

- 运行/交互命令统一为 `vessel`（`npm run vessel` / `npm start`）；根 `package.json` scripts 增补；`cli.ts` 帮助 / 版本 / 问候全面 Vessel 化。

**English** — The Vessel brand itself: an ASCII logo, an SVG mark, and the six constitution principles turned into behavior IR compiled into every agent's stable system; the provider catalog grew to 71 prefilled endpoints with grouped, searchable pickers; a light-default theme rule arrived; and a TUI bug that exited after a single turn was fixed by rebuilding the line reader around a FIFO queue.

---

## [0.7.0] - 2026-09

### Added

- 交互式 chat TUI：无参 `vessel` 直接进交互会话（opencode 风格），斜杠命令 `/provider` `/models` `/model` `/permission` `/help` `/quit` 管配置。
- 权限三档：`--permission read-only | workspace-write | danger-full-access`，映射到 policy profile + approval never。
- 供应商目录 52 → 56（补充 bedrock/vertex/baseten/scaleway）。
- 供应商 picker 分组与 50+ 供应商调研（`docs/ideas/PROVIDER-TUI-RESEARCH.md`）。

**English** — The interactive TUI: running `vessel` with no arguments starts a session with slash commands for providers, models and permissions; three permission modes (`read-only`, `workspace-write`, `danger-full-access`) map onto policy profiles with approvals failing closed; and the provider catalog grew from 52 to 56.

---

## [0.6.0] - 2026-09

### Added

- 多供应商配置管理：`~/.dsh/providers.json` SSOT + `current.json` 默认供应商；原子写（tmp + rename）。
- 命令组：`vessel provider list/current/add/remove/switch|use`；`vessel models [--provider p]` 实时拉取 OpenAI 兼容模型 / Anthropic 内置清单（诚实标注非实时）；`vessel run` 使用当前默认供应商，兜底 `mock`。
- 交互配置向导 `vessel setup`（搜索选供应商 → 输 key → 拉模型 → 勾选 → 设为默认）。
- 定价解析：`loadPricing` 按模型 > 协议 > default，`mock` 零价。
- `VESSEL_PROVIDER_ROOT` 环境变量隔离存储根。

**English** — Multi-provider configuration with a single source of truth on disk and atomic writes; the `vessel provider …` command group and `vessel models`; an interactive `vessel setup` wizard; price resolution by model / protocol / default; and an environment variable that isolates the provider store (which the tests and CI rely on).

---

## [0.5.0] - 2026-09

### Added

- Loop Engine 核心状态机：统一 Model Call → Tool Call → Tool Result → State Update → Continue/Stop；Loop Engine 接线为 run 主循环。
- Task Selection + Trigger；隔离工作区（每个 session 独立上下文）。
- 收尾：B023 场景 + 独立核验 VERDICT: PASS（203 测试绿）。

**English** — The Loop Engine state machine (Model Call → Tool Call → Tool Result → State Update → Continue/Stop) became the main `run` loop, with task selection/trigger and an isolated workspace per session; closed with scenario B023 and an independent review verdict of PASS at 203 tests.

---

## [0.4.0] - 2026-09

### Added

- Task Category 分类器 + Preset 库 + **TaskRouter**：任务 → 类别 → 模型档位（`TierModelMap`），多 provider 按任务自动选。
- compose / subagent 预设接线（TaskRouter 集成）。
- 收尾：B022 场景 + 独立核验 VERDICT: PASS（170 测试绿）。

**English** — Task classification, a preset library and a **TaskRouter** that maps a task to a category and then to a model tier, so several providers can be selected per task; wired into compose and the subagent presets; closed with scenario B022 and an independent PASS at 170 tests.

---

## [0.3.0] - 2026-09

### Added

- Project Memory 核心（`packages/memory`）：项目级记忆读写。
- Persistent Memory（持久化落盘）。
- Skills 正文注入 + Skill Scope/Search/Provenance。
- 自动学习 `suggest` 通道（经验回写）。
- 收尾：B 场景 + 独立核验 VERDICT: PASS（146 测试绿）。

**English** — Project memory (a dedicated package plus persistence on disk), skills injection with scope/search/provenance, and a `suggest` channel that writes learned experience back; closed with a PASS at 146 tests.

---

## [0.2.0] - 2026-09

### Added

- Subagent 核心：`@vessel/agents` `IsolatedRuntime` / `SubagentManager` / `createSubagentTool` + 共享事件词汇（`before_delegate` / `subagent_start` / `subagent_stop` / `after_delegate`）。
- Planner：Plan 结构校验 / `formatPlan` / `injectPlan` / `executePlan`（步骤验收驱动 Evaluator）/ `generatePlan`。
- Evaluator Agent：隔离会话 + 只读工具面（Read/Glob/Grep），Generator 不可自证。
- MCP 接入：`McpClient`（StdioTransport + InProcessTransport）、`registerMcpTools`（`mcp__<server>__<tool>`）、ToolRegistry `register/unregister`，policy 对 MCP 工具同名生效。
- Parallel Exploration：`ParallelScheduler` 读写分流（文件读/搜索并发池 clamp [1,3]，写/独占串行屏障）。
- Git Worktree：`createWorktree/removeWorktree/listWorktrees/sanitizeBranch`，GitRunner 可注入。
- 收尾：compose 接线（subagent/mcp + planner/evaluator）+ B016–B019 场景与 offline 脚本，独立审查 VERDICT: PASS（104 测试）。

**English** — Subagents (isolated runtime, manager, a delegation tool and a shared event vocabulary), a planner whose steps are verified by an evaluator, an evaluator agent that runs in its own session with read-only tools so a generator can never grade itself, MCP client support, parallel exploration with read/write separation, and git worktree management; closed with scenarios B016–B019 and an independent PASS at 104 tests.

---

## [0.1.0] - 2026-09

### Added

- 最小可运行 Harness V0.1：按 `docs/ARCHITECTURE.md` 模块边界实现模块化单体（`packages/*`），具备：
  - **薄 Core**：只做 Model Call → Tool Call → Tool Result → State Update → Continue/Stop（Memory/Skill/Sandbox 不进 core）。
  - **Behavior IR**：`configs/behavior.default.yaml`（12 类 49 条 IR + L0–L4 编译管线）→ Behavior Compiler → stable system。
  - **Policy 四件套**：Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event（`policy.default.yaml`：`filesystem.protected` / `shell.deny` / `git.force_push` 等）。
  - **Generator/Evaluator 分离**：产出经独立评估。
  - CLI：`vessel run` 一次性任务（当时为 `cah` / `node` 入口）。
  - 首批 benchmark fixture（B001–B019 场景、deterministic 判据）。
- 独立审查 VERDICT: PASS（63 测试）。

**English** — The first runnable harness: a modular monolith following the module boundaries in `docs/ARCHITECTURE.md`, with a deliberately thin core (only the model/tool/state loop, no memory or skills), behavior IR compiled into a stable system prompt, the four-part policy enforcement (guidance + interceptor + runtime deny + audit event), generator/evaluator separation, a one-shot CLI, and the first benchmark fixtures; independent review PASS at 63 tests.
