# 供应商/模型配置的交互引导调研（PROVIDER-UX-RESEARCH.md）

> 调研日期：2026-09（资料以当时官方文档与 GitHub 为准）
> 用途：为 Composable Agent Harness 的 CLI「引导式 / 斜杠命令式」供应商配置体验（`cah setup` 向导 + `/` 命令式模型切换）提供设计依据
> 范围：纯网络调研 + 对照本仓库 `apps/cli/src/providers/*` 现状，不改代码
> 重要说明：第三方工具行为以官方 docs / GitHub / npm 为准；凡我未能从一手来源确认、或版本敏感（TUI 逐版变动）的，一律标注「待验证」。

---

## 0. 一页结论（TL;DR）

用户痛点：`cah provider add/switch/models` 记参数、敲命令麻烦 → 想要「进入界面 → 搜索选供应商 → 填 key → 拉模型 → 搜索勾选 → 底部提交」的引导式体验。

七个被调研对象的共性是**同一条引导流**：

```
选(搜索)供应商 → 填 key(密码框) → (可选)端点 → 拉模型 → 勾选/选默认模型 → 确认写入 → 一键切换生效
```

其中可落地性最强、最贴近我们要抄的三个：

1. **opencode**（第三方友好标杆 ①）：`/connect` 一个斜杠命令完成「列出供应商（Popular/Other 分组，带推荐标注）→ 选 auth 方式（订阅 OAuth / API key）→ 粘贴 key → 自动进 `/models`」；key 独立存 `auth.json`，模型清单来自 Models.dev 预置目录 + `/v1/models` 拉取，`/models` picker 切换模型，`provider/model` 全限定 id 贯穿配置与 CLI。`/connect` 与 `/models` 解耦 = 「先接供应商、后挑模型」。
2. **Pi Agent**（第三方友好标杆 ②）：极简 + 30+ 第三方供应商预置（DeepSeek/Groq/OpenRouter/Kimi/MiniMax/Qwen…），每个供应商**内置一份工具可用模型目录**（随版本刷新 + `models-store.json` 缓存），key 认证统一走 `/login`（订阅走 OAuth），模型切换统一 `/model`（Ctrl+L），**picker 内 Ctrl+S 把高亮模型存为启动默认**。凭证解析优先级 `--api-key flag → auth.json → env → models.json`。
3. **cc-switch 模型管理模块**：GUI 形态最完整的同款向导——预设下拉 → 自动填端点 → 填 key → **Fetch Models 按钮（下载图标）** → 调 `/v1/models` → **分组下拉**选模型；错误分类引导（401/403 查 key、404/405 无 `/v1/models` 则回退手填、解析失败、超时）；每个 provider 记住自己的**档位默认模型**（ANTHROPIC_MODEL 主模型 + SONNET/OPUS/HAIKU 三档别名映射，正是 Claude Code 的四 key 结构）；切换时模型跟着走，且 **Claude Code 支持热切换不需重启**。

Claude Code / Codex 是「自家模型优先」的对照组：模型选择做成**别名档位**（sonnet/opus/haiku…）而不是全量列表，第三方体验反而绕（靠 env 映射 + settings.json 手工改）。

本仓库现状：`apps/cli/src/providers/setup.ts` 已有一个 @clack/prompts 向导雏形（select 供应商 / password key / multiselect 模型 / confirm 覆盖与设默认），ProviderStore 已实现 SSOT + current.json + 原子写。**推荐规格 = 在现有雏形上做「搜索化 + 分组 + 错误重试 + 模型缓存 + 档位」五处升级**，控件选型见 §8，分步规格见 §11。

---

## 1. 项目背景与对标基线

### 1.1 我们要解决什么

用户原话抽象：不想记 `--provider/--base-url/--api-key/--model` 参数组合，想要类 GUI 向导：搜索供应商 → 填 key → 拉模型 → 搜索 + 空格勾选 → 底部「提交」。调研目标是回答：

- 每步用什么控件形态（搜索框 / 单选列表 / 多选 / 密码框 / spinner / 确认）
- 步骤顺序与跳步（哪些可省略、哪些必须验证）
- 错误与重试怎么引导（key 错、拉模型失败）
- 最终确认与写入（写什么文件、如何原子化、如何提示生效时机）
- 模型清单怎么来、怎么缓存、怎么成为「单一事实源」
- 切供应商时「默认模型」怎么跟着走（档位问题）

### 1.2 本仓库现状（对照基线，截至调研日）

- `apps/cli/src/providers/ProviderStore.ts`：SSOT `~/.dsh/providers.json`（id/name/protocol/baseUrl/apiKey/model/models?/note?）+ `~/.dsh/current.json`；原子写（tmp+rename）；mock 内置不持久化；`CAH_PROVIDER_ROOT` 可隔离。
- `apps/cli/src/providers/setup.ts`：`runSetupWizard()` 已实现 5 步引导（选供应商→(custom) base-url→password key→multiselect 模型→确认覆盖/设默认），全部走注入的 `SetupIO`（测试可脚本化）；@clack/prompts 实现为默认。
- `apps/cli/src/providers/modelFetcher.ts`：openai-compatible 实时 `GET {base}/v1/models`；anthropic 无公开枚举端点 → 内置 Claude 代际清单兜底（诚实标注非实时）。
- `docs/PROVIDER-MANAGEMENT.md`：命令层参考（provider add/switch/models/current/list）。

即：**向导的骨架已经在**。本次调研的价值在把骨架升级成对标 opencode/Pi/cc-switch 的体验细节（搜索、分组、档位、重试、缓存）。

---

## 2. Claude Code（对照组：自家模型 + 别名档位）【精简】

官方模型配置文档（code.claude.com/docs/en/model-config，v2.1.x 系）要点：

- **会话内切换**：`/model <别名|全名>` 立即切换；`/model` 无参打开 picker。
- **picker 交互细节**（v2.1.153 起，值得抄）：
  - `Enter` = 切换并**存为用户默认**（写 settings 的 `model` 字段，即写 `~/.claude.json`/settings）
  - `s` = **仅本次会话切换**，不落盘
  - 直接输入 `/model <值>` 等价于 Enter
  - 会话已有输出时切换会问确认（因为要重读全量历史、丢缓存上下文）
  - 启动 header 会显示当前模型来自哪个 settings 层（user/project/managed），`/model` 覆盖后 project/managed 下轮启动会再压回来——**作用域提示做得很显式**
