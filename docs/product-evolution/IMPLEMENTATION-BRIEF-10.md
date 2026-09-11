# IMPLEMENTATION-BRIEF-10 — 通用 `--json` 机器可读输出（G-11 之 JSON 半，P2）

> Round 10 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-11 + 侦察结论（`apps/cli` 内 `--json` **零命中**，但数据层**已结构化**：`UsageStore.totals()/daily()/byProvider()/byModel()/recent()`、`ProviderStore.list()/get()/getCurrent()`）。
> **本切片只做只读命令的 `--json`**；MCP 配置入口（G-11 另一半）**留待独立切片**——侦察确认它多一个真实技术缺口（`McpClient.ts:48-52` 的 StdioTransport 只认 `process.execPath`，要支持任意 command 得改传输层签名），成本与风险都更高，不宜与展示层混在一轮。

## 目标

让**主要只读命令**提供 `--json`：stdout 是**整段可解析的 JSON**，供脚本/CI 消费；**默认（不带 `--json`）行为一字不改**。

## 用户场景

用户要把 `vessel usage` 的数字接进自己的成本看板 → 现状：只能 `grep`/`awk` 人类可读文本（含中文标题与括号），脆弱；期望：`vessel usage --json` 输出单个 JSON 对象（totals/breakdown/byProvider/byModel/recent 等字段），`| jq` 直接可用。

## 当前问题（证据）

- `apps/cli/src` 内 `--json` **零命中**；唯一机器可读先例是 `vessel provider export` 无 `--out` 时把 JSON 打到 stdout（`cli.ts:612-617` → `providers/providerTransfer.ts:123`）。
- 已有**注入式输出 seam** 但主路径没接：`sessions/commands.ts:24-27,45-47`、`guide/guideCommands.ts:24-34`、`review/reviewCommands.ts:149`；且 `cli.ts:1536` 调 `cmdSessionsList()` 时**未传 opts**。
- 数据层已结构化，无需解析文本：`usage/UsageStore.ts:984`（totals）、`:1051`（daily）、`:1131`（byProvider）、`:1180`（byModel）、`:1184`（recent）；`providers/ProviderStore.ts:270`（list）、`:275`（get）、`:457`（getCurrent）。

## 理想行为

1. 新增 `apps/cli/src/output.ts`（小模块，纯函数）：
   - `isJson(flags: Map<string,string>): boolean`（`flags.has('json')`）
   - `emitJson(value: unknown): void`（`console.log(JSON.stringify(value, null, 2))`，**只此一行输出**，不加 banner/提示）
   - `fail(code: number, message: string, flags: Map<string,string>): number`（`--json` 时往 **stderr** 打 `{"error":{"message":…,"code":…}}`，否则沿用现有中文 stderr；返回 `code`）
2. **覆盖五条只读命令**：`usage`、`provider list`、`models`、`sessions list`、`settings list`。
   - 每条命令在打印前分支：`--json` 时 `emitJson(<该命令已有的结构化对象>)` 并 `return 0`；
   - **默认路径的代码与文案一字不改**（这是硬约束，见"不能破坏什么"）。
3. **字段名与数据层一致**（不要另造语义）：`usage` → `{ totals, breakdown, byProvider, byModel, recent }`（取自上述 store 方法）；`provider list` → `{ providers: [...] }`；`models` → `{ models: [...] }`；`sessions list` → `{ sessions: [...] }`（复用 `cmdSessionsList` 的 registry 数据，**需给它传 opts 或新增 `cmdSessionsListJson`**）；`settings list` → `{ settings: {...} }`。
4. **错误也 JSON 化**：`--json` 下任何失败路径（如读取失败）**stdout 为空**、stderr 是合法 JSON、退出码非 0。
5. `USAGE` 里补一句全局说明（例如 `  --json              以 JSON 输出（仅只读命令；见各命令）`）。

## 涉及模块

`apps/cli/src/output.ts`（新）、`apps/cli/src/cli.ts`（五条命令的 JSON 分支 + 分派处传 flags）、`apps/cli/src/sessions/commands.ts`（可选：加 JSON 输出路径）、`apps/cli/src/guide/guideCommands.ts`（settings list 的 JSON 路径）、相应测试。

## 不能破坏什么（**本切片头号风险**）

- **默认输出零改动**：`apps/cli/src/cli.test.ts` 有大量人类文案断言（如 `:267/:277/:302/:312/:377/:391/:460/:520/:537/:618/:750/:790/:854/:935/:982` 等 `toContain('已添加'|'模型列表'|'使用统计'…)`），`guide/guide.test.ts:146-152`、`sessions/resume.test.ts:142` 同样。**只能叠加分支，不得改既有文案/结构/顺序**。
- `--json` 模式下 **stdout 必须全量可解析**：注意 `cli.ts:1549` 在分派前会 `console.log('[vessel] 恢复会话 …')`，且部分命令有前置行——**需要抑制这些杂行**（对 `--json` 生效；具体做法：把该行改为 `if (!isJson(flags))` 包住，或把提示统一走 stderr）。
- `tsc -b` 0；全量 `vitest`（现 **124 文件 / 1309 passed + 1 skipped**）全绿。
- 测试隔离（AGENTS.md §8）：新增用例覆盖默认 store 时必须注入临时 `VESSEL_PROVIDER_ROOT` / `VESSEL_USAGE_ROOT` / `VESSEL_SESSION_ROOT`。
- 无新依赖。

## 验收标准

1. **五条命令**各有 `--json` 用例：`JSON.parse(stdout)` 成功、字段名符合上文、且**不含**人类可读标题（如「使用统计」）。
2. **两模式数值一致（判别性，防假绿）**：对同一临时数据，`usage` 文本里的成本数字与 `usage --json` 的 `totals.costUsd` **对齐**（同一条数据两种口径必须相等）。
3. **stdout 纯净**：`--json` 下 stdout 中**不存在** `[vessel]` / `===` 之类 banner（含 `resume` 场景的前置提示）。
4. **错误 JSON 化**：`--json` 且数据源不可读时，stdout 为空、stderr 可解析为 JSON、退出码 ≠ 0。
5. **默认路径回归**：既有断言全绿（尤其上列文案断言文件），无需改测试。
6. `tsc -b` 0；全量 vitest 绿。

## 错误场景

- `--json` 与 `--strict` 等其它 flag 组合：互不干扰（各取各的）。
- 空数据（无会话/无用量）：仍输出合法 JSON（空数组/零值），而不是人类提示语。
- `--json` 配合未知子命令：保持既有 exit 2 语义，但 stderr 走 JSON（仅当 `--json`）。

## 测试要求

- 分小卡串行派发（本环境：大文件多处编辑易失败，新模块成功率高）；执行器不跑命令，由指挥复跑 `tsc` + 全量 vitest + **真实 CLI E2E**（`usage --json | JSON.parse`、`sessions list --json`、`provider list --json`、错误路径 JSON 化、默认路径逐字不变）。
- 完成后交独立静态 Evaluator 复核（重点：验收 2 的"两模式一致"是否真做、默认路径是否真的零改动）。
