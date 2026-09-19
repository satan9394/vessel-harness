# tasks/ — 任务卡看板

> 个人开发工作流（personal-dev-workflow）在本仓库的进度载体。一张卡一个文件，状态写在卡内首行。
> 生命周期：拆卡 → 派活 → 交证 → 验证 → 验收 → 复盘。详见 skills/personal-dev-workflow 与根 AGENTS.md。

## 卡命名

`NNN-短横线描述.md`，如 `001-project-memory.md`；V1.1 路线卡用 `V1.1-<字母>-<短横线描述>.md`。
状态取值：待执行 / 执行中 / 待验收 / 已合入 / 打回。

## 怎么读这个目录

本目录是**进度事实源**，不在此维护一份会腐烂的汇总表。查进度请：

1. 看下表「路线层」——每个里程碑/版本收官时更新一次（现状：V0.1–V0.10 + V1.0 + V1.1 全部收官）。
2. 具体某卡的状态 → 直接读卡首行；卡面由执行者与指挥侧回填，含门禁实测数字与验收结论。

> 历史说明：本文件此前维护过一张止于 018 的硬编码表，早已与目录实况脱节，
> 且与 `docs/V1.1-ROADMAP.md`、`docs/V1.0-CHECKPOINT.md` 重复。现改为"路线索引 + 指向卡面"，
> 停止复制易腐的逐卡状态。
>
> **2026-09-18 对账**：014–122 的卡状态行此前多为「待执行/执行中/待验收」而实际已合入；
> 已批量改准为「已合入（2026-09-18 对账）」并在下一行保留**原状态文本**作历史层。
> 例外：`118`（已合入）、`119`（**部分完成**——S002/S006 恒真判据仍待加锁）。

## 路线层（里程碑级）

| 版本 / 路线 | 卡区间 | 状态 | 权威记录 |
|---|---|---|---|
| V0.1–V0.5（任务书主线） | 001-013 | 已合入（独立验收 PASS） | `docs/REVIEW-REPORT-V0{1..5}.md`、`docs/V0x-IMPLEMENTATION-NOTES.md` |
| V0.6–V0.10（产品化） | 014-031 | 已合入 | `CHANGELOG.md`（V0.1→V0.10 中英双语） |
| V1.0（Milestone A–G） | 032-084 | 已合入（收官） | `docs/V1.0-CHECKPOINT.md`、`docs/V1.0-ROADMAP-PROGRESS.md` |
| V1.1（A–F 六卡） | `V1.1-*.md` | 已合入（收官；余环境补齐项非阻塞） | `docs/V1.1-ROADMAP.md` |
| 产品演进 / 独立评审 | 085-122 | 已合入 | `docs/product-evolution/EVALUATION-REPORT-*.md`、`tasks/1xx` |
| CI 修复与安全加固 | 123 | 已合入 | `tasks/123-ci-tsc-build-repair.md` |
| `Session.loadExisting` 补 `await`（fd 泄漏） | 124 | 已合入（评审 PASS + 其发现的租约清理） | `tasks/124-session-load-existing-await.md` |
| Cross-Harness Conformance 驱动 + soak 默认参数修复 + 1.0 门槛核对 | 125-126 | 已合入 | `tasks/125-*.md`、`tasks/126-*.md`、`docs/V1.6-STABLE-CHECKLIST.md` |
| CLI/TUI 能力补齐（`vessel mcp` / `vessel diff` / TUI `/mcp` `/diff`） | 127-129 | 已合入 | `tasks/127-*.md`、`tasks/128-*.md`、`tasks/129-*.md` |
| 「两份实现」收敛（MCP 装配 / mock 文案 / guide locale） | 130-132 | 已合入 | `tasks/130-*.md`、`tasks/131-*.md`、`tasks/132-*.md` |
| 记忆同步 #1 + mock 冒烟脚本收敛 + B19 口径 + G-08 `vesselHome` + 文档补齐 | 133-138 | 已合入 | `tasks/133-*.md`…`tasks/138-*.md` |
| 记忆同步 #2 | 139 | 已合入 | `tasks/139-memory-sync-2.md` |
| 文档诚实化收尾（残余扫描 #2 / 已声明未实现标注 / by-design / `stream-json` 登记） | 140-143 | 已合入 | `tasks/140-*.md`…`tasks/143-*.md` |
| 记忆同步 #3 | 144 | 已合入 | `tasks/144-memory-sync-3.md` |
| 残留清算 B1：真实模型 lane 接场景 policy | 145 | 已合入 | `tasks/145-real-model-lane-scenario-policy.md` |
| 残留清算 B2–B5：已核实闭合 | 146 | 已合入 | `tasks/146-residual-b2-b5-verified-closed.md` |
| 记忆同步 #4 | 147 | 已合入 | `tasks/147-memory-sync-4.md` |

## 未闭合 / 下一目标

- **环境补齐项（非阻塞）**：opencode-go 余额 → 重跑 real-model lane；Packaging gate 需 dist。
  见 `docs/V1.1-ROADMAP.md` §5。
- **Cross-Harness Conformance**：驱动与可运行入口**已交付**（`npm run bench:conformance -- --all` 离线 25 场景 25 passed）；
  **待**一次 `--live` 真实跨 harness 基线（消耗 dsh/opencode/codex/claude 配额）→ 定回归阈值 → README/报告固化。
- **方向 B（残留清算）结果**：B1（真实模型 lane 不读场景 policy）**已修**（`tasks/145`）；B2–B5（B15/B11/B21 零产零消、
  `stage` 的 sandbox/guard、`BENCHMARK-SPEC` 漂移、M14 detail）**已核实闭合**、各有可执行守卫（`tasks/146`）。
- **外部阻塞（登记不空等）**：148 `--live` 基线；149 `release-report` 刷新；150 3h 墙钟 soak；151 1.0 门槛最终核验（停在 tag 前）。
- 开工前按 `RUN_STATE.md` 机制先存档旧信封再写新 Mission。
