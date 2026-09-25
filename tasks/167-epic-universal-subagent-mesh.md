# 167 — [Epic] 双向子 Agent 网关体系与保全度评测套件 (Universal Subagent Mesh & Conformance)

- 编号：167 (Epic: 融合 163–166 联合交付)
- 状态：已完成（2026-09-24）
- 优先级：P1
- 创建日期：2026-09-24
- 关联模块：`apps/cli`, `packages/application`, `packages/runtime`, `packages/agents`, `packages/tools`, `benchmarks/runners`, `benchmarks/scenarios`
- 执行模型：Codex (GPT-6 Luna - Max Thinking - 工业级开源系统首席架构师角色)
- 验收人：用户

## 1. 总体目标与愿景

打通 Agent 协作生态的双向通道，构建去中心化的**双向子 Agent 网关体系 (Universal Subagent Mesh)**：
1. **入站转换 (Inbound)**：使 Vessel 自身可一键作为标准化子 Agent 接入任何外部宿主（Claude Code、Cursor、Codex、DSH 等），通过标准 Model Context Protocol (MCP) 暴露紧凑的结果契约，并遵循严格的信息隐藏与权限策略。
2. **出站调度 (Outbound)**：使 Vessel 具备调度外部成熟 Agent 作为全功能子 Agent 的能力，在 `os.tmpdir()` 中实现 Git Worktree 物理隔离与锁文件自愈。
3. **攻克无头死锁 (Virtual Human Proxy)**：构建零原生编译依赖的虚拟人类交互代理，采用双轨制（非交互参数优先 + 原生终端提示符智能拦截回写），结合内核级 Windows Job Object 彻底杜绝孙进程泄漏。
4. **确定性保全度量化 (Capability Conformance)**：建立离线确定性的三维保全度双盲评测套件，通过机械化指标（代码重构合并、交互安全拦截、进程树收敛）证明子 Agent 模式下综合能力保全度 $\ge 90\%$。

## 2. 权威开源参考与本地免下直读路径