- **启动与持久**：`claude --model <别名>` 仅本次会话；`ANTHROPIC_MODEL` env 仅本次启动；settings `"model": "opus"` 写死默认。
- **别名档位**（不是全量列表）：`default`（账户默认）/`best`/`fable`/`opus`/`sonnet`/`haiku`，以及 `opusplan`（plan 用 opus、执行切 sonnet）、`sonnet[1m]` 等。别名指向「当前推荐版本」，随时间滚动——用户不用记版本号。
- **档位→具体模型的映射由 env 控制**（这正是 cc-switch 抄的「四 key」）：
  - `ANTHROPIC_DEFAULT_OPUS_MODEL` / `..._SONNET_MODEL` / `..._HAIKU_MODEL` / `..._FABLE_MODEL`：把 picker 里 opus/sonnet/haiku/fable 条目背后的真实模型 id 换掉（第三方/网关/ Bedrock profile 场景必用）；可带 `_NAME`/`_DESCRIPTION`/`_SUPPORTED_CAPABILITIES` 后缀控制 picker 显示。
  - `ANTHROPIC_MODEL`：启动主模型，不覆盖别名映射。
  - `ANTHROPIC_CUSTOM_MODEL_OPTION`：往 `/model` picker 加一条自定义模型（网关专用模型不用替换内置别名也能选）。
- **限制与回退**：`availableModels` 白名单限制 `/model`/`--model`/env/model 全入口；`modelOverrides` 做 per-model 的 id 重写（如 Bedrock ARN）。子代理模型独立：`CLAUDE_CODE_SUBAGENT_MODEL`。
- **settings.json 管理**：`/config` 交互编辑（会写 settings 文件）；settings 分层（managed > 命令行 > env > user/project/local），`env` 键可在 settings.json 内声明；`/model` 保存的默认会「跨会话、跨项目」扩散（GitHub issue #50568 反馈的坑：没提示就全局生效）——**写入作用域必须对用户说清楚**。
- **首次启动引导**：官方安装后无强制「选模型向导」；首次要么浏览器 OAuth 登录（claude.ai），要么用户自己 export key。真正的「引导配置」发生在第三方生态（cc-switch 之类），不在官方 CLI 内。

对我们最可抄的三点：①picker 里 Enter=持久 / s=仅会话 的双语义；②切换前有已生成上下文时给确认（成本提示）；③写默认前明示作用域（用户级会跨项目扩散）。

来源：
- https://code.claude.com/docs/en/model-config
- https://code.claude.com/docs/en/settings（/model、/config 写 settings 的行为）
- https://code.claude.com/docs/en/env-vars（ANTHROPIC_* env 与 settings 键的优先级）
- https://github.com/anthropics/claude-code/issues/50568（/model 全局扩散的 UX 坑）

---

## 3. Codex CLI（对照组：config.toml 手工 provider 表）【精简】

官方文档（developers.openai.com/codex/config-*）：

- **配置载体**：`~/.codex/config.toml`（用户级）+ 项目级 `.codex/config.toml`（需信任才加载，且 provider/auth 键被禁、必须放用户级）；profiles 用 `~/.codex/profile-name.config.toml` + `--profile`。
- **provider 定义**：内置 `openai`（Responses）/`oss`(Ollama)/`lmstudio` 保留不可覆写；自定义放 `[model_providers.xxx]`，字段 `name`/`base_url`/`env_key`/`wire_api`(responses|chat)/`requires_openai_auth`/`http_headers`/`auth.command`（外部取 token 的命令，stdout 打 token，可配 refresh_interval）。全局选 `model_provider = "xxx"` + `model = "gpt-5.x"`。
- **登录引导**：`codex login` 无参默认开浏览器走 ChatGPT OAuth；也支持 `--api-key`（交互粘贴 / env）与 access token；凭证存 auth.json / keyring。若本地 OSS provider 未指定且非交互模式会报错退出（交互模式给选择）。
- **`/model`**：composer 里输 `/model` 弹 popup 选模型（含 reasoning effort 选项），确认后在 transcript 打印新模型，`/status` 可核验。
- **对第三方友好度**：比 Claude Code 稍好（config.toml 是显式 provider 表，社区模板多），但依然「要手写 TOML + env_key」，没有「拉模型」动作、没有搜索列表。OSS（Ollama/LM Studio）反而是最顺的一条路（`codex --oss` 或交互选）。
- Codex 的一个启发：`model_catalog_json`（cc-switch 生成给它用，见 §7.5）——第三方可以让 Codex 的 `/model` 列出自己的模型名，即**模型清单可被注入为「单一事实源」**。

对我们可抄的一点：provider 与模型分键管理（`model_provider` 与 `model` 分离），切换 provider 不必动 model 字段本身——「provider 是自己的、model 是自己的、当前组合是组合」，比 Claude 的 env 一锅端更清晰。

来源：
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/config-advanced（model_providers 自定义）
- https://developers.openai.com/codex/cli/reference（codex login、/model、--oss）
- https://github.com/openai/codex/blob/rust-v0.63.0/docs/example-config.md

---

## 4. opencode（第三方友好标杆 ①，重点深挖）

> 依据：官方 docs（opencode.ai/docs/providers、/docs/models、/docs/tui、/docs/cli）+ 源码（sst/opencode 的 `packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx`、docs mdx）。TUI 逐版在变，源码行号对应检索到的 commit，属「当时实现」，标待验证处会注明。

### 4.1 两条命令 = 全部引导

- `/connect`：加供应商（TUI 里斜杠命令，keybind 常与命令面板同列）——**把「认证/接 provider」做成了列表向导**。
- `/models`（keybind `ctrl+x m`）：列出可用模型、选模型。

设计关键：**接供应商与选模型是两步、两条命令**，各自独立可重入。接完 provider key 就能 `/models`，模型永远从 provider 出发枚举，不存在「手填模型字符串」的主路径（自定义 provider 才要手填 config，见 4.4）。

### 4.2 /connect 的交互序列（源码级证据）

`dialog-provider.tsx` 可见的流程：

1. 打开一个 provider 列表对话框，条目带 `category` 与 `description` 说明，按 `PROVIDER_PRIORITY` 排序（源码里写死优先级：`opencode:0, anthropic:1, github-copilot:2, openai:3, google:4`，其余落 `category:"Other"`）。文档里的 UI 呈现就是**Popular / Other 两组**。
   - 推荐位带备注：opencode 标 `(Recommended)`；anthropic 标 `(Claude Max or API key)`；openai 标 `(ChatGPT Plus/Pro or API key)`——**在列表里直接告诉用户「我能怎么登」**。
2. 选中后若该 provider 有多个 auth 方式（`provider_auth` 有多个 method），弹二级选择（如 Anthropic 给「Claude Pro/Max（浏览器 OAuth）/ Manually enter API Key」）。
3. 按 method 分派：
   - **api**：弹 API key 对话框粘贴 key（provider 专属文案如 Zen 给「Go to opencode.ai/zen to get a key」），确认后 `auth.set({type:"api", key})`。
   - **oauth(浏览器)**：弹「Waiting for authorization…」面板 + 打开浏览器，等 localhost 回调；面板给 `esc` 取消；授权码型（device/code flow）给「code + 一键复制到剪贴板（按 c 复制）+ 粘贴回来」的面板（源码里 Clipboard.copy 绑 c 键）。
