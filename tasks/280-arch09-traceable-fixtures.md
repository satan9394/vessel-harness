# 任务卡 280: ARCH-09 的可追溯 fixture 矩阵与全量门禁收口

**状态**: 已完成（三份证据实测通过；跨 harness live 证据归 ARCH-04，需用户授权）
**创建时间**: 2026-10-23
**执行者**: OpenCode（协调者自己验证）
**协调者**: OpenCode

---

## 1. 背景

评审矩阵把 ARCH-09 记为「部分实现」，缺的是**可追溯性**，不是功能：

> 未找到满足规范矩阵的回溯（启动成功、任务删除、adapter 不存在、未知写入不重放、协议），
> 统一 10–20 场景可追溯黄金 fixture 的当前达成；当前 Web 单测图 exit 1。

三件事现在都变了，需要重新取一次证据，而不是继续沿用旧结论：

1. 卡 274 已交付 `npm run bench:reliability`：**14 个 fixture / 7 个类别**
   （retry、crash、soft-delete、adapter-unavailable、unknown-tool、event-replay、capability-negotiation），
   每个 fixture 指向一个具体测试文件与标题——这正是规范要的「10–20 场景可追溯」。
2. 「Web 单测图 exit 1」是当时的现场；当前 `test:web` 全绿（57 文件 / 488 通过）。
3. 全量门禁由协调者执行（`npm run test:all` 两个 root），不再受「用户禁止 test:all」约束。

## 2. Goal

用当前代码重新生产这三类证据，并把 ARCH-09 的剩余缺口如实收敛或标注。

## 3. Acceptance Criteria

1. `npm run bench:reliability` 在当前 HEAD 上 exit 0，输出 14 fixture / 7 类别的实测结果（落盘日志）。
2. `npm run bench:conformance`（离线车道）exit 0，记录场景数与通过数。
3. `npm run test:all` 两个 root 的实测数字落盘，且在最后一次编辑之后。
4. 复核 14 个 fixture 指向的测试文件**真实存在且仍在跑**（不是陈旧指针）。
5. 在卡里给出「规范要求 → 当前证据」的逐项对照，明确哪些条目仍未闭环及其原因。

## 4. Not Doing

- 不新增 fixture 充数；缺什么就如实写缺。
- 不动 ARCH-04（需要用户授权调用本机其他 CLI）与 ARCH-07（安全口径取舍，需用户拍板）。
- 不重写 benchmark 规范文档。

## 5. Blast Radius

只读验证 + `tasks/README.md` 与评审报告的状态行；不改产品代码（除非证据显示 fixture 指针失效）。

## 6. Result

三份证据都已重新生产，全部 exit 0，日志落 `evidence/sessions/`：

| 命令 | 结果 | 日志 |
|---|---|---|
| `npm run bench:reliability` | 14/14 通过，7 类别 | `2026-10-23-card280-reliability.log`（manifest 在 `evidence/sessions/task274-reliability-*/`） |
| `npm run bench:conformance`（离线车道） | 25 fixture × 1 adapter（vessel），25 runs / 25 passed / 0 failed / 100% | `2026-10-23-card280-conformance.log` |
| `npm run test:all` | 根 304 文件 / 3197 通过 + 6 跳过；web 57 文件 / 488 通过 | `2026-10-23-final-278-279-test-all.log` |

fixture 分布（manifest 实测）：`crash 4`（四点进程崩溃）、`soft-delete 3`、`adapter-unavailable 2`、
`capability-negotiation 2`、`retry 1`、`unknown-tool 1`、`event-replay 1`。

### 规范要求 → 当前证据

| 规范要求 | 证据 | 判定 |
|---|---|---|
| 启动成功 | conformance 25 runs 全过（含 B/S 两组）；`test:all` 全绿 | 已覆盖 |
| 任务删除 | R06/R07/R08（`apps/local-server/src/server.test.ts`：回收后确认、失败保留可重试、回滚修复索引） | 已覆盖 |
| adapter 不存在 | R09/R10（`benchmarks/runners/src/adapters/codex.test.ts`：CLI 缺失标 pending-environment 不抛；非零退出仍是合法 RunResult） | 已覆盖 |
| 未知写入不重放 | R02–R05（`packages/application/src/session/effect-recovery.test.ts` 四点崩溃 + 显式 reconcile）；`fault-injection-gate.test.ts` 保持 | 已覆盖 |
| 协议/能力协商 | R13/R14（`packages/llm/src/capabilities.test.ts`：强制未知能力需证据；禁止静默回退到别的模型） | 已覆盖 |
| 统一 10–20 场景可追溯 fixture | 14 个 fixture，每个带 `id/category/source/title`；7 个 source 文件**逐个 Test-Path 复核存在**（`AgentLoop.llm-retry-record`、`effect-recovery`、`server`、`codex` 适配器、`mcp`、`projections`、`capabilities`） | 已覆盖 |
| 全量 root 门禁 | 见上表 `test:all` 两行 | 已覆盖 |
| Web 单测图之前 exit 1 | 当前 57 文件 / 488 通过 | 已消除 |

### DOD-GATES 附注

评审矩阵里 `DOD-GATES` 记为「部分实现」，理由写的是「用户禁止 test:all，不签完整 root 全量」。
这条限制在本轮已解除，实测数字见上表——该行的阻塞原因不再成立，可按「已满足」重读。
`DOD-SAFETY` 仍受 ARCH-07（POSIX 降级口径）制约，见卡 281。

### 如实标注的边界

- **reliability 是「fixture → 既有测试」的可追溯映射，不是另写一套场景脚本**：它复跑的就是上表那批测试，
  好处是永不与真实用例漂移，代价是新增场景必须先有对应用例。
- **live lane 未跑**：conformance 只跑了离线车道（vessel 自适配器）。真实外部 harness
  （Codex/Claude Code/OpenCode）要求逐次用户授权，见 ARCH-04 的边界，不在本卡范围。
- ARCH-09 的「可追溯 + 全量门禁」到本卡为止闭环；「跨 harness live 证据」仍归 ARCH-04。
