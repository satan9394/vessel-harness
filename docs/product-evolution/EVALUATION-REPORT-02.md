# EVALUATION-REPORT-02 — 独立验收报告（Round 2，FIX 后复核）

> Evaluator：全新上下文、**对抗立场**（先假设上轮 S1–S4 没修到位、并主动找新问题）。
> **静态审查，未复跑任何命令**（tsc / vitest / tsx / git 均未执行）；运行时结论沿用指挥侧证据，并逐条与代码做一致性核对（不照抄）。
> 需求源：`EVALUATION-REPORT-01.md`（上轮 REJECT）→ `FIX-BRIEF-01.md`（修复规格）。
> 结论：**ACCEPT**（S1–S4 全部判定通过；另有 5 项非阻塞残留，见 §5）。

## 0. 核验方式与限制

- 精读：`apps/cli/src/cli.unknownCommand.test.ts`、`apps/cli/src/cli.ts`（1460–1535 / 230–290）、
  `apps/cli/src/providers/setup.ts`、`apps/cli/src/tui/chat.ts`（220–312）、`apps/cli/src/tui/chat.test.ts`（140–270）、
  `packages/shared/src/provider.ts`、`packages/shared/src/events.ts:39`、`packages/llm/src/provider/{MockProvider.ts,MockProvider.test.ts}`、
  `packages/context/src/builder/Builder.ts:41-74`、`packages/agents/src/planner/Planner.ts:74-87`、`docs/product-evolution/*`。
- 全仓文本检索用 grep（`cah`、`INJECTED_MESSAGE_SOURCES`、`source: '<…>'`、`vessel chat`、`main([`）。
- **不可判定项（如实标注）**：① 未复跑 `tsc -b` / `vitest`；② 未用 git 复核本轮精确 diff 与提交粒度（禁跑命令）——
  因此「是否有无关改动混入」只能在逐个核验文件内做越界判断，不能给出清单级证明。

---

## 1. S1 未知命令测试 —— **通过（具判别力）**

| 要求 | 判定 | 证据 |
|---|---|---|
| 测试文件存在 | ✅ | `apps/cli/src/cli.unknownCommand.test.ts`（55 行，独立文件而非塞进 `cli.test.ts`，可接受） |
| `main(['foo'])===2` | ✅ | `:36-37`，且 `:38-40` 断言 stderr 同时含「未知命令」与「vessel --help」 |
| `main(['chat'])===2` | ✅ | `:45-47` |
| 对照已知命令 `main(['list-terms'])===0` | ✅ | `:52-53`；`cmdListTerms` 是纯打印函数（`guide/guideCommands.ts:65-68` 直接 `return 0`，不读 store、不写盘），对照有效 |
| stderr（非 stdout）断言 | ✅ | 用 `vi.spyOn(console,'error')`（`:35,44`），Node 下即 stderr |
| 测试隔离（AGENTS.md 约束 8） | ✅ | `:14-31` 注入 `VESSEL_PROVIDER_ROOT`/`VESSEL_USAGE_ROOT`/`VESSEL_SETTINGS_ROOT` 到 tmp 子路径并在 `afterEach` 还原，先存后还原无泄漏；`:11-12` 说明三条用例在 store 访问前返回，与代码一致（`:1496-1499`、`:1487`）。未 `mkdtemp` 但全程不写盘，等价安全 |

**判别力（关键问题：删掉 `cli.ts` 未知命令分支这些用例会不会失败？）——会失败。**
证据链：`cli.ts:1479-1492` 白名单之后即 `:1496-1499` 的 `if (first !== undefined) { console.error('未知命令 …'); return 2; }`。
若删除该分支，`main(['foo'])` 将穿过 `:1500`（`first === undefined` 为假）落到 `:1517` 的 `switch(parsed.command)` → `'run'` → `:1526/:1529` `cmdRun(...)`。
两条断言中**至少一条必然失败**：要么返回码 ≠ 2，要么 stderr 不含「未知命令」（`cmdRun` 全路径不打印该串）。
⇒ 断言与实现对偶，不是永真/空壳用例。

**指挥侧运行证据与代码一致性**：冒烟「`foo`/`chat` → 未知命令 + exit 2」「`explain 小小蜜` / `provider list` / `settings list` → exit 0」与
`cli.ts:1486/1479/1489` 的白名单顺序、`:1496` 的兜底位置完全吻合，无矛盾。

---

