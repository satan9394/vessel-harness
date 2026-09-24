# C8 最终复评判决 —— 全新上下文独立评审（C7b 修正之后重新冻结）

- 评审角色：独立评审员（全新上下文；未参与本切片的实现、收窄、修正、突变任何环节）
- 模式：**Audit（只读、只出判决）**——未改真实工作树任何文件，未 add/commit/stash/restore/checkout/clean，未删除文件，未 install，未改 lockfile，未跑 `test:all`
- 评审日期：2026-09-13
- 仓库：`C:\work\Vessel_Harness`（分支 `main`，HEAD `ba173d4788fe02deceb78f077c10be1053ad559f` = `ba173d4`，无 remote）
- 评审对象（唯一）：`backup\turn-end-slice-final2.patch`（58945 B / `84CFD07E…DECA`）+ `backup\turnEndBoundary.test.ts`（16334 B / `56F413C9…BF86`）

---

## 0. 判决

**PASS（置信度 0.82）**

一句话理由：C7 的两条阻断项**都已闭合**——阻断项 A 的条件已从「单一、无重叠、无不可重试错误」统一收窄为**「成功收尾的回合」**，并把 `AgentLoop.ts:636` 那个合取判据的**两条来源**（① 类别不可重试；② 类别可重试但 `attempt > maxRetries` 预算耗尽）**并列登记**到全部相关位置（4 处 + `BENCHMARK-SPEC.md:575/576` + `ARCHITECTURE.md:176` + `EVENT-SPEC.md:605`），且该条件**在实现上成立**（我逐条复核了 `:462-463 → :528` 的不可达性、`before_turn`/`turn/start` 的在位性、以及重叠/崩溃合成/中途 attach 三个边界都已被**显式登记**而非被条件悄悄吞掉）；阻断项 B 已就地收窄 `EVENT-SPEC.md:605`（"**除已登记例外**" + 三条例外 + 指向 `ARCHITECTURE.md:176` 与 `PRODUCT-GAP-MAP.md`），与 `ARCHITECTURE.md:176` **同口径、不再互否**，且该改动**确实只动文档**（`invariant_selfcheck` 在 `packages/**`、`apps/**`、`benchmarks/**` 里 **0 命中**，无任何测试读该行字面）。

判决依据的一句话对照（C7 vs 本次）：

| C7 判 FAIL 的理由 | 本次实测 |
|---|---|
| 条件装不下「可重试类别 + 预算耗尽」路径 | 该路径在 6 处以「两条来源」并列登记，且新增 ⑱ 用例把它钉成可判别事实 |
| `EVENT-SPEC.md:605` 与 `ARCHITECTURE.md:176` 互否 | `:605` 已加"除已登记例外"+ 三条例外，两条规格同口径 |

---

## 1. 冻结校验（我亲自跑的，不是引用）

```
cd C:\work\Vessel_Harness
git apply --check --reverse "...\backup\turn-end-slice-final2.patch"     # exit=0（未写盘）
Get-FileHash ...\backup\turn-end-slice-final2.patch -Algorithm SHA256   # 84CFD07E9BAC8B912BC3FDD00189AD6C88B6642E8413798DC7CF5D442CADEECA / 58945 B
Get-FileHash ...\backup\turnEndBoundary.test.ts -Algorithm SHA256       # 56F413C91DC7A0C7178195027A8A7E53F8F0D6FE6BE3CB0AE99EECA02B5BBF86 / 16334 B
Get-FileHash packages\telemetry\src\turnEndBoundary.test.ts -Algorithm SHA256  # 56F413C9…BF86（与备份原件逐字节相同）
```

⇒ 冻结面自洽：`final2` 可对当前工作树**逐字反向应用**（说明工作树 = 补丁应用后状态），新增测试文件两侧同哈希。
补丁覆盖 **7 个 tracked 文件**（`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/EVENT-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`、`packages/shared/src/unwiredRecords.test.ts`、`packages/telemetry/src/Telemetry.ts`、`packages/telemetry/src/telemetry.test.ts`）；新增测试文件与 `tasks/120-turn-end-telemetry-slice.md` 是**未跟踪文件**，按卡面以"补丁 + 原件"方式观察，**未使用 `git show HEAD:`**。

**C7b 增量的性质（我独立核对，支撑后文残余风险判断）**：与 C7 冻结的 `turn-end-slice-final.patch` 对比，运行时实现代码（`liveTurnIds`、`before_turn` handler、`case 'turn/end':`、`counters.toolCalls += r.stats.toolCalls`）**在 `final.patch` 里就已存在**（即 C1 面，已被 C6 全量绿覆盖）；`final2` 相对 `final` 的增量只有：`docs/EVENT-SPEC.md` 新 hunk（1/1）、`Telemetry.ts` 类注释 `+174,79 → +174,95`（+16 行注释）、`telemetry.test.ts` BRIEF +10 行注释与 ⑱ +88 行、以及 ARCHITECTURE/BENCHMARK/PRODUCT-STATE 的**行内改写**（hunk 行数不变）。⇒ **C7b 未新增任何运行时代码**。

