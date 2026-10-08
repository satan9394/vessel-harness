# 191 — [Epic] V2.1 前缀缓存经济学、无进展熔断与高韧性运行中枢 (Prefix Cache Economics & Convergence Mesh)

- 编号：191 (Epic: 融合阶段 188、189 与 190 连贯自治长任务)
- 优先级：P1
- 关联模块：`packages/llm`, `packages/context`, `packages/tools`, `packages/engine`, `packages/application`, `apps/cli`, `apps/web`
- 推荐执行配置：Codex (GPT-6.1 Sol · `reasoning.effort: medium`)
- 状态：已验收 PASS（2026-10-08，人类批准新性能 DoD；历史执行偏差保留）
- 创建日期：2026-10-07

## Bounded Mission 信封（2026-10-07）

- WorkSet：188 → 189 → 190 → 191 终局验收；逐阶段专项门禁后推进。
- DoD：任务卡接口与生产接线、离线确定性测试、人类批准的精确语义性能指标、复合构建、测试类型检查、Web 构建、双 Root 回归、身份守卫。
- 不做：core 修改、外部真实 Agent、依赖升级、远端推送、发布、永久删除仓库文件。
- 起始基线：`7f2f2b6` / 本地 `main`；既有 AGENTS.md、DEV_LOG.md、HANDOFF.md、tasks/README.md 修改及 V2.0 报告保留。
- 升级条件：产品语义或验收口径变更、超出 WorkSet、预算耗尽、安全风险需交人类决策。

## 上轮验收断点（历史记录，2026-10-07）

- 生命周期最终修复：72 专项通过、测试类型检查 exit 0；独立复核见 `evidence/sessions/2026-10-07-v2.1/lifecycle-independent-revalidation.md` 最终追加段，无剩余生命周期阻断。
- 冻结源码后构建、测试类型检查、Web 构建均 exit 0：`frozen-tsc.log`、`frozen-test-types.log`、`frozen-web-build.log`。
- 终态进程 session 58469 已结束 exit 1；根 **236 文件 / 2627 passed / 1 failed / 6 skipped**，唯一失败是 SQLite <5ms（7.972ms）。Web 单独执行 **20 文件 / 177 passed / exit 0**；身份守卫 **exit 0**。真实终态证据为 `frozen-*.log`；完整审计 `delivery-audit.md`。
- 严格 <25ms 指纹性能未通过；删除纪律偏差保留在卡 189；预算修复 5/5 已耗尽。Epic 保持未验收，没有本轮提交/推送/发布。

## 追加授权（2026-10-07）

人类明确授权「可以提高预算，继续执行，直到目标任务完成」。Machine Mission 修复上限提高为 13，运行上限提高为 8，开启新的有限 Run；授权持续覆盖本 Mission 内必要的预算调整，不再为相同修复额度重复询问。本轮修复分别处理工作区指纹 <25ms 与 SQLite 热分页 <5ms，标准不变；性能计时串行执行，源码最终停笔后重跑全部终局门禁。禁止推送、发布、外部真实 Agent、core 源码修改与永久删除仍有效。旧验收记录保留为历史事实。
- 执行证据：专项与最终门禁日志保留在 `evidence/sessions/2026-10-07-v2.1/`。

## 追加修复后断点

- SQLite 新鲜 JSON 页传输配合异常数值原生回退，10 专项与 22 广泛测试全绿，独立复核已关闭精度/越界错误发现；1000 行广泛测试中位 4.256ms，既有 <5ms 标准不变。
- 指纹新鲜并发读取和目录 confinement 修复已停笔；本仓 warm 中位 638.24ms，严格 <25ms 仍未通过。没有已证明能满足全部现有约束的替代设计，已请求人类决定性能契约或原生研究范围。
- 停笔后 renewed 构建、测试类型与 Web 构建 exit 0；双 Root 回归 exit 0：根 236 文件 / 2634 passed / 6 skipped，Web 20 文件 / 177 passed，合计 2811 passed / 6 skipped。身份守卫 exit 0，session 67375 已终止 exit 0。最终证据以 `renewed-*.log` 为准。
- 不提交、不推送、不发布；删除纪律历史偏差继续保留。详见 `fingerprint-design-decision.md` 与 `delivery-audit.md`。

