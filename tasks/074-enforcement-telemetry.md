# 074 — Runtime Enforcement Telemetry（安全执法遥测）

- 状态：已合入
- 优先级：P0（Wave 4 / Milestone F）
- 创建日期：2026-09-08
- 关联：071-073（sandbox/process-tree/fs-confinement 的执法事件）；049-051（事件词汇/audit 惯例）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md（V1.4 Security：runtime enforcement telemetry）

## 目标

Runtime Enforcement Telemetry：把 071-073 的安全执法（sandbox 拒绝/逃逸检测/进程树约束/fs-confinement
越界/资源上限触发）+ 既有 audit/denial（050 起 audit 记录风格）汇成可观测的遥测面——事件、计数、
最近执法记录、状态上报（sandbox backend 状态等），供 CLI/web 查询与 075 benchmark 判据复用。

## 验收标准（执行器逐条勾选）

- [x] 摸清现状：071-073 的执法事件/audit 落点（sandbox audit、process-tree audit、fs DENIED+meta.guard、
      policy audit/denial 事件）——明确遥测聚合点
- [x] Telemetry 面：执法事件聚合（类型/时间/来源模块/详情）+ 计数（按类型）+ 最近 N 条可查 +
      状态上报（sandbox backend/资源限制状态）——形状可注入可断言
- [x] 接入点：071-073 执法点发事件（或复用既有 audit 记录做投影，避免重复造）；CLI/web seam 最小可查
      （命令/端点可选，本卡聚焦数据面 + 查询 API）
- [x] 测试 ≥6 例：事件聚合/计数/最近查询/状态上报/多来源/异常；全量 vitest/tsc 绿（712+ 无回归）
- [x] 文档同步（telemetry 语义与查询）
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- 只做遥测数据面 + 查询 seam。075（safety benchmark pack 用判据复用）各自成卡。
- 不做深 UI（CLI/web 查询最小化）。

## 涉及文件（指针，执行器自行精化）

- packages/runtime/src/sandbox/（071/072 audit 落点）+ tools/filesystem（073 guard 事件）
- packages/application 或 runtime（telemetry 聚合模块；040 projections 或 audit 记录复用）
- packages/application/src/projections/（若走投影模式）

## 方法

- 读 071-073 的 audit/事件落点与 040 投影/audit 惯例；定 Telemetry 聚合（事件表/计数/状态）
- 执法点接入：直接发事件或投影复用；查询 API（list/counts/status）

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

### 改动文件与 diff 摘要

1. `packages/application/src/projections/types.ts`
   - 顶部 import 增加 `SandboxStatus`；新增任务 074 类型块：
     `EnforcementSource`（'policy'|'fs-confinement'|'process-tree'|'sandbox-status'）、`EnforcementType`（string）、
     `EnforcementEvent`（type/source/ts/detail/meta?）、`EnforcementTelemetrySnapshot`（events/counts/sources/recent(n)/status()/treeAudit()）、
     结构镜像 `ProcessTreeAuditEvent`/`ProcessTreeAuditKind`（071/072 形状，与 @vessel/runtime 结构兼容，避免应用层强耦合 runtime 特定导出）。
2. `packages/application/src/projections/EnforcementProjection.ts`（新增）
   - 040 投影模式的统一执法遥测聚合。四入口可注入可断言：
     `attach(bus)`（复用 050 `policy_decision` deny → type=`deny`, source=`policy`）、
     `foldSession(session)`（复用 Session 回放 `tool/result` 中 `error.errorClass='DENIED'`+`meta.guard` → type=guard kind, source=`fs-confinement`；同 Telemetry.finalizeRecord 复用路径）、
     `recordProcessTree(event)`（071/072 process-tree audit 注入 seam → type=`ProcessTreeAuditKind`, source=`process-tree`）、
     `reportStatus(status, limits?)`（071 sandbox backend/资源上限状态注入 → type=`report`, source=`sandbox-status`）。
   - 查询 API：`events()` / `counts()`（按 type）/ `sourceCounts()`（按来源）/ `recent(n)`（最近 N，newest-first）/
     `status()` / `treeAudit()`，以及不可变 `snapshot()`。底层字段改名（eventLog/typeCounts/sourceCountsMap）避免与公共方法名冲突。