---

## 2. 问 1：阻断项 A 是否闭合 —— **是（闭合）**

### 2.1 条件已统一为「成功收尾的回合」，窄口径只剩"被否定的引述"

```
git grep -n "无不可重试错误" -- docs packages tasks
packages/telemetry/src/Telemetry.ts:186   # 「…装不下实现里真实的第三条反例路径」= 被否定的引述
packages/telemetry/src/telemetry.test.ts:78  # 「为什么不能写成"单一、无重叠、无不可重试错误"」= 负对照
```

⇒ 窄口径**不再以"唯一条件"的肯定式出现**，两处残留都是"被否定的引述/为什么不能用它"。

```
git grep -n "成功收尾" -- docs packages tasks   # 命中处（逐条读原文）
docs/ARCHITECTURE.md:176 / :372
docs/BENCHMARK-SPEC.md:575 / :576
docs/EVENT-SPEC.md:605
docs/product-evolution/PRODUCT-STATE.md:823
packages/telemetry/src/Telemetry.ts:183 / :195 / :199 / :229
packages/telemetry/src/telemetry.test.ts:76 / :804 / :805
```

### 2.2 两条来源是否都并列登记 —— **是，6/6 处**

```
git grep -n "预算耗尽" -- docs packages tasks   # 与 C7b 相关的命中（筛选后）
docs/ARCHITECTURE.md:176   「① 错误类别不可重试（:70 的 MODEL_RETRYABLE 之外）或 ② 错误类别可重试但重试预算耗尽（attempt > maxRetries）」
docs/ARCHITECTURE.md:372   「① 错误类别不可重试、② 重试预算耗尽（:636 的 retryable 为假的第二个来源…）」
docs/BENCHMARK-SPEC.md:575 「① provider 抛不可重试错误、② 错误类别可重试但重试预算耗尽」
docs/BENCHMARK-SPEC.md:576 「① 错误类别不可重试、② 类别可重试但重试预算耗尽 —— 都不落 turn/end」
docs/EVENT-SPEC.md:605     「错误类别不可重试，或 类别可重试但重试预算耗尽 attempt > maxRetries；两条都经 :462-463 的 throw err 使 :528 不落盘」
docs/product-evolution/PRODUCT-STATE.md:823 「① 错误类别不可重试、② 重试预算耗尽（:636 的 retryable 为假的第二个来源）」
packages/telemetry/src/Telemetry.ts:187-196  （权威处：两条来源 + 两条既有测试行号）
packages/telemetry/src/telemetry.test.ts:78-87（BRIEF：同两条 + 指向 ⑱）
```

4 处（`Telemetry.ts:183-186`、`telemetry.test.ts:76-77`、`ARCHITECTURE.md:372`、`PRODUCT-STATE.md:823`）**全部都是「成功收尾」+ 两条来源并列**，口径一致。

### 2.3 `BENCHMARK-SPEC.md:575/576` 是否一致 —— **是（576 是更精确的变体，方向正确）**

- `:575`（M02）：**「在成功收尾的回合上」**恰好计一次 + 两条反例（①②，同走 `AgentLoop.ts:462-463`）。
- `:576`（M03）：**「在"成功收尾且未被另一个 `runTurn` 重叠"的回合上」** + **三条**反例（①② 记录缺失、③ 回合重叠读到新回合计数器）。
- 说明：`:576` 不是"换个更窄的说法继续过度声称"，而是**把 M03 特有的第三条反例（重叠）显式写进条件**——比 M02 需要更严的条件，因为 `stats.toolCalls` 在重叠下确实不可信（C4② 已实测）。**条件更窄 = 声明更弱 = 方向安全**。

### 2.4 收窄后的表述在实现上是否成立 —— **是（我逐条复核行号与语义）**

