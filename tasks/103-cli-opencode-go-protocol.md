# 103 — CLI/TUI 侧 opencode-go 协议适配（消除 400 MissingSessionID）

- 编号：103
- 状态：已合入
- 优先级：P1（用户日常用 CLI/TUI 走 Go 端点会 400）
- 创建日期：2026-09-09
- 关联：102（5af2dfc：lane 侧 opencodeGoChatProvider 已带 x-opencode-session）；docs/OPENCODE-KEY-VERIFY.md
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）

## 问题（102 记录）

opencode **Go 端点**（`https://opencode.ai/zen/go/v1`）**强制 `x-opencode-session` 头**（缺失 → 400
`MissingSessionID`）+ 具名 User-Agent。102 已在 benchmark lane 侧实现（`opencodeGoChatProvider.ts`），但
**CLI/TUI 侧仍走通用 openai-compatible 客户端**（`apps/cli/src/cli.ts`、`apps/cli/src/tui/chat.ts`），
对 Go 端点会 400——用户实际用 `vessel run`/`vessel chat` 配 opencode-go 时会失败。

## 验收标准（执行器逐条勾选）

- [x] 选定并实施方案（记录理由）：
      **方案 A**：把 Go 协议能力上提到 `packages/llm`（`OpencodeGoProvider` + `createProvider('opencode-go')`），
      CLI/TUI 与 lane 共用同一实现（单一事实源）。理由见「工作证明」§1。
- [x] CLI/TUI 走 opencode-go（provider preset id `opencode-go`）时自动带 session 头 + UA；错误分类区分
      400 MissingSessionID / 401 CreditsError（沿用 102 的文案剥离）
- [x] 与 102 的 lane 实现收敛：lane 侧只剩 re-export 外壳，实现唯一
- [x] 测试 ≥6 例：头注入/缺头 400 分类/CLI 端到端（mock HTTP 服务）/lane 复用/降级；`npx tsc -b tsconfig.json` exit 0 +
      全量 vitest（1082+ 无回归）+ web 74 —— 实得 **1102 passed**（=1082+20 新增）+ 1 skipped + web 74
- [x] 文档同步（PROVIDER-MANAGEMENT/REAL-MODEL-LANE：Go 端点协议要求与配置方式）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 CLI/TUI 侧协议适配 + 与 lane 收敛。不改 pricing（101 已验收）；不做 UI；不加依赖。
- 密钥不落盘（env/CredentialStore）；不读用户本机应用数据。