## 2. S2 `cah` 残留 —— **通过**

`apps/cli/src/providers/setup.ts` 现无 `cah`，上轮点名的 4 处用户可见文案全部改写为真实命令：

| 行 | 现值 |
|---|---|
| `:103` | `把 "${id}" 设为当前默认供应商？（vessel run 立即使用）` |
| `:237` | `多次尝试后 API Key 仍无效。可稍后用 vessel provider add / vessel models 再试。` |
| `:268` | `作用域: ~/.vessel（影响本机所有 vessel run）` |
| `:301` | `已切换。vessel run 现在走 …` |
| `:7`（文件头注释） | `` `vessel setup` interactive wizard `` |

全仓 `cah` 检索结论：
- **非测试 `*.ts`**：仅 `apps/cli/src/providers/ProviderStore.ts:16` 的代码注释「不另造 `~/.cah`」——是"我们**不**造这个目录"的说明，非用户可见文案，**不构成残留**；`apps/cli/src/providers/providerFactory.ts:15` 提及 `vessel chat` 是「过去用」的历史叙述，同上。
- **测试**：仅 `cah-*` 临时目录前缀（`cli.test.ts:90-92` 等），按本轮口径忽略。
- **README**：0 命中。
- **docs**：命中的均为历史快照（`docs/REVIEW-REPORT-V0*.md`、`V0*-PROGRESS.md`、`ideas/*`）、命名迁移说明（`docs/VESSEL.md`、`CHANGELOG.md`）或本轮审计/验收记录本身——**操作类文档已干净**。

---

## 3. S3 注入源对齐 —— **通过；反向风险已排查**

- 集合现状（`packages/shared/src/provider.ts:53-61`）= `environment, instruction, memory, compacted-summary, plan, handoff, inject`（7 项）。
- 联合类型（`packages/shared/src/events.ts:39`）= `user | steer | inject | instruction | compacted-summary | plan | memory | handoff`（8 项）。
- **逐项判定**：7 个注入类**全覆盖**（上轮缺的 `plan`/`handoff`/`inject` 已补）；`user`/`steer` **正确地留在集合外**（`provider.ts:50-52` 注释明确 `steer` 是操作员实时驱动输入，语义有意保留）。
- **生产者核对（是否真的都会流到 `ChatMessage.source`）**：`Planner.ts:78-86`（`type:'user/message'`, `source:'plan'`）、`StartFromHandoff.ts:99`（`handoff`）、`benchmarks/runners/src/runner.ts:135`（`inject`）、`Builder.ts:132/144`（`instruction`/`memory`）、`Compaction.ts:91`（`compacted-summary`）——
  全部是 `user/message` 记录，经 `Builder.ts:41-50` 的 `recordToMessage` 原样转发（`:49` 仅在有值时带 `source`）。
- **反向风险（本该匹配的真实输入被误排除？）——未发现**。全仓 `source: '<值>'` 赋值检索只有上述 11 处（7 个注入源 + steer + 测试），
  **没有任何"真实用户输入"路径被贴上这 7 个标签**；未标 `source` 的 user 消息命中 `m.source ?? ''` → 落入集合外 → 正常匹配。
  唯一语义妥协是既有的 `steer` 可匹配（`AgentLoop.ts:689`）：若 steer 出现在真实输入之后，脚本匹配会切到 steer 文本——这是 FIX-BRIEF 明示的有意设计，且 CLI/TUI 冒烟路径无 steering，可接受。
- **扩集合是否影响非 mock 场景——不影响**。`INJECTED_MESSAGE_SOURCES` 全仓唯一消费点是 `MockProvider.ts:2,56`；真实 provider 三路序列化显式挑字段（上轮 §3 已核，本轮未见改动痕迹）。
  ⇒ 该扩展只作用于 mock 离线链路，正是本 bug 的目标面。

---

## 4. S4 TUI + 测试加固 —— **通过**

**S4（TUI 冒烟兜底）**：`apps/cli/src/tui/chat.ts:245-259` 现有三段脚本 + fallbackText，与 `cmdRun` 对齐：

| 元素 | TUI | CLI |
|---|---|---|
| TOOL_FAILURE 友好分支 | `chat.ts:247-252`（正则 `^\[(TOOL_FAILURE\|DENIED\|INVALID_ARGS\|TIMEOUT\|SANDBOX_DENIAL)\]`，`minToolResults:1`） | `cli.ts:254-259`（同一正则） |
| 友好文案 | `chat.ts:251` | `cli.ts:258` —— 逐字相同 |
| `fallbackText` | `chat.ts:258` | `cli.ts:265` —— 逐字相同 |

