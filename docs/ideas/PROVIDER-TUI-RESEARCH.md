# 供应商库 50+ · `cah` 一条命令进 TUI · 权限三档 —— 组合调研（PROVIDER-TUI-RESEARCH.md）

> 调研日期：2026-09（夜，用户睡前反馈后）｜用途：任务卡 020 / 021 / 022 三卡共用
> 范围：纯网络调研 + 对照本仓库现状（`apps/cli/src/providers/*`、`apps/cli/src/cli.ts`、`configs/policy.default.yaml`），不改代码
> 主要证据来源（一手）：
> - cc-switch 预设源码（GitHub `farion1231/cc-switch` `src/config/*ProviderPresets.ts` × 9 文件，v3.16.0 主分支，2026-09 抓取）
> - models.dev 官方全量目录 `models.dev/api.json`（213 家，2026-09 抓取，副本存档于 `docs/ideas/data/models.dev-api.json`）
> - opencode 官方 docs（opencode.ai/docs/cli、/tui、/permissions）+ 源码（`packages/opencode/src/...`，dev 分支）
> - Claude Code 官方 docs（code.claude.com/docs/en/permission-modes、/agent-sdk/permissions）
> - OpenAI Codex 官方 docs（developers.openai.com/codex/permissions、openai-codex.mintlify.app/concepts/sandboxing）+ codex-rs README
> 说明：web_search 内置通道 401、Tavily key 失效，本次以 **Exa** 检索 + 官方站点 raw 抓取为主；凡版本敏感或未能一手确认处标注「待验证」。报告日期为 2026-09，所引用模型名/版本号（Claude Opus 5、GPT-5.6 等）为资料当时口径，落地任务 020 时请按 models.dev 当日快照刷新默认模型。

---

## 0. 一页结论（TL;DR）

**A（020 供应商目录）**：cc-switch 现网实际是「**按目标应用分文件**」的预设体系（Claude Code / Claude Desktop / Codex / Gemini / OpenCode / OpenClaw / Hermes / Grok Build / 统一网关共 9 组），每组 30~85 个预设，绝大多数是**同一批第三方中转站/聚合站**（PackyCode / APINebula / 9527CODE / DMXAPI / A6API …）配不同应用侧格式，真正"上游厂商级"实体约 **40 家**。我们不能照搬它的 100+ 条（大半是分销商，且 base-url 随版本变），而应采用"**厂商级实体 + 分类**"的模型，从 models.dev 213 家官方目录中筛出 **≥55 家主流**，cc-switch 的 9 份源码表 + models.dev 快照已完整存档（`docs/ideas/data/`），可直接转 `presets.data.ts`。协议按 createProvider 三协议归一：**anthropic / openai-compatible / mock**（openai-responses 归 openai-compatible；Gemini 原生走 openai-compatible 兼容端点或标注"经兼容层"）。

**B（021 TUI）**：opencode 一条命令的真相是 **client/server 双进程**：`opencode` 无参 → 起本地 server（会话/工具/权限/事件总线全在 server）+ TUI 客户端（经 SDK 走 SSE）。TUI 渲染层是 **SolidJS + 自研 @opentui/solid**（早先的 ink/React 版本已被替换）；交互上它其实也只是"**滚动回放区 + 底部 footer（输入行/状态栏/许可浮层）**"，slash 命令在 prompt 状态机里 `/` 触发菜单分发。对我们的轻量方案结论：**不要引 React/ink，也不要从零做全屏重绘**——用「**raw TTY + 自绘输出区（ANSI 滚动缓冲）+ @clack/prompts 承载所有选择/表单**」就足以达到 `cah` 直接进 chat 的目标（验收标准里没有任何一条需要全屏 TUI）。若未来要真全屏，再评估 blessed / terminal-kit（见 §B5 推荐矩阵）。

**C（022 权限三档）**：opencode 本身没有"三档"，它是 **per-tool allow/ask/deny + 粒度 pattern**（无网络权限工具时的默认接近 full）；Claude Code 是 **mode 体系**（default=读放行其余问 / acceptEdits=工作区内写放行 / plan / auto / dontAsk / bypassPermissions）；**Codex 才是三档命名的来源**（read-only / workspace-write / danger-full-access，OS 级沙箱）。本仓库 `policy.default.yaml` 已用三档 profile 命名 + approval + filesystem/shell 分层，语义对齐 Codex 是正确方向。三档 × 工具面矩阵见 §C4，落地时 policy 侧三档差异只需**加一个 approval=ask 的中间档**（现 v0.1 approval 只有 never）+ read-only 档把 allowWrite/shell 关掉，就能在三卡验收内闭环。

---

## A. 供应商预设全表（任务 020）

### A1. cc-switch 的真实结构（先破除"50+ 一张表"的误解）

cc-switch（farion1231/cc-switch，Tauri 桌面，及衍生 ui 版 huangbogeng/cc-switch-ui）**没有"一份 50+ 供应商列表"**。它的预设按「目标工具应用」分组，每个应用一份 `src/config/<app>ProviderPresets.ts`，同一厂商在不同应用里重复出现且 base-url/api 格式不同。实测源码（v3.16.0 主分支）：

