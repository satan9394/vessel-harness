# C7 全新上下文独立对抗评审 —— 判决报告

- 评审角色：独立评审员（全新上下文，未参与本切片任何实现/收窄/突变工作）
- 模式：**Audit（只读、只出判决）**——未改动真实工作树任何文件，未 add/commit/stash/restore/checkout/clean，未删除任何文件，未 install，未改 lockfile
- 评审日期：2026-09-13
- 仓库：`E:\Code_file\Projects\Composable_Agent_Harness`（分支 `main`，HEAD `ba173d4788fe02deceb78f077c10be1053ad559f` = `ba173d4`，**无 remote**）

---

## 0. 判决

**FAIL（置信度 0.80）**

一句话理由：三处被证伪断言的无条件形式**确实已被消除**、收窄后的每一条**机制与行号引用都经我独立复核成立**，但收窄所用的**条件本身选错了**——`「单一、无重叠、无不可重试错误」` 这个条件**装不下**实现里真实的第三条反例路径（**错误类别可重试、但重试预算耗尽**），而该路径在**本仓既有测试里已被真实触发**（`AgentLoop.llm-retry-record.test.ts:279-295`、`AgentLoop.stream.test.ts:380-396`）⇒ 满足该条件的回合上「回合数 = 记录条数 = `before_turn` 事件数」与「实时 == 纯回放」**仍然不成立**。这与本次原始 FAIL 属**同一病类**（依据比实现能做到的强），只是换了一个更窄的说法继续过度声称。

> 判定枢纽（如实披露，便于人类快速裁决）：本判决取决于把 `不可重试错误` 读作**错误类别**还是**最终结果**。
> - **类别读法**（本切片自己的权威注解）：`turnEndBoundary.test.ts:26-29` / `:167-170` 明确写「不可重试 = 错误类别不在 `MODEL_RETRYABLE`（`AgentLoop.ts:70` 词表）」，且 `:196-198` 明说「预算耗尽需要 attempt > 5」是**另一条路**。按此读法，条件不含预算耗尽 ⇒ **存在反例 ⇒ FAIL**。
> - **结果读法**（"最终没能重试成功"）：条件成立，判决应降级为 PASS + 残余风险。
> - 我采纳**类别读法**，理由是 `AgentLoop.ts:629-631` 的既有注释把两种情况**并列命名**（「错误类别不可重试（`MODEL_RETRYABLE` 之外）**或**重试预算耗尽（`attempt > maxRetries`）」）⇒ 本仓自有的词汇表里，`不可重试` 就是类别，预算耗尽是**另一个名字**。
> - 另有一条**决定性的内部不一致**：同一个切片在**相邻两行**里用了**两个不同的条件** —— `docs/BENCHMARK-SPEC.md:575`（M02 行）写 `**在成功收尾的回合上**`（**这个是对的**），`:576`（M03 行）与其余四处写 `单一、无重叠、无不可重试错误`（**这个漏了一条路**）。修法即「统一采用 M02 行自己那句话」。

---

## 1. 评审对象与冻结校验

| 对象 | 声明 | 我的实测 | 一致 |
|---|---|---|---|
| `backup\turn-end-slice-final.patch` | 46803 B / `6C01A6E4…26CCA` | 46803 B / `6C01A6E4EB09F9E7039F2C6481932702D8F474608E6231408294B3E123026CCA` | ✅ |
| `backup\turnEndBoundary.test.ts` | 16334 B / `56F413C9…BBF86` | 16334 B / `56F413C91DC7A0C7178195027A8A7E53F8F0D6FE6BE3CB0AE99EECA02B5BBF86` | ✅ |
| 冻结补丁 ⇄ 真实工作树 | C6 声称 `git apply --check --reverse` exit 0 | 我亲自复跑 ⇒ **exit 0**（未写盘） | ✅ |
| 真实树新增测试文件 ⇄ 备份原件 | 应逐字节相同 | 两侧 SHA256 均为 `56F413C9…BBF86` | ✅ |
| `telemetry.test.ts` 引入的新类型 `TurnEndRecord` | 补丁内 | `packages/shared` 已导出该类型（补丁新增 import 可编译，见 §4 tsc 证据） | ✅ |

命令原文：

```
git apply --check --reverse "...\backup\turn-end-slice-final.patch"   # exit=0（另有 4 条 LF/CRLF warning，仅提示）
Get-FileHash ...\backup\turnEndBoundary.test.ts -Algorithm SHA256     # 56F413C9…BBF86
Get-FileHash packages\telemetry\src\turnEndBoundary.test.ts -Algorithm SHA256  # 56F413C9…BBF86（相同）
```

---

## 2. 五问逐条

### 问 1：收窄是否到位？——（一半成立，一半不成立）

#### 1.1 三种「无条件形式」已消除 —— **成立**

独立全仓 `git grep`（覆盖 tracked 全量 + 未跟踪新文件所在目录；`node_modules`/`dist` 无 tracked 项）：

