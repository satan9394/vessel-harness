# Task 251: Compaction keepID Conservation & IME Enter Submission Hardening (Fixes F4 & F7)

状态：已验收（2026-10-26 对账；原状态「已交付」，keepID 与 IME 回归用例在树且全绿，依据见 [卡 340](340-board-backlog-closeout.md)）
负责人：Codex (`gpt-6.1-sol`, medium reasoning effort)
规划 / 架构监督：Antigravity
前序依赖：[任务卡 249](249-adversarial-audit.md) 对抗审计揭露的 F4 与 F7 漏洞；前序 [任务卡 250](250-session-completion-and-credential-binding.md) 已交付

## 1. 目标 (Goal)
攻坚修复 Task 249 对抗审计报告揭示的 F4（High 级）与 F7（Medium 级）缺陷：
1. **F4 keepID 守卫深度接入生产 Compaction 流水线**：
   - 解决 `packages/context/src/compaction/Compaction.ts` 中消息重构时剥离元数据、未向 `assertCompactionConservation` 传递 `requiredKeepIds` 的问题；
   - 在生产 Compaction 中扫描被压缩区域的原始 records，收集所有带有 `keepID` / `keepId` / `keepIds` 的锚点标识；
   - 确保压缩后消息（或 summary 摘要元数据及文本）严格保留并引用这些 keepIDs，同时保证锚点内容语义守恒；
   - 将 `requiredKeepIds` 正式传入 `assertCompactionConservation` 实施硬执法。
2. **F7 输入法 IME 回车事件隐式表单提交加固**：
   - 解决 `apps/web/src/components/ConversationView.tsx` 中 `handleKeyDown` 处理 IME 回车时仅调用了 `e.stopPropagation()` 而遗漏 `e.preventDefault()` 的缺陷；
   - 在 Enter 键命中 composition 态、`nativeEvent.isComposing` 或 keyCode 229 时，必须同时调用 `e.preventDefault()` 和 `e.stopPropagation()`，彻底杜绝输入法选词回车触发隐式表单提早提交；
   - 补充针对性的组件交互单测。

## 2. 禁做事项 (Not Doing)
- 严禁修改 `packages/core`（薄核纪律：严格 0 修改）；
- 严禁永久删除任何文件（所有删除走回收站，除临时测试自建目录外）；
- 不引入外部新依赖，不篡改其他无关 UI 结构。

## 3. 验收标准 (Acceptance Criteria)
1. **F4 验证**：
   - `packages/context/src/compaction/Compaction.test.ts` 新增对生产 Compaction 流水线包含 `keepID`（如 `keep-0`）记录的压缩测试，证明压缩后保留了 `keepID` 锚点并成功通过 `assertCompactionConservation`，若丢失则坚决抛错；
   - 运行 Task 249 产出的反例探测脚本关于 F4 的部分能够成功通过。
2. **F7 验证**：
   - `apps/web/src/components/ConversationView.interaction.test.tsx` 增加对 IME 组合中按 Enter 键调用 `preventDefault()` 阻止隐式提交的回归断言；
   - Web 自动化单测 100% 通过。
3. **门禁指标**：
   - `git diff HEAD --stat -- packages/core` 必须为 0；
   - `npx tsc -b` exit 0；
   - `npm run typecheck:tests` exit 0；
   - `npx vitest run packages/context` 全部通过；
   - `npm run test:web` 413+ 测试全部通过。

## 4. 影响面 (Blast Radius)
- `packages/context/src/compaction/Compaction.ts`
- `packages/context/src/compaction/Compaction.test.ts`
- `packages/context/src/compaction/assertCompactionConservation.ts` 及其回归测试
- `packages/shared/src/projection.ts`（恢复提交摘要的 metadata，保证持久化与二次压缩后仍保留 keepIDs）
- `apps/web/src/components/ConversationView.tsx`
- `apps/web/src/components/ConversationView.interaction.test.tsx`
- Task 249 探针新增 `--verify-251` 独立验证模式；保留历史反例模式。

## 5. 预期证据 (Expected Evidence)
- `evidence/sessions/2026-10-20-codex-task-251.log`
- `evidence/sessions/2026-10-20-codex-task-251-proof.md`

## 6. Result

F4/F7 实现与回归测试已落盘；确定性门禁及独立只读复核见 [交付证据](../evidence/sessions/2026-10-20-codex-task-251-proof.md)。没有修改公共 API、依赖或使用方式，无需更新用户文档。未提交、推送或调用本机外部 Agent。