| 预设文件 | 预设数 | 面向应用 | 配置形态 |
|---|---|---|---|
| claudeProviderPresets.ts | ~34+ | Claude Code | env 注入（`ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL`），apiFormat 可 anthropic/openai_chat/openai_responses/gemini_native |
| claudeDesktopProviderPresets.ts | ~85 | Claude Desktop | 角色路由（sonnet/opus/fable/haiku）+ 直连/映射两种模式 |
| codexProviderPresets.ts | ~35 | Codex CLI | auth.json + config.toml 字符串（wire_api=responses）|
| geminiProviderPresets.ts | ~26 | Gemini CLI | env（`GOOGLE_GEMINI_BASE_URL/GEMINI_MODEL`）|
| opencodeProviderPresets.ts | ~78（含模型变体）| OpenCode | npm 包 + baseURL + models（`@ai-sdk/openai-compatible`/`@ai-sdk/anthropic`/`@ai-sdk/openai`/`@ai-sdk/google`/`@ai-sdk/amazon-bedrock`）|
| openclawProviderPresets.ts | ~77 | OpenClaw | provider/model 引用重写 |
| hermesProviderPresets.ts | ~78 | Hermes | 只读标识/环境注入 |
| grokBuildProviderPresets.ts | ~40 | Grok Build | TOML |
| universalProviderPresets.ts | 2 | 统一网关 | NewAPI/自定义网关 |

分类体系（`ProviderCategory`，源码实测）：`official`（官方）、`cn_official`（国产官方）、`third_party`（第三方中转/分销）、`aggregator`（聚合站）、`cloud_provider`（AWS Bedrock）、另有 `omo`/`custom` 等少数。**这正是任务 020 要的 category，可直接映射**（官方/国内/聚合/本地/国际）。

去重后真正的"上游厂商/网关实体"约 40+ 家，其中 **cn_official 国产官方全家桶**是 cc-switch 最有价值的部分（第三方工具里最全），包括：

- **Kimi / Moonshot**：Claude Code 走 `https://api.moonshot.cn/anthropic`（anthropic 协议）；OpenCode/OpenAI 兼容走 `https://api.moonshot.cn/v1`；Kimi For Coding 专属 `https://api.kimi.com/coding/`（anthropic）——三类端点别混。
- **DeepSeek**：Claude Code 走 `https://api.deepseek.com/anthropic`；OpenCode 走 `https://api.deepseek.com/v1`（models.dev 记录为 `https://api.deepseek.com`，兼容端点可接 /v1）。
- **Zhipu GLM（Z.ai）**：大陆 `https://open.bigmodel.cn/api/anthropic`（Claude 侧）/ `https://open.bigmodel.cn/api/paas/v4`（OpenAI 兼容，models.dev 佐证）；国际 `https://api.z.ai/api/anthropic`、`https://api.z.ai/api/paas/v4`。
- **Qwen / 百炼（DashScope）**：Claude 侧 `https://dashscope.aliyuncs.com/apps/anthropic`；OpenAI 兼容 `https://dashscope.aliyuncs.com/compatible-mode/v1`（models.dev `alibaba-cn` 佐证）。
- **MiniMax**：大陆 `https://api.minimaxi.com/anthropic/v1`（anthropic）/ `https://api.minimaxi.com/v1`（OpenAI）；国际 `https://api.minimax.io/...`（models.dev `minimax-cn` = minimaxi.com、`minimax` = minimax.io 佐证；注意现网主域名已从 minimax.chat 迁至 minimaxi.com/minimax.io——**我们 presets.ts 里的 `https://api.minimax.chat/v1` 已过时，落地 020 时改**）。
- **StepFun 阶跃**：大陆 `https://api.stepfun.com/v1`，国际 `https://api.stepfun.ai/v1`（models.dev 佐证）；coding plan 专属 `/step_plan/v1`。
- **火山引擎（Doubao/豆包）**：Ark `https://ark.cn-beijing.volces.com/api/v3`（OpenAI 兼容）；coding plan `.../api/coding/v3`；Claude 侧走 plan/coding 端点。
- **腾讯混元/TokenHub**：现网从 `api.hunyuan.cloud.tencent.com` 演进到 TokenHub 系：Claude 侧 `https://api.lkeap.cloud.tencent.com/plan/anthropic` / `https://tokenhub.tencentmaas.com/plan/anthropic`；OpenAI 兼容 `https://api.lkeap.cloud.tencent.com/plan/v3` / `https://tokenhub.tencentmaas.com/v1`（models.dev `tencent-tokenhub` 佐证）。——**我们 presets.ts 的混元 `api.hunyuan.cloud.tencent.com/v1` 仍可用（老 OpenAI 兼容端点），但 TokenHub 才是现推**。
- **BaiLing 百灵/万象**（tbox.cn）、**Longcat**、**ModelScope 魔搭**（`https://api-inference.modelscope.cn/v1`）、**硅基流动 SiliconFlow**（大陆 `https://api.siliconflow.cn/v1`、国际 `https://api.siliconflow.com/v1`）、**Xiaomi MiMo**、**Baidu Qianfan** 等。

cc-switch 的 official/aggregator/third_party 三大类 ≈ 任务 020 的 official/intl/cn/aggregator/local，但注意它把大量**分销中转站**（PackyCode、APINebula、9527CODE、DMXAPI、A6API、AiHubMix、CCSub、CrazyRouter、SubRouter、SoleAPI、RunAPI、ZetaAPI、FennoAI、PatewayAI、AICodeMirror、SudoCode.us、ClaudeCN、Cubence、AtlasCloud、Compshare、PPIO、TeamoRouter、TheRouter、CherryIN、RelaxyCode、E-FlowCode、JieKouAI、AICodeWith、XycAi、RightCode、Micu、Shengsuanyun(胜算云)、Qiniu、APIKEY.FUN、Amux、SSSAiCode、ETok、Novita、PIPELLM、Nvidia 等）也当"预设"平铺。**这类站每季度都在开开关关、base-url 和分成链接频繁变**，直接抄全表会给我们埋雷。建议：官方与主流聚合进目录（OpenRouter/SiliconFlow/ModelScope/Novita/Nvidia/Azure 等稳定者），长尾分销站**不进目录**（留给 `custom base-url` 手动填），宁少而准。

### A2. 我们该用的清单骨架：models.dev 全量（213 家）为权威底座

