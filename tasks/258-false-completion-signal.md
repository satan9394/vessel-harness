# 任务卡 258: 消除虚假完成信号（ARCH-01 / UI-02 的 P0）

**状态**: 已验收（2026-10-26 对账；协调者独立复核段在卡内，八态投影用例在树且全绿，依据见 [卡 340](340-board-backlog-closeout.md)）
**创建时间**: 2026-10-22
**执行者**: Codex (`gpt-6.1-sol`, medium)
**协调者**: OpenCode

---

## 1. Goal (目标)

Activity 里**只有真实的成功终态才显示为完成**。凡是没有证据表明执行成功的实体（引导态、拒绝、取消、idle、未知状态），一律不得映射成 `completed`。

审计已给出可复现路径（`evidence/sessions/2026-10-22-doc-conformance-report.md` 的 ARCH-01 / UI-02）：

- `apps/local-server/src/routes/activityRoutes.ts:139` 一带：team / live / 未知事件 / unknown 分支的兜底。
- `activityRoutes.ts:183`：team 阶段把 `approved` / `rejected` 映射成什么？`cancelled` 是否被当成完成？缺 `failed`。
- `activityRoutes.ts:188`：idle 的 subagent 是否被判完成。
- `apps/local-server/src/server.ts:380`：取「最近一条 turn/start/end」的方式是否会跨回合误判。
- `packages/application/src/ExecutionLoop.ts:43`：恢复路径对未完成回合的处理。

复现探针（原样可跑，审计已跑过一次）：

```
node --import tsx -e 'import {ActivityRoutes} from "./apps/local-server/src/routes/activityRoutes.ts"; const r=new ActivityRoutes({sessions:async()=>[],live:()=>undefined,approvals:()=>[],subagents:async()=>[{id:"idle",name:"idle",status:"idle",startedAt:"2026-10-22T00:00:00Z"}],teamStages:()=>[{id:"approved",status:"approved",createdAt:1},{id:"rejected",status:"rejected",createdAt:2},{id:"cancelled",status:"finished",createdAt:3,tasks:[{status:"cancelled"}]}],goalTasks:()=>[]}); console.log(JSON.stringify((await r.list()).runs));'
```

当前输出：`idle-probe / approved-probe / rejected-probe / cancelled-probe` **全部 completed**。

## 2. Not Doing (非目标)

- 不改 Activity 的视觉布局，不加新页面/新标签。
- 不改 `packages/core` 的回合状态机语义；只修投影与映射层。
- 不为通过而把未知状态一律改成 failed（未知应当是「未知/排队」，不是失败）。
- 不 commit、不 push、不删除文件。

## 3. Acceptance Criteria (验收标准)

1. 上条探针里：`idle` 的 subagent **不是** `completed`；`approved` / `rejected` **不是** `completed`；`cancelled`（含 tasks 全 cancelled）**不是** `completed`。
2. 真实成功回合仍然显示 `completed`（不能把正常路径改坏）；有对应测试证明。
3. 未知/缺失状态展示为明确的非完成态（如 `unknown` / `queued`），且 UI 的 Activity 卡片对这类状态有可读文案。
4. 上述四条探针输出冻结为自动化回归测试（放 `apps/local-server/src/routes/` 下，`vitest` 可跑）。
5. 门禁：`npx tsc -b`、`npm run typecheck:tests`、`npm run -w @vessel/web typecheck`、`npx vitest run apps/local-server`、`npm run test:web` 全绿。

## 4. Blast Radius (影响面)

- `apps/local-server/src/routes/activityRoutes.ts`
- `apps/local-server/src/server.ts`（仅回合状态投影相关行）
- `apps/web/src/components/activity/*`（若状态文案需要同步）
- 新增/调整测试

## 5. Expected Evidence

- 修复前后探针输出对比（贴 JSON）。
- 新增回归测试名与断言摘要。
- 五条门禁的命令 + 退出码 + 测试计数。
- 明确列出「哪些状态现在映射为什么」，方便复核。

## 6. Result

已完成本地实现与回归验证。探针前后完整 JSON、状态映射、24 项新增用例、五项门禁退出码与计数见 [验证证据](../evidence/sessions/2026-10-22-task258-proof.md)。

协调者独立复核（不采信执行者自述）：自写探针确认四条反向全部不再是 `completed`（idle/approved → unknown、rejected/cancelled → failed），两条正向仍为 `completed`，另补「finished 但任务列表为空」正确落 `unknown`；`tsc -b`、`typecheck:tests`、`@vessel/web typecheck`、`vitest run apps/local-server`（21 文件 / 216 项）、`test:web`（51 文件 / 424 项）、`test:all`（根 291 文件 / 3106 通过 + 6 跳过，web 424 通过）均退出 0。

未覆盖（如实记录）：`server.ts` 未改——其回合投影本就取最近一对 start/end，已有 HTTP 用例覆盖；审计 ARCH-01 的另一半「Session 处于 cancelled/interrupted 期间保留 outcome、展示不应为 failed」不在本卡范围。界面标签仍是「失败」，取消与失败的**视觉**区分需 UI 层另做。`packages/core` 未改动。
