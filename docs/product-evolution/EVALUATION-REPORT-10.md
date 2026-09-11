# EVALUATION-REPORT-10 — G-09 Round 8 复评（两条硬缺口 + 修复真实性）

结论：**ACCEPT**（两条硬缺口静态复核均已真修；发现 2 处 P3 外观/覆盖偏差，不构成拒收）。
范围：静态审查，**未复跑命令**（未跑 tsc/vitest/E2E）；指挥侧的 tsc 0 / 33 用例 / 1293 通过一律按"未复现"对待。

## 1. 缺口①（TUI 从不记账）—— 通过
- `apps/cli/src/tui/chat.ts:266-277`：`composeHarness({..., usageStore: opts.usageStore, usageProvider: providerId})` 确已传入（275/276 行）。
- 作用域正确：`buildHarness` 定义于 `runChat` 内（`:238`），闭包引用 `opts`（`ChatOptions.usageStore`，`:172`），全文件无同名形参遮蔽；`:283` 的 `const usage = opts.usageStore` 只是**另一个**绑定，不参与 275 行。即 275 行那份就是 `runChat` 收到的那份。
- `providerId`（`:231` `currentCfg?.id ?? 'mock'`）恒为字符串，**非 undefined 常量**；全文件仅此一处赋值（grep `providerId =` 只有 231）。
- 真实入口确会走到：`apps/cli/src/cli.ts:1505-1512` 裸 `vessel` 进 TUI 时传 `usageStore: createUsageStore(...)`。
- 记账链闭合：`packages/application/src/compose.ts:297-318`（`if (opts.usageStore)` 订阅 `after_model` → `record`）→ `packages/core/src/agent-loop/AgentLoop.ts:275`（纯文本停止路径 emit `after_model {usage}`）→ `packages/llm/src/provider/MockProvider.ts:86`（默认 `{100,20}`）、`:193-200`（stream 恒发 usage chunk）。
→ 判定："真实 TUI 记账现在会写入 store" **成立**。遗留（非本次引入、不影响本判定）：`:309` `if (!harness)` 只建一次 harness，故 `usageProvider` 标签固定在首回合；`providerId` 亦不随 `/provider` 切换更新。

## 2. 用例⑥的判别力 —— 通过（确有判别力，非空转）
- 删掉 `chat.ts:275-276` 后：无订阅者 → 无 `record` → `totals()` 停在空表（`:580` 的前置 0 仍是 0）。**第一条变红的是 `chat.test.ts:595` `expect(totals.calls).toBeGreaterThan(0)`**（其后 `:598` token 断言、`:605` 阴性断言同理必红）。
- 走的是真实链：⑥ 用 `runChat`（`:583-589`），未传 `provider`，临时 provider root 无 `current.json` → 落 `MockProvider` 冒烟（`chat.ts:226-231/249-265`）；⑥ 内**无任何手工 `record`**（该 describe 内唯一的 `record` 在 `:494` 的 `seededUsageStore`，只被 ①② 使用）。
- 断言取舍合理：`inputTokens >= 100` 依赖 MockProvider 固定上报，判别 token 级记账而非金额（`toFixed(4)` 下金额确为 `$0.0000`，若断言金额非 0 会假阴性）。

## 3. 缺口②（`/cost` 缺"今日"行）—— 通过
- `chat.ts:368-388`：只要 `usageStore` 存在，今日行**总会尝试**计算（内层 `try` 无条件进入，`:375-383`），无 `if (today)` 之类前置短路。
- 用法匹配真实契约：`UsageDateQuery = {since?, until?}`（`apps/cli/src/usage/UsageStore.ts:193-198`）、`daily(query)`（`:1054-1070`）返回 `UsageDailyRow`，含 `costUsd`/`calls`（`:143-167`）→ `reduce` 字段名正确；`localDateKey` 已导出（`:316-321`），故 `since/until` 必为合法键，不会触发 `daily()` 的 `RangeError`（`:1057-1058`）。
- 内层 `catch`（`:381-383`）只 `push` 失败即省略该行，`return lines.join('\n')`（`:384`）在外层 `try` 内、内层 `catch` 之后 → 本会话/累计两行照常返回、不抛错；`daily()` 失败不会走 `:385-387` 的整段失败分支。
- 用例⑦（`chat.test.ts:608-621`）覆盖三行存在性（空表也成立）。

## 4. 新增问题 —— 未发现（含 2 处 P3 偏差）
- import 正确：`chat.ts:13`（type-only `UsageStore`）与 `:14`（值 `localDateKey`）是同一模块的两条语句，非重复绑定，合法且非错误；`:15` 引入 `renderTodayLine` 并在 `:380` 使用；无未使用 import。
- 回合增量滚动基线**未被破坏**：`chat.ts:326-333` 仍是 `renderTurnDelta(turnNow, usageBaseline)` 后 `usageBaseline = turnNow`；④/⑤ 回归用例未改。
- P3-a（外观）：实际行序为 **本会话 / 累计 / 今日**（`:374` 先 push 两行，`:380` 追加今日），而 `IMPLEMENTATION-BRIEF-08.md:29-32` 列的是 本会话 / 今日 / 累计；AC1 仅要求"含三行"，⑦ 用 `toContain` 故不暴露。
- P3-b（未变）：启动期 `totals()` 抛错 → `:285-289` 置 `usageBaseline = undefined` → `:326` 守卫为假 → 回合成本行**静默关闭**（无失败提示），与 brief 错误场景（`IMPLEMENTATION-BRIEF-08.md:56`）不符；仅回合中途抛错才打 `· 本回合成本读取失败`（`:331-332`）。低危，维持首轮 P3 判定。

## 5. 次要缺口现状
- `renderTodayLine` **无直接单测**：`costView.test.ts` 6 例只覆盖 `renderCostLines`×3 / `renderTurnDelta`×2 / 金额位数×1；`今日: $x.xxxx · N 次` 的精确格式仅由 ⑦ 的 `toContain('今日')` 间接兜底（格式回归不可测）。
- `vessel usage` 标题（AC3）**仍无专项单测**：`cli.test.ts:539` 只断言 `今日（本地日`；无"标题含实际 root 路径"的断言（首轮 §6 缺口延续）。

## 结论
两条硬缺口（①接线、②今日行）静态复核均**真修**，修复点与最小修复方向一致，判别性用例⑥非空转，无新引入缺陷 → **ACCEPT**。
最小可选后续（不阻塞验收）：补 `renderTodayLine` 单测 + 标题路径断言；把"今日"行插到累计之前以对齐 brief 行序；启动期基线失败时按 brief 打提示。

（静态审查，未复跑命令；本报告不改动任何代码。）
