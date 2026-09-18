# DSH Harness Adapter（task 077）

> 实现 076 的 HarnessAdapter 契约（`contracts/types.ts`）的 **DSH（DeepSeek Harness）适配器**，
> 让同一 benchmark fixture 可在 DSH 上运行并统一采集 §15 L3 指标。
> 状态：已合入（V1.0 Milestone G，076–081 已验收；见 docs/V1.0-CHECKPOINT.md）（task 077）。

## 1. 定位

- DSH 是外部 harness，本 adapter **不读 DSH 源码**，只通过 DSH CLI 的稳定命令面驱动。
- 与 `contracts/vessel.ts`（Vessel 自适配）共用同一 `HarnessAdapter` 面
  （`id / version / run(fixture): Promise<RunResult> / capabilities`），每次返回的 `RunResult` 通过
  `assertValidRunResult` 校验。
- 属于 `benchmarks/runners/src/adapters/dsh.ts`，经 `contracts/index.ts` 导出
  （入口：`@vessel/bench-runners` 的 `dshAdapter` / `runDshFixture`）。

## 2. 接入面

| 项目 | 值 |
|---|---|
| adapter id | `dsh` |
| adapter version | `0.1.0` |
| CLI 子命令面 | `dsh run --workspace <dir> --task <taskFile> --json [args...]` |
| 期望输出 | stdout 上 JSON 对象（`DshRawRun`，见 `dsh.ts` 类型注释） |
| 隔离 | fixture workspace 复制到临时目录，绝不动 `benchmarks/fixtures` 原件 |
| cost | 按 `configs/pricing.json` 单价表（model > default 回退）估算 |

适配器自带的 `DshRawRun` 是**本适配器主动请求的 JSON 契约**——只取 §15 L3 相关子集，不是 DSH 内部
结构；缺失字段由归一化器补缺省并标 `approx`。这保证了 clean-room（不窥探 DSH 内部）和可 mock 测试。

## 3. 用法

```ts
import { dshAdapter, runDshFixture } from '@vessel/bench-runners';

const fixture = {
  id: 'B001',
  workspaceRoot: '/repo/benchmarks/fixtures/B001',
  options: {
    command: 'dsh',              // 可注入 CLI 可执行名 / 全路径
    args: ['--model', 'deepseek-chat'],
    configRoot: '/repo',
    model: 'deepseek-chat',
    keepWorkspace: false,        // 调试时可保留临时工作区
  },
};
const r = await dshAdapter.run(fixture);   // 需要本机 DSH CLI 可用
console.log(r.metrics);                     // §15 L3 全字段
```

### 可注入点（便于测试 / 非真实 DSH 环境）

- `options.command`：CLI 路径，默认 `'dsh'`。
- `options.runCommand(argv, {cwd}) => ResultStub`：替换 spawn 入口，测试注入 mock CLI。
- `options._envResolve`：**测试专用**环境探针，避免测试真正落盘查找 DSH 二进制。
- `probeDshEnv(command, resolve?)`：返回本机 DSH CLI 是否可用。

## 4. 采集归一（DSH 输出 → §15 L3）

| RunResult 字段 | DSH 通道 | 缺省/口径 |
|---|---|---|
| `success` | `raw.success`；若 `finalText` 为空则降级 false | 缺失 → false + approx |
| `wallTimeMs` | `raw.wallTimeMs`，缺失回退 `Date.now()` 差 | ≥0 |
| `toolCalls` / `invalidCalls` / `retries` | `raw.*` | 缺失 → 0 + approx |
| `inputTokens` / `outputTokens` / `cacheReadTokens` | `raw.*` | 缺失 → 0 + approx |
| `costUsd` | input/output/cache × 单价表求和 | — |
| `contextPeak` | `raw.contextPeak` | 缺失 → 0 + approx |
| `compactions` / `humanIntervention` / `policyViolations` | `raw.*` | 缺失 → 0 + approx |
| `resumeSuccess` | `raw.resumeSuccess` | 缺省 `null`（N/A） |

**口径诚实**（BENCHMARK-SPEC §4.4）：缺失字段一律记 `approx` 进 `notes`，禁止与其他 harness 的裸数字
跨口径排名。所有字段为 `number≥0` / `boolean` / `boolean|null`，`validateRunResultMetrics` 兜底。

## 5. capabilities（诚实降级）

DSH 具备 `tool_calls/file_edit/exec/subagent/memory/skill/policy` 原生能力；
`mcp` 标 `false`（当前 `run` 驱动面不暴露 MCP fixture）；`planner/evaluator/compaction/resume` 依实现成熟度标
`'tbd'`；`matrix` 依赖真实 CLI 可用——本机无 DSH 时 `matrix=false`（runner 据此在 `run()` 前 `skipped`，不进结果集）。

## 6. 环境状态与"待环境"标注

- `probeDshEnv('dsh')` 检测本机 DSH CLI（`dsh --version`）。不可用时：
  - 默认把 run 标为 `pending-environment`（`success=false`、`notes` 含 `pending-environment`），仍返回**合法** RunResult，
    不 throw——供外部巡检确认环境后再跑真实执行。
  - 若 `options.failOnMissing=true`，则把不可用当作真实运行失败处理。
- **本机实测**：`dsh --version` → `0.1.2-rc.1`（shim `dsh.ps1`），说明真实 CLI 存在；沙箱/受限会话内
  spawn 输出捕获可能 EPERM，真实执行建议在非受限环境跑。adapter 驱动层可用 `runCommand` 注入 mock，测试不依赖真实 DSH。

## 7. 限制

- DSH 源只是外部接口层，`DshRawRun` 字段以适配器文档为准；DSH 内部输出语义变化需与 `--json` 面同步。
- 真实 DSH 运行需要进程 spawn；Windows 沙箱（read-only / 受限 spawn）下建议注入 `runCommand` 或用后台 job。
- 与 Vessel 自适配一致：adapter **只采集、不判据**——success 判据仍在 scenario manifest / runner 侧。
- 077 只做 DSH 驱动 + 采集归一；OpenCode/Codex/Pi/Claude Code（078-081）各自成卡。

## 8. 相关

- `benchmarks/runners/src/contracts/`（076 契约 + Vessel 自适配 + 校验）
- `docs/HARNESS-ADAPTER-CONTRACT.md`（076 实现指引）
- `docs/Vessel_后续开发方向与产品化路线_v1.0.md` §15 L3