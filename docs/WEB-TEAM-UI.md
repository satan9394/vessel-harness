# Web Team UI（task 060）—— 模型选择 + 3-Agents 面板 + External Review

> Milestone D（V1.2 Team）web 收尾卡。数据源：056 AutoRoute / 057 TeamProjection /
> 058 Internal Review 结论 / 059 External Review Handoff；消费端 = `apps/web`
> （独立 Vite 项目，经 `apps/local-server` 的 REST/SSE seam 取数，不 import 任何
> workspace 包 —— 线类型镜像在 `apps/web/src/team.ts`）。

## 1. 一句话

web 的 Team 模块（Customize → Team 打开）现在是一个真实模块：

- **模型选择**：Auto / Fast / Pro（默认 Auto）+「Auto → <model>」实际解析标签 + **Pin for
  this session**（056 语义：pin 后本 session 的 Auto 不再自动重判）。
- **Team 面板**：按 057 TeamProjection 渲染 3-Agents（Lead/Developer/Reviewer）的运行状态
  —— roster/阶段（orchestrate/generate/review）/成员 turn 计数/工具活动 chip/产出摘要/
  delegate 行/结构化 Internal Review 结论（verdict + unmet + suggestions），无运行时空态友好。
- **External Review Required 区**（059）：有 pending handoff 时显示
  `Copy Handoff / Open Folder / Import Result` 三个动作；导入结果落库后折叠为结果摘要行。

## 2. Web 组件与数据流

| 组件 | 职责 | 状态来源 |
| --- | --- | --- |
| `components/TeamModule.tsx` | 容器：拉 route/team/reviews + 订阅 SSE team 帧 | `api.getRoute/getTeamRun/listReviews` + `createEventStream(...,{onTeam})` |
| `components/ModelSelector.tsx` | 三段 Auto/Fast/Pro + 解析标签 + Pin 开关（纯展示） | props（mode/label/pinned/callbacks） |
| `components/TeamPanel.tsx` | TeamRunState → 成员卡片（纯展示） | props（team: TeamRunState \| null） |
| `components/ReviewRequiredPanel.tsx` | 评审记录 → §9.1 动作区（纯展示） | props（reviews/callbacks） |
| `team.ts` | 线类型镜像 + 纯函数（memberCards/toolSummary/routeLabel/normalizeTeamState 等） | —— |
| `sse.ts`（扩） | `type:'team'` 帧分发（`TeamDelta {kind, state}`） | —— |
| `api.ts`（扩） | route / team-runs / reviews 客户端方法 | —— |

实时性：面板靠 SSE `team` 帧全量快照增量刷新（无增量协议）；`GET /team-runs/current`
是页面载入兜底。数据消费（memberCards 归属/聚合、label、状态归一）全部是纯函数，node 下
可单测；组件用 `react-dom/server` 静态渲染断言（无需 jsdom，web vitest 环境为 node）。

## 3. Local Server seam（新增 API）

前缀 `/api`，沿用 040 风格。会话相关全部要求 session 存在（404 提示）。

- `GET  /sessions/:id/route` → `{ mode, pinned, route|null }`
- `POST /sessions/:id/route` `{ mode: auto|fast|pro }` → 状态
- `POST /sessions/:id/route/resolve` `{ task?, mode? }` → 状态（route 更新为实际解析）
- `POST /sessions/:id/route/pin` / `POST /sessions/:id/route/unpin` → 状态
- `GET  /sessions/:id/team-runs/current` → `{ team: TeamRunState|null, error? }`
- `POST /sessions/:id/team-runs` `{ task, acceptance?, mode? }` → `202 { run }`（单运行互斥，
  进行中再起返回 409）
- `GET  /api/reviews` / `POST /api/reviews`（create handoff）
- `GET  /api/reviews/:id` / `GET  /api/reviews/:id/handoff.md`（raw artifact，Copy 用）
- `GET  /api/reviews/:id/folder` / `POST /api/reviews/:id/open`（Open Folder，可注入 opener）
- `POST /api/reviews/:id/import` `{ text, source? }`（Import Result）
- SSE `GET /sessions/:id/events`：帧 `{ type:'team', delta:{ kind, state } }`（全量快照）

服务端实现：`apps/local-server/src/teamSeam.ts`（RouteSeam + startTeamRun，跑真实
`TeamRuntime` + `TeamProjection`，默认 mock 成员 provider；`tierBindings`/`teamProviders`/
`reviewStore`/`openFolder` 均可注入 —— CLI/provider 层接真实模型时用注入面）。

## 4. 跑起来

```bash
npm run -w @vessel/web dev      # vite dev（/api 代理到 5678）
# 或 vessel serve 后打开静态产物；Customize → 勾选 Team
```

## 5. 与 052/053 的关系

052/053（live projections / resume UI）在 roadmap 中标注「可后置」且无独立任务卡；本卡未
合并其范围，只把 060 需要的 live 面（SSE team 快照帧）落在 local-server seam 上。
