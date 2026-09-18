# Vessel — A Composable Agent Harness

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/composable-agent-harness.svg)](https://www.npmjs.com/package/composable-agent-harness)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Tests](https://img.shields.io/badge/tests-2197%20%2B%20120%20passed-brightgreen)

> 本地优先 · 模型无关 · 可组合 · 可观察 · 带硬策略边界的 Agent Harness

> **Carry intelligence. Shape behavior. Guard execution.**

Vessel（器）取名自「大器免成 / 无器之器」：**系统本身不是任何一个组件**。Model、Prompt、Agent、工具都只是可替换的"器"；Vessel 是承载这些器、并让它们各自可靠运转的框架——器可以一件件换掉，系统不因此失效。

*English:* Vessel is a local-first, model-agnostic, composable agent harness: a thin core loop, behaviour compiled from a versioned IR, hard policy enforcement instead of prompt-only rules, and a CLI/web surface — every component replaceable without the system failing.

---

## 状态：**可用**（2026-09-18 在当前 HEAD 实测；CI 已绿）

三项门禁都在本仓库当前提交上跑通，命令与结果如下（可自行复跑）：

| 门禁 | 命令 | 实测结果 |
|---|---|---|
| 类型检查 / 构建 | `npm run build`（`tsc -b`） | **exit 0** |
| 测试类型检查（非 composite） | `npm run typecheck:tests` | **exit 0** |
| 全量测试（两个 root） | `npm run test:all` | 根 **171 文件 / 2197 passed + 6 skipped**；`apps/web` **11 文件 / 120 passed** |
| Web 生产构建 | `npm run -w @vessel/web build`（vite） | **exit 0** |
| CLI 冒烟（离线，不发网络） | `npm run vessel -- run --prompt "说一句你好"` | `kind=success`，`steps=1`，走内置 `mock` |

> **GitHub Actions 已绿**：`.github/workflows/ci.yml` 在 Windows + Linux 两个腿跑 build / 测试类型检查 / web 类型检查与构建 / 全量测试 / CLI 冒烟；CodeQL 与 Dependabot 告警当前均为 0。

> **零配置即可跑**：没有任何供应商配置时默认使用内置 `mock` 供应商（离线确定性冒烟）。要接真实模型：`vessel setup`（交互向导）或 `vessel provider add …`。
> **已知边界**（如实标注）：`vessel serve`/`vessel web` 的 Web 界面仍在推进；`benchmarks/reports/release-report.{md,json}` 是历史快照，未随最近改动刷新；进程树沙箱在 Windows 上未接入 job object 时会在遥测里如实报 `degraded`。

---

## 产品公式

Vessel 是一个可组合、可验证、可替换行为层的 Agent Harness，围绕一条产物公式组织：

```
Model + Behavior + Context + Tools + Policy + Memory + Evaluator + Orchestration + Runtime + Surfaces
```

其中 **Behavior** 是核心抽象：Approach 定义（`configs/behavior.default.yaml`）经 **Behavior Compiler** 编译进每个 Agent 的 stable system；**Policy** 以硬边界执法（Prompt Guidance + Tool Interceptor + Runtime Deny + Audit）；**Surfaces** 面向 CLI 与本地 Web 双表面（Web 在后续里程碑，见下方命令参考）。

## 定位

- **本地优先** — 状态、配置、会话在本地（`~/.vessel/`），不上云。
- **模型无关** — 内置协议层（OpenAI 兼容 / Anthropic / mock），可接 DeepSeek、Qwen、Claude、OpenAI、本地 Ollama/vLLM/LM Studio 等 71 个预填供应商，或自定义端点。
- **可组合** — 模块化单体（`packages/*` + `apps/cli`），依赖零环；组件可替换。
- **可观察** — 会话全量落盘，事件词汇标准；`vessel usage` 统计调用与成本。
- **硬策略边界** — 安全规则由 Policy Engine 硬执法，不只写在 Prompt 里。

---

## 快速开始（< 5 分钟）

前置：Node ≥ 20（本机在 Node v24 下开发）。

### 方式一：从 npm 安装（推荐，运行时零依赖）

```bash
npm install -g composable-agent-harness   # 得到全局 vessel 命令
# 或免安装：npx composable-agent-harness --version

vessel --version
vessel run --prompt "总结当前工作区 README"   # 零配置：走内置离线 mock，不发网络请求
vessel setup                                  # 接真实模型的交互向导
```

### 方式二：从源码（开发用）

```powershell
npm install
npm run build                # 编译全部 TS（tsc -b）
npm link ./apps/cli          # 可选：让 vessel 命令全局可用
npm run vessel -- --help     # 不装全局时，用项目内入口
```

### 配置供应商（首次使用真实模型）

```powershell
vessel setup                 # 交互向导：搜索选供应商 → 输 key → 拉模型 → 勾选 → 设为默认
# 或命令行添加（以 DeepSeek 为例）
vessel provider add deepseek --protocol openai-compatible --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
vessel provider switch deepseek

# 跑起来
vessel                       # 进交互对话（无参即进 TUI；chat 不是子命令）
vessel run --prompt "总结当前工作区 README"   # 一次性任务
```

> 无任何配置时默认走内置 `mock` 供应商（离线确定性冒烟，不发网络请求）。
> 未全局安装时，可用项目内入口 `npm run vessel` 代替 `vessel`。

## 命令参考

| 命令 | 说明 |
|---|---|
| `vessel` | 无参进交互对话（TUI，斜杠命令管配置；没有 `chat` 子命令，`vessel chat` 报未知命令） |
| `vessel run --prompt "…"` | 一次性任务（单发模式）；`--bench <scenarioId>` 跑基准场景 |
| `vessel setup` | 交互向导：配置供应商 |
| `vessel provider list / current / add / remove / switch` | 供应商配置管理、一键切换默认 |
| `vessel models [--provider p]` | 拉取某供应商可用模型（OpenAI 兼容实时 / Anthropic 内置清单 / mock 离线） |
| `vessel usage [--recent <n>] [--strict]` | 使用统计（tokens / 调用 / 估算成本 + 价格来源分布，落盘 `~/.vessel/usage.json`；`--strict` 不用兜底价重算） |
| `vessel pricing [model]` | 模型价目查询（`configs/model-catalog.json`，USD/1M tokens；模型名自动归一） |
| `vessel migrate` | 一次性迁移旧状态目录 `~/.dsh` → `~/.vessel` |
| `vessel sessions list` | 列出历史会话（最近活动在前） |
| `vessel resume <id> [--last]` | 恢复历史会话（`--last` = 最近一条；TTY 下不带 `--prompt` 时进入 TUI 恢复） |
| `vessel review handoff / import / list` | 外部评审：生成 handoff、导入评审结果、列出 reviews |
| `vessel explain <term>` | 术语中英双语解释（别名 `vessel term <term>`；未收录词给提示 + `list-terms`） |
| `vessel list-terms` | 列出全部术语（中英双语词库） |
| `vessel guide [--locale zh\|en]` | 新手分步引导（①这是什么 ②怎么问术语 ③常用命令 ④怎么设置主题/语言；输出语言跟随 settings locale） |
| `vessel settings list / set <theme\|locale> <v>` | 设置项中英文说明与可选值（`theme: dark\|light`；`locale: zh\|en`） |
| `vessel policy status` | 显示生效策略层次（system / project 的路径、是否存在、声明条数、哈希；只读） |
| `vessel bench-report --input <json>` | 基准报告看板：聚合 RunResult[] → CLI 摘要表 + 写 md/json |
| `vessel serve` | 启动本地服务（默认 `http://127.0.0.1:5678`，不开浏览器；`--port <n>` 换端口） |
| `vessel web` | 启动本地服务并打开默认浏览器 |

> 交互界面的斜杠命令：`/provider` 配置供应商 · `/models` 拉模型 · `/model <id>` 切模型 · `/permission` 切权限档 · `/setup` 完整引导 · `/explain <术语>` 或 `? <术语>` 查术语解释 · `/cost`（同 `/usage`）看会话与累计成本 · `/help` · `/quit`。

## 哲学与架构要点

### Vessel Constitution（六条一句话版）

1. **无器之器** — 组件可替换，系统不依赖任何单一组件。
2. **器以载道** — 以最低必要复杂度完成任务，能力不是越多越好。
3. **大器不争** — 模型负责聪明，Harness 负责可靠。
4. **软引导硬边界** — 重要规则不只靠自觉（Prompt 引导 + Policy 识别 + Runtime 拦截 + Audit 记录）。
5. **不以自证为证** — 产出须经独立评估（Generator / Evaluator 分离）。
6. **人在循环之上** — 自动化执行，人保留判断权；重大 / 不可逆 / 证据不足升级给用户。

六条哲学并非宣传语，而是**以行为 IR 存在**的操作原则：`configs/behavior.default.yaml` 的 `vessel.*` 条目 → Behavior Compiler → 编译进每个 Agent 的 stable system，可版本化、可校验、可替换。

### 行为 IR

`behavior.default.yaml` → **Behavior Compiler** → system。Approach 定义与 runtime 分离，prompt 与 policy 双通道。

### Policy 四件套

安全规则由 Policy Engine 硬执法，不只写 Prompt：**Prompt Guidance**（软引导）+ **Tool Interceptor**（识别）+ **Runtime Deny**（拦截）+ **Audit Event**（记录）。

### 权限三档

`--permission <mode>`（run）或 TUI `/permission`：

| 模式 | 行为 |
|---|---|
| `read-only` | 只读探索：Read/Grep/Glob 放行，写/执行拒绝 |
| `workspace-write`（默认） | 写工作区放行，高危操作 fail-closed 拒绝 |
| `danger-full-access` | 全权限（protected 路径与 `.env` 读取仍拒绝，保留电路熔断） |

## 文档导航

- [`docs/VESSEL.md`](docs/VESSEL.md) — 品牌宣言 · Vessel Constitution · 三角色（Lead / Developer / Reviewer）
- [`docs/V1.0-ROADMAP-PROGRESS.md`](docs/V1.0-ROADMAP-PROGRESS.md) — V1.0 产品化路线与里程碑进度
- [`docs/PROVIDER-MANAGEMENT.md`](docs/PROVIDER-MANAGEMENT.md) — 供应商配置管理命令参考
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 模块边界
- [`docs/DESIGN-DECISIONS.md`](docs/DESIGN-DECISIONS.md) — 设计决策点（实现必须遵守）
- [`docs/POLICY-SPEC.md`](docs/POLICY-SPEC.md) · [`docs/BEHAVIOR-IR-SPEC.md`](docs/BEHAVIOR-IR-SPEC.md) · [`docs/EVENT-SPEC.md`](docs/EVENT-SPEC.md) · [`docs/BENCHMARK-SPEC.md`](docs/BENCHMARK-SPEC.md)
- [`SECURITY.md`](SECURITY.md) · [`CHANGELOG.md`](CHANGELOG.md) · [`LICENSE`](LICENSE)

## 版本与发布

| | |
|---|---|
| **当前版本** | **v0.10.0** —— 根 `package.json`、`apps/cli/package.json` 与 `vessel --version` 三处同号 |
| **npm 包** | [`composable-agent-harness`](https://www.npmjs.com/package/composable-agent-harness)（CLI 自包含单文件，**运行时零依赖**）—— `npm i -g composable-agent-harness` 或 `npx composable-agent-harness` |
| **版本历史（中英双语）** | [`CHANGELOG.md`](CHANGELOG.md) —— V0.1 → V0.10，**每个里程碑都有「中文」+「English」两段**说明 |
| **里程碑与路线** | [`docs/V1.0-ROADMAP-PROGRESS.md`](docs/V1.0-ROADMAP-PROGRESS.md)、[`docs/VESSEL.md`](docs/VESSEL.md) |
| **GitHub Releases** | 每个 `vX.Y.Z` tag 对应一个 release；release 说明取自 `CHANGELOG.md` 的同名章节（中英双语） |

版本主线一句话：**V0.1** 薄核 + Behavior IR + Policy 四件套 → **V0.2** Subagent / Planner / Evaluator / MCP / Worktree → **V0.3** Memory / Skills → **V0.4** TaskRouter → **V0.5** Loop Engine → **V0.6** 多供应商配置 → **V0.7** 交互 TUI + 权限三档 → **V0.8** 品牌与哲学 IR 化 → **V0.9** 更名 Vessel + 用量统计与价目 → **V0.10** 组合根抽离 + `migrate`/`serve`/`web` + 公开文档。

## Benchmark 与 Cross-Harness Conformance

Vessel 的差异化主张之一是**行为层可替换、且可被同一套判据验证**。`benchmarks/` 为此提供一条统一链路：

- **共享场景**：`benchmarks/scenarios/*.yaml`（25 个：B001–B027 行为场景 + S001–S008 安全场景），判据写在 yaml 里，是唯一事实源；fixture 在 `benchmarks/fixtures/`。
- **统一契约**：`HarnessAdapter.run(fixture) → RunResult`（15 项 L3 指标：成功 / 墙钟 / 工具调用 / 非法调用 / 重试 / tokens / 成本 / 上下文峰值 / 压缩 / 人工介入 / 策略违规 / resume），见 `benchmarks/runners/src/contracts/`。
- **适配器**：Vessel 自适配器 + 外部 harness（`dsh` / `opencode` / `codex` / `claude-code` / `pi`），见 `benchmarks/runners/src/adapters/`。每个适配器自带 CLI 探针：**探针不通过就不跑、如实标 skip**，绝不伪造失败或成功。
- **驱动 + 报告**：`benchmarks/runners/src/conformance/` 把同一批 fixture 跑过多个适配器，交给 083 报告模块聚合成跨 harness 对比（JSON + markdown）。

```powershell
# 离线（默认）：只跑 Vessel 自适配器，确定性 mock，不消耗任何第三方配额
npm run bench:conformance -- --all

# 指定场景
npm run bench:conformance -- --scenarios B001,S002

# 真实跨 harness（会驱动本机已安装的 dsh/opencode/codex/claude-code/pi，可能消耗其配额）
npm run bench:conformance -- --all --live
```

> 默认离线跑全部 25 个场景的结果（2026-09-18）：**25 run / 0 skipped / 0 error，25 passed，exit 0**。
> 报告写入 `benchmarks/reports/conformance/`（生成物，已 gitignore）。`--live` 需你确认后再跑——它会真的驱动外部 harness。

## 开发

```powershell
npm ci                 # 可复现安装（lockfile 必须与 package.json 一致；CI 用硬 npm ci 把关）
npm run build          # tsc -b 类型 + 编译
npm run typecheck:tests # 测试文件的类型检查（tsconfig.test.json，非 composite）
npm run test:all       # 全量测试：**两个 root 都跑**（根 + `--root apps/web`）
npm run -w @vessel/web build   # web 生产构建（vite）
npx tsc -b             # 类型检查
npm run vessel -- --help          # 不装全局时，用项目内入口跑 CLI
node apps/cli/dist/cli.js --version   # 直接用已编译产物（构建后）
```

> 测试文件被 `tsconfig.base.json` 的 `exclude` 排除在 composite 构建之外（跨包测试 import
> 无法全部表达为 project reference，否则成环）。因此测试的类型检查由 `npm run typecheck:tests`
> （`tsconfig.test.json`，非 composite、`noEmit`）单独负责；vitest 只转译不做类型检查。

> `apps/web` 有**独立的 vitest 配置**（需要 `@vitejs/plugin-react`），根 `vitest.config.ts`
> 的 `include` **不含它** ⇒ 只跑 `npx vitest run` 会**漏掉 web 套件**（近百项），那不算全量。
> 想分别跑：`npm test`（根）、`npm run test:web`（web）。

## License

[MIT](LICENSE)