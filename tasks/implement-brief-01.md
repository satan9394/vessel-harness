# IMPLEMENTATION-RESULT — BRIEF-01（执行记录，指挥汇编）

> 本轮 6 个执行器均在写入后中断（本环境跑命令的子代理必败），**无一份 IMPLEMENTATION_RESULT 由执行器自行落盘**——本文件由 Orchestrator 依工作树与提交历史汇编，作为缺失的交付记录（对应 `FIX-BRIEF-01.md` §交付 的要求）。
> 需求源：`IMPLEMENTATION-BRIEF-01.md`（G-01/G-02/G-14）；修复规格：`FIX-BRIEF-01.md`（S1–S4）。

## 执行历史（全记录，含失败）

| # | 执行器 | 任务 | 结果 |
|---|---|---|---|
| 1 | 64f36979 | 主体实现（G-01/G-02/G-14） | **失败**（停在阅读阶段，无产出） |
| 2 | 6d70b9da | 同上重试 | **失败**（空消息），但**工作树留下 4 文件主体实现** |
| 3 | 433a5cce | 补测试 + G-14 | **失败**（零残留） |
| 4 | bf678020 | **写入型**：MockProvider 测试 5 例 + TUI 欢迎语 | ✅ 完成（唯一含语法错误，见 #5） |
| 5 | 257f3242 | FIX：`chat.ts:261` 模板内嵌反引号语法错误（TS1005） | ✅ 完成 |
| 6 | d0cd836d | FIX 轮（S1–S4 一次性） | **失败**（零残留） |
| 7a | 7be3473f | FIX S2（setup.ts `cah`） | **写入成功但中断** → 实测已改 |
| 7b | ab06e3ef | FIX S3（注入源白名单 4→7） | ✅ 完成 |
| 8 | 3a4d90e1 | FIX S4（TUI 冒烟同步） | ✅ 完成 |
| 9 | fef6e43f | 测试加固（A3 判别力 + A4/A5/A6） | **写入成功但中断** |
| 10 | b813606c / 5f83e0c1 / 74678ff5 | S1 未知命令测试 | 前两次**失败**；第三次用"零阅读粘贴式"微任务 ✅ 完成 |
| 11 | 86b2b6ff | TUI TOOL_FAILURE 用例 | ✅ 完成 |
| 12 | 2c1f464f | TUI 首条 `when` 补 `summary`（与 CLI 对齐） | ✅ 完成 |
| 13 | 6378f629 | 文档 N2（`vessel chat` → 无参 `vessel`） | ✅ 完成（2 文件 6 处） |

## 最终改动文件清单

**代码（4 文件）**
- `packages/shared/src/provider.ts` — 新增 `ChatMessage.source?: string` + `INJECTED_MESSAGE_SOURCES`（7 项：environment/instruction/memory/compacted-summary/plan/handoff/inject；`steer` 有意排除）
- `packages/context/src/builder/Builder.ts` — `recordToMessage` 转发 `source`；volatile 层标 `source:'environment'`
- `packages/llm/src/provider/MockProvider.ts` — `surfaceUserMessage()` 跳过注入源；新增 `whenToolResult`；`resolve()` 供 chat/stream 共用
- `apps/cli/src/cli.ts` — cmdRun mock 增 TOOL_FAILURE 友好文案 + `fallbackText`；`main()` 未知子命令 → `console.error` + `return 2`
- `apps/cli/src/tui/chat.ts` — 欢迎语补引导；mock 同步 TOOL_FAILURE 分支 + `fallbackText`；首条 `when` 补 `summary`
- `apps/cli/src/providers/setup.ts` — 5 处 `cah` → `vessel`（含 4 处用户可见文案）

**测试（3 文件，+15 用例）**
- `packages/llm/src/provider/MockProvider.test.ts` — 5 → 11 例（A/A2 注入不遮蔽；**A3 双向判别**；A4 plan；A5 handoff/inject/memory/compacted-summary；B 兜底文案；C whenToolResult；A6 instruction 端到端）
- `apps/cli/src/cli.unknownCommand.test.ts`（新）— 3 例：`foo`→2、`chat`→2、对照 `list-terms`→0
- `apps/cli/src/tui/chat.test.ts` — +1 例：读失败输出友好文案且不含 `[TOOL_FAILURE]`

**文档**：`docs/PROVIDER-MANAGEMENT.md`（3）、`docs/REAL-MODEL-LANE.md`（3）、`docs/PROJECT-BRIEF.md`（2）

## 验证证据（指挥复跑，非实现者自证）

- `npx tsc -b tsconfig.json` → **exit 0**
- `npx vitest run` → **114 文件 / 1235 passed + 1 skipped / exit 0**（基线 1220+1 → +15）
- CLI 冒烟（注入临时 root，真实 E2E）：仓库工作区 `run --prompt '总结当前工作区 README'` → 真实 README 摘要、exit 0；`foo`/`chat` → 「未知命令 …」+ **exit 2**；`explain 小小蜜` / `provider list` / `settings list` → 均 exit 0（带参数已知命令未被误拦）
- 冒烟临时目录已送回收站

## 独立验收

- Round 1（全静态对抗）→ **REJECT**：S1 未知命令零测试 / S2 `cah` 属实（指挥误判被证伪）/ S3 注入源漏 `plan`·`handoff`·`inject` / S4 TUI 未同步
- Round 2（全静态对抗，复核修复）→ **ACCEPT**：S1–S4 与测试加固逐条通过（含行号证据）；残留 N1–N5 均非阻断

## 未解决问题 / 风险

- N4：`ChatMessage.source` 为裸 `string` + 手写集合 → 建议类型收窄或加漂移守卫测试（已列入下一轮候选）
- N5：`MockProvider.ts` / `Builder.ts` 注释仍列 4 个 source（陈旧）
- 偶发：全量 vitest 有一次 exit 1 仅伴随 "unhandled errors" 警告（测试全过），复跑 exit 0
- 环境风险：执行器写入后中断频发 → 依赖指挥保命提交与复跑验证
