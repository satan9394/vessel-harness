# C7b 修正工作证明（按 C7 阻断项 A/B）

- 执行器：隔离子代理（C7b），2026-09-13
- 仓库：`C:\work\Vessel_Harness`，分支 `main`，HEAD `ba173d4788fe02deceb78f077c10be1053ad559f`（未 commit、未 add、未 stash/restore/checkout/clean、未删除文件、未 install）
- 任务卡：`tasks/C7b-fix-per-review.md`；评审依据：`evidence/C7-review-verdict.md`

## 1. 逐处改前/改后对照

### ① `packages/telemetry/src/Telemetry.ts:183-186`（权威处，**只改类注释**）

改前：

```
 * **本节的三条依据都只在「单一、无重叠、无不可重试错误」的回合上成立**（即：回合数 = 记录条数
 * = `before_turn` 事件数；两侧的工具调用数相等；实时与纯回放同数）。上一版把它们写成了无条件
 * 形式 —— 依据比实现能做到的强，独立对抗验收正是据此判 FAIL。每条下面都**显式登记**它自己的
 * 反例与机制；改这里的人**不得**把条件去掉。
```

改后：

```
 * **本节的三条依据都只在「成功收尾的回合」上成立**（即收尾路径非异常抛出地走到落盘：回合数 =
 * 记录条数 = `before_turn` 事件数；两侧的工具调用数相等；实时与纯回放同数）。… 收窄用的条件
 * 「单一、无重叠、无不可重试错误」**装不下实现里真实的第三条反例路径** —— `AgentLoop.ts:636` 的
 * 判据是 `const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);`，它为假**有两条
 * 来源**：① 错误类别不可重试；② **错误类别可重试但重试预算耗尽**（`attempt > maxRetries`）。
 * **两者都**走 `AgentLoop.ts:649-651` 的 `throw` ⇒ `:451-464` 的 `else { throw err; }`（`:462-463`）
 * ⇒ `:528` 的 `turn/end` **永不落盘**，而 `:208-212` 的 `before_turn` 已发、`:282` 的 `turn/start`
 * 已写 ⇒ 该回合有始无终。**两条都有本仓既有测试在真实触发**：`AgentLoop.llm-retry-record.test.ts:
 * 280/281/288/295`（`rate limit 429` = `RATE_LIMITED` 可重试 + `maxRetries:1`）与
 * `AgentLoop.stream.test.ts:385/388/390/392`（同形）。… 改这里的人**不得**把条件改回窄口径或去掉。
```

另同文件两处（`:202-211`、`:216-218`）：反例段由「provider 抛不可重试错误」的行文改为「同一闸门，**两条来源并列登记**」，并挂上判别性用例指针（① `turnEndBoundary.test.ts` 第 1 条 / ② `telemetry.test.ts` ⑱）。

### ② `packages/telemetry/src/telemetry.test.ts:76-81`（文件头 BRIEF）

- 改前：`这三条**只在「单一、无重叠、无不可重试错误」的回合上成立**` + 结尾「为它们补判别性用例是**另一次改动**，不在本卡的授权范围内」（C7 §4 号残余③，已过时）。
- 改后：`这三条**只在"成功收尾的回合"上成立**`，并加一段「为什么不能写成窄口径」（`:636` 两条来源 / `:649-651` / `:462-463` / `:528` + 两个既有测试文件的行号），末段改为「判别性用例：不可重试类别见 `turnEndBoundary.test.ts` 第 1 条，**预算耗尽见本文件 ⑱**」。

### ③ `docs/ARCHITECTURE.md`

- `:176`：异常路径反例行由「provider 抛不可重试错误时…」扩写为**两条同闸门来源**（① `:70` 的 `MODEL_RETRYABLE` 之外；② 类别可重试但 `attempt > maxRetries`），并列明两者都走 `:649-651` → `:462-463` → `:528` 不落盘，并注明「② 在本仓既有测试里已被真实触发」。原有的「除已登记例外…」收窄措辞保留。
- `:372`（§4.11）：`**在单一、无重叠、无不可重试错误的回合上**恰好计一次` → `**在成功收尾的回合上**恰好计一次 —— … 已登记**两条并列反例**（都走 AgentLoop.ts:462-463 …）：① 错误类别不可重试、② **重试预算耗尽**（`AgentLoop.ts:636` 的 `retryable` 为假的第二个来源…）；另加回合重叠…`。

