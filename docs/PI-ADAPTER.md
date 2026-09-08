# Pi Harness Adapter（task 080）

> 实现 076 的 HarnessAdapter 契约（`contracts/types.ts`）的 **Pi（外部 harness）适配器**，
> 让同一 benchmark fixture 可在 Pi 上运行并统一采集 §15 L3 指标。
> 与 077（DSH）/ 078（OpenCode）/ 079（Codex）同批模式。状态：待验收（task 080）。
> 关联：081（Claude Code）各自成卡。

## 1. 定位

- Pi 是外部 harness，本 adapter **不读 Pi 源码**，只通过 Pi 的稳定 CLI 命令面驱动
  （clean-room，prompt 不引入本项目）。
- 与 `contracts/vessel.ts`（Vessel 自适配）、`adapters/dsh.ts`（077）、`adapters/opencode.ts`（078）、
  `adapters/codex.ts`（079）共用同一 `HarnessAdapter` 面（`id / version / run(fixture): Promise<RunResult> /
  capabilities`），每次返回的 `RunResult` 通过 `assertValidRunResult` 校验。
- 属于 `benchmarks/runners/src/adapters/pi.ts`，经 `contracts/index.ts` 导出
  （入口：`@vessel/bench-runners` 的 `piAdapter` / `runPiFixture`）。

## 2. 接入面

| 项目 | 值 |
|---|---|
| adapter id | `pi` |
| adapter version | `0.1.0` |
| CLI 子命令面 | `pi run --workspace <dir> --task <taskFile> --json <taskText> [args...]` |
| 期望输出 | stdout 上 JSON 对象（`PiRawRun`，见 `pi.ts` 类型注释），适配器主动经 `--json` 请求 |
| 采集通道 | session JSONL + usage ledger（076 契约 §6 声明），adapter 归一为 `PiRawRun` |
| 隔离 | fixture workspace 复制到临时目录，绝不动 `benchmarks/fixtures` 原件 |
| cost | 按 `configs/pricing.json` 单价表（model > default 回退）估算 |

适配器自带的 `PiRawRun` 是**本适配器主动请求的 JSON 契约**——只取 §15 L3 相关子集，不是 Pi 内部结构；
缺失字段由归一化器补缺省并标 `approx`。这保证了 clean-room（不窥探 Pi 内部）和可 mock 测试。

## 3. 用法

```ts
import { piAdapter, runPiFixture } from '@vessel/bench-runners';

const fixture = {
  id: 'B001',
  workspaceRoot: '/repo/benchmarks/fixtures/B001',
  options: {
    command: 'pi',            // 可注入 CLI 可执行名 / 全路径
    args: ['-m', 'model-x'],  // 透传给 `pi run` 的额外参数
    configRoot: '/repo',
    model: 'model-x',
    keepWorkspace: false,     // 调试时可保留临时工作区
  },
};
const r = await piAdapter.run(fixture);   // 需要本机 Pi CLI 可用
console.log(r.metrics);                   // §15 L3 全字段
```

### 可注入点（便于测试 / 非真实 Pi 环境）

- `options.command`：CLI 路径，默认 `'pi'`。
- `options.runCommand(argv, {cwd}) => ResultStub`：替换 spawn 入口，测试注入 mock CLI。
- `options._envResolve`：**测试专用**环境探针，避免测试真正落盘查找 Pi 二进制。
- `probePiEnv(command, resolve?)`：返回本机 Pi CLI 是否可用。

## 4. 采集归一（Pi 输出 → §15 L3）

| RunResult 字段 | Pi 通道 | 缺省/口径 |
|---|---|---|
| `success` | `raw.success`（adapter 把 Pi session 结果归一为 success）；若 `finalText` 为空则降级 false | 缺失 → false + approx |
| `wallTimeMs` | `raw.wallTimeMs`，缺失回退 `Date.now()` 差 | ≥0 |
| `toolCalls` / `invalidCalls` / `retries` | `raw.*` | 缺失 → 0 + approx |
| `inputTokens` / `outputTokens` / `cacheReadTokens` | `raw.*`（usage ledger） | 缺失 → 0 + approx |
| `costUsd` | input/output/cache × 单价表求和 | — |
| `contextPeak` | `raw.contextPeak` | 缺失 → 0 + approx |
| `compactions` / `humanIntervention` / `policyViolations` | `raw.*` | 缺失 → 0 + approx |
| `resumeSuccess` | `raw.resumeSuccess` | 缺省 `null`（N/A） |

**口径诚实**（BENCHMARK-SPEC §4.4）：缺失字段一律记 `approx` 进 `notes`，禁止与其他 harness 的裸数字
跨口径排名。所有字段为 `number≥0` / `boolean` / `boolean|null`，`validateRunResultMetrics` 兜底。

## 5. capabilities（诚实降级）

Pi 具备 `tool_calls/file_edit/exec/memory/policy` 原生能力（`run` 面驱动 tool calling）；
`mcp` 标 `false`（当前 cli run 驱动面不编排 MCP fixture）；`subagent/skill` 依 run 面成熟度标 `'tbd'`
（Pi 无稳定 subagent 原语）；`planner/evaluator/resume/compaction` 依实现成熟度标 `'tbd'`；
`matrix` 依赖真实 CLI 可用——本机无 Pi 时 `matrix=false`（runner 据此在 `run()` 前 `skipped`，不进结果集）。

## 6. 环境状态与"待环境"标注

- `probePiEnv('pi')` 检测本机 Pi CLI（`pi --version`）。不可用时：
  - 默认把 run 标为 `pending-environment`（`success=false`、`notes` 含 `pending-environment`），仍返回**合法**
    RunResult，不 throw——供外部巡检确认环境后再跑真实执行。
  - 若 `options.failOnMissing=true`，则把不可用当作真实运行失败处理。
- **本机状态**：真实 Pi CLI 是否已安装未在本任务验证（clean-room 只按文档 076 §6 声明面驱动）；驱动层以可注入
  `runCommand`/`_envResolve` 为主，测试不依赖真实 Pi 进程与凭据。

## 7. 限制

- Pi 源只是外部接口层，`PiRawRun` 字段以适配器文档为准；Pi 内部输出语义变化需与 `--json` 面同步。
- 真实 Pi 运行需要进程 spawn 与模型鉴权；Windows 沙箱（read-only / 受限 spawn）下建议注入 `runCommand` 或
  用后台 job。
- 与 Vessel 自适配一致：adapter **只采集、不判据**——success 判据仍在 scenario manifest / runner 侧。
- 080 只做 Pi 驱动 + 采集归一；Claude Code（081）各自成卡（同批模式）。

## 8. 相关

- `benchmarks/runners/src/contracts/`（076 契约 + Vessel 自适配 + 校验）
- `docs/HARNESS-ADAPTER-CONTRACT.md`（076 实现指引 §6 含 pi 接入面/采集通道）
- `docs/DSH-ADAPTER.md`（077）/ `docs/OPENCODE-ADAPTER.md`（078）/ `docs/CODEX-ADAPTER.md`（079）同批范本
- `docs/Vessel_后续开发方向与产品化路线_v1.0.md` §15 L3