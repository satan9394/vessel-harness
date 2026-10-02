# 179 — [Epic] V1.6 工业级团队协同工作台、常驻守护进程与高性能会话中枢 (Universal Team Workspace & Daemon Mesh)

- 编号：179 (Epic: 融合 175–178 联合交付大卡)
- 状态：本地全门禁与独立审查通过；待用户验收（2026-10-02）
- 优先级：P1
- 创建日期：2026-10-01
- 关联模块：`apps/web`, `apps/local-server`, `apps/cli`, `packages/tools`, `packages/memory`, `packages/agents`, `benchmarks/runners`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium` · 首席系统架构师角色)
- 验收人：用户

---

## 1. 总体目标与愿景

在前序 V1.5（Epic 174）夯实了自适应上下文防爆、MCP 内核级沙箱收敛、Staged DAG 编排与流式分块持久化等关键底层运行时之后，Vessel 具备了支撑超长周期多 Agent 协作的能力。

本 Epic 旨在将系统全面推进至**人机交互全景可视化、后台常驻高韧性与极速检索**的工业级产品形态：
1. **Web 交互式 DAG 拓扑画布与方案预审控制台（任务 175）**：
   - 告别黑盒与纯文本盲操：基于原生 React SVG 绘制动态 DAG 拓扑图，完整呈现节点状态流转与贝塞尔曲线连接；
   - 建立 Staged 方案预审控制台，直观展示队员 Roster 分工与不可变模型快照，提供「Approve & Run」一键激活与取消干预；
   - 挂载侧边抽屉，可下钻查看各节点的输入依赖、控制台摘要与产物 Diff。
2. **后台常驻 Daemon 守护进程与系统通知驻留（任务 176）**：
   - 支持脱离终端前台的常驻守护进程（`vessel daemon start/stop/status`），终端关闭后台任务不中断；
   - 生成 24 字节高熵 Launch Token 并落盘保护，所有 HTTP/SSE 接口通过 Bearer Token 鉴权，杜绝本地跨站恶意劫持；
   - 支持系统原生通知推送，在长任务完成或遇审批门禁时主动唤醒用户。
3. **工具执行层自愈与输出流控截断管道（任务 177）**：
   - 针对 Windows 文件锁（`EBUSY`/`ETXTBSY`）与网络抖动构建带抖动的指数退避自愈重试机制；
   - 对任何工具输出施加 64KB 动态流控安全边界，智能保留首尾关键段并插入结构化占位符，彻底切断 V8 堆溢出与上下文冲爆路径。
4. **SQLite WAL 高性能会话中枢与全文检索（任务 178）**：
   - 保持 JSONL 事实源绝对纯净的前提下，在 `packages/memory` 引入轻量 SQLite WAL 投影视图；
   - 支持微秒级会话元数据分页查询与 Topic 检索；
   - 引入 FTS5 全文倒排索引，支持在历史数千条长对话中实现 sub-10ms 模糊关键词召回。

---

## 2. 权威开源参考与本地免下直读路径

Codex 在执行超长开发时可按需查阅以下权威技术资产（已落盘）：
- **OpenCode V2 核心架构与内存治理技术备份**：`docs/research/OPENCODE-V2-ARCHITECTURE.md`
- **DSH 官方桌面端、Daemon 架构与团队编排备份**：`docs/research/DSH-DESKTOP-AND-TEAMS.md`
- **V1.6 路线规划**：`docs/V1.6-ROADMAP.md`
- **Vessel 内部基础设施**：
  - DAG 调度器：`packages/agents/src/team/dag/`
  - 团队运行时：`packages/agents/src/team/TeamRuntime.ts`
  - Local Server API 挂载点：`apps/local-server/src/server.ts`
  - Web UI 组件体系：`apps/web/src/components/`
  - 工具执行注册表：`packages/tools/src/registry/`
  - 内存与记忆模块：`packages/memory/`

**纪律**：严禁在当前工作区内运行 `git clone` 外部仓库；严格遵守 Clean-room 规范，严禁复制代码侵权。

---

## 3. 分阶段实施规约

### 阶段一：Web 交互式 DAG 拓扑画布与方案预审控制台 (对标任务 175)
- 在 `apps/local-server/src/` 中挂载 `/api/team/stages` 系列 HTTP 契约；
- 在 `apps/web/src/components/team/` 中开发 `TeamDagCanvas.tsx`、`TeamStagedBanner.tsx` 与 `TeamNodeDrawer.tsx`；
- 编写并通过 `apps/local-server/src/teamStageApi.test.ts` 与 `apps/web/src/components/team/TeamDagCanvas.test.tsx`。

### 阶段二：后台常驻 Daemon 守护进程与系统通知驻留 (对标任务 176)
- 在 `apps/local-server/src/daemon/` 实现常驻进程脱离、PID 锁管理与高熵 Launch Token 校验中间件；
- 在 `apps/cli/src/` 中增加 `vessel daemon start`、`stop`、`status` 子命令；
- 编写并通过 `apps/local-server/src/daemon/authMiddleware.test.ts`、`daemonLifecycle.test.ts` 与 `apps/cli/src/daemon/daemonCommands.test.ts`。

### 阶段三：工具执行层自愈与输出流控截断管道 (对标任务 177)
- 在 `packages/tools/src/execution/` 中实现：
  - `enforceBoundedOutput(output, opts)`：超出 64KB 限制时安全截断并注入占位符；
  - `executeWithSelfHealing(fn, opts)`：针对 `EBUSY`/`ETXTBSY`/`ECONNRESET` 执行带抖动的指数退避自愈；
- 编写并通过 `packages/tools/src/execution/boundedOutput.test.ts` 与 `selfHealing.test.ts`。

### 阶段四：SQLite WAL 高性能会话中枢与全文检索 (对标任务 178)
- 在 `packages/memory/src/sqlite/` 中实现 `SessionIndexStore`，开启 WAL 模式；
- 实现会话增量投影、毫秒级分页查询与基于 FTS5 的全文关键词检索；
- 编写并通过 `packages/memory/src/sqlite/sessionIndex.test.ts` 与 `ftsSearch.test.ts`。

---

## 4. 架构红线与禁做铁律 (绝对遵循)

1. **薄核（Thin Core）铁律**：`packages/core` 保持极致简洁，禁止将网络请求、特定的 SQLite 数据库实现或 Web 组件注入 core 内部。
2. **严禁调用真机 Agent**：严格遵守 `AGENTS.md` 禁做清单与任务 153 纪律，所有单元测试与回归套件必须使用内存 Mock 桩与离线仿真，严禁拉起本机真实安装的 `claude`/`codex`/`dsh`/`opencode` 进程。
3. **包管理器铁律**：严格遵守决策点 19，绝对禁止引入 `pnpm`/`bun`/`yarn` 锁文件，保持 `npm ci` 跨平台纯净可用。
4. **删除铁律**：非测试自建且位于 `os.tmpdir()` 之下的临时目录，一律走回收站，严禁任何硬删命令。
5. **单源一致性原则**：JSONL 是唯一的会话可信事实源，SQLite 仅作为加速投影视图，任何冲突以文本日志为准。

---

## 5. 确定性完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 四组核心定向单测全部通过：
   - `npx vitest run apps/local-server/src/teamStageApi.test.ts apps/web/src/components/team/TeamDagCanvas.test.tsx`
   - `npx vitest run apps/local-server/src/daemon/daemonLifecycle.test.ts apps/cli/src/daemon/daemonCommands.test.ts`
   - `npx vitest run packages/tools/src/execution/boundedOutput.test.ts packages/tools/src/execution/selfHealing.test.ts`
   - `npx vitest run packages/memory/src/sqlite/sessionIndex.test.ts packages/memory/src/sqlite/ftsSearch.test.ts`
2. 类型构建双绿：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0
3. 双 Root 全量测试与 Web 构建保持全绿：
   - `npm run test:all`（根 198+ 文件、Web 15+ 文件全部通过）
   - `npm run -w @vessel/web build` 构建成功

## 6. 执行与交证入口

- 当前 Mission：自主实施本 Epic 的四阶段，仅本地修改与离线验证；保留 Epic 169/174 未提交成果。
- 阶段与最终门禁证据：`docs/V1.6-IMPLEMENTATION-NOTES.md`。
- 根 Vitest 不包含 Web：第一组命令之后还须显式运行 `npx vitest run --root apps/web src/components/team/TeamDagCanvas.test.tsx`，避免漏测。
- 176 的鉴权采用本次用户指令的 Bearer Token；旧卡查询参数令牌描述不能降低此要求。
- 不自动提交、推送、发布或调用本机真实 Agent。
