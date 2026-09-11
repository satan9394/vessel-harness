# IMPLEMENTATION-BRIEF-08 — 会话内成本可见性（G-09，P2）

> Round 8 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-09 / `docs/product-audit/CAPABILITY-MATRIX.md`（竞品审计评为"性价比第一"的缺口：**TUI 会话内无成本可见性**，而数据与 `vessel usage` 报表**早已存在**）。
> 定位：**纯展示 + 一处展示与实际不一致的修正**；不新增采集、不改用量记录语义、不做新功能扩张。

## 目标

1. TUI 里随时能看到**本会话花了多少**：新增 `/cost`（别名 `/usage`）斜杠命令。
2. 每回合结束后给**一行紧凑成本**（本回合增量），不必切出去跑 `vessel usage`。
3. 顺手修 `vessel usage` 标题硬编码 `~/.vessel/usage.json` 与实际 root 不符的展示漂移（独立 Evaluator 已记为 P3）。

## 用户场景

用户用 `vessel` 进 TUI 连续问几轮（DeepSeek 系价格波动大）→ 现状：**看不到任何成本**，只能退出后跑 `vessel usage` 才知花了多少；期望：每回合后一行 `· 本回合 $0.0032（1.2k in / 0.4k out）`，随时 `/cost` 看本会话累计与今日/总累计。

## 当前问题（证据）

- `apps/cli/src/tui/chat.ts:273-304`：回合循环里只打印 `result.finalText`（`:297`）或错误（`:300`），**无任何用量/成本输出**；斜杠命令表 `dispatchSlash`（`:315` 起）只有 `help` / `explain`(`?`) 等，无成本命令。
- 数据早已存在：`apps/cli/src/cli.ts:162` 的 `createUsageStore()`、`:280` 的 `usageStore:` 组合项、`:858/:912` 的用法；TUI 入口 `cli.ts:1505` 调 `runChat({...})` 时**未传** usage store。
- 展示漂移：`cli.ts:924` 标题硬编码 `=== 使用统计（~/.vessel/usage.json）===`，实际 root 由 `VESSEL_USAGE_ROOT`/`resolveUsageRoot()` 决定。

## 理想行为

1. `runChat` 的 opts 增加可选 `usageStore?: UsageStore`；缺省时**不构造**（保持现有测试与不传路径行为不变），仅在提供时启用成本显示。
2. 会话开始（进入循环前）记录基线 `baseline = usageStore.totals()`。
3. 每回合 `runTurn` 成功后（`kind` 非 `interrupted`/错误路径也要一致），计算增量并打印一行：
   `· 本回合 $<delta>（<in> in / <out> out）`；无增量时打印 `· 本回合 $0.0000（无用量记录）`。
   —— 只在 `usageStore` 存在时打印，且**不得**改变既有输出结构（`finalText` 仍原样打印）。
4. `/cost`（与 `/usage` 同义）：打印
   - `本会话: $<session> · N 次调用 · <in> in / <out> out`（`session = totals - baseline`）
   - `今日: $<today> · M 次`
   - `累计: $<total> · K 次`
   - 会话内无任何用量时：`本会话暂无用量记录`（仍打印今日/累计）。
5. `cli.ts:924`：标题用**实际 root**（`resolveUsageRoot()` 或 store 的 rootDir），不再硬编码 `~/.vessel`。

## 涉及模块

`apps/cli/src/tui/chat.ts`（命令 + 回合输出 + opts）、`apps/cli/src/cli.ts`（TUI 入口传 `usageStore`；usage 标题实际 root）、`apps/cli/src/tui/chat.test.ts`（用例）。

## 不能破坏什么

- 既有 TUI 行为与测试：欢迎语、`/help`、`/explain`、`?`、mock 冒烟、Ctrl+C 语义、`quit`。
- 用量记录语义与 `usage.json` 结构；`vessel usage` 的其它输出行。
- `tsc -b` 0；全量 `vitest`（现 **121 文件 / 1280 passed + 1 skipped**）全绿。
- 测试隔离（AGENTS.md 约束 8）：测试若构造默认 store 必须注入临时 `VESSEL_USAGE_ROOT`；TUI 测试优先注入**内存/临时 root 的 UsageStore**。

## 验收标准

1. 注入一个临时 root 的 `UsageStore`（先 `record` 一条已知用量）→ `/cost` 输出含该金额与 `本会话`、`今日`、`累计` 三行；空 store → 含 `本会话暂无用量`。
2. 注入后跑一轮（mock provider）→ 输出出现 `本回合` 行；**不注入** `usageStore` 时输出**不出现**该行（回归保护）。
3. `vessel usage` 标题在 `VESSEL_USAGE_ROOT` 指向临时目录时显示**该实际路径**（E2E 验证）。
4. `tsc -b` 0；全量 vitest 绿（新增用例计入）。

## 错误场景

- `usageStore.totals()` 抛错（文件损坏等）→ 成本行打印失败提示而不是中断回合（`/cost` 同理）。
- 未提供 `usageStore`（如 `--mock` 之外的自定义组合）→ 全部成本显示静默关闭，不影响任何既有输出。

## 测试要求

- 写入型微任务（单文件/单点，执行器不跑命令）；指挥复跑 `tsc -b` + 全量 vitest + **判别性 E2E**：临时 `VESSEL_USAGE_ROOT` 下跑 `vessel usage` 看标题路径；TUI 路径用 mock provider 冒烟确认每回合成本行与 `/cost`。
- 之后交独立静态 Evaluator 复核。
