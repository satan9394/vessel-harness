# 120 — `turn/end` Telemetry 接线切片：依据收窄 + 判别性用例 + 突变证明（待独立重评后提交）

- 编号：120
- 状态：已合入（2026-09-18 对账）
- 对账记录：原状态行「待验收（等 C7 全新上下文对抗评审；PASS 后由 C7 提交，**本卡不提交**）」；实际已合入，证据：commit 5f3ec0b（turn/end 条件守卫）。
- 优先级：P0（该切片已实现但被独立验收判 FAIL，且**无提交、无卡**地挂在工作区）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1（C6 落卡）
- 关联：`DSH_RECOVERY_REPORT.md` §9（接线记录）/§9.1（**独立验收 FAIL 判决全文**）；`docs/product-evolution/PRODUCT-GAP-MAP.md:430`（异常路径不落 `turn/end` 的既有记录，定级：中）；`tasks/113`（Windows rename EPERM flaky 记录）
- 执行器：隔离子代理（C1–C6 逐卡一个执行器，工作证明回填各卡与 Mission `evidence/`）
- 评审对象（C7 用）：Mission 侧冻结补丁 `backup/turn-end-slice-final.patch`（本切片不在 HEAD 里，故**不能**用 `git show HEAD:` 取证）

## 1. 目标

把工作区里那个「实现方向经人类裁决保留、但独立对抗验收判 FAIL」的 `turn/end` Telemetry 切片推到**可提交**：按反例收窄三处被证伪的断言（含 `costEstimate` 措辞）、清掉两处连带矛盾、为两条反例各补判别性用例并做**突变实测**证明它们是绊线而非橡皮图章，经全新上下文对抗评审 PASS 后一次性提交。

病根一句话（继承自 `DSH_RECOVERY_REPORT.md:41`）：**产物对、依据吹强了** —— `case 'turn/end':` 的取值本身正确，错的是我们为它写的三条等式强于实现能做到的范围。这与 HEAD `ba173d4` 自己在治的「声明与实现不一致」是同一个病。

## 2. 切片内容（工作区 9 项 = 6 改 + 2 未跟踪恢复文档 + 1 新增测试）

`git diff --numstat`（tracked 面，实测）：

```
2	2	docs/ARCHITECTURE.md
2	2	docs/BENCHMARK-SPEC.md
1	1	docs/product-evolution/PRODUCT-STATE.md
10	2	packages/shared/src/unwiredRecords.test.ts
122	12	packages/telemetry/src/Telemetry.ts
166	6	packages/telemetry/src/telemetry.test.ts
6 files changed, 303 insertions(+), 25 deletions(-)
```

- 实现：`packages/telemetry/src/Telemetry.ts` —— `finalizeRecord` 新增 `case 'turn/end':`（取回合身份 `turnId` → M02 `turns`、`stats.toolCalls` → M03 `toolCalls`）+ `liveTurnIds` 身份去重（防实时面双计）。改前该分支在 HEAD 中不存在（`git log -S "case 'turn/end'"` 无输出）⇒ 纯回放的 M02/M03 恒 0，而这两个指标在 25 个有 manifest 的场景里全部声明为 `measured`。
- 测试：`packages/telemetry/src/telemetry.test.ts` 新增 ⑯（纯回放重建 M02/M03，含"`stats.steps` 仍必须为 0"的负对照）与 ⑰（防重复计数 / 两侧同数），并修正守用例 ⑤ 的词法缺陷（原扫整格 → 按"未消费"切段后只扫反引号 token）。
- 新增测试文件：`packages/telemetry/src/turnEndBoundary.test.ts`（16334 B，未跟踪；C4 产出的两条判别性用例）。
- 文档/守卫同步：`docs/ARCHITECTURE.md` §4.11、`docs/BENCHMARK-SPEC.md` §4.1 的 M02/M03 行、`packages/shared/src/unwiredRecords.test.ts` 同族注释、`docs/product-evolution/PRODUCT-STATE.md` 当前欠账行。文档⇄代码是**双向守卫**（`unwiredRecords.test.ts` 把 §4.11 的"已消费集合"与 `finalizeRecord` 的 `case` 分支绑定），必须同批改。