models.dev（opencode 的模型目录数据源，`models.dev/api.json`，官方 JSON，2026-09 抓取 213 家）每家有 `id / name / api(base-url) / npm(SDK 包) / env(认证 env) / models{...}`。它**已把"国际主流"覆盖得非常干净**，且 base-url 与 AI SDK 对接过，可靠性高于 cc-switch 的 env 串。示例（`docs/ideas/data/models.dev-providers.csv` 全量）：

- 国际原生：anthropic（api.anthropic.com，@ai-sdk/anthropic）、openai（api.openai.com）、google（generativelanguage，@ai-sdk/google）、xai（api.x.ai）、mistral、cohere、groq、cerebras、togetherai、fireworks-ai（`api.fireworks.ai/inference/v1/`）、deepinfra、meta（api.meta.ai）、perplexity、nvidia（`integrate.api.nvidia.com/v1`）、azure、amazon-bedrock、huggingface（`router.huggingface.co/v1`）、ollama-cloud、lmstudio、watsonx、databricks、modal、scaleway、upstage、sakana、poolside、snowflake-cortex、cloudflare-workers-ai、venice、novita-ai、nebulab 等。
- 国内系在 models.dev 也全有：alibaba-cn（dashscope 大陆）、alibaba（dashscope-intl）、moonshotai-cn、deepseek、zhipuai/zai/zai-coding-plan、stepfun/stepfun-ai、siliconflow-cn/siliconflow、volcengine、tencent-tokenhub/tencent-token-plan、minimax-cn/minimax、bailing、modelscope、xiaomi、qiniu-ai、302ai、sensenova、d.run 等。

**结论 A2**：任务 020 的 ≥55 家清单 = cc-switch 确认的「官方 + 国产官方 + 主流聚合」（A1 的厂商实体）× 与 models.dev 的 api/npm 对齐校验，再补 models.dev 独有的国际大厂。**不做**：把 cc-switch 100+ 分销商全抄。协议映射：models.dev 的 `@ai-sdk/anthropic` → anthropic；`@ai-sdk/openai-compatible`/`@ai-sdk/openai`/其余 → openai-compatible（openai-responses 作为 createProvider 将来的子能力，先归 openai-compatible）；本地（ollama/vllm/lmstudio）→ openai-compatible + baseUrl 默认 localhost。

### A3. 交付用全表（可直接转 presets.data.ts 的字段级清单）

> 字段：`id | name | category | protocol | baseUrl | auth | defaultModel`。category 用 020 验收的 `official/cn/aggregator/local/intl`（official=官方国际+官方国产不再细分则用 cn 标国产；本表把国产官方标 `cn`、国际官方标 `official`、聚合/中转标 `aggregator`、本地标 `local`）。baseUrl 列**与 cc-switch 源码或 models.dev 逐条核对过**（标 ✅=models.dev 佐证 / ▲=cc-switch 源码 / ⚠=旧版或需现场验证）；未标 defaultModel 的留空让 `/v1/models` 拉取，defaultModel 大多取 models.dev 该 provider 第一顺位（2026-09 口径，落地时刷新）。认证默认 api-key；oauth/env 单列。

#### ① 官方（国际，official）——13 家

| id | name | protocol | baseUrl | auth | defaultModel | 来源 |
|---|---|---|---|---|---|---|
| anthropic | Anthropic（Claude 官方） | anthropic | https://api.anthropic.com | api-key | claude-sonnet-4-6 | ✅models.dev+▲ |
| openai | OpenAI | openai-compatible | https://api.openai.com/v1 | api-key | gpt-5.6-sol | ✅models.dev（openai） |
| google-gemini | Google Gemini | openai-compatible | https://generativelanguage.googleapis.com/v1beta/openai | api-key | gemini-3.6-flash | ✅models.dev(google)；原生走 AI SDK，兼容端点需按官方 openai compat 路径「待验证」 |
| xai | xAI（Grok） | openai-compatible | https://api.x.ai/v1 | api-key | grok-code-fast-1 | ✅models.dev(xai) |
| mistral | Mistral | openai-compatible | https://api.mistral.ai/v1 | api-key | mistral-large-latest | ✅models.dev(mistral) |
| cohere | Cohere | openai-compatible | https://api.cohere.com/v2 | api-key | command-a | ✅models.dev(cohere) |
| groq | Groq | openai-compatible | https://api.groq.com/openai/v1 | api-key | llama-3.3-70b-versatile | ✅models.dev(groq) |
| cerebras | Cerebras | openai-compatible | https://api.cerebras.ai/v1 | api-key | gpt-oss-120b | ✅models.dev(cerebras) |
| togetherai | Together AI | openai-compatible | https://api.together.xyz/v1 | api-key | deepseek-ai/DeepSeek-V3 | ✅models.dev(togetherai) |
| fireworks | Fireworks AI | openai-compatible | https://api.fireworks.ai/inference/v1 | api-key | accounts/fireworks/models/* | ✅models.dev(fireworks-ai) |
| perplexity | Perplexity | openai-compatible | https://api.perplexity.ai | api-key | sonar-reasoning-pro | ✅models.dev(perplexity) |
| nvidia | Nvidia NIM | openai-compatible | https://integrate.api.nvidia.com/v1 | api-key | deepseek-ai/deepseek-v3.1 | ✅models.dev(nvidia)+▲ |
| azure-openai | Azure OpenAI | openai-compatible | https://<res>.openai.azure.com/openai/v1 | env(AZURE_API_KEY+res) | — | ✅models.dev(azure)；需 resource，放 custom 交互填 |

#### ② 国产官方（cn）——16 家

