# 供应商配置管理（PROVIDER-MANAGEMENT.md）

> 版本：2026-09（V0.8：品牌 Vessel）· 对标 cc-switch 的"配置管理/一键切换"体验，但本项目自己是 Harness 运行时
> 关联：docs/VESSEL.md（品牌与运行）、docs/PROVIDER-INTEGRATION.md（协议层接入）、docs/MISSION-V0.4.md（TaskRouter 多模型路由）、docs/ideas/PROVIDER-TUI-RESEARCH.md（交互/供应商/权限设计调研）
> 命令前缀：**`vessel`**（V0.9 起唯一命令名，cah 已彻底移除）

---

## 1. 一句话

把"供应商 + 模型"存成可管理的配置（`~/.dsh/providers.json`），`vessel provider switch` 一键切换默认供应商，`vessel models` 拉取可用模型——`vessel run` 不传参时自动用当前默认供应商跑。**直接敲 `vessel` 进入交互对话界面**（opencode 式），供应商配置/模型/权限全是界面内斜杠命令，不用先记参数。

## 1.5 交互体验（一条命令开始）

```powershell
vessel         # 直接进交互对话（需要终端）：输入文字跑任务，斜杠命令管配置
vessel setup   # 或：引导式配置供应商向导（搜索选→key→拉模型→勾选）
```

TUI 内斜杠命令：`/provider`（配置供应商）、`/models`（当前供应商模型）、`/model <id>`（切模型）、`/permission`（切权限）、`/help`、`/quit`。全局 `vessel` 命令：`npm link ./apps/cli` 后任意目录可用。

## 1.6 供应商目录（71 条）

内置 71 个预填端点的供应商（数据在 `apps/cli/src/providers/presets.data.ts`，来源见 `docs/ideas/PROVIDER-TUI-RESEARCH.md` §A3）：官方国际（Anthropic/OpenAI/Gemini/xAI/Groq/Mistral…）、国产官方（DeepSeek/Qwen/Kimi/GLM/MiniMax/豆包/混元/百炼/千帆…）、聚合（OpenRouter/硅基流动/魔搭/Novita/302AI…）、本地（Ollama/vLLM/LM Studio/llama.cpp/Jan）+ mock。向导里按类别标签（[官方]/[国产]/[国际]/[聚合]/[本地]）搜索即得，"自定义端点"随时可加。

## 1.7 权限三档（对齐市面 agent）

`--permission <mode>`（run）或 TUI `/permission`：
| 模式 | 行为 |
|---|---|
| read-only | 只读探索：Read/Grep/Glob 放行，写/执行拒绝 |
| workspace-write（默认） | 写工作区放行，高危操作 fail-closed 拒绝 |
| danger-full-access | 全权限（protected 路径与 .env 读取仍拒绝，保留电路熔断） |

映射到既有 policy profile（`configs/policy.default.yaml` 的 read-only/workspace-write/danger-full-access）+ approval never。

---

## 2. 存储（SSOT）

| 文件 | 内容 |
|---|---|
| `~/.dsh/providers.json` | 供应商列表（id/name/protocol/baseUrl/apiKey/model/models?/note?） |
| `~/.dsh/current.json` | 当前默认供应商 id（缺省 `mock`） |

- 目录沿用项目 ~/.dsh 约定（memory/skills 同款）。
- 原子写：先写 `.tmp` 再 rename，防半写损坏。
- **apiKey 明文存本机**（与 cc-switch 同款取舍）——仅本机用户目录可读；别把 `~/.dsh` 同步到不受信的地方。不做加密（YAGNI）。
- 测试/多环境隔离：设 `VESSEL_PROVIDER_ROOT` 环境变量可改存储根（CI/测试不碰真实 ~/.dsh；唯一环境变量）。
- `mock` 是内置供应商：永不持久化、不可删除、`list` 首项、无配置时默认。

## 3. 命令参考