## 3. 验收标准（客观门禁）

- [x] **冻结**：Mission 侧存在最终补丁与新增测试文件副本，附 SHA256/字节数，且 `git apply --check --reverse` **exit 0**（本卡回填见 §8）
- [x] 三处被证伪断言 + 一处措辞已收窄到可证伪范围（条件化表述 + 反例与机制登记；既有断言未被删除/放宽）
- [x] 两处连带矛盾已清（`unwiredRecords.test.ts` 与同文件 `:38-43` 口径一致且判据未削弱；`docs/ARCHITECTURE.md` 配对不变式就地收窄为"成功收尾 + 已登记例外"）
- [x] 两条反例各有判别性用例（用例名写明条件/路径），且**做过突变实测**：删实现对应行 ⇒ 指定用例变红（C5/C5b 两份原始记录 + 4 份日志）
- [x] `npx tsc -b` exit 0；`npm run test:all` 两个 root 均 exit 0（原样完整输出已留档，未过滤）
- [x] 运行时源码在本轮（C6）零改动；未 commit（HEAD 仍 `ba173d4`）
- [ ] **C7**：全新上下文只读 Reviewer 对冻结补丁重评 PASS；随后提交只含切片文件（禁 `git add -A`）

## 4. 证据指针

> 本项目**没有** `docs/ai/evo` 目录，也**没有**独立的 `_review` 报告文件；本切片的等价物如下，如实标注。

- **FAIL 判决全文（唯一一手）**：`DSH_RECOVERY_REPORT.md:76-97`（§9.1，未跟踪文件 ⇒ 有被误清风险，见 §6 未闭合项 4）
- 切片构成与原始 FAIL 依据：Mission `recon-report.md`（§0 结论、§1 切片清单、§2.3 三处被证伪断言 + 两条连带矛盾 + 5 项未处理发现、§6 风险表）
- Mission `RUN_STATE.md`（DoD E1–E5、Out of scope、预算与计数）
- 逐卡工作证明与验收结论回填：Mission `tasks/C2-narrow-falsified-claims.md`、`C3-collateral-contradictions.md`、`C4-discriminating-tests.md`、`C5-mutation-evidence.md`、`C5b-mutation-agentloop.md`
- **两份突变记录**（本卡的核心新证据）：Mission `evidence/C5-mutation-record.md`（Telemetry 侧两轮变异）与 `evidence/C5b-mutation-record.md`（AgentLoop 侧两轮变异）；原始日志 `C5-run1-mutation1.log`、`C5-run2-mutation2.log`、`C5b-run1-mutationA.log`、`C5b-run2-mutationB.log`
- **C6 门禁原始输出**（未过滤，完整）：Mission `evidence/C6-tsc-b.log`（0 B = 无输出）、`evidence/C6-test-all.log`（95052 B / 854 行）
- 冻结产物（C7 的评审对象）：Mission `backup/turn-end-slice-final.patch`、`backup/turnEndBoundary.test.ts`；C1 早先快照 `backup/turn-end-slice.patch`（37728 B）
- 仓库内既有记录：`docs/product-evolution/PRODUCT-GAP-MAP.md:430`（异常路径不落 `turn/end`，本仓**自己早已记录**，上一会话却把它当成成立的前提写死）

## 5. 完整链路

**① 独立验收 FAIL（全新上下文对抗 Reviewer，验收对象 = 工作区 6 个未提交文件；6 条判据命中第 ② 条）**
切片在**正常单回合**路径上行为正确（取值正确、身份去重成立、⑯⑰ 在成功回合上绿、范围项亦判通过：只有 6 个文件）。被证伪的是我们**自己新写入的三处断言**：

