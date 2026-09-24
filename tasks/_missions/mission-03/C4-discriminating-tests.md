# C4 两条反例的判别性用例（异常路径 / 回合重叠）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（评审 FAIL 的核心补救：把两条反例从"注释里登记"升级为"用例钉住"）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：**blocker**（侦察 §2 的两条反例；C2 仅登记未钉住）

## 目标
为两条已独立复核的反例各写**判别性用例**，使"实现若被改动 / 声明若被退回无条件形式"都会**变红**：

1. **异常路径（无并发）**：单回合、provider 抛**不可重试**错误 ⇒ `AgentLoop.ts:462-463` 的 `else { throw err; }` 直接抛出 ⇒ `:528` 的 `turn/end` **永不写入**，而 `:208-212` 的 `before_turn` 已发出。
   - 用例须钉住：实时侧计到这一轮、纯回放侧计不到（记录面缺一条）；即"记录条数 = 回合数 = `before_turn` 事件数"**在此路径上不成立**。
2. **回合重叠 + 旧回合被 abort（受支持路径）**：同一 `AgentLoop` 上两次 `runTurn` 重叠（`AgentLoop.ts:136` 单实例 `state` + `State.ts:20-26` 的 `beginTurn` 归零）⇒ 旧回合落盘读到**新回合**计数器 ⇒ 该轮 `after_tool` 条数 ≠ 记录里的 `stats.toolCalls`。
   - 用例须钉住：M03 在这条路径上**取值不可信**（**只标不可信，不发明口径** —— 口径裁决属人类，见 Deferred Backlog）。

## 写法要求（判别性，不是橡皮图章）
- 用例名须含**条件与路径**（例如"异常路径：有 `before_turn` 而无 `turn/end`"），并**不得**让断言在两种实现下都通过
- 断言须**结构性**：例如"`turn/end` 记录数为 0 且 `before_turn` 事件数为 1"、"该轮 `after_tool` 条数与记录里 `stats.toolCalls` 不等"，并附注释指明机制与文件:行号
- **不得**为了写用例而放宽/删除任何既有断言；**不得**改实现源码（若实现层面必须动才能写用例，**停下报 BLOCKED**）
- 允许**新增 1 个测试文件**（如 `packages/telemetry/src/turnEndBoundary.test.ts`）或在既有 `telemetry.test.ts` 内增用例；若新增文件，`git status` 会从 8 项变 9 项，**必须如实记录这一变化**
- 不得使用真实 provider / 不得联网（用测试 provider 或 mock）

## 限制条件 / 禁止事项
- 只允许改/增：`packages/telemetry/src/**` 下的测试文件（`*.test.ts`）
- **不得**改运行时源码（`packages/*/src/**` 的非测试文件），尤其不得改 `Telemetry.ts`（C2 定稿）
- 不得跑 `tsc -b` / `test:all`；本卡**最多 1 次**定向 vitest（`npx vitest run packages/telemetry`）
- 不得 install / 改 lockfile；不得 `git add/commit/stash/restore/checkout/clean`；不得删除文件
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）

## 验收标准（客观门禁）
- [ ] 两条反例各有一条用例，且**用例名写明条件/路径**
- [ ] 用例在**当前实现**下通过（贴定向 vitest 输出与退出码）
- [ ] **判别性论证**：逐条说明"若实现/声明改变，哪一条断言会先红"（例如：若异常路径改为总能落 `turn/end`，则"记录数为 0"的断言变红；若去重被削弱，则"两侧同数"的断言变红）
- [ ] 既有断言未被放宽/删除（贴 `git diff --numstat` 对照）
- [ ] `git status --short` 的变化被如实记录（允许 8 → 9 项，但要说明新增文件是什么）
- [ ] 运行时源码零改动

## 依赖
- 依赖任务卡：C2、C3

## 预期证据（执行器回填）
- [ ] 两条用例的关键代码片段（含注释里的机制行号）
- [ ] 定向 vitest 输出摘要与退出码
- [ ] 判别性论证（逐条"哪条断言会先红"）
- [ ] `git status --short` 与 `git diff --numstat`
- [ ] 偏差 / 未完成项（尤其若发现"实现无法满足正确断言"）

## 验收结论（Evaluator / 指挥会话回填）
- **PASS** → 自动合入；新增 `packages/telemetry/src/turnEndBoundary.test.ts`（16334 B）——**无 BLOCKED**（两条反例都能在纯测试面钉住，无需改实现）
- 指挥侧独立复验：
  - 文件存在、**16334 B**（我的行数统计为 334 行，执行器报 295 行 —— **行数口径不一致，记录在案；字节数与运行结果一致，不影响验收**）
  - 两条用例名确含条件/路径（`异常路径（无并发；provider 抛不可重试错误）…` / `回合重叠 + 旧回合被 abort（受支持路径）…`）
  - **我亲自跑** `npx vitest run packages/telemetry` → **Tests 27 passed (27) / exit 0**
  - `git status --short` = **9 项**（原 8 项逐字未变 + 本卡新增测试文件）；HEAD 仍 `ba173d4`
  - `git diff --numstat` 仅 6 个待处理切片文件，**运行时源码零改动**（新文件未跟踪故不在 numstat）
- 断言结构性到位：异常路径钉 `turn/end` 记录数 0 / `turn/start` 在 / `before_turn`=1 / `llm/retry{abort, attemptNo=1, kind=UNKNOWN}` / `live.turns=1` vs `replay.turns=0`；重叠路径钉 scope 确被 abort / 两条 `turn/end` 都在 / 该轮 `after_tool=1` 而记录 `stats.toolCalls=0`
- 判别性论证为**静态推理**（对照源码行号；卡面禁止改运行时源码，故未实做变异）→ 已由 **C5** 用 `%TEMP%` 副本补突变实测
- 遗留（已记录）：`telemetry.test.ts:81` 那句"补用例不在本卡授权范围内"已过时（执行器为保持改动面干净**故意未改**）；"回合重叠时 M03 该怎么算"的口径裁决仍属人类
- **指挥侧自身修正**：C5 卡面误把 C1 快照期的 `Telemetry.ts` 哈希（`c4f18bda…`）当作现行基线（C2 已改过该文件）→ 已向 C5 执行器发更正，改用开工实测哈希（我方实测 `A6A0F935D978C261…`）
- 执行器：子代理 234a8691