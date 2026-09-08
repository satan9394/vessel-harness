# Claude Code Harness Adapter（task 081）

> 实现 076 的 HarnessAdapter 契约（`contracts/types.ts`）的 **Claude Code（外部 harness）适配器**，
> 让同一 benchmark fixture 可在 Claude Code 可自动化的 headless 面上运行并统一采集 §15 L3 指标。
> 与 077（DSH）/ 078（OpenCode）/ 079（Codex）/ 080（Pi）同批模式。状态：待验收（task 081）。
> 关联：adapters 收官；082（real-model lane）/ 083（report）/ 084（release gates）各自成卡。

## 1. 定位

- Claude Code 是外部 harness，本 adapter **不读其源码**，只通过其稳定文档化的 **headless 非交互 print 面**
  （`claude -p --output-format json`，BENCHMARK-SPEC §6.3 / HARNESS-ADAPTER-CONTRACT §6 声明的接入面）驱动
  （clean-room，prompt 不引入本项目）。
- 与 `contracts/vessel.ts`（Vessel 自适配）、`adapters/dsh.ts`（077）、`opencode.ts`（078）、`codex.ts`（079）、
  `pi.ts`（080）共用同一 `HarnessAdapter` 面（`id / version / run(fixture): Promise<RunResult> / capabilities`），
  每次返回的 `RunResult` 通过 `assertValidRunResult` 校验。
- 属于 `benchmarks/runners/src/adapters/claude.ts`，经 `contracts/index.ts` 导出
  （入口：`@vessel/bench-runners` 的 `claudeAdapter` / `runClaudeFixture`）。

## 2. 接入面

| 项目 | 值 |
|---|---|
| adapter id | `claude-code` |
| adapter version | `0.1.0` |
| CLI 命令面 | headless print：`claude -p --output-format json [args...] <task>`（`-p` = print 非交互） |
| 期望输出 | stdout 上 JSON 对象（`ClaudeRawRun`，见 `claude.ts` 类型注释），适配器经 `--output-format json` 请求 |
| 采集通道 | CLI stdout/json + 可选 transcript artifact（076 契约 §6 声明） |
| 隔离 | fixture workspace 复制到临时目录，绝不动 `benchmarks/fixtures` 原件 |
| cost | 按 `configs/pricing.json` 单价表（model > default 回退）估算 |

适配器自带的 `ClaudeRawRun` 是**本适配器主动请求的 JSON 契约**——只取 §15 L3 相关子集，不是 Claude Code 内部结构；
缺失字段由归一化器补缺省并标 `approx`。这保证了 clean-room（不窥探内部）和可 mock 测试。为可自动化的诚实边界，
`--output-format json` 得到的 per-message 转录被适配器归并为 `ClaudeRawRun` 的 L3 视图。

## 3. 用法

```ts
import { claudeAdapter, runClaudeFixture } from '@vessel/bench-runners';

const fixture = {
  id: 'B001',
  workspaceRoot: '/repo/benchmarks/fixtures/B001',
  options: {
    command: 'claude',       // 可注入 CLI 可执行名 / 全路径
    args: ['--restricted'],  // 透传给 `claude -p` 的额外参数（--restricted 为 eval harness 专供）
    configRoot: '/repo',
    model: 'claude-sonnet-4-5',
    keepWorkspace: false,    // 调试时可保留临时工作区
  },
};
const r = await claudeAdapter.run(fixture);   // 需要本机 Claude Code CLI 可用且已授权
console.log(r.metrics);                       // §15 L3 全字段
```

### 可注入点（便于测试 / 非真实 Claude Code 环境）

- `options.command`：CLI 路径，默认 `'claude'`。
- `options.runCommand(argv, {cwd}) => ResultStub`：替换 spawn 入口，测试注入 mock CLI。
- `options._envResolve`：**测试专用**环境探针，避免测试真正落盘查找 `claude` 二进制。
- `probeClaudeEnv(command, resolve?)`：返回本机 Claude Code CLI 是否可用。

## 4. 采集归一（Claude Code 输出 → §15 L3）