| id | name | protocol | baseUrl | defaultModel | 来源 |
|---|---|---|---|---|---|
| deepseek | DeepSeek | openai-compatible | https://api.deepseek.com/v1 | deepseek-chat / deepseek-reasoner | ✅+▲；anthropic 兼容在 /anthropic |
| qwen | 通义千问 Qwen（DashScope） | openai-compatible | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen-max | ✅models.dev(alibaba-cn) |
| qwen-intl | Qwen（国际 DashScope） | openai-compatible | https://dashscope-intl.aliyuncs.com/compatible-mode/v1 | qwen3.7-max | ✅models.dev(alibaba) |
| kimi | Kimi（Moonshot 大陆） | openai-compatible | https://api.moonshot.cn/v1 | kimi-k2.7-code | ✅+▲（anthropic 端点在 /anthropic） |
| kimi-intl | Kimi（Moonshot 国际） | openai-compatible | https://api.moonshot.ai/v1 | kimi-k2.7-code | ✅models.dev(moonshotai) |
| glm | 智谱 GLM（大陆） | openai-compatible | https://open.bigmodel.cn/api/paas/v4 | glm-5.2 | ✅+▲（anthropic 端点在 /api/anthropic） |
| glm-intl | 智谱 Z.ai（国际） | openai-compatible | https://api.z.ai/api/paas/v4 | glm-5.2 | ✅models.dev(zai) |
| minimax | MiniMax（大陆） | openai-compatible | https://api.minimaxi.com/v1 | MiniMax-M2.7 | ✅models.dev(minimax-cn)；⚠旧 minimax.chat 作废 |
| minimax-intl | MiniMax（国际） | openai-compatible | https://api.minimax.io/v1 | MiniMax-M2.7 | ✅models.dev(minimax) |
| stepfun | 阶跃星辰 StepFun（大陆） | openai-compatible | https://api.stepfun.com/v1 | step-3.5-flash | ✅models.dev(stepfun) |
| stepfun-intl | StepFun（国际） | openai-compatible | https://api.stepfun.ai/v1 | step-3.5-flash | ✅models.dev(stepfun-ai) |
| doubao | 火山引擎豆包（Ark） | openai-compatible | https://ark.cn-beijing.volces.com/api/v3 | doubao-1.5-pro-32k | ✅models.dev(volcengine)+▲ |
| hunyuan | 腾讯混元 TokenHub | openai-compatible | https://api.lkeap.cloud.tencent.com/v1 | hunyuan-turbos-latest | ✅models.dev(tencent-tokenhub)（另 plan/v3 套餐端点见 A1） |
| bailian | 阿里百炼（Claude 兼容） | anthropic | https://dashscope.aliyuncs.com/apps/anthropic | claude-sonnet-4-6 | ▲cc-switch（需走百炼 Anthropic 兼容） |
| bailing | 百度千帆 Baidu Qianfan | openai-compatible | https://qianfan.baidubce.com/v2 | ernie-4.5 | ▲cc-switch（coding/token plan 端点不同，走 base 的兼容 v2「待验证」） |
| minimo | 小米 MiMo | openai-compatible | https://api.xiaomimimo.com/v1 | MiMo-VL-7B-RL | ✅models.dev(xiaomi)（anthropic 端点 /anthropic） |
| sensenova | 商汤 SenseNova | openai-compatible | https://token.sensenova.cn/v1 | Nova-4 | ✅models.dev(sensenova) |

#### ③ 聚合 / 网关（aggregator）——16 家（只收主流稳定，长尾分销不收录）

| id | name | protocol | baseUrl | defaultModel | 来源 |
|---|---|---|---|---|---|
| openrouter | OpenRouter | openai-compatible | https://openrouter.ai/api/v1 | openrouter/auto | ✅+▲ |
| siliconflow | 硅基流动 SiliconFlow | openai-compatible | https://api.siliconflow.cn/v1 | deepseek-ai/DeepSeek-V4 | ✅models.dev(siliconflow-cn)+▲ |
| modelscope | ModelScope 魔搭 | openai-compatible | https://api-inference.modelscope.cn/v1 | Qwen/Qwen3-Coder | ✅models.dev(modelscope)+▲ |
| novita | Novita AI | openai-compatible | https://api.novita.ai/v1 | deepseek/deepseek-v3 | ✅models.dev(novita-ai) |
| huggingface | Hugging Face（Inference） | openai-compatible | https://router.huggingface.co/v1 | — | ✅models.dev(huggingface) |
| github-copilot | GitHub Copilot（兼容端点） | openai-compatible | https://api.githubcopilot.com | — | ✅+▲；⚠OAuth 托管认证 |
| deepinfra | DeepInfra | openai-compatible | https://api.deepinfra.com/v1/openai | meta-llama/Llama-3.3-70B | ✅models.dev(deepinfra) |
| together | Together（合并②已有则去重） | openai-compatible | https://api.together.xyz/v1 | — | 同②togetherai 去重 |
| moonshot-relay | （略：被 Kimi 官方顶替） | — | — | — | 不收录 |
| 302ai | 302.AI | openai-compatible | https://api.302.ai/v1 | gpt-5.6 | ✅models.dev(302ai) |
| ai-route | AI-ROUTER | openai-compatible | https://api.ai-router.dev/v1 | — | ✅models.dev(ai-router) |
| nebulab | Nebius | openai-compatible | https://api.nebius.com/v1 | — | ✅models.dev(nebius) |
| requesty | Requesty | openai-compatible | https://router.requesty.ai/v1 | — | ✅models.dev(requesty) |
| portkey | Portkey | openai-compatible | https://api.portkey.ai/v1 | — | ⚠未在本次数据源核实「待验证」 |
| oneapi | OneAPI（自部署网关） | openai-compatible | http://localhost:3000/v1 | — | local 模板（新 API 兼容） |
| newapi | NewAPI（自部署网关） | openai-compatible | https://<your>/v1 | — | ▲cc-switch universal（自部署，填自己的域） |

#### ④ 本地 / 推理服务（local）——6 家

