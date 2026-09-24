# DSH Recovery Report

## 1. 当前项目状态
当前项目为 `E:\Code_file\Projects\Composable_Agent_Harness`（TypeScript monorepo，npm workspaces，Node 24）。仓库处于**可交接的静止状态**：HEAD = `ba173d4`。上一轮收尾前的实测是 `tsc -b` 干净且 `npm run test:all` exit 0（根 2175 passed + 6 skipped、`apps/web` 120 passed）；**该数字已由接手会话复跑复核**（见 §9）：`tsc -b` exit 0、`npm run test:all` exit 0，根 **2177 passed + 6 skipped**、`apps/web` **120 passed**（多出的 2 项是接手会话新增的用例）。**接手会话结束时工作树有 6 个已修改文件（均未提交，清单见 §3）与 2 个未跟踪的恢复文件**（`DSH_RECOVERY_CHECKPOINT.md`、本报告）。**接手会话的最终独立验收为 FAIL（见 §9「最终独立验收」），故该切片按硬停止条件 B 未提交** —— 代码与文档改动仍在工作树里，方向已被裁决保留、但其中的依据性断言需重新论证。项目自带记忆基座齐全（`AGENTS.md`、`docs/product-evolution/PRODUCT-STATE.md`、`PRODUCT-GAP-MAP.md`），恢复点 `DSH_RECOVERY_CHECKPOINT.md` 已存在（上一轮由本会话创建）。

## 2. 本次长运行实际成果
| 改动 | 证据 | 状态 |
|---|---|---|
| 流式解析「静默丢数据」族（两个 provider 的身份冻结/覆盖、`{}` 种子、截断半帧、重复 `content_block_start` 全部形态） | commits `e5c4e97`、`dc87a4f`；`packages/llm/src/stream/parseAnthropic.ts`、`parseOpenAI.ts` | KEEP |
| finish-reason 收敛为**唯一表** `wireFinishReason` | `packages/llm/src/finishReason.ts`；三个 provider 委托 | KEEP |
| `kind='error'` / `length` 截断 / BeforeTurn 拦截的**全部已识别消费面** | commits `8cd6816`、`5b1f907` 等；`apps/cli`、`apps/local-server`、`apps/web`、`benchmarks/runners` | KEEP |
| `before_turn` 否决的审计缺口（stage 绑定共享词表） | `packages/core/.../AgentLoop.ts` + `packages/shared/src/events.ts` | KEEP |
| 会话日志补持久记录（`llm/retry`、`request/header`、`turn/end.stats` 加法字段） | commits `195090e`、`437123d` | KEEP（消费面见 §3） |
| 环境变量读法收敛（10 个状态根 + 1 个数值参数，空/纯空白按未设置） | `packages/shared/src/envRoot.ts` 及 10 处调用点 | KEEP |
| 「两个 vitest root」的可执行入口（`test:all` + CI + 门禁判据由实跑 root 清单插值） | `package.json`、`.github/workflows/ci.yml`、`release-gates/gates.ts` | KEEP |
| M13/M14 指标接上真实生产者 | commits `8ba59a9`、`5b1f907`；`packages/telemetry/src/Telemetry.ts` | REVIEW（M13 只覆盖 team_end 与基准 evaluator 臂两条通路） |
| `measured` 声明 ⇄ 产出的双向对账（当前仅 warn + 报告留痕） | `benchmarks/runners/src/runner.ts` 的 `auditMeasuredDeclaration` | REVIEW（是否收紧未决） |
| 文档与事实一致性批次 + 文档⇄源码守卫 | `docs/BENCHMARK-SPEC.md`、`spec-manifest-parity.test.ts`、`unwiredRecords.test.ts` | KEEP |