1. 「有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数 == `stats.toolCalls`」**不成立**。反例（同一 `AgentLoop` 两个 `runTurn` 重叠、工具 signal-blind）：`raceToolRun` 捕获的是**当时**的 signal（`AgentLoop.ts:946-948`），catch 守卫读的是**当前**的 `this.interruptCtl.aborted`（`:893-913`），`:451-464` 把 `TurnInterruptedError` 折成 `kind='interrupted'` 后**继续走到 `:528` 落 `turn/end`**；又因 `LoopState` 每 loop 一个（`:136`）且 `beginTurn` 归零（`packages/core/src/state/State.ts:20-26`），旧回合落盘读到**新回合**计数器。实测：`turn/end` 存在、该轮 `after_tool`=1、`stats.toolCalls`=0。
2. 「记录条数 = 回合数 = `before_turn` 事件数」+「实时 == 纯回放」**不成立**。反例更简单、**无并发**：单回合、provider 抛不可重试错误 ⇒ `AgentLoop.ts:462-463` 的 `else { throw err; }` 使 `:528` 不可达，该回合发过 `before_turn` 却**根本没有 `turn/end` 记录** ⇒ 实测 `live.turns=1 / replay.turns=0`。
3. `costEstimate` 那段**措辞过强**：「全仓只有类型声明与 `AgentLoop` 的累加，没有铸造点」被 `packages/core/src/agent-loop/AgentLoop.log-evidence.test.ts:48/51` 证伪；「本仓也没有对应指标定义」被 `packages/shared/src/metrics.ts:7`（`MetricId` 含 M11）与 `BENCHMARK-SPEC` §4.1 M11 行证伪。**实质结论（没有任何 shipped provider 上报它）仍成立**，错的只是绝对化措辞。

因硬停止条件 B（Reviewer FAIL）**未提交**，HEAD 保持 `ba173d4`；按纪律**禁止 Fix→Re-test 循环**，该轮未做任何修复。另有两处连带矛盾：`unwiredRecords.test.ts:167-169` 与同文件 `:38-43` 自相矛盾；`docs/BENCHMARK-SPEC.md:576`（M03 行）也带着第 1 条那条被证伪的等式 —— 而它正是整个切片"敢把 `stats.toolCalls` 当回放源"的**唯一依据**。

**② C2 —— 三处断言收窄 + `costEstimate` 措辞更正（blocker）**
改为"条件 + 显式反例与机制（文件:行号）"的如实表述，并明写"改这里的人**不得**把条件去掉"。**numstat 只增不删**（`Telemetry.ts` 90/12→122/12；`telemetry.test.ts` 151/6→166/6，删除数不变 ⇒ 无既有断言被删）；无条件旧表述 grep 归零；定向 `npx vitest run packages/telemetry` → 2 files / **25 passed** / exit 0。

**③ C3 —— 清两处连带矛盾（blocker）**
`unwiredRecords.test.ts:171-172` 与同文件 `:38-43` 对齐（纯注释改动，`5/1→10/2`，**各断言逐字未变**⇒ 守卫仍是"接线绊线"不是橡皮图章）；`docs/ARCHITECTURE.md:176` 的通用不变式「`turn/start→turn/end` 全部配对且编号连续；任一缺失 = 日志腐败」被同一条异常路径证伪 ⇒ 就地收窄为"**只在成功收尾的回合上成立** + 登记反例与机制"（纯文档，未改 invariant 自检代码、未改 EVENT-SPEC）。定向 `npx vitest run packages/shared` 全绿。

**④ C4 —— 两条反例的判别性用例（blocker）**
新增 `packages/telemetry/src/turnEndBoundary.test.ts`（16334 B；`git status` 由 8 项 → **9 项**，如实记录）。两条用例名写明条件/路径：**异常路径（无并发；provider 抛不可重试错误）：有 `before_turn` 而无 `turn/end` ⇒ 实时侧计到该轮、纯回放侧计不到**；**回合重叠 + 旧回合被 abort（受支持路径）**。断言结构性（记录数 0 / `before_turn`=1 / `live.turns=1` vs `replay.turns=0`；该轮 `after_tool`=1 而记录 `stats.toolCalls`=0），并**只标 M03 在该路径上取值不可信、不发明口径**。定向 `npx vitest run packages/telemetry` → **27 passed** / exit 0。**无 BLOCKED**：两条反例都能在纯测试面钉住，无需改实现。