## 涉及文件（实际改动）

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/llm/src/provider/OpencodeGoProvider.ts` | **新增（SSOT）** | 从 lane 上提的完整协议实现：session 头 + 具名 UA + 路由分流 + 错误分类 + 推理预算 + 错误提示文案 |
| `packages/llm/src/provider/createProvider.ts` | 改 | 注册 `'opencode-go'` provider + `providerNameForConfig()`（preset id → provider 名）+ sessionId/userAgent/maxAttempts 选项 |
| `packages/llm/src/index.ts` | 改 | 导出新 provider 模块 |
| `packages/llm/src/provider/opencodeGoProvider.test.ts` | **新增** | 9 例（createProvider 注册/头注入/会话稳定/分类/分流/降级/kind 还原） |
| `apps/cli/src/providers/providerFactory.ts` | **新增** | CLI/TUI 唯一构造路径：planProvider / buildRealProvider / describeProviderError |
| `apps/cli/src/cli.ts` | 改 | `cmdRun` + `cmdBench` 改用 providerFactory；错误文案走 describeProviderError |
| `apps/cli/src/tui/chat.ts` | 改 | buildHarness 改用 providerFactory；一个 TUI 会话一个稳定 session id |
| `apps/cli/src/providers/opencodeGoCli.test.ts` | **新增** | 8 例（CLI e2e ×4 + TUI e2e + 解析/降级/提示 ×3，本地 node:http mock） |
| `benchmarks/runners/src/lane/opencodeGoChatProvider.ts` | 改 | 485 行实现 → re-export 外壳（消除重复） |
| `benchmarks/runners/src/lane/opencodeGoSsoT.test.ts` | **新增** | 3 例（lane 与 llm 同一类/同一会话 id/头注入同源） |
| `benchmarks/runners/src/lane/opencodeGoProvider.ts` | 改 | 注释同步 SSOT 上提（无逻辑改动） |
| `benchmarks/runners/package.json` | 改 | 声明 `@vessel/llm` 依赖（runner → llm 为合法向下依赖） |
| `docs/PROVIDER-MANAGEMENT.md` | 改 | 新增 §5.1 Go 端点协议要求 / 配置方式 / 错误分类表 |
| `docs/REAL-MODEL-LANE.md` | 改 | 102 小节标注 103 的 SSOT 上提（语义不变） |

## 方法

- 先读 102 的 lane 实现与 CLI 客户端构造路径 → 选方案（优先单一事实源）→ 实施 → mock HTTP 端到端测试 →
  全量验证

## 工作证明（执行器回填）

### 1. 方案选择与理由

**选方案 A**（协议实现上提 `packages/llm`），不选 B（给 `OpenAICompatibleProvider` 加 `extraHeaders`）：

1. **单一事实源**：102 的实现里除「头」之外还有 4 件 Go 专属语义——路由分流（`/chat/completions`
   vs `/messages`、`/responses` 的 declared-only 抛错）、错误分类（400 missing-session / 401 credits）、
   推理模型 `max_tokens` 预算、`reasoning` 保留。方案 B 只把「头」塞进通用客户端，其余语义仍会分叉。
2. **零 wire 细节落在 CLI**：方案 A 下 CLI/TUI 只做「按 preset id 选 provider」，不碰任何 header/路由；
   `providerFactory.ts` 里没有一处 wire 常量。
3. **收敛 102 重复**：lane 侧 485 行实现删除，改 re-export；协议逻辑在全仓只剩一份。
4. **依赖方向合法**：`benchmarks/runners → @vessel/llm → @vessel/shared`，无环（098 消除的
   cli↔runners 环不受影响）；`packages/llm` 不反向依赖 application/cli，所以 **preset 仍是 baseUrl 的
   SSOT**，CLI 用 `findPreset('opencode-go').baseUrl` 兜底，llm 侧只留一个给非 CLI 消费者的常量。
5. **不改 preset protocol 字段**：preset 仍是 `openai-compatible`（线协议事实），选择改由 **preset id**
   决定（`providerNameForConfig`），于是 ProviderStore 校验、模型拉取（`fetchModelOutcome`）、
   catalog 的协议分支全部零改动。

### 2. 改动 diff（要点）

`packages/llm/src/provider/createProvider.ts`：

```ts
export function providerNameForConfig(cfg: ProviderSelection | undefined, fallback = 'mock'): string {
  if (!cfg) return fallback;
  if (cfg.id === OPENCODE_GO_PROVIDER_ID) return OPENCODE_GO_PROVIDER_ID; // Go 端点需专用 provider
  return cfg.protocol ?? fallback;
}

case OPENCODE_GO_PROVIDER_ID:
  return new OpencodeGoProvider({
    baseUrl: requireUrl(name, opts.baseUrl), apiKey: opts.apiKey, model: opts.model,
    timeoutMs: opts.timeoutMs, sessionId: opts.sessionId, userAgent: opts.userAgent,
    defaultMaxTokens: opts.defaultMaxTokens, maxAttempts: opts.maxAttempts,
  });
```

`apps/cli/src/providers/providerFactory.ts`（CLI/TUI 唯一构造路径）：

```ts
export function planProvider(input: ProviderPlanInput): ProviderPlan {
  const providerName = input.config ? providerNameForConfig(input.config) : (input.explicitProvider ?? 'mock');
  const baseUrl = input.baseUrl ?? input.config?.baseUrl
    ?? (providerName === OPENCODE_GO_PROVIDER_ID ? opencodeGoPresetBaseUrl() : undefined);
  return { providerName, baseUrl, apiKey: input.apiKey ?? input.config?.apiKey,
           model: input.model ?? input.config?.model ?? 'mock-model', real: REAL_PROVIDER_NAMES.has(providerName) };
}

