# W2 （R3）四个无见证面的见证用例

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P1**（C8 §6.2 的 R3：这四处**行为已在文档里声明**，但**没有任何用例见证**）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 2
- 来源：**planned**（`.dsh-mission/evidence/C8-review-verdict.md` §6.2 R3 与 §6.3 的建议卡 C10）

## 目标

为 `turn/end` 接线的**四个边界**各补一条用例，使「文档里写的边界」变成「测试里钉住的事实」。**本卡只加用例，不改运行时源码。**

1. **崩溃合成 `turn/end` 流经新分支**：会话日志里有一个**已 `turn/start` 但未收尾**的回合 ⇒ `Session` 重新打开时 `Session.loadExisting()` 为它**合成**一条 `turn/end{kind:'interrupted', stats:{steps:0,toolCalls:0,durationMs:0}}` ⇒ 一个**全新** `Telemetry().finalize(session)` 应计 **turns=1 / toolCalls=0**（类注释声明的边界：合成记录 stats 全零是**下界**，不是"测得 0 次"）。
2. **`stats.steps` 的中断 mismatch**：模型调用**在调用途中**被中断时，`beginStep()` 已计这一步而 `after_model` **未发** ⇒ 该轮记录里的 `stats.steps` **大于**该轮 `after_model` 事件条数。用例须同时钉住"记录里的值"与"事件面的值"两个数。
3. **回合中途 `attach` 的多计**：telemetry **在回合开始之后**才挂上总线 ⇒ `liveTurnIds` 收不到该轮 `turnId`，而该轮部分 `after_tool` 已被实时计入 ⇒ `finalize` 时记录侧**再补一次**整轮 `stats.toolCalls` ⇒ `toolCalls` **多计**。用例须把"多计了"这个事实**显式表达**出来（例如断言 `counters.toolCalls` 等于「实时计到的 after_tool 条数 + 该轮记录里的 stats.toolCalls」）。
4. **`before_turn` 载荷无 `turnId` 的"形状不认识"分支**：载荷没有字符串 `turnId` ⇒ 照旧"每个事件计一次"且**不进** `liveTurnIds` ⇒ 若日志里还有该轮 `turn/end` 记录，记录侧**会再补一次**（turns 计两次）。用例须把该行为钉住，并**如实标注**这是"绝不静默少计"那条声明的**代价**（少计 vs 多计的取舍）。

## 写法要求

- **逐条标注「判别性」还是「不变式守卫」**（纪律 24）：能指认"删/改哪一行会红"的才叫判别性；指不出的只能叫不变式守卫，**不得**当作"该路径已被判别性覆盖"的证据。四条各自的定性要写进卡内与用例注释。
- 断言必须**结构性**（记录条数、事件条数、计数器数值三方对照），不得只断言"不抛错"
- 每条用例名须写明**条件与路径**（如"崩溃合成收尾记录 ⇒ 计 1 回合 / 0 工具调用（下界）"）
- **不得**为了让用例变绿而放宽任何既有断言；**不得**改实现源码
- 若某条边界**当前实现下无法在测试面构造**（例如第 2 条的中断时机不可控），**停下报 BLOCKED** 并给出最小复现尝试记录——**不得**改运行时源码去"让它可测"

## 限制条件 / 禁止事项

- 只允许改/增测试文件：`packages/telemetry/src/**` 下的 `*.test.ts`（建议**新增 1 个**文件 `packages/telemetry/src/turnEndWitness.test.ts`，避免与 W1 抢同一个文件）
- **不得改运行时源码**（`packages/*/src/**` 的非测试文件），尤其不得改 `Telemetry.ts`、`AgentLoop.ts`、`Session.ts`
- **不得**改任何文档（`docs/**` 只读）
- 本卡最多 **1 次**定向 vitest（`npx vitest run packages/telemetry`）；**不得**跑 `tsc -b` / `test:all`
- 若发现某条见证用例**与既有声明矛盾**（即文档说的与实现做的不一致），**停下报 BLOCKED 并登记**，不要自行改文档或代码——那属产品/契约决策
- 不得 install / 改 lockfile；不得 `git add/commit/stash/restore/checkout/clean`；不得删除文件
- 命令文本不得含永久删除类 API 字面名

## 验收标准（客观门禁）

- [ ] 四条边界各有一条用例，用例名写明条件/路径
- [ ] 四条用例在**当前实现**下通过（贴定向 vitest 输出与退出码，未过滤）
- [ ] 每条**逐条标注**了「判别性 / 不变式守卫」，判别性的必须给出"删哪行会红"
- [ ] 既有断言未被放宽/删除（贴 `git diff --numstat`）
- [ ] 运行时源码与文档**零改动**（贴 `git status --short` 与 `git diff --numstat`）
- [ ] `git status --short` 的变化被如实记录（新增测试文件）

