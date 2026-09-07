# 供应商配置管理（PROVIDER-MANAGEMENT.md）

> 版本：2026-09-05 · 对标 cc-switch 的"配置管理/一键切换"体验，但本项目自己是 Harness 运行时
> 关联：docs/PROVIDER-INTEGRATION.md（协议层接入）、docs/MISSION-V0.4.md（TaskRouter 多模型路由）

---

## 1. 一句话

把"供应商 + 模型"存成可管理的配置（`~/.dsh/providers.json`），`cah provider switch` 一键切换默认供应商，`cah models` 拉取可用模型——`cah run` 不传参时自动用当前默认供应商跑。

## 2. 存储（SSOT）

| 文件 | 内容 |
|---|---|
| `~/.dsh/providers.json` | 供应商列表（id/name/protocol/baseUrl/apiKey/model/models?/note?） |
| `~/.dsh/current.json` | 当前默认供应商 id（缺省 `mock`） |

- 目录沿用项目 ~/.dsh 约定（memory/skills 同款）。
- 原子写：先写 `.tmp` 再 rename，防半写损坏。
- **apiKey 明文存本机**（与 cc-switch 同款取舍）——仅本机用户目录可读；别把 `~/.dsh` 同步到不受信的地方。不做加密（YAGNI）。
- 测试/多环境隔离：设 `CAH_PROVIDER_ROOT` 环境变量可改存储根（CI/测试不碰真实 ~/.dsh）。
- `mock` 是内置供应商：永不持久化、不可删除、`list` 首项、无配置时默认。

## 3. 命令参考

```powershell
# 查看所有供应商（* = 当前默认）
cah provider list

# 当前默认
cah provider current

# 添加（真实协议需 --base-url；--model 建议指定真实模型）
cah provider add ds --protocol openai-compatible --base-url https://api.deepseek.com/v1 --api-key <key> --model deepseek-chat
cah provider add ant --protocol anthropic --base-url https://api.anthropic.com --api-key <key> --model claude-sonnet-4-5

# 删除 / 切换
cah provider remove ds
cah provider switch ant        # 或 use

# 拉取可用模型
cah models                     # 当前默认供应商的模型
cah models --provider ds       # 指定供应商
```

## 4. 模型拉取（cah models）行为

| 供应商协议 | 行为 |
|---|---|
| `openai-compatible` | 实时调 `GET {base}/v1/models`（自动尝试 `/models` 兜底）→ 列出真实模型；401/网络错给清晰报错 |
| `anthropic` | Anthropic 官方无公开模型枚举端点 → 内置 Claude 代际清单兜底（**诚实标注"非实时"**）；若你用的 Anthropic 兼容层暴露 `/v1/models`，可按 openai-compatible 配 |
| `mock` | 离线，提示无模型列表 |

拉到的模型 id 可直接 `--model <id>` 使用，或登记进 `configs/pricing.json` 的 models 表算成本。

## 5. cah run 的供应商解析（优先级从高到低）

1. 显式 `--provider/--model/--base-url/--api-key`（最优先，向后兼容）
2. 环境变量 `CAH_MODEL/CAH_BASE_URL/CAH_API_KEY`
3. 当前默认供应商（`cah provider switch` 设的；model/baseUrl/apiKey 从配置取）
4. 兜底 `mock`（无任何配置时的离线冒烟，会提示）

## 6. 与 TaskRouter / pricing 的衔接

- **TaskRouter**（V0.4，任务→类别→模型档位）：TierModelMap 的 providerId 可直接绑 `anthropic`/`openai-compatible`，tier 的 model 用供应商默认模型即可（`docs/MISSION-V0.4.md`）。
- **pricing**：`configs/pricing.json` v0.2 支持 `models.<model-id>` 精确价（deepseek/claude/gpt 已有预设）与 `protocols.<protocol>` 兜底价；`loadPricing()`/`resolvePrice(model, protocol)` 按 模型 > 协议 > default 解析（mock 零价）。`cah models` 拉到的模型 id 可登记进 models 表。
- **V0.4 的 TaskRouter / V0.6 的 run 默认**是两条独立路径：显式 --provider 定会话用哪个协议端点；TaskRouter 在"多 provider 可用、按任务自动选"时接管。

## 7. 新增一个厂商（回顾，详见 PROVIDER-INTEGRATION.md）

- 走已有协议（OpenAI 兼容 / Anthropic）→ 零代码：`cah provider add <id> --protocol <p> ...` + `switch`。
- 全新协议 → `packages/llm/src/provider/` 写一个 `implements ChatProvider` 的类 + `createProvider` 工厂加一行 + 这里 `PROVIDER_PROTOCOLS` 加一档。

## 8. 验证

```powershell
npx tsc -b && npx vitest run   # 全量绿
# 命令冒烟（隔离目录，不碰 ~/.dsh）：
$env:CAH_PROVIDER_ROOT = "$env:TEMP\cah-smoke"
node apps/cli/dist/cli.js provider add demo --protocol mock --model mock
node apps/cli/dist/cli.js provider list
node apps/cli/dist/cli.js models --provider ant   # anthropic 内置清单
```
