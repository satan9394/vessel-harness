# 169 — [Epic] 工业级多 Agent 协作工作台与分布式可观察性控制面 (Universal Multi-Agent Orchestration & Distributed Observability Control Plane)

- 编号：169 (Epic: 融合本地网关透视、Web 树状工作台、并发防抖与端到端评测联合交付)
- 状态：已合入（本地验收标记；Git 未提交）
- 优先级：P1
- 创建日期：2026-10-01
- 关联模块：`apps/local-server`, `apps/web`, `packages/application`, `packages/agents`, `packages/runtime`, `benchmarks/runners`
- 执行模型：Codex (GPT-6.1 Sol · `reasoning.effort: medium` · 目标模式 `/goal`)
- 验收人：用户

交付证据与最终门禁：见 `tasks/169-subagent-mesh-local-server-wiring.md` §5–6。四阶段完成，root 2315 passed / 6 skipped，Web 141 passed；未提交、推送或远程合并。

## 1. 总体目标与愿景

在 V1.3（Epic 167）中，Vessel 成功交付了入站 MCP 子代理服务器（163）、虚拟人类代理（164）、出站异构子代理运行时（165）与保全度评测套件（166），确立了底层的 Universal Subagent Mesh。

本次 Epic 169 聚焦于**将底层的 Mesh 网关能力全面跃升为工业级可交互、可观察、高韧性的全栈工作台**：
1. **本地服务端网关透视 (Local-Server Mesh Seam)**：在 `apps/local-server` 建立状态注册与控制门面，提供 `GET /api/subagents` 查询与 `POST /api/subagents/:id/cancel` 进程树中断能力，并在 SSE 事件通道实时广播生命周期事件（`subagent:start/step/end`）。
2. **Web UI 多 Agent 树状工作台 (Web Observability & Drawer)**：在 `apps/web` 扩展子代理面板，支持动态卡片渲染、Worktree 路径与运行状态高亮、实时四维 Token/时延指标监控，并支持在界面上一键主动取消子代理。
3. **Windows Runner 与并发防抖兜底 (Runner Worker Guard)**：治理 CI Windows Runner 偶发 Worker 启动抖动（退出码 `0xC0000142`），对测试进程池进行平台感知的动态防护，抵御多 Agent 并发场景下的句柄与内存竞争。
4. **双 Surface 端到端集成闭环评测 (End-to-End Conformance)**：建立贯穿 CLI、Local Server、Outbound Worktree 与 Web SSE 通道的离线集成测试，机械量化综合保全度 $\ge 90\%$，工作区残留恒为 0。

## 2. 权威开源参考与本地免下直读路径

- **Model Context Protocol (MCP)**：`packages/application/src/mcp-agent/vesselMcpServer.ts`
- **虚拟人类代理与 Job Object**：`packages/runtime/src/proxy/virtualProxy.ts`
- **外部子代理运行时与 Worktree 隔离**：`packages/agents/src/external/externalSubagent.ts`
- **既有本地服务端与 SSE 实现**：`apps/local-server/src/server.ts`, `apps/local-server/src/teamSeam.ts`
- **既有 Web 组件与 Topic 抽屉**：`apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/ThinkingBlock.tsx`

**纪律**：严禁在当前工作区内直接 `git clone`；保持 Thin Core 零侵入；严禁复制代码侵权。

## 3. 分阶段实施架构与核心契约

### 阶段一：本地服务层子代理网关透视 (`apps/local-server`)
- 在 `apps/local-server/src/subagentSeam.ts` 实现 `SubagentSeam`：
  - 数据契约 `SubagentSummary`：`id`, `name`, `provider`, `status`, `worktreePath`, `startedAt`, `endedAt`, `exitCode`, `lastError`。
  - 核心方法：`listSubagents(): Promise<SubagentSummary[]>`, `cancelSubagent(id: string): Promise<boolean>`。
- 在 `apps/local-server/src/server.ts` 挂载 `GET /api/subagents` 与 `POST /api/subagents/:id/cancel`。
- 在 SSE 通道广播 `subagent:start`、`subagent:step`、`subagent:end` 事件。
- 门禁：编写并跑通 `apps/local-server/src/subagent-seam.test.ts`。

### 阶段二：Web UI 多 Agent 树状工作台与实时状态透视 (`apps/web`)
- 在 `apps/web/src/components/` 增加 `SubagentPanel.tsx`：
  - 渲染活动子代理卡片列表，展示状态标识（`running` / `completed` / `failed` / `cancelled`）。
  - 点击滑出详情抽屉，展示 Worktree 隔离路径、阶段性输出及 Token 拆解指标。
  - 提供取消按钮调用 `POST /api/subagents/:id/cancel`。
- 门禁：编写并跑通 `apps/web/src/components/SubagentPanel.test.tsx`。