4. 成功后重新 bootstrap，回到可用状态。
- 凭证落盘：`~/.local/share/opencode/auth.json`（按 provider 存）。
- 命令行等价物：`opencode auth login`（交互、可选 `--provider/-p` 与 `--method/-m` 跳选）、`opencode auth list`、`opencode auth logout`。

### 4.3 模型从哪来（三个来源 + 枚举命令）

- **预置目录**：OpenCode 由 Models.dev（模型元数据 API）驱动，75+ provider 预置、热门 provider 默认预载；启动按「CLI `--model` > config 的 model 列表 > 上次使用的模型 > 内置优先级首个可用」装载。
- **供应商实时列表**：有 key 的 provider 在需要时从 Models.dev/上游拉（文档对 OAuth 类写「fetch live model lists … on demand」）。
- **本地自定义**：config 里声明的模型（见 4.4）。
- 命令行：`opencode models [provider]` 打印 `provider/model` 全限定 id；`--refresh` 强制刷新缓存。
- 模型在 TUI 里显示与选择：`/models` picker；模型 id 显示成 **provider 前缀的短名**（如 `anthropic/claude-sonnet-4-...`），结果里也按 provider 分组感很强（GitHub issue #31206 里用户示例模型名 `zai-coding-plan/glm-5.1`、`openrouter/deepseek/deepseek-v4-pro`——即三层嵌套也照列）。选中即当前会话生效，config `"model": "anthropic/claude-sonnet-4-20250514"` 可设启动默认。
- 过滤：provider 配置支持 `blacklist`/`only` 隐藏不想出现在 `/models` 的模型（用 picker 里同款模型 id）——**给用户「列表瘦身」能力**。

### 4.4 自定义 provider（OpenAI 兼容 = 最顺的路）

非预置 OpenAI 兼容 provider 的文档流程是「half-GUI + half-config」：

1. `/connect` 滚到 **Other** → 输 provider id（提示「用个记得住的 id，config 里要用」）→ 输 key → 完成（提示：这只是存了 credential，需在 opencode.json 里补配置）。
2. `opencode.json` 加 `provider.<id>`：`npm`（`@ai-sdk/openai-compatible` 走 `/v1/chat/completions`；`/v1/responses` 用 `@ai-sdk/openai`）、`name`（UI 显示名）、`options.baseURL`、可选 `apiKey: "{env:XXX}"` / `headers`、`models` 映射表（模型 id → `{name, limit:{context,output}}`）。
3. `/models` 里就能看到它。

要点：**id 是全链路锚点**（credential 的 provider id、config 的 provider key、`/models` 里的 `provider/model` 前缀三者必须一致），config 与凭证两文件分离（`auth.json` 管密钥、`opencode.json` 管接线/模型元数据）。

### 4.5 已知 UX 坑（反面教材）

GitHub issue #31206：模型 picker 里**明明 auth.json 已有 key，选中 provider 仍再弹一次 API key 输入**（CLI flag 绕开则正常）——即「认证态与 picker 不同步」。教训：**向导每步要先查「是否已满足前置」再决定要不要问**（key 已有 → 跳过输入直达模型步），这是我们做 `cah setup` 时要显式处理的幂等逻辑。

对我们可抄的点：①供应商选择器 = 搜索/滚动单选 + Popular/Other 分组 + 「怎么登」备注；②多 auth 方式做二级选择；③OAuth/device 面板给「code 一键复制 + 等回调」；④凭证与接线分离；⑤`/connect`（接 provider）与 `/models`（选模型）两命令解耦；⑥picker 里 provider 前缀限定模型名；⑦前置已满足就跳步。

来源：
- https://opencode.ai/docs/providers/
- https://opencode.ai/docs/models/
- https://opencode.ai/docs/tui/
- https://opencode.ai/docs/cli/
- https://github.com/sst/opencode/blob/4695e685/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx（dialog 源码，commit 4695e685 当时实现）
- https://github.com/anomalyco/opencode/issues/31206（picker 重复要 key 的 bug）

---

## 5. Pi Agent（第三方友好标杆 ②，重点深挖）

> 依据：pi-mono（badlogic/pi-mono，现 earendil-works/pi）coding-agent 的官方 README/docs（providers.md / models.md / custom-provider.md）+ pi.dev 文档。注意：pip 包名有 @mariozechner/pi-coding-agent 旧名与 @earendil-works/pi-coding-agent 新名两版并存，文档混用，「待验证」处会标。

### 5.1 定位：极简 + 无锁定的第三方第一

Pi 明确「不绑定自家模型」：核心只给 4 工具（read/write/edit/bash），不带 sub-agent/plan mode，一切可扩展。供应商支持是「订阅 + API key」双轨、**30+ 个** API-key 供应商（DeepSeek、NVIDIA NIM、Groq、Cerebras、Mistral、OpenRouter、Vercel AI Gateway、Hugging Face、Fireworks、Together、Baseten、Kimi For Coding、MiniMax、Qwen Token Plan、Xiaomi MiMo、OpenCode Zen/Go、Cloudflare…）——对「非官方/非公司属性 agent 最重视第三方」的判断完全成立。

### 5.2 每个供应商自带「工具可用模型目录」

- 对每个内置 provider，Pi 维护一份**支持 tool calling 的模型清单**，随每个 release 更新；已配置的 provider 会刷新目录并缓存到 `~/.pi/agent/models-store.json`（离线可用）。
- 用户侧刷新命令：`pi update --models`（只刷目录）。
- 模型元数据相当全（models.md 字段）：`reasoning`（是否支持思考）、`thinkingLevelMap`、`input` 类型、`contextWindow`、`maxTokens`、`cost`（每百万 token 单价，含 cacheRead/cacheWrite）——**目录同时是「可选项清单」+「上下文/价格参考」，picker 里能展示这些信息**（文档提 `/model`、`--list-models`、底部 footer 会显示模型详情）。

启发：我们的 `configs/pricing.json` + models 表（现有代码里已有 pricing.ts）正好能承接同一角色：**目录 = 可选模型清单 + 上下文窗口 + 单价**，向导勾选时就能展示「这个模型多大上下文、多少钱」。

### 5.3 认证：/login 一统订阅与 key

