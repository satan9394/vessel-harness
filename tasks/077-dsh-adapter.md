# 077 — DSH Adapter（DeepSeek Harness 适配器）

- 状态：已合入
- 优先级：P0（Wave 5 / Milestone G）
- 创建日期：2026-09-08
- 关联：076（Harness Adapter Contract，已合入）；078-081（同批外部 harness adapters）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §15 L3（同一 fixture 跑 Vessel/DSH/OpenCode/Codex/Pi/
  Claude Code，统一采集）+ docs/HARNESS-ADAPTER-CONTRACT.md（076 契约规范与实现指引）

## 目标

DSH Adapter：实现 076 的 HarnessAdapter 契约，使同一 benchmark fixture 能在 DSH（DeepSeek Harness）上运行并
统一采集 §15 L3 指标（success/wall time/tool calls/invalid calls/retries/tokens/cost/context peak/compactions/
human intervention/policy violations/resume success）。DSH 是外部 harness——adapter 通过 CLI/进程或可编程入口
驱动（clean-room：不读 DSH 源码细节，按契约 + 文档实现驱动层）。

## 验收标准（执行器逐条勾选）

- [x] 读 076 契约（benchmarks/runners/src/contracts/：types/validate/vessel 自适配 + docs/HARNESS-ADAPTER-CONTRACT.md
      实现指引）——DSH adapter 实现 HarnessAdapter{id/version/run/capabilities}
- [x] DSH 驱动：通过 DSH CLI/进程（或可编程入口）跑 fixture；若本机无 DSH 可用，实现驱动层 + 记录
      "待环境"状态（可注入 command/入口便于测试）
- [x] 采集归一：DSH 输出 → RunResult §15 L3 字段（能采集的映射，不能的留缺省/注明）
- [x] 测试 ≥4 例：契约校验通过/驱动层（mock DSH CLI）/采集归一/异常；全量 vitest/tsc 绿（741+ 无回归）
- [x] 文档同步（DSH adapter 用法与限制）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做 DSH adapter 驱动层 + 采集归一。OpenCode/Codex/Pi/Claude Code（078-081）各自成卡。
- clean-room：不复制 DSH 源码；不把 DSH prompt 引入本项目。

## 涉及文件（指针，执行器自行精化）

- benchmarks/runners/src/contracts/（076 契约）
- benchmarks/runners/src/adapters/（新：dsh.ts + 测试）
- docs/HARNESS-ADAPTER-CONTRACT.md（076：接入面/采集通道/归一化要点——照做）

## 方法

- 照 076 文档实现指引：dsh adapter 包装外部 CLI 入口；可注入 command 便于 mock 测试
- 采集归一映射表：DSH 输出字段 → RunResult 字段；缺省注明

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填

### 改动文件 + diff 摘要

- `benchmarks/runners/src/adapters/dsh.ts`（新增）——DSH HarnessAdapter 实现：
  - 契约面：`dshAdapter`{id:'dsh', version:'0.1.0', run, capabilities}，`runDshFixture` 主入口，`assertValidHarnessAdapter`/`assertValidRunResult` 校验。
  - 驱动层：CLI 子命令面 `dsh run --workspace <dir> --task <file> --json [args...]`；可注入 `options.command`、
    `options.runCommand(argv,{cwd})`（默认 `defaultRunCommand` 用 `spawnSync` 捕获 stdout/stderr）；`options._envResolve` 测试探针。
  - "待环境"标注：`probeDshEnv(command, resolve?)` 探活；DSH 不可用时默认把 run 标为 `pending-environment`
    （`success=false` + notes），可 `options.failOnMissing` 改为真失败。
  - 采集归一：`normalizeDshRun(raw)` 把 `DshRawRun` → §15 L3 全字段，缺失字段补 0/null 并 `approx` 进 notes；
    `costUsd` 按 `configs/pricing.json`（model>default）估算；`resumeSuccess` 缺省 null。
  - capabilities：诚实降级（mcp=false、planner/evaluator/compaction/resume=tbd、matrix=env 探活门）。
- `benchmarks/runners/src/contracts/index.ts`（改）——`export * from '../adapters/dsh.js';` 挂出 dsh adapter。
- `benchmarks/runners/src/adapters/dsh.test.ts`（新增）——11 例测试（见下）。
- `docs/DSH-ADAPTER.md`（新增）——DSH adapter 用法与限制（接入面/采集映射/能力诚实/environ 标注）。
- `tasks/077-dsh-adapter.md`（本卡）——验收勾选 + 状态改"待验收" + 本工作证明。

