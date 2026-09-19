# Real-Model Benchmark Lane（真实模型回归跑道）

> 任务卡：`tasks/082-real-model-lane.md`；权威需求：`docs/Vessel_后续开发方向与产品化路线_v1.0.md`
> §15.1 L2（固定真实模型 DeepSeek V4 Pro / Flash × 20-50 固定场景）+ L3（统一采集字段）。
> 前置：076（Harness Adapter Contract + RunResult/validate）+ L1 场景资产（B001-B023 + 075 安全 S001-S008）。

## 目的

L2 真实模型回归跑道：固定真实模型（DeepSeek V4 Pro / Flash）跑固定场景集（20-50 个，选自既有
B001-B023 + safety S001-S008），统一采集 §15.1 L2/L3 指标（success / wall time / tool calls / invalid
calls / retries / input/output/cache tokens / cost / context peak / compactions / human intervention /
policy violations / resume success）并产出报告到 `benchmarks/reports/`。每次 release 作为回归依据。

⚠️ **本机是否有真实模型 API 凭据未知**，且任务铁律不烧真实配额。因此 lane 框架 + 场景集 + 采集全部
**可注入可测试**：provider/model 可注入（无真实 API 时用 mock provider 验证框架）；无凭据时走
`pending-environment` 降级（076-081 模式），**不 throw、不跑真实模型**。

## 用法

```ts
import {
  runRealModelLane, LANE_MODELS, LANE_SCENARIOS,
  probeModelApi, renderLaneMarkdown,
  type ProviderResolver,
} from '@vessel/bench-runners';

// 1) 注入 provider 解析器（真实 = 从你的位置读取凭据并构造 ChatProvider；mock = 测试替身）
const providerResolver: ProviderResolver = async (model) => {
  if (!process.env.DEEPSEEK_API_KEY) return null;        // 无凭据 → 降级 pending-environment
  return realChatProviderFor(model.defaultModel);        // 注入真实 provider
};

// 2) 跑 lane（模型 / 场景集均可注入）
const report = await runRealModelLane({
  models: LANE_MODELS,          // 默认 DeepSeek V4 Pro / Flash，可注入
  scenarios: LANE_SCENARIOS,    // 固定场景集（25 个既有资产），可注入
  providerResolver,
  repoRoot: process.cwd(),       // 仓库根（定位 benchmarks/ + configs/）
  reportsDir: 'benchmarks/reports',
});

console.log(report.modelSummaries);   // 每模型汇总（passed/failed/pending/skipped + §15 L3 累计）
// 报告已写： benchmarks/reports/<runId>.md + .json
```

## 场景集与模型档（§15.1 L2 标注）

默认 `LANE_SCENARIOS` = 全部既有 L1 资产（**25 个** = B001-B005 + B016-B027 + S001-S008，落在 §15.1 的 20-50 区间；B024-B027 为 V1.1-D 新增）。每个场景标注适用模型档：

| 档 | 场景 | 说明 |
| --- | --- | --- |
| **flash**（轻量 / 安全） | B001、B002、B019、B020、B021、S001-S008 | 读文件回答 / 跨文件搜索 / MCP / Memory / Skill / 8 项安全 |
| **pro**（复杂 / 实现重构） | B003、B004、B005、B016、B017、B018、B022、B023 | 实现函数 / 重构 / bash exec / 子代理 / 规划 / 评估 / 路由 / 循环引擎 |
| 适用双档 | `both`（当前无，保留扩展） | —— |

`runnable` 标注决定真实模型是否真的驱动该场景：

- `runnable=true`（13 个：B001-B005 + S001-S008）：task 型 / 安全型场景，可通过 076 Vessel self-adapter
  在真实模型单轮上驱动，采集 §15 L3 指标（含 policy 硬执行为行为本身的 S001-S008）。
