# Harness Adapter Contract（跨 Harness 统一执行/采集契约）

> 来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1 L3 + BENCHMARK-SPEC §4/§7。
> 实现：task 076。状态：已合入（V1.0 Milestone G，076–081 已验收；见 docs/V1.0-CHECKPOINT.md）。

## 1. 定位

让**同一 benchmark fixture** 可在一家 harness（Vessel 自身 + 外部 CLI）上运行，并**统一采集 §15 L3 指标**
（success / wall time / tool calls / invalid calls / retries / tokens / cost / context peak / compactions /
human intervention / policy violations / resume success）。077-081 的外部 harness adapters（DSH / OpenCode /
Codex / Pi / Claude Code）实现本契约；本仓自带的 `vessel` self-adapter 证明契约可用、可测、不依赖外部 harness。

本契约层位于 `benchmarks/runners/src/contracts/`。它与既有 runner（`runner.ts` / `B001-B023`）**共存**：
既有 runner 继续负责 prepare/assert/report；本契约只做"跑一个 fixture、返回一个可校验的 RunResult"那一段。

## 2. 类型（TS）

核心两个接口（`contracts/types.ts`）：

```ts
interface HarnessAdapter {
  id: string;                       // 'vessel' | 'dsh' | 'opencode' | 'codex' | 'pi' | 'claude-code'
  version: string;                  // adapter 实现版本
  run(fixture: HarnessFixture): Promise<RunResult>;
  capabilities: Record<CapabilityKey, boolean | 'tbd'>;  // 诚实声明能力，用于 skip
}

interface HarnessFixture {
  id: string;                       // 'B001' 等
  workspaceRoot: string;            // fixture 目录（task.md + 资产）绝对路径
  taskFile?: string;                // 默认 'task.md'
  options?: Record<string, unknown>; // per-adapter 上下文（policy/model/configRoot…）
}
```

`RunResult`（§15 L3 全字段，**必填**，由 `contracts/validate.ts` 校验）：

```ts
interface RunResultMetrics {
  success: boolean;           // runner 侧断言全过 = true，否则 false
  wallTimeMs: number;         // 墙钟时长
  toolCalls: number;          // 发起的工具调用总数（含被拒/失败）
  invalidCalls: number;       // 参数校验失败/畸形调用数（INVALID_ARGS 类）
  retries: number;            // 重试次数（含 harness 自动重试 + 模型改写重试）
  inputTokens: number;        // 累计 input tokens（缓存单独列，不加总）
  outputTokens: number;       // 累计 output tokens
  cacheReadTokens: number;    // 累计缓存命中 tokens
  costUsd: number;            // 估算成本 USD = Σ(输入×单价 + 输出×单价 + 缓存×单价)
  contextPeak: number;        // run 内单次请求上下文峰值（input+cacheRead 最大值）
  compactions: number;        // 上下文压缩次数
  humanIntervention: number;  // 人工/外部干预次数（approval 走向人类、steer、interrupt）
  policyViolations: number;   // 策略违规数（audit/denial：policy deny + sandbox DENIAL + never 审批拒绝）
  resumeSuccess: boolean | null; // 是否经 resume 续跑完成；无 resume 面记 N/A → null
}

interface RunResult {
  adapterId: string;
  adapterVersion: string;
  fixtureId: string;
  metrics: RunResultMetrics;
  startedAt: string;                // ISO 时间戳
  artifacts?: { kind: string; path: string }[]; // session 日志 / workspace 等，供审计
  notes?: string[];                 // adapter 自报口径/近似说明
}
```

`CapabilityKey`：`tool_calls | file_edit | exec | subagent | mcp | planner | evaluator | memory | skill |
resume | compaction | policy | matrix`。

## 3. 校验（contracts/validate.ts）

- `validateRunResultMetrics(m)`：字段齐全（§15 L3 全字段）、类型正确、数值非负（含 `contextPeak`、`costUsd`）。
- `validateRunResult(r)`：在 metrics 校验之上再查 `adapterId/adapterVersion/fixtureId` 非空、`startedAt` 为合法 ISO、
  `artifacts/notes` 形状。
- `validateHarnessAdapter(a)`：`id/version` 非空、`run` 是函数、`capabilities` 是映射。
- `assertValidRunResult` / `assertValidHarnessAdapter`：有任一 issue 即 throw（fail-loud，绝不静默）。

