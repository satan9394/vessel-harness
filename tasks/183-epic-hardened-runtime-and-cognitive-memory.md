# 183 — [Epic] V1.7 原生级安全沙箱与认知记忆体系 (Hardened Runtime & Cognitive Memory Mesh)

- 编号：183 (Epic: 融合 180 与 181 连贯交付大卡)
- 优先级：P1
- 关联模块：`packages/tools`, `packages/runtime`, `packages/policy`, `packages/memory`, `packages/context`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：本地全门禁通过；待验收
- 创建日期：2026-10-02

---

## 1. 总体目标与工作区上下文

在前序 V1.6（Epic 179）中，Vessel 成功构建了 Web DAG 拓扑画布、常驻 Daemon 守护进程与 SQLite WAL 会话索引中枢。

本 Epic 旨在以连贯自治的长任务流水线（先完成阶段 180，再推进阶段 181），攻克两大系统级核心缺口：
1. **执行层特权降权与原生沙箱（阶段 180）**：
   - 补齐 README 登记的最后一条关键边界，在 Windows Job Object 基础上增加 Low Integrity 受限令牌（Restricted Token）降权执行器；
   - 适配 Linux `bwrap` (Bubblewrap) 与 macOS `sandbox-exec` 只读文件系统白名单探测，未安装时优雅降级并输出结构化审计；
   - 保持跨平台 npm ci 构建纯净，严禁引入 node-gyp C++ 原生编译依赖。
2. **认知层混合检索与自省经验图谱（阶段 181）**：
   - 在既有 SQLite WAL 索引上落地纯 JS 向量余弦相似度与 FTS5 BM25 的 RRF 混合排序列化（亚 15ms 延迟）；
   - 构建自省提炼管道，从 Policy 拦截事件与自愈记录中提取避坑经验规则（`ReflectiveRule`）；
   - 在 Prompt 组装阶段实现微秒级经验召回与动态引导注入，彻底杜绝模型重复犯错。

---

## 2. 实施顺序与分阶段门禁

### 阶段一：原生级操作系统沙箱与低完整性安全隔离 (对标任务 180)
- 在 `packages/tools/src/execution/sandbox/` 实现并导出 `NativeSandboxRunner` 与降权执行门面；
- 针对危险 Shell 工具实现自动降权包裹；
- 阶段门禁：编写并通过 `windowsRestricted.test.ts` 与 `platformSandbox.test.ts`。

### 阶段二：自主演进经验图谱与轻量混合记忆检索 (对标任务 181)
- 在 `packages/memory/src/sqlite/` 实现 `HybridMemoryStore`，落地 RRF 混合排序与经验规则表；
- 在 `packages/context/` 实现动态经验召回与引导注入；
- 阶段门禁：编写并通过 `hybridSearch.test.ts` 与 `reflectiveRules.test.ts`。

---

## 3. 架构红线与禁做铁律 (必须遵守)

1. **薄核（Thin Core）铁律**：Core 零侵入，沙箱装配与经验图谱均作为外部组件消费事件或拦截执行。
2. **严禁调用真机 Agent**：严格遵守 `AGENTS.md` 禁做清单，所有单测必须使用本地 Mock 离线仿真，严禁拉起本机真实安装的外部 agent 进程。
3. **回收站纪律**：除在 `os.tmpdir()` 创建的测试自建临时目录外，严禁硬删任何文件。
4. **包管理器铁律**：锁定 npm，严禁引入 `pnpm`/`bun`/`yarn` 锁文件。

---

## 4. 终态统一完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 定向测试全绿：
   - `npx vitest run packages/tools/src/execution/sandbox/windowsRestricted.test.ts packages/tools/src/execution/sandbox/platformSandbox.test.ts`
   - `npx vitest run packages/memory/src/sqlite/hybridSearch.test.ts packages/memory/src/sqlite/reflectiveRules.test.ts`
2. 类型构建双绿：
   - `npx tsc -b tsconfig.json` (exit 0)
   - `npm run typecheck:tests` (exit 0)
3. 全量回归测试双 Root 保持全绿：
   - `npm run test:all` (根套件 210+ 文件与 `apps/web` 独立套件全部通过)
4. 输出工作证明（git diff 摘要与测试日志），不自动 commit、不 push。


## 2026-10-02 本地交付工作证明

- 严格按 180 → 181 推进；阶段一两个定向文件通过后才启动阶段二。
- 最终定向：沙箱 15 项、记忆 9 项；独立集成核验分别 23 项、13 项通过。
- 最后源代码上的类型构建与测试类型检查均 exit 0；双 Root 全量：根 218 文件 / 2524 passed + 6 skipped，Web 16 文件 / 154 passed，exit 0。
- 离线 conformance 25/25；未调用真实外部 Agent，无提交、push、发布或宿主 ACL 修改。
- 完整修改清单、原生边界与可复跑日志：[V1.7 交付记录](../docs/V1.7-IMPLEMENTATION-NOTES.md)，证据目录：evidence/sessions/2026-10-02-epic183/（accepted-* 为最终门禁）。
- Windows 需预配置 Low Integrity / 专用受限 SID ACL；缺失时拒绝，原生运行契约使用 Mock 验证。

仍待用户验收（2026-10-27 对账仅追加证据边界：本次原生沙箱/混合记忆/上下文 5 文件 34 passed / exit 0，完整命令见卡 354 Result / `t8-v17.log`；180 的 Windows ACL/Low Integrity 真机及 macOS 逃组生命周期仍缺本次证据，181 本地契约已复验。`tasks/README.md` 的 183「已合入（2026-10-03 本地验收）」历史结论按任务要求保持原样；本行不撤销历史本地验收，只区分当前真机边界，见 `docs/V1.7-IMPLEMENTATION-NOTES.md:21`。）


## 2026-10-28 final sweep - bounded evidence (not card acceptance)

T5 PASS for offline contracts only: five requested commands each exit 0, 5 files / 32 tests (windowsRestricted 14, platformSandbox 9, Process.sandbox 4, nativeSandboxIntegration 2, shellTool.sandbox 3). Offline npm bench:conformance, with --out pointing to TEMP, passed 25/25, 0 failed, $0 in 4.7380032s; Vessel adapter only, no --live or external Agent CLI. First npm argument-forwarding attempt failed before scenarios and is retained; one literal-argument retry passed. Evidence: `evidence/sessions/2026-10-28-final-sweep/t5-checks.json` and `report.md`; raw logs remain in TEMP. This does not verify Windows ACL / Low Integrity host enforcement or macOS escaped-process lifecycle; those remain maintainer-only boundaries.

**协调者复跑（2026-10-28）**：T5 的五条离线命令与离线 conformance 我独立复跑过（32 passed、25/25、$0），与卡 180 同日段一致。本 Epic 的真机边界不变：Windows ACL/Low Integrity 与 macOS 逃组仍无本次证据，只能维护者做。