| id | name | protocol | baseUrl | defaultModel | 来源 |
|---|---|---|---|---|---|
| ollama | Ollama | openai-compatible | http://localhost:11434/v1 | llama3.1 | ✅+现有 |
| vllm | vLLM | openai-compatible | http://localhost:8000/v1 | — | 现有 |
| lmstudio | LM Studio | openai-compatible | http://localhost:1234/v1 | — | ✅models.dev(lmstudio) |
| llama.cpp | llama.cpp server | openai-compatible | http://localhost:8080/v1 | — | 常见本地端点「待验证」 |
| jan | Jan | openai-compatible | http://localhost:1337/v1 | — | ✅models.dev(atomic-chat 1337 系，Jan 官方端口 1337 「待验证」) |
| mock | Mock（内置离线） | mock | — | mock | 现有，测试用 |

> 汇总计数：①13 + ②16 + ③去重后 ~13 + ④6 ≈ **48 稳定可核**；再补 models.dev 中仍有口碑的国际长尾（azure/bedrock/watsonx/cloudflare/snowflake/databricks/modal/scaleway/upstage/perplexity-agent/sakana/poolside/gitlab-duo/we-are-venice 等任选 8~12）即可稳过 ≥55 验收。全量 213 家见 `docs/ideas/data/models.dev-providers.csv`，落地时从中挑，勿凭空造。

### A4. 落地 020 的注意事项（踩坑）

1. **不要改 12 个既有 id**：现有 anthropic/openai/deepseek/qwen/kimi/glm/minimax/hunyuan/openrouter/vllm/ollama/mock 全部保留，只修正 base-url 与 defaultModel（MiniMax minimax.chat→minimaxi.com、混元补 TokenHub 备选端点）。
2. **baseUrl 冗余校验**：models.dev 的 api 字段是最可靠底（它对接 AI SDK），cc-switch 的 env 串只做交叉验证；凡两者冲突且无法判定者标「待验证」，宁可不进目录。
3. **auth 标注**（020 验收字段）：api-key 为绝大多数；google-gemini/github-copilot/azure/bedrock 标 oauth/env（github-copilot 是 OAuth 托管账号，不宜当普通 api-key 预设——**建议不进主表或加危险提示**）。
4. **anthropic 协议族**：除 Anthropic 官方外，国产 Anthropic 兼容端点（DeepSeek/GLM/Kimi/Qwen 百炼/MiniMax/MiMo）目前都要求专属路径（/anthropic、/api/anthropic、apps/anthropic 等）。对 createProvider('anthropic', {baseUrl}) 只拼 {base}/v1/messages 的现状（见 PROVIDER-RESEARCH-ANTHROPIC.md），这些端点无法直接命中 → **020 要么只收 OpenAI 兼容形态（推荐，绝大多数厂商兼容 v1 就在），要么 createProvider 加"anthropic 兼容子路径"配置项**（v0.3 再议，先标 TODO）。
5. **defaultModel 时效**：Claude/GPT/GLM 等命名逐月换代（2026-09 已是 opus-5/gpt-5.6/glm-5.2），defaultModel 必须允许为空并在向导里 `/v1/models` 拉取覆盖；本表默认值仅是兜底提示。

---

## B. opencode 的 TUI / 启动架构（任务 021）

### B1. `opencode` 一条命令的启动流程（官方 docs + 源码）

- **无参 `opencode` = 进 TUI**（docs/cli："The OpenCode CLI by default starts the TUI when run without any arguments"；`opencode [project]` 可选目录）。**没有单独的 setup 前置**——首次运行没 key 时在 TUI 内用 `/connect` 引导。
- 进程模型是 **server/client**（源码：CLI `tui` 命令 → 起/连本地 server → TUI 客户端经 `@opencode-ai/sdk` 订阅 SSE 事件流）：会话、agent loop、工具、权限、事件总线全在 server 侧；TUI 只是渲染 + 输入 + 许可浮层。这样 Web/Desktop/VS Code 复用同一套后端（docs 的 "User Interfaces" 页把它叫 client-server 架构）。
- 启动时装载（源码 `config/config.ts`）：
  1. 配置分层合并：全局 `~/.config/opencode/{config.json,opencode.json,opencode.jsonc}` → 项目 `.opencode/` 与本地 opencode.json 等，`mergeConfig` 后向；可选 `--config` 覆盖。
  2. **provider/model 装载**：config 里 `model` 可以是 `"provider/model"` 全限定串（config.ts 中 `if (provider && model) result.model = ${provider}/${model}`）；provider 清单来自 **Models.dev 目录 + 本地 `auth.json` 登录过的 provider + env/.env 里的 key**（docs/cli auth："When OpenCode starts up it loads the providers from the credentials file. And if there are any keys defined in your environments or a .env file"）。**没有显式 provider 配置 = 自动用有凭证的那个**。
  3. `opencode` 启动后若无凭证 → TUI 里 /connect；有凭证 → 直接进对话，状态栏显示当前 agent/model。

**对我们的启示**：`cah` 无参进 TUI 完全可行，且我们已有等价物：`ProviderStore`（~/.dsh/providers.json SSOT + current.json）≈ opencode 的 auth.json + config 的 provider 选择；`runSetupWizard` 可被 `/provider`/`/connect` 复用（SetupIO 已注入化，见 PROVIDER-UX-RESEARCH §1.2）。**不需要 server/client 拆分**——我们单进程即可：TUI 里每次提交 → 现调 `composeHarness().loop.runTurn()`（复用 cli.ts cmdRun 中间那段，把 harness 实例提升为会话级长活，而非每轮重建；会话级复用对 memory/session log 也更好）。

### B2. TUI 内部结构（渲染/命令/布局）

