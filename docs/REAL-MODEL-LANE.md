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
  scenarios: LANE_SCENARIOS,    // 固定场景集（21 个既有资产），可注入
  providerResolver,
  repoRoot: process.cwd(),       // 仓库根（定位 benchmarks/ + configs/）
  reportsDir: 'benchmarks/reports',
});

console.log(report.modelSummaries);   // 每模型汇总（passed/failed/pending/skipped + §15 L3 累计）
// 报告已写： benchmarks/reports/<runId>.md + .json
```

## 场景集与模型档（§15.1 L2 标注）

默认 `LANE_SCENARIOS` = 全部既有 L1 资产（**21 个**，落在 §15.1 的 20-50 区间）。每个场景标注适用模型档：

| 档 | 场景 | 说明 |
| --- | --- | --- |
| **flash**（轻量 / 安全） | B001、B002、B019、B020、B021、S001-S008 | 读文件回答 / 跨文件搜索 / MCP / Memory / Skill / 8 项安全 |
| **pro**（复杂 / 实现重构） | B003、B004、B005、B016、B017、B018、B022、B023 | 实现函数 / 重构 / bash exec / 子代理 / 规划 / 评估 / 路由 / 循环引擎 |
| 适用双档 | `both`（当前无，保留扩展） | —— |

`runnable` 标注决定真实模型是否真的驱动该场景：

- `runnable=true`（13 个：B001-B005 + S001-S008）：task 型 / 安全型场景，可通过 076 Vessel self-adapter
  在真实模型单轮上驱动，采集 §15 L3 指标（含 policy 硬执行为行为本身的 S001-S008）。
- `runnable=false`（8 个：B016-B023 feature-lane）：子代理 / 规划 / 评估 / MCP / Memory / Skill /
  TaskRouter / Loop-Engine 驱动是**确定性 mock** 车道（判定依赖机器 golden 标记），真实模型无法忠实复现
  → 在 registry 中枚举以凑齐 20-50 集，但真实 lane 标记 `skipped`，**不烧配额**。

> 说明：streaming / interrupt / steering / resume 等 §15.1 L1「继续增加」项尚无既有资产（assets 中无对应
> yaml/fixture），故不出现在本默认集；本卡范围「从既有 assets 选」，待 083/084 或后续卡补资产后再纳入。

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

- **preset 复用（SSOT）**：`opencode-go` preset 来自 `apps/cli/src/providers/presets.data.ts`
  （protocol=`openai-compatible`，baseUrl=`https://opencode.ai/zen/go/v1`），经 `@vessel/cli`
  `findPreset()` 读取——不重复定义常量。
- **密钥安全铁律**：apiKey 只经注入的 keyResolver 读取（默认 `process.env.OPENCODE_API_KEY`），
  **绝不写盘/写日志**。无 key → `resolveOpencodeGoProvider()` 返回 `null` → lane 降级
  `pending-environment`（既有诚实降级语义保持）。
- **模型确认**：`fetchOpencodeGoModels()` 复用 `@vessel/cli` 的 `fetchOpenAIModels()` 实时拉取
  `{base}/v1/models`（404 回退 `{base}/models`），可注入 fetch 便于 mock。仓库内置的
  models.dev 参考快照（`docs/ideas/data/models.dev-api.json` 的 opencode-go 项）列出 **`mimo-v2.5`**
  与 **`mimo-v2.5-pro`**（另有 mimo-v2-pro / mimo-v2-omni）。`selectMimoModel()` 在 live 清单里做
  确定性选择（精确 `mimo-v2.5` → V2.5 系回退 → 任一 MIMO → null）；`defaultMimoLaneModels()` 映射为
  pro/flash 两档 LaneModel。
- **最小连通**：`probeOpencodeGoOnce()` 用构造的 provider 发一次最小 chat（仅 `ping`，maxTokens=4），
  返回鉴权/响应/usage 快照；无 key 或网络受限 → 记录 pending，不反复重试真实调用。
- **实跑接线**：真实跑时 `providerResolver` 用 `opencodeGoProviderResolver()`；无 key → pending。
  有 key + 拉到 MIMO V2.5 后用其做 defaultModel 跑授权场景子集，报告写 `benchmarks/reports/`。