- `/login`（交互）→ 选 provider：订阅类走 OAuth（Claude Pro/Max、ChatGPT Plus/Pro(Codex)、GitHub Copilot、xAI、Gemini/Antigravity 等）；API key 类交互存 key。
- 凭证落盘 `~/.pi/agent/auth.json`（`{"anthropic":{"type":"api_key","key":...}}`），OAuth token 自动刷新；`/logout` 清除。
- env 也可（每个 provider 一个规范 env 名，见 providers.md 大表，如 `DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY`）。
- **解析优先级（明写进文档）**：①CLI `--api-key` → ②`auth.json` → ③环境变量 → ④models.json 里自定义 provider 的 apiKey。这条对我们很有用：**cah run 解析 key 也应该有一条明确优先级并写文档**。
- 自定义 provider：`~/.pi/agent/models.json`（支持 OpenAI Completions/Responses、Anthropic Messages、Google Generative AI 协议），字段 `baseUrl`/`api`/`apiKey`(支持 `$ENV` 插值与 `!command`)/`headers`/`authHeader`/`models`/`oauth`；或写 TS 扩展 `registerProvider(...)`（可 async fetch `/v1/models` 动态注册模型）。

### 5.4 模型切换：/model + Ctrl+S 存默认

- `/model`（或 Ctrl+L）打开模型 picker，选任意 provider 的任意模型即切换。
- **picker 里 Ctrl+S 把当前高亮模型存为启动默认**（README 明说 Press Ctrl+S … save the highlighted model as the startup default）。
- `/scoped-models`：启用/停用哪些模型参与 Ctrl+P 快速循环（相当于给「常用模型」打个子集，避免 Ctrl+P 在几十个模型里翻）。
- CLI 等价：`--model provider/id`、`--model sonnet:high`（模型+思考档）、`--models a,b`（Ctrl+P 循环子集）、`--list-models [search]`、`--provider`、`--api-key`。
- 会话内切换模型（跨 provider）保留上下文（pi-ai 的 cross-provider handoff）——切模型不丢对话。

对我们可抄的点：①「内置目录 + 可刷新缓存」比「每次都实时拉」对 TUI/offline 更稳；②认证动作收敛到单个 `/login` 动词（订阅与 key 统一），交互即「选 provider → 输 key」两问；③模型 picker 提供 Ctrl+S 存默认 + 常用子集（Ctrl+P）；④凭证解析优先级明确成文。

来源：
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md（与 badlogic/pi-mono 主 README 同源）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md（auth.json / env 大表 / 解析优先级）
- https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md（models.json 字段）
- https://pi.dev/docs/latest/providers（同 providers.md 的在线版）
- https://pi.dev/docs/latest/custom-provider（扩展注册 / oauth）

---

## 6. cc-switch 模型管理模块（独立深章：向导 + 模型管理 UX 最完整参照）

> 依据：cc-switch（farion1231/cc-switch，Tauri 桌面）官方 docs（ccswitch.io/docs / cc-switch.dev/docs / GitHub docs/user-manual）+ cc-switch-ui（huangbogeng/cc-switch-ui，Web + Rust 后端）+ 第三方集成文档（longcat、agentsflare、we0）。GUI 细节随版本演进，逐像素 UI 我无一手截图，标「待验证」处指版本敏感细节。

### 6.1 添加供应商面板（Add Provider）——GUI 形态的标准向导

打开方式：主界面右上角 `+` → 打开 Add Provider 面板。面板两 Tab：
- **App-specific Provider**：只用于当前选中的应用（Claude Code / Claude Desktop / Codex / Gemini / OpenCode / OpenClaw / Hermes）——顶层是「应用选择器」，决定写哪个工具配置。
- **Universal Provider**：一份配置跨应用共享（名/key/端点 + 勾选要同步的应用）。

预设流（文档推荐的第一路径）：
1. 在「预设」下拉选供应商（50+ 内置：DeepSeek/OpenAI/Anthropic/Google/Copilot/Codex/MiniMax/SiliconFlow/OpenRouter…）
2. 名称 + 端点自动填充（不用记 endpoint）
3. 只填 API Key
4. 可选备注
5. 点「添加」→ 卡片出现在列表

自定义流：切「自定义」→ 填 name/endpoint/key（+ 高级选项：API 格式 Anthropic Messages / OpenAI Chat / OpenAI Responses、完整 URL 模式等）。

### 6.2 Fetch Models（Auto-Fetch Models）——模型字段的「拉取」动作

添加或编辑 provider 时，模型输入框旁有 **Fetch Models 按钮（下载图标）**：

1. 先确保 API Key 与 Endpoint URL 已填
2. 点 Fetch Models
3. 用当前配置的 key 调 OpenAI 兼容 `GET /v1/models`
4. 从**下拉菜单**选模型

覆盖范围：所有带模型字段的 provider 表单（Claude Code/Claude Desktop/Codex/Gemini/OpenCode/…）；Codex OAuth 类不从 `/v1/models` 拉，而是**按需从 ChatGPT Codex 后端拉实时列表**。

**错误分类引导（文档明列，可直接抄成错误文案模板）：**

| 错误 | 含义 | 引导 |
|---|---|---|
| 401 / 403 | key 不对/权限不足 | 检查 API Key |
| 404 / 405 | 上游没暴露 `/v1/models` | **回退手动填模型 ID**（不是失败，是降级） |
| 解析失败 | 返回不符合 OpenAI 兼容格式 | 说明格式不兼容 |
| 超时 | 端点慢/网络问题 | 稍后重试或查网络 |

关键设计点：**Fetch Models 失败 ≠ provider 不能用**，只是「自动发现」不可用，界面应保留手动填模型 ID 的出路（文档原话：如果自动获取失败，不代表供应商一定不能用）。

### 6.3 模型下拉/列表的形态与「档位」绑定

- 下拉「按类别分组」选模型（文档原话「从按类别分组的下拉菜单里选择可用模型」）。
- 真正体现「模型管理」的是 **Claude 生态的档位结构**：CC Switch 为每个 provider 写入/管理 Claude Code settings.json 的 env，字段是（§2 别名映射的落地）：

```
ANTHROPIC_AUTH_TOKEN（或 API_KEY）+ ANTHROPIC_BASE_URL
ANTHROPIC_MODEL                     ← 主模型（启动默认）
ANTHROPIC_DEFAULT_OPUS_MODEL        ← opus 档（复杂任务）
ANTHROPIC_DEFAULT_SONNET_MODEL      ← sonnet 档（日常主力）
ANTHROPIC_DEFAULT_HAIKU_MODEL       ← haiku 档（快速/子代理）
（新版本同族还出现 _FABLE_MODEL；每档可选 _NAME/_DESCRIPTION 控制显示）
```

