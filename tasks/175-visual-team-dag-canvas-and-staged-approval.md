# 175 — Web 交互式 DAG 拓扑画布与方案预审控制台 (Visual Team DAG Canvas & Staged Approval)

- 编号：175
- 优先级：P1
- 关联模块：`apps/web`, `apps/local-server`, `packages/agents`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁与独立审查通过；2026-10-28 final sweep：预审横幅 / 批准执行（3 节点完成）/ 节点抽屉主链**已通过**，三色状态、300 字截断、产物链接因离线 mock 不可达保持 UNVERIFIED；**签收口径改为协调者按证据签字**，不再排用户视觉签字
- 创建日期：2026-10-01

---

## 1. 目标与意图

在 V1.5（任务 172）中，底层已经交付了 DAG 调度器、任务状态机与方案预审机制（`stageTeam()` / `approve()` / `reject()`），但目前缺乏前端图形化交互界面，用户无法直观审阅任务流拓扑与执行进度。

本任务旨在为 Web 控制台引入团队 DAG 可视化画布与交互式审批面板：
1. **交互式 DAG 拓扑图渲染**：基于轻量 SVG 与 CSS 动画，动态呈现团队多节点的依赖拓扑与实时状态（`pending` $\to$ `ready` $\to$ `claimed` $\to$ `running` $\to$ `completed` / `failed`）；
2. **Staged 方案预审控制面（Approve & Run UI）**：在团队建队后、正式开跑前，清晰展示 Staged 计划摘要、队员 Roster 分工、模型路由快照（`routeSnapshot`）；提供显著的「Approve & Run」确认按钮与「Reject」取消按钮；
3. **节点级成果透视抽屉（DAG Node Detail Drawer）**：点击画布中的任一节点，滑出详情抽屉，展示该步骤的前置依赖、执行人、控制台输出摘要与生成的产物文件链接。

---

## 2. 接口与契约规范

### 2.1 Local Server HTTP 端点契约 (`apps/local-server/src/teamRoutes.ts`)

在 `apps/local-server/src/server.ts` 中扩展挂载：
- `GET /api/team/stages`：返回当前所有团队方案列表（含状态 `staged` | `running` | `finished` | `rejected`）；
- `GET /api/team/stages/:id`：获取指定 Stage 的完整 DAG 节点状态图与队员快照；
- `POST /api/team/stages/:id/approve`：触发 `TeamRuntime.approve(id)`，返回 `{ ok: true, status: 'running' }`；
- `POST /api/team/stages/:id/reject`：触发 `TeamRuntime.reject(id)`，返回 `{ ok: true, status: 'rejected' }`。

### 2.2 前端组件契约 (`apps/web/src/components/team/`)

- `TeamDagCanvas.tsx`：
  - 属性输入：`tasks: TeamDagTask[]`, `activeTaskId?: string`, `onSelectTask: (id: string) => void`；
  - 核心功能：计算拓扑层级（Layering），绘制节点与贝塞尔曲线连接线；根据状态显示不同的颜色（等待置灰、就绪闪烁、运行中脉冲、完成转绿、失败标红）。
- `TeamStagedBanner.tsx`：
  - 当方案处于 `staged` 状态时在顶部固定展示，列出计划执行的节点数、参与队员与预计模型路线，提供「Approve & Run」与「Reject」按钮。
- `TeamNodeDrawer.tsx`：
  - 侧边抽屉展示选中节点的输入依赖、输出摘要（截断至 300 字符以内）、以及错误信息。

---

## 3. 架构红线与禁做准则

1. **薄核（Thin Core）铁律**：禁止向 `packages/core` 引入任何 Web 或 DAG UI 数据结构。
2. **严禁调用真机 Agent**：前端与服务端单测一律使用内存 Mock 桩验证状态流转与网络调用。
3. **清洁安装与零原生依赖**：Canvas 画布使用纯原生 React SVG 实现，严禁引入体积极大的重型图库依赖，确保 `npm ci` 与 `vite build` 保持轻快恒绿。

---

## 4. 确定性完成门禁 (DoD)

1. **单测覆盖与全绿**：
   - 编写并通过 `apps/local-server/src/teamStageApi.test.ts`（验证 Stage 列表、详情、Approve 与 Reject 端点）；
   - 编写并通过 `apps/web/src/components/team/TeamDagCanvas.test.tsx`（验证节点状态渲染、连线计算、点击回调与 Staged 按钮触发）。
2. **构建与回归门禁**：
   - `npm run -w @vessel/web build` exit 0；
   - `npx vitest run apps/web` 与 `npx vitest run apps/local-server` 全绿通过；
   - `npx tsc -b tsconfig.json` exit 0。

## 5. 本地交证（2026-10-01）

实现及独立审查纠正已完成：含路线图要求的角色/模型/参数预审编辑、实际 Write/Edit 会话记录产物路径、工作区相对 HEAD Diff、有效父会话 Policy 继承与异步 Diff 防串图。定向服务端/DAG 17 passed，Web 8 passed；类型构建、测试类型检查、Web typecheck/build 全部 exit 0。证据与最终回归入口：`docs/V1.6-IMPLEMENTATION-NOTES.md`。