| 被证伪的无条件形式 | 命令 | 结果 |
|---|---|---|
| 有记录 ⇒ `after_tool` 条数 == `stats.toolCalls` | `git grep -n "toolCalls" -- docs packages` 后筛 `after_tool/条数/逐字/相等` | 仅剩 `BENCHMARK-SPEC.md:576`、`telemetry.test.ts:699`，**两处均带显式条件 + 显式"不是无条件的"** |
| 记录条数 = 回合数 = `before_turn` 事件数 | `git grep -n -e "记录条数" -e "事件数" -e "回合数" -- docs packages tasks` | 仅剩 `Telemetry.ts:183/184/190`、`telemetry.test.ts:74`（`:74` 是**引述旧形式**以说明收窄）；无无条件存活 |
| 无条件「实时 == 纯回放」 | `git grep -n -e "纯回放" -e "两侧同数" -- docs packages tasks` | 全部带条件（`Telemetry.ts:213` "在回合都成功收尾时"；用例名"成功单回合两侧同数"） |
| 「全仓没有铸造点 / 本仓没有对应指标定义」 | `git grep -n -e "没有铸造点" -e "没有对应指标定义" -e "全仓只有类型" -- docs packages tasks` | 命中处**全部是禁止性表述**（`Telemetry.ts:243`/`:246` 写着"**不能**说…"）；唯一另一处 `unwiredRecords.test.ts:255` 说的是 `AuditDenialRecord.stage` 的 `'sandbox'`/`'guard'`，**与 `costEstimate` 无关**（另一主题、且为真） |

#### 1.2 收窄后的实质表述经复核**成立**（逐条）

- `costEstimate` 收窄为「**没有任何 shipped provider 上报它**」⇒ **我独立验证为真**：`git grep -n "costEstimate" -- packages apps benchmarks ':!*.test.ts'` 只返回 `AgentLoop.ts:293/:384-385/:561/:743-745`（**累加与透传**）、`events.ts:106`、`provider.ts:102/:151`（**类型声明**）、`Telemetry.ts` 注释；**没有任何非测试 provider 铸造它**。测试 provider 确实铸造它：`AgentLoop.log-evidence.test.ts:48`（`costEstimate: 0.125/0.25`）与 `:51`（断言落进 `turn/end.stats`）——与 C6 全量日志 `:473` 的 `"costEstimate":0.375` 逐字吻合。
- 「**不能**说本仓没有对应指标定义」⇒ **为真**：`packages/shared/src/metrics.ts:7` 的 `MetricId` 逐字含 `'M11'`。
- 机制引用**逐个复核为真**（这是本次评审最重要的交叉验证）：

| 引用 | 实测原文/结论 |
|---|---|
| `AgentLoop.ts:462-463` | `} else {` / `throw err;` ✅ |
| `AgentLoop.ts:528` | `await session.appendSync({ type: 'turn/end',` ✅ |
| `AgentLoop.ts:208-212` | `const beforeTurn = await bus.waterfall('before_turn', …)` ✅ |
| `AgentLoop.ts:265-282`（否决分支先写 `turn/end` 再早返回、`turn/start` 永不落盘） | `:265-270` 写 `turn/end`→`:272-279` return；`:282` 才是 `turn/start` ✅ |
| `AgentLoop.ts:136` 单实例 `state` | ✅（recon 已核，我复核 `:200` `this.state.beginTurn(turnId)` 与 `:136` 单例一致） |
| `State.ts:20-26` `beginTurn` 归零 | `steps`/`toolCalls`/`contextEstimateTokens` 归零 ✅ |
| `SessionController.ts:159-167`（承认 abort 旧回合） | 注释逐字「calling runTurn while an older turn is still running aborts that stale turn」✅ |
| `InterruptController.ts:22-26` | ✅（`begin()` abort 旧 scope） |
| `PRODUCT-GAP-MAP.md:430 / :431 / :446` | `:430` = "异常路径不落 `turn/end`（`AgentLoop.ts:369 throw err`）…**定级：中**"；`:431` = "deny 分支写 `turn/end` 而不写 `turn/start`（单向配对）…`EVENT-SPEC` 的『全部配对』字面不成立"；`:446` = "(d) 中断发生在 step 内 ⇒ `step/start` 无 `step/end`…**定级：中高**" —— **三处引用全部为真、未编造** ✅ |
| `Telemetry.ts:435-445`（`case 'turn/end'` 块）与 `:442`（去重行）、`:304-310`（before_turn handler） | 逐行核对**全部准确**（`:435` case、`:442` `if (this.liveTurnIds.has(r.turnId)) break;`、`:304-310` handler） ✅ |
| `metrics.ts:7`、`AgentLoop.log-evidence.test.ts:48/51` | ✅ 见上 |

> 结论：**没有发现编造行号或"换个地方继续绝对化"的情况**（除 §2.1.3 的条件缺陷外）。

