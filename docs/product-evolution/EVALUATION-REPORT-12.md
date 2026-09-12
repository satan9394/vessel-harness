# EVALUATION-REPORT-12 — BRIEF-10 `--json`（G-11 之 JSON 半）独立评估

> ⚠️ **状态提示（Round 132 追加，不改正文）**：本报告是**当时**的独立评估快照——正文一律保留原样，**不追改**（改它等于篡改历史）。其中涉及的以下结论**已在本段被后续卡改变**，请看 PRODUCT-STATE.md 的当前队列：un --json 此前**不产 JSON 文档**（Round 130 起已产，且仍在补 durationMs/拦截审计）；policy status 此前**恒退 0**（Round 123 起编译失败退 1）；ench-report --json 此前**把人类摘要写进 stdout**（Round 123 起改走 stderr）。
> Round 10 独立 Evaluator，对抗立场。**方法：静态审查，未复跑任何命令**（不运行 `tsc`/`vitest`/E2E，不 git diff）。
> 证据取自当前工作区文件内容 + 行号；指挥侧 E2E 结论仅作交叉参考，不采信为验证。

## 逐条判定

**1. 五条命令是否真的支持 `--json` —— 通过**
- `usage`：`cli.ts:993-1004`（`emitJson({totals,daily,byProvider,byModel,recent})`）。
- `provider list`：`cli.ts:473-491`（子命令 switch 内，前置无任何打印：467-471）。
- `models`：三处 `cli.ts:422-426`（mock）、`442-445`（实时拉取）、`457-460`（内置清单），覆盖全部分支。
- `sessions list`：`cli.ts:1583` **确已传参** `cmdSessionsList({ json: isJson(parsed.flags) })`；分支在 `sessions/commands.ts:73-87`（上轮的"没传 opts"已修，实查为 `{ json: ... }` 对象字面量，非裸调用）。
- `settings list`：`cli.ts:1573` → `cmdSettings`（`guideCommands.ts:158-161`）→ `cmdSettingsList(flags, opts)`，`flags` 透传到 `96-107`。无漏项。
- 遗留（不影响本判定）：`provider current`（只读）无 `--json`，USAGE 也未列它。

**2. `--json` 下 stdout 是否只有一段 JSON —— 通过（含已知例外）**
- 五条命令的 JSON 分支都在各自**第一条人类打印之前**且立即 `return`；`provider`/`defaultProviderStore`/`fetchOpenAIModels` 全链路无 `console.*`（`apps/cli/src/providers/*.ts` 零命中）。
- `resume` 前置提示已包住：`cli.ts:1596-1598`（`if (!isJson(...))`）。
- 例外（超出 brief 点名的五条，USAGE `cli.ts:113` 已声明"仅只读命令"）：`usage recompute --json`（`cli.ts:981` 在 JSON 分支之前直返）与 `resume --json` 后续 `cmdRun` 仍打人类输出。

**3. 敏感字段 —— 通过**
- `provider list --json` 是**逐字段白名单**（`cli.ts:477-488`），非 `{...p}` 展开；`ProviderConfig.apiKey`（`ProviderStore.ts:70`）**不在白名单内**。白名单里的 `endpoints` 元素类型 `{url,label}`（`ProviderStore.ts:43-48`）本身无密钥，安全。
- `models` 只输出 `src.models: string[]`；`sessions` 显式白名单（`commands.ts:76-84`）；`settings` 输出 `VesselSettings{theme,locale}`；`usage` 只有价格/模型名。均无密钥类字段。

**4. 默认路径零改动 —— 通过（静态）**
- 五处 JSON 分支全部"先判后 return"，未插进人类打印之间；人类行仍在原行号区（`1006+`、`492-498`、`427/446-448/461-462`、`89-100`、`108`）。
- 既有文案断言**无需改动**：全仓 `*.test.ts` 中除 `output.test.ts`（仅测 helper）外 **`--json` 零命中**，即没有任何既有用例进入 JSON 分支。已核对 `guide.test.ts:138-154`（传 `new Map()`）、`resume.test.ts:122-178`（不传 `json`）——均走人类路径。
- `cmdSettingsList` 非 JSON 仍是 fail loud（catch 只在 `isJson` 内，`guideCommands.ts:101-107`），满足 `cli.crashSurface.test.ts ①`。

