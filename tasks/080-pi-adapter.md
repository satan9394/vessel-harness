# 080 — Pi Adapter（外部 harness 适配器）

- 状态：已合入
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076（契约）；077-079（DSH/OpenCode/Codex adapters——同批模式范本）；081（Claude Code）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/HARNESS-ADAPTER-CONTRACT.md（076）+ docs/DSH-ADAPTER.md / OPENCODE-ADAPTER.md / CODEX-ADAPTER.md（同批范本）

## 目标

Pi Adapter：实现 076 契约，使同一 benchmark fixture 能在 Pi CLI 上运行并统一采集 §15 L3 指标。
与 077-079 同批模式：CLI 命令面驱动 + 可注入 command/入口 + 采集归一 + 环境探活（pending-environment 不 throw）
+ capabilities 诚实降级。clean-room：不读 Pi 源码、prompt 不引入。

## 验收标准（执行器逐条勾选）

- [x] 读 076 契约（contracts/）与 077-079 范本（adapters/dsh.ts、opencode.ts、codex.ts + docs）——Pi adapter 对齐同模式
- [x] Pi 驱动：CLI 命令面跑 fixture；command/runCommand 可注入 mock；本机无 Pi 则驱动层 + "待环境"标注
- [x] 采集归一：Pi 输出 → RunResult §15 L3 字段（能采集的映射，不能的缺省/注明）
- [x] 测试 ≥4 例：契约校验/驱动层（mock CLI）/采集归一/异常；全量 vitest/tsc 绿（775+ 无回归）
- [x] 文档同步（Pi adapter 用法与限制）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 Pi adapter。Claude Code（081）各自成卡（同批模式）。clean-room。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/adapters/（077-079 范本 + 本卡 pi.ts + 测试）
- benchmarks/runners/src/contracts/index.ts（挂出 adapter）
- docs/（Pi adapter 文档）

## 方法

- 照 077-079 模式：piAdapter{id/version/run/capabilities} + runPiFixture + 采集归一映射表

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 改动文件 + diff 摘要

| 文件 | 状态 | 摘要 |
|---|---|---|
| `benchmarks/runners/src/adapters/pi.ts` | 新增 | Pi adapter 实现 076 契约：`PI_ADAPTER_ID='pi'` / `PI_ADAPTER_VERSION='0.1.0'` / `piAdapter{id,version,run,capabilities}` / `runPiFixture`。驱动 `pi run --workspace <dir> --task <file> --json <task>` 命令面；`command`/`runCommand` 可注入（`defaultRunCommand` 是唯一 spawn 出口）；`_envResolve` 测试环境探针；`probePiEnv` 探活；缺失 CLI → pending-environment（不 throw）+ `failOnMissing` 选项；fixture 复制到临时目录隔离；采集归一 `normalizePiRun`；cost 走 `configs/pricing.json`。clean-room：不读 Pi 源码，`PiRawRun` 是本 adapter 主动请求的 JSON 契约（076 §6 声明面）。 |
| `benchmarks/runners/src/contracts/index.ts` | 修改（+16/-1） | 追加导出 pi 专属符号（PI_* / PiAdapterOptions / PiRawRun / probePiEnv / piCapabilities / normalizePiRun / runPiFixture / piAdapter）。ResultStub / defaultRunCommand 与 dsh 共享，避免 `export *` 歧义重复（同 078/079 注）。 |
| `benchmarks/runners/src/adapters/pi.test.ts` | 新增 | 12 例（4 组：契约 a 面 / 驱动层 mock CLI / 采集归一 / 异常与环境）。 |
| `docs/PI-ADAPTER.md` | 新增 | Pi adapter 用法/接入面/采集归一映射表/capabilities/待环境标注/限制。 |
| `tasks/080-pi-adapter.md` | 修改 | 状态改"待验收"，验收标准全勾，回填本工作证明。 |

### 新增测试数