- 一次 provider 配置 = 一个主模型 + 三(四)个角色档位映射。填一个模型时：**只填一个角色也可以，其余角色自动沿用已填模型**（CC Switch 文档：留空角色自动沿用第一个已填模型，Sonnet 优先，保证子 agent 调用始终有模型）。这解决「只用一个模型也要把 haiku/sonnet/opus 三个 env 都填了」的痛点。
- 写入 sample（longcat 集成文档展示了生成结果）：CC Switch 把 provider 卡片转成 settings.json 的 `env` 块，`ANTHROPIC_DEFAULT_*_MODEL` 全部指向所选模型。
- 对 **Codex** 则是写 `~/.codex/config.toml`（`[model_providers.xxx]` + model_provider/model）+ `auth.json`。
- 对 **Claude Desktop**：直连 vs 模型映射两模式——映射表把任意上游模型映射到 Sonnet/Opus/Haiku 三个「角色路由」，列：模型角色 | 菜单显示名 | 实际请求模型 | 1M 标记。

### 6.4 「模型清单 = 单一事实源」：Codex 的 Model Mapping 表

编辑 Codex provider 时开「Needs Local Routing」→ 出现 **Model Mapping 表**，每行：模型 ID（上游真实名，如 `deepseek-v4-flash`）| 显示名称（可选，/model 里显示的名）| 上下文窗口（可选）。

- 映射表生成 Codex 的 `model_catalog_json` → **让 Codex 的 `/model` 命令列出这些第三方模型名**（否则 Codex 只认 GPT 系列）。
- 「表中条目按填写内容原样保存，是模型列表的**唯一来源**（single source of truth）」。
- 注意：Codex 在启动时加载 model_catalog_json，**改完要重启 Codex** 才刷新列表（我们自己的 CLI 没有这限制，热读即可——这是本仓库的优势）。

### 6.5 一键切换 + 模型跟着走 + 生效提示

- 切换 = 卡片上点 **Enable**（卡片高亮 + 「Currently Enabled」标签）；tray 菜单点 provider 名即切。
- **每个 provider 记住自己的默认模型**：切换 provider 时，CLI 下次启动读到的是该 provider 自己那套 env（主模型+档位），模型天然跟着 provider 走——因为「模型」存在 provider 配置里，不存全局。
- 生效提示差异化：Claude Code 支持热切换（settings.json 热加载，不用重启终端）；**其他工具（Codex/OpenCode/Gemini 等）需要重启**，CC Switch 会提示「请重启对应工具」。
- 速度测试：卡片上 speed-test 按钮测端点延迟（🟢<500ms / 🟡500-1000ms / 🔴>1000ms）——**切换前给健康信号**。
- 防呆设计「minimal intrusion」：系统永远保留一个激活配置，不允许删光（防止 CLI 变得不可用）；卸载 CC Switch 不影响已写入的 CLI 配置。首次启动可导入现有 CLI 配置作为默认 provider。
- 数据层：SQLite `~/.cc-switch/cc-switch.db` + 原子写 + 自动备份轮转；settings.json 只写「merge-only env 更新，保留用户其它 settings 键」（cc-switch-ui 明说 merge-only 保留原 settings）。

### 6.6 UI 布局与我们的借鉴映射

Provider 页布局：顶部应用选择器（Claude/Codex/Gemini/…）→ 中部 provider 卡片列表（每卡：名/端点/主模型，按钮：Enable/Edit/Delete/speed-test）→ 右上 `+` 开添加面板。模型字段在添加/编辑面板内，Fetch Models 按钮贴模型输入框。

对 `cah setup` 向导的借鉴映射：
- 应用选择器 → 我们不需要（cah 自己是 harness 运行时，直接写 `~/.dsh`），但「导入已有 provider 作默认」值得抄。
- 预设填充（端点/默认模型预填，用户只补 key）→ **抄**。
- Fetch Models = 向导第 4 步的「拉模型」按钮位（我们的 setup.ts 是自动拉，可加「失败后手动重试/手动填 id」）→ **抄错误降级语义**。
- 档位默认模型（一个主模型 + 角色档位）→ 我们的 ProviderConfig 目前只有 `model` 单值；要支持「子任务/快速模型分档」，需扩 `models` 语义或加档位字段（见 §11 差异清单）。
- provider 记住自己的默认模型 + 切换时整包生效 → 我们 current.json 已做到 provider 级默认，天然符合。
- merge-only 写 settings / 原子写 / 备份 → 我们 ProviderStore 已原子写，缺「备份轮转」（低优先）。

来源：
- https://ccswitch.co/docs/providers-add.html（与 cc-switch.dev/docs/provider-management/add-provider 同内容）
- https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/2-providers/2.1-add.md（含 2.3-edit、2.6-claude-desktop）
- https://github.com/huangbogeng/cc-switch-ui（Providers 页流程：预设或自定义 → Detect endpoint type + Fetch models → Save and switch）
- https://longcat.ai/platform/docs/cc-switch（settings.json 写入结果示例：四档 env 全指向 LongCat-2.0）
- https://docs.agentsflare.com/guide/integration/cc-switch（Fetch Models → Save；失败排查 3 问）
- https://github.com/farion1231/cc-switch/issues/2362（ANTHROPIC_MODEL vs DEFAULT_* 的语义澄清）
- https://we0.ai/articles/claude-code-setup-guide-cc-switch（端到端使用体验叙述）

---

## 7. 补充参考（精简）

### 7.1 Gemini CLI

- 首次启动即**强制认证选择**：交互给 1) Login with Google 2) Use Gemini API key 3) Vertex AI 三选；Google OAuth 走本地回环服务器收授权码并缓存（后续免登录）。headless/无 env 时直接报错退出。
- 模型不是全量 picker，而是 `/model` 里的 **Auto/Pro/Manual 路由档**（Auto=按复杂度自动 routing 到 Flash/Pro，Pro=固定最强，Manual=手填模型名）；settings 在 `~/.gemini/settings.json`。
- 可抄点：首次启动的「认证方式三选一」引导 + OAuth 回环收码缓存。

来源：https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html

### 7.2 Cursor / Windsurf（IDE 设置页形态，参考「勾选模型 + 验证按钮」）

- Cursor：Settings > Models。BYOK 结构：每 provider 一段（OpenAI/Anthropic/Google/Azure/Bedrock）+ **每 key 一个 Verify 按钮**（验证通过给绿勾）；模型列表每条前有**开关 checkbox**（勾选=在 picker 可用）；`+ Add Model` 手填模型串 + 可留空 base URL（官方端点自动）。模型选择器在 chat/composer 顶部，custom 模型带「人形小图标」标明走你自己的 key。可抄：**verify 按钮（key 写完立刻验证，绿勾反馈）**、**每模型开关**、**BYOK 标记**。
- Windsurf：Settings > AI，Custom Model Provider / External API（base URL + key + model 名三元组）。
- 不深挖：本质是 GUI 版同款向导，GUI 细节对 TUI 借鉴有限。

来源：https://cursor.com/help/models-and-usage/api-keys 、https://markaicode.com/cursor-custom-ai-models-claude-gemini-deepseek/