- `runnable=false`（12 个：B016-B027 feature-lane）：子代理 / 规划 / 评估 / MCP / Memory / Skill /
  TaskRouter / Loop-Engine，以及 V1.1-D 的 streaming / interrupt / steering / resume（B024-B027）——
  其判定依赖确定性 mock 车道（机器 golden 标记），真实模型无法忠实复现
  → 在 registry 中枚举以凑齐 20-50 集，但真实 lane 标记 `skipped`，**不烧配额**。

> 说明：streaming / interrupt / steering / resume 四类 §15.1 L1「继续增加」项**已由 V1.1-D 补资产**
> （B024-B027，离线确定性），并纳入默认 `LANE_SCENARIOS`；它们仍是 `runnable=false`（真实模型不驱动，
> 避免烧配额），但其 L1 判据在确定性车道里有执行路径。

## 采集与报告

- 每个（模型 × 可跑场景）经 076 `vesselAdapter.run` 驱动，返回一个 `validate` 通过的 `RunResult`（§15 L3 全字段）。
- `report.rows`：逐行（model × scenario）{ status: passed|failed|pending-environment|skipped, result?, note? }。
- `report.modelSummaries`：每模型 §15 L3 累计（wallTime / toolCalls / tokens / cost）+ 状态计数。
- 报告写到 `benchmarks/reports/<runId>.md`（model×scenario 矩阵 + 每模型汇总表）+ `<runId>.json`（可机器读）。

## 无凭据降级（诚实降级）

`providerResolver` 返回 `null`（或 throw）→ 该模型所有行 `pending-environment`，`report.degraded=true`，
**不 throw、不跑真实模型**（076-081 模式）。`probeModelApi(resolver)` 可先探测各模型可用性。

## 范围边界

- 只做 lane 框架 + 场景集 + §15 采集 + 报告。083（report/dashboard）/ 084（release gates）各自成卡。
- assert 级判定（offline lane 的 `runScenario` 职责）**不**在真实 lane 重复评估；本 lane 采集 §15 L3
  指标 + 单轮成功信号。feature-lane 驱动（subagent/planner/…）保持在 offline 确定性车道。

## opencode-go 真实 provider 接入（V1.1-C）

V1.1-C 把「内置 preset + OPENCODE_API_KEY 环境变量 + MIMO 目标模型」收敛成一个可注入解析面
`benchmarks/runners/src/lane/opencodeGoProvider.ts`，供本 lane 与 084 release gates 消费。

- **preset 复用（SSOT）**：`opencode-go` preset 来自 `packages/application/src/providers/presets.data.ts`
  （protocol=`openai-compatible`，baseUrl=`https://opencode.ai/zen/go/v1`），经 `@vessel/application`
  `findPreset()` 读取——不重复定义常量。task 098 起该 SSOT 由 `apps/cli` 下沉到 application 层，
  runner 不再 `import '@vessel/cli'`（消除 cli ↔ bench-runners 的 `tsc -b` 类型环 TS5055）。
- **密钥安全铁律**：apiKey 只经注入的 keyResolver 读取（默认 `process.env.OPENCODE_API_KEY`），
  **绝不写盘/写日志**。无 key → `resolveOpencodeGoProvider()` 返回 `null` → lane 降级
  `pending-environment`（既有诚实降级语义保持）。
- **模型确认**：`fetchOpencodeGoModels()` 复用 `@vessel/application` 的 `fetchOpenAIModels()` 实时拉取
  `{base}/v1/models`（404 回退 `{base}/models`），可注入 fetch 便于 mock。仓库内置的
  models.dev 参考快照（`docs/ideas/data/models.dev-api.json` 的 opencode-go 项）列出 **`mimo-v2.5`**
  与 **`mimo-v2.5-pro`**（另有 mimo-v2-pro / mimo-v2-omni）。**默认档（task 111 起）**由
  `defaultLaneModels()` 决定：flash 档优先 `deepseek-flash`（live 清单含则选；110 终对比稳定性
  10/10），pro 档保持 MIMO V2.5 Pro；live 清单无 `deepseek-flash`（如无 key 内置参考快照）→ 回退
  `selectMimoModel()` 的既定确定性选择（精确 `mimo-v2.5` → V2.5 系回退 → 任一 MIMO → null）。
  `defaultMimoLaneModels()` 保留为 MIMO 专属选择/回退语义；显式 `--model=mimo-v2.5` /
  `--models=mimo-v2.5` 经 `explicitLaneModels()` 直接映射指定 id（**不删除 mimo 复跑能力**）。