## 涉及文件（含爆炸半径）

- 增（建议）：`packages/telemetry/src/turnEndWitness.test.ts`
- 只读：`packages/telemetry/src/Telemetry.ts`、`packages/core/src/session/Session.ts`（`loadExisting`/`openTurns`）、`packages/core/src/agent-loop/AgentLoop.ts`、`packages/core/src/state/State.ts`、`packages/telemetry/src/telemetry.test.ts`（⑯⑰⑱ 的既有形态）

## 依赖

- 依赖任务卡：无
- **串行要求**：与 W1 都要动 `packages/telemetry/src/**` 的测试面 ⇒ **两者不得并行**（同一 worktree 会互相踩）。执行顺序：W1 → W2。

## 预期证据（执行器回填）

- [ ] 变更摘要（四条边界 → 用例 → 定性）
- [ ] diff 与 `git diff --numstat`
- [ ] 定向 vitest 输出与退出码（未过滤）
- [ ] 第 2/3/4 条的关键断言片段（含解释机制与文件:符号名）
- [ ] BLOCKED 记录（若某条无法构造）
- [ ] 偏差 / 未完成项

## 执行记录（W2 执行器回填，2026-09-13）

产物：**新增 1 个测试文件** `packages/telemetry/src/turnEndWitness.test.ts`（4 条用例，408 行）。
运行时源码 / 文档 / W1 的两个文件**零改动**。

| 边界 | 用例名 | 定性（纪律 24） | 指认「删/改哪行会红」 |
| --- | --- | --- | --- |
| ① 崩溃合成 `turn/end` | `① 崩溃合成收尾记录（已 turn/start、未收尾）⇒ 重开日志后计 1 回合 / 0 工具调用（合成 stats 全零 = 下界）` | **判别性** | 删 `Telemetry.finalizeRecord` 的 `case 'turn/end':`（`Telemetry.ts:451`）或删 `Session.loadExisting` 的 `for (const turnId of openTurns)` 合成循环（`Session.ts:140`），或把合成 `stats` 改成非零（`Session.ts:145`）⇒ 红 |
| ② 中断的模型调用 | `② 模型调用途中被中断（流在飞时打断）⇒ 该轮记录 stats.steps=1 而事件面 after_model=0` | **判别性** | 删 `this.state.beginStep()`（`AgentLoop.ts:331`）⇒ 记录里的值变 0 ⇒ 红；删 `consumeStream` 的 `if (this.interruptCtl.aborted) throw new TurnInterruptedError();`（`AgentLoop.ts:709`）⇒ 流跑完、`after_model` 变 1 ⇒ `>` 断言红 |
| ③ 中途 attach 多计 | `③ 回合中途 attach ⇒ 该轮 toolCalls 多计（对照：回合前 attach 按 turnId 去重不多计）` | **判别性** | 删 `finalizeRecord` 的 `if (this.liveTurnIds.has(r.turnId)) break;`（`Telemetry.ts:458`）或删 `attach()` 的 `liveTurnIds.add(turnId)`（`Telemetry.ts:324`）⇒ **对照组**由 1 变 2 ⇒ 红；删 `bus.on('after_tool', …)` 实时计数（`Telemetry.ts:334`）⇒ 中途 attach 那条由 2 变 1 ⇒ 红 |
| ④ `before_turn` 无 `turnId` | `④ before_turn 载荷无字符串 turnId ⇒ 每事件计一次且不进身份集 ⇒ 同一回合的记录侧再补一次（turns=2）` | **判别性** | 删 `liveTurnIds.add` 那一行 ⇒ 对照组（身份齐全）也补一次 ⇒ 红；给形状不认识的分支加「无 turnId 不计数」早退 ⇒ 本组由 2 变 1 ⇒ 红 |

关键机制（用例内的**结构性三方对照**）：

- ① 真实崩溃残留由「工具调用后第 2 次模型调用抛 UNKNOWN（不可重试）」构造（同一闸门：`AgentLoop.ts:462-463` ⇒ `:528` 永不落盘）；`close()` 后用同一 `sessionId` 重开 ⇒ `loadExisting()` 合成收尾。用例同时钉住**崩溃前真跑过 1 次工具**（日志里 1 条 `tool/result`）与**合成汇总写 0**（`stats` 逐字段 `{steps:0,toolCalls:0,durationMs:0}`）⇒ 「0 次工具调用」是**下界**而非「测得 0 次」。
- ② 中断打在**在飞的模型调用**上：`InterruptingStreamProvider` 在 `yield message_start` 之后调 `loop.interrupt()`，下一次迭代的 `:709` 边界检查抛出；`model_stream_start` 恰好 1 条作为「已发起」的锚点。两个数：事件面该轮 `after_model` = **0**、记录 `stats.steps` = **1**，并断言 `stats.steps > after_model 条数`。
- ③ 中途 attach 在 `provider.chat(1)` 内进行，`order` 数组把顺序钉成事实 `['before_turn','attach']`；等式 `counters.toolCalls === 实时 after_tool 条数 + 该轮记录 stats.toolCalls`（1+1=2），两个加数各自先独立断言；对照组（回合前 attach）为 1。
- ④ A 组（无 `turnId`）事件面 1 + 记录面 1 = **2**；B 组（身份齐全）1 + 去重 0 = **1**。用例注释**如实标注**：这是 `liveTurnIds` 那条「形状不认识也计、绝不静默少计」的**代价**（代价是多计，不是少计）。