| 引用 | 我的实测（read，非引用） | 结论 |
|---|---|---|
| `AgentLoop.ts:636` | `const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);` | ✅ 合取式，两条来源 |
| `AgentLoop.ts:649-651` | `if (!retryable) {` … `throw new Error(\`Model call failed after ${attempt} attempt(s): …\`)` | ✅ |
| `AgentLoop.ts:451-465` | `:452` TurnInterruptedError/aborted ⇒ `kind='interrupted'`；`:457` DenialLimitError ⇒ `kind='error'`；`:462-463` `} else { throw err; }` | ✅ 只有"其余错误"走 rethrow |
| `AgentLoop.ts:528` | `await session.appendSync({ type: 'turn/end', …})` | ✅ 在 catch **之后**，rethrow 路径不可达 |
| `AgentLoop.ts:208-212` | `bus.waterfall('before_turn', {turnId, input}, {listenerErrorPolicy:'defer'})` | ✅ |
| `AgentLoop.ts:282` | `await session.appendSync({ type: 'turn/start', turnId, surface:false })` | ✅ 在否决分支之后 |
| `AgentLoop.ts:265-282` | `:265-270` 写 `turn/end` → `:272-279` return；`:282` 才写 `turn/start` | ✅ 单向配对例外 |
| `AgentLoop.ts:70` / `:588` | `MODEL_RETRYABLE = new Set(['RATE_LIMITED','TIMEOUT','SERVER_ERROR','NETWORK'])` / `maxRetries = this.deps.llmRetry?.maxRetries ?? 5` | ✅ |
| 既有测试真实触发② | `AgentLoop.llm-retry-record.test.ts:280`（`new Error('rate limit 429')`）`:281`（`maxRetries:1`）`:288`（`rejects … after 2 attempt`）`:294`（`['retry','abort']`）`:295`（`['RATE_LIMITED','RATE_LIMITED']`）；`AgentLoop.stream.test.ts:385/388/390/391/392` 同形（`errorClass==='RATE_LIMITED'`） | ✅ 逐行读原文核对，未编造 |
| `AgentLoop.ts:136` 单实例 `state` | `private readonly state = new LoopState();` | ✅ |
| `State.ts:20-26` | `beginTurn()` 归零 `steps`/`toolCalls`/`contextEstimateTokens` | ✅ |
| `AgentLoop.ts:430-434` | `for (const call of toolCalls) { this.state.recordToolCall(); await this.dispatchToolCall(...) }` | ✅ 每个调用恰好一次 |
| `dispatchToolCall` 四个 `after_tool` emit | `:861`(deny→return :864) / `:879`(ask→return :883) / `:906`(被中断→rethrow :912) / `:923`(正常收尾) —— **四条不同 return 路径各恰好一次** | ✅ 支撑 M03 等式 |
| `SessionController.ts:159-167` 注释 | "calling runTurn while an older turn is still running aborts that stale turn" | ✅ |
| `InterruptController.ts:22-26` / `:5` | `begin()` `if (stale && !stale.signal.aborted) stale.abort();`，头部注释 "aborts + replaces any stale one" | ✅ |
| `Session.ts:138-147`（`loadExisting`/`openTurns`） | 未闭合回合**事后合成** `turn/end{kind:'interrupted', stats:{steps:0,toolCalls:0,durationMs:0}}` | ✅ 与文档措辞一致 |
| `composeHarness` attach/detach 边界 | `packages/application/src/compose.ts:331 telemetry.attach(bus)` / `:437 telemetry.detach()` | ✅ 支撑"attach 在回合之外"的边界声明 |
| `metrics.ts:7` 含 `'M11'`、`AgentLoop.log-evidence.test.ts:48/51` 测试 provider 上报且断言 `costEstimate: 0.375` | ✅（"没有任何 **shipped** provider 上报"这个收窄成立） | ✅ |

**关键判定（防"换个更窄的说法继续过度声称"）**：我把「成功收尾的回合」当成待证条件，逐条找反例：
1. **单回合 + 模型调用异常（①②）** ⇒ `turn/end` 不存在 ⇒ 已在**条件之外**被两条来源显式登记 ✅；
2. **回合重叠**（旧回合成功走到 `:528`，但读的是新回合计数器）⇒ **确实是一个"成功收尾却违反 M03 等式"的反例**，而它**已被显式登记**（`Telemetry.ts:220-226` 的 `stats.toolCalls` 反例段、`ARCHITECTURE.md:372` 的"另加回合重叠…"、`PRODUCT-STATE.md:823` 的"另加回合重叠…"、`BENCHMARK-SPEC.md:576` 的③），**不是被条件吞掉** ✅；
3. **崩溃合成收尾记录**（`Session.loadExisting` 合成 `turn/end{kind:'interrupted', stats 全零}` ⇒ 回放侧计 1 回合 / 0 工具调用）⇒ 已作为**边界如实写出**（`Telemetry.ts:240-241`）✅；
4. **回合中途 `attach`**（会 `toolCalls` 多计）⇒ 已作为**边界如实写出**（`Telemetry.ts:235-239`）✅；
5. **`before_turn` 载荷无字符串 `turnId`**（形状不认识 ⇒ 实时计一次、不进 `liveTurnIds`）⇒ 已如实写出"照旧每个事件计一次、**绝不静默少计**"（`Telemetry.ts` `liveTurnIds` 注释）✅。

