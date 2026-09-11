# EVALUATION-BRIEF-01 — 独立验收指令（Phase 7）

> 给**独立 Evaluator**（新上下文，不继承 Implementer 推理）。立场：**假设实现有错**。
> 需求源：`docs/product-evolution/IMPLEMENTATION-BRIEF-01.md`（验收标准 1-4）。
> 实现状态：`docs/product-evolution/IMPLEMENT-BRIEF-01-STATE.md`（含三轮 Implementer 失败历史与部分实现说明）。
> 产出：`docs/product-evolution/EVALUATION-REPORT-01.md` + 结论 **ACCEPT / REJECT**（REJECT 必须给出具体条目与最小复现）。

## 待验改动（工作树 + WIP commit 080423d）

| 文件 | 声称做到 |
|---|---|
| `packages/shared/src/provider.ts` | `ChatMessage.source?: string` + `INJECTED_MESSAGE_SOURCES` |
| `packages/context/src/builder/Builder.ts` | 转发 `source`；volatile 层标 `source:'environment'` |
| `packages/llm/src/provider/MockProvider.ts` | `surfaceUserMessage()` 跳过注入消息；`whenToolResult`；`resolve()` |
| `apps/cli/src/cli.ts` | mock TOOL_FAILURE 文案 + `fallbackText`；未知子命令 → stderr + return 2 |
| `apps/cli/src/tui/chat.ts` | 欢迎语补 `/explain`·`? <term>`·`guide`（第四轮补） |
| 测试（第四轮补） | mock 注入场景命中 / 兜底文案 / （可选）whenToolResult |

## 必查验收点

1. **G-01 真实命中**：在**含注入 skills index 的场景**下 mock 脚本仍命中。**必须自己实跑复现**，不接受只读测试代码：
   - 仓库工作区实跑 `npx tsx apps/cli/src/cli.ts run --prompt "总结当前工作区 README"` → 输出**不得**为 `(mock: no script entry matched)`（应为总结或确定性兜底文案）。
   - 空工作区对照仍应命中 read/summary 脚本（不回归）。
2. **G-02 未知命令**：`npx tsx apps/cli/src/cli.ts foo`、`... chat` → stderr「未知命令」+ **exit 2**；`vessel`（无参）、`vessel run --prompt x`、`guide`/`settings`/`provider`/`usage`/`models`/`explain` 均**不受影响**（逐个抽验至少 3 个）。
3. **测试真实性**（重点质疑）：
   - 新增测试**是否真的构造了注入场景**（`source:'environment'` 作为最后一条 user 消息），而非又用空工作区/干净请求糊过去？把测试删除后实现是否仍"看似通过"？（若测试是空壳 → REJECT）
   - 是否真的断言了 exit code 2 与 stderr 文案？
4. **`source` 字段泄漏风险**（关键对抗点）：`ChatMessage.source` 是否可能被真实 provider 的请求序列化带进 HTTP body（`JSON.stringify(messages)` / 对象展开）？逐个体检 openai-compatible / anthropic / opencode-go 序列化路径；若泄漏 → REJECT（污染上游 API）。
5. **回归**：`npx tsc -b tsconfig.json` + `npx vitest run`（全量）是否 0 失败？既有 `chat.test.ts` mock smoke 用例是否仍绿？未知命令分支是否破坏了任何既有 `main([...])` 调用？
6. **不越界**：是否误改 `cah`（误报，不该动）、README（已正确）、或引入无关重构？

## 输出格式

`docs/product-evolution/EVALUATION-REPORT-01.md`：
- 每验收点：**通过 / 不通过 / 无法判定** + **你自己跑出的原始证据**（命令 + 输出片段 + 退出码）
- 结论：ACCEPT（全部通过）或 REJECT（列出必须修的最小条目，按严重度）
- 若 REJECT：给 Fix 建议（给 Implementer 的最小改动方向），不要自己改代码
