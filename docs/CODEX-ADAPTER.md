# Codex Harness Adapter（task 079）

> 实现 076 的 HarnessAdapter 契约（`contracts/types.ts`）的 **Codex（OpenAI Codex CLI，外部 harness）适配器**，
> 让同一 benchmark fixture 可在 Codex 上运行并统一采集 §15 L3 指标。
> 与 077（DSH）/ 078（OpenCode）同批模式。状态：待验收（task 079）。
> 关联：080/081（Pi / Claude Code）各自成卡。

## 1. 定位

- Codex 是外部 harness，本 adapter **不读 Codex 源码**，只通过 Codex CLI 的稳定命令面驱动
  （clean-room，prompt 不引入本项目）。
- 与 `contracts/vessel.ts`（Vessel 自适配）、`adapters/dsh.ts`（077）、`adapters/opencode.ts`（078）共用同一
  `HarnessAdapter` 面（`id / version / run(fixture): Promise<RunResult> / capabilities`），每次返回的 `RunResult`
  通过 `assertValidRunResult` 校验。
- 属于 `benchmarks/runners/src/adapters/codex.ts`，经 `contracts/index.ts` 导出
  （入口：`@vessel/bench-runners` 的 `codexAdapter` / `runCodexFixture`）。

## 2. 接入面

| 项目 | 值 |
|---|---|
| adapter id | `codex` |
| adapter version | `0.1.0` |
| CLI 子命令面 | `codex exec -C <workspace> --skip-git-repo-check --json <task> [args...]` |
| 期望输出 | stdout 上 JSON 对象（`CodexRawRun`，见 `codex.ts` 类型注释），适配器主动经 `--json` 请求 |
| 采集通道 | rollout JSONL / sqlite thread store（076 契约 §6 声明），adapter 归一为 `CodexRawRun` |
| 隔离 | fixture workspace 复制到临时目录，绝不动 `benchmarks/fixtures` 原件 |
| cost | 按 `configs/pricing.json` 单价表（model > default 回退）估算 |

适配器自带的 `CodexRawRun` 是**本适配器主动请求的 JSON 契约**——只取 §15 L3 相关子集，不是 Codex 内部结构；
缺失字段由归一化器补缺省并标 `approx`。这保证了 clean-room（不窥探 Codex 内部）和可 mock 测试。
`codex exec -C <dir> --json` 是 Codex 官方文档化的非交互命令面（`-C/--cd` 指定工作根、`--json` 输出事件、
`--skip-git-repo-check` 允许非 git 目录运行），adapter 不在命令行之外触碰 Codex 内部。

## 3. 用法

```ts
import { codexAdapter, runCodexFixture } from '@vessel/bench-runners';

const fixture = {
  id: 'B001',
  workspaceRoot: '/repo/benchmarks/fixtures/B001',
  options: {
    command: 'codex',          // 可注入 CLI 可执行名 / 全路径
    args: ['-m', 'gpt-4o'],    // 透传给 `codex exec` 的额外参数
    configRoot: '/repo',
    model: 'gpt-4o',
    keepWorkspace: false,      // 调试时可保留临时工作区
  },
};
const r = await codexAdapter.run(fixture);   // 需要本机 Codex CLI 可用
console.log(r.metrics);                      // §15 L3 全字段
```

### 可注入点（便于测试 / 非真实 Codex 环境）

- `options.command`：CLI 路径，默认 `'codex'`。
- `options.runCommand(argv, {cwd}) => ResultStub`：替换 spawn 入口，测试注入 mock CLI。
- `options._envResolve`：**测试专用**环境探针，避免测试真正落盘查找 Codex 二进制。
- `probeCodexEnv(command, resolve?)`：返回本机 Codex CLI 是否可用。

## 4. 采集归一（Codex 输出 → §15 L3）

| RunResult 字段 | Codex 通道 | 缺省/口径 |
|---|---|---|
| `success` | `raw.success`（adapter 把 Codex session 结果归一为 success）；若 `finalText` 为空则降级 false | 缺失 → false + approx |
| `wallTimeMs` | `raw.wallTimeMs`，缺失回退 `Date.now()` 差 | ≥0 |
| `toolCalls` / `invalidCalls` / `retries` | `raw.*` | 缺失 → 0 + approx |
| `inputTokens` / `outputTokens` / `cacheReadTokens` | `raw.*`（rollout usage） | 缺失 → 0 + approx |
| `costUsd` | input/output/cache × 单价表求和 | — |
| `contextPeak` | `raw.contextPeak` | 缺失 → 0 + approx |
| `compactions` / `humanIntervention` / `policyViolations` | `raw.*` | 缺失 → 0 + approx |
| `resumeSuccess` | `raw.resumeSuccess` | 缺省 `null`（N/A） |

**口径诚实**（BENCHMARK-SPEC §4.4）：缺失字段一律记 `approx` 进 `notes`，禁止与其他 harness 的裸数字
跨口径排名。所有字段为 `number≥0` / `boolean` / `boolean|null`，`validateRunResultMetrics` 兜底。

## 5. capabilities（诚实降级）

Codex 具备 `tool_calls/file_edit/exec/memory/policy` 原生能力（`exec` 面驱动 tool calling）；
`mcp` 标 `false`（当前 exec/--json 驱动面不编排 MCP fixture）；`subagent/skill` 依 run 面成熟度标 `'tbd'`
（Codex 有 delegation 但本 exec 面无稳定 subagent fixture）；`planner/evaluator/resume/compaction` 依实现
成熟度标 `'tbd'`；`matrix` 依赖真实 CLI 可用——本机无 Codex 时 `matrix=false`（runner 据此在 `run()` 前
`skipped`，不进结果集）。

## 6. 环境状态与"待环境"标注

- `probeCodexEnv('codex')` 检测本机 Codex CLI（`codex --version`）。不可用时：
  - 默认把 run 标为 `pending-environment`（`success=false`、`notes` 含 `pending-environment`），仍返回**合法**
    RunResult，不 throw——供外部巡检确认环境后再跑真实执行。
  - 若 `options.failOnMissing=true`，则把不可用当作真实运行失败处理。
- **本机实测**：`codex --version` → `codex-cli 0.153.4`（`codex exec --help` 确认 `-C/--json/--skip-git-repo-check`
  面存在），说明真实 CLI 存在；但真实执行需要模型鉴权，adapter 驱动层仍以可注入 `runCommand`/`_envResolve` 为主，
  测试不依赖真实 Codex 进程与凭据。

## 7. 限制

- Codex 源只是外部接口层，`CodexRawRun` 字段以适配器文档为准；Codex 内部输出语义变化需与 `--json` 面同步。
- 真实 Codex 运行需要进程 spawn 与模型鉴权；Windows 沙箱（read-only / 受限 spawn）下建议注入 `runCommand` 或
  用后台 job。
- 与 Vessel 自适配一致：adapter **只采集、不判据**——success 判据仍在 scenario manifest / runner 侧。
- 079 只做 Codex 驱动 + 采集归一；Pi / Claude Code（080/081）各自成卡（同批模式）。

## 8. 相关

- `benchmarks/runners/src/contracts/`（076 契约 + Vessel 自适配 + 校验）
- `docs/HARNESS-ADAPTER-CONTRACT.md`（076 实现指引 §6 含 codex 接入面/采集通道）
- `docs/DSH-ADAPTER.md`（077）/ `docs/OPENCODE-ADAPTER.md`（078）同批范本
- `docs/Vessel_后续开发方向与产品化路线_v1.0.md` §15 L3