export function buildRealProvider(plan, opts: { sessionId?: string } = {}): ChatProvider | null {
  if (!plan.real) return null;
  return createProvider(plan.providerName, { baseUrl: plan.baseUrl, apiKey: plan.apiKey,
    model: plan.model, ...(opts.sessionId ? { sessionId: opts.sessionId } : {}) });
}
```

`apps/cli/src/cli.ts`（cmdRun；cmdBench 同路径）：

```ts
-  const providerName = explicitProvider ?? currentCfg?.protocol ?? 'mock';
+  const plan = planProvider({ config: currentCfg, explicitProvider,
+    baseUrl: flags.get('base-url') ?? process.env.VESSEL_BASE_URL,
+    apiKey: flags.get('api-key') ?? process.env.VESSEL_API_KEY,
+    model: flags.get('model') ?? process.env.VESSEL_MODEL });
+  const realProvider = buildRealProvider(plan);
+  const provider = realProvider ?? new MockProvider(smokeScript, { model, vars: { cwd: workspace } });
   } catch (err) {
-    console.error(`[vessel] run failed: ${(err as Error).message}`);
+    console.error(`[vessel] run failed: ${describeProviderError(err)}`);
```

`apps/cli/src/tui/chat.ts`：

```ts
+  const opencodeGoSessionId = randomUUID(); // 一个 TUI 会话一个稳定 session id
   if (cfg && cfg.protocol !== 'mock') {
-    effProvider = createProvider(cfg.protocol, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model });
-    effModel = cfg.model;
+    const plan = planProvider({ config: cfg });
+    effProvider = buildRealProvider(plan, { sessionId: opencodeGoSessionId }) ?? undefined;
+    effModel = plan.model;
   }
```

`benchmarks/runners/src/lane/opencodeGoChatProvider.ts`：485 行实现 → `export { OpencodeGoProvider, ... } from '@vessel/llm'`（diff 521 行删除）。

顺带修掉一个既有缺陷：`--provider <已存供应商 id>` 过去会被当作协议名直接传给 `createProvider` 而抛
`unknown provider`（例如 `--provider deepseek`）；现在按已存配置的 id/protocol 解析。

### 3. 头注入证据（CLI/TUI 端到端，本地 mock HTTP 服务）

`apps/cli/src/providers/opencodeGoCli.test.ts` 起一个 node:http 替身：缺 `x-opencode-session` → 400
`MissingSessionID`（与实测一致），有头 + Bearer → 200。`vessel run --provider opencode-go` 实测：

```
✓ run --provider opencode-go 注入 x-opencode-session + 具名 UA + Bearer，端到端成功 1401ms
   first.url === '/v1/chat/completions'
   first.headers['x-opencode-session'] 匹配 UUID v4 正则
   first.headers['user-agent'] === 'vessel-harness/1.1.0 (opencode-go; +https://github.com/composable-agent-harness)'
   first.headers.authorization === 'Bearer sk-test-not-a-real-key'
   first.body.max_tokens === 8192（推理模型思维链预算）
✓ 同一端点用通用 openai-compatible → 400 MissingSessionID（无分类/无提示，证明头是唯一差别）
✓ opencode-go 收到 400 MissingSessionID → CLI 打印 missing-session + 提示：x-opencode-session
✓ opencode-go 收到 401 CreditsError → 分类 credits + 欠费提示，文案不含 wrk_…/URL
✓ TUI runChat：已存 preset id opencode-go 自动带会话头，且一个会话内 session id 稳定（多轮同一 UUID）
```

### 4. 测试与命令输出

```
npx vitest run packages/llm/src/provider/opencodeGoProvider.test.ts \
  apps/cli/src/providers/opencodeGoCli.test.ts \
  benchmarks/runners/src/lane/opencodeGoSsoT.test.ts \
  benchmarks/runners/src/lane/opencodeGoChatProvider.test.ts
