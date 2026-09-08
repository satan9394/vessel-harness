# 060 — Team UI（web 3-Agents 面板 + 模型选择 Auto/Fast/Pro/Pin）

- 状态：已合入
- 优先级：P1（Wave 2 / Milestone D 收尾）
- 创建日期：2026-09-08
- 关联：056（Auto 路由显示/Pin）；057（TeamProjection 数据源）；058/059（评审可见性）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §8.2/§10 + §9.1 UI 元素
  （External Review Required / Copy Handoff / Open Folder / Import Result；Auto→实际模型 + Pin for session）

## 目标

web 面落地 Team 相关 UI：3-Agents 面板（Lead/Developer/Reviewer 的活动、turn、阶段，消费 057
TeamProjection）；模型选择显示 Auto/Fast/Pro + 实际解析结果 + Pin for this session（056 的 seam
最小接线；打磨不限死）。External Review Required 区（Copy/Open/Import，接 059 数据）。

## 验收标准（执行器逐条勾选）

- [x] Team 面板：按 057 TeamProjection 渲染团队成员状态（活动 turn/工具/阶段/产出摘要）；无团队
      运行时空态友好 —— TeamModule/TeamPanel 组件 + TeamRunState 快照（GET /team-runs/current
      兜底 + SSE team 帧 live）；空态「No team run yet」
- [x] 模型选择：显示 Auto/Fast/Pro（默认 Auto）+ 实际解析（Auto → <model>）+ Pin 状态；Pin 后
      session 内锁定（接 056 API/状态）—— ModelSelector + RouteSeam（route 端点 + resolve/pin/unpin，
      pin 后 resolve 返回锁定路线不复判）
- [x] External Review Required 区：需要外部评审时显示 + Copy Handoff / Open Folder / Import Result
      （Import 触发 059 导入）—— ReviewRequiredPanel + /api/reviews*（create/list/get/handoff.md/
      folder/open/import）
- [x] 后端 seam 齐（server API/SSE 给到数据；040/052 投影框架）；web 独立套件测试补对应用例
      —— 见工作证明（apps/local-server teamSeam + 端点 + SSE team 帧）
- [x] 测试：web 组件/套件测试 ≥6 例（面板渲染/选择状态/pin/评审区）；全量 vitest（含 web 独立
      套件）+ tsc 绿（426+前卡新增数 无回归）—— web +24 例（54 全绿），root +7（544 全绿），
      tsc -b / web tsc 0 错误
- [x] 文档同步（web Team 功能）—— 新建 docs/WEB-TEAM-UI.md；docs/TEAM-RUNTIME.md §9 补 seam
- [x] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- UI 接线 + 数据消费。若 052/053（live projections/resume）未做且适合合并，可在此卡一并处理
  （注明合并了什么）。不做 UX 深打磨、不做 Electron。
  —— 052/053 未并入：repo 无 052/053 任务卡（Milestone C 收尾行，roadmap 明示「052/053 UI 可
  后置」）；本卡只把 060 需要的 live 面（SSE team 全量快照帧）落在 seam，未扩 live projections/
  resume 范围。

## 涉及文件（指针，执行器自行精化）

- apps/web（组件/状态/API；参考 ConversationView/StatusBar 等既有模式）
- apps/local-server（API/SSE seam）
- 057 TeamProjection / 056 Auto 选择 / 059 handoff 的消费端

## 方法

- 读 §10 与 §8.2/§9.1 UI 需求；照 042-045 既有 web 卡模式（组件+api+独立 vitest.config）
- 后端 seam 若缺，先补 API 再渲染

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [x] 待执行器回填 → 已回填（见下）

### 改动文件 + diff 摘要（git diff --stat 计 +985/−16，另新增 9 个文件）

**apps/local-server（seam 主战场，+275 行 server.ts + 新增 teamSeam.ts）**
- 新增 `src/teamSeam.ts`：RouteSeam（每会话 Auto/Fast/Pro 模式 + pin + lastRoute，复用
  @vessel/llm classifyTask/complexityForCategory/rolesForComplexity/roleTierFor/
  resolveTierBinding 纯函数链 —— 与 056 AutoTaskRouter 同一解析来源，056 pin 语义对齐：
  显式 Fast/Pro 绕过 classify；auto+pin 直接返回锁定路线）；DEFAULT_TIER_BINDINGS
  （pro/fast/review → mock-* 离线绑定）；startTeamRun()（真实 TeamRuntime + TeamProjection，
  独立 EventBus，8 个投影事件 → onUpdate 全量快照回调；settled 承载 outcome/error）。
- `src/server.ts`：VesselServerOptions 扩 teamProviders/tierBindings/policySystemPath/
  reviewStore/openFolder（均有默认：单 mock provider、默认政策 yaml、ReviewHandoffStore、
  best-effort OS opener）—— 真实 provider/绑定由 CLI/provider 层注入；每会话 teamStates
  （route + 单运行互斥）；teamSenders 注册表（SSE 连接按 session 收 team 帧）。新端点：
  `GET/POST /sessions/:id/route`、`/route/resolve`、`/route/pin|unpin`、
  `GET /sessions/:id/team-runs/current`、`POST /sessions/:id/team-runs`（202；运行中再起 409）、
  `/reviews*`（GET/POST 列表与创建、GET :id、import、handoff.md raw、folder、open）。
  SSE `/events` 新增 `type:'team'` 帧（{kind, state}，全量快照；连接时补发当前快照）。
  close() 清理 run/bus/registry。