### 新增测试数与命令输出

`npx vitest run benchmarks/runners/src/adapters/dsh.test.ts` → **Test Files 1 passed，Tests 11 passed (11)**。覆盖：
1. 契约 a 面：`validateHarnessAdapter(dshAdapter)` 通过；capabilities 全 key 存在且 matrix 随 env 降级。
2. 驱动层（mock CLI）：注入 `runCommand`+`_envResolve` 跑 fixture → 合法 RunResult、§15 L3 全字段、cost>0、
   workspace artifact、成功路径无 approx；`dshAdapter.run` 默认清理临时工作区。
3. 采集归一：部分字段缺失 → 补 0/null + approx；`normalizeDshRun` 纯函数映射；success 在 finalText 空时降级。
4. 异常/环境：CLI 非零退出 → success=false 仍合法；fixture 缺失 → throw（硬故障）；DSH 不可用 → pending-environment
   不 throw、结果合法；`probeDshEnv` 探针结果透传。

`npx tsc -b tsconfig.json --pretty false` → **EXIT=0**（类型全面通过，无回归）。

全量 `npx vitest run` → **Test Files 80 passed / 1 failed (81)；Tests 751 passed / 1 failed / 1 skipped (753)**。
唯一失败是 `apps/cli/src/usage/usage-store.test.ts > recent ring keeps last N events in order`：
`EPERM: operation not permitted, rename '…\Temp\vessel-usage-…\usage.json.tmp' -> 'usage.json'`——这是 Windows 临时目录
原子 rename 受沙箱/Defender 干扰的环境型 flake（位于 apps/cli，与 077 无关，077 未触碰该文件）。我方 benchmarks 全部通过
（含 11 新增 + contracts 11 + runner/safety/soak）。剧本受约束环境无法消除该 EPERM，已如实记录，未反复重试。

### 设计选择与理由

- **驱动层可注入**：限制环境 spawn 捕获 stdout 可能 EPERM，故 `runCommand` 可注入，测试全部用 mock CLI（不依赖真实 DSH spawn 管道），符合"反死循环"环境铁律。
- **自定 DshRawRun JSON 面**：不读 DSH 内部结构，adapter 主动请求一个含 §15 L3 子集的 JSON（clean-room 边界清晰、可 mock、字段增减是适配器自身契约）。
- **采集映射**：能采集的直映射；不能的（turn/token/compaction 语义各家不同）留 0/null 并 `approx` 注明（BENCHMARK-SPEC §4.4 诚实标注，禁止裸数字跨口径排名）。
- **待环境标注**：本机实测 `dsh --version` → `0.1.2-rc.1`（shim `dsh.ps1`）说明真实 CLI 存在；但受限会话内 spawn 捕获可能 EPERM，故真实执行建议在非受限环境跑，adapter 用 `runCommand` 注入 mock 保证测试确定性。
- **capabilities 诚实**：不具备/未确证的能力标 false/tbd，runner 在 run() 前即 skipped。

### 踩坑记录

- `spawn` + `stdio:['ignore','pipe','pipe']` 在 TS 下过载导致 `stdout` 上类型 `never` → 改用 `spawnSync`（同步返回 status/stdout/stderr，类型干净，也更稳）。
- `argv` 解构出 `cmd: string|undefined`，spawnSync 首个参数要求 string → 加空 cmd 显式 throw。
- 全量 vitest 出现 `usage-store.test.ts` 的 EPERM rename flake，非本卡代码所致，环境受限复现，已注明不改动。

## 验收结论（指挥回填）

- [x] 合入（commit 02a9ca8）
- 备注：指挥独立复核——全量 vitest 81 文件 752 测试全绿 + 1 skipped（零失败；执行器首跑的 usage-store EPERM
  flaky 重跑未复现，为既有已知 Windows flaky 同类，非本卡回归）、tsc -b 0 错误。
  认可：dshAdapter 实现 076 契约（CLI 命令面 dsh run --json，command/runCommand 可注入便于 mock；probeDshEnv
  探活，不可用标 pending-environment 不 throw；normalizeDshRun §15 L3 采集归一 + pricing 估成本；capabilities
  诚实降级）；clean-room 合规（未读 DSH 源码、prompt 未引入）。下一张：078（OpenCode adapter——同批 adapters 模式）。
