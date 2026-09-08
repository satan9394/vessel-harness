# 059 — External Review Handoff（.vessel/reviews/<id>/handoff.md）

- 状态：待执行
- 优先级：P0（Wave 2 / Milestone D）
- 创建日期：2026-09-08
- 关联：058（Internal Review 后接外部评审）；060（UI：Copy Handoff / Open Folder / Import Result）
- 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）
- 权威来源：docs/Vessel_后续开发方向与产品化路线_v1.0.md §9（L1082-1138）：External Review Adapter
  不是 ChatProvider；handoff artifact 存 .vessel/reviews/<review-id>/handoff.md，内容含 Task /
  Acceptance Criteria / Changed Files / Diff Summary / Test Results / Architecture Constraints /
  Review Checklist / Required Output Schema

## 目标

External Review Handoff：把待外部评审的任务打包成 handoff artifact（.vessel/reviews/<id>/handoff.md
+ 相关元数据），并支持导入外部评审结果（用户在 AGY/Gemini 等外部跑完后粘贴/导入 → 落库）。AGY CLI
  不伪装进 ChatProvider——走 artifact 交换而非 API provider。

## 验收标准（执行器逐条勾选）

- [ ] Handoff 生成：给定任务+验收标准+改动文件+diff 摘要+测试结果 → 生成
      .vessel/reviews/<review-id>/handoff.md（§9.1 八个 section 齐）+ 元数据（状态/时间戳/来源）
- [ ] 结果导入：外部评审结果（met/not_met+意见，形状与 058 内部评审结论兼容）导入并落库，与
      内部评审结论可区分来源（external vs internal）
- [ ] 存储走项目既有 ~/.vessel 或项目 .vessel 目录约定（与既有 session/registry 一致）；review-id
      生成与复用既有 id 约定
- [ ] CLI seam：能触发生成 handoff（如 vessel review handoff <任务>）与导入结果——最小可测即可，
      UI（Copy/Open/Import 按钮）留 060
- [ ] 测试：handoff 生成内容完整/导入落库/来源区分/路径与 id 约定，新增 ≥6 例；全量 vitest/tsc 绿
      （426+前卡新增数 无回归）
- [ ] 文档同步（External Review 工作流）
- [ ] 本卡"工作证明"节回填 + 状态改"待验收"

## 范围边界（勿膨胀）

- artifact 交换（生成/导入）+ CLI seam。不把 AGY 当 API provider（明确不做 Local CLI Adapter
  shell hack）；UI 按钮（060）与自动重试（Wave 3）不在本卡。

## 涉及文件（指针，执行器自行精化）

- 项目 .vessel 目录约定与存储（packages/application 或既有 registry/storage）
- 任务/验收标准/改动元数据来源（058 评审上下文 + git 状态）
- CLI（apps/cli 命令 seam）
- 058 评审结论类型（结果形状复用）

## 方法

- 读 §9.1-9.2；handoff 生成/导入走文件 + 元数据，复用既有存储与 id 约定
- 导入结果解析为结构化结论与内部评审同型

## 工作证明（执行器回填：改了什么/测试输出/diff 摘要，全部写进本文件，勿留对话里）

- [ ] 待执行器回填

## 验收结论（指挥回填）

- [ ] 合入 / 打回
- 备注：