**⑤ C5 / C5b —— 突变实测证明绊线（证明"删哪行会红"）**
全部在 `%TEMP%` 副本内做（真实工作树零变异；副本用 `robocopy /E /XJ /XD node_modules dist .vitest .turbo coverage .git` + `node_modules` **逐条 Junction**，跳过 `.vite`；C5 实测过整目录 Junction 会把 `node_modules/.vite/vitest/results.json` **写穿真实树**）：

- **C5 变异 1**：删 `Telemetry.ts:435-445` 的 `case 'turn/end':` ⇒ **3 failed / 24 passed**：⑯ `telemetry.test.ts:746`、⑰ `:798`、C4② `turnEndBoundary.test.ts:325`。
- **C5 变异 2**：删 `:442` 的 `if (this.liveTurnIds.has(r.turnId)) break;` ⇒ **2 failed / 25 passed**：⑰ `:790`、C4② `:319`。⇒ **⑯、⑰、C4② 已用突变证明是绊线（⑰ 与 C4② 还是双向绊线）**。
- **C5 的诚实缺口**：C4① 对 Telemetry 侧变异**不可判别**（该场景本就没有 `turn/end` 记录，删分支对它天然无感）⇒ 立 C5b。
- **C5b 变异 A**（把 `AgentLoop.ts:463` 的 `throw err;` 换成 `kind='error'; finalText=…`）⇒ C4① 红在**更早**的 `:176`（`rejects.toThrow` 契约被破坏，`runTurn` 由 reject 变 resolve）。
- **C5b 变异 B**（最小可行变体：保留 `throw err;`，仅在其前插入一条 `appendSync({type:'turn/end', kind:'error', stats:{…}})`）⇒ C4① 精确红在点名行 `:189`（`expected [ { type: 'turn/end', … } ] to have a length of +0 but got 1`），且爆炸半径仅限该路径（其余 26 条两轮全绿）。
- ⇒ **C4① 是可判别的绊线（突变体被杀）**；结论与缺口见 §6 未闭合项 3。
- 真实树零写入证据：`Telemetry.ts` = `A6A0F935…`、`AgentLoop.ts` = `8085DFF4…` 前后一致；`node_modules/.vite/vitest/results.json`（GUARD-A）与 `apps/web/node_modules/.vite/vitest/results.json`（GUARD-B）哈希/mtime 逐字节未变；`git status --short` 仍 9 项；副本与排练目录一律**回收站**清收（未用任何永久删除手段）。

**⑥ C6（本卡）—— 冻结 + 最终门禁 + 落卡**
冻结补丁与新增测试文件副本、跑 `tsc -b` 与 `test:all`（结果见 §8）、落本卡。**本轮零源码/测试改动。**
提交留给 **C7**：全新上下文只读 Reviewer，只见**冻结补丁 + 验收标准**，在冻结坐标上重评；PASS 后提交只含切片文件（禁 `git add -A`）。

## 6. 未闭合项（逐条登记，含处置与理由）

