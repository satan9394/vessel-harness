# 185 — Web 控制台 Swarm 节点拓扑面板、沙箱安全审计与经验规则看板

- 编号：185
- 优先级：P2
- 关联模块：`apps/web`, `apps/local-server`, `packages/application`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：待执行
- 创建日期：2026-10-03

---

## 1. 目标与意图

在任务 175 中，Vessel 落地了基于 SVG 的 DAG 团队工作台。然而随着系统演进至 V1.9 分布式 Mesh 时代，用户在 Web 前端界面无法洞悉以下关键系统状态：
1. **分布式 Swarm 节点拓扑不可视**：无法在 Web UI 上查看已连接的远端 Vessel 节点拓扑、节点负载与远程派发任务流；
2. **执行沙箱等级与降权审计不可见**：无法查看每个工具执行是在原生沙箱（`windows-job-restricted` / `bwrap-ns`）还是回退模式，缺少可视化的安全审计标记；
3. **经验知识图谱与反思规则黑盒**：无法在 Web 界面查阅当前积累的反思经验规则（`ReflectiveRule`）、命中间距与演进频次。

本任务旨在为 `apps/web` 扩充工业级可视化控制面板：
1. **Swarm Mesh 节点拓扑视图（Swarm Topology Tab）**：
   - 增加独立集群拓扑页面，以网络节点图呈现主控节点与所有 Peer 节点连接状态、延迟波形、角色能力标签与远程子任务活跃度；
2. **执行沙箱安全审计徽章（Sandbox Security Tier Badges）**：
   - 在 Talking 详情抽屉和执行消息流中，为工具调用打上沙箱隔离等级标识（绿色 Low Integrity、黄色 Job Restricted、蓝色 bwrap、灰色 Fallback），点击可查看白名单目录与特权限制详情；
3. **Cognitive Memory 规则看板（Reflective Rules Inspector）**：
   - 增加认知记忆查看器，支持按类别（`policy_denial` / `tool_failure` / `architecture_constraint`）过滤经验规则，支持实时关键词检索，展示规则触发频次与最近反思时间。

---

## 2. 接口与组件契约规范 (Interface-First)

请在 `apps/web/src/components/` 扩展或实现组件：
- `SwarmTopologyView.tsx`：Mesh 节点网络拓扑与心跳状态图；
- `CognitiveRulesDashboard.tsx`：经验图谱与反思规则检索看板；
- `SandboxAuditBadge.tsx`：工具沙箱等级与安全约束徽章；
并在 `apps/local-server` 提供对应的只读查询 API 代理（如 `/api/mesh/nodes`、`/api/memory/rules`）。

---

## 3. 架构红线与禁做铁律 (必须遵守)

1. **纯净构建**：Web 前端使用 React 19 + Vite，严禁引入未经批准的巨型图表库，优先使用既有轻量 SVG 或纯 CSS 绘制；
2. **前后端同构**：所有状态流经 Application 层 Session/Daemon 投影，严禁直接在前端引入 Node 独占的 native 模块；
3. **完成门禁**：`npm run -w @vessel/web build` 必须无警告通过；
4. **包管理器锁定**：锁定 npm，禁止产生任何其他锁文件。

---

## 4. 完成门禁 (DoD)

1. 定向测试通过：
   - `npx vitest run --root apps/web apps/web/src/components/__tests__/SwarmTopologyView.test.tsx apps/web/src/components/__tests__/CognitiveRulesDashboard.test.tsx`
2. 类型构建与 Web 构建通过：
   - `npx tsc -b tsconfig.json` (exit 0)
   - `npm run -w @vessel/web build` (exit 0)
3. 全量回归测试双 Root 保持全绿：
   - `npm run test:all`