### 阶段三：Windows Runner 并发防抖与进程池韧性优化 (`benchmarks/runners`, `vitest.config.ts`)
- 完善 CI 环境下的并发防抖逻辑，避免高并发派生下系统句柄耗尽导致的 `0xC0000142` 启动抖动。
- 门禁：编写并跑通 `benchmarks/runners/src/conformance/runnerWorkerGuard.test.ts`。

### 阶段四：跨 Surface 端到端集成与保全度评测套件 (`benchmarks/runners`)
- 构建跨 Surface 端到端自动化双盲用例：模拟从 Server 派发任务至外部 Subagent Worktree 并经 SSE 广播结果。
- 机械门禁：保全度 `overallPreservationScore >= 90%`，临时目录残余 `residueCount === 0`。
- 门禁：编写并跑通 `benchmarks/runners/src/conformance/subagentEndToEnd.test.ts`。

## 4. 架构红线与禁做铁律 (绝对不可违反)

1. **薄核（Thin Core）铁律**：绝对禁止修改 `packages/core/` 下任何源码。
2. **严禁调起真机 Agent**：严禁在测试中拉起真实安装的 `codex`/`claude`/`dsh`/`opencode` 进程，所有测试依托内存假对象与确定性 Mock 进行。
3. **包管理器铁律**：严格遵守决策点 19，绝对禁止引入 `pnpm`/`bun`/`yarn` 锁文件，保持 `npm ci` 纯净可用。
4. **回收站纪律**：除测试自建且位于 `os.tmpdir()` 之下的临时目录外，严禁任何硬删命令。
5. **信息隐藏**：仅透出紧凑的 `SubagentSummary`，防止长文本倒灌造成宿主上下文爆炸。

## 5. 确定性完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 四组核心测试全部通过：
   - `npx vitest run apps/local-server/src/subagent-seam.test.ts`
   - `npx vitest run --root apps/web src/components/SubagentPanel.test.tsx`
   - `npx vitest run benchmarks/runners/src/conformance/runnerWorkerGuard.test.ts`
   - `npx vitest run benchmarks/runners/src/conformance/subagentEndToEnd.test.ts`
2. 静态编译全绿：`npx tsc -b tsconfig.json` 与 `npm run typecheck:tests` 均 exit 0。
3. Web 生产构建：`npm run -w @vessel/web build` exit 0。
4. 全量回归：`npm run test:all` 双 root（根 2302+ 项 + Web 129+ 项）全绿。

## 6. Codex 目标模式开工 Prompt (内置)

```markdown
# Goal: 自主实施并交付 Epic 任务卡 169（V1.4 工业级多 Agent 协作工作台与分布式可观察性控制面）

## 1. 总体目标与任务背景
请完整阅读并依据 tasks/169-epic-universal-subagent-workspace.md 的规格，依次推进并完成四个阶段的开发与测试：
- 阶段一：apps/local-server/src/subagentSeam.ts 及 server.ts 接线
- 阶段二：apps/web/src/components/SubagentPanel.tsx 及测试
- 阶段三：benchmarks/runners/src/conformance/runnerWorkerGuard.test.ts
- 阶段四：benchmarks/runners/src/conformance/subagentEndToEnd.test.ts

## 2. 架构红线与禁做准则 (严格遵守)
1. 薄核（Thin Core）铁律：绝对禁止修改 packages/core/ 下任何源码。
2. 严禁调起真机 Agent：严禁在测试中拉起真实安装的 codex/claude/dsh/opencode 进程，仅依托内存假对象运行。
3. 包管理器铁律：严格遵守决策点 19，绝对禁止引入 pnpm/bun/yarn 锁文件，保持 npm ci 纯净可用。
4. 回收站纪律：除测试在 os.tmpdir() 自建的临时文件外，严禁任何硬删命令。
5. 信息隐藏：仅透出紧凑的 SubagentSummary，防止上下文爆炸。

## 3. 验收门禁 (DoD)
在本地依次执行并通过以下门禁：
1. 四组核心测试全部通过：
   - npx vitest run apps/local-server/src/subagent-seam.test.ts
   - npx vitest run --root apps/web src/components/SubagentPanel.test.tsx
   - npx vitest run benchmarks/runners/src/conformance/runnerWorkerGuard.test.ts
   - npx vitest run benchmarks/runners/src/conformance/subagentEndToEnd.test.ts
2. 静态编译全绿：npx tsc -b tsconfig.json 与 npm run typecheck:tests 均 exit 0。
3. Web 生产构建：npm run -w @vessel/web build exit 0。
4. 全量回归：npm run test:all 双 root 全部通过。

完成后将 tasks/169-epic-universal-subagent-workspace.md 状态更新为「已完成」，输出结论并结束目标。
```
