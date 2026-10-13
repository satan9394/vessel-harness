# 规划与整改方案索引 (Improvement Plans)

本目录收拢基于系统架构审查与 UI 审查演进而来的整改实施蓝图，作为后续里程碑与任务卡拆解的技术方案依据。

| 文档编号 | 文件名 | 主题 | 来源基线 |
|---|---|---|---|
| VESSEL-ARCH-2026-01 | [Vessel_Harness_Architecture_Improvement_Plan.md](file:///E:/Code_file/Projects/Vessel_Harness/docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md) | Harness 架构整改与契约实施规范 | `docs/diagrams/` 5 套分层架构图 |
| VESSEL-UI-2026-01 | [Vessel_Web_UI_UX_Improvement_Plan.md](file:///E:/Code_file/Projects/Vessel_Harness/docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md) | Web UI/UX 整改与产品工作台实施规范 | `docs/screenshots/` 6 组中英界面截图 |

---

## 落地演进路线

1. **Epic 217（里程碑 V2.7：契约健全化与执行可靠性中枢）**：承接 VESSEL-ARCH-2026-01 中的 P0 级契约加固（Event Log 与 Projection 投影解耦、Policy 编译硬门禁、ExecutionPermit 凭证、Compaction 守恒断言）。任务卡：`tasks/217`–`219`。
2. **Epic 220（里程碑 V2.8：可组合 Agent 工作台 Composable Workbench）**：承接 VESSEL-UI-2026-01 中的工作台一体化任务流重构、命令面板语义分组、模块显隐解耦与 800px 响应式自适应。任务卡：`tasks/220`–`222`。