⇒ 收窄后的条件 = **「成功收尾的回合」+ 显式枚举的例外**，实现上是成立的；没有发现"满足条件但等式不成立且未登记"的路径。
（**一处措辞张力**，非阻断：`ARCHITECTURE.md:176` 的标题句"该不变式只在'成功收尾'的回合上成立"与紧随其后的"同族的另两条已登记例外…`before_turn` 否决分支"在同一句里并存——否决分支按定义（非异常抛出地走到落盘）**属于**成功收尾，却同时是例外。因为例外被逐一列出、且句末有"**除已登记例外**…才 = 日志腐败"兜底，整体表述**不被证伪**，但读者可能困惑。见 §5 残余风险 R6。）

---

## 3. 问 2：阻断项 B 是否闭合 —— **是（闭合）**

### 3.1 `EVENT-SPEC.md:605` 已收窄

```
git grep -n "编号连续" -- docs
docs/EVENT-SPEC.md:605:不变式（贯穿全图）：…全部配对且编号连续；**除已登记例外**，任一缺失 = 日志腐败（H12 invariant_selfcheck 捕获）。**已登记例外（不判腐败）**与收窄口径同 docs/ARCHITECTURE.md:176，共三条、定级见 docs/product-evolution/PRODUCT-GAP-MAP.md：① **非成功收尾的回合整体缺 turn/end**（… :636 的 retryable 为假的**两条来源**：错误类别不可重试，**或**类别可重试但重试预算耗尽 attempt > maxRetries；两条都经 :462-463 的 throw err 使 :528 不落盘，PRODUCT-GAP-MAP.md:430）；② 配对方向不对称（before_turn 否决分支… :431）；③ 步内中断 ⇒ step/start 无 step/end（:446）。…
```

### 3.2 与 `ARCHITECTURE.md:176` 是否不再互否 —— **是，同口径**

两侧都是"**成功收尾 + 已登记例外 + 三条例外清单 + 指针**"，且三条例外**编号与归属一一对应**：

| # | `EVENT-SPEC.md:605` | `ARCHITECTURE.md:176` | `PRODUCT-GAP-MAP.md` 指针（我实读） |
|---|---|---|---|
| ① | 非成功收尾的回合整缺 `turn/end`（两条来源） | 异常路径（两条同闸门来源） | `:430` "异常路径不落 `turn/end`（`AgentLoop.ts:369 throw err`…）：配对破坏…**定级：中**" ✅ |
| ② | 配对方向不对称（否决分支写 `turn/end` 不写 `turn/start`） | 同 | `:431` "deny 分支写 `turn/end` 而不写 `turn/start`（单向配对）…`EVENT-SPEC` 的'全部配对'字面不成立。**定级：低**" ✅ |
| ③ | 步内中断 ⇒ `step/start` 无 `step/end` | 同 | `:446` "(d) 中断发生在 step 内 ⇒ `step/start` 无 `step/end`…**定级：中高**" ✅ |

⇒ 三处指针**逐条复核为真、未编造**；两个规格对同一条不变式给出**同一套例外**，C7 §3.3 的"互相矛盾"已消除。

### 3.3 该改动是否**确实只动文档** —— **是，三重证据**

1. **补丁层面**：`EVENT-SPEC.md` 的 hunk 只改 `docs/EVENT-SPEC.md` 第 605 行一处（`git diff --numstat` = `1 1 docs/EVENT-SPEC.md`），不牵任何 `.ts`。
2. **实现里 `invariant_selfcheck` 是否存在**：

```
git grep -n "invariant_selfcheck\|selfCheck" -- packages apps benchmarks      # impl exit=1（0 命中）
git grep -n "invariant_selfcheck"                                             # 仅 docs/ 4 处
docs/EVENT-SPEC.md:454 / :605、docs/HARNESS-ANATOMY.md:469、docs/HARNESS-COMPARISON.md:799、docs/research/harness-matrix/comparison.md:799
```

⇒ H12 自检**在本仓尚未实现**（`:605` 是对未来组件的描述性规格），收窄**不可能改变任何运行行为**。

3. **有无以该行字面为判据的测试**：

```
git grep -n -e "日志腐败" -e "全部配对" -e "编号连续" -- "*.test.ts"      # exit=1（0 命中）
git grep -n -e "EVENT_SPEC" -e "'EVENT-SPEC.md'" -- "*.test.ts"          # exit=1（0 命中）
git grep -n "EVENT-SPEC" -- "*.test.ts"                                  # 全部是注释性提及，无 fs 读取
```