#### 1.3 【阻断项 A】收窄的条件**装不下真实反例集** —— 仍在过度声称

**问题**：`「单一、无重叠、无不可重试错误」` 被用作三条等式的适用范围，但实现里 `turn/end` 缺失的路径**有两条**，条件只覆盖了一条。

**源码（判据在同一个布尔式里）**：

```
AgentLoop.ts:636:        const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);
AgentLoop.ts:649:        if (!retryable) {
AgentLoop.ts:651:          throw new Error(`Model call failed after ${attempt} attempt(s): ${(err as Error).message}`);
AgentLoop.ts:451:    } catch (err) {
AgentLoop.ts:452:      if (err instanceof TurnInterruptedError || this.interruptCtl.aborted) { … }
AgentLoop.ts:457:      } else if (err instanceof DenialLimitError) { … }
AgentLoop.ts:462:      } else {
AgentLoop.ts:463:        throw err;              // ← 直接抛出，永不执行 :528 的 turn/end
AgentLoop.ts:70:  const MODEL_RETRYABLE = new Set(['RATE_LIMITED', 'TIMEOUT', 'SERVER_ERROR', 'NETWORK']);
AgentLoop.ts:588:    const maxRetries = this.deps.llmRetry?.maxRetries ?? 5;
```

`retryable` 是**合取式**：`类别不可重试` **或** `attempt > maxRetries` 都会使 `retryable === false` ⇒ 走 `:651` 抛出 ⇒ `:462-463` rethrow ⇒ `:528` 的 `turn/end` 不落盘。**第二条路（预算耗尽）的错误类别是可重试类别**，因此**满足**文档写下的条件 `无不可重试错误`。

**本仓既有测试已真实触发该路径**（两个文件都**不在本切片改动范围内**，即稳定可复现）：

```
AgentLoop.llm-retry-record.test.ts:280   const provider = new ScriptedProvider(() => new Error('rate limit 429'));
AgentLoop.llm-retry-record.test.ts:281   const { … loop } = await makeLoop(dir, provider, { maxRetries: 1 });
AgentLoop.llm-retry-record.test.ts:288   await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/);
AgentLoop.llm-retry-record.test.ts:295   expect(recs.map((r) => r.kind)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']);   // ← 类别=可重试
```

```
AgentLoop.stream.test.ts:385   throw new Error('rate limit 429');
AgentLoop.stream.test.ts:388   … makeLoop(dir, alwaysFail, { llmRetry: { maxRetries: 1 } });
AgentLoop.stream.test.ts:390   await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/);
AgentLoop.stream.test.ts:392   expect(retries.every((r) => r.errorClass === 'RATE_LIMITED')).toBe(true);          // ← 类别=可重试
```

**后果（满足条件的回合上三条等式同时不成立）**：该回合 `before_turn` **已发**（`:208-212`）、`turn/start` **已写**（`:282`）、`turn/end` **不存在**（`:528` 不可达）⇒ 记录条数 `0` ≠ 回合数 `1` = `before_turn` 事件数 `1`；实时侧 `turns = 1`、纯回放侧 `turns = 0`。

**受影响的 6 处表述**（我逐条读原文判断是否被反例falsify）：

| # | 位置 | 原文 | 是否被反例否证 |
|---|---|---|---|
| 1 | `Telemetry.ts:183-186`（类注释，**所有别处都指向它**） | 「**本节的三条依据都只在「单一、无重叠、无不可重试错误」的回合上成立**（即：回合数 = 记录条数 = `before_turn` 事件数；两侧的工具调用数相等；实时与纯回放同数）」 | **是** |
| 2 | `telemetry.test.ts:76-77`（文件 BRIEF） | 「这三条**只在「单一、无重叠、无不可重试错误」的回合上成立**」 | **是** |
| 3 | `docs/ARCHITECTURE.md:372`（§4.11 行） | 「⇒ **在单一、无重叠、无不可重试错误的回合上**恰好计一次…（实时侧计到、纯回放侧计不到）」 | **是** |
| 4 | `docs/product-evolution/PRODUCT-STATE.md:823` | 「该记录面这两项的取值只在**「单一、无重叠、无不可重试错误」的回合**上可信」 | **是** |
| 5 | `docs/BENCHMARK-SPEC.md:575`（M02 行） | 「**在成功收尾的回合上**恰好计一次」 | **否**（`成功收尾` 恰好把该路径排除在外 —— **这句是对的**） |
| 6 | `docs/BENCHMARK-SPEC.md:576`（M03 行） | 「在…回合上，**该轮有 `turn/end` 记录** ⇒ …」 | **否**（前件已被 `有 turn/end 记录` 锁住） |

⇒ 修法直接可给：**把第 1/2/3/4 处的条件统一改成第 5 处自己那句话**（如「以 `turn/end` 收尾的回合」/「模型调用未以失败终止的回合」），并把**预算耗尽**登记为与「类别不可重试」并列的第二条反例路径——因为两者走的是**同一个闸门** `AgentLoop.ts:462-463`（文档自己引的就是这个闸门，比它写的条件宽）。