## CC Switch 凭据转接（V1.1-F）

V1.1-F 把 opencode-go 的 API key 从 **CC Switch 配置**转接到仓库 CredentialStore（034/069，
Windows DPAPI 加密落库），provider 运行时经 resolver **从 CredentialStore 读取**（env 回退 +
可注入 mock），**明文密钥绝不落盘/git/日志/报告**。

- **CC Switch 配置探查**（实测 2026-09）：配置主体是 **SQLite 库** `~/.cc-switch/cc-switch.db`，
  表 `providers`，`app_type='opencode'` 的“OpenCode Go”条目，其 `settings_config`（AI SDK
  openai-compatible 形状）含 `options.baseURL=https://opencode.ai/zen/go/v1` 与
  `options.apiKey`。apiKey 采用 opencode 的 **`{file:<path>}` 文件引用**语法（引用了
  `~/.config/opencode/secrets/{hs,zl}-api-key` 两个 key 文件），而非内联明文。
- **凭据转接模块** `benchmarks/runners/src/lane/ccSwitchCredential.ts`：
  `probeCcSwitchOpencode()`（只读根 SQLite）/ `resolveApiKeyField()`（解析 `{file}` / `{env}` /
  内联明文）/ `migrateOpencodeGoCredential()`（把 key 经注入 CredentialStore.set 加密落库，
  返回值**不含 key**）。全程只读 DB、进程内读 key 文件，任何写盘都走 CredentialStore（DPAPI 密文）。
- **resolver 集成**（opencodeGoProvider.ts）：`credentialStoreOpencodeGoKey()`（读
  `credential:vessel/opencode-go`，同步 getSync）与 `credentialAwareOpencodeGoKey()`（CredentialStore
  优先 → env `OPENCODE_API_KEY` 回退 → undefined→pending）。单测/驱动注入 mock store，不碰真实密钥。
- **实跑接线**：`run-opencode-lane.ts` / `run-release-gates.ts` / `run-v11f-verify.ts` 开头先
  `migrateOpencodeGoCredential()`（CC Switch→CredentialStore），再用 `credentialAwareOpencodeGoKey`
  构造 resolver 跑 lane/gate/probe。真实 key 只在进程内 + DPAPI 密文；报告/证据文件记录
  `{synced,baseUrl,rowId,keyPresent}`，**不含密钥片段**。

```ts
import {
  runRealModelLane, opencodeGoProviderResolver,
  fetchOpencodeGoModels, selectMimoModel, defaultMimoLaneModels,
  migrateOpencodeGoCredential, credentialAwareOpencodeGoKey,
  createCredentialStore,
} from '...';
const store = createCredentialStore();               // Windows DPAPI（本机）
const migrated = await migrateOpencodeGoCredential({ store }); // CC Switch → store
const keyResolver = credentialAwareOpencodeGoKey({ store });   // store 优先，env 回退
const { source } = await fetchOpencodeGoModels(keyResolver);   // live /v1/models
const laneModels = defaultMimoLaneModels(source.models);       // pro/flash 两档
const resolver = opencodeGoProviderResolver({ keyResolver });
const report = await runRealModelLane({
  models: laneModels, scenarios: LANE_SCENARIOS, providerResolver: resolver,
  repoRoot: process.cwd(), reportsDir: 'benchmarks/reports',
});
```

## 设计选择与理由

1. **复用 076 RunResult**：每（模型 × 场景）产出 076 `validate` 通过的 RunResult，L3 采集字段与
   cross-harness（L3）完全一致，避免另起一套指标模型。
2. **vesselAdapter.run 驱动**：走 076 self-adapter 统一入口（含 temp workspace 隔离与回收），不重复
   compose/telemetry 逻辑，也保证报告行都是契约合法 RunResult。
3. **可注入 = 契约友好**：`models` / `scenarios` / `providerResolver` 均可注入；无凭据时 mock provider 验证
   全框架，退化到 pending-environment，天然满足「不烧真实配额」。
4. **场景集从既有资产选**：只用现存 21 个 yaml/assets，不新造场景资产（不膨胀范围）；feature-lane 枚举为
   `skipped` 而非虚跑。