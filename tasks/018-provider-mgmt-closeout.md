# 018 — 收尾：文档 + 全量验证 + 交付

- 状态：待执行
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 014–017；目标 goal-575e1e4b

## 目标

收尾：docs/PROVIDER-MANAGEMENT.md（用法文档：provider/models 命令、SSOT 位置、接入流程）+ V06-PROGRESS.md 收口 + 全量验证 + 真实命令冒烟。

## 验收标准

- [ ] docs/PROVIDER-MANAGEMENT.md：命令参考、SSOT 说明、apiKey 风险、模型拉取用法
- [ ] V06-PROGRESS.md 收口（里程碑全绿）
- [ ] 全量 `npx vitest run` 绿 + `npx tsc -b` exit 0
- [ ] 真实 CLI 冒烟：cah provider add/switch/list + cah models（mock/本地 fake）
- [ ] git 提交 + 任务卡全置已合入
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `docs/PROVIDER-MANAGEMENT.md`、`docs/V06-PROGRESS.md`
- 冒烟验证输出

## 依赖

- 依赖任务卡：014、015、016、017
- 阻塞于：017 合入

## 设计锚点

- 文档沿用 PROVIDER-INTEGRATION.md 风格
- 冒烟用本地 fake 服务器，不发真网络、不用真 key

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