**复现命令（可直接跑，无需改仓）**：

```
cd E:\Code_file\Projects\Composable_Agent_Harness
npx vitest run packages/core/src/agent-loop/AgentLoop.llm-retry-record.test.ts -t "④′"
```

⇒ 输出证明「**类别 = RATE_LIMITED（可重试）** 的回合仍然 rejects」。要观测**记录侧后果**，在 `%TEMP%` 副本内贴入以下 8 行（不改真实树；我因「定向 vitest ≤1 次」额度未自行运行，如实标注为**代码级验证 + 既有测试佐证**，非本次实测）：

```ts
const session = await Session.open({ workspaceRoot: dir, sessionId: 'c7-probe' });
const bus = new EventBus(); const tel = new Telemetry(); tel.attach(bus);
const provider = { id: 'p', async chat() { throw new Error('rate limit 429'); } };
const loop = new AgentLoop({ session, bus, provider, model: 'm', buildContext,
  runTool: async () => ({ content: '', meta: {} }), getVisibleTools: () => [], llmRetry: { maxRetries: 1 } });
await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/);
// 预期（由 :208-212/:282/:462-463/:528 的不可达性决定）：
//   session.replay() 的 turn/end 条数 = 0，before_turn 事件 = 1
//   tel.finalize(session).turns = 1 ；new Telemetry().finalize(session).turns = 0
```

---

### 问 2：用例是否判别性？——**是（C4① 的判别力不受影响）**，但覆盖有洞

**C5 突变记录（I 未复跑，只复核其可复现性与行号映射）**：变异 1 删 `Telemetry.ts:435-445` ⇒ `3 failed | 24 passed`，红在 `⑯:746`（turns 0≠1）、`⑰:798`（replay 0≠live 1）、`C4②:325`（replay 0≠2）；变异 2 删 `:442` 去重行 ⇒ `2 failed | 25 passed`，红在 `⑰:790`（live 2≠1）、`C4②:319`（live 4≠2）。我核对了这两个变异点与真实文件的行号/内容**逐字一致**（`Telemetry.ts:435-445` 见 §2.1.2 表），且两轮都只有注入变异能解释红点（其余 26/25 条与基线同判定）⇒ **C5 的结论可信**。

**⑯⑰ 的判别力结论**：
- `⑯`（纯回放，`:711`）在**只有一个新增分支能产出 `turns/toolCalls`** 的场景里断言 `turns=1 / toolCalls=1 / steps=0` ⇒ 删分支必红（已实测）。**判别性成立**，且 `steps=0` 是**负对照**（把 `stats.toolCalls` 误换成 `stats.steps` 会红）⇒ 不是重言式。
- `⑰`（`:756`）同时钉「实时=1（去重生效）」与「纯回放=实时」⇒ **双向绊线**（两个变异各自红在不同断言上，已实测）。**判别性成立**。

**C4②（`turnEndBoundary.test.ts:216`）**：变异 1/2 分别在 `:325`/`:319` 杀它 ⇒ **双向绊线**；其核心断言 `end1.stats.toolCalls === 0` 且 `afterToolEvents.length === 1` 加上信号身份/`aborted` 证据（`:290-295`）是把重叠反例**机制性地**钉住，而非复述实现。**判别性成立**。

**C4①（`:156`）与 C5b 上报的 `:210/:211` 未单独实测 —— 我的结论：不影响该用例的判别力，但该用例对 Telemetry 侧的判别力本身有限。理由（三条）**：
1. **该用例作为整体已被两个独立变异杀死**：变异 A（把 `:462-463` 改成"总能收尾"）红在 `:176`（`runTurn` 由 reject 变 resolve）；变异 B（只在 `throw err` 前插一条 `turn/end`）红在 `:189`（`ends` 长度 0→1）。⇒ **它是绊线，不是橡皮图章**。
2. **`:210/:211` 未被观测到红，是 vitest 同一 `it()` 内 fail-fast 的结构性结果**，不是断言失效：基线（全绿）下这两条**确实被执行并通过**；`:189` 一旦红，后续断言不再求值。C5b 对这一点的描述**准确且诚实**。
3. **但 `:210/:211` 的独立判别力本来就窄**：给定 `:189` 已通过（记录面里没有 `turn/end`），`:210` 的 `replay.turns === 0` 在当前实现下几乎是蕴含的；它能独立杀死的变异类只有「回放侧改从别的记录类型数回合」（例如改数 `turn/start` ⇒ `:210` 红而 `:189` 仍绿）。这类变异**从未被测试**。⇒ 结论是「**用例判别力成立，缺的是这两条断言的独立实测证据**」，与 C5b 的自我判定一致；补测法（摘掉 `:189/:190/:194` 后重跑变异 B）是对的。