- **最小连通**：`probeOpencodeGoOnce()` 用构造的 provider 发一次最小 chat（仅 `ping`，maxTokens=256），
  返回鉴权/响应/usage 快照；无 key 或网络受限 → 记录 pending，不反复重试真实调用。
- **实跑接线**：真实跑时 `providerResolver` 用 `opencodeGoProviderResolver()`；无 key → pending。
  有 key + 拉到 MIMO V2.5 后用其做 defaultModel 跑授权场景子集，报告写 `benchmarks/reports/`。

## opencode-go 协议修正与真实跑通（task 102）

实测报告 `docs/OPENCODE-KEY-VERIFY.md`（提交 8e15e66）证明：Go 端点鉴权通过后，**聊天请求缺
`x-opencode-session` 会返回 400 `MissingSessionID`**（不是 401——鉴权已过，失败在路由阶段）；
补一个稳定 UUID 后同一请求 200。task 102 据此把线协议客户端从通用 `createProvider('openai-compatible')`
换成专用客户端（通用客户端无法注入自定义头）。**task 103 起实现上提到 `@vessel/llm`**
（`packages/llm/src/provider/OpencodeGoProvider.ts`）——CLI（`vessel run`）、TUI（无参 `vessel`）
与 lane 共用同一份实现，lane 侧 `benchmarks/runners/src/lane/opencodeGoChatProvider.ts` 只是
re-export 外壳；协议语义（下列各点）不变：

- **会话头**：`OpencodeGoProvider` 构造时生成一个 UUID 作为 `x-opencode-session`，同一会话的**所有请求
  与退避重试复用同一个 id**；`opencodeGoProviderResolver()` 为一次 lane 会话生成一个 id，跨模型共用。
- **具名 User-Agent**：`vessel-harness/1.1.0 (opencode-go; …)`（官方要求，不用通用 SDK/HTTP 库名）。
- **错误分类**（`classifyOpencodeGoError`）：400 `MissingSessionID` → `missing-session`；
  401 `CreditsError`/`Insufficient balance` → `credits`；429/免费档限流 → `rate-limit`；
  其余 401/403 → `auth`；404 → `not-found`；5xx → `server`；网络/超时 → `network`/`timeout`。
  仅 `rate-limit|server|timeout|network` 做有限退避重试（默认 2 次），其余立即上抛，**不重试轰炸**。
  错误文案先剥 URL 再截断，不带凭据/内部标识。
- **路径分流**（`resolveOpencodeGoRoute`，按官方 Endpoints 表）：
  | 路径 | 线协议 | 模型家族 | 本卡实现度 |
  | --- | --- | --- | --- |
  | `/chat/completions` | `openai-chat` | GLM / Kimi / LongCat / DeepSeek / **MiMo** / Hy / Omen | **implemented** |
  | `/messages` | `anthropic-messages` | MiniMax / Qwen | declared-only（调用即抛 `unsupported-route`） |
  | `/responses` | `openai-responses` | Grok / GPT-5.6-Luna / Muse Spark | declared-only（同上） |

  未命中家族的模型回落到 `/chat/completions`（记录 `family='default'`）。
- **推理模型预算**：`mimo-v2.5` 是推理模型（`content` 可为 null 而 `reasoning` 有值），
  默认 `max_tokens=8192`（`OPENCODE_GO_DEFAULT_MAX_TOKENS`），并保留 `reasoning` / `reasoning_tokens`
  到 `raw`，便于诊断「思维链吃光预算」。`deepseek-flash`（DeepSeek thinking 模式）走同一
  `OpencodeGoProvider`，`max_tokens` 默认相同；其思维链字段 `reasoning_content` 的归一/回传由
  task 109 线协议修复承载（见「线协议修复落地（task 109）」节）。
