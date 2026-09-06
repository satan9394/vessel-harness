# 002 — Persistent Memory（用户级持久记忆 + 分层作用域）

- 状态：待执行
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：依赖 001（project 级作用域解析）；本卡补 user 级 + 跨项目持久

## 目标

在 001 的 project 记忆之上，实现用户级 Persistent Memory：跨项目、按用户隔离的长期记忆；与 project 记忆明确分层（user/project/local 三级作用域），互不串扰；对应 docs/ARCHITECTURE.md §4.8 memory/persistent 与任务书第十二节。

## 验收标准

- [ ] `packages/memory/src/persistent/`（或 project 同级扩展）实现用户级持久存储（USER.md 用户画像 + 用户级 topic 文件，ARCHITECTURE §4.8 行 344 蓝图）
- [ ] 三级作用域（user/project/local）解析统一：同 key 不同作用域不互相覆盖；读取按 local→project→user 或明确优先级合并
- [ ] 端到端演示：同一用户两个不同 project 目录，user 级记忆两者可见；project 级记忆互不可见
- [ ] 检索与注入通道与 001 一致（冻结快照注入、带 source 的 user/message，可回放可压缩）
- [ ] Vitest 测试覆盖分层隔离/合并语义/跨项目持久；`npx vitest run` 全绿不回归 104 基线
- [ ] `npx tsc -b tsconfig.json` exit 0
- [ ] 卡状态置"待验收"，回填工作证明

## 涉及文件（执行器按需扩展）

- `packages/memory/src/persistent/*`（新建）
- `packages/memory/src/project/*`（如需提取共用作用域解析层）
- `packages/memory/src/index.ts`
- 对应 `*.test.ts`
- `docs/V03-PROGRESS.md`

## 依赖

- 依赖任务卡：001
- 阻塞于：001 合入

## 设计锚点

- 用户根目录取 `os.homedir()`（复用 skills 发现根先例，见 packages/skills/src/index.ts discoveryRoots）
- 与 001 共用同一套作用域/检索抽象，避免两套实现漂移
- 薄核纪律、clean-room、回收站纪律同 001

## 工作证明（执行器回填）

- [ ] diff / 测试结果 / tsc exit 0

## 验收结论（指挥会话回填）

- [ ] 合入 / 打回 / 调整方向
- 备注：