### ④ `docs/product-evolution/PRODUCT-STATE.md:823`

- 改前：`只在**「单一、无重叠、无不可重试错误」的回合**上可信（反例与机制见 Telemetry.ts 类注释）`
- 改后：`只在**"成功收尾的回合"**上可信（两条并列反例同走 AgentLoop.ts:462-463 …：① 错误类别不可重试、② **重试预算耗尽**…；另加回合重叠…）`

### ⑤ `docs/BENCHMARK-SPEC.md:575/576`（核对两行）

- `:575`（M02）：原本已是正确的「**在成功收尾的回合上**」；C7b 仅把反例说明由「provider 抛不可重试错误」扩为**两条并列来源**（① 不可重试类别 + ② 预算耗尽），保留 `AgentLoop.ts:462-463` 引用。
- `:576`（M03）：原本是窄口径「在"单一、无重叠、无不可重试错误"的回合上」→ 改为「**在"成功收尾且未被另一个 `runTurn` 重叠"的回合上**」，并给出**三条并列反例**（①② 记录缺失 / ③ 回合重叠读到新回合计数器）。⇒ 与 M02 行措辞同母题，且把 C7 指出的漏网路径登记进去。

### ⑥ `docs/EVENT-SPEC.md:605`（跨文档矛盾，见 §4）

`…全部配对且编号连续；任一缺失 = 日志腐败（H12 invariant_selfcheck 捕获）。`
→ `…全部配对且编号连续；**除已登记例外**，任一缺失 = 日志腐败（H12 invariant_selfcheck 捕获）。**已登记例外（不判腐败）**与收窄口径同 docs/ARCHITECTURE.md:176，共三条…① …（**两条来源**：错误类别不可重试，**或**类别可重试但重试预算耗尽 `attempt > maxRetries`；两条都经 `:462-463` 的 `throw err` 使 `:528` 不落盘，PRODUCT-GAP-MAP.md:430）；② …:431；③ …:446。…`

### ⑦ `tasks/120-turn-end-telemetry-slice.md`（新增 §11，登记本轮对 §5-③ 声明"未改 EVENT-SPEC"的推翻）

不改任何既有勾选状态，只在文末追加 §11 / §11.1，如实登记 C7b 三项修正与此前声明的偏差。

## 2. 新增用例 ⑱（预算耗尽路径）

位置：`packages/telemetry/src/telemetry.test.ts`，紧跟 ⑰ 之后（既有断言行号 ⑯`:740-752` / ⑰`:787-806` 未受影响，⑱ 追加在文件尾）。

核心断言（与既有测试同构，但走另一机制）：

```ts
const provider = new ScriptedProvider(() => new Error('rate limit 429')); // RATE_LIMITED = 可重试类别
const loop = new AgentLoop({ …, llmRetry: { maxRetries: 1 } });           // 预算耗尽 = attempt(2) > 1
await expect(loop.runTurn('boom')).rejects.toThrow(/Model call failed after 2 attempt/);
expect(retryRecords.map((r) => r.decision)).toEqual(['retry', 'abort']);
expect(retryRecords.map((r) => r.kind)).toEqual(['RATE_LIMITED', 'RATE_LIMITED']); // 负对照：类别可重试
expect(retryRecords[1]!.attemptNo).toBe(2);
expect(ends).toHaveLength(0);              // :528 永不落盘
expect(beforeTurnEvents).toHaveLength(1);  // :208-212 已发
expect(live.turns).toBe(1);
expect(replay.turns).toBe(0);
expect(replay.turns).not.toBe(live.turns);
```

**判别性论证（哪条断言先红）**