**是否有「重言式断言」残留**：C5 主动指出「在变异 1 下 C4① 的 Telemetry 侧两条断言对它是重言式（该场景根本没有 `turn/end` 记录）」——这个自我判定**正确且已被披露**，不属隐瞒。除此之外我未发现未披露的重言式。

**真正的洞（与问 1 同源）**：`⑯⑰ + C4① + C4②` 覆盖了「成功单回合」「类别不可重试的单回合异常」「回合重叠」三段，**没有一段覆盖「类别可重试 + 预算耗尽」**——而这是**既有测试已在生产代码里跑通**的第三条路径。⇒ 「成功单回合以外没有任何用例」这条原始发现（recon §2.3 第 5 项）只被**部分**修复。

---

### 问 3：连带一致性 —— 文件内矛盾已清；**但引入一处新的跨文档矛盾**

**3.1 `unwiredRecords.test.ts` 自相矛盾已清 ✅**
`:37-43`（更正段）与 `:171-176`（就地更正段）现在**互相一致**：两处都说 `turn/end` **整条已消费**、仍未接线的只剩 `stats.steps`/`tokensUsed`/`costEstimate`、`toolCallsWithoutEnd` 与 `request/header`。改前的 `:171-172` 旧口径（把 `turn/end` 当"无消费方"例子）已不存在。

**绊线语义未削弱 ✅**：该文件改动**全部在注释内**（`git diff --numstat` = `10/2`，且我实读确认无断言/清单条目被删）；其三组判据（零生产者/零消费者/零类型）与 `UNDECLARED_UNWIRED` 清单（`:188` 起）**逐字未动**——守卫仍是"谁接线谁先红"的绊线。

**3.2 `ARCHITECTURE.md:176` 收窄成立 ✅，`§4.11` 行收窄成立 ✅，文档⇄代码双向守卫仍成立 ✅**
- `:176` 已改为「**该不变式只在"成功收尾"的回合上成立**」+ 三条已登记例外（异常路径 / 单向配对 / 步内缺 `step/end`）+ `PRODUCT-GAP-MAP.md:430/:431/:446` 指针（三处指针我逐个复核为真，见 §2.1.2）。
- 双向绑定**仍在**：`telemetry.test.ts:277-309` 的 ⑤ 做 `expect(new Set(consumed)).toEqual(new Set(handled))`（文档多写 ⇒ 红；代码多分支没写进文档 ⇒ 红）+ 反向 `for (const t of unwiredTypes) expect(handled).not.toContain(t)`。我实测：`ARCHITECTURE.md:372` 职责单元格内 `未消费` **恰好出现 1 次**（切段唯一），反引号 `x/y` token 恰为 `{session/created, request/header}`，而 `handled` 侧含 `turn/end` ⇒ 反向判据对 `turn/end` 的排除**是真的在起作用**（改前那条断言是 `toContain('turn/end')`）。
- ⑤ 的**词法改动**（未消费段从"任意 `x/y`"改为"**反引号包裹**的 `x/y`"）我判定为**必要且正当**：旧正则会在 `turn/end.stats` / `turn/end{kind:'interrupted'}` 里切出 `turn/end`，从而与"整条已消费"直接冲突、使这句如实表述**无法写出**。**代价（残余风险）**：今后若有人把新的未消费类型**不加反引号**写进该段，反向判据会漏检——这一点**没有任何测试钉住**。

**3.3 【一致性缺口 B】`docs/EVENT-SPEC.md:605` 仍是无条件形式 ⇒ 与收窄后的 `ARCHITECTURE.md:176` **互相矛盾**（本切片新造成的不一致）**

原文（我实测该行逐字）：

```
docs/EVENT-SPEC.md:605: 不变式（贯穿全图）：`turn/start→turn/end`、`step/start→step/end`、`tool/call→tool/result`、`approval/asked→decided`、`compaction/start→…→end` 全部配对且编号连续；任一缺失 = 日志腐败（H12 invariant_selfcheck 捕获）。
```

- 改前：`ARCHITECTURE.md:176` 与 `EVENT-SPEC.md:605` **同口径**（都无条件，都已被证伪，属"一致地错"）。
- 改后：`ARCHITECTURE.md:176` **有条件 + 三条例外**，而 `EVENT-SPEC.md:605` **仍无条件** ⇒ 两个规格对**同一条不变式**给出互相否证的表述。
- 加重项：`PRODUCT-GAP-MAP.md:430` 自己就把这条不变式的**出处**指向 `EVENT-SPEC.md:600`（漂移前行号）⇒ 本切片收窄的是**副本**，**源头文档仍在对日志判"腐败"**；且 `ARCHITECTURE.md:176` 的新文字**没有提到** `EVENT-SPEC.md:605`。
- 减轻项（我如实计入）：**C3 卡面明文禁止**改 `EVENT-SPEC.md` 的字段语义 ⇒ 执行器越界才是违规；且 `PRODUCT-GAP-MAP.md:431` 早已登记「`EVENT-SPEC` 的『全部配对』字面不成立」但**只报告未改** ⇒ 该矛盾**部分属既有欠账**。