**渲染**：现版（2026-07 起 dev 分支）是 **SolidJS + 自研 `@opentui/core` + `@opentui/solid`**（DeepWiki 6.2 页：terminal rendering primitives box/text/textarea/scrollbox + flexbox + dirty-rect 优化，渲染到终端用 ANSI/转义序列），早年的 React Ink 版已被替换。Codex Rust 版 TUI 则是 **Ratatui**。二者都说明：chat TUI 的工程真相是「**输出区(回放/滚动) + 底部 footer(输入/状态/许可)**」，不是给用户做桌面应用。

**布局**（源码 footer.*）：footer 纵向三块 —— ① Composer/输入行或激活 dialog（许可浮层 `RunPermissionBody` / 提问浮层 `RunQuestionBody`）；② Menus（自动补全/选择面板，如模型选择、skill 选择）；③ **状态栏 statusline**（当前模型、用量、按键提示）。scrollback 是只读 append-only 的会话回放。keybind：`ctrl+x` leader + 快捷键（/exit、/models、/compact…）。

**slash 命令分发**：prompt 输入框是一个状态机（`createPromptState`）——行首 `/` 触发命令菜单（fuzzy），`@` 触发文件/agent 引用补全；提交后命令进 dispatcher，会话命令（/models /connect /compact /exit /sessions /new /undo /redo /init /themes /thinking /details /export /editor …）与会话上下文解耦（Docs 的 TUI 页列出了全部）。**没有"每命令弹整屏"**——/connect /models 都只是把 footer 换成选择面板（dialog-select 风格）。

**对话驱动底层 agent**：server 侧 `session/llm.ts` 用 Effect 流式调模型（stream chunks）→ `SessionProcessor` 识别 text/tool deltas → 写 session → 经 bus 发事件（message.updated / part.delta / permission 需要时走异步 ask→reply 的 Deferred 状态机，见 `permission/index.ts`：`evaluate()` 对 ruleset 做 findLast 通配匹配，默认兜底 `ask`；`ask` 挂起该工具调用直到 UI 回复 once/always/reject）。

**类比 composeHarness**：`composeHarness({provider, model, permission, policy...})` 就是我们的 "server"（loop.runTurn = 我们的事件循环；session.replay = transcript 回放源；audit/denial = 许可/拒绝事件）。TUI 只需把 `runTurn` 变成可增量渲染（见 B4 方案），权限的 once/always/reject 走 022 的 approval=ask 管道。

### B3. opencode 权限模式（022 需要的档位词汇，来自官方 permissions 文档）

opencode **没有三档预设**，它是**默认放开 + 粒度覆盖**：permission 值 allow/ask/deny，per-tool + pattern（`"bash": {"*":"ask","git *":"allow","rm *":"deny"}` 最后匹配赢），支持 external_directory / doom_loop / .env 默认 deny；`--auto` 全局自动批准非 deny 项。Tools: read/edit(含 write/patch)/glob/grep/bash/task/skill/webfetch/websearch/question/lsp。**UI 上的 ask 三选**：once / always(记住 pattern，会话级) / reject。它的 "plan 只读 agent" = `edit:deny + bash 白名单`，说明 read-only 档在 opencode 是"配出来的"，不是内置枚举。**这提示我们 022 不要照抄 opencode 的模型，而应学 Codex 的三档命名 + Claude 的 mode 语义**（见 C）。

### B4. `cah` TUI：轻量实现建议（评估 + 推荐）

**约束回顾**：目标不是"做第二个 opencode 全屏 TUI"，而是 021 验收那几条：chat 输入 + 输出区 + 状态栏（当前模型/供应商/权限）、斜杠命令、对话跑 composeHarness、非 TTY 提示。**没有一条需要全屏重绘/滚动回放优化/鼠标支持**。

**方案评估**：

| 方案 | 技术 | 优点 | 缺点 | 适配度 |
|---|---|---|---|---|
| **A. raw TTY + ANSI 自绘（只重绘底部/增量刷输出）+ @clack 承载表单** | node:readline 或手写 raw-mode + cursor 控制 | 依赖最轻（@clack 已在用）、输出区可保留终端原生滚动/复制、Ctrl+C/粘贴/IME 天然好、可测（注入 IO） | 没有现成 box 布局；"重绘上一行"要自己算 | **★推荐** |
| B. 全屏重绘循环（blessed/neo-blessed） | blessed | box/widget 齐全、区域布局省心 | 依赖较重、渲染 bug 多、与原生终端滚动冲突、IME/中文输入问题多、新依赖 | 若以后要真全屏再看 |
| C. terminal-kit | terminal-kit | 底层能力强、文档细 | API 偏底层、学习成本、无布局框架 | 中间偏下 |
| D. React+ink | ink | 组件化漂亮（opencode 旧版即此） | **明确不要**（重、React 心智、opencode 自己都弃了） | ✗ |
| E. @clack 全套 + 极简 readline 主循环 | 纯 @clack | 零新依赖、向导全复用 | 消息流式渲染弱（clack 是"一问一答"） | 仅适合"向导式"非 chat |