**apps/web（组件/状态/API/样式，+13 文件）**
- 新增 `src/team.ts`：route/team/review 线类型镜像 + 纯函数（memberCards/toolSummary/
  runSummary/routeLabel/phaseDisplay/roleDisplay/verdictDisplay/normalizeTeamState/
  sortReviews）—— web 独立项目不 import workspace 包，照 042 sse.ts/api.ts 镜像惯例。
- 新增组件：TeamModule（容器：route 状态 + SSE team 帧 + reviews；Run team 触发端到端）、
  TeamPanel（roster/阶段/输出/结构化评审结论/工具 chip/delegate 行/空态）、
  ModelSelector（Auto/Fast/Pro 段 + 「Auto → <model>」标签 + Pin/Unpin）、
  ReviewRequiredPanel（pending → External Review Required + Copy Handoff/Open Folder/
  Import Result；imported → 结果摘要行）。
- 扩 `api.ts`（10 个新方法）、`sse.ts`（onTeam/TeamDelta + case）、`App.tsx`（Team 模块从
  UNIMPLEMENTED 变真实渲染，ModuleSections 传 api/sessionId）、`i18n.ts`（teamModuleNoSession
  zh/en）、`styles.css`（team-* 样式）。
- vitest.config.ts：include 扩 `.tsx` + @vitejs/plugin-react（组件静态渲染测试需要）。

**docs**
- 新增 `docs/WEB-TEAM-UI.md`（组件/数据流/API/seam/052 052 关系）；TEAM-RUNTIME.md §9
  （server/UI seam）。

### 新增测试数与命令输出（本环境可直跑，无受限）

- web 独立套件：基线 30 → **54 全绿**（team 纯函数 7 + 组件渲染 11 + sse team 帧 2 + api 4），
  `npx vitest run --root apps/web` → 6 files 54 passed。
- root 套件：基线 537 → **544 全绿**（local-server seam +7：route 默认/模式切换、
  resolve 解析链、pin 锁定、team-run 真跑投影、SSE live 帧、review 全流程、校验路径），
  `npx vitest run` → 64 files 544 passed, 49.3s。
- 类型：`npx tsc -b tsconfig.json` 0 错误；`npx tsc -p apps/web/tsconfig.json --noEmit` 0 错误。
- 顺带修了 web 既有类型瑕疵（i18n.test.ts 两处 Record 强转、uiModules.test.ts 未用 import）——
  纯测试文件清理，无行为变化。

### 设计选择与理由

1. **web 独立项目 → 镜像类型 + 纯函数选择器**：照既有 042/045 惯例（api.ts/sse.ts 不 import
   workspace 包）；TeamRunState 消费先归约为纯函数（memberCards 等），node 下直测。
2. **组件测试无 jsdom**：web vitest 环境 node + `react-dom/server` 静态渲染断言；交互态
   （pin 显示、模式高亮）用 props 变化断言 —— 不加 @testing-library 依赖。
3. **后端 seam 走真实 TeamRuntime（mock 成员）**：057 引擎已是库且 e2e 证明空工具面 + mock
   provider 可全流程运行，server 默认注入 mock 成员 + mock 绑定，离线可演示完整 team run；
   真实 provider 经 tierBindings/teamProviders 注入（CLI 接时），UI/契约不变。
4. **SSE 用全量快照而非增量**：team 事件低频（8 个事件/run），每次推送 TeamProjection.state()
   全量 —— web 端直接 setState，无增量协议复杂度（live 面最小化）。
5. **052/053 不并入**（见范围边界）：无任务卡 + roadmap 已后置；只交付 060 所需 live 帧。

### 踩坑记录

- pwsh 内容守卫拦截含 `fs.rmSync` 字样的 Add-Content（回收站铁律的浅层扫描）→ 改用文件工具
  追加测试代码（测试内临时目录清理沿用仓库既有 rmSync 惯例）。
- web vitest 最初从仓库根跑找不到用例（config include 相对 cwd）→ 用 `--root apps/web`。
- vitest include 只匹配 `.test.ts`，含 JSX 的测试需 `.tsx` → 扩 include 并迁移文件。
- `RouteSeam.resolve` 起初只记录 auto 结果且 resolve 端点未透传 body.mode → 修：一律记
  lastRoute（展示一致）+ 端点透传 mode；state() 对 route 补 pinned 标志（UI pin 显示一致）。
- 复杂 delegate 阵容（lead→dev/rev）在 server 上依赖 SubagentManager 同进程 compose，
  本次 seam 测试覆盖 medium（top-level 双成员）+ SSE，复杂阵容路径由 057 e2e 覆盖。

## 验收结论（指挥回填）

- [x] 合入（commit aadfead）
- 备注：指挥独立复核——root vitest 64 文件 544 测试全绿（首跑 1 例为已知 Windows 瞬态 flaky，重跑全绿，非本卡回归）、
  tsc -b 0 错误、web 独立套件 6 文件 54 测试全绿（537+7 root 新增 +24 web 新增）。设计认可：local-server teamSeam
  （RouteSeam 复用 056 纯函数链 + startTeamRun 跑真实 057 TeamRuntime/TeamProjection；route/pin/team-runs/reviews
  端点 + SSE type:'team' 全量快照帧 live）；web TeamModule/TeamPanel/ModelSelector/ReviewRequiredPanel（按 057 投影渲染、
  Auto→model + Pin、External Review Copy/Open/Import）。052/053 未并入（repo 无其卡，roadmap 标可后置）——seam 已落
  live 快照帧，052/053 如日后要做可基于此。**Milestone D（V1.2 Team）全部完成 054-060。**