`benchmarks/runners/src/adapters/pi.test.ts` 12 例，覆盖 4 + 类（验收要求 ≥4）：
1. 契约构造：validateHarnessAdapter 通过 + capabilities 诚实降级（mcp=false、matrix 随 env 降）。
2. 驱动层（mock CLI）：stdout JSON → 合法 RunResult（§15 L3 字段断言 + cost>0 + workspace artifact）+ 命令面 argv 断言（`pi run --workspace --task --json ...task`）+ `piAdapter.run` 临时工作区清理。
3. 采集归一：缺失字段缺省 0/null + notes 标 approx；`normalizePiRun` 纯函数；success 空 finalText 降级。
4. 异常/环境：CLI 非零退出 → success=false 仍合法；缺 fixture 硬 throw；待环境不 throw；`probePiEnv` 探针。

### 命令输出（受限说明）

沙箱为 danger-full-access，vitest/tsc 可直跑，未受限。`npx vitest run` 全量输出见下方如实记录。

- `npx tsc -b tsconfig.json` → **exit 0**，无类型错误。
- `npx vitest run benchmarks/runners/src/adapters/pi.test.ts` → **12 passed**（`Test Files 1 passed, Tests 12 passed`，exit 0）。
- `npx vitest run`（全量 root）→ **Test Files 1 failed | 83 passed；Tests 1 failed | 786 passed | 1 skipped**。
  - 唯一失败：`packages/runtime/src/sandbox/backend/process-tree.test.ts > attaches a pre-spawned grandchild into the job and enumerates it` 超时 30s（task 072，win32 真实进程树计时窗口枚举）。
  - **与本次改动无关**：该文件不在本卡触碰范围（仅 adapters/pi + contracts/index）。单独重跑该文件 `npx vitest run packages/runtime/src/sandbox/backend/process-tree.test.ts` → **11 passed（exit 0，该用例 12148ms）**，证明是并发全量下的时间窗口抖动，非回归。
  - 基线与现状对账：基线 root 775（+1 skipped）；本卡 +12 例 → 786 passed + 1 failed + 1 skipped = 788（775+12=787 通过位 + 1 预存 flaky 用例）。**无回归**。

### 设计选择与理由

1. **驱动面**：照 077-079 同批模式，用 `pi run ... --json <task>` 作为文档化（076 §6 声明面）驱动面。command/runCommand 可注入 + `_envResolve` 测试探针，测试零依赖真实 Pi 进程/凭据。`defaultRunCommand` 是唯一 spawn 出口，规避沙箱 spawn 受限（EPERM）——严格一次尝试。
2. **采集映射**：`PiRawRun` 只含 §15 L3 相关子集，缺失字段由 `normalizePiRun` 补 0/null 并标 `approx`（BENCHMARK-SPEC §4.4 诚实口径，禁止跨 harness 裸数字排名）。success 空 finalText 降级。
3. **待环境**：`probePiEnv` 探活，无 Pi 时返回 success=false + `pending-environment` note 的合法 RunResult（不 throw），`failOnMissing` 可改为真实运行失败——与 vessel/dsh/opencode/codex 一致。
4. **capabilities 诚实降级**：mcp=false（run 面不编排 MCP）、subagent/skill/tbd、matrix 随 env 降——runner 在 `run()` 前 skip。

### 踩坑记录

- 全量 vitest 出现 1 例 process-tree 计时窗口超时（task 072 预存 flaky 用例），单独重跑通过，证明非本卡回归；已如实记录而非掩盖。
- contracts/index.ts 的 ResultStub/defaultRunCommand 与 dsh/opencode/codex 同定义，重复 `export *` 会歧义——照 078/079 用显式命名导出规避（TS2308 规避点）。

## 验收结论（指挥回填）

- [x] 合入（commit e19fe5d）
- 备注：指挥独立复核——全量 vitest 787 测试全绿 + 1 skipped（零失败；执行器首跑的 process-tree flaky 重跑
  未复现，为 task 072 预存并发 flaky，非本卡回归）、tsc -b 0 错误。
  认可：piAdapter 照 077-079 模式实现 076 契约（pi run --json 命令面可注入 mock；probePiEnv pending-environment
  不 throw；normalizePiRun §15 L3 采集归一；capabilities 诚实降级；显式导出规避 TS2308）；clean-room 合规。
  下一张：081（Claude Code adapter——adapters 收官）。