**推荐 A（raw TTY + @clack 混合）具体做法**（021 落地蓝图）：
- 主循环：`readline/promises`（非 raw）逐行读输入 → 判断 `/` 命令或普通消息。输出模型回复时**直接把增量文本 console.log 到滚动区**（天然可滚动可复制），不用全屏；仅"一行内更新"的场景（如状态栏模型/权限变化、tool 执行中提示）用 ANSI `\x1b[?25l` + cursor up 行覆盖或干脆追加日志行。
- 状态栏：**放在每轮回复后的固定一行**（"当前 provider/model · permission · 输入 /help"），不需要常驻底部刷新——chat 类交互里"状态栏随对话滚动"完全可接受（opencode 的常驻 statusline 是它全屏方案的产物）。
- 表单与选择（/provider、/models、/permission、/setup）：**全部走已有 @clack/prompts**（createClackIO 已把 IO 注入化，测试可脚本化——正好满足 021"注入 IO 测试、不依赖真 TTY"）。先隐藏自绘光标，调 clack 渲染，完成后恢复。
- 会话级 harness：一次 `composeHarness` 常驻，每轮 `runTurn(prompt)` 增量产出（把 runTurn 内部对 provider 的流式回调接出来打点，若目前是整段返回，先在 TUI 里"按 turn 输出 + 轮间 tool 摘要"，流式逐 token 是 v0.4 优化项）。
- 斜杠分发：`/provider`→runSetupWizard；`/models`→modelFetcher 拉取后 clack select；`/permission`→三档 select 写回当前 harness（permission 运行时覆盖，见 C）；`/model <id>`→切换；`/help`、`/quit`。**都是复用现有函数，新增量主要是"主循环 + 分发表"**。
- 非 TTY：无参 + 非 TTY → 打"cah 交互模式需要 TTY；一次性输入用 `cah run --prompt ...`"（021 已列）。
- bin：package.json 加 `"bin": {"cah": "..."}`（当前无 bin，见 A 节现状），npm link 即得全局 `cah`。

> 备选加分：如果 V0.3 真想升级"全屏 + 常驻状态栏 + 许可浮层"，最省心的路径不是 blessed 而是学 Codex 用成熟 Rust? 不——保持 TS：届时评估 `terminal-kit`（仍在维护、文档全、比 blessed 干净）或 fork 轻量渲染自绘。本次 021 无需。

### B5. 我们 vs opencode 的一次性差异清单（021 落地自检）

- opencode 首次没 key → /connect；我们已有 setup 向导 + ProviderStore → 首次进 TUI 无 current provider 时提示"运行 /provider 或 /setup"即可，无需强制阻塞。
- opencode model = "provider/model" 全限定；我们是 provider.id + model 字段（SSOT providers.json），TUI 状态栏显示 `currentId · model · permission`，等价。
- opencode 命令集里有 /init（生成 AGENTS.md）、/undo /redo（git 支撑）；我们 021 验收只要 provider/models/setup/permission/help/quit/model，undo/compact 可后续。

---

## C. 权限三档语义（任务 022）

### C1. 各家"档位"词汇与真实定义（一手文档）

**Codex（三档命名来源，最贴近我们要对齐的）**：官方 docs/permissions + mintlify sandboxing + codex-rs README：
- `read-only`：可读任意文件、可跑进程、**不可写**；默认无网络（network_access 独立开关）。
- `workspace-write`（默认）：可读任意文件；**可写 cwd + `--add-dir` 指定目录**；`.git/`、`.codex/` 等 protected paths 永远只读；网络默认关，`network_access=enabled` 才开。
- `danger-full-access`：无沙箱，任意文件/命令/网络。
- 实现是 OS 级：macOS Seatbelt / Linux Landlock+seccomp(或 bubblewrap) / Windows restricted token。另有独立于沙箱的 **approval policy**（untrusted/on-request/unless-trusted/never）决定"沙箱外动作要不要问"。新式 `permissions` profile（`:read-only/:workspace/:danger-full-access` + filesystem read/write/deny + network 域规则）逐步取代旧 sandbox_mode。

**Claude Code（mode 体系）**：官方 permission-modes 文档六档：
- `default`：只读放行，写/命令/网络要问。
- `acceptEdits`：工作区(+additionalDirectories)内文件写 + 常见 fs 命令（mkdir/touch/rm/rmdir/mv/cp/sed）自动放行；工作区外、protected paths、其余 Bash 仍问。
- `plan`：只读探索，禁止编辑（文件编辑永不自动放行，走 canUseTool 回调/问）；编辑需先出计划获批。
- `auto`：模型分类器审查每步动作（AI 决定），非白名单高危拦截。
- `dontAsk`：任何会问的都改为拒绝（只跑 allow 规则+只读命令），CI/脚本用。
- `bypassPermissions`：全放行（连 protected paths 都写），仅限容器/VM。
- **protected paths**（.git/.config/git/.vscode/.idea/.husky/.claude/.envrc 及一堆 dotfile）：除 bypassPermissions 外任何模式都不自动放行。规则层 allow/ask/deny 在任意 mode 下叠加，deny 连 bypassPermissions 也拦。

**opencode**：无档位枚举，per-tool allow/ask/deny + pattern（见 B3）。默认"permissive defaults"（多数 allow，external_directory/doom_loop ask、.env deny）。

### C2. 三档 → 每类工具默认策略矩阵（对齐 022 验收的 Read/Write/Edit/Shell/网络/删除）

> 口径采用 Codex 三档命名（本仓库 policy 已是这套命名），语义综合 Codex+Claude 的 protected/deny 铁律。

