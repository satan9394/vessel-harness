import type {
  MetricId,
  MetricValue,
  ReportLine,
  SessionRecord,
} from '@vessel/shared';
import type { EventBus } from '@vessel/core';
import { EventBus as Bus, Session } from '@vessel/core';

/**
 * M13 判为「评审拒绝」的 verdict 子集 —— 与 `docs/BENCHMARK-SPEC.md` §4.1 M13 行逐字同词表
 * （四个 verdict 里除去 `met` 的三个：`not_met` / `impossible` / `error`）。
 * 单一实现：`attach()` 的 `team_end` handler 用它过滤（`telemetry.test.ts` ⑫ 把三值与规格逐字对钉）。
 */
const EVALUATOR_REJECT_VERDICTS: ReadonlySet<string> = new Set(['not_met', 'impossible', 'error']);

export interface TelemetryCounters {
  turns: number;
  steps: number;
  toolCalls: number;
  retries: number;
  invalidArgs: number;
  denials: number;
  compactions: number;
  evaluatorRejects: number;
  /** M14 的 `approval_asks`：审批询问次数 = `audit/denial` 中 `stage:'approval'` 的条数（见类注释）。 */
  approvalAsks: number;
  /**
   * M14 的 `steers`：`user/message` 记录里 `source === 'steer'` 的条数
   * （`AgentLoop.drainSteers()` 每个 steer 恰好落一条；回放折叠，见类注释）。
   */
  steers: number;
  /**
   * M14 的 `interrupts`：**事件** `after_turn{kind:'interrupted'}` 的条数。
   * 刻意**不**取同形的 `turn/end{kind:'interrupted'}` 记录（理由见类注释「M14 steers / interrupts 的接线」）
   * ⇒ 它只在挂了总线的进程里可观测（`composeHarness` 一律 attach），纯回放如实为 0。
   */
  interrupts: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * telemetry — event subscriber (emit bypass, ARCHITECTURE §4.11).
 * Computes BENCHMARK-SPEC M02–M14 (subset available offline) from bus events +
 * session replay; exports JSONL report lines (§4.2 format).
 *
 * 回放面（`finalize` → `finalizeRecord`）**已消费**的记录类型 = `tool/result`（M04）、
 * `audit/denial`（M12 + M14 的 approval 子集）、`compaction/start`（M09）、`llm/retry`（M05，B13）、
 * `turn/end`（**仅**回合身份与 `stats.toolCalls`，M02/M03——见下面的「B09 `turn/end` 记录的接线」）、
 * `user/message`（**仅** `source:'steer'`，M14 的 `steers` 分项——见下面的「M14 steers / interrupts 的接线」）。
 * 这一集合与 `docs/ARCHITECTURE.md` §4.11 表格那一行**双向绑定**，由 `telemetry.test.ts`
 * 的文档⇄代码守用例钉住（文档多写一个 ⇒ 红；代码多一个分支没写进文档 ⇒ 也红）。
 *
 * M14 `approvalAsks` 的生产者（本卡接线；此前**无任何 `+1` 的地方**，指标恒 0 却仍被
 * `benchmarks/scenarios/*.yaml` 列为 `measured`）：
 *
 * 真实通路 = **`before_tool` 的 `ask` 裁决**，三处逐条可查：
 *  ① `packages/policy/src/engine/Engine.ts` 决策序第 ④/⑥ 步：`ask` 规则命中、或 profile
 *     要求而 `approval !== 'never'` ⇒ 返回 `{action:'ask'}`（`approval: 'ask'` 由 policy yaml /
 *     sessionOverrides 配置得出，默认 `never` 时该分支走 deny，不产 ask）；
 *  ② `packages/core/src/events/EventBus.ts` 的 waterfall 也可铸出 `{kind:'ask'}`
 *     （`listenerErrorPolicy:'ask'`、guard 收窄）；
 *  ③ `packages/core/src/agent-loop/AgentLoop.ts` 的 `gate.result.kind === 'ask'` 分支：
 *     v0.1 无应答者链 ⇒ 服务内 fail-closed，**落 `audit/denial`（`stage:'approval'`）** 并 emit
 *     `policy_decision`(verdict `'deny'`)，一个 ask 恰好一条记录。
 *     可达性有既有用例钉住：`AgentLoop.denial-breaker.test.ts` 用例⑧。
 *
 * 为什么**只从回放记录计**、且**不照抄 `denials` 的加法**（这是本卡读清后作出的取舍）：
 *  - 仓里**没有** `approval/asked`(B17)/`approval/decided`(B18) 记录类型，也没有 A16/A17 事件，
 *    更没有 `ctx.approval`/应答者链（`docs/EVENT-SPEC.md`、`POLICY-SPEC.md` 只描述了它们）——
 *    所以「ask」**没有独立的第二份证据**。那条 `policy_decision` 事件的 `verdict` 逐字是
 *    `'deny'`（`AgentLoop.recordDenial`），**它就是那次拒绝本身**：按 `denials` 的加法把它也
 *    记进 M14，等于让同一个事实既充当 M12 又充当 M14，且一次 ask 报成 2。
 *  - 记账法在仓里是**已知的、消费方要绕开的**语义（`denials` 测试注释逐字写着 "1 from event +
 *    1 from replay record"，`benchmarks/runners/src/contracts/vessel.ts` 用 `Math.max` 绕开）。
 *    新指标不继承它：`llm/retry` 那张卡已经为「新增计数」定下方向（同一事实只计一次）。
 *  - 但**不去重也不行**：M05 能按 `requestId#attemptNo` 去重，是因为两侧共享一个**全局唯一** id；
 *    ask 的两侧只有 `toolCallId`，而它**不唯一**（`toolCallId` 逐字来自 provider，`MockProvider`
 *    每次响应都从 `tc_mock_1` 重新编号）⇒ 用它当身份会把不同步/不同轮的两个 ask 静默并成一个
 *    **少计**（`countRetry` 注释明令"绝不静默少计"）。
 *  - 结论：M14 取**唯一不留歧义的那一面**——append-only 日志里 `stage:'approval'` 的
 *    `audit/denial` 条数（一个 ask 恰好一条，无需 dedupe）。这与 M04(`invalidArgs`)、M09
 *    (`compactions`) 同为"只由回放记录计数"的既有形态；生产消费方一律先 `finalize(session)`
 *    再读 `metrics()`（`benchmarks/runners/src/runner.ts`、`contracts/vessel.ts`），故无缺口。
 *  - **不得**在无此记录时伪造数值：`approval: 'never'` 的运行里 Engine 直接走 deny
 *    （`decisionPath` 带 `approval:never`、stage 仍 `'rule'`），M14 如实为 0。
 *
 * M14 `steers` / `interrupts` 的接线（本卡；此前二者在 `metrics().detail` 里**硬编码 0**，
 * 而它们在本仓**都有真实生产者**——"有产者、无消者"落在指标 detail 层）：
 *
 * `steers` = `user/message` 记录里 `source === 'steer'` 的条数。生产者唯一且已交付：
 * `packages/core/src/agent-loop/AgentLoop.ts` 的 `drainSteers()`（步边界消费 `SteeringQueue`，
 * 每个 steer 恰好 `appendSync` 一条 `user/message{source:'steer', surface:true}`）。
 * 这条事实**只有记录面**（`drainSteers` 不发任何事件）⇒ 取记录，与 `approval_asks` 同为
 * "只由 append-only 日志计数"，一个 steer 一条记录、无需 dedupe。判据层另有 `steer_seen`
 * 断言读同一个面（`benchmarks/runners/src/asserts.ts`）。
 *
 * `interrupts` = **事件** `after_turn{kind:'interrupted'}` 的条数。为什么取事件而不是记录
 * （这是本卡读清职责后作出的取舍，不是随手挑一侧）：
 *  ① 同一事实在仓里**两侧都有**（`turn/end{kind:'interrupted'}` 记录 + `after_turn` 事件，
 *     `AgentLoop.runTurnInner` 每次真实收尾各铸一份）⇒ 照 M05 `llm/retry` 那套"同一事实只计
 *     一次"的规矩，**必须选一侧**，绝不能相加（相加即双计——`denials` 的既有加法语义正是
 *     消费方要 `Math.max` 绕开的那种）。
 *  ② 记录侧**不是**这个事实：`packages/core/src/session/Session.ts` 的 `loadExisting()` 会为
 *     "上一次没闭合的回合"**合成**一条同形的 `turn/end{kind:'interrupted'}`（崩溃/中断恢复的
 *     收尾）⇒ 按记录计会把"进程崩过"报成"有人按了停机键"，是**假阳性**的 `interrupts`。
 *     事件侧只在真实回合收尾时由 `AgentLoop` 发出，合成记录不发事件。
 *  ③ `turn/end` 记录**本身**现在已被消费（`finalizeRecord` 的 `case 'turn/end':`，见下面
 *     「B09 `turn/end` 记录的接线」），但取的是**回合身份与 `stats.toolCalls`**，与 `kind` 无关：
 *     `interrupts` 仍然只取事件面 —— 记录侧会把崩溃恢复（`Session.loadExisting` 为未闭合回合
 *     **合成**的那条同形记录）误报成"有人按了停机键"，是**假阳性**。给记录侧加一条
 *     `kind === 'interrupted'` 的判据也救不了：合成记录与真实收尾在文件里同形，不可判别。
 *  ⇒ 代价如实写出：`interrupts` **只在挂了总线的进程里可观测**（`composeHarness` 一律
 *  `telemetry.attach(bus)`，`benchmarks/runners/src/runner.ts` 与 `contracts/vessel.ts` 的消费方
 *  都先 attach 再 `finalize`），纯回放（未 attach）时如实为 0；`telemetry.test.ts` ⑭ 把这个
 *  边界钉成可判别事实 —— 绝不为"回放也好看"去让记录面冒充人工打断。
 *
 * M14 detail 里**无通路**的两项（本卡如实标注，不再用 0 冒充计数）：
 *  - `human_answers`：语义 = 审批/询问**由人**应答。本仓没有应答者链（`before_tool` 的 `ask`
 *    一律 fail-closed 收口成上面的 `approval_asks`），没有 A16/A17 事件、没有 B17/B18 记录类型
 *    ⇒ 这条通路**不存在**（不是"测到 0 次"）；
 *  - `machine_answers`：语义 = 由机器应答；同样没有应答面。
 *  ⇒ 二者在 detail 里取 `null`（"本车道不可判定"，与 `RunResultMetrics.resumeSuccess = null`
 *    同一惯例；`MetricValue.detail` 是 `Record<string, unknown>`，见 `packages/shared/src/metrics.ts`），
 *    并把字段名列进 `detail.unwired`。写 0 会让读报告的人以为"跑过、测到 0 次"。
 *  将来真做出应答者链/A16/A17 时，请一并改本节、`docs/BENCHMARK-SPEC.md` §4.1 的 M14 行
 *  与 `telemetry.test.ts` ⑮（那三条断言会先红，正是本卡留的绊线）。
 *
 * 本卡**不动** M14 的 `value` 与 `source`：`value` 仍 = `approval_asks`（`docs/BENCHMARK-SPEC.md`
 * §4.1 的 M14 行对本 lane 的口径就是它），`source` 仍 = `audit/denial:approval`（它点名 **value**
 * 的生产者；`steers`/`interrupts` 是 detail 分项，各自的来源写在上面与本文件 ⑬⑭）。
 * 把分项并进 `value` 是**口径变更**（会改历史可比性），不在本卡范围。
 *
 * M13 `evaluatorRejects` 的生产者（本卡接线；此前 `recordEvaluatorReject()` **全仓唯一命中是它的定义**，
 * 指标恒 0，却被 `benchmarks/runners/src/asserts.ts` 的 `metricValue('M13')` 读走、被
 * `docs/BENCHMARK-SPEC.md` 的 M13 行列为被测量）：
 *
 * 「评估器拒绝」在本仓有**三处**真实通路，逐条给位置与**可观测性**：
 *  ① `packages/agents/src/team/TeamRuntime.ts` 的 evaluate 阶段成员：产出按 review JSON schema 解析为
 *     `TeamReviewConclusion`（`review.verdict ∈ {met, not_met, impossible, error}`），随 **`team_end`
 *     事件载荷**的 `members[].review` 一起对外 ⇒ **总线可观测**。生产侧由
 *     `packages/agents/src/team/team-end-review-verdict.test.ts` 钉住（断言真实跑出的 `team_end`
 *     载荷里确有 `review.verdict`）。
 *  ② `packages/agents/src/evaluator/EvaluatorAgent.ts` 的 `evaluate()`：verdict 只**返回给调用方**；
 *     总线上只有 A23/A24（`subagent_start`/`subagent_stop`），而 A24 载荷 `{output, stopReason, isError}`
 *     **不含 verdict** —— `not_met` 且回合正常结束时 `isError=false`、`stopReason='completed'`，与 `met`
 *     逐字同形 ⇒ **总线上不可观测**。该载荷形状另有既有用例钉死（`evaluator-agent.test.ts` 断言
 *     `Object.keys(result)` 恰好是 `['output','stopReason']`），本仓不为凑指标去改它。
 *     **但它不是"没有产者"**：调用方拿得到返回值，而 `benchmarks/runners/src/runner.ts` 的
 *     evaluator 臂正是这样一个调用方 —— 它把该 verdict 用**类型化调用**送进本类的
 *     `recordEvaluatorReject()`（见下面的「两条来源」），这条通路是**已交付**的。
 *  ③ `packages/engine/src/real-evaluator-adapter.ts`（LoopEngine 的 Evaluator seam）：verdict 只在引擎
 *     内部消费，既不 emit 也不落 Session 记录，**也没有任何调用方把它转交出去** ⇒ **不可观测**。
 * 故 M13 的取值面 = ①（`team_end` 载荷）+ ②的一个调用方（基准/CLI 的 evaluator 臂）；③ 无面可消费，
 * 硬凑（解析 runner 回投的 `user/message` 自由文本、或按 `subagent_stop.isError` 近似）会引入假阳性
 * 或静默少计 —— 判据层绝不允许。
 * 因此 M13 **仍不覆盖 Goal Loop 的 evaluator 拒绝**（③ 那条），`BENCHMARK-SPEC` 的 M13 行已把这条边界写清。
 *
 * 为什么 M13 取**加法**、不做身份去重（照 M14 那套"先读清职责再取舍"）：
 *  - M13 有**两条**来源（`team_end` handler 与基准 evaluator 臂的直接调用），但它们观测的是
 *    **不同 run** 上的同一个事实：一条 `team_end` 载荷里的每个拒绝成员恰好由 handler 计一次，
 *    基准 evaluator 臂的裁决**不经** `team_end`（不经 TeamRuntime）⇒ 同一事实不可能被两侧各计一次，
 *    不存在 M05 那种"事件与记录同源、相加即双计"的问题，所以不需要 M05 那套身份去重；
 *  - 也**不能**拿不唯一的 key 去重：成员摘要的 `presetId`/`role` 都不唯一（两个 evaluate 成员可以同名
 *    同角色），用它去重会把两次真实评审静默并成一次 ⇒ **少计**；
 *  - 计数口径 = 一次 `team_end` 载荷里 `review.verdict ∈ {not_met, impossible, error}` 的成员数
 *    （`met` 不是拒绝；不带 `review` 的成员不是评审成员），外加基准 evaluator 臂每次拒绝裁决一次。
 *    `TeamRuntime.runTeam` 的 `finally` 只 emit 一次 `team_end`，故按事件逐次计数与既有
 *    `turns`/`toolCalls` 的加法口径一致。
 *  - 文档⇄代码（本卡一并更正）：`docs/ARCHITECTURE.md` §4.11 的 telemetry 行**已**把 `team_end`
 *    列进实时事件消费清单。它原先只把 M13 的生产者写成 `team_end`（暗示唯一），与本节上面
 *    "两条来源"的读码结论不符 —— 该文件的这一格随本卡一起改成"两条来源"，由
 *    `telemetry.test.ts` ⑤（消费记录族双向绑定）与 ⑫（M13 文档⇄代码）继续守着。
 *
 * B09 `turn/end` 记录的接线（本卡；改前 §4.11 把这条记录整条列为"未消费"，
 * `finalizeRecord` 没有它的分支 ⇒ **纯回放**的 M02/M03 恒 0，而日志里明明写着跑了几个回合、
 * 发了几个工具调用）：
 *
 * 取的是**回合身份 + `stats.toolCalls`**，不是整条记录 —— 逐字段读清后的取舍。
 *
 * **本节的三条依据都只在「成功收尾的回合」上成立**（即收尾路径非异常抛出地走到落盘：回合数 =
 * 记录条数 = `before_turn` 事件数；两侧的工具调用数相等；实时与纯回放同数）。上一版把它们写成了
 * 无条件形式 —— 依据比实现能做到的强，独立对抗验收正是据此判 FAIL。C7 独立重评又指出：其后
 * 收窄用的条件「单一、无重叠、无不可重试错误」**装不下实现里真实的第三条反例路径** ——
 * `AgentLoop.ts:636` 的判据是 `const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);`，
 * 它为假**有两条来源**：① 错误类别不可重试（`MODEL_RETRYABLE` 之外）；② **错误类别可重试但重试
 * 预算耗尽**（`attempt > maxRetries`）。**两者都**走 `AgentLoop.ts:649-651` 的 `throw` ⇒
 * `:451-464` 的 `else { throw err; }`（`:462-463`）⇒ `:528` 的 `turn/end` **永不落盘**，而
 * `:208-212` 的 `before_turn` 已发、`:282` 的 `turn/start` 已写 ⇒ 该回合有始无终。
 * **两条都有本仓既有测试在真实触发**（只落 `llm/retry{decision:'abort'}` 记录 + rejects，从未断言
 * 记录面后果）：`AgentLoop.llm-retry-record.test.ts:280/281/288/295`（`rate limit 429` =
 * `RATE_LIMITED` 可重试 + `maxRetries:1`）与 `AgentLoop.stream.test.ts:385/388/390/392`（同形）。
 * 故以「成功收尾」为条件并**并列登记这两类反例**；每条下面都**显式登记**它自己的反例与机制；
 * 改这里的人**不得**把条件改回窄口径或去掉（窄口径 = 把②当成立，正是 C7 判决 FAIL 的阻断项 A）。
 *
 *  - `turnId` → M02 `turns`：`turn/start→turn/end` 在 `docs/ARCHITECTURE.md` §4.11 的不变式里
 *    1:1 配对（`Session.loadExisting` 连崩溃回合都会补一条合成收尾）⇒ **在成功收尾的回合上**
 *    "记录条数 = 回合数"与 `before_turn` 事件数相等（`before_turn` 是所有分支——含 BeforeTurn
 *    否决——的共同起点）。
 *    **反例（同一闸门，两条来源并列登记；无并发；独立验收实测 `live.turns = 1` 而
 *    `replay.turns = 0`）**：单回合里 `AgentLoop.ts:636` 的 `retryable` 为假时，无论①错误类别
 *    不可重试（`MODEL_RETRYABLE` 之外）**还是②类别可重试而重试预算耗尽**（`attempt > maxRetries`，
 *    取小 `maxRetries` 即可触发），都经 `AgentLoop.ts:649-651` 抛出 ⇒ `:451-464` 的
 *    `else { throw err; }`（`:462-463`）把异常直接抛出 `runTurnInner` ⇒ `AgentLoop.ts:528` 的
 *    `turn/end` 在该回合**永不写入**，而 `AgentLoop.ts:208-212` 的 `before_turn` 已经发过、
 *    `:282` 的 `turn/start` 已写 ⇒ 纯回放读不到这一轮的记录（记录面缺一条，不是"测得 0 个回合"）。
 *    **判别性用例**：① 见 `turnEndBoundary.test.ts` 第 1 条（UNKNOWN 类别，默认 `maxRetries`）；
 *    ② 见 `telemetry.test.ts` ⑱（`RATE_LIMITED` 可重试类别 + `maxRetries:1`，走的就是
 *    `AgentLoop.llm-retry-record.test.ts:280-295` 那条既有路径）。
 *    本仓自己早就记过这条：`docs/product-evolution/PRODUCT-GAP-MAP.md:430`（"异常路径不落
 *    `turn/end`"，定级：中；该行引的 `AgentLoop.ts:369` 是漂移前的行号）。
 *  - `stats.toolCalls` → M03 `toolCalls`：该字段是 `LoopState` **每轮归零**（`beginTurn`）后
 *    `recordToolCall()` 的计数，而 `recordToolCall()` 在 `AgentLoop` 的派发循环里**恰好每个调用一次**，
 *    且 `dispatchToolCall` 的**每条 return 路径都恰好发一次 `after_tool`**（deny / ask / 被中断 /
 *    正常收尾四个 emit 点）。由此得到的等式"**该轮有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数
 *    == `stats.toolCalls`**"只在"该轮没有被另一个 `runTurn` 重叠打断"时成立 —— 原论证链
 *    "不发 `after_tool` 就 rethrow ⇒ 不留 `turn/end`"只覆盖了单回合，不覆盖重叠。
 *    **反例（回合重叠 + 工具 signal-blind；独立验收实测：该轮有 `turn/end`、`after_tool` = 1，
 *    而记录里的 `stats.toolCalls` = 0）**：`AgentLoop.ts:136` 的 `state` 是**每 loop 单实例**，
 *    而 `beginTurn`（`packages/core/src/state/State.ts:20-26`）把它归零 ⇒ 旧回合落盘时读到的是
 *    **新回合**的计数器；重叠本身是**受支持路径** ——
 *    `packages/application/src/session/SessionController.ts:159-167` 的注释明文写着"在旧回合还在
 *    跑时调 `runTurn` 会 abort 掉那个旧回合"。⇒ M03 在这类路径上的记录侧取值**不可信**
 *    （本卡只标"不可信"，不发明新口径）。
 *  - **去重（防双计）**：`turn/end` 与 `before_turn`/`after_tool` 是**同一个回合的两面**
 *    （身份 = `turnId`，见 `liveTurnIds`）⇒ 实时已观测过这一轮时记录侧一律不加，纯回放（未 attach）
 *    时才按记录补 ⇒ **在回合都成功收尾时**"实时跑一遍 + `finalize`"与"同一份日志纯回放"
 *    给出相同的数（M05 `llm/retry` 那套规矩）。`telemetry.test.ts` ⑯⑰ 只在**成功单回合**上
 *    钉这一段（条件写进了用例名）。
 *    **该等式同样不是无条件的**：上面第一条反例的**两条来源**（不可重试类别 / 可重试但预算耗尽）
 *    里，`before_turn` 发过而 `turn/end` 根本不存在 ⇒ 实时侧计了这一轮、纯回放侧没有可折算的
 *    记录 ⇒ 两侧的数不同。这不是去重失效，是记录面缺一条。
 *    边界（如实写出，不假装守得住）：去重判据是"这一轮发过 `before_turn` 且被本实例听到"，
 *    它假定 `attach` 在**回合开始之前**完成 —— 本仓唯一的组合根 `composeHarness` 正是构造时
 *    `attach`、`close()` 时才 `detach`（两者都在任何 `runTurn` 之外）。若将来有人在**回合中途**
 *    `attach`，该轮 `before_turn` 没被听到、部分 `after_tool` 却会被实时计入 ⇒ 记录侧再补一次
 *    整轮 `stats.toolCalls` ⇒ `toolCalls` **多计**（`turns` 不受影响：它是身份计数，两侧都不会重复）。
 *  - 边界（如实写出）：`Session.loadExisting` 合成的崩溃收尾记录 `stats` 全零 ⇒ 那一轮计 1 个回合、
 *    **0** 次工具调用（记录里写的就是 0；崩溃时无人汇总，这是下界，不是"测得 0 次"）。
 *
 * **刻意不消费**的其余字段（都已落盘，但照抄会造假——理由不是"以后再说"，是各自的取值面
 * 决定了接上就是假数）：
 *  - `request/header`（B12）：只承载 `estimateTokens`（组装时的**估计值**）与 messages/tools 的
 *    **条数**，没有任何实际 usage ⇒ 喂用量账本（M06/M07/M08）等于拿估计冒充实测；
 *  - `turn/end.stats.steps`：**不能**与 `after_model` 相加、也不能拿来替代它 —— 模型调用被中断时
 *    `beginStep()` 已计这一步、`after_model` 却没发（`consumeStream` 的 catch 只发
 *    `model_stream_end`），于是该轮的 `stats.steps` 会比 `after_model` 条数**多**；
 *    "实时 == 纯回放"在这条边界上不成立，接了就是拿一个对不上的数冒充 M02/M03 那样的实测。
 *    （`toolCalls` 在**这条**边界上没有缺口 —— 模型调用被中断的回合仍正常收尾，`after_tool`
 *    与 `stats.toolCalls` 按同一口径推进；但它在**回合重叠**上有自己的缺口，见上面
 *    `stats.toolCalls` 那条的反例 —— 两者不能互相担保。）
 *  - `turn/end.stats.tokensUsed`/`costEstimate`：`tokensUsed` 是**每轮汇总**（= Σ 每次调用的
 *    input+output），而用量已按 `after_model` 的**每次调用**累加（`recordUsage`）⇒ 相加即双计，
 *    且它无法拆成 M06(input)/M07(output) 两格；`costEstimate` **没有任何 shipped provider 上报**
 *    （M11 的产者在 Cross-Harness 适配器契约里：`docs/BENCHMARK-SPEC.md` §4.1 M11 行与它的欠账
 *    表都逐字写着"本 lane 没有 M11 生产者"）⇒ 接了就是一条恒 0 的假指标。
 *    **措辞边界（不可再退回绝对化）**：**不能**说"全仓没有铸造点" ——
 *    `packages/core/src/agent-loop/AgentLoop.log-evidence.test.ts` 的 `:48/:51` 里，测试 provider
 *    就上报 `costEstimate` 并断言它落进 `turn/end.stats`（测试 provider 同样是铸造点）；
 *    也**不能**说"本仓没有对应指标定义" —— `packages/shared/src/metrics.ts:7` 的 `MetricId`
 *    明确含 `M11`。成立的只是"没有任何 **shipped** provider 上报它"。
 *  - `turn/end.toolCallsWithoutEnd`：流末兜底收尾的完整性信号，同样没有指标定义。
 *    将来要接这几个字段，必须同时改本节、§4.11 表格与 `telemetry.test.ts` ⑤。
 */
export class Telemetry {
  private counters: TelemetryCounters = {
    turns: 0, steps: 0, toolCalls: 0, retries: 0, invalidArgs: 0, denials: 0,
    compactions: 0, evaluatorRejects: 0, approvalAsks: 0, steers: 0, interrupts: 0,
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0,
  };