1. **`packages/telemetry/src/telemetry.test.ts:81` 是过时指针**：该行仍写"为它们补判别性用例是**另一次改动**，不在本卡的授权范围内"，而 C4 已经补齐（`turnEndBoundary.test.ts`）。C4 执行器为保持改动面干净**故意未改**（该文件属 C2 定稿面）。**处置**：属"文档落后于代码"同族病，随 C7 提交前一句改准，或并入后续卡；**C6 不得改**——本卡门禁已在当前编辑状态跑过，任何再编辑都会使门禁失效（AGENTS.md 约束 7：两项必须在最后一次编辑之后）。
2. **「回合重叠时 M03 该怎么算」的口径裁决属人类**：是只对未被打断的回合计数，还是改取别的身份/来源（`SessionController.ts:159-167` 明文承认 abort 旧回合、`apps/local-server/src/server.ts:379-381` 的 POST /turns 无并发闸门）。本切片采取**保守默认：不发明口径**，只把该路径标为"取值不可信"并用例把限制**显式表达**出来。**需人拍板**。
3. **C4① 的 `turnEndBoundary.test.ts:210`/`:211` 未单独实测变红**（**不是**橡皮图章的迹象，是 fail-fast 的结构性结果）：两轮 C5b 变异里 `:176`（变异 A）/`:189`（变异 B）先失败即中止同一个 `it()`，后续断言不再求值；`vitest ≤2 次` 的额度已用尽。
   - **代码层推断（推断，非实测）**：变异 B 写入的唯一一条 `turn/end`，在 `:209` 的**全新 `Telemetry()`**（`liveTurnIds` 为空）上会走 `case 'turn/end'` ⇒ `replay.turns` 由 0 变 1 ⇒ `:210` `expect(replay.turns).toBe(0)` 红；`live.turns` 仍为 1 ⇒ `:211` `expect(replay.turns).not.toBe(live.turns)` 亦红。
   - **补测法（最小代价）**：在副本内重放变异 B，并临时摘掉 `:189`/`:190`/`:194` 中前两条（或把它们改成 `if (false)` 等价形式），再跑一次 `npx vitest run packages/telemetry`（**需 1 次 vitest 额度**，仍在 `%TEMP%` 副本内，真实树零变异）。
4. **`DSH_RECOVERY_CHECKPOINT.md` / `DSH_RECOVERY_REPORT.md` 的处置未裁决**（提交进仓库 / 移出仓库 / 明确保留未跟踪）——属人类。注意：它们是本次 FAIL 判决的**唯一一手记录**（本仓**没有** `EVALUATION-REPORT-25` 类落盘评估），若丢失则验收结论只剩本卡的转述 ⇒ 与「清单必须落盘」纪律冲突。
5. **范围外（本轮只登记、未动）**：`request/header` 仍未接线；`costEstimate`/M11 的缺口在**产物侧**（没有任何 shipped provider 上报）；`interrupts` 对"崩溃恢复冒充人工打断"无法用记录面消除；`before_stop` 仍是丢弃的潜伏死缝；被跟踪的 `benchmarks/reports/release-report.{md,json}` 仍是旧判据快照。

## 7. 范围边界（勿膨胀）

- 不接 `request/header`；不接 `turn/end.stats` 的其余字段（`steps`/`tokensUsed`/`costEstimate`/`toolCallsWithoutEnd`）；不动 `compaction/summary`、`session/end-seed`、`audit/safety`、`before_stop`、`resumeSuccess`。
- **不动四条产品语义决策**（`--model ''` 挡 `VESSEL_MODEL` 回落、真实 provider 无 model 时发字面量 `"mock-model"`、denials/M12 双计、`measured` 是否收紧为 fail-loud）。
- 不刷新 `release-report`（会改写被跟踪产物 + 消耗真实 provider 配额）；不手改产物冒充一致（纪律 27）。
- 不做无关重构；不改 `tasks/` 里其它卡的状态；不 install、不改 lockfile、不升级 TypeScript/Vitest。
- 真实 provider 调用 **0 次**；不删任何文件（删除一律回收站；唯一书面例外是测试自建且位于 `os.tmpdir()` 下的 tmp 目录）。

## 8. C6 门禁实测（原样回填，未过滤）

**冻结产物**（`git diff --output=` 落盘，避免 PowerShell 管道 CRLF 转写）：

| 产物 | 字节数 | SHA256 |
|---|---|---|
| `backup/turn-end-slice-final.patch` | 46803 | `6C01A6E4EB09F9E7039F2C6481932702D8F474608E6231408294B3E123026CCA` |
| `backup/turnEndBoundary.test.ts` | 16334 | `56F413C91DC7A0C7178195027A8A7E53F8F0D6FE6BE3CB0AE99EECA02B5BBF86` |