证据：

- 定向 vitest（唯一 1 次，未过滤）：`npx vitest run packages/telemetry` ⇒ **Test Files 5 passed (5) / Tests 43 passed (43)**，`EXITCODE=0`；本文件 `turnEndWitness.test.ts (4 tests) 169ms`。
- `git status --short`：仅 ` M packages/telemetry/src/telemetry.test.ts`、`?? packages/telemetry/src/turnEndConditionGuard.test.ts`（W1 两文件，原样）+ `?? packages/telemetry/src/turnEndWitness.test.ts`（本卡新增）。
- `git diff --numstat`：`59  4  packages/telemetry/src/telemetry.test.ts`（与执行前逐字一致 ⇒ W1 的 tracked 改动未被触碰）；W1 两文件 mtime 分别 6:44:49 / 6:46:16（早于本卡开工 7:06）。
- SHA256（执行后）：`telemetry.test.ts` = `8501D7B0…F918F4`、`turnEndConditionGuard.test.ts` = `90ED12BF…817906`、本卡新增 `turnEndWitness.test.ts` = `72EF474B…7A8335`；只读文件 `Telemetry.ts` = `4C480CF5…F5F0B0`、`AgentLoop.ts` = `8085DFF4…81DC35`、`Session.ts` = `C3305962…5C13F`。
- 偏差/未完成项：无 BLOCKED（四条边界全部可在测试面构造）。观察（未归因、受「只跑 1 次 vitest」预算限制无法二分）：该次运行的 stderr 有一条 Node `DEP0137`（FileHandle 在 GC 时被关闭）告警，本文件内每个 `Session` 都显式 `close()`，未能确认它来自哪个既有测试文件。

## 验收结论（Evaluator / 指挥会话回填）

- 状态行：**已合入（2026-09-13）**
- 结果：**PASS**（**未用 Repair**）
- **指挥侧独立复核（不是转述）**：
  - `git status --short` = 三行：W1 的两项**原样**（` M telemetry.test.ts`、`?? turnEndConditionGuard.test.ts`）+ 本卡新增 `?? turnEndWitness.test.ts` ⇒ 运行时源码与 docs **零改动**
  - `git diff --numstat` 仍是 `59 4 packages/telemetry/src/telemetry.test.ts`（与 W1 验收时**逐字一致**）
  - W1 两文件哈希与 W1 验收时**完全相同**：`8501D7B0…`、`90ED12BF…` ⇒ W1 的已验收产物未被本卡触碰
  - 本卡文件含 **4 条用例**，用例名逐条写明条件/路径（崩溃合成 / 流在飞时中断 / 中途 attach + 对照 / 无 `turnId` 形态）
  - 我**亲自跑** `npx vitest run packages/telemetry` ⇒ **5 files / 43 passed / VITEST_EXIT=0**（与执行器报告逐字一致）
- **定性复核**：四条都给出了可指认的"删/改哪行会红"（`Telemetry.ts` 的 `case 'turn/end':`／`liveTurnIds.has`／`liveTurnIds.add`／`after_tool` 计数、`Session.loadExisting` 的合成循环、`AgentLoop` 的 `beginStep()`／`aborted` 边界检查）⇒ 按纪律 24 均可称**判别性**。③④ 还各带**对照组**（回合前 attach=1 / 身份齐全=1），使"多计"这个事实不是自说自话。
- **未复核项（如实）**：我没有逐条重跑这四条的突变（预算已用尽）；判别性结论采信**卡内逐条指认 + 用例内的结构性三方对照 + 我读到的断言实现**。
- **残余（未修，已登记 Deferred Backlog）**：本次 stderr 出现 Node `DEP0137`（FileHandle 在 GC 时被关闭）告警 —— 我复核到它**只在 W2 之后出现**（W1 验收那次没有），但**未二分归因**到具体文件/用例；**是告警不是失败**（43/43 绿、exit 0），Node 未来会把它变成错误。**处置：登记 + 交给 W3 独立评审列为残余风险，本轮不改**（改测试文件会使本卡已验收哈希失效）。
- 计数器：`完成卡数` 2→3/4、`总卡数` 2→3/6。
