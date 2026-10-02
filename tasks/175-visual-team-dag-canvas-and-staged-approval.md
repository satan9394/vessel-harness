# 175 — Web 交互式 DAG 拓扑画布与方案预审控制台 (Visual Team DAG Canvas & Staged Approval)

- 编号：175
- 优先级：P1
- 关联模块：`apps/web`, `apps/local-server`, `packages/agents`, `packages/shared`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁与独立审查通过；待用户验收（2026-10-02）
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
