# FIX-BRIEF-01 — 独立 Evaluator REJECT 后的最小修复（Round 2）

> 来源：`docs/product-evolution/EVALUATION-REPORT-01.md`（全静态对抗审查，结论 REJECT）。
> 上一轮 ACCEPT 的 `EVALUATION-REPORT-01-E2.md`（极小范围静态，未覆盖这 4 项）保留为副证，不推翻本 REJECT。
> 纪律：只修下列条目，不扩大 scope；写入型执行（**不要跑命令**，由指挥复跑验证）。

## S1（阻塞，Brief 验收 3）未知命令分派零测试

- 事实：全仓 `main(['foo'])` / `main(['chat'])` **0 处测试**；`cli.ts:1496-1499` 分支无覆盖。
- 修：在 `apps/cli/src/cli.test.ts` 增用例——`await main(['foo'])` === 2、`await main(['chat'])` === 2，且 stderr 含「未知命令」；另加一条已知命令不被误拦的对照（如 `main(['list-terms'])` === 0 或 `main(['explain','小小蜜'])` 正常）。
- 注意测试隔离（AGENTS.md 约束 8）：注入 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`/`VESSEL_SETTINGS_ROOT` 到临时目录；捕获 `console.error` 后还原。

## S2（阻塞，Brief 验收 4）`cah *` **不是误报**（指挥早前 grep 失效误判，已订正）

- 事实：`apps/cli/src/providers/setup.ts` 5 处 `cah`：第 7 行注释 + **103 / 237 / 268 / 301 为用户可见文案**（clack confirm / log.error / 作用域说明 / log.success）。
- 修：全部改为实际命令（`cah run` → `vessel run`、`cah provider add` → `vessel provider add`、`cah models` → `vessel models`），注释同步。

## S3（G-01 同类漏网）注入源白名单不全

- 事实：`packages/shared/src/events.ts:39` 的 source 联合 = `user|steer|inject|instruction|compacted-summary|plan|memory|handoff`；`INJECTED_MESSAGE_SOURCES`（`packages/shared/src/provider.ts:46-51`）只有 4 个，缺 **`plan`**（`packages/agents/src/planner/Planner.ts:84`）、**`handoff`**（`packages/engine/src/handoff/StartFromHandoff.ts:99`）、**`inject`**（`packages/engine/.../runner.ts:135` 一线）。
- 修：把 `plan`/`handoff`/`inject` 加入 `INJECTED_MESSAGE_SOURCES`，并更新其文档注释（`steer` **保持可匹配**——操作员实时驱动输入，有意设计）。

## S4（Brief 错误场景）TUI 冒烟未同步

- 事实：`apps/cli/src/tui/chat.ts:245-249` 的 mock 构造**无** `fallbackText`、无 TOOL_FAILURE 友好分支 → 空工作区读失败时把 `[TOOL_FAILURE] …` **原样当最终回复**（Brief 明令禁止）。
- 修：与 `cmdRun` 对齐——补 `fallbackText`（确定性兜底文案）+ 「最后一条 tool 结果以 `[TOOL_FAILURE]`/`[DENIED]` 等开头 → 友好提示 + 引导 `vessel setup`」分支。

## 测试加固（同轮一并，均为低成本）

- `MockProvider.test.ts` 的 **A3 无判别力**（删实现仍通过）：把注入消息内容改成**能命中**脚本正则的文本（如含「总结」），断言结果回落兜底而非命中脚本（这才真锁"不得匹配注入消息"）。
- 增 `plan`/`handoff`/`inject` 三源的跳过用例（各一条即可）。
- 增**端到端判别用例**（锁死仓库内真实遮蔽场景）：构造「真实用户输入 + 其后追加 `source:'instruction'` 注入」的 messages，断言 mock 仍命中——这才是本仓库实际发生的遮蔽（仓库无 skills index，`.vessel/.agents` 不存在；`Builder.ts:126-135` 把 AGENTS.md instruction 追加在用户输入之后）。
- `chat.test.ts`：为 S4 增一条「最后 tool 结果为 `[TOOL_FAILURE]` → 输出友好文案而非原文」的用例。

## 交付

改动文件清单 + 新增测试清单（不跑命令；由指挥复跑 `tsc -b` + 全量 `vitest` + CLI/TUI 冒烟）→ 再交**新一轮独立 Evaluator** 复核（Round 2 验收）。
