# 121 — `turn/end` 条件守卫 + 四边界见证：把「写对了但无人守」的条件变成可执行事实（待独立评审后提交）

- 编号：121
- 状态：待验收（等指挥侧独立评审；PASS 后由**指挥侧**提交，**本卡不提交**）
- 优先级：P0（Mission 2 的收口卡：R1 是 C8 §6.2 判定的**最重要**残余）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 2
- 关联：`.dsh-mission/evidence/C8-review-verdict.md` §6.2（R1/R2/R3/R4）与 §6.3（建议卡 C9/C10）；前置卡 `.dsh-mission/tasks/W1-doc-condition-guards.md`、`W2-turnend-witnesses.md`；同族前卡 `tasks/120-turn-end-telemetry-slice.md`（Mission 1 的 `turn/end` 接线切片，本卡守的正是它那批收窄措辞）
- 执行器：隔离子代理（W1/W2/W3 逐卡一个执行器；W3 = 落卡 + 冻结 + 门禁，**不提交**）
- 评审对象（Reviewer 用）：Mission 侧冻结坐标 `backup/mission2-slice-final.patch` + `backup/turnEndConditionGuard.test.ts` + `backup/turnEndWitness.test.ts`（本切片在提交前**不在 HEAD 里**，故**不得**用 `git show HEAD:` 取证）

## 1. 目标

把 Mission 1 收尾时「**文档写对了、但没有任何测试守着**」的四个残余（R1/R2/R3/R4）变成**可执行事实**，使今后任何人把条件改回窄口径、把机制说成有而代码里没有、或让未消费清单静默漏项，都会**指名变红**，而不是靠人读散文。

病根一句话（继承 C8 §6.2）：**声明与实现的耦合只存在于人的记忆里** —— C7b 写下的「成功收尾」条件式表述散落在多处，而 R1 守卫**覆盖其中 8 个锚点**（全仓枚举实为 **9 处**，第 9 处在守卫范围之外、W3b 登记于 §6.7），这 8 个锚点此前没有任何断言检查这些字还在；`BENCHMARK-SPEC.md` 的 M02/M03 行点名了机制，但代码删掉分支这两行会照样"绿"地撒谎。这与 HEAD `c8de618` 自己在治的「声明与实现不一致」是同一个病，只是病灶从**运行行为**挪到了**守卫面**。

**本卡零运行时源码改动、零文档改动**：产物只有测试 + 本卡（`docs/**` 只读被守）。

## 2. 切片内容（工作区 3 项 = 1 改 + 2 未跟踪新增）

`git diff --numstat`（tracked 面，实测）：

```
59	4	packages/telemetry/src/telemetry.test.ts
```