1. 实现改成"总能收尾"（`:462-463` 的 `throw err;` 换成赋 `kind` 后继续走到 `:528`）⇒ `runTurn` 由 rejects 变 resolve ⇒ **首条 `rejects.toThrow(...)` 先红**（`throw err` 契约被破坏；与 C5b 变异 A 同款，C5b 实测红在对应断言）。
2. 只补一条 `turn/end` 而保留 rethrow（C5b 变异 B 的最小变体）⇒ `expect(ends).toHaveLength(0)` 先红，随后 `replay.turns` 由 0 变 1 ⇒ `toBe(0)` 与 `not.toBe(live.turns)` 相继红。
3. 文档**条件被改回窄口径**而不动代码 ⇒ 本用例与 `turnEndBoundary.test.ts` 第 1 条仍全绿 —— 但对窄口径的证伪靠的是**两条用例并存**（一条走"类别不可重试"、一条走"预算耗尽"）+ `Telemetry.ts` 类注释里并列登记的两类反例；删掉任一条，窄口径就又失去见证。
4. 负对照：若有人把 `RATE_LIMITED` 移出 `MODEL_RETRYABLE`，`kind` 断言先红 ⇒ 保证本用例**确实**走"类别可重试 + 预算耗尽"，不是第 1 条用例的复制。

机制与既有测试交叉印证（读原文核对，未改这些测试）：`AgentLoop.llm-retry-record.test.ts:280`（`rate limit 429`）/`:281`（`maxRetries: 1`）/`:288`（`rejects … after 2 attempt`）/`:293`（`attemptNo` = `[1,2]`）/`:294`（`decision` = `['retry','abort']`）/`:295`（`kind` = `['RATE_LIMITED','RATE_LIMITED']`）⇒ 第 1 次真的重试了、第 2 次 abort **只可能**因为 `attempt(2) <= maxRetries(1)` 为假，即预算耗尽。

## 3. 定向 vitest 输出与退出码

```
cd C:\work\Vessel_Harness
npx vitest run packages/telemetry --reporter=verbose
```

```
 ✓ packages/telemetry/src/auditRecordWiring.test.ts (7)
 ✓ packages/telemetry/src/turnEndBoundary.test.ts (2)
 ✓ packages/telemetry/src/telemetry.test.ts > … > ⑯ M02/M03 纯回放（成功单回合）…
 ✓ packages/telemetry/src/telemetry.test.ts > … > ⑰ 防重复计数 + 成功单回合两侧同数…
 ✓ packages/telemetry/src/telemetry.test.ts > … > ⑱ 预算耗尽路径（类别可重试 RATE_LIMITED + maxRetries:1）：before_turn 已发而 turn/end 记录数 0 ⇒ live.turns ≠ replay.turns

 Test Files  3 passed (3)
      Tests  28 passed (28)          # 基线 27 + 新增 ⑱ = 28
   Duration  1.56s
=== VITEST EXIT CODE = 0 ===
=== log bytes = 6758 ===
```

类型面（不写盘，避免污染被跟踪产物）：

```
npx tsc --noEmit -p packages/telemetry/tsconfig.json --pretty false
=== TSC(telemetry, --noEmit) EXIT CODE = 0 ===
```

定向 vitest 本卡用量：**1 次**（额度 ≤2，余 1 次留作最终复评）。未跑 `test:all`。

## 4. `EVENT-SPEC.md` 的处置方式与理由

**处置：就地纯文档收窄（未越"纯文档"范畴，不改为"仅登记"分支）。** 理由三条：

1. **不改任何运行行为/字段语义/契约语义**：`git grep -n "invariant_selfcheck\|selfCheck" -- "*.ts"` 在 `packages/**` 与 `apps/**` **0 命中**（`exit 1`）⇒ H12 invariant 自检**在本仓尚未实现**，`:605` 是对**未来组件**的描述性规格；收窄只是把实现**已经产生**的已登记例外（`PRODUCT-GAP-MAP.md:430/:431/:446` 早已记录、且 `:430` 就是异常路径）写进规格，未新增/删除任何例外语义。
2. **消除了 C7 阻断项 B 的互否**：改后 `EVENT-SPEC.md:605` 与 `ARCHITECTURE.md:176` 同口径（"成功收尾 + 已登记例外 + 例外清单指针"），并把漏网的**第二条来源（预算耗尽）**一并登记。
3. **无守卫被削弱**：本仓不存在以 `:605` 字面为判据的测试（无 invariant 自检实现、无 ⑤ 类文档⇄代码绑定覆盖该行）⇒ 收窄不会让任何既有断言变绿/变红；本卡也未删除任何判据。

