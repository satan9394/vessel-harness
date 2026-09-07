# 018 — 收尾：文档 + 全量验证 + 交付

- 状态：已合入（2026-09-05 指挥完成）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 014–017；目标 goal-575e1e4b

## 目标

收尾：docs/PROVIDER-MANAGEMENT.md（用法文档）+ V06-PROGRESS.md 收口 + 全量验证 + 真实命令冒烟。

## 验收标准

- [x] docs/PROVIDER-MANAGEMENT.md：命令参考、SSOT 说明、apiKey 风险、模型拉取行为
- [x] V06-PROGRESS.md 收口（里程碑全绿）
- [x] 全量 `npx vitest run` 绿（250）+ `npx tsc -b` exit 0
- [x] 真实 CLI 冒烟：provider add/switch/list/current + models（401 错误路径 + anthropic 内置清单）全通过
- [x] git 提交 + 任务卡 014-018 全置已合入
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `docs/PROVIDER-MANAGEMENT.md`（新建）、`docs/V06-PROGRESS.md`（收口）
- `tasks/014..018`（状态更新）

## 依赖

- 依赖任务卡：014、015、016、017
- 阻塞于：017 合入

## 设计锚点

- 文档沿用 PROVIDER-INTEGRATION.md 风格
- 冒烟用隔离 CAH_PROVIDER_ROOT，不发真 key

## 工作证明（执行器回填）

- [x] 文档 + 收口 + 250 测试绿 + 冒烟通过（见 V06-PROGRESS）

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：V0.6 目标全部达成。
