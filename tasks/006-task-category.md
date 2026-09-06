# 006 — V0.4-M1 Task Category 分类器

- 状态：已合入（2026-09-05 指挥实现并验收）
- 优先级：P0
- 创建日期：2026-09-05
- 关联卡片：007（preset/路由）依赖本卡类别定义；MISSION-V0.4

## 目标

实现任务类别定义 + 确定性分类器：把用户任务意图（prompt 文本）映射到任务类别（如 implementation/search/review/planning/simple-fix 等），离线可测，不依赖 LLM；预留 LLM 分类 seam。

## 验收标准

- [x] 类别集定义（常量/配置，可扩展）：≥5 类，每类有关键字规则
- [x] 确定性分类函数 classifyTask(prompt) → category（关键字匹配，可测）
- [x] LLM 分类 seam 预留（接口声明，默认确定性实现）
- [x] Vitest 测试：示例任务分到正确类别、未知任务落到默认类别
- [x] `npx vitest run` 全绿不回归 146 基线；`npx tsc -b` exit 0
- [x] 卡状态置"待验收"，回填工作证明

## 涉及文件

- `packages/llm/src/router/taskCategory.ts`（新建：TaskCategory/classifyTask/DEFAULT_CATEGORY_RULES/TaskClassifier seam）
- `packages/llm/src/router/taskCategory.test.ts`（新建：9 用例）
- `packages/llm/src/index.ts`（导出）
- `docs/V04-PROGRESS.md`（新建）

## 依赖

- 依赖任务卡：无（MISSION-V0.4 首发卡）
- 阻塞于：—

## 设计锚点

- MISSION-V0.4 §3.1：类别集可配置、确定性起步、LLM seam 预留
- 放 llm/router（与现有 SimpleRouter 同目录），不新建包
- 类别命名参考任务书 V0.5 Task Selection 语义，不抄 OmO 角色名
- 薄核：只依赖 shared 类型；core 不 import

## 工作证明（执行器回填）

- [x] diff / 测试结果 / tsc exit 0：taskCategory.ts + 9 用例；llm 13 用例全绿、全量 155 用例全绿、tsc exit 0

## 验收结论（指挥会话回填）

- [x] 合入 / 打回 / 调整方向：合入（2026-09-05 指挥验收）
- 备注：6 条验收标准全 PASS；007 已解锁。