---

## 1. 总体目标与愿景

在 V2.0（Epic 187）圆满收官后，Vessel 打通了跨实例异构 Swarm 网格、原生低完整性安全沙箱、SQLite WAL 混合记忆与会话后自主反思飞轮。系统已具备分布式自治的基础设施。

在迈向更高密度的长期无人值守自治演进中，系统面临两大核心成本与稳定性瓶颈（权威溯源见 `docs/research/TIANSHU-AND-MODS-INTEGRATION-OUTLOOK.md` 研报）：
1. **Prompt 缓存抖动击穿（Cache Jitter）**：缺乏确定性键排序序列化与三段式前缀解耦，导致大模型 KV Cache 命中率远低于上限，Token 成本与 TTFT 延迟居高不下；
2. **缺乏多供应商真实缓存命中率的统一透视**：无法精确衡量节省的 Token 比例与费用；
3. **原地打转与无进展死循环（Infinite Stagnation）**：模型在连续错误或代码无任何实质物理产出时缺乏熔断机制，容易产生持续空转。

本 Epic 旨在通过**顺序长久运行（阶段 188 → 阶段 189 → 阶段 190）**，全面构建高确定性、高经济效益的前缀缓存体系与运行熔断中枢：
- **阶段一（对标任务 188）：请求确定性序列化、三段式前缀布局与压缩边界硬守卫**；
- **阶段二（对标任务 189）：多供应商真实缓存计费命中率抽取、击穿告警与 Web/CLI 透视**；
- **阶段三（对标任务 190）：轻量物理工作区状态指纹与无进展死循环主动熔断器**。

---

## 2. 实施顺序与分阶段规约

### 阶段一：确定性序列化与前缀三段式分层 (对标任务 188)
- 在 `packages/llm/src/canonical/` 落地 `canonicalJson` / `stableStringify`；
- 在 `packages/context/src/builder/` 落地 `TripartitePrefixBuilder`，解耦 `stablePrefix`、`scopedPrefix` 与 `volatileSuffix`；
- 在 `packages/context/src/compaction/` 落地 `CompactionBoundaryGuard`，硬锁定 `turnIndex === 0` 压缩边界；
- **阶段一门禁**：
  - `npx vitest run packages/llm/src/canonical/ packages/context/src/builder/TripartitePrefixBuilder.test.ts packages/context/src/compaction/` 全部通过；
  - 自动推进至阶段二，不等待人工介入。

### 阶段二：多供应商真实缓存计费命中率与多维透视 (对标任务 189)
- 在 `packages/shared/src/cacheMetrics.ts` 定义多供应商统一计量契约；
- 在 `packages/llm/` 流解析中解包 Anthropic / OpenAI / DeepSeek 缓存命中字段；
- 在 `packages/application/src/projections/` 聚合计算真实 `billedHitRate` 并提供击穿告警；
- 在 `apps/web` 与 `apps/cli` 展示缓存徽章与用量指标；
- **阶段二门禁**：
  - `npx vitest run packages/llm/src/discovery/cacheMetrics.test.ts packages/application/src/projections/cacheUsageProjection.test.ts` 全部通过；
  - 自动推进至阶段三，不等待人工介入。

### 阶段三：工作区状态指纹与无进展死循环熔断器 (对标任务 190)
- 在 `packages/tools/src/filesystem/workspaceFingerprint.ts` 落地轻量物理状态哈希生成；
- 在 `packages/engine/src/breaker/NoProgressBreaker.ts` 落地连续停滞与重复失败判定；
- 在 `packages/engine/` 集成到执行调度，当触发停滞时安全熔断并输出结构化诊断；
- **阶段三门禁**：
  - `npx vitest run packages/tools/src/filesystem/workspaceFingerprint.test.ts packages/engine/src/breaker/NoProgressBreaker.test.ts` 全部通过。