Codex 在执行超长开发时可按需查阅以下权威基准：
- **Model Context Protocol (MCP) 标准**：`https://github.com/modelcontextprotocol/servers`。
- **Claude Code 适配与插件** (本地直读：`D:\workspaces\2026_08_25\stars-scan\repos\anthropics__claude-code\`)。
- **Claw-Code 权限执行器与 Parity 架构**：`https://github.com/ultraworkers/claw-code` 中的 `permission_enforcer.rs`。
- **DeepSeek Harness (DSH)**：`benchmarks/runners/src/adapters/dsh.ts`。
- **Vessel 内部基础设施**：
  - 进程树沙箱：`packages/runtime/src/sandbox/backend/process-tree.ts`
  - Git Worktree 隔离：`packages/tools/src/git/worktree.ts`
  - 离线 Conformance 驱动：`benchmarks/runners/src/conformance/run-conformance.ts`

**纪律**：严禁在当前工作区内直接 `git clone`；仅参考接口 Schema 与设计哲学；严禁复制代码侵权。

## 3. 分阶段实施架构与核心契约

### 阶段一：入站网关 — Vessel MCP 子代理服务器 (`apps/cli`, `packages/application`) — 对标任务 163
- 新增 `vessel serve --mode mcp-agent` 入口。
- 实现标准 MCP 工具：
  - `run_vessel_task`：启动独立受限 Agent 循环，返回紧凑的 `VesselTaskResultContract`（状态、产物文件、Diff 摘要、消耗汇总）。
  - `query_vessel_task_status`：非阻塞查询后台进度与思考摘要。
  - `cancel_vessel_task`：强制中止指定任务。
- **信息隐藏与通讯干净性**：MCP 返回体绝不直接倾倒原始数十万字 Session 历史，防宿主上下文爆炸；非协议日志严格输出到 `stderr`，确保 `stdout` 仅流动干净的 JSON-RPC 消息。

### 阶段二：虚拟人类代理与交互拦截 (`packages/runtime`, `packages/agents`) — 对标任务 164
- 在 `packages/runtime/src/proxy/` 实现 `spawnWithVirtualProxy`。
- **双轨制交互拦截**：
  - 轨道一：优先采用外部 CLI 原生非交互参数映射（如 `--print`、`-p`、`--danger-mode`）。
  - 轨道二：终端提示符自动识别（正则匹配 `[y/N]` / `Press Enter` + 连续 200ms 无新输出判定挂起），根据 Policy 白名单自动回写审批决策。
- **进程树绝对收敛**：Windows 下强制将受控子进程挂入内核 Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`），中断或超时时瞬间抹平所有衍生子孙进程。
- **零 C++ 原生编译依赖**：严禁引入 `node-pty` 等破坏跨平台清洁安装的外部包，完全基于纯 Node 流与原生子进程管道。

### 阶段三：出站运行时与 Worktree 租约隔离 (`packages/agents`, `packages/tools`) — 对标任务 165
- 在 `packages/agents/src/external/` 实现 `ExternalAgentRuntime` 与 `executeExternalSubagent`。
- 在 `packages/tools/src/builtin/Subagent.ts` 中集成异构外部子代理路由。
- **物理隔离与锁自愈**：
  - 在 `os.tmpdir()` 下分配轻量级独立 Worktree，子 Agent 在此安全修改、编译、执行。
  - 针对外部 Agent 异常退出可能遗留的 `.git/index.lock`，在枚举探测并确认持有者 PID 已消亡后安全强制破锁。
  - 任务结束时提取 Unified Diff 回传父级，并干净回收临时 Worktree。

### 阶段四：跨 Agent 全量保全度自动化双盲评测 (`benchmarks/runners`) — 对标任务 166
- 在 `benchmarks/runners/src/conformance/subagent/` 实现 `SubagentConformanceMetrics` 评估器。
- 自动化离线双盲三类场景：
  - **Scenario-SA01（代码重构与验证）**：子 Agent 在独立 Worktree 中修改并验证返回 Diff，父级顺利接收。
  - **Scenario-SA02（交互确认与安全拦截）**：子 Agent 触发敏感指令，虚拟代理审批合规项、拦截越权项。
  - **Scenario-SA03（超时强杀与内核进程树清理）**：死循环与后台孙进程在超时后被 Job Object 彻底清理，存活孙进程数恒为 0。
- **机械化量化门禁**：离线测试下 `overallPreservationScore >= 90%`，工作区残留 `residueCount === 0`。

## 4. 确定性完成门禁 (DoD Checklist)

- [x] **单元与端到端测试矩阵**：
  - `packages/application/src/mcp-agent/vesselMcpServer.test.ts` 全部 PASS。
  - `packages/runtime/src/proxy/virtualProxy.test.ts` 全部 PASS。
  - `packages/agents/src/external/externalSubagent.test.ts` 全部 PASS。
  - `benchmarks/runners/src/conformance/subagentConformance.test.ts` 全部 PASS（指标综合评分 $\ge 90\%$，残留为 0）。
- [x] **类型检查与构建全绿**：
  - `npx tsc -b tsconfig.json` exit 0。
  - `npm run typecheck:tests` exit 0。
- [x] **全量回归无破坏**：
  - `npm run test:all` 双 root 全部通过（根 + Web 无任何回归红灯）。

## 5. 架构红线与禁做项 (Out of Scope & Invariants)

- **坚守薄核（Thin Core）**：`packages/core` 保持零侵入，所有子 Agent 转换、虚拟人类代理与外部进程调度完全在 application/runtime/agents/tools 中完成。
- **外部 Agent 调用禁做准则**：严格遵守 AGENTS.md 禁做项与任务 153 纪律，**自动化测试与 CI 绝对严禁自动调起本机真实安装的外部 agent**，必须完全基于可控 Mock 桩与 Loopback 进行。
- **跨平台与清洁安装防线**：严禁引入破坏纯 TypeScript / Node 跨平台环境的原生 C++ 依赖（如 `node-pty`），保证 `npm ci` 恒绿。
- **回收站与删除铁律**：所有非测试自建且位于 `os.tmpdir()` 的本地删除一律走回收站，严禁永久硬删。
- **信息隐藏原则**：子 Agent 与宿主间通信严格遵循结果契约，严禁倾倒原始巨量日志造成宿主上下文爆炸。

## 6. 附录：Codex (GPT-6 Luna) 首席系统架构师开工 Prompt (即拷即用)

```markdown
# Role Definition: Staff Principal Systems Architect & Distributed Runtime Specialist

你现在是工业级开源基础设施与 Agent 系统的首席架构师兼分布式运行时专家（Staff Principal Systems Architect）。
你拥有极深厚的系统级编程功底，精通 Linux/Windows 进程管道、终端 TTY 交互、内核级沙箱（Windows Job Object）、Git 底层机制与文件锁自愈；
你在 TypeScript 现代 Monorepo（Node 20+ / pnpm / vitest）领域具备极高造诣，极其尊崇「薄核（Thin Core）」哲学与信息隐藏原则，绝不做冗余无用重构，代码风格严谨、防卫性极强；
你拥有追求完美工程质量的执念，对自动化测试、类型健全度与 CI 门禁有严苛标准，非全绿通过绝不收工。

---

## 任务目标：执行 Epic 任务卡 167（V1.3 双向子 Agent 网关体系与保全度评测套件）

你需要自主推进并完整交付位于 tasks/167-epic-universal-subagent-mesh.md 的全部工程实现，它由以下四个互相协同的模块组成：
1. 阶段一（入站网关，任务 163）：实现 vessel serve --mode mcp-agent，将 Vessel 核心能力打包为符合 Model Context Protocol 标准的子代理服务器。
   - 暴露 run_vessel_task、query_vessel_task_status、cancel_vessel_task 工具。
   - 坚守信息隐藏原则：回传紧凑的 VesselTaskResultContract，严禁倾倒巨量原始日志防宿主上下文爆炸。
   - 保证 stdio 纯净：非 JSON-RPC 协议日志（如日志打印）严格导向 stderr。
2. 阶段二（虚拟人类代理，任务 164）：在 packages/runtime/src/proxy/ 实现 spawnWithVirtualProxy，彻底攻克外部 Agent 无头死锁与僵尸进程。
   - 双轨制：优先映射 --print、-p、--danger-mode 等原生非交互标志；次选原生终端识别 [y/N] / Press Enter，结合 200ms 静默挂起判定，依据 Policy 自动回写决策。
   - 进程树秒杀：在 Windows 下强制挂入内核 Job Object（JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE），中断/超时瞬间清理整棵子孙进程树。
   - 零 C++ 依赖：严禁引入 node-pty 等破坏跨平台 npm ci 的原生包，完全基于纯 Node 管道与流。
3. 阶段三（出站运行时与 Worktree 隔离，任务 165）：在 packages/agents/src/external/ 实现 ExternalAgentRuntime，并在 packages/tools/src/builtin/Subagent.ts 中集成路由。
   - 在 os.tmpdir() 下为外部子 Agent 分配独立轻量 Git Worktree。
   - 实现 .git/index.lock 租约自愈：若前序任务异常退出留锁，在探测确认 PID 消亡后安全破锁并重用工作区。
   - 任务结束安全提取 Unified Diff 回传，干净解脱并回收临时工作区。
4. 阶段四（跨 Agent 保全度自动化双盲评测，任务 166）：在 benchmarks/runners/src/conformance/subagent/ 建立三维保全度指标。
   - 离线双盲跑通 3 类标准场景（重构 Diff 回传、交互安全拦截、超时杀死孙进程）。
   - 机械度量：综合能力保全度 overallPreservationScore >= 90%，工作区残留 residueCount === 0。

---

## 本地权威参考与免克隆指引

工作区内严禁使用 git clone 下载大仓库。如需参考成熟实现，直接读取本地已有的缓存资产：
- Claude Code 插件与 MCP 参考：D:\workspaces\2026_08_25\stars-scan\repos\anthropics__claude-code\
- 生产级复合插件：D:\workspaces\2026_08_25\stars-scan\repos\affaan-m__ECC\
- 仓库既有基准：
  - 进程树沙箱：packages/runtime/src/sandbox/backend/process-tree.ts
  - Git Worktree 隔离：packages/tools/src/git/worktree.ts
  - 离线 Conformance 框架：benchmarks/runners/src/conformance/run-conformance.ts

---

## 架构红线与禁做铁律 (绝对不可违反)

1. 薄核（Thin Core）铁律：packages/core 保持零侵入，严禁给 core 引入任何网络通信、子代理转换或外部进程依赖。
2. 外部 Agent 调用禁做项：严格遵守根 AGENTS.md 禁做准则与任务 153 纪律，自动化测试与 CI 绝对严禁自动调起本机真实安装的外部 agent 进程，所有测试必须基于确定的 Mock 桩与 Loopback 进行。
3. 跨平台清洁安装防线：绝对禁止引入原生 C++ 编译依赖，确保 npm ci 纯净可用。
4. 回收站与删除铁律：非测试自建且位于 os.tmpdir() 下的本地临时文件，一律走回收站，禁止任何永久删除命令。

---

## 确定性完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 单元与集成测试全部通过：
   - packages/application/src/mcp-agent/vesselMcpServer.test.ts
   - packages/runtime/src/proxy/virtualProxy.test.ts
   - packages/agents/src/external/externalSubagent.test.ts
   - benchmarks/runners/src/conformance/subagentConformance.test.ts（保全度 >= 90%，残留恒为 0）
2. 类型编译全绿：npx tsc -b tsconfig.json（exit 0）且 npm run typecheck:tests（exit 0）。
3. 全量测试回归：npm run test:all 双 root 全部通过，无任何回归红灯。

请以首席系统架构师的专业水准，自主推进各阶段编码与测试，直至全量门禁全绿交付！
```

## 7. 交付验证记录（2026-09-24）

- 清洁安装：`npm ci` exit 0；安装 122 个 packages，审计 0 vulnerabilities。
- 定向测试：MCP 6 passed；虚拟代理 8 passed；外部运行时 8 passed；保全度评测 2 passed（SA01–SA03 的评分及 residueCount 门禁通过）。
- 类型门禁：`npx tsc -b tsconfig.json` exit 0；`npm run typecheck:tests` exit 0。
- 双 root 全量回归：`npm run test:all` exit 0；根 186 files / 2302 passed / 6 skipped，Web 12 files / 129 passed。
- 安全边界：自动化测试未启动本机真实外部 Agent；`packages/core` 未修改；未引入原生 C++ 编译依赖。