**裁决**：因 C3 卡面明确划界，我**不把它列为独立阻断项**，但它必须在本批**二者之一**：(a) 一并收窄 `EVENT-SPEC.md:605`（最小改法：加"成功收尾"条件 + 指向 `PRODUCT-GAP-MAP.md:430/:431/:446`），或 (b) 在 `tasks/120` 里**显式登记为已知残余并派后续卡**——因为按本仓自己的纪律（`PRODUCT-STATE.md` Round 175 自评：**"可靠的停法只有一种：对某类不变量做一次全仓清查并列出全部实例"**），本切片对"配对不变式"这一类的**全仓枚举并不完整**。

---

### 问 4：回归面 —— C6 日志**支持全绿**，我的聚焦复跑**一致**

**4.1 C6 日志核对（我实读，非引用）**
- `C6-test-all.log`：根 `Test Files 169 passed (169)` / `Tests 2179 passed | 6 skipped (2185)`；`apps/web` `Test Files 11 passed (11)` / `Tests 120 passed (120)`；末行有显式标记 `=== C6 gate marker: npm run test:all exit code = 0 ; elapsed = 98.8 s ===` ⇒ **两个 root 都 exit 0**，**无 flaky、无过滤**。
- **增量可解释**：recon 基线 168 文件 / 2177 passed + 本次新增 `turnEndBoundary.test.ts`（+1 文件 / +2 用例）= 169 / 2179 ✅ 逐字吻合。
- `C6-tsc-b.log` 为 **0 B**。**必须指出**：0 字节日志**本身无法证明 exit 0**（空输出与"采集失败"同形），属**证据形式缺陷**（不是假绿）。我做了**独立且不写盘**的交叉验证：

```
npx tsc -b tsconfig.json --dry --verbose     # exit code = 0
  → 18 个项目全部 "is up to date"
  → 且 packages/telemetry 的判据原文：Project 'packages/telemetry/tsconfig.json' is up to date
     because newest input 'packages/telemetry/src/turnEndBoundary.test.ts' is older than
     output 'packages/telemetry/dist/.tsbuildinfo'
```

⇒ 这条**强证据**同时说明两件事：(a) 上一次真实 `tsc -b` 是**成功**的（否则 tsbuildinfo 不会是最新的成功产物）；(b) 它发生在**最后一次编辑（新测试文件）之后**（AGENTS.md 约束 7 满足）。建议以后卡把 `$LASTEXITCODE` 一并写入日志。

**4.2 我的聚焦复跑（定向 vitest **恰好 1 次**，在真实树内）**

```
cd E:\Code_file\Projects\Composable_Agent_Harness
npx vitest run packages/telemetry --reporter=verbose
```

结果摘录：

```
 ✓ packages/telemetry/src/auditRecordWiring.test.ts (①②③④⑤a⑤b⑤c)
 ✓ packages/telemetry/src/telemetry.test.ts > … > ⑤ 文档⇄代码：§4.11 点名的回放消费集合 == finalizeRecord 的 case 集合
 ✓ packages/telemetry/src/telemetry.test.ts > … > ⑯ M02/M03 纯回放（成功单回合）…
 ✓ packages/telemetry/src/telemetry.test.ts > … > ⑰ 防重复计数 + 成功单回合两侧同数…
 ✓ packages/telemetry/src/turnEndBoundary.test.ts > … > 异常路径（无并发；provider 抛不可重试错误）…
 ✓ packages/telemetry/src/turnEndBoundary.test.ts > … > 回合重叠 + 旧回合被 abort（受支持路径）…

 Test Files  3 passed (3)
      Tests  27 passed (27)
   Duration  1.72s
=== VITEST EXIT CODE = 0 ===
```

⇒ 与 C4/C5/C5b 记录的 `27 passed / 3 files` **逐字一致**，与 C6 全量日志**不矛盾**。**注意：测试全绿与本次 FAIL 不冲突**——FAIL 的点（预算耗尽路径）**没有任何用例覆盖**，所以它不可能红。

**4.3 未被测试覆盖的面（无测试见证）**
1. **【与阻断项 A 同源，最重要】类别可重试 + 重试预算耗尽**的回合 ⇒ `turn/end` 缺失、M02/M03 记录侧少计。既有两测试只断言 `llm/retry` 记录与 reject，**从未断言记录面/telemetry 后果**。
2. `Session.loadExisting` 为崩溃回合**合成**的 `turn/end{kind:'interrupted', stats 全零}` 流经新增 `case 'turn/end'`（类注释**声称**"那一轮计 1 个回合、0 次工具调用"）——**未找到任何用例断言该声明**。
3. `before_turn` 载荷**无字符串 `turnId`** 的"形状不认识"分支（计一次但不进 `liveTurnIds`，`Telemetry.ts:307-309`）——无用例。
4. **回合中途 `attach`** 边界（类注释自述"不假装守得住"、会 `toolCalls` 多计）——无用例（需新 seam）。
5. `stats.steps` 在"模型调用被中断"时**多于** `after_model` 条数这一声明——⑯ 只覆盖正常路径（steps=2 对应 2 次调用），**该 mismatch 无见证**。
6. `metrics()` 的 M02/M03 `source` 仍写 `before_turn`/`after_tool`（`Telemetry.ts:458-459`）而记录面已成为第二来源——**只写在注释里**；且我核实 **`docs/BENCHMARK-SPEC.md` 的 M02/M03 行没有任何文档⇄代码守卫**（⑤ 只守 §4.11 行与 M05 行，⑫ 守 M13、⑨ 守 M14）⇒ 这两行今后漂移不会被测试发现。
7. ⑤ 新增的"反引号限定词法"本身（见 §3.2 代价）——无测试钉住。

