# Evidence Index

> **归档日期**：2026-09-24
> **性质**：历史验证证据，归档保留，**不参与构建、不被 import**。仅供审计与复盘翻阅。
> 本次搬迁只做移动 / 改名 / 加索引，**未修改任何文件正文**。

## recovery/ — DSH 恢复三件套

从**仓库根**迁入 `evidence/recovery/`（2026-09-24）：

| 文件 | 原路径（根） |
|---|---|
| `DSH_RECOVERY_CHECKPOINT.md` | `DSH_RECOVERY_CHECKPOINT.md` |
| `DSH_RECOVERY_REPORT.md` | `DSH_RECOVERY_REPORT.md` |
| `DSH_RECOVERY_DOCS_SUPERSEDED.md` | `DSH_RECOVERY_DOCS_SUPERSEDED.md` |

注：同名文件的早期副本仍另行存在于 `.dsh-mission/backup/`（见下），本次未合并。

## missions/ — 各 Mission 冻结状态与验证证据

### mission-01/

| 文件 | 来源 |
|---|---|
| `RUN_STATE.md` | `.dsh-mission/RUN_STATE-mission-01.md`（重命名） |

Mission 1 目标：把「已裁决保留但验收 FAIL」的 `turn/end` Telemetry 切片推到可提交。

### mission-02/

| 文件 | 来源 |
|---|---|
| `RUN_STATE.md` | `.dsh-mission/RUN_STATE-mission-02.md`（重命名） |

Mission 2 目标：把 `turn/end` 文档条件变成可执行守卫 + 补四个无见证面的见证用例。

### mission-03/

| 文件 | 来源 |
|---|---|
| `RUN_STATE.md` | 仓库根 `RUN_STATE.md`（14415 B，逐字节复制） |

Mission 3（**已完成**）目标：清理 Mission 2 提交物上的残留措辞与一处漂移行号指针，并把未归因的 Node `DEP0137` 定位到具体文件/用例。

### missions/ 根下的散件

从 `.dsh-mission/` 直接提上来：

| 文件 | 来源 | 说明 |
|---|---|---|
| `recon-report.md` | `.dsh-mission/recon-report.md` | 侦查报告 |
| `release-notes-v0.10.0.md` | `.dsh-mission/release-notes-v0.10.0.md` | v0.10.0 发布说明 |

### missions/ 根下的历史证据日志

从 `.dsh-mission/evidence/*` 整体迁入（未再按 mission 细分，因文件名已自带 `C*` / `M2-` / `M3-` 前缀）：

- `C5-*` / `C5b-*` — 突变实测记录与日志（mission-03）
- `C6-*` — 全量测试与 `tsc -b` 日志（mission-03）
- `C7-*` / `C8-*` — 独立对抗评审判决与修复举证（mission-03）
- `M2-*` — mission-02 的评审判决、dep0137 归因、测试重跑日志、mission-1 对账
- `M3-*` — mission-03 的测试与 `tsc` 日志

## sessions/ — 按会话的工作记录（2026-09-27 起）

与 `missions/` 的区别：`missions/` 是 DSH bounded mission 的冻结证据；`sessions/` 是**一次普通会话**的完整记录（变更 + 行为 + 证据 + 未决项），面向"清空上下文后的接手者"，自带可复跑命令与教训清单。

| 文件 | 会话主题 |
|---|---|
| `2026-09-27-desensitization-and-governance.md` | 公开化脱敏（工作树 + 两次全历史改写）、GitHub 治理定型（不发布版本 / 必须走 PR / 三条必需检查）、身份守卫上线；含两次事故复盘、8 条自省与 5 项未决 |

## 相关的任务卡归档

各 Mission 的任务卡已迁入 **`tasks/_missions/`**：

- `tasks/_missions/mission-02/` ← 原 `.dsh-mission/tasks/` 中 `M*` / `W*` 前缀（8 张）
- `tasks/_missions/mission-03/` ← 原 `.dsh-mission/tasks/` 中 `C*` 前缀（10 张）

## `.dsh-mission/backup/`（原地保留，未移动）

规范明确要求原地保留，原因：内含 `.patch` 补丁与 3 个真实 `.test.ts` 代码文件，移动有引用断裂风险。此处仅登记索引。

内容：`backup-manifest.md`、`frozen-state.md`、`status-open.txt`、`status-close.txt`、`tasks-122-residuals-and-dep0137.md`；补丁 `turn-end-slice{,2,-final,-final2}.patch`、`mission2-slice-final{,2,3}.patch`、`mission3-slice-final.patch`；测试源 `turnEndBoundary.test.ts`、`turnEndConditionGuard.test.ts`、`turnEndWitness.test.ts`；另有 `DSH_RECOVERY_CHECKPOINT.md` / `DSH_RECOVERY_REPORT.md` 的早期副本。

注：`.dsh-mission/` 整体被 `.gitignore` 覆盖（`.gitignore`：`RUN_STATE.md`、`.dsh-mission/`），因此 **backup/ 不进版本库**，仅为本地资产。

## 状态文件的处置（2026-09-24 补丁）

`runstate.js` 是 **bounded 模式专用**的状态控制器：`validate()` 硬校验 `mode === 'bounded'`，
`check / gate / advance / render` 全部先跑它。本项目 Mission 3 已完成、**不进 bounded**，
按 v1.0.0 的 fail-open 语义（"未管理 = 放行"），**不应存在运行时状态文件**。

处置：

- `.agent-state/run-state.json` → 归档为 `missions/mission-03/run-state.json`
  （档案态，`mode` 保持 `standard`，不参与 `check`）
- 根 `RUN_STATE.md` → 原件 14415 B 已归档为 `missions/mission-03/RUN_STATE.md`，
  根上残留的 628 B 脚本模板已进回收站
- `.gitignore` 的 `.agent-state/` 规则**保留**，将来真进 bounded 时目录自动重建

> 风险提示：`save()` 每次都会覆写根 `RUN_STATE.md`。三个项目的该文件均被 gitignore、
> 从未入版本库，一旦被脚本覆盖无法用 git 找回。本项目的归档副本是其唯一版本化拷贝。

## `.dsh-mission/publish/`（原地保留，未在本次规范范围内）

不在本次搬迁清单内，故保持原位未动。内容为打包产物（`dist/cli.js` 等），体积较大（单 `cli.js` 约 1.2 MB），且同样位于被忽略的 `.dsh-mission/` 下。**建议后续确认**：是需要版本化的发布快照，还是可清理的生成物。
