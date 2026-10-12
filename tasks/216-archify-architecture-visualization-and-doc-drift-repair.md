# 任务卡 216：项目整体逻辑架构可视化与文档包清单漂移修复 (Archify Architecture Visualization & Doc-Drift Repair)

**状态**：本地已验证（2026-10-12，待维护者验收）
**负责人**：OpenCode (搭载 DeepSeek-v4.1-Flash)
**模式**：standard（一卡一闭环，交证即停）
**Source**：human-requested（用户要求用 star 的 archify 可视化本项目整体逻辑架构，供后续优化）
**Risk**：low（仅新增文档产物与文档修正，`packages/` 零改动、无外部副作用、纯本地不提交）
**前置基线**：HEAD `9c764b8`（V2.6/Card 215 之后）
**交付证据**：本卡 + `docs/diagrams/README.md` + 各图 `*.finalize*.json` / `*.browser-check.json` 回执

---

## 1. 目标与背景

用户希望把本仓的**整体逻辑架构**可视化，用于后续优化。选定工具为其 GitHub star 的 **archify**（`tt-a1i/archify`，MIT，agent skill，支持 OpenCode / Claude Code / Codex）。

可视化同时暴露了一处文档漂移：`docs/ARCHITECTURE.md` §6.1 的包目录树落后于真实代码（少列 `engine` 等）。本卡一并修复，避免"图对、doc 错"的二次误导。

## 2. 交付内容

### 2.1 Archify 架构可视化（5 类图 → `docs/diagrams/`）

| 图 | 类型 | 内容 |
|---|---|---|
| `vessel-architecture-overview.html` | architecture | 14 包 + 3 app + benchmarks 总览、薄核 core、机制层、子系统层、shared 契约、依赖方向 |
| `vessel-turn-sequence.html` | sequence | 一轮 turn：A03 before_turn → A07/A08/A09 → A10 → A12 → Runtime → A04 → A06 |
| `vessel-policy-workflow.html` | workflow | Policy 六步裁决 + guard 单调 + fail-closed + 审计落点 |
| `vessel-behavior-pipeline.html` | dataflow | Behavior IR 编译管线 L0→L4 与双通道强制 |
| `vessel-context-lifecycle.html` | lifecycle | Context 组装缓存 + Compaction 三入口事务化替换 |

- 每张为**自包含可交互 HTML**，节点带 `SRC` 证据、钉在 commit `9c764b8`；`finalize --quality showcase` 四门（validate/deliver/check/browser-check）全绿。
- 随产物保留 5 个可编辑源 JSON（typed IR）+ README 索引；skill 装在 `.agents/skills/archify/`（仓库内、OpenCode 可发现）；`.archify/` 生成工作目录入 `.gitignore`。

### 2.2 文档包清单漂移修复

- `docs/ARCHITECTURE.md` §6.1：补 `engine`（13→14）、补 `apps/local-server` 与 `apps/web`、`vitest.workspace.ts` → 真实的 `vitest.config.ts`（双 root 说明）。
- `docs/product-audit/ARCHITECTURE-REPORT.md`：`packages 13 个` → 14。
- `docs/Vessel_后续开发方向与产品化路线_v1.0.md`：`约 13 个` → 14，包清单补 `application`。
- `docs/diagrams/README.md`：漂移记录改为「已修复」。

## 3. Not Doing / Constraints

- 不改 `packages/`（薄核零侵入）；不引入非 npm 锁文件。
- 不改历史快照类文档（如 `V1.0-CHECKPOINT` / `V1.3-ROADMAP`），属 A4「文档诚实化」范围。
- 不提交 / 不推送（2026-10-06 纯本地开发规约）。
- 不驱动本机其它 agent；`bench:conformance -- --live` 不跑。

## 4. Acceptance Criteria

- [x] 产出 ≥4 类分层图，落 `docs/diagrams/`，每张 `finalize` 四门 exit 0（回执为证）。
- [x] 节点带 `SRC` 源证据、`meta.repository.revision` = HEAD 40 位 commit。
- [x] 文档漂移修复且不破坏既有守卫：`turnEndConditionGuard.test.ts` 定向 43 passed。
- [x] 全量门禁：`tsc -b` exit 0、`test:all` 双 Root 全绿。
- [x] 记忆落盘：`DEV_LOG.md` + `HANDOFF.md` 日志索引。

## 5. Blast Radius

- 入口 / 调用方：无（纯新增文档与文档修正，无代码路径）。
- 接口 / 数据：无。
- 测试：`packages/telemetry/src/turnEndConditionGuard.test.ts`、`telemetry.test.ts` 读取 `docs/ARCHITECTURE.md`（按**内容唯一前缀**锚定，非行号）——已定向复跑确认无回归。
- 配置：`.gitignore` 增 `.archify/`。

## 6. Result

- **Verdict**：PASS（本地）。
- **Evidence**：
  - `npx tsc -b tsconfig.json` exit 0；
  - `npm run test:all` 双 Root：根 268 文件 / **2873 passed + 6 skipped**，Web 33 文件 / **282 passed**，exit 0；
  - `packages/telemetry` 定向 43 passed（文档锚点守卫无回归）；
  - `docs/diagrams/`：5 HTML + 5 源 JSON + 回执 + README。
- **Residual risk**：
  - 一次 `packages/context` 的 `symbolGraph` 性能断言（mean ≤15ms）在全量长跑中抖动失败，单独复跑 12/12 通过 ⇒ 机器负载时序抖动，非本次文档改动引起（已如实登记）。
  - archify 为第三方 skill（MIT），`.agents/skills/archify/` 体积约 10 MB（含 3.9 MB 示例）；是否入版本库由维护者决定。
- **Resume**：产物与文档修复均在**工作区未提交**；维护者决定提交范围（建议一次范围清晰的本地提交）。