⇒ **没有任何测试读 `docs/EVENT-SPEC.md` 的内容**（`telemetry.test.ts` 只读 `ARCHITECTURE.md` 与 `BENCHMARK-SPEC.md`，`auditRecordWiring.test.ts` 只读 `BENCHMARK-SPEC.md` 的 M12 行）。⇒ 收窄**没有让任何既有断言变绿或变红**，也没有削弱任何守卫（原本就没有守卫）。

---

## 4. 问 3：新增 ⑱ 是否判别性 —— **是（对代码变异），但不是对"文档改回窄口径"的绊线**

### 4.1 用例实现（补丁 `+695,213` 段，我逐行读）

```
telemetry.test.ts:845  it('⑱ 预算耗尽路径（类别可重试 RATE_LIMITED + maxRetries:1）：before_turn 已发而 turn/end 记录数 0 ⇒ live.turns ≠ replay.turns')
  provider = new ScriptedProvider(() => new Error('rate limit 429'))     // 类别可重试
  new AgentLoop({ …, llmRetry: { maxRetries: 1 } })
  await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/)
  expect(retryRecords).toHaveLength(2)
  expect(retryRecords.map(r => r.decision)).toEqual(['retry','abort'])
  expect(retryRecords.map(r => r.kind)).toEqual(['RATE_LIMITED','RATE_LIMITED'])   // 负对照
  expect(retryRecords[1]!.attemptNo).toBe(2)
  expect(retryRecords[0]!.backoffMs).toBeDefined() ; expect(retryRecords[1]!.backoffMs).toBeUndefined()
  expect(ends).toHaveLength(0)
  expect(beforeTurnEvents).toHaveLength(1) ; turn/start(turnId) 恰 1 条
  const live = tel.finalize(session); expect(live.turns).toBe(1)
  const replay = new Telemetry().finalize(session); expect(replay.turns).toBe(0); expect(replay.turns).not.toBe(live.turns)
```

### 4.2 三种改法会不会变红（逐条判定）

| 改法 | 会不会红 | 由哪条断言先红 |
|---|---|---|
| 实现改成"总能收尾"（`:462-463` rethrow ⇒ 赋值 `kind` 后继续落盘） | **会** | 首条 `rejects.toThrow(/after 2 attempt/)` —— 契约由 reject 变 resolve（与 C5b 变异 A 同款，实测同位置变红） |
| 只补落一条 `turn/end`（保留 rethrow） | **会** | `expect(ends).toHaveLength(0)` 先红；随后 `replay.turns` 0→1 ⇒ `toBe(0)` 与 `not.toBe(live.turns)` 相继红 |
| **文档条件改回窄口径**（不动代码） | **不会** | 本用例与 `turnEndBoundary.test.ts` 第 1 条仍全绿 —— **无任何测试以文档条件为判据**（见 §3.3-3） |

⇒ ⑱ **对实现层的两类改法是合格的绊线**；对"只改文档"**不构成绊线**。这一限制**执行器已在 C7b §2 判别性论证第 3 条如实写出**（不属隐瞒），我独立复核该自我判定**正确**。
**C5b 实测的可迁移性（如实标注为"同构推断"，非我实测）**：C5b 在 `%TEMP%` 副本里对 `AgentLoop.ts:462-464` 做过同族两次变异——变异 A（改成总能收尾）红在 `turnEndBoundary.test.ts:176`，变异 B（只在 `throw err` 前插 `turn/end`）红在 `:189` 的 `expect(ends).toHaveLength(0)`（原文 `expected [ { type: 'turn/end', …(5) } ] to have a length of +0 but got 1`）。⑱ 的断言形态与 C4① **逐条同构**（同一条 `rejects.toThrow`、同一条 `ends` 长度 0、同一条 `replay.turns` 为 0），故同一变异必然在 ⑱ 上落在同一断言。**我未复跑变异**（vitest 额度见 §7）。

### 4.3 负对照 `kind` 是否真把它与 C4① 区分开 —— **是**

- C4①（`turnEndBoundary.test.ts:156`）：`kind==='UNKNOWN'`（不在 `MODEL_RETRYABLE`）+ **默认 `maxRetries=5`** ⇒ `:203` 断言 `abortRecords[0].kind === 'UNKNOWN'`、`:202` 断言 `attemptNo === 1`。
- ⑱：`kind==='RATE_LIMITED'`（**在**词表内）+ `maxRetries:1` ⇒ `:598` 断言 `['RATE_LIMITED','RATE_LIMITED']`、`:599` 断言 `attemptNo === 2`。
- 若有人把 `RATE_LIMITED` 移出 `MODEL_RETRYABLE`：⑱ 的 `rejects.toThrow(/after 2 attempt/)`（会变 "after 1 attempt"）与 `retryRecords` 长度 2 **先红** ⇒ ⑱ 不可能"退化成 C4① 的复制"而仍绿。**负对照成立**。