```powershell
# 查看所有供应商（* = 当前默认）
vessel provider list

# 当前默认
vessel provider current

# 添加（真实协议需 --base-url；--model 建议指定真实模型）
vessel provider add ds --protocol openai-compatible --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
vessel provider add ant --protocol anthropic --base-url https://api.anthropic.com --api-key <key> --model claude-sonnet-4-5

# 删除 / 切换
vessel provider remove ds
vessel provider switch ant        # 或 use

# 拉取可用模型
vessel models                     # 当前默认供应商的模型
vessel models --provider ds       # 指定供应商
```

## 4. 模型拉取（vessel models）行为

| 供应商协议 | 行为 |
|---|---|
| `openai-compatible` | 实时调 `GET {base}/v1/models`（自动尝试 `/models` 兜底）→ 列出真实模型；401/网络错给清晰报错 |
| `anthropic` | Anthropic 官方无公开模型枚举端点 → 内置 Claude 代际清单兜底（**诚实标注"非实时"**）；若你用的 Anthropic 兼容层暴露 `/v1/models`，可按 openai-compatible 配 |
| `mock` | 离线，提示无模型列表 |

拉到的模型 id 可直接 `--model <id>` 使用，或登记进 `configs/pricing.json` 的 models 表算成本。

## 5. vessel run 的供应商解析（优先级从高到低）

1. 显式 `--provider/--model/--base-url/--api-key`（最优先，向后兼容）
2. 环境变量 `VESSEL_MODEL/VESSEL_BASE_URL/VESSEL_API_KEY`
3. 当前默认供应商（`vessel provider switch` 设的；model/baseUrl/apiKey 从配置取）
4. 兜底 `mock`（无任何配置时的离线冒烟，会提示）

## 6. 与 TaskRouter / pricing 的衔接

- **TaskRouter**（V0.4，任务→类别→模型档位）：TierModelMap 的 providerId 可直接绑 `anthropic`/`openai-compatible`，tier 的 model 用供应商默认模型即可（`docs/MISSION-V0.4.md`）。
- **pricing**：`configs/pricing.json` v0.2 支持 `models.<model-id>` 精确价（deepseek/claude/gpt 已有预设）与 `protocols.<protocol>` 兜底价；`loadPricing()`/`resolvePrice(model, protocol)` 按 模型 > 协议 > default 解析（mock 零价）。`vessel models` 拉到的模型 id 可登记进 models 表。
- **TaskRouter（V0.4）与 run 默认（V0.6）**是两条独立路径：显式 --provider 定会话用哪个协议端点；TaskRouter 在"多 provider 可用、按任务自动选"时接管。

## 7. 新增一个厂商（回顾，详见 PROVIDER-INTEGRATION.md）

- 走已有协议（OpenAI 兼容 / Anthropic）→ 零代码：`vessel provider add <id> --protocol <p> ...` + `switch`。
- 全新协议 → `packages/llm/src/provider/` 写一个 `implements ChatProvider` 的类 + `createProvider` 工厂加一行 + 这里 `PROVIDER_PROTOCOLS` 加一档。

## 8. 验证

```powershell
npx tsc -b && npx vitest run   # 全量绿
# 命令冒烟（隔离目录，不碰 ~/.dsh）：
$env:VESSEL_PROVIDER_ROOT = "$env:TEMP\vessel-smoke"
node apps/cli/dist/cli.js provider add demo --protocol mock --model mock
node apps/cli/dist/cli.js provider list
node apps/cli/dist/cli.js models --provider ant   # anthropic 内置清单
```

## 9. 使用统计与定价（V0.9）

- `vessel usage [--recent <n>]`：显示累计消耗（tokens in/out/cache、估算成本、调用次数），按供应商与模型聚合；加 `--recent <n>` 看最近 n 条记录。数据落盘 `~/.dsh/usage.json`（原子写，tmp+rename；`VESSEL_USAGE_ROOT` 可隔离测试）。
- `vessel pricing [model]`：查模型价目；`vessel pricing claude-sonnet-4-5` 查单个模型；无参列出 configs/model-catalog.json 主流模型价目表。价目单位为 USD / 1M tokens，解析顺序 model > catalog > protocol > default。
- mock 会话也会产生 usage 记录（E2E 接线验证），可 `vessel usage` 直接看到。
