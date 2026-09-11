# IMPLEMENT-BRIEF-01 状态（Orchestrator 维护）

> 目标：G-01（mock 冒烟命中）+ G-02（未知命令分派）+ G-14（引导文案）。需求源：`docs/product-evolution/IMPLEMENTATION-BRIEF-01.md`。

## 执行历史

- **Implementer #1**（agent 64f36979）：**失败**——停在阅读阶段（读 UX 报告 §1.1/§1.2、setup.ts、README 时中断），无产出。
- **Implementer #2**（agent 6d70b9da）：**失败**——closing message 为空；但已把主体实现写入工作树（未落盘 IMPLEMENTATION_RESULT、未写测试）。

## 工作树现存部分实现（勿回退，在其上继续）

| 文件 | 已实现 |
|---|---|
| `packages/shared/src/provider.ts` | `ChatMessage.source?: string`（注入型 user 消息溯源）+ `INJECTED_MESSAGE_SOURCES`（environment/instruction/memory/compacted-summary） |
| `packages/context/src/builder/Builder.ts` | `recordToMessage` 转发 `source`；volatile 层标 `source:'environment'` |
| `packages/llm/src/provider/MockProvider.ts` | `surfaceUserMessage()` 跳过注入型消息；新增 `whenToolResult` 匹配；`resolve()` 供 chat/stream 共用 |
| `apps/cli/src/cli.ts` | cmdRun mock 增 TOOL_FAILURE 友好文案 + `fallbackText` 确定性兜底；main() 未知子命令 → `console.error` + return 2 |

## 剩余工作（第三轮窄范围 Implementer）

1. **测试（Brief 验收 3，必需）**：
   - mock 命中：构造「最后一条 user 消息为 `source:'environment'` 注入（skills index 样式）」的请求，断言脚本仍命中（非 `(mock: no script entry matched)`）——必须显式构造注入场景，不能只用空工作区。
   - 未知命令：`main(['totally-unknown'])` 返回 **2**（非 0）；已知命令不受影响。
   - mock 兜底文案：无匹配脚本时输出 `fallbackText` 而非 `(mock: no script entry matched)`。
   - 测试隔离（AGENTS.md 约束 8）：注入临时 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`。
2. **G-14（修正版）**：`apps/cli/src/tui/chat.ts:261` 欢迎语补 `/explain`、`? <term>`、`guide` 提示。
   - ⚠️ **订正（2026-09-11）**：`cah *` **不是误报**——Orchestrator 早前那次 PowerShell 检索（`Get-ChildItem -Include *.ts`）返回空导致误判；独立 Evaluator 已证伪并给出位置：`apps/cli/src/providers/setup.ts:7`（注释）与 **103 / 237 / 268 / 301（用户可见文案）**。**必须**在 FIX 轮改为实际命令 `vessel …`。见 `FIX-BRIEF-01.md` S2。
   - 教训：本仓检索一律用 `grep` 工具（ripgrep），不要用 PowerShell `-Include` 组合下结论。
   - README 已正确（无参 `vessel` = TUI），无需改。
3. **验证**：`npx tsc -b tsconfig.json` + `npx vitest run`（先跑受影响文件；全量能跑则跑），修掉未知命令分支可能引起的既有测试回归（若有测试调用 `main([<positional>])`）。

## 交付

回传 IMPLEMENTATION_RESULT + 落盘 `tasks/implement-brief-01.md`（改动/测试/证据/未决/风险）。**不得自宣验收**——由独立 Evaluator 按 Brief 验收。