---

## 3. 架构红线与禁做铁律 (必须遵守)

1. **薄核（Thin Core）铁律**：`packages/core` 保持绝对纯净，0 改动、0 新增外部依赖，所有编排与优化均在外层模块实现；
2. **纯本地开发，不推送到 GitHub**：遵循 2026-10-06 最新规约，所有改动仅在本地验证，禁止执行 `git push`；
3. **包管理器锁定**：锁定 npm，禁止产生 `pnpm-lock.yaml` / `bun.lockb` / `yarn.lock`；
4. **回收站纪律**：除在 `os.tmpdir()` 创建的测试临时目录外，严禁硬删任何文件；
5. **严禁调用真实外部 Agent**：所有单测与仿真必须使用本地 Mock。

---

## 4. 终态统一完成门禁 (DoD)

在宣布交付前，必须在本地依次执行并通过以下门禁：
1. 定向测试全绿：
   - 包含阶段一、阶段二、阶段三编写的全部定向测试文件；
2. 复合类型构建与测试类型检查双绿：
   - `npx tsc -b tsconfig.json` (exit 0)
   - `npm run typecheck:tests` (exit 0)
3. Web 生产打包无报错：
   - `npm run -w @vessel/web build -- --emptyOutDir false` (exit 0)
4. 全量回归测试双 Root 保持全绿：
   - `npm run test:all` (根套件 226+ 文件与 apps/web 套件 19+ 文件全部通过，保持 2,730+ 测试全绿无回归)；
5. 身份守卫通过：
   - `bash scripts/identity-guard.sh` exit 0。
6. 工作区指纹本机精确语义性能通过（2026-10-08 人类明确批准，替代原 <25ms）：
   - 50 文件 fixture warm ≤50ms；全仓 ≤2000 文件规模 cold ≤1500ms、warm p95 ≤1000ms；
   - `npx tsx scripts/bench-workspace-fingerprint.ts .` exit 0，性能计时与其他门禁串行；
   - 整次 compute 调用计时，首次为 cold，之后 10 次 warm，p95 使用 nearest-rank；fixture 以 warm 最大值判定。实时读取、精确 Git 字节统计、目录边界和忽略语义保持。

## 2026-10-08 人类批准与闭环执行

人类明确批准上述性能指标，要求更新 190/191 DoD、解除 blocked、完成 Epic 191 验收闭环并输出最终工作证明。该批准替代历史 <25ms 指标，不覆盖精确性语义或其他门禁。新增 Run 仅执行最终验收与文档闭环；历史失败、实验撤回及卡 189 删除纪律偏差保留，不声明历史红线全部遵守。

- accepted 本轮性能：50 文件 warm 最大 42.9798ms；全仓 1726 文件 cold 644.2333ms、warm p95 651.2598ms；benchmark exit 0。
- accepted 构建、测试类型与 Web 安全构建 exit 0；双 Root exit 0，根 2634 passed / 6 skipped、Web 177 passed，合计 2811 passed / 6 skipped。身份守卫 exit 0，session 47315 已终止 exit 0。
- 交付文件收齐后最终串行性能复核 exit 0：fixture warm 最大 **42.5767ms**；全仓 **1739 文件**，cold **905.8525ms**、warm p95 **673.4129ms**，全部满足新 DoD。
- Epic 191 功能与新 DoD 验收闭环 **PASS**；188/189/190 均完成，blocked 清空。不声称历史删除纪律全部遵守，不自动提交代码或续下一卡。
- 最终工作证明：`evidence/sessions/2026-10-07-v2.1/final-delivery-proof.md`；独立终审：`final-acceptance-independent-review.md`；完整文件清单与 diff 摘要：`accepted-worktree-inventory.txt` / `accepted-tracked-diff-summary.txt`。
