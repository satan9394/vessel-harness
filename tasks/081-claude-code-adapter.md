# 081 — Claude Code Adapter（外部 harness 适配器）

- 状态：已合入
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076（契约）；077-080（DSH/OpenCode/Codex/Pi adapters——同批模式范本）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/HARNESS-ADAPTER-CONTRACT.md（076）+ docs/DSH-ADAPTER.md / OPENCODE-ADAPTER.md / CODEX-ADAPTER.md
  / PI-ADAPTER.md（同批范本）

## 目标

Claude Code Adapter：实现 076 契约，使同一 benchmark fixture 能在 Claude Code CLI（可自动化的部分，§15）
上运行并统一采集 §15 L3 指标。与 077-080 同批模式：CLI 命令面驱动 + 可注入 command/入口 + 采集归一 +
环境探活（pending-environment 不 throw）+ capabilities 诚实降级。clean-room：不读 Claude Code 源码、
prompt 不引入。Claude Code 交互式/授权限制照 §15 "可自动化的部分"诚实标注。

## 验收标准（执行器逐条勾选）

- [x] 读 076 契约（contracts/）与 077-080 范本（adapters/dsh.ts、opencode.ts、codex.ts、pi.ts + docs）——
      Claude Code adapter 对齐同模式
- [x] Claude Code 驱动：CLI 命令面（claude -p/print 或等价 headless 面——以 077-080 模式定）跑 fixture；
      command/runCommand 可注入 mock；本机无 Claude Code 或需交互/授权则驱动层 + "待环境/受限"标注
- [x] 采集归一：Claude Code 输出 → RunResult §15 L3 字段（能采集的映射，不能的缺省/注明）
- [x] 测试 ≥4 例：契约校验/驱动层（mock CLI）/采集归一/异常；全量 vitest/tsc 绿（787+ 无回归）
- [x] 文档同步（Claude Code adapter 用法与限制——含"可自动化部分"边界）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Claude Code adapter（adapters 收官）。082-084（real-model lane/report/release gates）各自成卡。clean-room。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/adapters/（077-080 范本 + 本卡 claude.ts + 测试）
- benchmarks/runners/src/contracts/index.ts（挂出 adapter）
- docs/（Claude Code adapter 文档）

## 方法

- 照 077-080 模式：claudeAdapter{id/version/run/capabilities} + runClaudeFixture + 采集归一映射表

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 已回填。执行器：隔离子代理（DSH）。日期：2026-09-08。

### 改动文件 + diff 摘要

- **新增 `benchmarks/runners/src/adapters/claude.ts`**：Claude Code adapter（任务 081），对齐 077-080 模式。
  - `CLAUDE_ADAPTER_ID='claude-code'` / `CLAUDE_ADAPTER_VERSION='0.1.0'`；
  - `CLAUDE_PRINT_FLAG='-p'`：命令面 `claude -p --output-format json [args...] <task>`（headless print，
    BENCHMARK-SPEC §6.3 / HARNESS-ADAPTER-CONTRACT §6 接入面）；
  - `ClaudeAdapterOptions`：`command/args/runCommand/configRoot/model/keepWorkspace/failOnMissing/_envResolve`
    （可注入，同 077-080）；
  - `ClaudeRawRun`：适配器主动经 `--output-format json` 请求的 L3 子集接口（clean-room，非内部结构）；
  - `defaultRunCommand`（spawn，唯一外部进程接触点）、`probeClaudeEnv`（`claude --version`，可注入 resolve）、
    `claudeCapabilities(envAvailable)`（诚实降级：tool/file/exec/memory/skill/policy=true，mcp=false，
    subagent/planner/evaluator/compaction/resume=tbd，matrix 依赖 env）；
  - `normalizeClaudeRun`（缺失字段 0/null + `approx` 标注）、`runClaudeFixture`（驱动 + 归一 + fail-loud throw +
    运行期失败返回 success=false 合法 RunResult）、`claudeAdapter`（开箱即 `assertValidHarnessAdapter`、
    跑完整建 workspace + 清理）。
- **新增 `benchmarks/runners/src/adapters/claude.test.ts`**：12 例（4 个 describe 块：a 面契约校验 2 /
  驱动层 mock CLI 3 / 采集归一 3 / 异常与环境处理 4），mock CLI + `_envResolve` 注入，不触碰真实 claude 进程。