保真性校验：`git apply --check --reverse backup/turn-end-slice-final.patch` ⇒ **exit 0**（无输出）。补丁 46803 B > C1 快照的 37728 B，差额即 C2/C3 的收窄文字与 C4 的测试改动。

**`npx tsc -b`** ⇒ **exit 0**，耗时 10.7 s，**无输出**（日志 0 B）。

**`npm run test:all`** ⇒ **exit 0**，耗时 98.8 s，完整输出 95052 B / 854 行留档（`evidence/C6-test-all.log`）。两个 root 的汇总行逐字：

```
 RUN  v2.1.9 C:/work/Vessel_Harness
 Test Files  169 passed (169)
      Tests  2179 passed | 6 skipped (2185)
   Duration  93.80s (transform 16.55s, setup 4.53s, collect 78.58s, tests 365.83s, environment 59ms, prepare 40.93s)
 RUN  v2.1.9 C:/work/Vessel_Harness/apps/web
 Test Files  11 passed (11)
      Tests  120 passed (120)
   Duration  2.19s (transform 1.32s, setup 0ms, collect 3.79s, tests 557ms, environment 4ms, prepare 2.86s)
```

- **无 flaky、无失败文件、无未处理红**（这是**单次**全量；本轮未出现 Windows rename EPERM 偶发红，故无需按"原样保留完整输出再判定"处理）。
- 与基线对照：根 **168 → 169** 文件、**2177 → 2179** passed + 6 skipped，增量恰为 C4 新增的 `turnEndBoundary.test.ts`（2 条用例）；`apps/web` 11 文件 / 120 passed 不变。
- 两项门禁都在**最后一次编辑之后**执行，且本卡（`tasks/120`）落盘后未再改动任何源码或测试。

**状态面**：`git status --short` = **10 项**（原 9 项 + 本卡）；HEAD 仍 `ba173d4`；无提交、无 `git add`、暂存区空。

## 9. 涉及文件（指针）