**5. 验收 2「两模式一致」 —— 通过（静态）**
- `totals` 同源：人类 `cli.ts:1006` 与 JSON `cli.ts:997` 都取自同一 `createUsageStore()`（`982`）的 `store.totals()`；人类打印 `t.costUsd.toFixed(4)`（`1009`），JSON 给原始数值——数值口径相同。
- 窗口同参：JSON `daily({since,until})`（`998`）与人类 `daily({since,until})`（`1056`）参数来源同一对 `flags`（`984-985`）；`recent` 两侧同为 `Number(flags.get('recent') ?? 5)`（`1001` vs `1097`）。未发现"JSON 无参 / 人类带窗口"的分裂。
- 注：JSON 的 `daily` 恒输出（人类仅在有窗口/`--by-day` 时打印）——是超集，非口径分裂。字段名与 brief 字面略有出入：brief 写 `breakdown`，实现给 `daily`（`costBreakdown` 在 `totals` 内），而 `daily` 恰是数据层五个方法之一，判为更贴合"字段名与数据层一致"，不算违规。

**6. 错误路径（AC4）—— 不通过**
- 只有两处走 JSON 信封：`sessions/commands.ts:63-67`（登记根建不出 → stderr JSON + 1）、`guideCommands.ts:104-106`（settings.json 损坏 → `fail(1,…)`）。
- **`provider list --json` 在数据源不可读时不合法**：`providers.json` 损坏会 throw（`ProviderStore.ts:556/559/565`），经 `cmdProvider` 冒泡到 `cli.ts:1663-1666` 的兜底 `console.error(describeStartupFailure(err).message)`——**人类文案**写 stderr。这是 AC4 点名场景的直接反例。
- 同类：`cli.ts:418`（provider 不存在）、`450-451`（实时拉取失败）在 `--json` 下仍打人类 stderr；`cli.ts:988`（`--since` 非法）、`1580`（未知 sessions 子命令）、`1622`（未知命令）同样不打 JSON——违反 brief「错误场景」第 3 条。
- AC4 亦无任何测试或指挥侧 E2E 证据（证据清单只有成功路径 + 空表路径）。

**7. 测试真实性 —— 部分通过**
- `output.test.ts` 4 例均为真断言：`calledTimes(1)`（`:19`）、`JSON.parse` 等值（`:22`）、缩进（`:23`）、`fail` 信封 + `logSpy` 未调用（`:31-33`）、`human()` 优先（`:40-43`）。无永真断言。弱项：`:21` 的 `not.toContain('[vessel]')` 对字面量近似恒真（低价值但无害）。
- **五条命令的 `--json` 零用例覆盖**（全仓 `*.test.ts` grep：仅 `output.test.ts` 命中）→ 验收标准 1 字面要求"五条命令各有 `--json` 用例"**未达成**；AGENTS.md 规则 7（新功能必须有测试）同样不满足。含 `cmdSessionsList({json:true})` 也无单测。

## 结论

**REJECT（有条件）**。核心机制可用、默认路径静态上确实零改动、验收 2 的口径统一成立（这是防假绿的关键，判过）。但**验收标准 1 与 4 未达成**，且 AC4 有明确代码反例（`provider list --json` + 损坏 `providers.json` → 人类 stderr）。

最小修复方向（按性价比排序）：
1. 五条命令各补 1 个 `--json` 用例（`main([...])` 或直接调 `cmdSessionsList({json:true})`），断言 `JSON.parse` + 无人类标题；至少含 1 个错误路径用例（`provider list --json` + 损坏 `providers.json`）作为 AC4 的判别性证据 → 直接堵上 AC1+AC4。
2. 把 `--json` 下仍走人类 stderr 的出口改走 `fail(...)`：`cli.ts:418`、`450-451`、`988`、`1580`、`1622`，以及 `cmdProvider`/`cmdModels` 外层——最省事的做法是在 `main()` 的兜底 catch（`1663-1666`）里判 `isJson(parsed.flags)` 输出信封。
3. （P3，不阻断）`provider list --json` 补 `current` 字段；`usage --json` 是否暴露 `--strict` 审计/`dailySummary` complete-partial 由后续切片决定；`vitest.setup.ts:28` 的 `rmSync` 属仓库既有 tmp 清理先例，非本轮新增违规。

（本轮为静态审查，`tsc -b` 与全量 vitest 结论未独立复跑，验收 6 判为"无法判定"——指挥侧 1313 passed 未被我证伪，亦未被我证实。）