3. `packages/application/src/projections/index.ts` — 导出 `EnforcementProjection`。
4. `packages/application/src/compose.ts` — 组合根实例化 + `attach(bus)`；`ComposedHarness` 增 `enforcement: EnforcementProjection`；`close()` 增 detach。
5. `apps/cli/src/cli.ts` — `vessel run` 尾部新增最小遥测查询 seam：`printEnforcementTelemetry()` 打印计数/来源/status/最近 3 条（数据面无深 UI）。
6. `packages/application/src/projections/projections.test.ts` — 新增 `EnforcementProjection (task 074)` describe，7 例测试。
7. `docs/EVENT-SPEC.md` — 新增 §7.3「Runtime Enforcement Telemetry（task 074 语义与查询）」：聚合点表 + EnforcementEvent 形状 + 查询 API + 注入入口。

### 新增测试数（7 例，满足 ≥6）
覆盖：政策 deny 聚合（050 复用）、按 type/多来源计数、recent(n) 最近查询、sandbox 状态上报注入、fs-confinement guard DENIED 从 session 折叠（073 复用 + 异常过滤）、多来源单快照、空聚合 + 防御性拷贝。

### 命令输出
- `npx tsc -b tsconfig.json` → exit 0（无类型错误）。
- `npx vitest run`（root 全量）→ **78 files passed，719 passed + 1 skipped（720 total）**，exit 0。基线 712(+1 skip)，净增 +7（即本次 enforcement 7 例），无回归。
  - `packages/application/src/projections/projections.test.ts (15 tests)` ✓

### 设计选择与理由
- **聚合点**：采用 `packages/application/src/projections/` 的 040 投影自检，而非新增独立事件/表。理由：执法事件的权威记录已存在（bus `policy_decision` + Session `tool/result`），投影复用避免第二套管线（任务卡明示"避免重复造"）。
- **复用 vs 新事件**：policy deny 与 fs-confinement DENIED 完全复用既有记录；仅 process-tree audit 与 sandbox status 因**不在 bus/session**（runtime 侧 append-only audit + status()）才走注入 seam `recordProcessTree`/`reportStatus`——最小接入，不改 core/AgentLoop 事件发射。
- **fs-confinement 为何从 Session 折叠**：073 的 `meta.guard`（guard 种类）只存在于 Session `tool/result` record；bus `after_tool` 载荷丢弃 `meta`，故以 Session 回放为权威（与 Telemetry.finalizeRecord 同一复用路径）。
- **查询 API**：`events/counts/sources/recent(n)/status/treeAudit` 全在 projection 上，可注入可断言，供 CLI 打印与 075 benchmark 判据复用。
- **类型解耦**：`ProcessTreeAuditEvent` 在应用层结构镜像 071/072 形状，不 import @vessel/runtime 具体导出，避免构建顺序/类型耦合。

### 踩坑记录
- 类私有字段名与公共方法同名导致 TS2300 Duplicate identifier；改名为 `eventLog`/`typeCounts`/`sourceCountsMap`。
- `ToolErrorPayload.message` 为必填，测试 mock 的 `message?` 报 TS2345；改为必填。
- `foldSession` 参数原用 `readonly SessionRecord[]` 会因 mock 缺 seq/ts 而类型不匹配；改为最小结构接口 `FoldableToolResultRecord`。
- 环境铁律：后台 bg job 跑 tsc/vitest 一次成功（无 EPERM/spawn/超时），无需受限回退。

### 验收结论（指挥回填）

- [x] 合入（commit a264193）
- 备注：指挥独立复核——全量 vitest 78 文件 719 测试全绿 + 1 skipped（零失败）、tsc -b 0 错误，与执行器自报一致。
  设计认可：EnforcementProjection（040 投影模式）统一 071-073 执法 + 050 audit 为一可查询遥测面——聚合点优先
  复用既有记录（policy deny 走 bus、fs DENIED 走 Session tool/result 折叠），process-tree audit/sandbox status
  走注入 seam（recordProcessTree/reportStatus），最小接入不改 core；查询 API（events/counts/sourceCounts/recent/
  status/treeAudit/snapshot）可注入可断言；CLI 最小查询 seam；EVENT-SPEC §7.3 语义文档。下一张：075（safety
  benchmark pack——Wave 4 收官）。
