# Vessel — a composable agent harness

> 本地优先 · 模型无关 · 可组合 · 可观察 · 带硬策略边界的 Agent Harness
> **Carry intelligence. Shape behavior. Guard execution.**

这个 npm 包是 **Vessel 的 CLI**，打成一个**自包含单文件**发布——**运行时零依赖**，装完即可用。源码与完整文档在
[github.com/satan9394/composable-agent-harness](https://github.com/satan9394/composable-agent-harness)。

*This package is Vessel's CLI, bundled into a single self-contained file with no runtime dependencies. Source and full docs live in the GitHub repository.*

---

## 安装 / Install

```bash
# 全局安装（得到 vessel 命令）
npm install -g composable-agent-harness

# 或免安装直接用
npx composable-agent-harness --version
```

前置：**Node ≥ 20**。

## 快速开始 / Quick start

```bash
vessel --version                 # 版本
vessel --help                    # 全部命令

# 零配置即可跑：默认内置离线 mock（不发网络请求）
vessel run --prompt "说一句你好"

# 接真实模型（二选一）
vessel setup                                            # 交互向导：选供应商 → 输 key → 拉模型 → 设为默认
vessel provider add deepseek --protocol openai-compatible \
  --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
vessel provider switch deepseek

vessel                           # 无参进交互 TUI（斜杠命令管配置）
vessel usage                     # tokens / 调用 / 估算成本
vessel pricing deepseek-chat     # 价目查询
vessel explain agent             # 术语中英双语解释
```

## 命令一览 / Commands

| 命令 | 说明 |
|---|---|
| `vessel` | 无参进交互对话（TUI） |
| `vessel run --prompt "…"` | 一次性任务；`--bench <scenarioId>` 跑基准场景 |
| `vessel setup` | 交互向导：配置供应商 |
| `vessel provider list / current / add / remove / switch` | 供应商管理 |
| `vessel models [--provider p]` | 拉取可用模型 |
| `vessel usage [--recent <n>]` | 用量与估算成本 |
| `vessel pricing [model]` | 模型价目 |
| `vessel sessions list` / `vessel resume <id>` | 历史会话与恢复 |
| `vessel explain <term>` / `vessel list-terms` | 术语中英双语解释 |
| `vessel policy status` | 显示生效策略层次（只读） |
| `vessel serve` / `vessel web` | 起本地服务（`127.0.0.1:5678`） |
| `vessel migrate` | 旧状态目录 `~/.dsh` → `~/.vessel` |

## 这是什么 / What it is

- **薄核** — 核心只有一条状态机：Model Call → Tool Call → Tool Result → State Update → Continue/Stop。
- **Behavior IR** — 行为由可版本化的 IR（`configs/behavior.default.yaml`）经编译器落进每个 agent 的 stable system，可校验、可替换。
- **硬策略边界** — 安全规则由 Policy Engine **执法**，不只写在 prompt 里：Prompt Guidance + Tool Interceptor + Runtime Deny + Audit Event。
- **本地优先** — 状态、会话、凭据都在本机（`~/.vessel/`）；模型无关，可接 71 个预填供应商或自定义端点。
- **不以自证为证** — 产出须经独立评估（Generator / Evaluator 分离）。

## 状态 / Status

- 版本 **0.10.0**；完整版本历史（V0.1 → V0.10，中英双语）见[仓库的 CHANGELOG](https://github.com/satan9394/composable-agent-harness/blob/main/CHANGELOG.md)。
- 发布前门禁（在对应提交上实测）：`tsc -b` exit 0；两个 root 的全量测试 **2195 + 120 passed**；离线 CLI 冒烟 `kind=success`。
- 已知边界：`vessel serve` / `vessel web` 的 Web 界面仍在推进；Windows 上未接入 job object 时，进程树沙箱会在遥测里**如实报 `degraded`**。

## License

[MIT](https://github.com/satan9394/composable-agent-harness/blob/main/LICENSE)
