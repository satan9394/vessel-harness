# IMPLEMENTATION-BRIEF-01 — CLI 入口健壮性：首次成功使用 + 未知命令分派

> 第五/六阶段产物（Orchestrator 产出，供独立 Implementer 执行）。对应 G-01 + G-02（P0，一组高度耦合的 CLI 入口问题）。
> 审计证据来源：docs/product-audit/UX-REPORT.md §1.1 / §1.2（独立 UX 审计实跑复现）。

## 目标

让「一个完全不了解 Vessel 的人」能自己完成**第一次成功使用**：
1. README「快速开始」首条示例命令（默认 mock、仓库工作区）产出**真实可读结果**或明确的确定性应答，而不是 `(mock: no script entry matched)` + exit 0（假成功）。
2. 未知/拼错的子命令**明确报错并提示**（`vessel help`/`--help` 指引 + exit 2），绝不静默当作 run 执行。

## 用户场景

- 新用户 clone 仓库 → 按 README 跑 `vessel run --prompt "总结当前工作区 README"` → 期望得到总结（或至少可理解的提示），现状得到无意义文本 + exit 0。
- 用户敲 `vessel foo`、`vessel chat`（文档曾声称的 TUI 入口，实际无参 `vessel` 才是）→ 现状静默 mock run，期望「未知命令：foo。试试 vessel --help」并以非 0 退出。

## 当前问题（证据）

- **G-01**：`ContextBuilder.assemble()` 把 volatile skills index 作为**最后一条 user 消息**追加（`packages/context/src/builder/Builder.ts:154-161`）；`MockProvider` 只拿**最后一条 user 消息**做脚本匹配（`packages/llm/src/provider/MockProvider.ts:53-55,60-66`）。仓库工作区存在 skills index → `when: /阅读|read|总结|summary/i` 永远不命中 → `(mock: no script entry matched)`。测试全绿是因测试注入**无 skills 的临时空工作区**（`apps/cli/src/tui/chat.test.ts:215-248` 注释自述）——线上首次运行场景被测试掩盖。
- **G-02**：`main()` 无未知子命令分支（`apps/cli/src/cli.ts:1466-1510`；`parseArgs` 默认 `command='run'`，cli.ts:118），任意第一参数落入 `case 'run'`。
- **G-14（文案，随本 slice 顺手修）**：`apps/cli/src/setup.ts`（或对应向导文件）3 处仍在教用户过时命令 `cah *`；TUI 欢迎语不提 `/explain` / `? <term>` / `setup` / `guide`。

## 理想行为

1. mock 冒烟在**有 skills index 的仓库工作区**也可命中：MockProvider 匹配时**跳过注入型 user 消息**（volatile skills index / instruction / memory 等），只匹配真实 surface 用户输入；或把注入消息的 role 改为 system（不得让 mock 脚本匹配到环境注入）。
2. 冒烟脚本给**确定性兜底**：任一真实输入都有可读应答（如 "mock: 已按镜头执行。真实模型请配置 provider（vessel provider set）"），不再输出 `(mock: no script entry matched)` 这种无解释文本。
3. 未知子命令 → stderr 输出「未知命令 <x>。可用：vessel --help」+ **exit 2**；`vessel chat` 若已不是有效入口也走未知命令提示（TUI 正确入口是无参 `vessel`，README/引导同步说明）。
4. README「快速开始」示例在新行为下可复现成功；TUI 欢迎语补引导（/explain、? <term>、guide）；setup 向导过时命令文案更正。

## 涉及模块

- `packages/context/src/builder/Builder.ts`（volatile 注入消息的标记/role）
- `packages/llm/src/provider/MockProvider.ts`（匹配逻辑：跳过非 surface user 消息 + 兜底应答）
- `apps/cli/src/cli.ts`（未知子命令分支 + exit 2）
- `apps/cli/src/setup.ts` / TUI 欢迎语（G-14 文案）
- README「快速开始」（命令说明与 TUI 入口）

## 不能破坏什么

- **测试隔离纪律（AGENTS.md 约束 8）**：凡构造默认 store 的用例必须注入临时 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`；不得读写真实 `~/.vessel`。**但注意**：本次修复目标恰恰是"带 skills index 的工作区"场景，新测试必须**显式构造含 skills 的环境**（不是临时空工作区），否则等于没测。测试内可构造最小 skills index 注入 context 即可。
- 现有全量 vitest（1220+ 条，含 117 guide 用例）+ `tsc -b` 全绿；mock 在空工作区/已有测试中的既有命中行为不回归。
- mock 的确定性（无网络）特性保持；`vessel run`/TUI 无参入口的既有语义不变（除未知命令不再静默）。

## 验收标准（Evaluator 用）

1. **G-01 修复**：在有 skills index 注入的 workspace（测试构造 + 仓库工作区实跑）下，`run --prompt "总结当前工作区 README"` 不再输出 `(mock: no script entry matched)`；输出为可读结果或确定性兜底应答；exit 0 保持（成功路径）。
2. **G-02 修复**：`vessel foo`、`vessel chat`、其它任意未知第一参数 → stderr 提示「未知命令」+ exit **2**（非 0）；已知命令（run/chat 有参/guide/settings/provider/pricing/usage/models/explain/list-terms）行为不变。
3. **测试真实性**：新增测试显式覆盖「含 skills index 注入」的 mock 匹配场景（而非只测空工作区）；未知命令 exit 码测试；`tsc -b` + 全量 vitest 0 失败。
4. **G-14 顺手项**：setup 向导无 `cah *` 过时命令残留（grep 验证）；TUI 欢迎语含引导提示；README 快速开始与 TUI 入口描述与实际一致（`vessel chat` 若非入口则不在文档中作为 TUI 入口出现）。

## 错误场景

- 空工作区 / 无 README（mock 命中但 Read 失败）：给友好提示，不把 TOOL_FAILURE 原文当成功回复。
- 命令带未知 flag / 位置参数异常：不改变既有行为（不在本 slice 范围），但不得回归。
- 无参 `vessel`（TUI 入口）保持正常启动。

## 测试要求

- 必须新增 Vitest 测试（数量自定但覆盖 1/2/3/4 验收点），全部在临时注入 root 下隔离运行。
- 全量 `npx vitest run` + `npx tsc -b tsconfig.json` 0 失败（受限环境注明"待指挥验证"）。

## Implementer 输出（IMPLEMENTATION_RESULT）

改动文件清单（diff 摘要）、新增测试与运行结果、未解决问题、风险、证据（命令输出）。**Implementer 不得自行宣布验收通过**——由独立 Evaluator 按本 Brief 验收。