| RunResult 字段 | Claude Code 通道 | 缺省/口径 |
|---|---|---|
| `success` | `raw.success`（adapter 把 print 结果归一为 success）；若 `finalText` 为空则降级 false | 缺失 → false + approx |
| `wallTimeMs` | `raw.wallTimeMs`，缺失回退 `Date.now()` 差 | ≥0 |
| `toolCalls` / `invalidCalls` / `retries` | `raw.*`（transcript 计数） | 缺失 → 0 + approx |
| `inputTokens` / `outputTokens` / `cacheReadTokens` | `raw.*`（usage 汇总） | 缺失 → 0 + approx |
| `costUsd` | input/output/cache × 单价表求和 | — |
| `contextPeak` | `raw.contextPeak` | 缺失 → 0 + approx |
| `compactions` / `humanIntervention` / `policyViolations` | `raw.*` | 缺失 → 0 + approx |
| `resumeSuccess` | `raw.resumeSuccess` | 缺省 `null`（N/A） |

**口径诚实**（BENCHMARK-SPEC §4.4）：缺失字段一律记 `approx` 进 `notes`，禁止与其它 harness 的裸数字跨口径排名。
所有字段为 `number≥0` / `boolean` / `boolean|null`，`validateRunResultMetrics` 兜底。

## 5. capabilities（诚实降级）

Claude Code 在 headless print 面原生具备 `tool_calls / file_edit / exec / memory / skill / policy`
（`claude -p` 驱动完整 agentic tool loop，`--restricted` 仍可脚本化执行、禁 bypass）；`mcp` 标 `false`
（当前 print 驱动面不编排 MCP fixture）；`subagent / planner / evaluator / compaction` / `resume` 依 print
面成熟度标 `'tbd'`（Task delegation / resume / 压缩需真实会话面确认，不假填 true）；`matrix` 依赖真实 CLI
可用——本机无 Claude Code 时 `matrix=false`（runner 据此在 `run()` 前 `skipped`，不进结果集）。

## 6. 环境状态与「可自动化」边界（诚实标注）

- `probeClaudeEnv('claude')` 检测本机 Claude Code CLI（`claude --version`）。不可用时：
  - 默认把 run 标为 `pending-environment`（`success=false`、`notes` 含 `pending-environment`），仍返回**合法**
    RunResult，不 throw——供外部巡检确认环境后再跑真实执行。
  - 若 `options.failOnMissing=true`，则把不可用当作真实运行失败处理。
- **可自动化的部分**（§15 L3 如实只驱动这些）：`claude -p` headless 跑 fixture、transcript/usage 采集、
  tool/file/exec/memory/skill/policy 能力。**不可自动化的诚实边界**：交互式授权/审批会走向人类时
  （`humanIntervention` 如实计）、需要真实 Anthropic 账号与模型端点、闭源运行时的内部细节——这些
  不以假值冒充，`humanIntervention / approval` 指标与 `subagent / resume / compaction` 能力一律缺省/`tbd` 标注。
- **本机状态**：真实 Claude Code CLI 是否已安装且授权未在本任务验证（clean-room 只按文档契约声明的面驱动）；
  驱动层以可注入 `runCommand`/`_envResolve` 为主，测试不依赖真实 Claude Code 进程与凭据。

## 7. 限制

- Claude Code 源只是外部接口层，`ClaudeRawRun` 字段以适配器文档为准；其内部输出语义/CLI 旗标变化需与
  `claude -p --output-format json` 面同步核对（BENCHMARK-SPEC 行 565 待实测固化）。
- 真实 Claude Code 运行需要进程 spawn 与 Anthropic 账号鉴权；Windows 沙箱（read-only / 受限 spawn）下建议
  注入 `runCommand` 或后台 job；交互授权场景在受限环境会走向 `humanIntervention` 而非自动化。
- 与 Vessel 自适配一致：adapter **只采集、不判据**——success 判据仍在 scenario manifest / runner 侧。
- 081 只做 Claude Code 驱动 + 采集归一（adapters 收官）；real-model lane / report / release gates 各自成卡
  （082-084），本卡范围不膨胀。

## 8. 相关

- `benchmarks/runners/src/contracts/`（076 契约 + Vessel 自适配 + 校验）
- `docs/HARNESS-ADAPTER-CONTRACT.md`（076 实现指引 §6 含 claude-code 接入面/采集通道）
- `docs/DSH-ADAPTER.md`（077）/ `docs/OPENCODE-ADAPTER.md`（078）/ `docs/CODEX-ADAPTER.md`（079）/
  `docs/PI-ADAPTER.md`（080）同批范本
- `docs/Vessel_后续开发方向与产品化路线_v1.0.md` §15 L3（Claude Code「可自动化的部分」）