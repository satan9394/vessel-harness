# 078 — OpenCode Adapter（外部 harness 适配器）

- 状态：待验收
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076（Harness Adapter Contract）；077（DSH adapter——同批模式范本）；079-081（Codex/Pi/Claude Code adapters）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15 L3 + docs/HARNESS-ADAPTER-CONTRACT.md（076 实现指引）
  + docs/DSH-ADAPTER.md（077 同批范本）

## 目标

OpenCode Adapter：实现 076 契约，使同一 benchmark fixture 能在 OpenCode CLI 上运行并统一采集 §15 L3 指标。
与 077 同批模式：CLI 命令面驱动 + 可注入 command/入口便于 mock + 采集归一 + 环境探活（pending-environment
标注不 throw）+ capabilities 诚实降级。clean-room：不读 OpenCode 源码、prompt 不引入。

## 验收标准（执行器逐条勾选）

- [ ] 读 076 契约（contracts/：types/validate）与 077 范本（adapters/dsh.ts + docs/DSH-ADAPTER.md）——
      OpenCode adapter 对齐同模式
- [ ] OpenCode 驱动：CLI 命令面（opencode run 或等价——以 077 模式定）跑 fixture；command/runCommand 可注入
      便于 mock；本机无 OpenCode 则驱动层 + "待环境"标注
- [ ] 采集归一：OpenCode 输出 → RunResult §15 L3 字段（能采集的映射，不能的缺省/注明）
- [ ] 测试 ≥4 例：契约校验/驱动层（mock CLI）/采集归一/异常；全量 vitest/tsc 绿（752+ 无回归）
- [ ] 文档同步（OpenCode adapter 用法与限制）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 OpenCode adapter。Codex/Pi/Claude Code（079-081）各自成卡（同批模式）。clean-room。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/adapters/（077 dsh.ts 范本 + 本卡 opencode.ts + 测试）
- benchmarks/runners/src/contracts/index.ts（挂出 adapter）
- docs/（OpenCode adapter 文档）

## 方法

- 照 077 dsh adapter 模式：opencodeAdapter{id/version/run/capabilities} + runOpenCodeFixture + 采集归一映射表

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 改动文件

| 文件 | 变更 |
|---|---|
| `benchmarks/runners/src/adapters/opencode.ts` | **新增**。OpenCode HarnessAdapter，完全照 077 dsh.ts 模式：`opencodeAdapter{id/version/run/capabilities}` + `runOpencodeFixture` + `normalizeOpencodeRun` + `probeOpencodeEnv` + `opencodeCapabilities`；CLI 命令面 `opencode run --workspace <dir> --task <taskFile> --json [args...]`；`command`/`runCommand` 可注入；`_envResolve` 测试探针；pending-environment 不 throw；成本按 pricing.json 估算。 |
| `benchmarks/runners/src/adapters/opencode.test.ts` | **新增**。11 个用例：契约 a 面（validateHarnessAdapter/capabilities）/驱动层 mock CLI/采集归一/异常。 |
| `benchmarks/runners/src/contracts/index.ts` | 挂出 opencode adapter（显式 re-export，避开与 dsh.js 共享的 `ResultStub`/`defaultRunCommand` 歧义）。 |
| `docs/OPENCODE-ADAPTER.md` | **新增**。OpenCode adapter 用法、接入面、采集归一表、capabilities、待环境标注、限制。 |
| `tasks/078-opencode-adapter.md` | 本卡工作证明回填 + 状态改"待验收"。 |

### 测试结果（root 全量 vitest + tsc）

- `npx tsc -b tsconfig.json`：**通过**（无输出）。
- `npx vitest run`（root 全量）：**81 passed / 1 failed / 1 skipped**，762 passed。
  - opencode.test.ts：**11/11 通过**。
  - 唯一失败：`packages/runtime/src/sandbox/backend/process-tree.test.ts`"attaches a pre-spawned grandchild into the job and enumerates it"在**整量并行跑**下 30000ms 超时；隔离单独跑该用例如期通过（10759ms）——已知时序敏感 flaky 测试（task 072，Windows job-object 枚举，与本卡无关），非本次回归。

### 设计选择与理由

1. **驱动面**：采用 `opencode run --workspace <dir> --task <taskFile> --json`（与 077 同款命令面），定义**本适配器主动请求的 `OpencodeRawRun` JSON 契约**（只取 §15 L3 子集），而非窥探 OpenCode 内部——满足 clean-room 且可 mock。`command`/`runCommand` 可注入，spawn 只出现在 `defaultRunCommand` 一处，测试注入 mock 不碰真实二进制。
2. **采集归一**：能采集的字段直映 RunResult；缺失字段补缺省（0 / null）并在 `notes` 标 `approx`（BENCHMARK-SPEC §4.4 诚实标注，禁止跨 harness 裸数字排名）。`success` 报告 true 但 `finalText` 为空则降级 false。
3. **待环境**：`probeOpencodeEnv` 检测本机 `opencode --version`；不可用时 run 标 `pending-environment`（success=false、notes 含标记）仍返回**合法** RunResult 不 throw；`options.failOnMissing` 可改为真实失败。本机未预装 OpenCode，真实执行需在非受限环境装好 `opencode` 后跑。
4. **capabilities 诚实降级**：`tool_calls/file_edit/exec/memory/policy=true`；`mcp=false`（run 面不暴露 MCP fixture）；`subagent/skill/planner/evaluator/resume/compaction='tbd'`；`matrix=envAvailable`（无 CLI 时 false，runner 前置 skip）。
5. **隔离铁律**：fixture workspace 复制到临时目录，绝不动 `benchmarks/fixtures` 原件；`adapter.run` 默认清理临时目录。
6. **导出**：`contracts/index.ts` 显式 re-export opencode 专属符号，避开与 dsh.js 共享 `ResultStub`/`defaultRunCommand` 的 TS `export *` 歧义（错误 TS2308）。

### 踩坑记录

- `export * from '../adapters/dsh.js'` 已导出 `ResultStub`/`defaultRunCommand`，openccode.ts 再 `export *` 触发 TS2308（同名重复导出歧义）。改为在 index.ts 对 opencode 做显式 re-export（跳过两个共享名，其定义与 dsh.js 完全一致）。
- 整量 vitest 下 task 072 的 process-tree timing 测试会 30000ms 超时（时序敏感 + 并行负载），隔离跑则通过——判定为 flaky，非本卡回归。
- 删除纪律遵循：本卡测试临时目录 `fs.rmSync(tmpRoot)` 仅删**测试自建 temp**（回收站纪律针对项目内永久资源；测试 temp 由 OS/测试生命周期管理，沿袭既有 dsh.test.ts 用法）。adapter 本身无任何永久删除。

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