## 3. 未提交 / 半成品
最多 5 项。上一会话收尾时经 `git diff --stat` 与 `git diff --cached --stat` 核实**没有未提交的代码改动**；**接手会话新增了 6 个已修改、未提交的文件**（`packages/telemetry/src/Telemetry.ts`、`packages/telemetry/src/telemetry.test.ts`、`packages/shared/src/unwiredRecords.test.ts`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`；改动、证据与边界见 §9。按纪律 27 未 `git add -A`；**最终独立验收 FAIL ⇒ 未提交**，提交与否不再是"待裁决"，而是**先解决 §9「最终独立验收」里被证伪的三处断言**）。
1. 未跟踪文件 `DSH_RECOVERY_CHECKPOINT.md`（上一轮的恢复点，按协议保留）。
2. 未跟踪文件 `DSH_RECOVERY_REPORT.md`（本报告）。
3. `request/header` 与 `turn/end.stats` 的**其余**加法字段：**已落盘、仍无回放消费方**（有意如此并已标注，不算失控半成品）。**`turn/end` 本身的身份面（→M02）与 `stats.toolCalls`（→M03）已由接手会话接线**，见 §9。
4. `compaction/summary`(B15)、`session/end-seed`(B11)、`audit/safety`(B21)：有声明、零类型零产零消（守卫已加，接线时会先红）。
5. `measured` 对账处在 warn 档：是**刻意保留的中间状态**，收紧与否属决策。

## 4. 当前风险
1. **四条产品语义决策未定**（`--model ''` 挡 env 回落、真实 provider 无 model 时发字面量 `"mock-model"`、`denials`/M12 实跑双计、`measured` 是否收紧）；在未裁决前改动这些点会破坏既有对比口径。
2. 把 `measured` 收紧成 fail-loud 会**打红 25 个场景里的 23 个**，必须先补声明或补生产者。
3. 被跟踪的 `benchmarks/reports/release-report.{md,json}` 与当前判据**已不一致**（文档已加指引，产物未刷新）；刷新会改写被跟踪产物**并调用真实模型接口**。
4. 本会话上下文接近上限，在同一会话继续推进有质量下降风险。
5. 部分"已完成"结论**本轮未复核**（协议禁止跑测试矩阵），属 UNKNOWN 级证据。**接手会话已复核其中两项**（`tsc -b` 与 `npm run test:all` 全绿，见 §9），其余结论仍未复核。

## 5. 建议保留
1. `packages/llm/src/finishReason.ts` 的唯一表，以及流式解析的身份冻结与三形态折入。
2. `packages/shared/src/envRoot.ts` 与 10 处调用点（含 `SessionRegistry`、`ReviewHandoffStore`、engine 三个根）。
3. 双 root 测试入口 `npm run test:all`，以及 CI/门禁判据由实跑 root 清单插值的设计。
4. `before_turn` 审计记录、流诊断计数消费者、M14 `approval_asks`/`steers` 的真实计数。
5. 新增的文档⇄源码守卫（`spec-manifest-parity.test.ts`、`unwiredRecords.test.ts`、`auditRecordWiring.test.ts`）。
6. 接手会话的 `turn/end` 接线（`Telemetry.finalizeRecord` 的 `case 'turn/end':` + `liveTurnIds` 身份去重，M02/M03 在纯回放下不再恒 0），以及守用例 ⑤ 的词法修正（按"未消费"切段后各自只扫反引号 token）。**该切片尚未提交**（最终独立验收 FAIL，见 §9：「成功单回合」路径的行为与去重是对的，被证伪的是我们为它写的三处"等式/同数"断言）。

## 6. 建议暂缓或丢弃
1. **暂缓**：把 `measured` 对账收紧为 fail-loud（需先补 20 个场景的声明或补 M08/M11 的生产者）。
2. **暂缓**：统一 `denials` 的「事件 + 记录」去重（属口径变更，会动既有 `denials=2` 用例）。
3. **已部分完成（接手会话）**：`turn/end` 的身份与 `stats.toolCalls` 已接线（见 §9）；**仍暂缓** `request/header` 与 `turn/end.stats` 的其余字段（`stats.steps`/`stats.tokensUsed`/`stats.costEstimate`、`toolCallsWithoutEnd`，理由逐条落在 `Telemetry.ts` 类注释与 `docs/ARCHITECTURE.md` §4.11）。**注意**：该接线**未通过最终独立验收、未提交**——`stats.toolCalls` 那条等式的成立范围只到"成功单回合"，理由与反例见 §9「最终独立验收」。
4. **暂缓**：刷新 `release-report.{md,json}`（会动被跟踪产物并消耗外部 API 配额）。
5. **丢弃**：无——本轮未发现方向性错误的改动；旧 `tasks/*.md` 里关于「全量＝root only」的历史表述属当时坐标，不必逐条追改。**（接手会话两轮的结论同此：被独立验收判 FAIL 的是**断言强度**与依据，不是实现方向——方向已由人类裁决保留，见 §9.1。）**

## 7. 下一步
1. **裁决四条产品语义**：范围＝§4 第 1 项列的四点；产出＝把决定写进 `PRODUCT-STATE.md`；验证＝文档与代码行为一致且既有用例不被无理由翻转。
2. **单独刷新发布报告**：范围＝只重跑 `benchmarks/runners/src/run-release-gates.ts` 并处置产物；验证＝产物内嵌判据与 `gates.ts` 当前判据一致；注意按纪律 27 处置（不要 `git add -A`）。
3. **~~接线或改文档（二选一）~~ 接线已落地、但最终独立验收 FAIL ⇒ 未提交（接手会话，选的是 `turn/end.stats`）**：`Telemetry.finalizeRecord` 出现 `case 'turn/end':` 分支并带去重用例（⑯⑰），文档与守卫同步更新（见 §9）。**先处置 §9「最终独立验收」里被证伪的三处断言，再谈提交。** **剩下 `request/header` 这一半仍未做**；`turn/end.stats` 的残余字段按 §6.3 继续暂缓。

## 8. 恢复原则
下一次开发：
1. 新开干净会话
2. 先读本报告
3. 一次只选择一个任务
4. 不自动恢复旧 Goal
5. 不重新启动此前的开放式产品审计循环
6. **工作树里那 6 个未提交文件是一次「接线做对了、断言写强了」的切片：先读 §9.1，不要直接提交**（提交前必须先处置被证伪的三处断言；`request/header`、`costEstimate`/M11、`before_stop`、`denials`、`measured`、`release-report` 均不在该切片的授权范围内）

## 9. 接手会话的更新（第一轮：接线）
**任务**：§7.3 那一条，二选一里选 `turn/end.stats`（不扩展 scope：只做这一项，其余一律只记录不修）。

**做了什么**
- 代码：`packages/telemetry/src/Telemetry.ts` 的 `finalizeRecord` 新增 `case 'turn/end':`，取**回合身份**（`turnId` → M02 `turns`）与 **`stats.toolCalls`**（→ M03 `toolCalls`）；新增 `liveTurnIds`（`before_turn` 载荷里的 `turnId`）做身份去重。改前这一支不存在 ⇒ 纯回放的 M02/M03 恒 0，而这两个指标在 25 个有 manifest 的场景里**全部**被声明为 `measured`。**原写在此处的「「实时跑一遍 + `finalize`」与「同一份日志纯回放」给出同一个数」已被最终独立验收证伪**（反例见本节末），**实际成立范围只到"成功单回合"**。
- 刻意不取：`stats.steps`（模型调用被中断时 `beginStep` 已计、`after_model` 未发 ⇒ 该轮 `stats.steps` 比事件条数多，实时与回放对不上）、`stats.tokensUsed`（每轮汇总，与 `after_model` 的逐调用量相加即双计、且拆不成 M06/M07）、`stats.costEstimate`（**没有任何 shipped provider 上报它** ⇒ 接了就是恒 0 的假指标；注意类注释里原写的"全仓没有铸造点/本仓没有对应指标定义"两句**过强、已被证伪**，见 §9.1 第 3 条）、`toolCallsWithoutEnd`（无指标定义）。两条已知边界也写进类注释：`Session.loadExisting` 合成的崩溃收尾记录 `stats` 全零 ⇒ 该轮计 1 个回合、0 次工具调用（下界，不是"测得 0 次"）；去重成立的前提是 `attach` 在回合开始前完成（本仓唯一组合根 `composeHarness` 即如此），回合中途 `attach` 会让该轮 `toolCalls` 多计。**（事后：这两条边界只覆盖了"崩溃恢复"与"中途 attach"，漏掉了异常路径与回合重叠——正是 §9.1 的两条反例。）**
- 文档/守卫同步：`docs/ARCHITECTURE.md` §4.11（`turn/end` 移入"已消费"，未消费段改写成带理由的 stats 字段）、`docs/BENCHMARK-SPEC.md` §4.1 的 M02/M03 行、`unwiredRecords.test.ts` 的同族注释、`PRODUCT-STATE.md` 的当前欠账行（历史 Round 叙述未改写）。守用例 ⑤ 顺带修正一处词法缺陷：它原先扫**整个**单元格，只因旧"未消费"段恰好没给类型加反引号才碰巧成立；现按"未消费"切段后各自只扫反引号 token。新增 ⑯（纯回放重建 M02/M03，含"`steps` 必须仍为 0"的负对照）与 ⑰（防重复计数、两侧同数）。

**验证（两项都在最后一次**代码**编辑之后执行）**：`npx tsc -b tsconfig.json` ⇒ exit 0；`npm run test:all` ⇒ exit 0，根 **2177 passed + 6 skipped**（上一轮 2175，多出的 2 项即 ⑯⑰）、`apps/web` **120 passed**。判别性：删掉 `case 'turn/end':` ⇒ ⑯⑰ 红；去掉 `liveTurnIds` 去重 ⇒ ⑰ 的 turns 由 1 变 2；把 `stats.toolCalls` 换成 `stats.steps` ⇒ ⑯ 的负对照红。**（收尾轮复跑，同样 exit 0：根 168 文件 / 2177 passed + 6 skipped、`apps/web` 11 文件 / 120 passed；全文原始输出保留在 `%TEMP%\cah-accept-run.txt`。）这些"判别性"是**静态推理**，未做突变实测。测试全绿**不等于**验收通过 —— 见 §9.1。**

**一次未指认的间歇性失败（如实记录）**：改完本文档前的某一次 `npm run test:all` 以 exit 1 结束，根 **167 passed (168) 文件、2127 passed + 6 skipped**（即**有一个文件整片未过**，约 50 项）。当时我把输出用 `Select-String` 过滤后再看，**没有留下失败文件的名字** —— 这是我的操作失误，不是测试的问题。随后三次复跑均全绿（最后一次即上面的收尾轮）⇒ 按"若本轮完整测试通过则不继续调查"的指令，**不再追查**。当时的机器状态：我先后 `job_kill` 过两个**同仓**的 vitest 后台任务，且 `Get-CimInstance` 显示**另一个项目**（`E:\DeepSeek_Harness\workspace\2026_09_08\model-infra-kit`）的 `vitest run` 与 `node --test` 正在并发跑。⇒ **可复现的机制未证实**；这一条按"环境竞争"记录，**不是**本卡改动的已知回归。若再遇到，请**原样保留完整输出**再定位（不要先过滤）。

## 9.1 最终独立验收（第二轮）：**FAIL**（判决前未做任何修复）

**流程**：1 个全新上下文的对抗性 Reviewer（只读、不得改码、不得建子 Agent），验收对象＝工作树里那 6 个未提交文件；判定标准＝①接线与防双计成立且用例可判别 ②`stats.toolCalls` 那条等式在源码层站得住 ③四条"不消费"理由与源码相符 ④文档⇄代码无矛盾 ⑤无"描述强于事实" ⑥未超范围。父会话同时复跑：`npx tsc -b` ⇒ exit 0；`npx vitest run packages/telemetry packages/shared benchmarks/runners/src/runner.test.ts` ⇒ **138 passed**；`npm run test:all` ⇒ exit 0（根 168 文件 / 2177 passed + 6 skipped、`apps/web` 11 文件 / 120 passed）。

**结论**：**FAIL**，命中的正是验收标准预先声明的第 ② 条。切片在**正常单回合**路径上的行为是对的（`case 'turn/end':` 取值正确、`:410` 的身份去重成立、⑯⑰ 在成功回合上绿，F/范围项亦判通过：只有 6 个文件，未碰 `request/header`、`costEstimate`/M11、`before_stop`、`denials`、`measured`、`release-report`），被证伪的是**我们自己新写入的三处断言**：

1. **「有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数 == `stats.toolCalls`」不成立。** 反例（评审探针 2，同一 `AgentLoop` 上两个 `runTurn` 重叠、工具 signal-blind）：`raceToolRun` 捕获的是**当时**的 signal（`AgentLoop.ts:946-948`），而 catch 守卫读的是**当前** `this.interruptCtl.aborted`（`:893-913`），且 `:451-464` 会把 `TurnInterruptedError` 折成 `kind='interrupted'` 并继续走到 `:528` 落 `turn/end` ⇒ "不发 `after_tool` 就 rethrow、那一轮没有 `turn/end`"这条论证链断裂；又因 `LoopState` 是**每个 loop 一个**（`:136`）且 `beginTurn` 会归零（`State.ts:20-26`），旧回合落盘时读到的是**新回合**的计数器。实测：`turn/end` 存在、该轮 `after_tool`=1、`stats.toolCalls`=0。
2. **「记录条数 = 回合数，与 `before_turn` 事件数逐字相等」+「实时 == 纯回放」不成立。** 反例更简单、**无并发**（探针 3，单回合、provider 抛不可重试错误）：该回合发过 `before_turn` 却**根本没有 `turn/end` 记录** ⇒ 实测 `live.turns=1 / replay.turns=0`；同一条路径也是上面那条"唯一不发事件的路径会 rethrow"论证的反例。本仓**自己早已记录过**这个配对会被异常路径破坏（`docs/product-evolution/PRODUCT-GAP-MAP.md:430`，定级：中），我却把它当成成立的前提写死了。
3. **`costEstimate` 那段的措辞过强**：`Telemetry.ts:213-214` 括注的"全仓只有类型声明与 `AgentLoop` 的累加，没有铸造点"被 `AgentLoop.log-evidence.test.ts:48/51`（测试 provider 上报 `costEstimate` 并断言落进 `turn/end.stats`）证伪；"本仓也没有对应指标定义"被 `packages/shared/src/metrics.ts:7`（`MetricId` 含 M11）与 `docs/BENCHMARK-SPEC.md` §4.1 M11 行证伪。**实质结论（没有任何 shipped provider 上报它、M11 的产者在 Cross-Harness 适配器契约里）仍然成立**，错的只是那两句绝对化措辞。

另有两条**未处理**的一致性问题（连带 5 条见下方清单）：`packages/shared/src/unwiredRecords.test.ts:167-169` 仍把 `turn/end.stats` 当作"记录已落盘、回放侧无消费方"的例子，与同一文件 `:38-43` 的更正自相矛盾（本卡只改了后者）；`docs/BENCHMARK-SPEC.md:576` 的 M03 行也带上了第 1 条那条被证伪的等式。

**未提交**：因硬停止条件 B（Reviewer FAIL）**未执行 `git add`、未产生任何提交**，HEAD 仍为 `ba173d4`。按指令**禁止** Fix→Re-test 循环，本轮到此停止，**没有做任何修复**。工作树与验收开始时逐字一致（6 个已修改文件 + 2 个未跟踪恢复文档；评审未留下残余文件）。

**未处理发现（5 项，按重要性）**
1. 被证伪的第 1、2 条等式同时写在三处（`Telemetry.ts` 类注释、`docs/BENCHMARK-SPEC.md:576`、以及为 `stats.toolCalls` 作保的那段论证），而它是整个切片"敢把 `stats.toolCalls` 当回放源"的**唯一依据** ⇒ 实现依据需重新论证或收窄（例如只对未被并发打断的回合计、或改取别的身份/来源），**属人类裁决**。
2. `stats.toolCalls` 在"回合重叠 + 旧回合被 abort"这条受支持路径上会读到新回合的计数器（`packages/application/src/session/SessionController.ts:159-167` 明文承认该语义、`apps/local-server/src/server.ts:379-381` 的 POST /turns 无并发闸门）⇒ M03 的回放侧取值在那些路径上不可信；M02 的"两侧同数"同样只对成功单回合成立。
3. `costEstimate` 括注需按第 3 条改成"没有任何 shipped provider 上报它"这一准确说法（其余三条不消费理由经评审逐条核对**属实**）。
4. `unwiredRecords.test.ts:167-169` 与 `BENCHMARK-SPEC.md:576` 的连带矛盾（见上）。
5. ⑯⑰ 的"删哪行会红"从未做突变实测，且**成功单回合以外没有任何用例**覆盖；按纪律 24，这两条判别性主张目前属未实测。

**同一轮里发现、未处理的其它（范围外）事项**：`request/header` 仍未接线（§7.3 的另一半）；`costEstimate` 的缺口在**产物侧**（没有任何 shipped provider 上报它）⇒ M11 在本 lane 仍不可产，§7.1/B003·B004·B005 声明 M11 的欠账原样；`interrupts` 对"崩溃恢复冒充人工打断"无法用记录面消除（合成收尾与真实收尾在文件里同形），仍只取事件面；`before_stop` 的裁决仍是丢弃的潜伏死缝（`AgentLoop.ts` 的 `void stop`）；被跟踪的 `release-report.{md,json}` 仍是旧判据快照。以上均已在项目文档里标注，本轮未动。另：`DSH_RECOVERY_CHECKPOINT.md` 第 19 行那句"`request/header` 与 `turn/end.stats` 加法字段仍无回放消费方"随本切片（**未提交**的状态）已不准确，本轮按"只更新本报告"的指令**未改**它。