---

## 5. 问 4：全仓是否仍有同类未收窄的过度声称 —— **同类中未发现新的阻断级实例；列 3 条轻微项**

我按卡面点名的四类做全仓 grep（`docs` + `packages` + `tasks`），逐条读原文判断：

```
git grep -n -e "全部配对" -e "一一配对" -e "1:1 配对" -e "配对且编号连续" -e "必然配对" -- docs packages
git grep -n -e "两侧同数" -e "两侧的数" -e "同数" -- docs packages
git grep -n -e "记录条数" -e "条数相等" -e "= 回合数" -- docs packages
git grep -n -e "没有铸造点" -e "没有对应指标定义" -e "全仓只有类型" -e "零生产者" -e "没有生产者" -- docs packages
```

| 类别 | 结论 |
|---|---|
| **配对** | 除 `ARCHITECTURE.md:176` 与 `EVENT-SPEC.md:605`（已收窄）外，`PRODUCT-GAP-MAP.md:431` 的"`EVENT-SPEC` 的'全部配对'字面不成立"是**如实登记为欠账**（不是过度声称）；其余"一一对应"命中（`BENCHMARK-SPEC.md:73` 目录名、`DESIGN-DECISIONS.md`、`roster.ts`、`autoRouter.ts` 等）**与配对不变式无关**，且各自有守卫或为真。**未发现新的未收窄配对声称。** |
| **条数 / 两侧同数** | 除已收窄的 6 处外，`Telemetry.ts:289`（M05 族"恰好计一次"）与 `telemetry.test.ts` ②④⑧（各自有用例钉住）**都是既有、已被守卫的声明**；`⑯⑰` 的用例名把条件写在明面上。**未发现新的未收窄条数/同数声称。** |
| **成本铸造点** | `Telemetry.ts:259-263` 已从"全仓没有铸造点"退到"**没有任何 shipped provider 上报**"，并**显式禁止**退回绝对化（我复核 `costEstimate` 非测试命中：`AgentLoop.ts:293/:384-385/:561/:743-745` 全是累加/透传，`events.ts:106`、`provider.ts:102/:151` 是类型声明 ⇒ **收窄正确**；测试 provider 确实铸造：`AgentLoop.log-evidence.test.ts:48/51`）。 |
| 同类的**其他**"没有铸造点/生产者"（非本轮新增） | `unwiredRecords.test.ts:249-275`（`AuditDenialRecord.stage` 的 `'sandbox'`/`'guard'`"有类型、有词表、有消费者，只是没有铸造点"）与 `PRODUCT-STATE.md:743`（`SANDBOX_DENIAL` errorClass 无生产者）——**主题不同**（不是 `costEstimate`），且**各自有可执行守卫**（`unwiredRecords.test.ts` ③、`auditRecordWiring.test.ts` ②③）⇒ 属"被守卫的如实登记"，不是过度声称。 |

**列出的 3 条轻微项（不构成阻断，建议随手修）**：
- **R6（措辞张力）**：`ARCHITECTURE.md:176` 标题句"该不变式只在'成功收尾'的回合上成立"与同句列出的"`before_turn` 否决分支"（按定义**属于**成功收尾）并存；建议改成"该不变式**在除下列已登记例外之外的成功收尾回合上**成立"。
- **R7（可能误读）**：`BENCHMARK-SPEC.md:575` 说 `turn/end` 是"**纯回放侧的唯一真源**"——`turn/start` 也是持久记录，建议写成"纯回放侧 **M02 所取的**唯一真源"。
- **R8（术语撞名 + 陈旧行号）**：`ARCHITECTURE.md:170` / `EVENT-SPEC.md:591` 已有 `{预算耗尽} → turn/end kind=budget`（**步数**预算），与 C7b 新增的"**重试**预算耗尽"同词不同义（新文本多数已限定"重试"，风险低）；另 `PRODUCT-GAP-MAP.md:430` 仍引 `EVENT-SPEC.md:600`（漂移后该不变式在 `:605`），本切片未同步该指针。

---

## 6. 问 5：判决与后续

### 6.1 判决：**PASS（置信度 0.82）**

无阻断项。C7 的 A/B 两条都已闭合，且闭合方式是**改对了条件**（统一到 M02 行自己那句"成功收尾的回合"）+ **补上了缺失的反例路径的判别性用例 ⑱**，不是"换个说法绕开"。