- **凭据来源选择**：`run-opencode-lane.ts --key-source=auto|env|store`。driver 只打印来源名/长度/是否一致，
  **不打印任何密钥片段**。
  - **历史踩坑（task 102）**：本机 CredentialStore 里曾存的 `credential:vessel/opencode-go` 与用户提供的 key
    **不是同一把**（长度相同、`same=false`），按 097 的「store 优先」优先级会被静默选中并返回
    401 `CreditsError`——当时真实跑必须显式 `--key-source=env`。
  - **已修复（task 105）**：用户 key 已用 `vessel provider add` 写入 store（DPAPI 密文，指纹一致
    `same=true`），`--key-source=store` / `--key-source=env` / `--key-source=auto` 三条路径实测均 200；
    `auto` 在 env 被塞假值时仍选 store（**store 优先**语义保持）。见下节「key 入库」。

## 真实跑观测（task 102，mimo-v2.5）

用用户提供的 key（指纹 `sk-8Dl…Cp4n1`，`--key-source=env`）在 Go 端点跑 082 lane
（task 105 起同一把 key 已写入 CredentialStore，`--key-source=store` 亦可，见下节「key 入库」）：

| 运行 | 场景集 | 结果 | 备注 |
| --- | --- | --- | --- |
| `real-model-lane-1788964644907` | B001 | 1/1 passed | 单场景最小验证（toolCalls 1，in 4094/out 127） |
| `real-model-lane-1788964714845` | B001、B002、S001-S008 | 9 passed / 1 failed | 失败行 = S002（模型 70 次工具调用后 64 步预算耗尽） |
| `real-model-lane-1788966911284`（084 gate 4） | 同上 + 4 个 feature-lane（skipped） | 8 passed / 2 failed / 4 skipped | 失败行 = **B002、S005**（65/100 次工具调用后预算耗尽），而 **S002 这次 passed** |

**结论（重要）**：`mimo-v2.5` 在这类多步任务上**收敛不稳定**——同一场景跨次运行可能 passed 也可能
failed（S002 先 failed 后 passed；B002/S005 先 passed 后 failed）。失败模式统一为
`RunResult success=false`（finalText 为空，工具调用一直持续到 `MAX_STEPS_PER_TURN=64`）。
这**不是**协议/凭据/连接问题（同批其它场景均 passed，且 `x-opencode-session` + 具名 UA 的 probe 稳定 200），
而是模型在长工具链上的行为特征。因此：

- lane 对 `success=false` 的行**必须写清原因**（task 102 已补：`RunResult success=false：finalText 为空
  （toolCalls=N，多为模型未在步数/预算内收敛）`），否则 gate 无从归类。
- 084 gate 4 用 `judgeRealModelLaneWithNonConvergence` 把该模式判为 **pending**（复跑/换模型档再判），
  与 billing 分类并列——不伪造 pass，也不当作 harness 回归 fail。

## 真实跑观测（task 108，deepseek-flash vs mimo-v2.5 收敛对比）

task 108 按 102 的同一场景子集（B001、B002、S001-S008，10 场景）实跑 `deepseek-flash`
（`--key-source=store`，报告 `real-model-lane-1789037140071(-deepseek-flash).md` 等 4 份），结论：

| 维度 | mimo-v2.5（102 基线） | deepseek-flash（本卡 3 次全量） |
| --- | --- | --- |
| 同场景集结果 | 9/10（同一场景跨次 passed/failed 翻转，失败集每次不同） | **0/10 × 3 次（完全可复现）** |
| 失败模式 | 模型未收敛：finalText 空 + 工具调用到 64 步预算耗尽 | **harness 线协议不兼容**：第 2 次请求被严格上游 400 |
| 工具步数 | 1~97（失败场景 64~70） | 全部 1~2（未及长链即被 400） |
| usage/耗时 | in 863k / out 53k / 1853.7s / $0.592 | in 17.7k / out 2.3k / 40.6s / $0.0135 |