运行语义：`run()` 在**硬故障**（fixture 缺失、adapter 接错）时 throw；在**运行期失败**（模型/工具报错）时返回
`metrics.success=false` 的合法 RunResult，绝不静默吞崩溃。

## 4. Vessel 自适配（contracts/vessel.ts）

`vesselAdapter` 用本地 engine 跑 fixture：

1. 把 fixture workspace **复制到临时目录**（绝不动 benchmarks/fixtures 原件）。
2. `composeHarness` 组装本地 harness，用**包裹 provider** 捕获每请求 usage 以累计
   input/output/cache tokens 并计算 `contextPeak`（每请求 input+cacheRead 最大值）。
3. `harness.loop.runTurn(task)` 跑一轮，读 `telemetry.finalize` 的 counters →
   toolCalls / invalidCalls / retries / compactions / denials / approvalAsks。
4. `policyViolations` = session `audit/denial` 计数（与 counters.denials 取较大）。
5. `costUsd` 按 `configs/pricing.json` 单价表（model > protocol > default）估算。
6. `assertValidRunResult` 校验后返回；`adapter.run` 默认清理临时 workspace。

用法：

```ts
import { vesselAdapter } from '@vessel/bench-runners';

const fixture = {
  id: 'B001',
  workspaceRoot: '/repo/benchmarks/fixtures/B001',
  options: { provider: myProvider, model: 'deepseek-chat', configRoot: '/repo' },
};
const r = await vesselAdapter.run(fixture);   // 缺 provider 时自动用 OFFLINE_SCRIPTS mock 车道
console.log(r.metrics);                        // §15 L3 全字段
```

## 5. 与既有 runner 对齐

- **不破坏** `benchmarks/runners/src/runner.ts` 的 prepare/assert/report 以及 `scenarios/*.yaml` / `fixtures/*`
  契约；`B001-B023` 继续经由 `runScenario` 跑，`loadManifest` 继续可用。
- **L1 复用**：`contracts/vessel.ts` 缺省 provider 时从 `OFFLINE_SCRIPTS` 取 mock 脚本，因此可直接喂
  `benchmarks/fixtures/B001` 这类 L1 fixture。
- **判据唯一事实源仍是 scenario manifest**；adapter 只采集，不判据（BENCHMARK-SPEC §7.1 职责边界保持一致）。

## 6. 077-081 实现指引

每张卡实现同一 `HarnessAdapter` 形状，并 `assertValidHarnessAdapter(this)`：

| adapter id | 接入面 | 采集通道 |
|---|---|---|
| `dsh` (077) | DSH CLI / Python SDK `jsonrpc-agent` | event-sourced 日志 + usage |
| `opencode` (078) | opencode headless CLI | SQLite messages（parts 双层）导出 |
| `codex` (079) | `codex exec` | rollout JSONL / sqlite thread store |
| `pi` (080) | evals `createPiCodingAgentHarness` / print/json 模式 | session JSONL + usage ledger |
| `claude-code` (081) | `claude -p` + restricted | CLI stdout/json + transcript |

实现要点：

1. **run() 归一化**：把自家原始会话/日志映射到 §15 L3 字段，`source`/`notes` 注明口径（BENCHMARK-SPEC §4.4
   诚实标注：turn/token/compaction 语义各家不同，禁止裸数字跨口径排名）。
2. **工具名 → family**：断言只在 family 级用（file_read / search / write / exec / delegate / mcp / approve），
   无法归一的记 `family: unknown` 并提示。
3. **非法解析**：`contextPeak` 无 usage 暴露时按每轮 transcript 估算并标 `approx`；`resumeSuccess` 无 resume
   能力记 `null`。
4. **capabilities 诚实降级**：不具备的能力（如 Pi 无 MCP/subagent 原语）在 `capabilities` 里 `false`，
   runner 在 `run()` 前即 `skipped`（附原因），不进结果集。
5. **cost**：按最新 `configs/pricing.json` 单价表计算，并在报告版本里锁单价表。

每个 adapter 必须通过 `validateHarnessAdapter` + 每次返回的 `RunResult` 通过 `assertValidRunResult`；
测试复用 `contracts/contracts.test.ts` 的校验用例作为 a 面，另加各自 spawn/采集的 b 面。

## 7. 参考

- docs/Vessel_后续开发方向与产品化路线_v1.0.md §15.1（L3 统一采集字段）
- docs/BENCHMARK-SPEC.md §4（M01–M14 指标定义）、§6.3（各家非交互面）、§7（adapter 清单）
- benchmarks/runners/src/contracts/（本契约实现 + tests）