`chat.test.ts:229-244` 新增用例**真断言**：`:242` `toMatch(/未能读取工作区 README\.md/)`（友好文案存在）+ `:243` `not.toContain('[TOOL_FAILURE]')`（原文不外泄）；
`:232` 先断言临时工作区确实没有 README.md，场景不是空跑。
判别力：删掉 `chat.ts:247-252` 友好分支后，第三段脚本 `:253` 的 `{last_tool_result}` 会把 `[TOOL_FAILURE] …` 原样回显 → **两条断言同时失败**。✅

**MockProvider.test.ts 判别力逐条**（对照 FIX-BRIEF「测试加固」四条）：

| 用例 | 行 | 判定 |
|---|---|---|
| A3 注入正文刻意可命中 | `:55-71`（正文含「总结 summary」，断言 `:69` 非 `'OK'` + `:70` 恰为兜底串） | ✅ **有判别力**：无来源过滤时 haystack 含「总结」→ 命中 → 返回 `'OK'` → 断言失败。已修掉上轮「永真」问题 |
| A4 `plan` | `:73-86` | ✅ 注入正文不含关键词而压轴为注入消息，无过滤时漏命中 → 断言失败 |
| A5 `handoff`/`inject`/`memory`/`compacted-summary` | `:90-101`（`it.each` 四源） | ✅ 同上，四源各一条具名覆盖 |
| A6 `instruction`（端到端形态） | `:103-129`（模拟 `AGENTS.md` 压轴） | ✅ 同上；`:126` 注释点明"不过滤则 haystack 变 AGENTS.md" |
| 7 源覆盖完整性 | 头注释 `:16-19` 自述 | ✅ environment(A/A2/A3)、instruction(A6)、memory/compacted-summary/handoff/inject(A5)、plan(A4)，**7/7 有具名覆盖** |

无 `!== undefined` 之类永真写法；A2（`:45-53`）与 B（`:131-145`）判别力弱但性质是正向对照/选项验证，不构成"永真断言"不通过项。

---

## 5. 新问题扫描（本轮重点）—— 无阻断项，5 条非阻塞残留

**N1（判断题，要求给出判断与理由）TUI 与 CLI 的 mock 首条正则不一致 —— 计为真实但低危缺陷，不阻断。**
`chat.ts:246` 为 `/阅读|read|总结/i`，`cli.ts:250` 为 `/阅读|read|总结|summary/i`。
判断：**算缺陷（同一 mock 冒烟在两入口语义不同），但属 P3 文案/一致性级**。理由：
① 差异只在"输入含 summarize/summarise 且不含 read/阅读/总结"时显形（如 TUI 敲 `summarize this project`）——此时 TUI 不触发 Read 工具，落到 `chat.ts:258` 的 `fallbackText`，输出仍是**友好且确定性**的，不崩溃、不吐裸错误、不假成功（对比 G-01 的 `(mock: no script entry matched)` 那种误导性兜底，已不存在）；
② 大多数真实写法（"summarize the README"）因 README 含 `read` 仍会命中；
③ FIX-BRIEF S4 的明文要求只有「补 `fallbackText` + 友好分支」，两者均已满足且文案逐字对齐。
建议（下一轮一行修）：TUI 正则补 `summary`，顺带把第三段文案 `chat.ts:253`（`（mock）读取结果：`）与 CLI `cli.ts:260`（`已通过 Read 工具读取工作区文件。内容开头：`）统一。

**N2 文档仍把 `vessel chat` 当 TUI 入口 —— 非阻塞（上轮已列为附录项，本轮未修）。**
`docs/PROJECT-BRIEF.md:21,52`、`docs/PROVIDER-MANAGEMENT.md:173,208,220`、`docs/REAL-MODEL-LANE.md:117,310,349` 仍写 `vessel chat`；
而该命令现在 `cli.ts:1496-1498` 直接报「未知命令 …」+ exit 2。README 已干净（0 命中）。
不阻断：运行时给的是明确报错 + `vessel --help` 指引，不存在"文档入口静默跑 run"的旧危害。建议下一轮纯文档卡统一为「无参 `vessel`」。