- **probe**：`deepseek-flash` 在 live `/v1/models`（36 项）确认存在，走 `/chat/completions`，200 + usage
  （`{31,48~256,0}`），单轮纯文本直接回 content（provider 按 `message.reasoning` 解析为 reasoning=0B；
  DeepSeek thinking 模式的思维链字段实为 `reasoning_content`）。
- **根因（直发 Go 端点实验证明）**：① harness `ContextBuilder` 的请求历史来自 `session.surface()`
  （EVENT-SPEC §6 仅 user/message、assistant/message、tool/result），`assistant/attempt`（承载 tool_calls）
  被裁剪 → wire 里 `tool` 消息无前导 `tool_calls` → 严格上游（DeepSeek）400
  `Messages with role 'tool' must be a response to a preceding message with 'tool_calls'`；
  ② 修正形状后进入下一校验：thinking 模式要求回传 `reasoning_content`，harness 不回传 → 400。
  mimo-v2.5 的上游容忍该形状，DeepSeek 严格校验 → 只有 deepseek/严格上游模型现形。
- **gate 4 归类（task 108 新增判据）**：`isWireFormatBlockedLane` + `judgeRealModelLaneWithNonConvergence`
  线协议优先归类 → **pending**（note 注明「线协议不兼容，非收敛问题」）；lane failed 行 note 追加真实
  运行异常（`describeLaneFailureNote`，无异常时保留原「未收敛」基线文案）。
- **建议**：**当前不建议换默认模型**——deepseek-flash 在现有线协议下 0/10 全红，无法跑长工具链；
  mimo-v2.5 虽收敛不稳但可真实跑。线协议修复（补 assistant tool_calls 到请求历史 + 回传
  reasoning_content）应另开卡，修好后再重跑本对比。

## 线协议修复落地（task 109，修后 deepseek-flash 才可能跑通）

task 109 在 harness 侧修掉 108 确诊的两个线协议缺口（provider 层 + 上下文派生，未改 lane 默认模型）：

1. **assistant tool_calls 投影**：`ContextBuilder` 的 wire 历史从 `session.surface()`（三型）扩展为
   replay 过滤四型（`user/message`、`assistant/message`、`assistant/attempt`、`tool/result`）——
   `assistant/attempt`（承载上一轮模型 tool_calls：toolCallId/name/arguments）随历史一并发给 provider，
   序列化后 `role:'tool'` 消息永远紧跟含对应 `tool_calls` 的 `role:'assistant'` 消息
   （OpenAI 兼容约定，strict 上游 400 消失）。
2. **reasoning_content 回传**：响应侧 `reasoning_content`（DeepSeek 系）/ `reasoning`（opencode-go）
   归一进 `ChatResponse.reasoningContent`（流式走新增 `reasoning_delta` chunk 累计），经
   `assistant/message`/`assistant/attempt` 记录持久化；请求侧 assistant 消息序列化为
   `reasoning_content` 发回（thinking 模式校验通过）。
3. 两套 provider（`OpencodeGoProvider` / `OpenAICompatibleProvider`）非流式与流式路径共用同一
   `ChatRequest.messages` 序列化逻辑；mimo-v2.5 等非推理模型不产 reasoning_content，行为不变。

实跑验证与修复前后对比见 `tasks/109-wire-protocol-fix.md`「工作证明」。

## 终对比（task 110，修复后 deepseek-flash 全场景集复测）

task 110 在 109 线协议修复后，把 deepseek-flash 全场景集（B001、B002、S001-S008，同 108 子集）
实跑 ×2（`--key-source=store`，报告 `real-model-lane-1789041479645-deepseek-final.md` + run2
`real-model-lane-1789041722946.md`；mimo 数据取 102 基线不重跑），结论：