置信度不取更高（0.9+）的原因（如实）：① ⑱ 的突变判别力是**代码层论证 + C5b 同构实测迁移**，我未复跑变异；② C7b 的文档增量**未跑全量回归**（我只跑了卡面允许的 1 次定向 vitest，见 §7）；③ 例外清单是否**穷尽**属归纳判断（我找不出第 7 条，但"找不出"不等于"不存在"）。

### 6.2 残余风险（PASS 之后的必读项）

1. **R1（最重要）：文档条件没有任何守卫**。"成功收尾 + 两条来源"这套收窄写在 `Telemetry.ts` 类注释 / `telemetry.test.ts` BRIEF / `ARCHITECTURE.md:176/:372` / `PRODUCT-STATE.md:823` / `BENCHMARK-SPEC.md:575/576` / `EVENT-SPEC.md:605`，**没有一条测试以这些文字的条件为判据** ⇒ 今后有人把条件改回窄口径（或删掉"②"），测试**全绿**。这正是 ⑱ 覆盖不到的那一格（问 3 的第三小问）。
2. **R2**：`M02/M03` 行仍**没有文档⇄代码守卫**（`telemetry.test.ts` ⑤ 只守 §4.11 那一行与 M05 行；⑫ 守 M13、⑨ 守 M14）。C7 §4.3-6 的原判仍在。
3. **R3**：C7 §4.3 的其余无测试见证面**仍在**：崩溃合成 `turn/end` 流经新增 `case 'turn/end':`（类注释声明"计 1 回合 / 0 工具调用"但无用例）；`before_turn` 载荷无 `turnId` 的"形状不认识"分支；回合中途 `attach`；`stats.steps` 在"模型调用被中断"时多于 `after_model` 条数。
4. **R4**：⑤ 的**反引号词法**改动（未消费段只认反引号包裹的 `x/y`）本身无用例钉住 —— 今后把新的未消费类型**不加反引号**写进该段会漏检。
5. **R5**：C6 的全量绿（169 文件 / 2179 passed）**早于 C7b**。C7b 未新增运行时代码（§1 已核），故行为面不受影响；但文档解析类测试理论上可能受文档改写影响。我做了**静态普查**：读 `BENCHMARK-SPEC.md` 的测试只有 `spec-manifest-parity.test.ts`（⑪ 只取 §4.1 的 **id ⇄ 名称**列，M02/M03 的 3 列表未动）、`auditRecordWiring.test.ts` ④（只取 **M12 行**，未改）、`runner.test.ts`（注释性）、`unwiredRecords.test.ts`（只读源码，不读该文件内容）；读 `ARCHITECTURE.md` 的 `AgentLoop.request-header.test.ts` 只在注释里提到、实际读的是会话日志。⇒ **未发现可被本次文档改写打红的测试**，但**未实测全量**，提交前建议补一次 `test:all`。
6. **R6/R7/R8**：见 §5 末（措辞张力 / "唯一真源"可能误读 / 术语撞名与 `PRODUCT-GAP-MAP.md:430` 的陈旧行号）。

### 6.3 建议后续卡（按优先级）

- **C9（P1）文档条件的可执行守卫**：给"成功收尾 + 两条来源"加一条文档⇄代码守卫（最小可行：在 `telemetry.test.ts` 新增一条，断言 `Telemetry.ts` 类注释 / `BENCHMARK-SPEC.md` M02·M03 行**同时**含"成功收尾"与"预算耗尽"两个词，且 M03 行含"重叠"），把 R1/R2 一起收口；同时把 ⑤ 的反引号词法用一个负例钉住（R4）。
- **C10（P2）补 C7 §4.3 的见证**：崩溃合成 `turn/end` ⇒ `case 'turn/end':` 的"计 1 回合 / 0 工具调用"；`stats.steps` 中断 mismatch；回合中途 `attach` 的多计（R3）。
- **C11（P3）措辞与指针清理**：R6（`ARCHITECTURE.md:176` 标题句加"除下列例外"）、R7（"纯回放侧所取的唯一真源"）、R8（`PRODUCT-GAP-MAP.md:430` 的 `EVENT-SPEC.md:600 → :605`；"步数预算 / 重试预算"分名）。
- **C12（P3）⑱ 的独立突变实测**：在 `%TEMP%` 副本里复跑 C5b 的变异 A/B，观察 ⑱ 的首红断言（补上"⑱ 判别力"的实测位，而非同构推断）。

---

## 7. 真实工作树未被改动（自证）

评审结束时（**在我跑过 1 次定向 vitest 之后**）：

