# EVALUATION-REPORT-14 — 独立终评（Round 10 复评 / Round 7b 复评 / Round 11 初评）

> 独立 Evaluator，对抗立场（先假设修复是假、验收是假绿）。**静态审查，未复跑任何命令**；
> 指挥侧测试数字（tsc 0 / 1325 passed / jsonCommands 10/10 / TUI 35/35 / E2E 判别）仅作参考，未复核。

## 第一部分：Round 10 复评（上轮 AC1 = REJECT 的三条缺口）

1. **`models --json` 覆盖 ✅**：`jsonCommands.test.ts:331-348`（分支① mock：临时根无 providers/current → `getCurrent()='mock'` → `ProviderStore.ts:276` 内置 mock → `cli.ts:421-428` `{models:[]}`）与 `:350-383`（分支③ anthropic 无 baseUrl → `cli.ts:458-462` 内置清单）。两条都零网络：分支② 需要 `protocol==='openai-compatible' && cfg.baseUrl`（`cli.ts:439`），seed 的 anthropic 配置不构造 baseUrl，未触达 `fetchOpenAIModels`。断言非空 + 非人类表头 + 非 `--json` 对照（`:378-379`）→ 判别力成立。
2. **用例 3 不再空集永真 ✅**：`:190-244` 双 seed（内存假后端 `:194-203`；CLI 默认构造路径 `createDefaultProviderStore` `:208-217`），并**先做前提校验** `cliStore.get('ds2')?.apiKey === FAKE_KEY`（`:217`）——密钥解析不出来该行即 RED，故 `:234-235` 的"不含 FAKE_KEY / 不含 `"apiKey"`"不是"没有密钥可漏"。`providers.length>0` 与 `ids` 含 ds/ds2（`:228-231`）排除空集。
3. **错误路径 ✅ 且带非 JSON 对照**：`:390-424`。`cli.ts:1682-1689` 的 `main()` catch → `fail(1,…)`（`output.ts:24-32` 走 stderr）+ 重抛分支；用例断言退出码 1、stdout 空、stderr `JSON.parse` 出 `{error:{message,code}}`、message 含 `providers file corrupted` 与临时根、原文件逐字未改；对照行 `:417` 用 `rejects.toThrow` 覆盖非 JSON（brief 允许 reject 或人类文案）。
4. **无新增永真断言**：`:343` `models===[]` 是钉住 mock 语义（同用例已断言退出码 0 与不落人类行，非永真）；`:286/:294/:379` 三处 `JSON.parse(...).toThrow()` 都是反向判别。

**结论：ACCEPT**（三条缺口已闭合；唯一残留是分支② 网络路径无覆盖，brief 明确要求离线，可接受）。

## 第二部分：Round 7b 复评（上轮 REJECT：`:214` 未改 + 前缀零单测）

1. **实现侧全部达成 ✅**：`OpencodeGoProvider.ts:224` 已改为 `sanitizeErrorBody(extractWireErrorMessage(bodyText) ?? bodyText)`；`errorBody.ts:1-49` 确为**零 import** 叶子模块（`sanitizeWireSnippet` 下沉到 `:14-20`，函数体与原实现一致）；`OpencodeGoProvider.ts:42` 单向 import + `:51` 同名 re-export；`packages/llm/src/index.ts:2` 仍 `export *` 该模块，且 `index.ts` 未 `export *` `errorBody.ts` → **无重名导出冲突**；lane 外壳 `benchmarks/runners/src/lane/opencodeGoChatProvider.ts:13-31` 仍从 `@vessel/llm` 取到 `sanitizeWireSnippet`，导入可解析。未发现新问题。
2. **前缀单测仍未补 ✗**：`errorBody.test.ts` 现 9 例，新增的只有 `:50-58`（`sk_live_`/`sk_test_` 下划线变体）与 `:60-64`（紧贴单词字符 `xxxxsk-`）。全仓 `*.test.ts` 中 `gsk_|AIza|hf_` **零命中**（grep），跨 240 截断边界的判别例（`'a'.repeat(238)+'sk-…'`，验证"先遮蔽后截断"）同样零命中。即上一轮 REJECT 的第 2 条**原样未动**：删掉正则在 `gsk_/hf_/AIza` 上的三个 alternation，全量测试仍会绿。

**结论：REJECT（窄口径，仅测试缺口）**。最小修复：`errorBody.test.ts` 追加 4 例——`gsk_…`、`hf_…`、`AIza…`、跨 240 边界（断言输出不含 key 片段且含 `<redacted>`）。

## 第三部分：Round 11 初评（BRIEF-12，G-13-P1）