**N3 状态文档自相矛盾/未刷新 —— 非阻塞（证据卫生）。**
`docs/product-evolution/PRODUCT-STATE.md:34` 仍称「**审计报告存在误报**（G-14 的 `cah *`）」，与同文件 `:19` 的「订正：并非误报」以及本轮的 setup.ts 修复**直接冲突**（保留与事实相反的表述，正是上轮 S2 点名要清掉的那句）。
另 `:22` 未刷新为本轮证据（仍 `113 文件 / 1225 passed`、`独立 Evaluator 裁定：待回填`，而 `EVALUATION-REPORT-01.md` 已存在并 REJECT）。
影响仅限文档可信度，不影响代码；建议下一轮随状态刷新一并订正。

**N4 `ChatMessage.source` 仍是裸 `string`，集合与联合无编译期绑定 —— 非阻塞（残留设计风险）。**
`provider.ts:38` `source?: string`（对比 `events.ts:39` 的 8 值联合）。集合是手写 7 项（`provider.ts:53-61`），
将来若有人往联合里加第 9 个注入源而忘记加集合，会静默退化为"可被 mock 匹配"且**无测试会红**（A4/A5 硬编码的是现有 7 个名字，不是从集合推导）。
上轮 S3 给的两条路（扩集合 / 改白名单语义）本轮选了前者并被 FIX-BRIEF 采纳，故不判不通过；建议后续把 `ChatMessage.source` 收窄为 `UserMessageRecord['source']`，或补一条"联合 ⊆ 集合 ∪ {user,steer}"的漂移守卫测试。

**N5 同区域注释陈旧 —— 极低危。**
`MockProvider.ts:47-52` 与 `Builder.ts:47-48` 的注释仍只列 4 个 source（未含 environment 之外新增的 plan/handoff/inject），
与已更新的 `provider.ts:41-52` 注释不同步。仅文档性。

**越界/粒度（受限判定）**：本轮逐项核验到的改动面为 `provider.ts`、`events.ts`（只读核对）、`setup.ts`、`tui/chat.ts`、`cli.unknownCommand.test.ts`、`MockProvider.test.ts`、`chat.test.ts`，
均落在 FIX-BRIEF 的 S1–S4 + 测试加固范围内；**未发现无关重构或第三方模块被动**。
但**无法**用 git/mtime 给出"改动清单完备性"证明（禁跑命令），且 FIX-BRIEF §交付要求的「改动文件清单 + 新增测试清单」在 `docs/product-evolution/` 与 `tasks/` 下**未见落盘文件**（`tasks/` 无 `implement-brief-01.md`），交付物靠指挥侧口头/证据传递。

---

## 6. 结论：**ACCEPT**

- S1 ✅（新增文件 + 真断言 + 删实现必失败 + 隔离合规）｜S2 ✅（4 处用户可见 `cah` 全部改正，非测试源码/README 无残留）｜
  S3 ✅（7 注入源全覆盖，`user`/`steer` 正确留在集合外，无反向误排除，唯一消费点 `MockProvider.ts:56` 故无非 mock 影响）｜
  S4 ✅（TUI 友好分支 + fallbackText 与 cmdRun 逐字一致，新用例断言"有友好文案且无 `[TOOL_FAILURE]`"，判别力成立）。
- 测试加固 ✅：A3 已具备判别力，A4/A5/A6 覆盖 plan/handoff/inject/instruction，7 源全覆盖，**无永真断言**。
- 指挥侧证据（`tsc -b` exit 0；`vitest` 复跑 114 文件 / 1235 passed + 1 skipped；CLI 冒烟：真实摘要、`foo`/`chat` exit 2、带参已知命令 exit 0）
  与静态代码一致，无冲突点；首跑 `vitest` exit 1 仅为 unhandled errors 警告、测试全过，**建议单独跟一条**（不影响本轮验收）。
- 非阻塞残留：N1 TUI/CLI 首条正则不一致（低危一致性）、N2 三份操作文档仍把 `vessel chat` 当入口、N3 `PRODUCT-STATE.md:34` 与 `:19` 自相矛盾且证据未刷新、N4 `ChatMessage.source` 无编译期绑定（缺漂移守卫）、N5 同区域注释陈旧。
  以上均**不构成 REJECT**，建议合并为下一轮的一张纯文案/文档/类型收窄小卡（可与 NEXT 的 G-03 同轮）。

> 本报告为**静态审查，未复跑命令**；运行时时长/退出码结论引用指挥侧证据并已与代码逐条对齐。
