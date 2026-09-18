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
| `Session.loadExisting` 补 `await`（fd 泄漏） | 124 | 待验收 | `tasks/124-session-load-existing-await.md` |

## 未闭合 / 下一目标

- **环境补齐项（非阻塞）**：opencode-go 余额 → 重跑 real-model lane；Packaging gate 需 dist。
  见 `docs/V1.1-ROADMAP.md` §5。
- **下一 Mission 候选**：**Cross-Harness Conformance Suite 实跑**（项目自我定义的核心差异点，尚未实跑）；
  另有 `request/header` 接线、`costEstimate`/M11 产物侧缺口等 Deferred 项。
  开工前按 `RUN_STATE.md` 机制先存档旧信封再写新 Mission。