→ Test Files 4 passed (4) / Tests 34 passed (34)
   （9 llm 新增 + 8 CLI 新增 + 3 SSOT 新增 + 14 既有 102 例）

npx tsc -b tsconfig.json --pretty false   → TSC_EXIT=0

npx vitest run                            → Tests 1102 passed | 1 skipped (1104)，Test Files 103 passed | 1 failed
   唯一失败 = packages/runtime/src/sandbox/backend/process-tree.test.ts（**已知 flaky：process-tree 时序**，
   全量并发下 30s 超时）。单跑该文件 → 11 passed（14.2s），与本卡改动无关（未触碰 runtime/sandbox）。
   基线 1082 passed + 1 skipped → 现 1102 passed（= 1082 + 20 新增），无回归。

cd apps/web && npx vitest run             → Tests 74 passed (74)，WEB_VITEST_EXIT=0
```

### 5. 踩坑与环境备注

1. **AgentLoop 会吞掉 `kind` 字段**：`packages/core/src/agent-loop/AgentLoop.ts:403` 用
   `new Error(\`Model call failed after N attempt(s): ${err.message}\`)` 重新包装 provider 错误，
   所以 CLI 侧 `err.kind` 拿不到。解决：在 `OpencodeGoProvider.ts` 增 `opencodeGoKindFromMessage()`，
   从**稳定的自产文案** `opencode-go <status> <wireType> (<kind>): …` 还原 kind；CLI 提示据此仍然给出。
   （未改 core —— 超出本卡范围。）
2. **`vessel provider add` 的 preset 与 `--protocol` 关系**：opencode-go 的 preset 协议仍是
   `openai-compatible`，因此**不能**靠协议名区分 Go 端点；选择键必须是 preset id（已按此实现）。
3. 环境：Windows/PowerShell + Node v24；`npx vitest run` / `npx tsc -b` 在本会话可用（无 spawn EPERM）。
   全程未打真实网络（全部用 node:http 本地替身），未读用户本机应用数据，未落盘任何密钥。

### 6. 复现命令

```powershell
npx tsc -b tsconfig.json
npx vitest run packages/llm/src/provider/opencodeGoProvider.test.ts apps/cli/src/providers/opencodeGoCli.test.ts benchmarks/runners/src/lane/opencodeGoSsoT.test.ts
# 手工冒烟（需要真 key；密钥只经 env，不落盘）
$env:VESSEL_PROVIDER_ROOT = "$env:TEMP\vessel-oc-go"
vessel provider add opencode-go --protocol openai-compatible --base-url https://opencode.ai/zen/go/v1 --model mimo-v2.5 --api-key $env:OPENCODE_API_KEY
vessel provider switch opencode-go
vessel run --prompt "ping"
```

## 验收结论（指挥回填）

- [x] 合入（commit afac81a）
- 备注：指挥独立复核——`tsc -b` exit 0；全量 vitest 1102 passed + 1 skipped（基线 1082，+20 无回归；唯一失败为
  已知 process-tree 时序 flaky）；web 74。
  认可方案 A（协议上提 `packages/llm/src/provider/OpencodeGoProvider.ts` 作 SSOT，CLI/TUI/lane 共用）：理由充分
  （Go 专属语义除头外还有路由分流/错误分类/推理预算，方案 B 只塞头会继续分叉）；lane 侧 485 行重复实现删除为
  re-export 外壳；新增 `apps/cli/src/providers/providerFactory.ts` 作为 CLI/TUI 唯一构造路径（baseUrl 优先级
  flag>config>preset；TUI 每会话稳定 session id）；顺带修既有缺陷（`--provider <已存 id>` 被当协议名传导致
  unknown provider）；20 例新测试全用 node:http mock（含"通用 openai-compatible 对同端点 400"对照，证明头是唯一
  差别）；401 文案剥 URL/内部标识；坑（AgentLoop 重新包装错误丢 `kind`）用文案还原规避、未改 core。
  **103 关闭。**