- **修改 `benchmarks/runners/src/contracts/index.ts`**：追加导出 claude-code 专属符号（18 项
  id/version/print/options/raw/probe/capabilities/normalize/run/adapter），避免与 dsh 共享的
  `ResultStub/defaultRunCommand` 在 `export *` 重复。
- **新增 `docs/CLAUDE-CODE-ADAPTER.md`**：用法/采集归一表/capabilities/「可自动化」边界/限制/相关，同 077-080 文档体例。

### 新增测试数与命令输出

- 新增 `claude.test.ts` **12 例**。
- 全量 `npx vitest run`（root，后台 job）：**Test Files 85 passed (85)；Tests 799 passed | 1 skipped (800)；Duration 46.65s；VITEST_EXIT=0**。
  （基线 787+1 skipped，新增 12 例后 799+1 skipped，无回归；`claude.test.ts (12 tests)` 全绿。）
- 类型 `npx tsc -b tsconfig.json`：**exit 0，无类型错误**。

### 设计选择与理由

1. **驱动面取 `claude -p --output-format json`**：这是 Claude Code 文档化的 headless 非交互面
   （BENCHMARK-SPEC §6.3 行 565 / HARNESS-ADAPTER-CONTRACT §6 行 126 声明）。`-p` 即 print 单发非交互，
   适合 fixture 跑批；`--output-format json` 让适配器主动请求结构化 stdout 归一为 `ClaudeRawRun`，
   与 080 Pi 的 `--json`、079 Codex 的 `--json` 同构，clean-room 且可 mock。
2. **可注入 `command/runCommand/_envResolve`**：测试注入 mock CLI + env 探针，本机无需真实 claude 二进制/凭据
   （077-080 已验证该模式，规避沙箱 spawn 受限）。
3. **采集归一**：能映射的 L3 字段（success/wall/tool/tokens/cost/context/…）从 `ClaudeRawRun` 取；
   不能的（`humanIntervention/approval` 具体值、`resumeSuccess`、内部 compaction）缺省 0/null 并标 `approx`。
4. **「可自动化」诚实边界**：只声明/驱动 `claude -p` headless 能做的（tool/file/exec/memory/skill/policy）；
   交互式授权/审批、真实账号、闭源内部、subagent mcp 编排不假填（`mcp=false`、`humanIntervention` 缺省）。
5. **pending-environment 不 throw**：`probeClaudeEnv` 为假时 run 标 `pending-environment`（success=false、
   notes 标注）返回合法 RunResult，供外部确认环境后再跑；`failOnMissing` 可改真实失败语义。
6. **单入口导出一致性**：因 `ResultStub/defaultRunCommand` 与 dsh 共享定义，`contracts/index.ts` 用命名单导入
   而非 `export *`（与 opencode/codex/pi 一致，避免 eponymous duplicate）。

### 踩坑记录

- 无 EPERM/spawn 阻断（测试全部走 mock CLI + `_envResolve`，未 spawn 真实外部进程）。驱动只经 `defaultRunCommand`
  一次 spawn 点且被测试覆盖。
- `contracts/index.ts` 的 `export *` 会因 `ResultStub/defaultRunCommand` 与 dsh.js 重复定义而歧义；
  与 078-080 相同，用命名单导入规避。
- 全量 vitest 在受限会话以后台 job 跑（esbuild spawn 可能受限），真实计数以 job 输出核定。

## 验收结论（指挥回填）

- [x] 合入（commit 4a00381）
- 备注：指挥独立复核——全量 vitest 85 文件 799 测试全绿 + 1 skipped（零失败）、tsc -b 0 错误，与执行器自报一致。
  认可：claudeAdapter 照 077-080 模式实现 076 契约（claude -p --output-format json headless 面，contract §6 声明；
  command/runCommand 可注入 mock；probeClaudeEnv pending-environment 不 throw；normalizeClaudeRun §15 L3 采集归一；
  capabilities 诚实降级含"可自动化部分"边界；命名单导出规避 TS2308）；clean-room 合规。
  **adapters 收官（077-081 全部完成）**。下一张：082（real-model benchmark lane——需真实模型 API）。