  private unsubs: (() => void)[] = [];

  /**
   * 重试族（`llm_retry` 总线事件 ∪ B13 `llm/retry` 记录）的**事实身份集**。
   *
   * 为什么必须有它：同一个重试决策在运行时**同时**产生一条记录与一个事件
   * （`AgentLoop.callModel`：先 `session.appendSync({ type:'llm/retry', … })`、再
   * `bus.emit('llm_retry', …)`，同一个 attempt 序号、同一次逻辑请求），而 `finalize` 把回放记录
   * 折进**已经**累计过实时事件的计数器 ⇒ 不做身份去重，一次重试会被计两次。
   *
   * 为什么不照抄 `denials` 的规则：`audit/denial` 记录与 `policy_decision`(deny) 事件同样是同一次
   * 拒绝的 1:1 两面（`AgentLoop.recordDenial`），而既有用例把"两路相加 = 2"**钉死**了
   * （`telemetry.test.ts` 的 `denials=2`，注释逐字写着"1 from event + 1 from replay record"），
   * 消费方只能自己绕开（`benchmarks/runners/src/contracts/vessel.ts` 用
   * `Math.max(records, counters.denials)`）——那是既有记录的语义，**本卡不得改动**（负对照③⑤）。
   * 因此 M05 这一族采取身份去重：事件与记录同时存在时**恰好计一次**，且实时跑与纯回放给出同一个数。
   *
   * 身份 = `requestId#attemptNo`，两侧同源：EVENT-SPEC §5.C A09 的既定约定
   * `requestId = req_<turnId>_step<step>`（`packages/shared/src/events.ts` 的 B13/A09 注记同文），
   * 事件侧由同一模板从载荷 `{turnId, step, attempt}` 复原，记录侧直接用其 `requestId`/`attemptNo`。
   * `turnId` 全局唯一（`turn_<epoch>_<rand>`）⇒ 跨会话不会把两次重试误判成同一事实。
   */
  private retryKeys = new Set<string>();

