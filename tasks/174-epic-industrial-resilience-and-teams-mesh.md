# 174 — [Epic] V1.5 工业级韧性、高密持久化与多 Agent 协同网格体系 (Industrial Resilience & Teams Mesh)

- 编号：174 (Epic: 融合 170–173 联合交付大卡)
- 状态：本地交付与全部门禁完成；待用户验收，Git 未提交
- 优先级：P1
- 创建日期：2026-10-01
- 关联模块：`packages/context`, `packages/tools`, `packages/agents`, `packages/core`, `benchmarks/runners`, `apps/cli`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium` · 首席系统架构师角色)
- 验收人：用户

---

## 1. 总体目标与愿景

打通工业级高并发、超长生命周期与分布式多 Agent 协作的关键瓶颈，将 OpenCode V2（v2.0.20）的内存与进程绝对治理经验、以及 DeepSeek Harness (DSH) 官方发布版与桌面双端的核心架构优势深度融合进 Vessel：

1. **动态自适应上下文防爆与 400 正则自愈（任务 170）**：
   - 彻底解决长会话上下文被撑爆崩溃的问题：落地公式 $\lfloor \min(W \times 0.8, W - O - B) \rfloor$；
   - 引入 CJK 1.3x 词元膨胀死区校准；
   - 建立多厂商 HTTP 400 溢出模式正则白名单，实现单次溢出自动紧凑压实与无感重试。
2. **MCP 进程树内核级收敛与延迟代理唤醒（任务 171）**：
   - 攻克 Windows 下外部 MCP 子孙进程泄漏痛点（彻底消灭 19 份重复实例吞噬 2.7GB 的隐患）；
   - 在 `StdioTransport` 启动时将子进程严格绑定至 Windows Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）；
   - 配置层正式支持 `disabled: true`，结合 `vessel mcp disable/enable` 子命令；
   - 引入 `LazyMcpClientProxy` 延迟唤醒代理，冷启动仅加载静态 Schema，命中工具调用才按需拉起进程。
3. **Agent-Teams 反应式 DAG 编排与建队模型路由快照隔离（任务 172）**：
   - 摆脱简单的线性阶段，引入支持并发分支的有向无环图（DAG）任务拓扑与事件驱动调度器；
   - 引入「Approve & Run」方案预审两阶段门禁，防止未授权消耗 Token；
   - 实施建队时刻队员模型路由深拷贝快照隔离机制（Route Snapshotting），彻底防止外部切换全局默认导致异步队员风格与思考深度漂移。
4. **高密流式持久化与极限长会话防抖双盲评测（任务 173）**：
   - 引入分块流式持久化层，避免数百兆事件日志在恢复时撑爆 V8 堆内存；
   - 建立 100 轮超长场景的离线双盲防抖评测套件，通过机械化指标（综合能力保全度 $\ge 90\%$，工作区残留 `residueCount === 0`，孤儿进程数为 0）完成最终验收。

---

## 2. 权威开源参考与本地免下直读路径

Codex 在执行超长开发时可按需查阅以下权威技术备份（已落盘）：
- **OpenCode V2 核心架构与内存治理技术备份**：`docs/research/OPENCODE-V2-ARCHITECTURE.md`
- **DSH 官方双端、Agent-Teams 与上下文防爆技术备份**：`docs/research/DSH-DESKTOP-AND-TEAMS.md`
- **Vessel 内部基础设施**：
  - Windows Job Object 内核沙箱：`packages/runtime/src/sandbox/backend/windows-job-object.ts`
  - 既有压实实现：`packages/context/src/compaction/Compaction.ts`
  - 团队多 Agent 运行时：`packages/agents/src/team/TeamRuntime.ts`
  - MCP 客户端传输：`packages/tools/src/mcp/McpClient.ts`
  - CLI 子命令入口：`apps/cli/src/mcp/config.ts`

**纪律**：严禁在当前工作区内运行 `git clone` 外部仓库；严格遵守 Clean-room 规范，仅参考设计模式与抽象契约，严禁复制代码侵权。

---

## 3. 分阶段实施规约

### 阶段一：动态自适应上下文压实与 400 溢出自愈 (对标任务 170)
- 在 `packages/context/src/compaction/` 中实现：
  - `computeAdaptiveThreshold(opts)`：基于上下文窗口、最大输出与安全缓冲计算主动压实触发线；
  - `isContextOverflowError(err)`：基于白名单正则识别主流模型上下文溢出报错；
  - 在 `Compaction` 流程中支持紧急压实与 `maxOverflowRetries: 1` 自动重试机制。
- 编写并通过 `packages/context/src/compaction/adaptiveCompaction.test.ts`。

### 阶段二：MCP 进程树 Job Object 绑定与延迟唤醒代理 (对标任务 171)
- 在 `packages/tools/src/mcp/` 中实现：
  - `BoundedStdioTransport`：在 Windows 平台拉起进程后绑定 `WindowsJobObject`，并在 `close()` 时秒杀整棵进程树；
  - `LazyMcpClientProxy`：仅在首次请求时懒拉起底层传输；
- 在 `apps/cli/src/mcp/config.ts` 与 CLI 子命令中支持 `disabled` 配置及 `vessel mcp disable/enable`。
- 编写并通过 `packages/tools/src/mcp/boundedStdio.test.ts` 与 `lazyProxy.test.ts`。

### 阶段三：Agent-Teams 反应式 DAG 编排与模型快照隔离 (对标任务 172)
- 在 `packages/agents/src/team/` 中实现：
  - `MemberModelRouteSnapshot`：建队时对 Provider 与 Model 配置进行深拷贝封存；
  - `TeamDagScheduler`：管理 `pending` $\to$ `ready` $\to$ `claimed` $\to$ `running` $\to$ `completed` 状态机与环检测；
  - `TeamPlanStage`：支持未确认前的 Staged 计划展示与显式 Approve 解冻机制。
- 编写并通过 `packages/agents/src/team/dag/dagScheduler.test.ts` 与 `teamRouteSnapshot.test.ts`。

### 阶段四：流式会话持久化与极限长会话双盲评测套件 (对标任务 173)
- 在 `packages/core/src/session/` 中扩展分块流式持久化接口；
- 在 `benchmarks/runners/src/conformance/resilience/` 建立 100 轮极限长会话防抖场景；
- 编写并通过 `benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`，机械度量综合保全度 $\ge 90\%$，残留为 0。

---

## 4. 架构红线与禁做铁律 (绝对遵循)

1. **薄核（Thin Core）铁律**：`packages/core` 保持极致简洁，严禁将网络请求、特定 MCP 客户端或外部执行器直接写死在 core 内部。
2. **严禁调用真机 Agent**：严格遵守 `AGENTS.md` 禁做清单与任务 153 纪律，所有单元测试与回归套件必须使用内存 Mock 桩与离线仿真，严禁拉起本机真实安装的 `claude`/`codex`/`dsh`/`opencode` 进程。
3. **包管理器铁律**：严格遵守决策点 19，绝对禁止引入 `pnpm`/`bun`/`yarn` 锁文件，保持 `npm ci` 跨平台纯净可用。
4. **删除铁律**：非测试自建且位于 `os.tmpdir()` 之下的临时目录，一律走回收站，严禁任何硬删命令。
5. **信息隐藏原则**：向外部透出的状态实体保持紧凑，严禁倾倒长文本原始 Session 日志。

---

## 5. 确定性完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 四组核心定向单测全部通过：
   - `npx vitest run packages/context/src/compaction/adaptiveCompaction.test.ts`
   - `npx vitest run packages/tools/src/mcp/boundedStdio.test.ts packages/tools/src/mcp/lazyProxy.test.ts`
   - `npx vitest run packages/agents/src/team/dag/dagScheduler.test.ts`
   - `npx vitest run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`
2. 类型与构建双绿：
   - `npx tsc -b tsconfig.json` exit 0
   - `npm run typecheck:tests` exit 0
3. 全量测试与双 Surface 回归保持恒绿：
   - `npm run test:all`（根 189+ 文件、Web 14+ 文件全部通过）
   - `npm run -w @vessel/web build` 构建成功

## 6. 本地交付证据（2026-10-01）

- 170 → 171 → 172 → 173 实施完毕。接口、集成、对抗评审修复与明确限制见 `docs/V1.5-IMPLEMENTATION-NOTES.md`。
- 最后源码编辑后按本卡顺序执行：context 定向 29 passed；MCP 两文件 13 passed；DAG 定向 4 passed；长会话定向 5 passed。
- `npx tsc -b tsconfig.json` 与 `npm run typecheck:tests`：均 exit 0。
- `npm run test:all`：根 198 文件 / 2398 passed + 6 既有 skipped；Web 14 文件 / 141 passed；exit 0。包含 chunk archive、route snapshot、Approve & Run、provider wire 与 CLI enable/disable 回归。
- `npm run -w @vessel/web build`：exit 0，Vite 8.3.0，43 modules。
- `npm ci --offline`：exit 0，0 audit vulnerabilities；只新增既有 context workspace 依赖及 project reference，无外部依赖或其它包管理器锁文件。
- 离线 100 轮指标：overallPreservationScore 100%，dataIntegrityRate 100%，orphanProcessCount 0，workspaceResidueCount 0。评分器独立检查哈希、单调序号、记忆事实与故障恢复；负例能拒绝损坏、缺失、错序、重复与残留。
- 所有新增场景使用 Mock；没有调用本机其它 Agent 或真实模型。已有 task 169 改动保留；未 commit/push/publish。
- 范围限制：原 JSONL Session 仍为默认；分块 archive 为显式可选 API。Windows 2 秒清理证据来自假进程树；既有 Job 异步绑定最多 30 秒。归档 acquisition 中途崩溃保持 fail-closed。详见实施说明，不把离线证据当成原生时延保证。

无法确认（2026-10-27 对账：170/171 的本次 58 passed + 2 skipped exit 0 与 172/分帧本次通过仅支持对应部分；173 长会话默认 30 秒 setup 门禁失败，`longSessionResilience.test.ts:51` timeout + ENOTEMPTY，原始整批 exit 1，日志 `t8-v15-b.log`；因此不提升 Epic 整体为已验收，完整命令与后续非验收诊断探针见卡 354 Result。未重跑全门禁，所有既有原生/可选 API 限制保留。）
