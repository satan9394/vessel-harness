# EVALUATION-REPORT-09 — G-09 TUI 会话内成本可见性（Round 8 独立静态复核）

结论：**REJECT**（2 处硬缺口：真实 TUI 路径不产生任何用量记录 → 成本行恒为 0；`/cost` 缺"今日"行 → 验收标准 1 不满足）。
范围：静态审查，**未复跑命令**（不运行 tsc/vitest/E2E）；仅读源码与测试。指挥侧运行证据按"未复现"对待。

## 逐条判定

**1. 两种基线是否真的分离 —— 通过（但被第 2 个问题架空）**
`chat.ts:279-286`：`usageBaseline = usage.totals()` 只取一次，`sessionBaseline = usageBaseline` 是**独立 const 绑定**；`chat.ts:325` 用 `usageBaseline = turnNow`（重新赋值，非原地改对象），`totals()` 每次返回新对象，故 `sessionBaseline` 不会被污染。
`chat.ts:297` 给 `dispatchSlash` 传的是 `usageBaseline: sessionBaseline`，`chat.ts:368` 用 `ctx.usageBaseline` 渲染 → `/cost` 拿到的确是会话起始基线。
第 2 回合不会重复计入第 1 回合：回合末 `renderTurnDelta(turnNow, usageBaseline)` 用的是上一回合末值，随后才推进基线。**语义正确。**

**2. 真实 TUI 路径根本不记账 —— 不通过（功能空转，最严重）**
`composeHarness` 的记账开关是 `opts.usageStore` + `opts.usageProvider`（`packages/application/src/compose.ts:297-317`，仅在 after_model 时 `record()`）。命令行路径传了（`cli.ts:280-281`），**TUI 路径没传**：`chat.ts:265-272` 的 `buildHarness()` 只有 `workspaceRoot/provider/model/policySystemPath/behaviorIRPath/permission`，`chat.ts` 内 `composeHarness` 只出现这一次（grep 确认），全 TUI 目录无 `usageProvider`。
后果：真实用户跑 TUI 时 `usage.totals()` 永不变化 → 每回合固定打印 `· 本回合 $0.0000（无用量记录）`，`/cost` 永为 `本会话暂无用量记录`。比改动前更糟：主动显示"无用量记录"这一误导性断言。
指挥侧"判别性 E2E ②"是**手工 record** 后渲染 costView，绕过了 runChat 接线，因此掩盖了本缺陷；⑤ 之所以绿也只是因为该行无条件打印 $0.0000。
最小修复：`buildHarness()` 内 `composeHarness({ ..., usageStore: opts.usageStore, usageProvider: providerId })`。

**3. 未注入时零成本输出 —— 通过**
唯一打印点 `chat.ts:321-329`，整体被 `if (usage && usageBaseline)` 包住（含 catch 分支），`usage` 缺省为 `undefined` → 完全不打印。/cost 分支 `chat.ts:365-366` 返回"成本显示未启用（本会话未注入 usage store）"。测试 ③ 与 grep 均未发现无守卫的 `· 本回合`。
小偏差：`totals()` 启动即抛错时 `usageBaseline` 为 undefined，回合成本行**静默关闭**；brief 错误场景要求"打印失败提示"。低危。

**4. `/cost` 缺"今日"行 —— 不通过（验收标准 1/理想行为 4）**
`costView.ts:20-28` 只产出 2 行（本会话、累计），注释自称"今日行由调用方按需追加"，但唯一调用方 `chat.ts:368` 直接 `return { output: renderCostLines(...) }`，**从不追加**；全 `apps/cli/src/tui` 目录 grep `今日|dailySummary` 零命中。
→ AC1（"含该金额与 本会话、今日、累计 三行"）字面不满足。修复方向：调用方按 `usageStore.dailySummary()` 取 `localDateKey(new Date())` 分桶（无分桶时 `$0.0000 · 0 次`）拼第 2 行。

**5. costView 纯函数正确性 —— 通过**
4 位小数（`costView.ts:17` `toFixed(4)`，测试第 6 例断言 `$12.5000` 具体串）；`dCalls===0 → 本会话暂无用量记录`（`:24`）；无用量 `（无用量记录）`（`:35`）；无基线本会话=累计（`base?.x ?? 0`，`:21-26`）。
`base?` 可选已用 `?? 0` 处理，无 undefined 崩溃；除零不存在（无除法）。风险仅剩浮点：totals 下降（recompute）时可能渲染 `$-0.0000`，纯外观。

**6. 测试真实性 —— 部分通过**
④ 非空洞：`chat.test.ts:536-546` 先断言 `交互会话开始` 再断言无 `· 本回合`，冒烟确已执行。⑤（`:549-559`）用同一输入路径（`['你好','/quit']`）证明注入后该行出现，对"是否打印"这一命题成立。
但 ⑤ **不能**证明增量取值正确：注入的 store 在回合中从未被写入（见第 2 条），它照样绿。④/⑤ 只能护住"打印与否"，护不住"金额对不对"——真实记账缺失因此无测试可发现。
`costView.test.ts`（6 例）断言均为具体字符串（`:12/:19/:31/:35`），无 `toContain('$')` 式空泛断言，无永真断言。
缺口：`vessel usage` 标题改动（AC3）无任何单测覆盖（grep `使用统计（` 在 `*.test.ts` 零命中），仅靠一次性 E2E。

**7. 回归/越界 —— 通过**
欢迎语（`chat.ts:275`）、`/help` 既有 9 条 + 新增 `/cost`（`:373-388`）、`? `/`/explain`（`:350-359`、`:419-424`）、Ctrl+C 两段式（未改）、`finalText` 打印结构（`:311-313`）均保持原样。
`cli.ts:924` 标题改用 `path.join(resolveUsageRoot(),'usage.json')`，只动标题行（`:925` 起正文未变）；`createUsageStore()`（`cli.ts:162-172`）**未传 rootDir** → `UsageStore` 回退 `resolveUsageRoot()`（`UsageStore.ts:416`），与标题同源，**判定一致**（仅当同进程中途改 env 才可能漂移，实际不发生）。`--strict` 未传给 `cmdUsage` 的 store 属既有行为，非本次引入。

**8. 测试隔离 —— 通过**
`chat.test.ts:471-489` 在 beforeEach 同时注入 `VESSEL_PROVIDER_ROOT` 与 `VESSEL_USAGE_ROOT`（两个 `mkdtemp`），afterEach 还原并清理；注入的 store 用显式 `rootDir: usageRoot`（`:493/:556`），不触真实 `~/.vessel`。符合 AGENTS.md 约束 8。

## 结论与最小修复方向（按优先级）

1. **REJECT 主因**：`chat.ts:265` `buildHarness()` 补 `usageStore: opts.usageStore, usageProvider: providerId`（否则整个 G-09 在真实 TUI 中是 0 值空转）。
2. **REJECT 次因**：`/cost` 分支补"今日"行（`dailySummary()` + `localDateKey`），或明确将 brief 该行降级并同步改验收标准。
3. 建议补测：① 用真实 `UsageStore` + mock provider 跑 `runChat` 断言 `· 本回合` 后**金额不为 0** 且 token 数与固定价目吻合（能抓住第 1 条）；② `vessel usage` 标题在临时 root 下含该路径的断言。
4. 低危可选：`usageBaseline` 缺失时按 brief 打失败提示而非静默关停。
