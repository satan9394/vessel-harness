# 005 — 自动学习 suggest 通道（只建议，不自动改）

- 状态：已合入（2026-09-05 指挥实现并验收）
- 优先级：P1
- 创建日期：2026-09-05
- 关联卡片：依赖 001–004（记忆 + 技能面就绪后才有 suggest 对象）

## 目标

实现任务书第十二节"自动学习只允许 suggest"：Agent 可产出候选技能/记忆条目建议，经独立评审/用户拍板后才落盘；只写 `learned/` 专用区，绝不 auto modify 用户技能区/记忆区。

## 验收标准

- [x] suggest 通道：产出结构化候选（内容 + 类型：skill/memory + 理由 + 来源证据）
- [x] 独立评审：候选经 Evaluator Agent（或确定性判据）评审，不通过不落盘
- [x] 用户拍板门：只有明确批准才写入；未批准候选只留建议记录
- [x] 只写 learned/：写入目标是隔离的 `learned/` 区（如 `<scope>/learned/`），与用户技能/记忆区物理分离
- [x] 测试实证无 auto modify：候选未批准时用户区零改动（快照对比）
- [x] Vitest 全绿不回归 104 基线；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/memory/src/learned/LearnedStore.ts`（新建：suggest/recordVerdict/approve/reject + learned 区）
- `packages/memory/src/learned/learned-store.test.ts`（新建：6 用例）
- `packages/memory/src/index.ts`（导出）
- `docs/V03-PROGRESS.md`

## 依赖

- 依赖任务卡：001–004
- 阻塞于：004 合入

## 设计锚点

- 任务书 §12/§13：用户 Skill ≠ Agent 自动修改区；自动学习只允许 suggest，不得 auto modify；learned/ 专用区（V0.4 完整化，V0.3 落 suggest 通道）
- Generator/Evaluator 分离：suggest 是 Generator 产出，必须经独立评审
- 删除走回收站纪律

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：LearnedStore 状态机（suggest→verdict→approve/reject）+ learned/ 隔离 + 无 auto modify 快照实证；memory 24 用例全绿、全量 144 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：7 条验收标准全 PASS；V0.3 实现范围 001–005 全部完成，进入 M6 收尾。