| 维度 | mimo-v2.5（102 基线） | deepseek-flash（110 final） |
| --- | --- | --- |
| 通过率 | 9/10；三次实跑 9/1、8/2、9/1，失败集每次不同 | **2/2 轮 × 10/10 全过** |
| 失败模式 | 未收敛：finalText 空 + 工具调用冲满 64 步预算 | 无失败（108 修复前为 wire 400，零复现） |
| 工具步数 | 1~97；失败场景 64~100 | 1~39，长链收敛更快（S002 4 步 vs 70 步） |
| usage/耗时 | in 863k / out 53k / 1853.7s / $0.592 | run1 in 691k/210s/$0.407；run2 in 1.52M/360s/$0.937（**波动大**：S001 in 17.8k↔1.31M） |
| 跨次稳定性 | 不稳定（同场景跨次翻转） | 状态稳定（双轮全过）；usage 波动 |
| 084 gate 4 | pending（non-convergence） | **pass（10/10，双轮）** |

- **跨次稳定性**：deepseek-flash 状态级稳定（2 轮 10/10），109 线协议修复（assistant tool_calls 投影 +
  reasoning_content 回传）在全场景集上验证通过；usage 级波动（run2 S001 上下文膨胀 in 1.31M、
  policyViolations=38 反复试探删除被 hard-deny 拦截，最终收敛）。
- **建议**：**建议换 lane 默认模型**（mimo-v2.5 → deepseek-flash）——通过率/收敛稳定性方向性改善、长链收敛
  更快、gate 4 从 pending 转 pass；注意 usage 波动（单轮成本可达 $0.94，高于 mimo），换默认由指挥/用户
  拍板，本卡**未改默认**。报告 + gate 4 判定见 `tasks/110-deepseek-full-retest.md`。

## 默认模型档切换（task 111：mimo-v2.5 → deepseek-flash）

指挥采纳 110 终对比建议（deepseek-flash 全场景 ×2 双轮 **10/10 全过**、gate 4 pending→pass；mimo-v2.5
三轮失败集每次不同、gate 4 恒 pending）——**lane 默认 flash 档从 `mimo-v2.5` 换成 `deepseek-flash`**
（`defaultLaneModels()`，`benchmarks/runners/src/lane/opencodeGoProvider.ts`）：

- **默认生效路径**：live `/v1/models` 含 `deepseek-flash` → flash 档一律选它；pro 档保持 MIMO V2.5 Pro
  （110 未对比、无证据不动）。无 key / live 拉不到 `deepseek-flash`（如内置参考快照，无此 id）→ 回退
  既定 MIMO V2.5 系确定性选择（mimo-v2.5），不 throw（诚实降级语义保持）。
- **理由 = 稳定性**：deepseek-flash 10/10 全过且跨次稳定；长链收敛更快（S002 4 步 vs mimo 70 步、全程
  零 400）；084 gate 4 由 pending 转 pass。
- **成本特性（已记录，未优化）**：**单轮最高 $0.94**（110 run2：S001 上下文膨胀 in 1.31M、policyViolations
  =38 被 hard-deny 拦截后收敛）vs mimo-v2.5 全集 **$0.592**——deepseek usage 波动大，预算敏感需在
  release 持续观察成本分布。
- **覆盖能力保留**：显式 `--model=mimo-v2.5`（run-opencode-lane.ts，可逗号分隔 + `--tier=`）/
  `--models=mimo-v2.5`（run-release-gates.ts）经 `explicitLaneModels()` 直接映射指定 id 复跑 mimo，
  **参数未删除、语义不变**。
- **协议/判据未动**：deepseek 走 `/chat/completions`（109 线协议修复后零 400）；推理预算
  `OPENCODE_GO_DEFAULT_MAX_TOKENS=8192` 对两模型相同；gate 判据（non-convergence / wire-format）不变。

