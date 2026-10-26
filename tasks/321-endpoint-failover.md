# T321 — 端点失败转移：候选端点真正参与运行时

- Status: 已完成（2026-10-26；PDW 任务 `20261026145001-6ef0f7`，implement=codex、review=opencode，`accepted_local`）
- PDW task: none（契约 `.pdw/contracts/321-endpoint-failover.json`）

> 依据：`docs/MAGPIE-ABSORPTION.md` §3 P1-2。
> 现状：`ProviderStore.effectiveEndpoints()`（`apps/local-server/src/providers/ProviderStore.ts:395`）
> 已能给出候选端点池，但**只有 `vessel provider endpoint test` 用**；`vessel run` / `vessel chat` /
> TUI 的运行时只认 `config.baseUrl`（`apps/cli/src/providers/providerFactory.ts:107-110`）。
> 于是主域被墙或挂掉时，用户只能手改配置。

## 0. 只读前置

1. `apps/local-server/src/providers/ProviderStore.ts` — `ProviderEndpoint`、`effectiveEndpoints` 语义
   （`endpoints` 非空时以它为准，否则候选池 = `[baseUrl]`）。
2. `apps/cli/src/providers/providerFactory.ts` — `planProvider` / `buildRealProvider`，CLI/TUI 唯一构造路径。
3. `apps/cli/src/providers/endpointProbe.ts` — 现有探测语义（复用错误分类思路，不要重复定义 wire 细节）。
4. `packages/shared/src/provider.ts` — `ChatProvider` / `ChatRequest` / `StreamChunk` 形状。
5. `apps/cli/src/cli.ts:917-942`、`apps/cli/src/cli.ts:2963-2982`、`apps/cli/src/tui/chat.ts:569-571` — 三处调用点。

## 1. 需求（写死）

1. **候选端点运行时生效**：`ProviderConfig.endpoints` 非空时，模型调用在首个端点失败后按顺序
   尝试其余端点；一旦某端点成功，**记住它**并作为后续调用的首选（不是轮询）。
2. **只在端点级故障切换**：网络错误（`ECONNREFUSED`/`ECONNRESET`/`ETIMEDOUT`/`ENOTFOUND`/
   `EAI_AGAIN`/`EHOSTUNREACH`/`ENETUNREACH`/`EPIPE`/`UND_ERR_CONNECT_TIMEOUT`/`UND_ERR_SOCKET`）
   与 HTTP 408/429/5xx。**不切换**：400/401/403/404/422、`AbortError`、未知错误——换端点治不了，
   重试只会把真正的错误埋掉。判定只认错误对象上的可观察字段（`code` / `status` / `statusCode` /
   `response.status` / `name`），不做文案模糊匹配。
3. **流式安全**：还没向调用方吐出任何 chunk 时允许切换；已经吐过 chunk 则**原样抛出**，
   不允许重放（会让用户看到重复文本）。
4. **显式端点覆盖不产生候选**：`--base-url` / `VESSEL_BASE_URL` 出现时（**包括空串**）只有唯一端点，
   行为与现在逐字一致。
5. **候选不足两个不同端点时不包一层**：`plan.endpoints` 缺省，`buildRealProvider` 返回原 provider，
   既有调用路径与能力字段不变。端点去重忽略结尾斜杠，保持首次出现顺序，首项 = 本次实际端点。
6. **可观测**：CLI 真的切换时向 stderr 打一行（如 `[vessel] 端点失败转移：<from> → <to>`）；
   `--json` 模式不打（不污染机器可读输出）。TUI 不做提示（避免破坏界面），但切换仍生效。
7. **不引入本地网关、不改配置格式、不改 `ProviderStore` 的写盘结构、不加依赖**。
8. **文档**：`docs/PROVIDER-MANAGEMENT.md` 增一节，写清「只在同一供应商的候选端点之间切换」
   与「不做跨供应商 failover / 不做配额感知路由」（后者仍属未实现，不得含糊）。

## 2. 不许做

- 不在 `packages/core` 里加任何机制；不改 `packages/shared` 的 `ChatProvider` 接口形状。
- 不改 `usage` 记录、价目、`provider endpoint` 子命令的既有输出。
- 不做重试退避/熔断/计数窗口（本次只要「按顺序切一次到底」，全部失败抛最后一个错误）。
- 不 commit / push；不动 `.pdw/` 与用户凭据。

## 3. 允许修改

