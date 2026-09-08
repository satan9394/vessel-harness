# Vessel — A Composable Agent Harness

> 本地优先 · 模型无关 · 可组合 · 可观察 · 带硬策略边界的 Agent Harness

> **Carry intelligence. Shape behavior. Guard execution.**

Vessel（器）取名自「大器免成 / 无器之器」：**系统本身不是任何一个组件**。Model、Prompt、Agent、工具都只是可替换的"器"；Vessel 是承载这些器、并让它们各自可靠运转的框架——器可以一件件换掉，系统不因此失效。

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

```powershell
# ① 安装与构建
npm install
npm run build                # 编译全部 TS（tsc -b）

# ② 让 vessel 命令全局可用（可选，换环境后重跑一次）
npm link ./apps/cli

# ③ 配置供应商（首次使用）
vessel setup                 # 交互向导：搜索选供应商 → 输 key → 拉模型 → 勾选 → 设为默认
# 或命令行添加（以 DeepSeek 为例）
vessel provider add deepseek --protocol openai-compatible --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
vessel provider switch deepseek

# ④ 跑起来
vessel                       # 进交互对话（无参即进 TUI/chat）
vessel run --prompt "总结当前工作区 README"   # 一次性任务
```

> 无任何配置时默认走内置 `mock` 供应商（离线确定性冒烟，不发网络请求）。
> 未全局安装时，可用项目内入口 `npm run vessel` 代替 `vessel`。

## 命令参考

| 命令 | 说明 |
|---|---|
| `vessel` | 无参进交互对话（TUI/chat），斜杠命令管配置 |
| `vessel run --prompt "…"` | 一次性任务（单发模式）；`--bench <scenarioId>` 跑基准场景 |
| `vessel setup` | 交互向导：配置供应商 |
| `vessel provider list / current / add / remove / switch` | 供应商配置管理、一键切换默认 |
| `vessel models [--provider p]` | 拉取某供应商可用模型（OpenAI 兼容实时 / Anthropic 内置清单 / mock 离线） |
| `vessel usage [--recent <n>]` | 使用统计（tokens / 调用 / 估算成本，落盘 `~/.vessel/usage.json`） |
| `vessel pricing [model]` | 模型价目查询（`configs/model-catalog.json`，USD/1M tokens） |
| `vessel migrate` | 一次性迁移旧状态目录 `~/.dsh` → `~/.vessel` |
| `vessel serve` | 启动本地服务（默认 `http://127.0.0.1:5678`，不开浏览器；`--port <n>` 换端口） |
| `vessel web` | 启动本地服务并打开默认浏览器 |

> 交互界面的斜杠命令：`/provider` 配置供应商 · `/models` 拉模型 · `/model <id>` 切模型 · `/permission` 切权限档 · `/help` · `/quit`。

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

## 开发

```powershell
npm run build          # tsc -b 类型 + 编译
npx vitest run         # 全量测试
npx tsc -b             # 类型检查
```

## License

[MIT](LICENSE)