- **改**：`packages/telemetry/src/telemetry.test.ts`（962 行）—— ① 既有 ⑤ 的段切分与词法抽取改走同文件纯函数 `recordTokens()`（**正则逐字不变**，只是从行内搬进函数，好让负例直接调它）；② 新增 `bareRecordTokens()`（裸 token 报警器）；③ 文件中新增 `⑤-neg` 一条 R4 词法负例；④ ⑤ 内新增一条对**真实文档**的挂钩断言 `expect(bareRecordTokens(unwired)).toEqual([])`。既有断言（`unwiredTypes` 含 `request/header`/`session/created`、不含 `turn/end`、`handled` 与 §4.11 集合相等）**逐字未放宽、未删除**（`it()` 由 19 → 20，只多 `⑤-neg`）。
- **增**：`packages/telemetry/src/turnEndConditionGuard.test.ts`（156 行 / 10 个 `it()`）—— R1 八锚点守卫（R1-1…R1-8）+ R2 文档⇄代码**双向**守卫（2 条）。
- **增**：`packages/telemetry/src/turnEndWitness.test.ts`（408 行 / 4 个 `it()`）—— R3 四个无见证面各一条见证用例。
- **只读被守**（本卡与 W1/W2 均未改）：`packages/telemetry/src/Telemetry.ts`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/EVENT-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`。

## 3. 验收标准（客观门禁）

- [x] **R1（8 锚点）**：每个锚点的断言**同时**校验「成功收尾」与「预算耗尽」；M03 锚点另校验 M03 特有的第三条反例「重叠」。抽取按**唯一前缀定位**（`anchorLine` / `anchorCommentBlock`），**不钉行号、不做整文件 `includes`、不镜像**（直接 `fs.readFileSync` 真实文件，纪律 22/25）
- [x] **R2（双向）**：M02/M03 行点名的机制（`case 'turn/end':`、按 `turnId` 去重、`stats.toolCalls`、计数器）在代码里真实存在；反向——该分支**真正消费**的字段集合若多一个未被两行点名的项**也红**
- [x] **R4（⑤ 词法负例）**：把 ⑤ 的行内词法抽成同文件纯函数 `recordTokens()` 并补负例，把"未消费项不加反引号 ⇒ 抽取看不见（漏检）"这一**机制**与"漏检不得静默"（`bareRecordTokens()` 点名）分开钉住；⑤ 既有断言逐字未放宽
- [x] **R3（四条见证）**：四个边界各一条用例，用例名写明条件/路径，逐条标注「判别性 / 不变式守卫」并给出「删/改哪行会红」
- [x] **突变实测**（W1）：`%TEMP%` 副本内 4 处删除 ⇒ 4 条指名红 / exit 1；同一次运行内 4 处**纯格式**改动（上方插空行 / 注释块内插行 / 改标点）⇒ 全绿（负面对照：守卫不是"文档改写即红"的脆弱物。**范围如实收窄**（W3b）：W1 那次只测过这四类，"把关键短语**折到第二行**"**会**变红 —— 已知脆弱点，见 §6.8）
- [x] 真实工作树零变异（7 个文件 SHA256 前后一致；真实 `node_modules/.vite` 未被写穿）；运行时源码与 `docs/**` 零改动
- [x] **冻结**：Mission 侧存在最终补丁与两个新增测试文件副本，附 SHA256/字节数，且 `git apply --check --reverse` **exit 0**（回填见 §8）
- [x] `npx tsc -b tsconfig.json` **显式 exit 0**；`npm run test:all` 两个 root exit 0，原始输出**原样**留档（字节数 + 汇总行逐字贴，见 §8）
- [ ] **指挥侧**：全新上下文独立评审 PASS（含置信度与残余风险）；随后提交只含 `tasks/121-*.md` + 三个测试文件（禁 `git add -A`）

## 4. 证据指针

- **C8 评审（残余的来源）**：`.dsh-mission/evidence/C8-review-verdict.md` §6.2（R1 判为最重要残余：收窄后的条件今天没有任何测试守着）、§6.3（建议卡 C9/C10）
- **W1 卡**（R1/R2/R4，含 8 锚点逐条对照表、突变实测、负面对照、指挥侧独立复核记录）：`.dsh-mission/tasks/W1-doc-condition-guards.md` §执行记录/§验收结论
- **W2 卡**（R3，含四边界 → 用例 → 定性逐条表、"删哪行会红"逐条指认、关键机制三方对照）：`.dsh-mission/tasks/W2-turnend-witnesses.md` §执行记录/§验收结论
- **本卡冻结产物**：Mission `backup/mission2-slice-final.patch`、`backup/turnEndConditionGuard.test.ts`、`backup/turnEndWitness.test.ts`
- **本卡门禁原始输出**：Mission `evidence/M2-test-all.log`（完整、未过滤、未截断）
- 前序同族证据（Mission 1，未提交面）：`backup/turn-end-slice-final2.patch`、`evidence/C8-review-verdict.md`、`evidence/C8b-testall-rerun.log`

## 5. 完整链路

**① W1 —— R1 八锚点条件守卫（新增 `turnEndConditionGuard.test.ts`，10 个 `it()`）**

守的是**条件**而不是散文。事实链（`AgentLoop.ts:636`）：

```
const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);
```

为假有**两条来源**——① 错误类别不可重试（`MODEL_RETRYABLE` 之外）**或**② 错误类别可重试但**重试预算耗尽**（`attempt > maxRetries`）——两者都经 `:649-651` 的 `throw` ⇒ `:462-463` 的 `else { throw err; }` ⇒ `:528` 的 `turn/end` **永不落盘**（而 `:208-212` 的 `before_turn` 已发）。故 §4.11 / M02 / M03 那类「记录条数 = 回合数 = `before_turn` 事件数」的依据**只在「成功收尾的回合」上成立**。

八个锚点（每个都断言**同时**含「成功收尾」与「预算耗尽」；缺失时失败信息**逐条点名**缺了哪个词）：

| # | 锚点 | 定位方式 |
|---|---|---|
| R1-1 | `packages/telemetry/src/Telemetry.ts` 类注释「B09 `turn/end` 记录的接线」段（权威处） | `anchorCommentBlock`，前缀 ` * B09 \`turn/end\` 记录的接线` |
| R1-2 | `packages/telemetry/src/telemetry.test.ts` 文件头 BRIEF 段 | `anchorCommentBlock`，前缀 ` * BRIEF —— 新造的三类持久记录` |
| R1-3 | `docs/ARCHITECTURE.md:176` 不变式行 | `anchorLine`，前缀 `不变式（贯穿全图，D5 §8）` |
| R1-4 | `docs/ARCHITECTURE.md:372` §4.11 telemetry 行 | `anchorLine`，前缀 `\| telemetry/（会话生命周期` |
| R1-5 | `docs/BENCHMARK-SPEC.md:575` M02 行 | `anchorLine`，前缀 `\| M02 \|` |
| R1-6 | `docs/BENCHMARK-SPEC.md:576` M03 行（**另须含「重叠」，且该词出现次数 ≥2**：作用域限定语 + 第三条反例） | `anchorLine`，前缀 `\| M03 \|` + `['重叠']` + 计数断言 `≥2` |
| R1-7 | `docs/EVENT-SPEC.md:605` 不变式行（已登记例外清单） | `anchorLine`，前缀 `不变式（贯穿全图）：` |
| R1-8 | `docs/product-evolution/PRODUCT-STATE.md:823` 欠账行 | `anchorLine`，前缀 `` `request/header` 与 `turn/end.stats` `` |

为什么**不钉行号**：行号会因上文增删而漂移（纪律 25 的同一条道理），故按**唯一前缀**定位（0 行 = 锚点被删/改写，>1 行 = 锚点不唯一，两者都算红）。E7 那处是补集形式（「非成功收尾」）——同一条件、同一锚点。

**② W1 —— R2 M02/M03 行的文档⇄代码双向守卫（2 条用例，仿既有 ⑤/⑨/⑫ 形态）**

- **文档 → 代码**：M02 行含 `case 'turn/end':`、M03 行含 `turn/end.stats.toolCalls`、两行都点名 `turnId` ⇒ 代码里必须真有 `case 'turn/end':`、`this.counters.toolCalls += r.stats.toolCalls;`、`this.liveTurnIds.has(r.turnId)`。**只改文档不动代码 ⇒ 红**。
- **代码 → 文档**：从 `case 'turn/end':` 分支体的**可执行文本**（剔掉行注释）里正则抽出真正读的记录字段与自增的计数器，断言 `reads == {turnId, stats.toolCalls}`、`counters == {turns, toolCalls}`；再断言 M02 行点名 `turnId`、M03 行点名 `stats.toolCalls`。**将来多读一个字段 ⇒ 这里先红**，逼作者同时更新文档与本表（映射即契约）。

**③ W1 —— R4 ⑤ 的词法负例（`telemetry.test.ts` 的 `⑤-neg`）**

⑤ 抽「已消费 / 未消费」两段清单靠 `recordTokens()`：**反引号包裹、且恰好 `x/y` 形状**的 token 才算清单项。这条词法有个已知**代价**：未消费项若不加反引号，抽取就看不见它（漏检）。`⑤-neg` 把两件事分开钉住，不留含糊：

1. **正例**：反引号包裹的 `x/y` 就是清单项（`['session/created','request/header']`）；
2. **反例（本用例的存在理由）**：同两个词**不加反引号** ⇒ `recordTokens()` 返回空 —— 即「漏检」本身；
3. **漏检不得静默**：`bareRecordTokens()` 必须把裸 token 点出来，**并且** ⑤ 已对**真实文档**那一行断言它为空（`expect(bareRecordTokens(unwired)).toEqual([])`）——那一条就是「谁去掉反引号谁红」的绊线；
4. **边界**：带后缀的解释（`` `turn/end.stats` ``、`` `turn/end{kind:'interrupted'}` ``）**不是**清单项（否则"消费了记录本身、但它的某个 stats 字段仍未消费"无法如实写出来）；非 `x/y` 小写形状（`M02/M03`、`:462-463`、`A16/A17`）既不是清单项、也不该被当作"裸 token 漏检"。

「改哪处会红」（W3b 按实测改准，证据与对评审 E4 的反驳见 §6.9）：删掉 `recordTokens()` 的反引号要求（改成裸 `x/y` 也收）⇒**本用例与 ⑤ 都会红**，fail-fast 让每个文件只显示**第一条**失败 —— ⑤ 先在 `expect(new Set(consumed)).toEqual(new Set(handled))` 失配（宽松词法还会把 `inject/instruction`/`plan/memory` 这类**不是**记录类型的 `x/y` 收进来），`⑤-neg` 先在其"反例（裸词 ⇒ 抽取返回空）"那条失败；两条**边界**断言被 fail-fast 挡在后面、**未被执行**（本用例不声称其是否被违反：按本节自述的突变形状复算，若真执行 ⇒ 边界① 被违反、边界② 照常通过；换 lookaround 形状则三条全过）。真实 duty 单元格两段的裸 token 都是 `[]` ⇒ ⑤ 里那条 `bareRecordTokens(unwired)` 绊线**当前尚无触发对象**（谁去掉反引号才响），但这**推不出**"⑤ 侧不会红"（放宽后 `unwiredTypes` 一样被破坏）；删掉 ⑤ 里那条 `expect(bareRecordTokens(unwired)).toEqual([])` ⇒**新增**一个裸词未消费项时用例⑤ **仍绿**（正是本条要防的漏检；**既有**项被去掉反引号则由 ⑤ 的 `toContain` 先抓住）。

**④ W2 —— R3 四个无见证面的见证用例（新增 `turnEndWitness.test.ts`，408 行 / 4 个 `it()`）**

四条都已按纪律 24 给出可指认的「删/改哪行会红」⇒ 定性均为**判别性**（非"不变式守卫"），且每条都做**结构性三方对照**（记录条数 / 事件条数 / 计数器数值），不只断言"不抛错"：

| # | 边界（用例名写明条件与路径） | 关键机制（文件:符号） |
|---|---|---|
| ① | 崩溃合成收尾记录（已 `turn/start`、未收尾）⇒ 重开日志后计 **1 回合 / 0 工具调用**（合成 `stats` 全零 = **下界**，不是"测得 0 次"） | `Session.loadExisting()` 的 `openTurns` 合成循环（`Session.ts:140`/`:145`）× `Telemetry.finalizeRecord` 的 `case 'turn/end':`（`Telemetry.ts:451`）；用例同时钉住崩溃前**真跑过 1 次工具**（1 条 `tool/result`）与合成汇总 `{steps:0,toolCalls:0,durationMs:0}` |
| ② | 模型调用**在飞时**被中断 ⇒ 该轮记录 `stats.steps=1` 而事件面 `after_model=0`，并断言前者 **>** 后者 | `beginStep()`（`AgentLoop.ts:331`）× 流边界检查（`AgentLoop.ts:709`）；`model_stream_start` 恰好 1 条作为"已发起"锚点 |
| ③ | 回合**中途** attach ⇒ 该轮 `toolCalls` **多计**（对照：回合前 attach 按 `turnId` 去重不多计） | `attach()` 的 `liveTurnIds.add`（`Telemetry.ts:324`）× 实时 `after_tool` 计数（`:334`）× 记录侧去重（`:458`）；等式 `counters.toolCalls === 实时 after_tool 条数 + 该轮记录 stats.toolCalls`（1+1=2），两个加数各自先独立断言；`order` 数组把顺序钉成 `['before_turn','attach']`；对照组为 1 |
| ④ | `before_turn` 载荷**无字符串 `turnId`** ⇒ 每事件计一次且不进身份集 ⇒ 同一回合记录侧再补一次（**turns=2**） | 形状不认识分支不早退；A 组（无 `turnId`）事件面 1 + 记录面 1 = **2**，B 组（身份齐全）1 + 去重 0 = **1**；用例注释**如实标注**这是 `liveTurnIds` 「绝不静默少计」那条声明的**代价**（代价是**多计**，不是少计） |

**⑤ W3（本卡）—— 落卡 + 冻结 + 最终门禁**

按 2026-09-13 指挥侧修订的执行顺序：**先落卡**（使门禁成为真正的"最后一次编辑之后"）→ **冻结**（`git diff --output=` 落盘补丁；**未跟踪**的两个新测试文件单独拷进 `backup/`，因为它们不在 patch 里）→ **门禁各跑一次**（`tsc -b`、`test:all`，显式退出码）→ **报告后停下，不提交**（`git add`/`git commit` 由指挥侧在独立评审 PASS 之后执行，以免"做事的人给自己判分"）。**本轮零源码/测试/文档改动。**

## 6. 未闭合项（逐条登记，含处置与理由）

1. **Node `DEP0137` 告警未归因**（W2 引入的观察，**是告警不是失败**）：W2 那次定向 vitest 的 stderr 出现一条 `DEP0137`（`FileHandle` 在 GC 时被关闭）。指挥侧复核到它**只在 W2 之后出现**（W1 验收那次没有），但**未二分归因**到具体文件/用例；W2 文件内每个 `Session` 都显式 `close()`。受「只跑 1 次 vitest」预算限制未能继续二分。Node 未来会把它变成错误。**处置：登记 + 交独立评审列为残余风险；本轮不改**（改测试文件会使 W1/W2 已验收哈希失效）。本卡门禁日志是**又一次**可核对它是否复现的机会（见 §8 诚实注记）。
2. **M03「回合重叠口径」的裁决属人类**：是只对未被打断的回合计数，还是改取别的身份/来源（`SessionController.ts:159-167` 明文承认 abort 旧回合、`apps/local-server/src/server.ts:379-381` 的 POST /turns 无并发闸门）。切片采取**保守默认：不发明口径**——只把该路径标为"取值不可信"，用 R1-6（「重叠」一词）与 R3③/④ 把限制**显式表达**出来。**需人拍板**；本卡不发明口径。
3. **`.dsh-mission` 控制面不提交**：该目录被 `.gitignore` 忽略，装的是 Mission 全部控制面（卡面、原始证据、冻结产物、日志）。**后果如实登记**：一旦工作区丢失，本次评审链（C7/C8 判决、W1 突变原始输出、本卡门禁原始日志）只剩仓库内 `tasks/121` 的转述 ⇒ 与「清单必须落盘」纪律有张力。**处置：本卡**绝不**提交 `.dsh-mission/**`（硬边界：`git add -A` 禁用）；控制面的处置属人类。
4. **R1 守卫只钉"两个关键短语 + 锚点归属"，不钉整段散文**：这是有意为之（纪律 23/24：不把实现选择当契约；把散文逐字钉死会让标点/换行改动即红）。代价是：若有人把「成功收尾」改成同义异形词（如"正常收尾"），守卫会红——**这是期望行为**（条件被改写就该有人复核），但需要复核者知道它**不是**橡皮图章。
5. **C4① 的 `turnEndBoundary.test.ts:210`/`:211` 仍缺独立突变实测**（Mission 1 遗留，见 `tasks/120` §6 未闭合项 3）：fail-fast 使同一个 `it()` 内的后续断言在更早的行先失败即不再求值；代码层推断已登记，补测需 1 次 vitest 额度。**本轮不动**（改文件会使已验收哈希失效）。
6. **范围外（本轮只登记、未动）**：`request/header` 仍未接线；`turn/end.stats` 其余字段（`steps`/`tokensUsed`/`costEstimate`/`toolCallsWithoutEnd`）仍未消费；`costEstimate`/M11 的缺口在**产物侧**（没有任何 shipped provider 上报）；`before_stop` 仍是丢弃的潜伏死缝；被跟踪的 `benchmarks/reports/release-report.{md,json}` 仍是旧判据快照。
7. **第 9 处「成功收尾」表述不在守卫内（W3b 登记，评审 E1）**：全仓枚举 `packages/telemetry/src/telemetry.test.ts` 含「成功收尾」的行 = **76**（在 R1-2 守卫的 BRIEF 块 14–92 内）+ **869 / 870**（在被守范围之外；W3b 改前为 859 / 860）⇒ 8 个锚点之外还有 1 处同类条件式表述，此前**无任何断言守着**。**处置（W3b）**：只把该处那句注释从"只陈列**一条**来源（不可重试类错误）"改成**并列两条来源**（① 不可重试、② 重试预算耗尽），与 8 个锚点的口径一致；**未**把它纳入守卫（Mission DoD E1 写死「覆盖 8 个锚点」，改 DoD 只能由人类批准）⇒ 因此它**仍是未闭合项**：谁将来把它改窄，守卫不会变红，只能靠人读。
8. **守卫对"折行"脆弱（W3b 实测，已知脆弱点，评审 E3）**：`anchorLine` / `anchorCommentBlock` 以**物理行**为单位匹配 ⇒ 把锚点行里的关键短语折到第二行（前缀仍留在第一行）会让对应 R1-* 变红，**即使文档语义未变**。W1 的负面对照 N1 只覆盖"在锚点行上方插空行"，**从未测换行** ⇒ W1 自述里的"把散文换行…**不该**变红"是**假的**。**处置（W3b）**：把 `turnEndConditionGuard.test.ts` 顶部自述改成如实表述（"上方插行 / 注释块内插行 / 改标点不变红；**折行会变红 —— 已知脆弱点**"），并同步修正 `.dsh-mission/evidence/M2-W1-mutation-record.md` §3 的同类过度泛化；**不改匹配实现**（改锚点匹配＝改已被评审判为有效的守卫本体，超出本卡授权）。代价如实登记：纯排版折行会产生一次需要人工排除的假红。
9. **`⑤-neg` 的「改哪处会红」按实测改准 + 反驳评审 E4（W3b）**：评审 E4 判"放宽 `recordTokens` 只有边界①会红、⑤ 侧不会红"（自报置信度 0.75）。W3b 用脚本按**真实文档文本**复算两种改写形状（去掉反引号的正则 / 裸 token 的 lookaround 形状），并在 `%TEMP%` 副本里用第一种形状实跑：**该判断不成立** —— 去掉反引号要求后 ⑤ 的 `consumed` 集合先失配，`unwiredTypes` **同样**被破坏（裸形状下变空集 / 去反引号形状下多出 `turn/end`），`⑤-neg` 则在"裸词 ⇒ 抽取返回空"那条先红，**边界① 反而在"裸 token 形状"的改写下不会红**。评审的**前提**（真实 duty 单元格两段裸 token 均为 `[]`）**属实**，但它只说明 ⑤ 那条 `bareRecordTokens` 绊线当前尚无触发对象，**推不出**"⑤ 侧不会红"。**处置（W3b）**：按实测改准 `telemetry.test.ts` 的 `⑤-neg` 注释与本卡 §5 ③ 的表述；**未**放宽任何断言（E2 处只增不减）。

## 7. 范围边界（勿膨胀）

- 本 Mission 产物**只有测试 + 本卡**；不改任何**运行时源码**（`packages/*/src/**` 非测试文件）；不改 `docs/**`、`.gitignore`、`RUN_STATE.md`、`.dsh-mission/tasks/W*.md`（卡面由指挥侧回填）。
- 不动 `request/header`、`turn/end.stats` 其余字段、`costEstimate`/M11、`before_stop`、`denials`、`measured` 收紧、`release-report`。
- 不 install / 不改 lockfile；不跑 `run-release-gates.ts`（会改写**被跟踪**产物 + 消耗真实 API 配额）；不手改产物冒充一致（纪律 27）。
- 真实 provider 调用 **0** 次；命令文本不含永久删除类 API 字面名；不删任何文件（删除一律回收站；唯一书面例外是测试自建且位于 `os.tmpdir()` 下的临时目录）。
- 不做无关重构；不改 `tasks/` 里其它卡；禁用 `git add -A` / force push / `git stash|restore|checkout|clean`。

## 8. 门禁实测（原样回填，未过滤）

**执行序**（2026-09-13，W3 执行器）：① `tasks/121` 落盘 → ② 冻结 → ③ `tsc -b`（**1 次**）→ ④ `test:all`（**1 次**）→ ⑤ 本节回填。两道门禁都在第②③④步的**全部编辑**之后执行；第⑤步是门禁之后**唯一**的写操作，且**只写本卡**（`tasks/121-*.md`，不是被门禁覆盖的源码/测试面）⇒ AGENTS.md 约束 7 所要求的「两项都在最后一次编辑之后执行」在**源码/测试面**上成立。这与 `tasks/120` §8 的做法一致（该卡同样先落盘、后回填门禁节）。

**A. 冻结产物**（`git diff --output=` 落盘，避免 PowerShell 管道 CRLF 转写；该步退出码 0）

| 产物 | 字节数 | SHA256 |
|---|---|---|
| `.dsh-mission/backup/mission2-slice-final.patch` | 7632 | `D97E976F814613074B4CA1B0F0DD3CBDB0781F649FB48B1C6A0A873D88CE74E4` |
| `.dsh-mission/backup/turnEndConditionGuard.test.ts` | 9654 | `90ED12BF83BA4D91AB889EC8D619F18D3B22F0F6941EB4262736A489DB817906` |
| `.dsh-mission/backup/turnEndWitness.test.ts` | 21671 | `72EF474B8B600552B50D51E3909DA8BDC30C3F32E0EB55E28BA183A1587A8335` |

- 两个**未跟踪**新文件**不在 patch 里**（`git diff` 不含未跟踪文件）⇒ 必须单独拷进 `backup/` 冻结；两个副本的 SHA256 与工作树**逐字节一致**。
- 工作树冻结时 SHA256（与 W1/W2 验收记录**逐字一致** ⇒ W1/W2 已验收产物未被本卡触碰）：`telemetry.test.ts` = `8501D7B0D3AD32CD744C686D6025AC0FC482A252FA3F837B25B981380BF918F4`（962 行）、`turnEndConditionGuard.test.ts` = `90ED12BF…817906`（156 行）、`turnEndWitness.test.ts` = `72EF474B…7A8335`（408 行）。
- patch 7632 B 只含 tracked 面那一个文件的改动：`59  4  packages/telemetry/src/telemetry.test.ts`。

**B. 保真性校验 `git apply --check --reverse`**（原样，未过滤）

```
$ git apply --check --reverse .dsh-mission/backup/mission2-slice-final.patch
--- stderr+stdout begin ---
--- stderr+stdout end ---
REVERSE_CHECK_EXITCODE=0
```

⇒ **补丁可逆、零输出、退出码 0** = 工作树即补丁的目标状态。诚实注记：冻结那一步的 `git diff` 另打印过一条 `warning: in the working copy of 'packages/telemetry/src/telemetry.test.ts', LF will be replaced by CRLF the next time Git touches it`（`core.autocrlf` 的索引提示，**非** apply 的输出）——`git apply` 自身在两个标记之间**零输出**。

**C. `npx tsc -b tsconfig.json`**（本次门禁唯一一次，原样）

```
--- raw output begin ---
--- raw output end ---
TSC_EXITCODE=0
TSC_SECONDS=10.3920794
TSC_OUTPUT_LINES=0
```

⇒ **显式 exit 0**（"无输出"不算证据 ⇒ 一并记录退出码与耗时），耗时 **10.39 s**，原始输出 **0 行**。

**D. `npm run test:all`**（本次门禁唯一一次；`cmd /c "npm run test:all > .dsh-mission\evidence\M2-test-all.log 2>&1"`，**不经过** PowerShell 管道，保输出原样）

```
TEST_ALL_EXITCODE=0
TEST_ALL_SECONDS=144.9446726
TEST_ALL_LOG_BYTES=101420
```

日志：`.dsh-mission/evidence/M2-test-all.log` = **101420 B / 892 行**（完整、未过滤、未截断）。两个 root 的汇总行**逐字**：

```
 RUN  v2.1.9 C:/work/Vessel_Harness
 Test Files  171 passed (171)
      Tests  2195 passed | 6 skipped (2201)
   Duration  140.12s (transform 24.91s, setup 4.61s, collect 95.01s, tests 535.31s, environment 66ms, prepare 53.41s)
 RUN  v2.1.9 C:/work/Vessel_Harness/apps/web
 Test Files  11 passed (11)
      Tests  120 passed (120)
   Duration  1.99s (transform 995ms, setup 0ms, collect 3.01s, tests 522ms, environment 4ms, prepare 2.99s)
```

- **两个 root 都 exit 0**（脚本是 `vitest run && vitest run --root apps/web`，总退出码 0 ⇒ 第一个 root 也必为 0）；**无失败文件、无 flaky、无未处理红**，故不触发"保留完整原始输出并停"。
- 与基线对照（`tasks/120` §10 的最终门禁：根 `169 files / 2180 passed | 6 skipped`、web `11 files / 120 passed`）：根 **169 → 171** 文件、**2180 → 2195** passed（+15）、6 skipped 不变；web 逐字不变。增量**精确**等于本切片的测试面 = W1 新增 `turnEndConditionGuard.test.ts`（10 条）+ W2 新增 `turnEndWitness.test.ts`（4 条）+ `telemetry.test.ts` 新增 `⑤-neg`（1 条）= **2 文件 / 15 条**。
- **诚实注记（§6 残余 1 的复现观察）**：本次全量日志里**仍出现**那条 Node 告警一次，逐字——

```
(node:28872) [DEP0137] DeprecationWarning: Closing a FileHandle object on garbage collection is deprecated. Please close FileHandle objects explicitly using FileHandle.prototype.close(). In the future, an error will be thrown if a file descriptor is closed during garbage collection.
```

它在**全量**运行里出现（W2 当时观察到的是遥测包**定向**运行里出现）；本次仍**未归因**到具体文件/用例（受"门禁各 1 次"预算限制，未做二分）。**是告警不是失败**（2195 passed / exit 0）。**不阻断**，登记为残余风险交独立评审。

**E. 状态面**：`git status --short` = **4 项** —— ` M packages/telemetry/src/telemetry.test.ts`、`?? packages/telemetry/src/turnEndConditionGuard.test.ts`、`?? packages/telemetry/src/turnEndWitness.test.ts`、`?? tasks/121-doc-condition-guards.md`（前三项与 W1/W2 验收时**逐字一致**，第四项是本卡）。HEAD 仍 `c8de618`；`git diff --cached` **空**（无 `git add`）；`git diff --numstat` 仍为 `59  4  packages/telemetry/src/telemetry.test.ts`。**无提交**（提交由指挥侧在独立评审 PASS 后执行）。

## 8.1 W3 重做轮（按独立评审 FAIL 修复之后；**本节的记录取代 §8 的冻结与门禁数字**）

**为什么重做**：W3 首次冻结/门禁之后，独立对抗评审判 **FAIL（范围限定）** —— 守卫本体有效，但 **4 处「声明强于事实」**（判决全文：`.dsh-mission/evidence/M2-review-verdict.md`）。人类裁决"修 + 重跑门禁 + 重新评审" ⇒ W3b（唯一一次 Repair）修掉 4 处，**旧冻结随即失效**（指挥侧实测：对 §8 的 `mission2-slice-final.patch` 跑 `git apply --check --reverse` ⇒ **exit 1**，`patch does not apply`）。故本节重录冻结与门禁。

**W3b 修了什么（逐条）**：① **E1**：`telemetry.test.ts` 第 9 处条件式表述由"只陈一条来源"改为**并列两条来源**，并把本卡 §1 的闭包声明改为"**守卫覆盖 8 个锚点**（全仓枚举实为 9 处）"+ §6.7 登记第 9 处（**未**纳入守卫，因 DoD 写死 8 锚点）；② **E2**：R1-6 在原断言之上**只增**一条「M03 行「重叠」出现次数 ≥2」（限定语 1 + 第三条反例 1），于是**删掉 ③ 从句即指名红**，且未逐字钉死散文；③ **E3**：把守卫顶部"换行不该变红"的自述**改准**（实测折行会让 R1-3 红 ⇒ 登记为已知脆弱点，§6.8），并同步收窄 `.dsh-mission/evidence/M2-W1-mutation-record.md` §3 的同类过度泛化；④ **E4**：⑤-neg 的"同时红"表述按实测重写，并**反驳**了评审该条判断（评审自报置信度 0.75）—— 副本实跑显示放宽 `recordTokens` 后 **⑤ 与 ⑤-neg 都会红**，评审结论的**前提**属实但它推不出"⑤ 侧不会红"。

**A′. 冻结产物（重做轮）**

| 产物 | 字节数 | SHA256 |
|---|---|---|
| `.dsh-mission/backup/mission2-slice-final2.patch` | 9826 | `686DA6C5B2590CEC769C62855F92CA5D4D259DFF2EA46AFA43C10CFA4E91CBC3` |
| `.dsh-mission/backup/turnEndConditionGuard.test.ts` | 11047 | `BCE130B64BFAC7BC776C9F179A9B7A0943F1BAC22F4044B469CD7788CD1E7676` |
| `.dsh-mission/backup/turnEndWitness.test.ts` | 21671 | `72EF474B8B600552B50D51E3909DA8BDC30C3F32E0EB55E28BA183A1587A8335`（**未变**） |

- 工作树源文件（重做轮）：`telemetry.test.ts` = `519E114CBE1361308AFBB373991A5EC7E56B630827BED58BB4B1DB3BBC35E7E7`（**973 行**，原 962）、`turnEndConditionGuard.test.ts` = `BCE130B6…7676`（**168 行**，原 156）、`turnEndWitness.test.ts` = `72EF474B…7A8335`（408 行，**W2 验收后未被触碰**）。
- `numstat` 由 `59 4` 变为 **`72 6`**（`telemetry.test.ts`）；`Telemetry.ts` = `4C480CF5…F5F0B0`、`docs/**` 各哈希与 W1 记录**逐字一致** ⇒ **运行时源码与文档零改动**（评审对象没被"改到绿"）。
- `git apply --check --reverse .dsh-mission/backup/mission2-slice-final2.patch` ⇒ **exit 0**（原样零输出）。

**B′. 门禁（重做轮，各 1 次，均在 W3b 的全部编辑之后）**

```
$ npx tsc -b tsconfig.json
TSC_EXIT=0                     # 日志 .dsh-mission/evidence/M2-tsc-b-rerun.log = 0 B
$ cmd /c "npm run test:all > .dsh-mission/evidence/M2-test-all-rerun.log 2>&1"
TESTALL_EXIT=0                 # 日志 104538 B（原样、未过滤）
 Test Files  171 passed (171)
      Tests  2195 passed | 6 skipped (2201)
 Test Files  11 passed (11)
      Tests  120 passed (120)
```

- 与 §8-C/D 的首轮结果**逐字相同**（171/2195+6、11/120）⇒ 修复**没有**改动测试条数，只改了断言强度与措辞。
- **诚实注记**：本节是在门禁之后**唯一**的写操作，且**只写本卡**（`tasks/121`，非源码/测试面）⇒ AGENTS.md 约束 7 在源码/测试面上成立（与 §8 首轮、`tasks/120` §8 同做法）。**另**：`tasks/121` 是**未跟踪**文件 ⇒ 它**不在任何 patch 里**（patch 只覆盖 tracked 的 `telemetry.test.ts`），故本节改写**不影响** `final2` 补丁的哈希。

## 8.2 W3 第三轮（第二次修复 W4 之后；**本节的记录取代 §8.1 的冻结与门禁数字**）

**为什么再来一轮**：§8.1 之后第二轮独立评审判 **FAIL（范围限定）** —— 上一轮 4 条里 **E1/E2/E3 真闭合、E4 的反驳成立（第一轮那条判错了）**，但**修复文本自己新引入一条假话**：`telemetry.test.ts:367` 写「末尾**两条**边界断言同样被违反」，而按该段自述的突变形状复算只有**边界①**被违反（`['turn/end','turn/end']`）、**边界②照常通过**（`[]`）。判决全文：`.dsh-mission/evidence/M2-review-verdict-2.md`。人类裁决"**再修一次**" ⇒ W4 修掉它 ⇒ **§8.1 的冻结随即失效**。

**W4 改了什么（唯一一处）**：

```
- * 末尾两条**边界**断言同样被违反，只是轮不到它们被显示。
+ * 末尾两条**边界**断言被 fail-fast 挡在后面、**未被执行**（本用例不声称它们是否会被违反：
+   按本段自述的突变形状复算，若真执行 ⇒ 边界① 被违反、边界② 照常通过；换 lookaround 形状则三条全过）。
```

- 该句**在同一行内替换**（净增 0 行；`numstat` 前后都是 `72 6`）；`:388`/`:390`/`:391` 三条断言**逐字未变**、行号未漂移；`it()` 20 / guard `it()` 10 不变。
- 同步改准 `tasks/121` §5 ③ 与 `.dsh-mission/evidence/M2-W3b-repair-record.md` 里重复该说法的一处。

**A″. 冻结产物（第三轮）**

| 产物 | 字节数 | SHA256 |
|---|---|---|
| `.dsh-mission/backup/mission2-slice-final3.patch` | 10013 | `364B330E4F98AF24C6D465410079E384F0302BD734CA89F6CFAB7A50A7AEA757` |
| `.dsh-mission/backup/turnEndConditionGuard.test.ts` | 11047 | `BCE130B64BFAC7BC776C9F179A9B7A0943F1BAC22F4044B469CD7788CD1E7676`（未变） |
| `.dsh-mission/backup/turnEndWitness.test.ts` | 21671 | `72EF474B8B600552B50D51E3909DA8BDC30C3F32E0EB55E28BA183A1587A8335`（未变） |

- 工作树 `telemetry.test.ts` = `B3F23885157A8B179D75D5641BEB5DB1ABD1CF63AA354AA8CD86CBC7B355410E`（58604 B / **973 行**，行数与 §8.1 相同 ⇒ 只换了一行注释）。
- 受保护文件仍与 W1 记录一致：`Telemetry.ts 4C480CF5…F5F0B0`、`ARCHITECTURE 8231E458…`、`BENCHMARK-SPEC 24851EBB…`、`EVENT-SPEC 508690CF…`、`PRODUCT-STATE 709DD042…`。
- `git apply --check --reverse .dsh-mission/backup/mission2-slice-final3.patch` ⇒ **exit 0**。**注意**：`mission2-slice-final2.patch` 仍含那句假话 ⇒ **已由 `final3` 取代**，任何后续取证/回退**必须**用 `final3`。
- 指挥侧独立验收：`npx vitest run packages/telemetry` ⇒ **5 files / 43 passed / exit 0**（**覆盖的是最终字节**；W4 执行器自己那次跑在"2 行版"时点上，已如实登记）。

**B″. 门禁（第三轮，各 1 次，均在 W4 的全部编辑之后）**

```
$ npx tsc -b tsconfig.json
TSC_EXIT=0                     # 日志 .dsh-mission/evidence/M2-tsc-b-rerun2.log
$ cmd /c "npm run test:all > .dsh-mission/evidence/M2-test-all-rerun2.log 2>&1"
TESTALL_EXIT=0                 # 日志 97549 B（原样、未过滤）
 Test Files  171 passed (171)
      Tests  2195 passed | 6 skipped (2201)
 Test Files  11 passed (11)
      Tests  120 passed (120)
```

- 与前两轮**逐字相同**（171/2195+6、11/120）⇒ W4 只换了一句注释。
- **诚实注记**：本节仍是在门禁之后**唯一**的写操作、且**只写本卡**（`tasks/121`，非源码/测试面）⇒ 约束 7 在源码/测试面上成立；`tasks/121` 未跟踪 ⇒ **不在任何 patch 里**，本节改写不影响 `final3` 的哈希。

## 9. 涉及文件（指针）

- 改：`packages/telemetry/src/telemetry.test.ts`（R4：⑤ 词法抽函数 + `⑤-neg`；W3b：第 9 处条件式表述 + ⑤-neg 表述）
- 增：`packages/telemetry/src/turnEndConditionGuard.test.ts`（R1 八锚点 + R2 双向；W3b：R1-6 计数断言 + 顶部自述改准）
- 增：`packages/telemetry/src/turnEndWitness.test.ts`（R3 四边界见证）
- 本卡：`tasks/121-doc-condition-guards.md`
- Mission 侧产物（**不提交**）：`.dsh-mission/backup/mission2-slice-final2.patch`（重做轮）、`.dsh-mission/backup/turnEndConditionGuard.test.ts`、`.dsh-mission/backup/turnEndWitness.test.ts`、`.dsh-mission/evidence/M2-test-all-rerun.log`、`.dsh-mission/evidence/M2-review-verdict.md`、`.dsh-mission/evidence/M2-W1-mutation-record.md`
- 只读被守（未改）：`packages/telemetry/src/Telemetry.ts`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/EVENT-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`
- 只读参照：`package.json`（`test:all` 两 root 定义）、`tsconfig.json`

## 10. 验收结论（指挥侧独立评审回填）

- 结果：**PASS**（第三轮独立对抗评审，置信度 **0.85**；判决全文 `.dsh-mission/evidence/M2-review-verdict-3.md`）
- 备注（**披露**：本节是在第三轮评审 PASS **之后**回填的 —— 评审覆盖的是**冻结坐标** `mission2-slice-final3.patch` 与两个新测试文件**副本**；`tasks/121` 是**未跟踪**文件、不进任何 patch，故本节内容**不在评审覆盖范围内**，与 `tasks/120` §8/§10 同做法）。
- **三轮评审链（每一轮的 FAIL 都被如实登记、没有被抹掉）**：
  1. **第 1 轮 FAIL（范围限定）**：守卫本体有效，但 4 处"声明强于事实" —— E1 闭包声明不完整（`telemetry.test.ts` 另有第 9 处、只陈一条来源）、E2 R1-6 只钉词（删 ③ 从句仍绿）、E3 guard 自述"换行不该变红"为假、E4 ⑤-neg 的"同时红"半边不成立。判决 `.dsh-mission/evidence/M2-review-verdict.md`。
  2. **W3b 修复**（唯一一次 Repair，人类批准的"修 + 重跑门禁 + 重新评审"）：四条逐条修；**E4 处反驳成功**（副本实跑证明"⑤ 也会红"，第 1 轮那条判错）。
  3. **第 2 轮 FAIL（范围限定，唯一一条）**：W3b 的修复文本**自己新引入**一句假话 —— `:367`「末尾**两条**边界断言同样被违反」，而实算只有边界①被违反。判决 `.dsh-mission/evidence/M2-review-verdict-2.md`。
  4. **W4 修复**（第二次 Repair，人类裁决"再修一次"）：把该句改为"**未被执行、不声称**"，并附两种突变形状的复算事实。
  5. **第 3 轮 PASS（0.85）**：确认 W4 改准（独立内存复算逐项属实）、没碰不该碰的东西（`numstat 72 6`、973 行、`it()` 20/10/4、受保护文件哈希全部未变、`git status` 4 项）、前两轮通过项未被破坏；提交面无实质性过度声称（仅 4 条"弱于事实或陈旧指针"级小瑕疵，见判决 §5/§7）。
- **门禁**（三轮各 1 次，均在各自那一轮的最后一次编辑之后，且都带显式退出码）：`tsc -b` **exit 0**；`test:all` **exit 0**（根 171 files / 2195 passed + 6 skipped、`apps/web` 11 files / 120 passed；日志 `.dsh-mission/evidence/M2-test-all.log`、`M2-test-all-rerun.log`、`M2-test-all-rerun2.log`）。
- **本卡已知的残余（不阻断，判决里逐条给出）**：① `telemetry.test.ts:340-342`「报警器在这里点名」按 fail-fast 不会执行（同文件 `:372-373` 已给出正确口径）；② `:115-118` 未限定"整段/单条"读法；③ guard 顶部写"三份 docs"而实读 4 份（**少报**，非过度声称）；④ 本卡 §2/§4/§9 仍是首轮/重做轮的陈旧数字与指针（`final`/`final2`），**以 §8.1/§8.2 为准**，冻结坐标**只用 `final3`**；⑤ Node `DEP0137` 告警未归因（是告警不是失败，三份全量日志各 1 次）；⑥ 第 9 处条件式表述**仍未纳入守卫**（登记于 §6.7）；⑦ M03「回合重叠口径」**属人类裁决**，本卡只标"不可信"、不发明口径。
- 提交：**路径限定**（4 个文件：本卡 + 三个测试文件），**禁 `git add -A`**；由指挥侧在第三轮 PASS 后执行。
