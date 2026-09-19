# 134 — mock 冒烟脚本收敛为唯一实现（消除 CLI/TUI 已客观分叉的输出）

- 编号：134
- 状态：已合入（2026-09-18）
- 优先级：P2（PRODUCT-STATE Round 122/124 点名的同族「两份实现」；且两面对同一 prompt 输出已不同）
- 创建日期：2026-09-18
- 关联：`tasks/130`–`132`（同族收敛）、`docs/product-evolution/PRODUCT-STATE.md` Round 124「仍开放」②
- 执行器：指挥侧

## 1. 缺陷：同款脚本两份，第三条文案已分叉

`cli.ts`（`run` 的默认 provider）与 `tui/chat.ts`（`buildHarness` 的 mock 分支）各写一份近乎相同的离线冒烟脚本，注释自称"逐字一致"，但**第三条文案不同**：

| | 第三条回显 |
|---|---|
| CLI | `已通过 Read 工具读取工作区文件。内容开头：\n{last_tool_result}` |
| TUI | `（mock）读取结果：\n{last_tool_result}` |

于是**同一个 prompt（如"总结 README"）在 `vessel run` 与 `vessel`（TUI）得到不同输出**；且 TUI 文案自带 `（mock）`，还会与统一标记 `（mock 离线冒烟）` 叠加。两份实现无测试绑定（改前没有用例在它们分叉时变红）。

## 2. 修复

新增零依赖叶子模块 `apps/cli/src/mockSmoke.ts`：`export function mockSmokeScript(): MockScriptEntry[]`（唯一实现，取 **CLI 措辞为准**）。`{cwd}` 仍由 `MockProvider` 的 `vars.cwd` 替换，故函数**不接 cwd 参数**（调用方各自传 `vars`）。

- `cli.ts`：`new MockProvider(mockSmokeScript(), { model, vars: { cwd: workspace }, fallbackText: MOCK_FALLBACK_TEXT })`。
- `tui/chat.ts`：`new MockProvider(mockSmokeScript(), { model: effModel, vars: { cwd: sessionWorkspace }, fallbackText: MOCK_FALLBACK_TEXT })`。

## 3. 验收与实测

- 新增 `apps/cli/src/mockSmoke.test.ts`（2 例）：
  - **行为**：三条（Read README → 失败友好提示 → 成功回显开头）；第三条 = CLI 规范措辞；`（mock）读取结果` 旧 TUI 措辞**不得再出现**；
  - **静态守卫**：两面都从叶子 import `mockSmokeScript`，且**不再内联**（以第一条 `when` 正则为唯一标志，改回内联即红）。
- 同步受影响断言：`mockVisibility.test.ts:431` 的 TUI 回显定位由旧标记 `（mock）读取结果` 改为规范措辞 `已通过 Read 工具读取工作区文件`（**改前该用例红**，证明分叉真实存在）。
- 门禁：`tsc -b` exit 0、`typecheck:tests` exit 0、`test:all` 根 **177 文件 / 2234 passed + 6 skipped** + web **11/120**、web `vite build` exit 0、CLI 冒烟 exit 0、CI 两腿绿。

## 4. 边界（未做，如实）

- 脚本**语义未变**（三步与匹配条件逐字保留），只统一措辞并收敛实现。
- `local-server` 的 smoke controller 与 bench 的 mock 脚本是**不同用途**（HTTP 冒烟 / 基准场景），不在本卡范围。