### 7.3 LiteLLM / Vercel AI SDK 的 dashboard（仅一句话定位）

- LiteLLM：`/v1/models` 即其标准枚举口，OpenAI 兼容格式是事实标准，任何做「拉模型」的向导都该先打 `/v1/models`——本仓库 modelFetcher 已如此。Vercel AI SDK 生态提供 provider registry（models.dev 即其配套）与 `@ai-sdk/openai-compatible` 等 npm 包，opencode 正是靠它做到 75+ provider。对我们启发：**协议抽象（openai-compatible/anthropic/google）之上挂 provider 预设，模型枚举与线协议解耦**。

来源：https://models.dev 、https://opencode.ai/docs/providers/

---

## 8. 终端交互库选型（为 cah setup 定控件）

### 8.1 各家定位

- **@clack/prompts**（~500K/周，1.0 已发布，Astro/SvelteKit 等在用）：现代 CLI 引导默认件。预置 `intro/outro`、`text`、`password`（掩码输入）、`confirm`、`select`、`autocomplete`（输入即过滤 + 列表，**搜索选供应商用它**）、`autocompleteMultiselect`（**搜索 + 空格多选一体，勾模型用它**）、`multiselect`、`groupMultiselect`（分组多选，如按类目分组的模型）、`spinner`、`log`、`cancel`。取消统一返回 `isCancel` 符号，ESM/TS 原生。⚠️ clack 的 select 是否支持输入过滤随版本走：**要「输入即搜」请显式用 autocomplete / autocompleteMultiselect，别依赖 select 的过滤**（本仓库 setup.ts 目前用 select+multiselect，注释称「输入可搜索」——若目标版本 select 不支持过滤，需换成 autocomplete 系，见 §11.5 差异）。
- **ink**（~900K/周，React for CLI）：适合「常驻可更新的复杂 TUI/仪表盘」（实时进度、多面板），不适合线性向导（重、React 运行时）。opencode 那种整屏 TUI 用 ink 类方案；我们目前不需要。
- **@inquirer/prompts**（SBoudrias 重写版，模块化 @inquirer/*，含 `search`、`checkbox`(带搜索的第三方 checkbox-plus 等)、`password`、`select`）：稳、CJS/ESM、传统企业项目多。可用作 @clack 之外的第二候选；交互更朴素。
- **prompts**（terkelg）：轻量、CLI 生态广泛（被 many CLIs 用），多选/列表/密码都有，风格素、无内建 spinner 质感。
- **enquirer**：15+ prompt 类型最全（autocomplete 老牌、scale、date），但已两年未维护，2026 不建议新项目引入。

### 8.2 各控件形态对到我们的需求

| 我们的步骤 | 推荐控件 | 备选 |
|---|---|---|
| 搜索选供应商（几十项） | clack `autocomplete`（输入过滤+列表+推荐置顶） | inquirer `search` |
| 自定义端点输入 | clack `text`（placeholder 给默认） | — |
| API key | clack `password`（掩码；可 `validate` 前缀） | inquirer `password` |
| 拉模型 loading | clack `spinner` + `log.warn/error` | — |
| 搜索 + 空格勾选模型 | clack `autocompleteMultiselect`（或 groupMultiselect 按类目分组） | inquirer checkbox + 搜索扩展 |
| 验证 key（Verify） | 向导内嵌一次真实 `/v1/models` 或 `/v1/chat/completions` 探活 + spinner + 成功/失败提示 | 参考 Cursor Verify 按钮 |
| 确认/提交/覆盖/设默认 | clack `confirm` + `outro` 汇总 | — |
| 重试循环 | clack 无内建 wizard，但 prompt 天然可放进 while 循环重试（cancel 返回 symbol 退出） | — |

### 8.3 现成「向导/wizard」模式与配套包

- @clack/prompts 无内置 wizard 组件，但官方推荐 `group()` 组合多个 prompt 成一步；**线性向导用普通 async 函数串 prompt + while 做重试**即可，不需要框架。
- 若要 TUI 常驻底部输入框 + 斜杠命令体系（像 Claude Code / opencode 那样的「/」面板），那要上 ink 或自绘（opencode 用 solidjs+ 自绘 TUI；Claude Code 闭源）。**我们第一阶段是「向导式 setup」，不需要斜杠 TUI**；斜杠式可在未来做交互会话时再引入。
- **unjs 生态**（已有 CLI 时可顺手用，非必需）：
  - `citty`（零依赖 CLI builder，defineCommand + 子命令 + usage 自动生成）——若要把 cah provider/models/setup 的 argument 解析与 help 规范化，citty 是低摩擦选择；它是 nuxi 等在用的。
  - `c12`（smart config loader：多来源合并 defu、config 目录、env、watch/HMR）——我们的 ProviderStore 是自写的小 SSOT，若未来要支持「用户文件 + 项目文件 + env 覆盖」分层读取，c12 可替代手写 load/merge。
  - `consola`（日志，内置 clack prompt 桥接 `await consola.prompt(...)`）——若想统一 stderr 日志与提示，可选。
- 结论选型：**主栈 @clack/prompts（autocomplete 系 + password + multiselect 系 + spinner）**；暂不上 ink/斜杠 TUI；citty/c12 视 CLI 骨架重构意愿再议（本仓库现有 cli 已工作，属可选项）。

来源：
- https://www.npmjs.com/package/@clack/prompts
- https://bomb.sh/docs/clack/packages/prompts/ （autocomplete/autocompleteMultiselect/groupMultiselect 行为与 options 函数式过滤）
- https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026
- https://github.com/unjs/citty 、https://unjs.io/packages/c12 、https://github.com/unjs/consola
- https://github.com/eslint/create-config/issues/229（enquirer 停维护讨论）

---

## 9. 跨项目「可落地交互模式」提炼

### 9.1 步骤顺序（被所有项目收敛到的公共骨架）

```
1 选供应商（预设/搜索）──可跳：已有 provider 时直接进 2
2 填 key（密码框）──────────可跳：auth.json/env 已有 key（幂等检查！opencode 教训 §4.5）
3 (自定义才要) 端点/协议
4 拉模型（spinner）─────────失败降级：手动填 id / 用缓存 / 内置目录（Pi §5.2）
5 选模型（搜索+勾选 or 单选默认；分组可选）
6 确认写入（显示将写哪、作用域）→ 原子写
7 切换生效（当前默认）＋ 生效时机提示（我们热读无重启问题）
```

### 9.2 控件-步骤映射与「每步一个问题」

- 供应商：搜索框 + 可滚动列表（clack autocomplete）。**热门/推荐置顶 + 分组**（opencode Popular/Other、Pi 订阅优先）。可选项给「自定义端点」兜底（所有项目都有 custom 出口）。
- key：密码框掩码；写完即验（Cursor Verify 绿勾）或留到「拉模型」时一起验（cc-switch 是拉模型时 401/403 才报）。**探活越早，用户越快得到反馈**，但要权衡请求成本——cc-switch 用「拉模型即验证」很顺，因为 /v1/models 一次请求同时完成验证+枚举。
- 拉模型：spinner + 明确失败分类（§6.2 四类）+ 降级路径。
- 勾模型：搜索+空格多选（clack autocompleteMultiselect）；长列表按类目分组（groupMultiselect / cc-switch 分组下拉）；每模型可带注释（上下文窗口/价格，Pi §5.2 元数据）。
- 提交：终屏汇总（provider/端点/key 尾号/选了 N 个模型/默认模型），confirm 确认，原子写。
- 错误与重试：向导内循环重试（cancel 符号 = 退出）；错误文案分「可重试（key/网络）」与「不可重试（协议不兼容→手动填）」两档。

### 9.3 模型清单怎么成为 SSOT（三层策略）

1. 预置目录（内置静态清单，随版本更新；anthropic 官方无枚举端点时兜底——现有代码已做，诚实标注「非实时」）
2. 实时拉取（openai-compatible `GET /v1/models`，拉完**缓存到 provider 配置**——cc-switch 存进 provider；Pi 存 models-store.json）
3. 用户声明/映射（cc-switch Model Mapping 表 = SSOT 生成 Codex model_catalog；opencode opencode.json models 映射）

拉取结果写回 provider 的 `models[]`（本仓库 ProviderConfig 已有该字段）+ 首次勾选即默认模型。**「清单来源 + 拉取时间 + 是否手动声明」要能被用户看到**（诚实标注，现有 fetchModelNames 已经分类）。

### 9.4 档位/默认模型（cc-switch + Claude Code 的启示）

Claude 侧用「主模型 + opus/sonnet/haiku(+/fable) 角色档位」的 env 结构；CC Switch 让每个 provider 记住自己那套映射。**我们是自研 harness（非 Claude Code），不欠 Claude env**：等价物是把 ProviderConfig 从 `model`（单值）扩展成「默认模型 + 可选按用途分档」或直接维护 `models[]` 排序 + 首项默认。是否引入真档位取决于 harness 是否真要「复杂任务用 X、子任务用 Y」——V0.4 TaskRouter 若有多模型路由需求，档位就有意义（该点对接 MISSION-V0.4，见 §11.4 差异）。若只需最简：**保持单 `model` 默认 + `models[]` 候选清单**即可，别为抄而抄。

### 9.5 切换与生效

- 切换 = 改 current.json（热生效，无重启问题——相对 cc-switch 要重启 Codex 是我们的优势，写进 UI 提示「已生效」）。
- provider 的默认模型随 provider 走（存在 provider 配置里，天然满足）。
- 前置已满足则跳步（opencode §4.5 bug 反面：key 已在 auth.json 就别再问）。

---

## 10. 推荐：`cah setup` 向导交互规格（分步伪代码）

> 目标：把现有 `runSetupWizard`（setup.ts）升级为「搜索化 + 分组 + 幂等跳步 + 拉模型失败降级 + 档位感知 + 终屏汇总」。控件全部落在 @clack/prompts（§8.2）。`SetupIO` 接口保持不变（测试友好），以下伪代码为 clack 默认实现的行为规格。

```
cah setup [--provider <id>] [--model <id>]   # 全交互为默认；flag 可预填/跳步（幂等）

step 0  开场
  clack.intro('cah setup — 配置供应商')
  if 已存在 default 之外的 provider && 无 --provider：
      问：添加新供应商 / 编辑现有 / 退出        # clack select
      → 编辑模式：列出现有 provider → 进对应步骤（key/模型可单独重填）

step 1  搜索选供应商                           # clack autocomplete（输入即过滤）
  options = 预设列表（推荐/官方置顶，按类目 hint，如 DeepSeek/OpenAI/Anthropic/本地…）
          + { value:'__custom__', label:'自定义端点（聚合/自托管）', hint:'手动输入 base-url 与协议' }
  hint 文案注明「怎么认证」（API key / 需登录）：抄 opencode 的 description 位
  选中预设 → 自动带出 protocol + baseUrl（预设填充，抄 cc-switch）
  选中 __custom__ → 追加问 protocol（openai-compatible/anthropic）与 base-url   # clack select + text

step 2  API key（密码框）                       # clack password（掩码）
  —— 幂等检查：env 或 ~/.dsh 该 provider 已有 key → 问「沿用已存 key？(y=跳过 / n=重输)」  # 抄 opencode §4.5 反例
  —— key 前缀 hint（sk-…/…）与获取地址提示（「去 platform.xxx 拿 key」）
  —— validate：空/过短 → 内联报错重输（clack validate 返回 string 即重问）

step 3  拉取模型（若协议支持实时枚举）          # clack spinner + log
  if openai-compatible：
      spinner.start('正在从 {baseUrl} 拉取模型…')
      调 GET {base}/v1/models（现有 fetchOpenAIModels）
      成功 → 候选 = 实时列表（可选：按前缀/类目分组展示）
      401/403 → log.error('key 无效或权限不足') → 回到 step 2 重输（最多 3 次，之后给手动出口）
      404/405 → log.warn('该端点未提供 /v1/models，可手动填模型 id 或继续用缓存') → 走降级
      解析失败/超时 → log.warn('拉取失败：{原因}') → 降级
  if anthropic：
      候选 = 内置 Claude 目录（诚实标注「内置清单，非实时」）   # 现有行为保留
  —— 拉取结果写回 provider.models（缓存清单，供后续 cah models / 勾选）

step 4  选模型（搜索 + 空格勾选）               # clack autocompleteMultiselect（或 groupMultiselect 按类目）
  message: '勾选要用的模型（搜索 / 空格切换 / 回车确认）'
  required: true（至少 1 个；空列表时先给手动填模型 id 的 text 出口）
  每项 label 带可选副信息（上下文窗口/价格）→ 现无，后续从 pricing.json 补
  勾选顺序 = 默认顺序 → 第一个默认模型（也可再问一次「哪个作默认」若勾了多个且想换）

step 5  确认写入（终屏汇总 + confirm）          # clack confirm + log.info 汇总
  汇总块：供应商名 / 协议 / base-url / key 尾号（sk-****abc）/ 已选 N 个模型 / 默认模型
  写入 ~/.dsh/providers.json（ProviderStore.add，原子写；同 id 覆盖先 confirmOverwrite）
  提示作用域：「写入用户级 ~/.dsh，影响本机所有 cah run」  # 抄 Claude /model 全局扩散的教训（明示作用域）

step 6  设默认（切换生效）                      # clack confirm
  问「把 {name} 设为默认供应商？cah run 立即使用」
  是 → store.setCurrent(id)；outro('已切换。cah run 现在走 {name}/{model}')
  —— 热生效（无重启），相对 cc-switch 需重启 Codex 是我们的卖点，UI 明说「已生效」
  clack.outro('完成 ✔')；返回 provider id

全程：任何一步收到 isCancel 符号 → 走 cancel() 优雅退出（不写任何文件）
全程可脚本化：SetupIO 注入假实现（现有 createClackIO 保留，测试无需真 TTY）
```

### 10.1 建议的补充子命令（对标斜杠/长驻体验的轻量版）

- `cah setup --list`：非交互列出当前 providers + 默认（等价现有 `cah provider list` 的引导入口说明）。
- `cah models --refresh`：重拉当前/指定 provider 模型并回写缓存（对标 opencode `opencode models --refresh`、Pi `pi update --models`）。
- 未来若做常驻交互会话（`cah` 无子命令时进入 REPL），再引入斜杠：`/provider`（同 step1-3）、`/model`（同 step4，picker 内 `Enter`=持久 / `s`=仅会话——抄 Claude §2）。本期不做，留接口位。

### 10.2 错误与重试一览（写进实现的话术）

| 情形 | 反馈 | 出路 |
|---|---|---|
| key 401/403 | 「API Key 无效或无权限（401）」 | 回 step2 重输；3 次后仍败 → 手动填/退出（不写盘） |
| 端点 404/405 | 「该端点没有 /v1/models；可手动填模型 id」 | step4 改手动 text 出口 |
| 拉取超时/解析失败 | 「拉取失败（原因），可稍后 cah models --refresh 再试」 | 用缓存 models[] 或手动填继续 |
| 覆盖已有 provider | 「{id} 已存在，覆盖？」 | confirm；否 → 返回不改 |
| anthropic 无实时枚举 | 「内置 Claude 目录（非实时），可后续用兼容端点拉取」 | 继续勾选内置清单 |

---

## 11. 与本仓库现状的差距清单（供实现时对照）

1. **搜索控件**：setup.ts 现在用 `clack.select` + `clack.multiselect`。升级为 `autocomplete`（供应商）+ `autocompleteMultiselect`（模型）以得到「输入即过滤 + 空格勾选」；确认目标 @clack/prompts 版本含这两个组件（v1 有，见 §8 来源）——旧版本没有则需升依赖。
2. **幂等跳步**：`askApiKey` 前先查 store/env 是否已有 key，有则 confirm 沿用（opencode bug 反例）。
3. **拉取失败降级出口**：现在失败只 warn + 允许空勾选保存；规格要求「>3 次失败或 404/405 → 明确转手动填模型 id 的 text 步」。
4. **终屏汇总**：现在写完直接问设默认，无汇总屏；加「key 尾号 / 模型数 / 作用域」确认。
5. **模型元数据展示**：可选——把 pricing.ts/内置目录的 contextWindow/cost 挂到勾选项 hint（Pi §5.2 模式）。
6. **档位（可选，依赖 TaskRouter 需求）**：ProviderConfig 现在是 `model` 单值 + `models[]`。若 V0.4 起需要「复杂/日常/快速」分档，参考 Claude 三档别名语义扩展字段（如 `roles?: {default/opus-equivalent/…}`），别在未需要时引入。
7. **备份**：ProviderStore 已原子写；cc-switch 的自动备份轮转可选（低优先，别过度工程）。
8. **重复拉取缓存**：把「上次拉取时间 + 来源(real/内置/手动)」存进 provider 配置，供 UI 诚实标注（现有 models[] 无时间戳）。

---

## 12. 参考来源汇总

- Claude Code model config / settings / env：https://code.claude.com/docs/en/model-config 、https://code.claude.com/docs/en/settings 、https://code.claude.com/docs/en/env-vars 、https://github.com/anthropics/claude-code/issues/50568
- Codex：https://developers.openai.com/codex/config-reference 、https://developers.openai.com/codex/config-advanced 、https://developers.openai.com/codex/cli/reference 、https://github.com/openai/codex/blob/rust-v0.63.0/docs/example-config.md
- opencode：https://opencode.ai/docs/providers/ 、https://opencode.ai/docs/models/ 、https://opencode.ai/docs/tui/ 、https://opencode.ai/docs/cli/ 、https://github.com/sst/opencode/blob/4695e685/packages/opencode/src/cli/cmd/tui/component/dialog-provider.tsx 、https://github.com/anomalyco/opencode/issues/31206
- Pi Agent：https://github.com/earendil-works/pi/blob/main/packages/coding-agent/README.md 、https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md 、https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md 、https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md 、https://pi.dev/docs/latest/providers
- cc-switch：https://ccswitch.co/docs/providers-add.html 、https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/zh/2-providers/2.1-add.md（及 2.3/2.6） 、https://github.com/huangbogeng/cc-switch-ui 、https://longcat.ai/platform/docs/cc-switch 、https://docs.agentsflare.com/guide/integration/cc-switch 、https://github.com/farion1231/cc-switch/issues/2362 、https://we0.ai/articles/claude-code-setup-guide-cc-switch
- Gemini CLI：https://google-gemini.github.io/gemini-cli/docs/get-started/authentication.html
- Cursor：https://cursor.com/help/models-and-usage/api-keys 、https://markaicode.com/cursor-custom-ai-models-claude-gemini-deepseek/
- Models.dev / AI SDK：https://models.dev
- 交互库：https://www.npmjs.com/package/@clack/prompts 、https://bomb.sh/docs/clack/packages/prompts/ 、https://www.pkgpulse.com/guides/ink-vs-clack-vs-enquirer-interactive-cli-nodejs-2026 、https://github.com/unjs/citty 、https://unjs.io/packages/c12 、https://github.com/unjs/consola 、https://github.com/eslint/create-config/issues/229

## 13. 待验证清单（实现前确认，勿当事实用）

- @clack/prompts 目标版本的 `select` 是否支持输入过滤；`autocompleteMultiselect` / `groupMultiselect` 的确切 API 与版本门槛（报告基于 npm/bombshell 文档，非实测）。
- opencode TUI 的 provider/auth 对话框源码为检索到的特定 commit（4695e685）实现，TUI 迭代快，最终以当时主线为准。
- cc-switch 的 UI 细节（分组下拉的确切呈现、Fetch Models 按钮样式）来自文档文字描述，无一手截图；档位 env 的 `_FABLE_MODEL` 及 `_NAME/_DESCRIPTION` 后缀出现在较新版本，版本边界待查。
- Pi 的 Ctrl+S 存默认、Ctrl+P 循环为 README 声称行为，未在真机上复现。
- Claude Code / Codex / opencode 的模型名与别名指向具体版本，属「当时文档」，随版本滚动，不作为固定值引用。