---

### 问 5：判决

**FAIL。** 阻断项见下节；若处置后重评，建议按上节 4.3 的 1/2/5/6 补卡。

---

## 3. 阻断项清单（FAIL）

### 阻断项 A（决定性）：收窄所用的条件不含「重试预算耗尽」路径 ⇒ 收窄后仍在过度声称

- **性质**：与原始 FAIL 同病类（声明强于实现）。**不是产物（代码）问题，是措辞问题**——`finalizeRecord` 的实现与 ⑯⑰ 都正确。
- **受影响表述（4 处，须同批改）**：`packages/telemetry/src/Telemetry.ts:183-186`、`packages/telemetry/src/telemetry.test.ts:76-77`、`docs/ARCHITECTURE.md:372`、`docs/product-evolution/PRODUCT-STATE.md:823`。
- **反例（满足条件但等式不成立）**：单回合、无重叠、provider 抛 `rate limit 429`（**类别可重试**，`AgentLoop.ts:70`）、`maxRetries: 1` ⇒ `AgentLoop.ts:636` 的 `retryable === false`（预算耗尽）⇒ `:649-651` 抛出 ⇒ `:451-464` 的 `else { throw err; }`（`:462-463`）⇒ `:528` 的 `turn/end` 永不落盘；而 `:208-212` 的 `before_turn` 已发、`:282` 的 `turn/start` 已写 ⇒ **记录条数 0 ≠ 回合数 1 = `before_turn` 事件数 1**；**实时 `turns=1` ≠ 纯回放 `turns=0`**。
- **原文（源码）**：
  - `packages/core/src/agent-loop/AgentLoop.ts:636`：`const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);`
  - `packages/core/src/agent-loop/AgentLoop.ts:649-651`：`if (!retryable) {` … `throw new Error(\`Model call failed after ${attempt} attempt(s): …\`);`
  - `packages/core/src/agent-loop/AgentLoop.ts:462-463`：`} else {` / `throw err;`
  - `packages/core/src/agent-loop/AgentLoop.ts:629-631`（**本仓自有的词汇切分**）：「`decision:'abort'` … 两种情况之一：错误类别不可重试（`MODEL_RETRYABLE` 之外）**或重试预算耗尽**（`attempt > maxRetries`）」
- **原文（既有测试，证明该路径可达且类别可重试）**：
  - `packages/core/src/agent-loop/AgentLoop.llm-retry-record.test.ts:280/281/288/295`
  - `packages/core/src/agent-loop/AgentLoop.stream.test.ts:385/388/390/392`
- **可复现命令**：
  1. `cd E:\Code_file\Projects\Composable_Agent_Harness && npx vitest run packages/core/src/agent-loop/AgentLoop.llm-retry-record.test.ts -t "④′"`（证明"可重试类别 + 预算耗尽 ⇒ `runTurn` rejects"）
  2. 记录面后果：把 §2.1.3 末尾那 8 行贴进 `%TEMP%` 副本的任一测试文件后跑 `npx vitest run packages/telemetry`（我因"定向 vitest ≤1 次"额度**未运行**，该后果由 `:462-463` → `:528` 的不可达性在代码层确定，并由上条测试佐证）
- **最小修法（供人类裁决，不由我实施）**：把条件统一为 `docs/BENCHMARK-SPEC.md:575` 已有的**正确措辞**（「**在成功收尾的回合上**」/「模型调用未以失败终止的回合」），并在类注释的反例清单里把「**重试预算耗尽**」与「类别不可重试」**并列登记**（两者同走 `AgentLoop.ts:462-463`）。

### 阻断项 B（次级，可"同批修"或"显式登记"二选一）：`docs/EVENT-SPEC.md:605` 仍无条件，与收窄后的 `ARCHITECTURE.md:176` 互否