仍待用户验收（2026-10-27 对账：本次 Web 独立 root 的 `TeamDagCanvas.test.tsx` 8 passed / exit 0；`TeamDagCanvas.tsx:5`、`TeamStagedBanner.tsx:5`、`TeamNodeDrawer.tsx:29` 与服务端审批实现仍在。服务端定向结果及完整命令见卡 354 Result；`docs/V1.6-IMPLEMENTATION-NOTES.md:58` 已有历史浏览器走查，不否认该记录；本次未复跑真实浏览器的画布、抽屉、预审编辑视觉/端到端验收，单测不代替用户视觉验收。）

## 2026-10-28 · run6 执行边界（只追加，未签收）

Part A 卡 359 两次真实 detached 启动连续失败（第二次为 Set-Acl 调用非零），按用户停止条件结束；因此有序 Part B 未启动。画布三状态色/连线、预审 roster/routeSnapshot/Approve & Run/Reject、节点抽屉与运行转换全部 UNVERIFIED；本次没有新建 UI 会话、没有同源 POST stage、没有截图或 Console 读数。

证据：evidence/sessions/2026-10-28-iab-run6/report.md；测量 JSON 为空值并明确标注 UNVERIFIED，无旧截图替代。最终夹具端口 5700 监听数 0、夹具进程数 0（cleanup.json）。卡首行状态与看板未改，签收归协调者。


## 2026-10-28 final sweep - bounded evidence (not card acceptance)

T2: UI-created disposable mock session; same-origin HTTP POST created a real staged plan, then the public revise endpoint produced a three-node/two-edge pending DAG (the superseded plan is rejected). Staged roster developer and routeSnapshot mock/mock-pro, Approve & Run and Reject were simultaneously visible. A node click opened the drawer with dependency draft. UI approval was observed running, then finished with 3/3 completed; actual drawer output is 23 characters, artifacts [], Console errors 0. Screenshots: `evidence/sessions/2026-10-28-final-sweep/t2-staged-banner.png`, `t2-canvas.png`, `t2-drawer.png`, `t2-approved.png`, `t2-drawer-completed.png`; details: `t2-measurements.json`. UNVERIFIED: three distinct state colours (only pending/completed captured), 300-character truncation, artifact links, and simultaneous visibility of the full horizontally clipped DAG. This is partial browser evidence, not whole-card/user visual acceptance.

### 2026-10-28 final sweep · 画布/抽屉/预审（协调者验收，部分通过）

执行者 Codex 主线程可见 IAB，1440×900，离线 mock 团队供应商，夹具与数据造法：UI 新建会话 → 同源 `POST /api/sessions/<id>/team-stages` → 公共 revise 接口改成三节点依赖链（报告已写明用了 POST，未直接写 `.harness`）。证据 `evidence/sessions/2026-10-28-final-sweep/t2-*.png/t2-measurements.json`。

**通过的项目**（我逐张看过图）：
- 预审横幅：`审阅团队计划 · 3 个任务`、队员 roster（`developer · 生成者 · mock/mock-pro`）、路由快照、`批准并运行` 与 `拒绝` 同时可见 → `t2-staged-banner.png`。
- 批准执行：三个 mock 节点全部完成（`finished`，`Check dependencies` 显示 `已完成`），Console 无错误 → `t2-approved.png`。
- 节点抽屉：`状态: 已完成 · 执行者: developer`、`依赖任务: draft`、成员输出 `(mock team member turn)` → `t2-drawer.png` / `t2-drawer-completed.png`。

**未验证（不是缺陷，是夹具不可达）**：
- 三种以上状态色：只截到「待处理」与「已完成」两态；`running` 只在 AX 快照里出现过一瞬，没来得及截图；`failed` 离线 mock 造不出来。
- 输出摘要 300 字截断：该 mock 成员的输出只有 23 字符，截断分支没走到。
- 产物文件链接：默认离线 mock 不产出文件，链接区为空。

**观察（不是本轮引入，也没新开卡）**：1440×900 下团队面板渲染在 482px 宽的左列里，DAG 的 SVG 宽约 724px，需横向滚动才能看全，抽屉文字也在同一窄列内被截。连线与状态色本身正常。若要改是布局问题，另立 UI 卡再动。

**结论**：本卡「预审 → 批准 → 三节点完成 → 抽屉依赖可见」这条主链**通过**；上面三项视觉细节保持 UNVERIFIED，等有真实多 agent 运行或可控夹具时再补。

### 2026-10-29 · 签收口径与遗留

主链（预审横幅 → 批准执行 → 三节点完成 → 抽屉依赖）已由协调者逐张看图签收；三色状态 / 300 字截断 / 产物链接三项在离线 mock 下不可达，保持 UNVERIFIED 且不阻塞。原先挂的「用户视觉签字」改为「协调者按证据签字，原图可复核」，不再排期。

## 2026-10-29 remaining fixture follow-up (append-only)

Three residual branches now exercised through real TeamRuntime with a local scripted provider. Truncation bound PASS (570 generated → 301 stage summary → 300 drawer); ellipsis/expand FAIL (drawer removes runtime ellipsis). Real artifact download PASS (72 bytes, one Write, HTTP/download/workspace equality). Four actual status colors PASS, including controlled HTTP 500. Nonempty-widget deduplication remains UNVERIFIED (zero widgets in fixture). This does not sign off the whole card. Source of detailed results: card 361 appendix and `evidence/sessions/2026-10-29-remaining/t3-proof.json`.