```
$ git status --short
 M docs/ARCHITECTURE.md
 M docs/BENCHMARK-SPEC.md
 M docs/EVENT-SPEC.md
 M docs/product-evolution/PRODUCT-STATE.md
 M packages/shared/src/unwiredRecords.test.ts
 M packages/telemetry/src/Telemetry.ts
 M packages/telemetry/src/telemetry.test.ts
?? DSH_RECOVERY_CHECKPOINT.md
?? DSH_RECOVERY_REPORT.md
?? packages/telemetry/src/turnEndBoundary.test.ts
?? tasks/120-turn-end-telemetry-slice.md
# 行数 = 11（与任务卡要求的"仍 11 项"一致）

$ git rev-parse HEAD
ba173d4788fe02deceb78f077c10be1053ad559f        # 仍 ba173d4
$ git diff --cached --stat                       # 无输出（暂存区为空）
```

- 冻结件复评前后哈希不变：`turn-end-slice-final2.patch` = `84CFD07E…DECA`；`turnEndBoundary.test.ts` = `56F413C9…BF86`。
- 未执行：任何 add/commit/stash/restore/checkout/clean、任何文件删除、`npm install`、`test:all`、lockfile 改动、真实 provider 调用、对 `docs/` 或 `packages/` 的任何写入、对 `DSH_RECOVERY_REPORT.md` 的任何触碰。
- 唯一副作用：`npx vitest` 写了 **gitignored** 的 `node_modules/.vite` 缓存（卡面明文允许在真实树内跑该命令一次）。
- **定向 vitest 用量 = 恰好 1 次**（在真实树内，非副本）：

```
cd C:\work\Vessel_Harness
npx vitest run packages/telemetry --reporter=verbose
  ✓ packages/telemetry/src/auditRecordWiring.test.ts (7)
  ✓ packages/telemetry/src/turnEndBoundary.test.ts (2)
  ✓ … ⑤ 文档⇄代码：§4.11 点名的回放消费集合 == finalizeRecord 的 case 集合；M05 来源名副其实
  ✓ … ⑯ M02/M03 纯回放（成功单回合）…
  ✓ … ⑰ 防重复计数 + 成功单回合两侧同数…
  ✓ … ⑱ 预算耗尽路径（类别可重试 RATE_LIMITED + maxRetries:1）…
  Test Files  3 passed (3)
       Tests  28 passed (28)      # 与 C7b 记录的基线 27 + 新增 ⑱ = 28 逐字一致
    Duration  1.53s
=== VITEST EXIT CODE = 0 ===
```

⇒ **测试全绿与本次 PASS 不矛盾、也不构成 PASS 的理由**：⑱ 绿只能证明"该路径的行为与断言一致"，证明不了"文档条件被守住"（R1）。

---

## 8. 偏差 / 未完成项（如实）

1. **未做 ⑱ 的突变实测**：卡面限定"定向 vitest ≤1 次"，该额度用于 §7 的基线复现；⑱ 的判别力结论 = **逐条读用例实现 + 与 C5b 已实测的同构变异逐条对齐**（C5b 变异 A 红在 `:176`、变异 B 红在 `:189`），**明确标注为"代码层 + 同构迁移"，非我实测**。补法见 §6.3 C12。
2. **未跑全量回归**（卡面禁止）：R5 的跨包文档解析风险由**静态普查**（逐文件读所有读这些文档的测试，确认它们取的列/行未被本次改写触及）覆盖，**未实测**。
3. **未在 `%TEMP%` 副本内做任何实验**：本次全部结论来自补丁/原件实读 + 真实树内的只读 grep/read + 1 次定向 vitest，故无需建副本、也就没有副本清理项。
4. 报告中的行号：对**本切片修改过的文件**（`Telemetry.ts`、`telemetry.test.ts`、`ARCHITECTURE.md`、`BENCHMARK-SPEC.md`、`EVENT-SPEC.md`、`PRODUCT-STATE.md`、`unwiredRecords.test.ts`）一律为**补丁应用后（= 当前工作树）**的行号（已用 grep 逐条核对行号与原文一致）；对未改动文件（`AgentLoop.ts`、`State.ts`、`Session.ts`、`SessionController.ts`、`InterruptController.ts`、`PRODUCT-GAP-MAP.md`、`compose.ts` 等）为 HEAD `ba173d4` 的行号。
5. **未复核** `tasks/120-turn-end-telemetry-slice.md` 的 §11 内容（该文件是**未跟踪文件、不在冻结补丁内**，卡面评审对象只含补丁 + 测试文件原件）；仅确认该文件存在且含 `## 11. C7b 修正…` 段。若提交时把该文件纳入，则其内容**不在本次评审覆盖范围**内。
6. 命令文本未含任何永久删除类 API 字面名。