  /**
   * 回合族（`before_turn` 事件 ∪ B09 `turn/end` 记录）的**事实身份集** —— 与 `retryKeys` 同一套规矩。
   *
   * 为什么必须有它：同一个回合在运行时**两侧都有**（`AgentLoop.runTurnInner` 先发
   * `before_turn`、收尾再落 `turn/end`），而 `finalize` 把回放记录折进**已经**累计过实时事件的
   * 计数器 ⇒ 不做身份去重，一轮会被计两次（M02/M03 翻倍）。
   *
   * 身份 = `turnId`（`turn_<epoch>_<rand>`，全局唯一；`before_turn` 载荷与 `turn/end` 记录同值）。
   * 对比 `denials` 的既有加法语义（事件 + 记录 = 2，用例钉死、消费方 `Math.max` 绕开）：
   * 本族**不继承**它 —— `llm/retry` 那张卡已为"新增计数"定下方向：同一事实只计一次。
   *
   * 事件侧形状不认识（无 `turnId` 的载荷，本仓 `AgentLoop` 一律带）⇒ 照旧"每个事件计一次"、
   * 不进本表，与 `countRetry(null)` 同样**绝不静默少计**。
   *
   * 边界：去重成立的前提是 `attach` 在**回合开始之前**完成（本仓唯一组合根 `composeHarness`
   * 构造时 attach、`close()` 时 detach）—— 回合中途 attach 会让该轮"`before_turn` 没听到、
   * `after_tool` 计到了"，记录侧再补一次整轮汇总 ⇒ `toolCalls` 多计（`turns` 不受影响）。
   */
  private liveTurnIds = new Set<string>();