1. **`/permission` 取值 ✅**：`chat.ts:36-44` 白名单；`:528-530` 非法值只回用法、**不返回 `permission` 字段**（不宣称成功）；`:531` 合法值返回 `permission`。
2. **`/model` 会话内覆盖 ✅**：`:515-523` 返回 `model`；主循环置空 harness → `:268` `planProvider({ config: cfg, model })` → `providerFactory.ts:91` `model: input.model ?? config.model`（会话值优先）→ `buildRealProvider` 把新模型交给 provider 构造。**不是只改状态行**（对 mock/无 cfg 路径，新 model 同样进 MockProvider，`:284-287`）。
3. **主循环落盘 ✅**：`:383-392` 收到字段后真更新局部变量、`harness=null`（下次懒建用新值）、调 `syncSessionMeta()`；`:335-353` 用 `get→put` 保留 `createdAt`、刷新 `updatedAt`，`catch` 只 `console.warn` 不阻断。`resume` 侧读 `target.meta.permission`（`cli.ts:1616`）→ 持久化通道闭合。限制：harness 尚未懒建时 `currentSessionId` 为空 → 不写盘（`:336`），但首回合 `buildHarness` 会以新值登记（`:311-320`），终态一致。
4. **反例（主动找）**：
   - **`/provider`｜`/setup` 仍是同款假成功（既有，非本轮引入）**：`providerId` 在 `:247` 赋值后**全文件无重赋值**，`:493-503` 的向导成功后仍用旧 providerId/provider 请求，界面却说"已配置供应商 X"。brief 第 6 条要求"行为不变"，故不算本轮未达，但它是"宣称成功未生效"家族的残留成员。
   - **重建失败路径未按 brief 实现 ✗**：`harness=null`（`:385/:390`）后重建在 `:397` 且**不在 try/catch 内** → `buildHarness` 抛错（如 `providerFactory.ts:109` 缺 base-url、compose 失败）会冒泡出 `runChat`（`cli.ts:1682-1689` → 入口 exit 1），**整个 TUI 崩溃**，与 BRIEF-12 错误场景 2 "报错并保留旧 harness（不静默降级）" 不符（旧 harness 已被丢弃，无保留）。
   - `/quit`（`:539-541`）无状态宣称，非法 `/permission` 不改状态 → 无假成功。
5. **`/help` 一致性 ✅**：`:483-484` 两条均写"本会话后续回合生效"，与 `:522/:531` 文案一致；`:484` 列出三档取值，与实现白名单一致。（`/help` 未说明非法值行为，属可忽略的文案欠缺。）
6. **AC1 判别性裁定（不足以定案，需补 deny 面证据）**：机制链静态成立（`permission` → `compose.ts:174` `sessionOverrides: { profile }` → `PolicyEngine`），负对照（合法不切换=写入成功）确实排除了"环境本来就写不了"。但 `POSITIVE=false` 只有**一个 bit**：无法排除 (a) 重建/构建抛错致回合根本没跑、(b) 注入 provider 路径下工具调用未真正进入 Executor。两点旁证降低但不能消除该替代解释：`cli.test.ts:352` 有确定性单测"read-only 拒 Write"（说明 profile 语义存在）、CONTROL 用同一 provider/同一 prompt 却写了（说明 (b) 大概率不成立）。要定案，POSITIVE 侧必须断言**拒的证据**（DENIED/deny 审计事件或工具失败文案）且断言输出**不含** `[错误]`/异常。
7. **测试面 ✗**：`apps/cli/src/tui/` 仅 `chat.test.ts`（grep：无 `/permission` `/model` 行为用例、无 `syncSessionMeta`/`SessionMeta` 断言，仅 `:164-165` 的 `/help` 文案）。新字段与主循环应用**无仓内回归护栏**——还原 `:383-392` 全量测试仍绿。brief 把判别寄托于指挥侧 E2E，可解释但不足以替代 AGENTS.md §7。

**结论：REJECT（窄口径）**——AC2/AC3/AC4 静态成立，AC1 的"不写"侧成立但"被 Policy 拒"侧缺证据；另有第 4 条两个必修项。
最小修复方向：① `:397` 懒建包 try/catch（或保留旧 harness 引用）→ 失败时报错、旧 harness 继续可用；② E2E 补断 deny 面（事件/工具失败文案，且无 `[错误]`）；③ `chat.test.ts` 补 4 例（合法/非法 `/permission` 的返回字段、`/model` 返回字段 + 主循环后 `SessionMeta` 落盘且 `createdAt` 不变）。

## 汇总

| 部分 | 结论 | 必修 |
| --- | --- | --- |
| Round 10 AC1 复评 | **ACCEPT** | 无 |
| Round 7b 复评 | **REJECT** | `gsk_`/`hf_`/`AIza`/跨 240 边界 4 例单测 |
| Round 11 初评 | **REJECT** | 重建失败保留旧 harness；AC1 deny 面证据；仓内回归测试 |