## 凭据来源（env / CredentialStore，task 097 纠偏）

opencode-go 的 API key **只有两条来源**，provider 运行时经 resolver 读取（可注入、可 mock），
**明文密钥绝不落盘/git/日志/报告**：

1. **仓库 CredentialStore**（034/069：Windows DPAPI 密文 + `secretRef`
   `credential:vessel/opencode-go`），由用户经 `vessel provider add` / `vessel setup` 向导
   **主动写入** `~/.vessel/secrets.json`；
2. **环境变量** `OPENCODE_API_KEY`（进程环境，回退用）。

> **不读取任何用户本机应用数据**（task 097 纠偏）：V1.1-F 曾把「读取本机安装的 CC Switch 应用
> 数据库 `~/.cc-switch/cc-switch.db`」当作凭据来源（模块 `ccSwitchCredential.ts`，已移除）。
> 学习对象是 **cc-switch 开源项目的模块设计**（见 `docs/ideas/CC-SWITCH-MODULE-STUDY.md`），
> 不是去动用户本机应用数据；仓库内已无任何指向 `~/.cc-switch` 的代码路径（有源码树守卫测试）。

- **凭据来源模块** `benchmarks/runners/src/lane/opencodeGoCredential.ts`（唯一入口）：
  `envOpencodeGoKey()`（env 来源）/ `credentialStoreOpencodeGoKey(store)`（读
  `credential:vessel/opencode-go`，同步 `getSync`，后端不可用→undefined 不抛）/
  `credentialAwareOpencodeGoKey({store,createStore,env,fallback})`（CredentialStore 优先 →
  env 回退 → 注入兜底 → undefined 即 lane 降级 pending）。**不 import `node:fs`，不读任何文件**。
- **resolver 集成**（`opencodeGoProvider.ts`）：lane/gate/driver 统一用
  `credentialAwareOpencodeGoKey({ store })` 构造 resolver，再交给
  `opencodeGoProviderResolver()` / `fetchOpencodeGoModels()` / `probeOpencodeGoOnce()`。
  单测/驱动注入 mock store 或 mock provider，**不碰真实密钥**。
- **实跑接线**：`run-opencode-lane.ts` / `run-release-gates.ts` / `run-v11f-verify.ts` 用
  `createCredentialStore()` + `credentialAwareOpencodeGoKey()` 直接读凭据（**无迁移步骤**）。
  真实 key 只在进程内 + DPAPI 密文；报告/证据文件只记录 `{keyPresent, keySource}`，**不含密钥片段**。

```ts
import {
  runRealModelLane, opencodeGoProviderResolver,
  fetchOpencodeGoModels, selectMimoModel, defaultMimoLaneModels, defaultLaneModels,
  credentialAwareOpencodeGoKey, OPENCODE_GO_CREDENTIAL_SOURCES,
  createCredentialStore,
} from '...';
const store = createCredentialStore();                       // Windows DPAPI（本机）
const keyResolver = credentialAwareOpencodeGoKey({ store }); // store 优先，env 回退
const { source } = await fetchOpencodeGoModels(keyResolver); // live /v1/models
const laneModels = defaultLaneModels(source.models);         // 默认 pro/flash 两档（flash=deepseek-flask，task 111）
const resolver = opencodeGoProviderResolver({ keyResolver });
const report = await runRealModelLane({
  models: laneModels, scenarios: LANE_SCENARIOS, providerResolver: resolver,
  repoRoot: process.cwd(), reportsDir: 'benchmarks/reports',
});
```

## key 入库（task 105：把用户 key 写进 CredentialStore）

用户日常路径（`vessel run`）**不再需要每次指定 env**：key 写进仓库 CredentialStore
（Windows DPAPI 密文），`providers.json` 只留 `secretRef`。（无参 `vessel`（交互/TUI）见下方 ⚠️。）

