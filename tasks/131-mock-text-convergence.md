# 131 — mock 文案/标记收敛为唯一实现（消除 cli.ts 与 TUI 的第二份）

- 编号：131
- 状态：已合入（2026-09-18）
- 优先级：P2（本仓反复收敛的「两份实现会无声分叉」类；`turnText.ts` 文件头与 PRODUCT-STATE Round 122/124 均已点名）
- 创建日期：2026-09-18
- 关联：`apps/cli/src/turnText.ts` 文件头（"标记文案……可以照此办理"）、`tasks/130`（MCP 装配同族）、PRODUCT-STATE Round 122「五条两份实现」之 mock 提示常量 / mock 标记+渲染出口
- 执行器：指挥侧

## 1. 缺陷：同字面量 + 同逻辑各写两份

`cli.ts` 与 `tui/chat.ts` 各写一份、只差变量名：

| 物 | cli.ts | tui/chat.ts | 值 |
|---|---|---|---|
| 标记字面量 | `MOCK_REPLY_MARK` | `TUI_MOCK_REPLY_MARK` | `（mock 离线冒烟）` |
| 提示字面量 | `MOCK_PROVIDER_NOTICE` | `TUI_MOCK_PROVIDER_NOTICE` | `[vessel] 当前使用内置 mock 模型…` |
| 兜底文案 | `fallbackText` | `fallbackText` | `（mock 离线冒烟）已收到你的输入…` |
| 渲染助手 | `renderFinalReply` | `renderTurnReply` | `if (!finalText) '(无文本回复)'; if (!usingMock) 原串; else 幂等加前缀` |

两侧注释自称"**必须与 cli.ts 逐字保持同步**"，但全仓无测试绑定 ⇒ 只改一面会无声分叉
（用户在 `vessel run` 与 `vessel`（TUI）看到不再是同一句提示/同一个标记形态）。
`turnText.ts` 的文件头早已把"标记文案"列为可照其范式收敛的对象。

## 2. 修复

把四处收敛进**零依赖叶子模块** `apps/cli/src/turnText.ts`（唯一实现）：

- `export const MOCK_REPLY_MARK` / `MOCK_PROVIDER_NOTICE` / `MOCK_FALLBACK_TEXT`；
- `export function applyMockReplyMark(finalText, usingMock)`：幂等加前缀、空串→`(无文本回复)`、真实 provider 逐字返回。

调用方改为各自 import 同一份：
- `cli.ts`：删本地两条常量；`renderFinalReply` 委托 `applyMockReplyMark`；`fallbackText: MOCK_FALLBACK_TEXT`。
- `tui/chat.ts`：删 `TUI_*` 两条常量；`renderTurnReply` 委托 `applyMockReplyMark`；`io.write(MOCK_PROVIDER_NOTICE)`；`fallbackText: MOCK_FALLBACK_TEXT`。
- 两侧注释同步改写（不再是"两份必须人工同步"，而是"唯一一份 + 编译期约束"）。

## 3. 验收与实测

- 新增静态守卫（`mockVisibility.test.ts` 尾部 2 例）：两面**都不再本地定义** `(TUI_)?MOCK_(REPLY_MARK|PROVIDER_NOTICE)`，且都从 `turnText.ts` import `applyMockReplyMark`；`turnText.ts` 导出四个符号且仍**零 import**。⇒ 改回内联即红。
- 行为不变：`mockVisibility.test.ts` 既有 7 例（真实 `main()` / `runChat()` 路径）+ `cli.test.ts` / `chat.test.ts` 的 mock 呈现断言全部照旧通过。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **176 文件 / 2230 passed + 6 skipped** + web **11/120**、CI 两腿绿。

## 4. 边界（未做，如实）

- `turnText.ts` 的职责从"只放判据"扩到"判据 + mock 文案/标记"（文件头已更新）；仍是零依赖叶子模块。
- 其余同族「两份实现」未纳入本卡：locale 优先级判据、`PUBLISH_ARTIFACT_CRITERION` 等（见 PRODUCT-STATE Round 122/124）。
