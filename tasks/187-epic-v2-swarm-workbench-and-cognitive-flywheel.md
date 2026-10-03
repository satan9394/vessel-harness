# 187 — [Epic] V2.0 Swarm 集群控制面、自检诊断与认知自愈飞轮 (Swarm Mesh Control, Doctor Engine & Reflection Flywheel)

- 编号：187 (Epic: 融合阶段 184 与阶段 186 连贯自治长任务)
- 优先级：P1
- 关联模块：`apps/cli`, `packages/memory`, `packages/tools`, `packages/context`, `packages/agents`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已合入（2026-10-03 本地验收）
- 创建日期：2026-10-03

---

## 1. 总体目标与工作区上下文

在 V1.7（Epic 183）与 V1.9（任务 182）中，Vessel 分别攻克了原生操作系统沙箱（低完整性令牌降权）、纯 TS 向量/FTS5 混合记忆检索与跨实例异构 Swarm 网格（HMAC 对等鉴权、子图派发）。

本 Epic 旨在通过**顺序长久运行（阶段 184 → 阶段 186）**，将这些底层硬核能力打通为终端用户可感知、可操控、全自动自愈演进的产品化闭环：
1. **阶段一（对标任务 184）：Mesh/Memory CLI 控制面与 `vessel doctor` 系统自检引擎**：
   - 为 CLI 补齐 `vessel mesh status/peers/ping` 与 `vessel memory rules/search/stats`；
   - 落地 `vessel doctor`：全面体检 Node 环境、SQLite WAL 状态、OS 沙箱完整性（Job Object / Low Integrity / bwrap）、已配置 Provider 连通性与本地 Daemon 驻留状态；
2. **阶段二（对标任务 186）：会话后自主反思与经验提炼引擎（Post-Session Reflection Flywheel）**：
   - 监听会话内 Policy 拦截、工具执行失败自愈与 Evaluator 打回轨迹；
   - 纯确定性优先模式提取提炼标准 `ReflectiveRule`，支持自动频次自增、置信度更新与去重合并；
   - 规则自动持久化进入 `HybridMemoryStore`，使后续新会话自动召回历史经验，实现认知自愈飞轮。

---

## 2. 实施顺序与分阶段规约

### 阶段一：Mesh/Memory CLI 控制面与 `vessel doctor` 自检引擎 (对标任务 184)
- 在 `apps/cli/src/commands/` 实现并挂载 `meshCommand.ts`、`memoryCommand.ts` 与 `doctorCommand.ts`；
- 在 `apps/cli/src/cli.ts` 注册各子命令与别名；
- 阶段一门禁：
  - `npx vitest run apps/cli/src/commands/meshCommand.test.ts apps/cli/src/commands/memoryCommand.test.ts apps/cli/src/commands/doctorCommand.test.ts` 全部通过；
  - 阶段一完成后直接进入阶段二，不等待人工介入。

### 阶段二：会话后自主反思与经验提炼引擎 (对标任务 186)
- 在 `packages/memory/src/reflection/` 落地实现 `AutonomousReflectionEngine` 与事件轨迹分析器；
- 在 `packages/context/` 确保新沉淀的经验能被 Prompt 组装层即时混合检索并注入；
- 阶段二门禁：
  - `npx vitest run packages/memory/src/reflection/autonomousReflection.test.ts` 全部通过。

---

## 3. 架构红线与禁做铁律 (必须遵守)

1. **薄核（Thin Core）**：保持 `packages/core` 纯净，严禁给 Core 添加任何机制依赖。
2. **严禁调用真实外部 Agent**：所有测试与诊断使用本地 Mock 离线仿真，严禁拉起本机真实外部 agent。
3. **回收站纪律**：除在 `os.tmpdir()` 创建的测试自建临时目录外，严禁硬删任何文件。
4. **包管理器锁定**：锁定 npm，严禁引入 `pnpm`/`bun`/`yarn` 锁文件。

---

## 4. 终态统一完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 定向测试全绿：
   - `npx vitest run apps/cli/src/commands/meshCommand.test.ts apps/cli/src/commands/memoryCommand.test.ts apps/cli/src/commands/doctorCommand.test.ts packages/memory/src/reflection/autonomousReflection.test.ts`
2. 类型构建双绿：
   - `npx tsc -b tsconfig.json` (exit 0)
   - `npm run typecheck:tests` (exit 0)
3. 全量回归测试双 Root 保持全绿：
   - `npm run test:all` (根套件 221+ 文件与 apps/web 独立套件全部通过)
4. 更新任务卡状态为「本地全门禁通过；待验收」，输出交付工作证明。

## 本地交付证据（2026-10-03）

按 184 → 186 顺序完成，独立审查无剩余阻塞项。
最终定向 4 文件 / 18 passed；类型构建与测试类型检查均 exit 0。
双 Root：根 225 文件 / 2554 passed + 6 skipped；Web 16 文件 / 154 passed。
修改清单、日志与运行边界见 [V2.0 交付记录](../docs/V2.0-IMPLEMENTATION-NOTES.md)。未修改 packages/core，未调用真实外部 Agent，未 commit / push；待维护者验收。