```
packages/llm/src/provider/**            (新增失败转移 provider + 测试)
packages/llm/src/index.ts               (导出)
apps/cli/src/providers/**               (planProvider / buildRealProvider + 测试)
apps/cli/src/cli.ts                     (两处调用点接提示)
docs/PROVIDER-MANAGEMENT.md             (语义与边界)
```

## 4. 验收（PDW checks 会真跑）

```powershell
node node_modules/vitest/vitest.mjs run packages/llm/src/provider
node node_modules/vitest/vitest.mjs run apps/cli/src/providers
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
```

## 5. 回报（implementer 在 REPORT 里写）

```
实现位置：<新模块路径 + 包装在哪一层>
判定表：<哪些错误切换 / 哪些不切换>
顺序语义：<首跳 + 记忆上次成功>
流式：<未输出 / 已输出的行为>
CLI 提示：<哪种模式打、打什么>
测试：<新增文件与用例数>
文档：<新增小节标题>
未做：<如实写>
```

## Result

已收口（2026-10-26）。**本次走完整 PDW**：契约 `.pdw/contracts/321-endpoint-failover.json`，
任务 `20261026145001-6ef0f7`，角色为 scan/test-plan → **implement = codex / gpt-6.1-sol / medium**
→ review = opencode / deepseek-v4.1-flash / max；`status = accepted_local`，4 条契约检查全绿
（llm provider 10 文件 143、cli providers 15 文件 160、`tsc -b`、`tsc -p tsconfig.test.json`）。

改动（均由 Codex 写，协调者只复核）：

1. **新模块** `packages/llm/src/provider/EndpointFailoverProvider.ts`：候选端点按
   「当前偏好 → 其余登记顺序」逐个尝试，每次调用每个端点最多一次；成功即记住偏好（内存内）。
   `isEndpointFailure()` 顺着 `cause` 链判定，只认结构化 `code` / `status`（408/429/5xx）
   与 `AbortError`，不按文案猜。**只有全部候选都支持流式时才提供 `stream`**，避免包装后
   谎报能力；流式已吐 chunk 则原样抛出、不重放。
2. **协议错误携带状态码**：`AnthropicProvider` / `OpenAICompatibleProvider` 的非 2xx 抛出改为
   `Object.assign(new Error(...), { status })`（文案逐字不变）；`OpencodeGoProvider.networkError`
   attach `cause`，让分类器能顺着链看到网络码。
3. **CLI 构造路径**（`providerFactory.ts`）：`planProvider` 产出 `endpoints`（首项 = 本次 baseUrl，
   去重忽略结尾斜杠；`baseUrlExplicit` 或 `--base-url` 有值时不出候选）；`buildRealProvider`
   仅在 ≥2 个不同端点时包一层，并给 opencode-go 生成一个**跨候选复用**的 sessionId、
   同时传 `maxAttempts: 1`（内层不再单端点重试，避免把一次失败拖成两次超时）。
4. **提示**：`cli.ts` 三处入口（`run` / `bench` / `mcp-agent`）接 `onEndpointSwitch`，
   stderr 打一行 `[vessel] 端点失败转移：<from> → <to>`，`--json` 静默；TUI 静默但切换生效。
5. **文档**：`docs/PROVIDER-MANAGEMENT.md` §3.2.1 写清顺序、判定范围、流式规则、显式覆盖、
   偏好只在内存；并明确**不做**跨供应商 failover、配额感知路由、退避/熔断。

独立复核留下的低优先级问题（协调者判定**不修**，理由如下）：

- `cli.ts` 用 `process.env['VESSEL_BASE_URL'] !== undefined` 判「存在性」而不是 `envNonBlank`：
  这是**故意**的——空白 env 要被识别为「用户显式设过、只是被规范化丢弃」，语义与 AC4 一致；
  换成 `envNonBlank` 会把「设过空值」误当成「没设」。
- TUI 没有切换行为用例：TUI 明确不打提示，切换走的是同一个 provider 包装器，已有用例覆盖。
- `docs/MAGPIE-ABSORPTION.md` 的现状表仍写着「无自动切换」：属于历史对照文档，本次在其
  P1-2 落点已实现；下个文档收口任务（T325）统一更新。

协调者独立复核：逐行看了 7 个修改文件与 3 个新测试文件；`createProvider` 的 `maxAttempts`
确为既有选项（默认 undefined），只在多端点时收紧为 1，单端点路径未受影响。全量门禁数字见
`HANDOFF.md`。