- 原文见 §3.3。**加重**：`PRODUCT-GAP-MAP.md:430` 把该不变式的出处指向 `EVENT-SPEC.md:600`；`ARCHITECTURE.md:176` 的新文字未提及 `EVENT-SPEC.md:605`。
- **减轻**：C3 卡面明文禁止改 `EVENT-SPEC.md`（执行器未越界），且该矛盾在 `PRODUCT-GAP-MAP.md:431` 早已被登记为"只报告未改"。
- **要求**：要么同批收窄 `:605`，要么在 `tasks/120-turn-end-telemetry-slice.md` 里**显式登记为已知残余 + 派后续卡**（不得默认"已收口"）。

---

## 4. 若按 PASS 处置时的残余风险（备查，供人类对比裁决）

即使把阻断项 A 判为"可接受的措辞余量"，以下残余仍应记录：① `M02/M03` 行无任何文档⇄代码守卫（§4.3-6）；② ⑤ 的新词法使"未加反引号的未消费类型"漏检（§3.2 代价）；③ `telemetry.test.ts:81`「为它们补判别性用例是**另一次改动**，不在本卡的授权范围内」**已过时**（C4 已补 `turnEndBoundary.test.ts`）——C4 卡已如实披露、故意未改以保持改动面干净；④ `C4① :210/:211` 缺独立突变实测证据（判别力本身成立）；⑤ **回合重叠时 M03 该计几次**的口径裁决仍属人类（C4② 只标"不可信"，正确）；⑥ `C6-tsc-b.log` 为 0 B，未记录退出码；⑦ 本切片**没有**新增 `tasks/` 卡之外的提交动作（提交留待后续卡），`DSH_RECOVERY_*.md` 处置未裁决。

---

## 5. 真实工作树未被改动（自证）

评审结束时（**在我跑过 1 次定向 vitest 与 `tsc --dry` 之后**）：

```
$ git status --short
 M docs/ARCHITECTURE.md
 M docs/BENCHMARK-SPEC.md
 M docs/product-evolution/PRODUCT-STATE.md
 M packages/shared/src/unwiredRecords.test.ts
 M packages/telemetry/src/Telemetry.ts
 M packages/telemetry/src/telemetry.test.ts
?? DSH_RECOVERY_CHECKPOINT.md
?? DSH_RECOVERY_REPORT.md
?? packages/telemetry/src/turnEndBoundary.test.ts
?? tasks/120-turn-end-telemetry-slice.md
# 行数 = 10（与任务卡要求的"仍 10 项"一致）

$ git rev-parse HEAD
ba173d4788fe02deceb78f077c10be1053ad559f        # 仍 ba173d4
$ git log --oneline -1
ba173d4 fix: three declared values that were not measurements …
$ git diff --numstat
2	2	docs/ARCHITECTURE.md
2	2	docs/BENCHMARK-SPEC.md
1	1	docs/product-evolution/PRODUCT-STATE.md
10	2	packages/shared/src/unwiredRecords.test.ts
122	12	packages/telemetry/src/Telemetry.ts
166	6	packages/telemetry/src/telemetry.test.ts
# 与 C6 卡面逐字一致；暂存区为空（git diff --cached --stat 无输出）
$ git ls-files node_modules | Measure-Object -Line   # 0（无 tracked 项被写）
```

- 未执行：任何 `git add/commit/stash/restore/checkout/clean`、任何删除、`npm install`、`test:all`、真实 provider 调用、任何对 `docs/`/`packages/` 的写入。
- 唯一副作用：`npx vitest` 写了 **gitignored** 的 `node_modules/.vite` 缓存（任务卡明文允许在真实树内跑该命令）；`npx tsc -b --dry` **不写盘**。

---

## 6. 偏差 / 未完成项（如实）

1. **未做新的突变实测**：卡面限定「定向 vitest ≤1 次」，该额度用于 §4.2 的聚焦验证；C5/C5b 的突变结论我**只做了可复现性复核（变异点行号/内容逐字核对 + 红点与实现逻辑自洽）**，未复跑。
2. **阻断项 A 的记录侧后果未由我实测**（只做了代码层确定 + 两个既有测试佐证 + 明确复现步骤）——见 §2.1.3、§3。
3. **未跑 `test:all`**（卡面禁止），故 C6 全量的"根 169 / web 11"以**日志实读 + 增量可解释性**采信；`tsc -b` 则以 `--dry --verbose` 独立交叉验证（18 项目 up to date，exit 0）。
4. `AgentLoop.ts:136` 的"单实例 state"与 `InterruptController.ts:22-26` 我复核为**与引用一致**，但未逐字打印进本报告（`InterruptController` 的判断基于 C4② 的断言 + 其注释；我实读了 `SessionController.ts:159-167` 与 `State.ts:20-26`）。
5. **本报告的行号一律以真实工作树（= 冻结补丁应用后）为准**；对 `Telemetry.ts`（切片内被修改）引用的是**收窄后的新行号**，对 `AgentLoop.ts`/`State.ts`/`SessionController.ts`/`EVENT-SPEC.md` 等**未改动文件**引用的是 HEAD 行号。
6. 本报告**未**修改 `DSH_RECOVERY_REPORT.md`（按卡面要求未触碰）。