- 实现：`packages/telemetry/src/Telemetry.ts`
- 测试：`packages/telemetry/src/telemetry.test.ts`、新增 `packages/telemetry/src/turnEndBoundary.test.ts`
- 守卫/文档：`packages/shared/src/unwiredRecords.test.ts`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`
- 只读参照（未改）：`packages/core/src/agent-loop/AgentLoop.ts`、`packages/core/src/state/State.ts`、`packages/application/src/session/SessionController.ts`、`packages/shared/src/metrics.ts`、`docs/product-evolution/PRODUCT-GAP-MAP.md`

## 10. 验收结论（指挥 / C8 复评回填）

- **评审链**：C6 冻结（final）→ **C7 全新上下文对抗评审 FAIL**（阻断项 A = 收窄所用条件本身选错，漏了「可重试类别 + 预算耗尽」路径；B = `EVENT-SPEC.md:605` 与收窄后的 `ARCHITECTURE.md:176` 互否）→ C7b 修正 → **重新冻结 final2** → **C8 复评 PASS**（置信度 0.82，无阻断项；A/B 均判为已闭合）
- **C8 的关键判定**：`EVENT-SPEC.md:605` 的改动**确实只动文档**（`invariant_selfcheck` 在全仓 `*.ts` 0 命中；无任何测试读该行字面）⇒ 未削弱任何守卫；新增 ⑱（预算耗尽路径）判别性成立，负对照 `kind` 把它与 C4① 明确区分
- **最终门禁（在最后一次编辑之后，指挥侧实跑）**：`npx tsc -b` = **exit 0**（无输出）；`npm run test:all` = **exit 0**（根 `169 files / 2180 passed | 6 skipped`；`apps/web` `11 files / 120 passed`）
  - **诚实注记**：同一状态的首跑曾出现 `1 failed | 2180 passed`（exit 1），两轮之间**无任何写操作**，重跑不复现 ⇒ 判为**负载诱发的假红**（本仓既有同类记录：Windows 原子写 rename EPERM 间歇 flaky，见 `ci.yml` 注释与 `tasks/113`）。判据以重跑为准，但该次假红如实登记，不掩盖。
- **结论**：**准予提交**。§6 的未闭合项（M03 回合重叠口径裁决、C4① `:210/:211` 独立突变、M02/M03 行文档⇄代码守卫、⑤ 反引号词法）作为**后续卡输入**保留，不阻断本次提交。

## 11. C7b 修正（按 C7 阻断项 A/B；2026-09-13，由人类裁决后派卡，非 Fix→Re-test 自循环）

独立评审 C7 判 **FAIL**，阻断项 A = 收窄所用条件「单一、无重叠、无不可重试错误」**装不下**实现里真实的
第三条反例路径（`AgentLoop.ts:636` 的 `retryable` 为假有**两条**来源：① 类别不可重试；② **类别可重试
但重试预算耗尽** `attempt > maxRetries`）。C7b 卡（Mission `tasks/C7b-fix-per-review.md`）修正如下：

1. **条件统一为"成功收尾的回合"**，并**并列登记两类反例**（同走 `AgentLoop.ts:462-463`）：`Telemetry.ts`
   类注释（权威处）、`telemetry.test.ts` 文件头 BRIEF、`docs/ARCHITECTURE.md` §4.11 行、
   `docs/product-evolution/PRODUCT-STATE.md` 欠账行；`docs/BENCHMARK-SPEC.md` M02/M03 两行同步改准
   （M02 原「成功收尾」已正确，只补②；M03 由窄口径改为「成功收尾且未被另一个 `runTurn` 重叠」+ 三类反例）。
2. **新增判别性用例 ⑱**（`telemetry.test.ts`）：`RATE_LIMITED` 可重试类别 + `maxRetries:1` ⇒ 预算耗尽 ⇒
   断言 `before_turn` 已发、`turn/end` 记录数 0、`live.turns(1) ≠ replay.turns(0)`，并带负对照
   （两次失败 `kind` 均为 `RATE_LIMITED`、`decision` 为 `['retry','abort']`）把本路径与「类别不可重试」分开。
3. **§6 未闭合项 2 在本卡被记为已修**：`telemetry.test.ts` 原 `:81`「补用例是另一次改动」的过时指针已随 C7b 改准。

### 11.1 【本卡推翻了 §5-③ 的一句声明，如实登记】`docs/EVENT-SPEC.md:605` 已就地收窄

- **原声明**（§5-③ 与 §2 末尾）：「`docs/ARCHITECTURE.md:176` 就地收窄 …（纯文档，**未改 EVENT-SPEC**）」。
- **C7b 后的实际**：`EVENT-SPEC.md:605` 的**无条件**形式「…全部配对且编号连续；任一缺失 = 日志腐败」
  与收窄后的 `ARCHITECTURE.md:176` **互否**（C7 阻断项 B）。经人类裁决按"纯文档收窄"处置 ⇒ 该行已改为
  「**除已登记例外**，任一缺失 = 日志腐败」，并列举三条已登记例外（含**两类**缺 `turn/end` 的来源）+
  指向 `ARCHITECTURE.md:176` 与 `PRODUCT-GAP-MAP.md:430/:431/:446`。
- **为什么这仍是"纯文档"（未改契约语义、未改运行行为）**：`git grep -n "invariant_selfcheck\|selfCheck"`
  在 `*.ts` 里 **0 命中** ⇒ H12 invariant 自检**尚未实现**，`:605` 是对**未来组件**的描述；收窄只是把
  实现**已经产生**的已登记例外写进规格，未改任何字段语义/代码/行为。
- 残余：§6 未闭合项 1（`:81` 过时指针）已清；§6 未闭合项 3（C4① `:210/:211` 缺独立突变实测）仍在。