  attach(bus: Bus): void {
    this.unsubs.push(
      bus.on('before_turn', (p) => {
        // M02 的事件面：每个 `before_turn` 计一次（形状不认识也计，绝不静默少计）；
        // 顺带记下这一轮的**身份**，供回放侧的 `case 'turn/end':` 去重（同一个回合的两面）。
        const { turnId } = (p ?? {}) as { turnId?: unknown };
        if (typeof turnId === 'string' && turnId !== '') this.liveTurnIds.add(turnId);
        this.counters.turns += 1;
      }),
      bus.on('after_model', (_p, _c) => { this.counters.steps += 1; }, 'telemetry:steps'),
      bus.on('after_model', (p) => {
        const payload = p as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } };
        if (payload.usage) {
          this.recordUsage(payload.usage.inputTokens ?? 0, payload.usage.outputTokens ?? 0, payload.usage.cacheReadTokens);
        }
      }, 'telemetry:usage'),
      bus.on('after_tool', () => { this.counters.toolCalls += 1; }, 'telemetry:toolcalls'),
      bus.on('llm_retry', (p) => {
        const { turnId, step, attempt } = (p ?? {}) as { turnId?: unknown; step?: unknown; attempt?: unknown };
        // 身份齐全 ⇒ 按身份去重（与 `llm/retry` 记录同一套 key）；形状不认识（非本仓生产的事件）
        // ⇒ 保持既有"每个事件计一次"，绝不静默少计。
        this.countRetry(
          typeof turnId === 'string' && typeof step === 'number' && typeof attempt === 'number'
            ? `req_${turnId}_step${step}#${attempt}`
            : null,
        );
      }, 'telemetry:retries'),
      bus.on('policy_decision', (p) => {
        const payload = p as { verdict?: string };
        if (payload.verdict === 'deny') this.counters.denials += 1;
      }, 'telemetry:denials'),
      // M14 的 `interrupts`：**事件侧**是这一事实唯一不留歧义的一面（见类注释三条理由）。
      // `turn/end{kind:'interrupted'}` 记录刻意不取：`Session.loadExisting` 会为未闭合回合合成一条
      // 同形记录 ⇒ 按记录计会把崩溃恢复误报成人工打断（`finalizeRecord` 的 `case 'turn/end':` 只取
      // 回合身份与 `stats.toolCalls`，**不读 `kind`**，故 M02/M03 的接线不会让这一项多计）。
      // 形状不认识（无 kind 的载荷）时不计数，也绝不猜。
      bus.on('after_turn', (p) => {
        const payload = (p ?? {}) as { kind?: unknown };
        if (payload.kind === 'interrupted') this.counters.interrupts += 1;
      }, 'telemetry:interrupts'),
      // M13 的**两条**生产来源之一（见类注释「M13 evaluatorRejects 的生产者」）：
      // `team_end` 的逐成员摘要里，evaluate 成员携带 `review`（`TeamReviewConclusion`，
      // `TeamRuntime` 用 `parseReviewConclusion` 从该成员的产出解析）。只认被明确判为拒绝的三个
      // verdict；`met` 不是拒绝，不带 `review` 的成员（generator/orchestrator）根本不是评审结论。
      // 另一条来源不经总线：基准/CLI 的 evaluator 臂（`benchmarks/runners/src/runner.ts`）
      // 拿到 `EvaluatorAgent.evaluate()` 的返回值后直接调用 `recordEvaluatorReject()`。
      bus.on('team_end', (p) => {
        const payload = (p ?? {}) as { members?: readonly { review?: { verdict?: unknown } }[] };
        for (const member of payload.members ?? []) {
          const verdict = member?.review?.verdict;
          if (typeof verdict === 'string' && EVALUATOR_REJECT_VERDICTS.has(verdict)) {
            this.recordEvaluatorReject();
          }
        }
      }, 'telemetry:evaluator-rejects'),
    );
  }

  /**
   * M13 计数入口。生产者有**两条**（见类注释「M13 evaluatorRejects 的生产者」）：
   *   1. `attach()` 的 `team_end` handler —— `team_end` 载荷里 `review.verdict` 为拒绝的
   *      evaluate 成员，一个成员一次；
   *   2. **基准/CLI 的 evaluator 臂**（`benchmarks/runners/src/runner.ts` 的 `driveScenario`
   *      evaluator 分支）—— `EvaluatorAgent.evaluate()` 的返回值喂不进总线（A24 载荷不含
   *      verdict），于是由**调用方**用类型化调用把它送进来，一次拒绝裁决一次。
   *
   * 两条来源观测的是不同 run 上的同一事实，互不重叠（evaluator 臂不经 TeamRuntime ⇒ 不产
   * `team_end`）⇒ 不需要身份去重，加法口径成立。
   *
   * 本方法此前无任何调用方（指标恒 0）。`telemetry.test.ts` ⑫ 钉住"本文件里只有 `team_end`
   * handler 这一处调用"；另外那一条来源住在 runner 侧，不在本文件的扫描面上。
   */
  recordEvaluatorReject(): void {
    this.counters.evaluatorRejects += 1;
  }

  recordUsage(input: number, output: number, cacheRead?: number): void {
    this.counters.inputTokens += input;
    this.counters.outputTokens += output;
    this.counters.cacheReadTokens += (cacheRead ?? 0);
  }

  /**
   * 重试族的**唯一**计数入口（事件与记录共用；见 `retryKeys`）。
   * `identity === null` = 事件形状不认识 ⇒ 退回既有"每个事件计一次"，不参与去重。
   */
  private countRetry(identity: string | null): void {
    if (identity === null) {
      this.counters.retries += 1;
      return;
    }
    if (this.retryKeys.has(identity)) return;
    this.retryKeys.add(identity);
    this.counters.retries += 1;
  }

  finalize(session: Session): TelemetryCounters {
    const replay = session.replay();
    for (const r of replay) {
      this.finalizeRecord(r);
    }
    return { ...this.counters };
  }

  private finalizeRecord(r: SessionRecord): void {
    switch (r.type) {
      case 'tool/result':
        if (r.error?.errorClass === 'INVALID_ARGS') this.counters.invalidArgs += 1;
        break;
      case 'audit/denial':
        this.counters.denials += 1;
        // M14 生产者的**唯一**落点：`stage:'approval'` = AgentLoop 的 ask 分支
        // （Ask 裁决无应答者 ⇒ fail-closed 收口）。见类注释「M14 approvalAsks 的生产者」。
        // 只认这一个 stage：`'rule'`/`'hook'`（拒绝来自规则/监听器）与 `'before_turn'`
        // （输入级否决，无工具锚点）都不是审批询问。
        if (r.stage === 'approval') this.counters.approvalAsks += 1;
        break;
      case 'user/message':
        // M14 的 `steers`：`AgentLoop.drainSteers()` 每个 steer 恰好落一条 `source:'steer'` 记录
        // （该事实**只有记录面**，不存在对应事件），与 `approval_asks` 同为"只由 append-only 日志计数"。
        // 只认这一个 source：`user/message` 还承载输入 / inject / instruction / compacted-summary /
        // plan / memory / handoff（`MESSAGE_SOURCES`），它们都不是"人工干预"。
        if (r.source === 'steer') this.counters.steers += 1;
        break;
      case 'compaction/start':
        this.counters.compactions += 1;
        break;
      case 'llm/retry':
        // B13 记录与 `llm_retry` 事件是**同一个事实**的两面 ⇒ 走同一个身份集去重（见 retryKeys）。
        // 没有这一支时，纯回放（未挂总线）的会话永远报 M05=0：日志说得清"重试了几次"，
        // 指标却看不见——本仓"新造了 X、没人调用 X"落在记录层的实例。
        this.countRetry(`${r.requestId}#${r.attemptNo}`);
        break;
      case 'turn/end':
        // B09 记录的回放面（见类注释「B09 `turn/end` 记录的接线」）。
        // 身份 = `turnId`（与 `before_turn` 载荷同值）：实时已观测过这一轮 ⇒ 该轮的
        // turn/toolCalls 已由 `before_turn`/`after_tool` 事件计过，记录侧**一律不加**（防双计）；
        // 纯回放（未 attach 总线）⇒ 记录是唯一真源，按这一轮的 summary 如实补上。
        // 刻意**不**读 `kind`（`interrupts` 仍只取 `after_turn` 事件面：合成收尾记录会让
        // 崩溃恢复冒充人工打断），也不读 `stats.steps`/`tokensUsed`/`costEstimate`（理由见类注释）。
        if (this.liveTurnIds.has(r.turnId)) break;
        this.counters.turns += 1;
        this.counters.toolCalls += r.stats.toolCalls;
        break;
      default:
        break;
    }
  }

  metrics(extra?: { durationMs?: number; time?: number }): MetricValue[] {
    const c = this.counters;
    // M02/M03 的 `source` 仍是**实时面**的生产者名（照 M05 的既有形态：M05 = `llm_retry` 事件 ∪
    // `llm/retry` 记录，而它的 source 逐字就是事件名 `llm_retry`）。记录面是同一个事实的另一面
    // （不是 M13 那种"两条不同性质的来源"），故不为此改口径；两面逐条写在类注释与
    // `docs/BENCHMARK-SPEC.md` §4.1 的 M02/M03 行里，由 `telemetry.test.ts` ⑤ 守着 §4.11 那一格。
    const out: MetricValue[] = [
      { metric: 'M02', name: 'Turns', value: c.turns, unit: 'turn', source: 'before_turn' },
      { metric: 'M03', name: 'ToolCalls', value: c.toolCalls, unit: 'count', source: 'after_tool' },
      { metric: 'M04', name: 'InvalidToolCalls', value: c.invalidArgs, unit: 'count', source: 'tool/result:INVALID_ARGS' },
      { metric: 'M05', name: 'Retries', value: c.retries, unit: 'count', source: 'llm_retry' },
      { metric: 'M06', name: 'InputTokens', value: c.inputTokens, unit: 'token', source: 'usage-ledger', detail: { cacheRead: c.cacheReadTokens } },
      { metric: 'M07', name: 'OutputTokens', value: c.outputTokens, unit: 'token', source: 'usage-ledger' },
      { metric: 'M09', name: 'Compactions', value: c.compactions, unit: 'count', source: 'compaction/start' },
      { metric: 'M12', name: 'SafetyViolations', value: c.denials, unit: 'count', source: 'audit/denial' },
      // M13 的 `source` 是**中性名**：它点名"被计数的事实"（评估器评审的 verdict），
      // 而不是某一条传输面。改前这里写着 `'team_end:review.verdict'` —— 自基准/CLI 的
      // evaluator 臂接上第二条来源后，那一串会让**那个 run** 的 metric 行指向一个不是它
      // 生产者的来源（该臂不产 `team_end`）。两条来源见类注释。
      { metric: 'M13', name: 'EvaluatorRejects', value: c.evaluatorRejects, unit: 'count', source: 'evaluator-review:verdict' },
      // M14 detail（本卡接线，见类注释「M14 steers / interrupts 的接线」）：
      //  - `steers`/`interrupts` 从**真实生产者**取值（改前二者与 `human_answers`/`machine_answers`
      //    一样是硬编码 0 —— 一个"看起来有数据、实际永远是同一个值"的字段）；
      //  - `human_answers`/`machine_answers` 本仓**无通路** ⇒ 取 `null`（不可判定）并把名字列进
      //    `detail.unwired`，**不留 0 冒充计数**；
      //  - `value`/`source` 逐字不变（本卡不动口径）：`value` 仍是 `approval_asks`，
      //    `source` 仍点名它的生产者（`telemetry.test.ts` ⑥⑨ 钉住）。
      { metric: 'M14', name: 'Autonomy', value: c.approvalAsks, unit: 'count', source: 'audit/denial:approval', detail: { steers: c.steers, approval_asks: c.approvalAsks, interrupts: c.interrupts, human_answers: null, machine_answers: null, unwired: ['human_answers', 'machine_answers'] } },
    ];
    if (extra?.durationMs !== undefined) {
      out.push({ metric: 'M10', name: 'Time', value: extra.durationMs, unit: 'ms', source: 'runner-timer' });
    }
    return out;
  }

  reportLines(opts: {
    runId: string;
    scenarioId: string;
    harness: string;
    mode: 'offline' | 'live';
    ts: string;
    metrics: MetricValue[];
    events: { kind: string; payload: Record<string, unknown> }[];
    asserts: ReportLine[];
    env: Record<string, unknown>;
  }): ReportLine[] {
    const meta: ReportLine = {
      type: 'meta', runId: opts.runId, ts: opts.ts, scenarioId: opts.scenarioId,
      harness: opts.harness, arm: null, mode: opts.mode, env: opts.env,
    };
    const metricLines: ReportLine[] = opts.metrics.map((m) => ({
      type: 'metric', runId: opts.runId, ts: opts.ts, metric: m.metric as MetricId,
      name: m.name, value: m.value, unit: m.unit, source: m.source,
      approx: m.approx, detail: m.detail,
    }));
    const eventLines: ReportLine[] = opts.events.map((e) => ({
      type: 'event', runId: opts.runId, ts: opts.ts, kind: e.kind, payload: e.payload,
    }));
    return [meta, ...metricLines, ...eventLines, ...opts.asserts];
  }

  detach(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
  }
}

export type { EventBus };
