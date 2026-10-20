# 任务卡 247 [ARCH-08 + ARCH-09 + UI-10]: Compaction 守恒断言与全景真实走查

> 状态：已完成 (DONE)  
> 归属：Phase 3 执行可靠性、外部生态对齐与高信噪比体验（ARCH-08 / ARCH-09 / UI-10 / P1）  
> 对应规划：`docs/plans/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` §3 ARCH-08/09 与 §4 UI-10  

## 1. 目标 (Goal)
- **Compaction 守恒断言对齐 OpenCode 2.1 (ARCH-08)**：
  1. 强化 `packages/context/src/compaction/assertCompactionConservation.ts`：在已有 goal、constraint、latestInstruction、tool_pair、denial 断言的基础上，引入 `requiredKeepIds` 与 OpenCode 2.1 `metadata.keepID` 消息引用守恒断言；
  2. 确保在上下文截断压缩时，保留的消息索引与标识绝对不丢失；
  3. 扩充自动化单测，验证 100% 守恒断言的判别性与负对照。
- **架构与文档真实性闭环 (ARCH-09)**：
  1. 汇总与沉淀本次 VESSEL 全面审查与整改路线（Phase 0 至 Phase 3，共 12 项任务卡：236-247）的架构决策与代码事实；
  2. 保证文档与可执行代码逐字诚实，杜绝声明未实现能力。
- **全景真实走查与存证归档 (UI-10)**：
  1. 对当前重构完成后的 Web UI 进行全景真实 Chromium 自动化走查；
  2. 验证中英双语、深浅双色主题、主工作台聚焦状态、Inspector 3 大职责组、Settings ProviderHub、Activity 待办中心；
  3. 将走查记录与存证报告归档至 `evidence/walkthrough-247/`。

## 2. 非目标 (Not Doing)
- 不修改 `packages/core`（修改行数恒为 0）；
- 不做无关重构。

## 3. 验收标准 (Acceptance Criteria)
1. Compaction 守恒：
   - `assertCompactionConservation` 支持 `requiredKeepIds` 断言，遗漏时抛出 `CompactionConservationError('keep_id_lost')`；
   - 单测覆盖正例与违规判定；
2. 架构与交付文档闭环：
   - 记录完整整改交付事实；
3. 自动化与门禁：
   - 走查套件 `run-browser-agent-walkthrough-247.py` 7/7 PASSED，Console Errors = 0，Page Errors = 0；
   - `npm run test:all` 双 Root（根 290 文件 3045 passed + Web 51 文件 413 passed）测试全绿；
   - `npx tsc -b` + `npm run typecheck:tests` + `npm run -w @vessel/web build` 干净；
   - `packages/core` 0 改动。

## 4. 影响范围 (Blast Radius)
- `packages/shared/src/projection.ts`（增补 `requiredKeepIds` 契约字段与 `ConservationMessage.id`）
- `packages/context/src/compaction/assertCompactionConservation.ts`（实现 `keep_id_lost` 断言）
- `packages/context/src/compaction/assertCompactionConservation.test.ts`（扩充测试用例）
- `scripts/run-browser-agent-walkthrough-247.py`（全景真实 Chromium 走查脚本）
- `evidence/walkthrough-247/`（7 步走查截图与 JSON 报告）

## 5. 预期证据 (Expected Evidence)
- 定向测试与全量门禁结果：
  - Compaction 测试 5 文件 / 61 passed；
  - Web 测试 51 文件 / 413 passed；
  - 根测试 290 文件 / 3045 passed | 6 skipped；
  - 浏览器真实走查：`evidence/walkthrough-247/walkthrough-report.json`（7/7 passed，consoleErrors: 0, pageErrors: 0）；
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npm run -w @vessel/web build` exit 0；
  - `packages/core` 修改行数：0。