## 5. `git status --short` 与 `git diff --numstat`

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
# 11 项 = 既有 10 项 + 本卡新增的 docs/EVENT-SPEC.md 改动（1 项）；暂存区空；HEAD 仍 ba173d4

$ git diff --numstat
2	2	docs/ARCHITECTURE.md
2	2	docs/BENCHMARK-SPEC.md
1	1	docs/EVENT-SPEC.md
1	1	docs/product-evolution/PRODUCT-STATE.md
10	2	packages/shared/src/unwiredRecords.test.ts
138	12	packages/telemetry/src/Telemetry.ts
264	6	packages/telemetry/src/telemetry.test.ts
```

增量对照（相对 C7 冻结面）：`Telemetry.ts` `122/12 → 138/12`（全在类注释内）、`telemetry.test.ts` `166/6 → 264/6`（新增 ⑱ 与 BRIEF 扩写；**无既有断言被删**）、`ARCHITECTURE.md` `2/2` 不变（行内改写）、`BENCHMARK-SPEC.md` `2/2` 不变、`EVENT-SPEC.md` 新增 `1/1`。运行时源码（非测试）**零新增改动**：上述 `packages/*/src/**` 里的实现行全部是 C1 既有切片（`finalizeRecord` 的 `case 'turn/end':`、`liveTurnIds`、`before_turn` handler），C7b 三次 `Telemetry.ts` 编辑逐字都在类 JSDoc（`export class Telemetry` 之前）内。

## 6. grep 自证

```
$ git grep -n "无不可重试错误" -- docs packages
packages/telemetry/src/Telemetry.ts:186   # 「…装不下实现里真实的第三条反例路径」= 被否定的引述
packages/telemetry/src/telemetry.test.ts:78  # 「为什么不能写成"单一、无重叠、无不可重试错误"」= 负对照
# ⇒ 窄口径不再作为"唯一条件"出现；无任何肯定式残留
```

`成功收尾` 现出现在：`ARCHITECTURE.md`(2)、`BENCHMARK-SPEC.md`(2)、`EVENT-SPEC.md`(1)、`PRODUCT-STATE.md`(1)、`Telemetry.ts`(4)、`telemetry.test.ts`(3)。
`预算耗尽`（反例②）现出现在：`ARCHITECTURE.md`(3)、`BENCHMARK-SPEC.md`(2)、`EVENT-SPEC.md`(3)、`PRODUCT-STATE.md`(1)、`Telemetry.ts`(3)、`telemetry.test.ts`(9)。

## 7. 偏差 / 未完成项（如实）

1. **`tasks/120` 被追加了 §11**（新改动面，已计入 11 项）：C7 阻断项 B 明文要求二选一，本卡选了"同批收窄"，但 §5-③ 曾声明"未改 EVENT-SPEC" ⇒ 按本仓"声明必须与实现一致"的纪律，必须如实登记这处推翻。未改该卡任何既有勾选状态、未改其它卡。
2. **⑱ 未做突变实测**（只做了代码层判别性论证 + 与 `llm-retry-record.test.ts:④′` 的断言逐条交叉印证）：本卡定向 vitest 限 ≤2 次，已用 1 次；余 1 次留给最终复评。C5b 对同族变异（A：改成总能收尾 ⇒ 契约断言先红；B：补落 `turn/end` ⇒ 记录数断言先红）的实测结论可直接迁移，因为 ⑱ 的断言形态与之同构。
3. **C7 §4.3 的其余未覆盖面未处理**（不在本卡授权内，建议后续卡）：② 崩溃合成收尾记录流经 `case 'turn/end'` 的声明无用例；⑤ `stats.steps` 的 mismatch 无见证；⑥ M02/M03 行仍无文档⇄代码守卫；⑦ ⑤ 的反引号词法限制未钉。
4. **`EVENT-SPEC.md:605` 的收窄属"就地改正 + 指向例外清单"**，未改动 `HARNESS-COMPARISON.md:799` / `research/harness-matrix/comparison.md:799` 里同族的 `invariant_selfcheck` 描述行（那两处是**对上游 harness 的转述**，不是本仓契约），故不在本卡收窄范围。
5. 命令文本未含任何永久删除类 API 字面名；未执行 `git add/commit/stash/restore/checkout/clean`、未删除文件、未 install、未改 lockfile、未跑 `test:all`、未调用真实 provider。