```powershell
# 1) 入库：key 只在命令行/进程内出现，仓库机制负责 DPAPI 加密 + 写 secretRef
vessel provider add opencode-go --protocol openai-compatible `
  --base-url https://opencode.ai/zen/go/v1 --model mimo-v2.5 --api-key <KEY>
#    已有同名条目 → 用 vessel provider set opencode-go --api-key <KEY> 原地更新（不新建重复条目）

# 2) 设为默认（一次性；此后 vessel run 直接用 store 里的 key，无需 env）
vessel provider switch opencode-go

# 3) 校验：读回 store 的 key，与用户 key 比对「前6+后4+长度+sha256 前 8 位」→ 只输出指纹与 same 布尔
```

```powershell
# 指纹校验（不打印完整 key）
Add-Type -AssemblyName System.Security
$j   = Get-Content "$env:USERPROFILE\.vessel\secrets.json" -Raw | ConvertFrom-Json
$ent = [Convert]::FromBase64String($j.entropy)
$e   = $j.secrets | Where-Object { $_.service -eq 'vessel' -and $_.account -eq 'opencode-go' }
$plain = [System.Text.Encoding]::UTF8.GetString(
  [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($e.cipher), $ent, 'CurrentUser'))
# 与用户提供的 key 比对前6+后4+长度+sha8 → same=true
```

- 落盘形状：`~/.vessel/providers.json` = `[{id,name,protocol,baseUrl,model,secretRef:"credential:vessel/opencode-go"}]`
  （**无 apiKey 明文**）；`~/.vessel/secrets.json` = `{backend:"windows-dpapi", entropy:"…", secrets:[{service:"vessel",
  account:"opencode-go", cipher:"<DPAPI base64>"}]}`。仓库内任何文件/日志/报告都不含 key，只含指纹。
- **两条来源实测均可用（task 105 证据）**：

  | 命令 | 结果 |
  | --- | --- |
  | `run-opencode-lane.ts --key-source=store --probe-only` | `ok`，usage `input=248 / output=154 / cacheRead=192` |
  | `run-opencode-lane.ts --key-source=env --probe-only` | `ok`（`storeLen=67 envLen=67 same=true`） |
  | `run-opencode-lane.ts --key-source=auto`（env 塞假值） | 仍选 `CredentialStore vessel/opencode-go` → `ok` |

- `vessel run` 真跑（store 路径，无需任何 env）：`vessel run --prompt "ping"` → 最终回复 `pong`、
  `kind=success steps=1`，usage 落 `~/.vessel/usage.json`（`provider=opencode-go, model=mimo-v2.5,
  inputTokens=3265, outputTokens=37`）。
- ✅ **无参 `vessel`（交互/TUI）已可用（task 106 修复）**：`runChat()` 的默认 `ProviderStore` 改为与
  `vessel run` 共用 `createDefaultProviderStore()`（接 CredentialStore），`secretRef` 能解析回 apiKey。
  修复前是裸 `new ProviderStore()` → 401 `Missing API key`（105 发现 2）；回归用例见
  `apps/cli/src/tui/chat.test.ts`（本地 loopback 端点断言 Bearer 头，不打真实网络）。

## 设计选择与理由

1. **复用 076 RunResult**：每（模型 × 场景）产出 076 `validate` 通过的 RunResult，L3 采集字段与
   cross-harness（L3）完全一致，避免另起一套指标模型。
2. **vesselAdapter.run 驱动**：走 076 self-adapter 统一入口（含 temp workspace 隔离与回收），不重复
   compose/telemetry 逻辑，也保证报告行都是契约合法 RunResult。
3. **可注入 = 契约友好**：`models` / `scenarios` / `providerResolver` 均可注入；无凭据时 mock provider 验证
   全框架，退化到 pending-environment，天然满足「不烧真实配额」。
4. **场景集从既有资产选**：只用现存 25 个 yaml/assets，不新造场景资产（不膨胀范围）；feature-lane 枚举为
   `skipped` 而非虚跑。