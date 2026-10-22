# Codex 执行契约：卡 258 消除虚假完成信号

仓库：`E:\Code_file\Projects\Vessel_Harness`（Windows，npm workspaces，TypeScript，Vitest）。
分支：`main`（不要切分支、不要 commit、不要 push）。

## 先读（按顺序，不要跳）

1. `tasks/258-false-completion-signal.md` —— 本任务的目标、非目标、验收标准、影响面。**它是唯一权威范围。**
2. `evidence/sessions/2026-10-22-doc-conformance-report.md` 的 `### [ARCH-01]` 与 `### [UI-02]` 两节 —— 已给出的复现路径与判定。
3. `tasks/255-...md` 与 `tasks/254-...md` 的 Result —— 前序改动留下的口径，别推翻。

## 要解决的问题

`ActivityRoutes` 的状态映射会把**没有成功证据**的实体投影成 `completed`：idle 的 subagent、`approved`/`rejected` 的团队阶段、`cancelled`（含 tasks 全 cancelled）都被算成完成。这会让用户看到「已完成」，而实际什么都没跑完。

先跑这条探针确认现状（原样执行，输出 JSON）：

```
node --import tsx -e 'import {ActivityRoutes} from "./apps/local-server/src/routes/activityRoutes.ts"; const r=new ActivityRoutes({sessions:async()=>[],live:()=>undefined,approvals:()=>[],subagents:async()=>[{id:"idle",name:"idle",status:"idle",startedAt:"2026-10-22T00:00:00Z"}],teamStages:()=>[{id:"approved",status:"approved",createdAt:1},{id:"rejected",status:"rejected",createdAt:2},{id:"cancelled",status:"finished",createdAt:3,tasks:[{status:"cancelled"}]}],goalTasks:()=>[]}); console.log(JSON.stringify((await r.list()).runs));'
```

## 改动口径

- 状态映射必须由**真实终态证据**驱动：只有明确的成功终态才是 `completed`；取消是 `cancelled`/失败语义；`approved`/`rejected` 是审批结果，不是执行完成；`idle` 是未开始；拿不到证据的是 `unknown`/`queued`。
- 只改投影与映射层（`apps/local-server/src/routes/activityRoutes.ts` 为主，`server.ts` 仅限回合状态投影相关行）。**不要改 `packages/core`**。
- 如果 UI 需要同步文案（Activity 卡片对未知/取消态），改 `apps/web/src/components/activity/*` 与对应 i18n，保持中英双语。
- 不要把未知一律改成 failed —— 未知就该显示未知。

## 硬约束

- 不 commit、不 push、不改 `.pdw/`、不删任何文件（需要清理请只清自己创建的临时目录）。
- 不引入新依赖。
- 不为了让探针通过而把正常成功路径改坏：真实成功回合仍必须是 `completed`。
- 不跑 `npm run test:all`（约 8 分钟，协调者会跑）。

## 必须交付

1. 代码改动 + 回归测试：把上面四条探针输出冻结成 vitest 用例（放 `apps/local-server/src/routes/` 下），并补一条「真实成功回合仍是 completed」的正向用例。
2. 门禁，逐条跑并记录退出码与计数：
   - `npx tsc -b tsconfig.json`
   - `npm run typecheck:tests`
   - `npm run -w @vessel/web typecheck`
   - `npx vitest run apps/local-server`
   - `npm run test:web`
3. 最终回复里给出：修复前后探针 JSON 对比、新增测试名、五条门禁结果、以及一张「状态 → 投影」对照表。

## 完成判据

卡 258 的 5 条验收全部成立，且五条门禁全绿。任何一条做不到就如实说明卡在哪，不要宣布完成。
