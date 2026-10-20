# 任务卡 246 [ARCH-06 + UI-09]: Event/SSE 断线重连与高信噪比执行体验

> 状态：已完成 (DONE)  
> 归属：Phase 3 执行可靠性、外部生态对齐与高信噪比体验（ARCH-06 / UI-09 / P1）  
> 对应规划：`docs/plans/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` §3 ARCH-06 与 §4 UI-09  

## 1. 目标 (Goal)
- **视区保护与滚动守卫 (UI-09)**：
  1. 杜绝流式输出或状态更新期间暴力 `scrollTo` 抢夺视区；
  2. 实时跟踪滚动容器的底部贴合状态 `isAtBottom`（距底部容器边距 $\le 120\text{px}$ 判定为贴合底部）；
  3. 仅当处于底部时，随新增消息/思考文本/工具事件自动跟随滚动到底部；
  4. 当用户向上滚动阅读历史记录时，保持用户当前的滚动位置；若有新消息到达且脱离底部，呈现轻量浮动“回到底部”胶囊按钮（支持国际化），点击平滑回到底部并恢复自动跟踪。
- **SSE 断线重连与数据对齐 (ARCH-06)**：
  1. 在 `createEventStream` 的 `onOpen` 回调中响应网络重连：当连接重新恢复时，清除 `serverDown` 告警，并触发会话元数据对齐（`onSessionUpdated?.()`），确保恢复后能够无缝接收实时事件。
- **输入框 IME 保护与互斥状态机**：
  1. 解决中文/多语言输入法选词按回车导致误发送问题：在组合输入期间（`e.nativeEvent.isComposing` 或 `keyCode === 229`），阻止表单提交流程；
  2. 发送、停止（stop）状态严格互斥；在运行中清晰指示状态，防止连续重复发送或状态抖动。

## 2. 非目标 (Not Doing)
- 不修改 `packages/core`（修改行数恒为 0）；
- 不引入重型外部富文本或复杂聊天组件库，保持轻量纯净。

## 3. 验收标准 (Acceptance Criteria)
1. 滚动守卫与悬浮胶囊：
   - 处于底部时自动滚动；用户上滑脱离底部时禁止拉回；
   - 脱离底部时提供“回到底部”悬浮按钮，点击后滚动到底部；
2. IME 组合输入防护：
   - 组合输入期间敲击 Enter 不发送消息，普通 Enter 发送；
3. 断线重连：
   - SSE `onOpen` 时自动清除 `serverDown` 状态并触发会话同步；
4. 自动化测试门禁：
   - 编写针对滚动守卫与输入法的单测（`ConversationView.interaction.test.tsx` 3 项全部通过）；
   - `npm run test:all` 双 Root（根 290 文件 3045 passed + Web 51 文件 413 passed）测试全绿；
   - `npx tsc -b` + `npm run typecheck:tests` + `npm run -w @vessel/web build` 干净；
   - `packages/core` 0 改动。

## 4. 影响范围 (Blast Radius)
- `apps/web/src/components/ConversationView.tsx`
- `apps/web/src/i18n.ts`（增补 `scrollToBottom` 国际化词条）
- `apps/web/src/styles.css`（回到底部浮动胶囊样式 `.scroll-to-bottom-pill`）
- `apps/web/src/components/ConversationView.interaction.test.tsx`（新增单测套件）

## 5. 预期证据 (Expected Evidence)
- 定向测试与全量门禁结果：
  - `ConversationView.interaction.test.tsx` 3 passed；
  - Web 测试 51 文件 / 413 passed；
  - 根测试 290 文件 / 3045 passed | 6 skipped；
  - `npx tsc -b` exit 0；
  - `npm run typecheck:tests` exit 0；
  - `npm run -w @vessel/web build` exit 0；
  - `packages/core` 修改行数：0。