| 操作类 | read-only | workspace-write（默认） | danger-full-access |
|---|---|---|---|
| Read（读工作区+外部文件） | ✅ 放行 | ✅ 放行 | ✅ 放行 |
| .env / secrets 读取 | ❌ deny（铁律） | ❌ deny（.env 读默认禁；与 Codex/oc/Claude 一致） | ⚠ ask 或仍 deny（建议 retain deny） |
| Write/Edit（工作区内新建/改文件） | ❌ deny（工具面不暴露或拦截） | ✅ 自动放行（工作区内） | ✅ |
| 工作区外写（external_directory / 非 cwd 路径） | ❌ deny | ⚠ ask（Codex 默认拒绝/受 --add-dir 约束；Claude 问） | ✅ |
| .git / 配置类 protected path 写入 | ❌ deny | ❌ deny（Codex/Claude 都保） | ⚠ 放行但保留危险提示（可允许，审计仍记） |
| Shell 只读命令（ls/cat/git status/grep…） | ✅ 白名单放行（policy 已有 shell.allow） | ✅ | ✅ |
| Shell 普通命令（npm/build/test/非破坏） | ❌ deny | ⚠ ask（approval=ask 引入后；now never+deny 规则拦高危） | ✅ |
| Shell 破坏性（rm -rf /、格式化、分区、force push） | ❌ deny | ❌ deny（never_auto；铁律） | ⚠ ask 一次 or 放行? —— 建议保留硬 deny 于 "rm -rf /、格式化"，full 档放行普通 rm/危险但**根/家目录清除仍拒**（对齐 Claude bypass 的 circuit breaker） |
| 网络（fetch/搜索/API） | ⚠ 默认关（read-only 建议禁网；Codex 默认无网络）| ✅/⚠（按策略；Codex workspace-write 默认禁、显式开）| ✅ |
| 子代理/任务 | ⚠ ask | ⚠ ask 或放行 | ✅ |
| 删除（工作区内删文件） | ❌ | ✅（走回收站铁律的受管工具；CLI 的 rm 由 shell.deny 拦）| ✅（仍建议受管回收站） |

**一句话语义**（可直接进 docs）：read-only = 只能看不能说改；workspace-write = 能改工作区、不能出圈、高危命令永不自动放行；danger-full-access = 什么都能做，但 .env 读取与"根/家目录破坏性删除"仍保留最低护栏与审计。

### C3. 映射到本仓库 policy（现状核对 + 缺什么）

现状 `configs/policy.default.yaml`（v0.1）已有：`profile: workspace-write`、`approval: never`、`filesystem.protected/.deny_read/allow`、`shell.deny/allow/scoped_rules`、`tools.rules`、`network.default: allow`、audit。缺三档真正差异化的是两件事：
1. **approval 只有 never** → 需加 `ask` 态（v0.1 ApprovalPolicy 预留了"ask UI lands later"），三档 → approval/profile 组合：
   - read-only → profile 只读 + approval never（连 ask 都不给，直接 deny 写）
   - workspace-write（默认）→ 现 policy 不变（approval never + deny 高危 = fail-closed 工作区写）**或** 加 approval=ask 让 shell 高危变"问"（022 验收要"workspace-write 高危要问或拒"，never+deny 已满足"拒"，但建议把 shell 中危（npm publish/force push 白名单外）改成 ask 体验更贴近市面）
   - danger-full-access → 同 workspace-write 但放宽 shell 高危为 ask、放开 filesystem 出圈写；保留 .env deny + 根删除 deny
2. **工具面的 read-only 拦截**：现在 deny 靠规则；022 验收要 mock 下可断言"read-only 禁 Write、danger 放 Shell"——意味着 compose 的 permission 参数已接好（cli.ts --permission 已传 composeHarness），只需 policy 侧把 permission 值转成"运行时覆盖层"（加 filesystem.allowWrite=false / shell 高危降级 / tools 面板过滤），做成 `buildPolicyVariant(base, mode)` 纯函数即可测。

**TUI 联动（021/022 交集）**：`/permission` select 三档 → 写当前 harness（调用运行时覆盖，或提示"重启会话生效"）；状态栏显示当前档；`run --permission <mode>` 已实现（cli.ts flag 现成），保持默认 workspace-write 不破坏既有测试。

---

## D. 来源索引（URL 清单）

- cc-switch 源码 presets：https://github.com/farion1231/cc-switch/tree/main/src/config（claudeProviderPresets.ts / claudeDesktopProviderPresets.ts / codexProviderPresets.ts / geminiProviderPresets.ts / opencodeProviderPresets.ts / openclawProviderPresets.ts / hermesProviderPresets.ts / grokBuildProviderPresets.ts / universalProviderPresets.ts，v3.16.0）
- cc-switch 官方教程/供应商页（ccswitch.co/cc-switch.cc 官方多语言镜像）：https://cc-switch.cc/en/providers 、 https://cc-switch.cc/en/tutorials/provider-setup 、 https://ccswitch.co/docs/providers-add.html
- cc-switch changelog（含 provider 生态说明）：https://ccswitch.io/changelog （DeepWiki/镜像）
- models.dev 官方目录：https://models.dev/providers （JSON: https://models.dev/api.json，快照存 docs/ideas/data/models.dev-api.json）
- opencode docs：https://opencode.ai/docs/cli/ 、 https://opencode.ai/docs/tui/ 、 https://opencode.ai/docs/permissions/ 、 https://opencode.ai/docs/config/
- opencode 源码（sst/opencode，注意仓库已迁 anomalyco/opencode）：https://github.com/sst/opencode/blob/dev/packages/opencode/src/cli/cmd/tui/... 、 https://github.com/sst/opencode/blob/dev/packages/opencode/src/session/session.ts 、 config/config.ts 、 permission/index.ts ；DeepWiki 架构页 https://deepwiki.com/sst/opencode/6.2-terminal-user-interface-(tui) 、 6.5-tui-prompt-component
- Claude Code：https://code.claude.com/docs/en/permission-modes 、 https://code.claude.com/docs/en/agent-sdk/permissions
- OpenAI Codex：https://developers.openai.com/codex/permissions 、 https://openai-codex.mintlify.app/concepts/sandboxing 、 https://github.com/openai/codex/blob/main/codex-rs/README.md
- 本仓库参照：`apps/cli/src/providers/presets.ts`、`ProviderStore.ts`、`setup.ts`、`cli.ts`、`configs/policy.default.yaml`、`docs/ideas/PROVIDER-UX-RESEARCH.md`、`docs/ideas/PROVIDER-RESEARCH-ANTHROPIC.md`、`tasks/020|021|022-*.md`

> 本报告为调研产物，未改任何代码；数据快照见 `docs/ideas/data/`（models.dev-api.json、models.dev-providers.csv、cc-switch-presets-parsed.tsv）。
