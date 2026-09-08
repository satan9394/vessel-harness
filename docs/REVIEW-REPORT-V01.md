# V0.1 独立核验报告（Evaluator Review Report）

> 核验对象：Composable Agent Harness 第二阶段 V0.1 实现（docs/MISSION-V0.1.md 第六节 6 条验收标准）
> 核验角色：独立 Evaluator（Generator/Evaluator 分离——本报告作者不参与实现，只做取证核验）
> 核验日期：2026-09-05
> 工作区：`C:\work\Vessel_Harness`（Windows / PowerShell / Node v24.14.0 / npm 11）
> 权威依据（已全部通读）：`docs/MISSION-V0.1.md`（§5 M1–M7 / §6 验收 / §8 汇报）、`docs/ARCHITECTURE.md`（core 薄核、依赖零环、policy 不反向依赖 tools、事件两域、ApprovalPolicy 默认 never）、`docs/DESIGN-DECISIONS.md`（16 决策点）、`docs/V01-IMPLEMENTATION-NOTES.md`（实现方自述——以下每条均独立实测验证，不采信自述）。

---

## 一、核验方法（命令清单）

| # | 命令 | 用途 |
|---|---|---|
| 1 | `npx vitest run` | 验收 1：全量单测 |
| 2 | `npx tsc -b tsconfig.json` | 验收 1：全仓类型构建 |
| 3 | `node apps/cli/dist/cli.js --help` | 验收 2 前置：确认 dist 与参数契约 |
| 4 | `node apps/cli/dist/cli.js run --workspace <%TEMP% 临时目录> --prompt "请阅读 README.md 并总结" --policy <repo>\configs\policy.default.yaml --behavior <repo>\configs\behavior.default.yaml` | 验收 2：端到端冒烟（临时工作区含唯一标记串，未污染仓库） |
| 5 | `npx tsx scripts/demo-policy-deny.ts` | 验收 3：Policy DENY 演示 |
| 6 | `node apps/cli/dist/cli.js run --bench B001|B002|B003|B004|B005 --workspace <repo> --out <%TEMP% 报告目录>` | 验收 4：5 个场景全量运行（out 全部用临时目录） |
| 7 | 读取 `docs/V01-IMPLEMENTATION-NOTES.md` | 验收 5：交付说明核对 |
| 8 | import 图谱 grep（`from '@vessel/...'` 全仓扫描）+ 核心文件精读 + 边界路径实测探针（临时脚本，位于 %TEMP%） | 验收 6：依赖方向 / 软硬分离 / Gen-Eval 分离 / 代码质量 |

约束遵守：全程 PowerShell；未做任何永久删除（全部临时目录用唯一命名留在 %TEMP%，探针脚本亦在 %TEMP%）；未修改任何实现代码（只读审查，唯一写入的仓库文件是本报告）。

---

## 二、逐条验收结果

### 验收 1 — V0.1 范围内每项有可运行代码 + 对应 Vitest 测试通过　**结论：PASS**

**证据（实际命令输出节选）：**

`npx tsc -b tsconfig.json` → `tsc exit: 0`（构建通过，`apps/cli/dist/cli.js` 可执行）。

`npx vitest run`（工作区根目录）：

```
 Test Files  11 passed (11)
      Tests  59 passed (59)
   Duration  3.23s
```

11 个测试文件与交付说明声称的「11 文件 / 59 用例」完全一致：

```
packages/core/src/events/EventBus.test.ts      (5)   — 事件原语
packages/core/src/session/Session.test.ts      (5)   — 会话
packages/core/src/agent-loop/AgentLoop.test.ts (4)   — agent loop
packages/policy/src/policy.test.ts            (11)   — policy
packages/tools/src/tools.test.ts              (10)   — tools
packages/context/src/context.test.ts           (5)   — context/compaction
packages/llm/src/provider.test.ts              (4)   — llm
packages/agents/src/evaluator.test.ts          (4)   — evaluator
packages/telemetry/src/telemetry.test.ts       (1)   — telemetry
apps/cli/src/cli.test.ts                       (4)   — cli
benchmarks/runners/src/runner.test.ts          (6)   — bench-runners
```

**抽查测试内容（3 个以上核心文件，确认覆盖核心路径）：**
- `AgentLoop.test.ts`：读→工具→回答一轮闭环（断言 finalText 含 GOLDEN-PHRASE-42、toolCalls=1、audit/denial=0）、纯文本即停、denied 工具回灌、max_steps 硬顶 budget。
- `policy.test.ts`：四件套编译、未知 key fail loud、①denied_tools ②shell deny(never_auto) filesystem.protected、readonly allowlist 放行、approval:never 服务内强制（fail-closed）、⑥profile 比较、guard 不翻转。
- `cli.test.ts`：--help/--version、run 冒烟（CLI-SMOKE-GOLDEN-77 + kind=success）、Policy DENY 演示自动化断言。
- 套件内另有 runner.test.ts（B001–B005 offline 断言）等全绿。

11 个类别（events/session/agent-loop/policy/tools/context/llm/evaluator/telemetry/cli/bench-runners）均有测试文件且通过。M1–M7 范围内每项均有 src 实现（core 5 文件 / llm 4 / behavior 3 / context 4 / tools 7 / policy 6 / runtime 4 / memory 2 / skills 1 / agents 2 / telemetry 2 / shared 7 / apps-cli / benchmarks-runners）。

### 验收 2 — CLI 端到端冒烟：至少 1 轮「读→工具→回答」　**结论：PASS**

**证据（实际命令输出节选）：**

临时工作区 `%TEMP%\cah-review-smoke-1775292449\README.md` 内容含唯一标记串 `REVIEW-EVAL-MARKER-77A1`。

```
=== turn turn_1788616521287_2ded2f kind=success steps=2 toolCalls=1 ===
=== 最终回复 ===
已通过 Read 工具读取工作区文件。内容开头：
This is the smoke test workspace.
Marker: REVIEW-EVAL-MARKER-77A1
Nothing else important here.
会话日志: ...\cah-review-smoke-1775292449\.harness\sessions\sess_...\session.jsonl
EXIT=0
```

逐项核对：
- `kind=success` ✔；`toolCalls=1` ✔（≥1）；steps=2（读→回答 1 轮闭环）；
- 最终回复含标记串 `REVIEW-EVAL-MARKER-77A1` ✔；
- 会话日志 JSONL 存在 ✔：`exists=True`，11 行记录，类型齐全 `turn/start, user/message, step/start×2, tool/call, tool/result, assistant/attempt, step/end×2, assistant/message, turn/end`，且 `tool/result` 内容即 README 真实内容（含标记串）——「模型可见 ⟺ 已记录」成立。

### 验收 3 — Policy 演示：shell.deny 返回 DENY + 审计事件，而非仅 prompt 劝阻　**结论：PASS**

**证据（实际命令输出节选）：**

`npx tsx scripts/demo-policy-deny.ts`：

```
=== 最终回复 ===
命令已被策略引擎拒绝（不会真正删除任何文件）。
=== audit/denial × 1（Policy 硬执法证据）===
  tool=Shell ref=shell-deny:destructive-delete reason=dangerous command category: destructive-delete (never_auto, any profile)
=== 破坏未发生：node_modules/pkg/index.js 仍存在 = true ===
DEMO_EXIT=0
```

逐项核对：
- DENY 来自引擎裁决而非 prompt：ruleRef=`shell-deny:destructive-delete`（与验收要求「类似 shell-deny:destructive-delete」一致），reason 明示 never_auto 语义 ✔；
- `audit/denial` 审计事件落日志 ✔（demo 内 `replay()` 过滤出 1 条）；
- 最终回复说明被拒 ✔；
- 被删目标文件仍存在（`node_modules/pkg/index.js` 存在 = true）✔；
- 脚本自身以 `denials>=1 && nodeModulesStillThere` 作为退出码判据（0）✔。

**自动化断言核对：**
- `apps/cli/src/cli.test.ts`（用例 4）：`denials.length>=1`、`d.toolName==='Shell'`、`reason` 匹配、`finalText` 含「拒绝」、`node_modules` 目录未被创建 ✔（该用例在 vitest 全量中通过）；
- `packages/policy/src/policy.test.ts`：`② deny rule (shell destructive-delete) denies with never_auto semantics`（ruleRef 含 destructive-delete）、`filesystem.protected write is denied by rule, not by prompt`、`approval:never is service-enforced (fail-closed)`、`guard: pre-existing deny cannot be flipped` ✔。

### 验收 4 — benchmarks 首批 5 个 scenario 有 fixture 且本地实现能跑（JSONL 报告）　**结论：PASS**

**证据（实际命令输出节选）：**

- fixture 存在：`benchmarks/fixtures/B001..B005/`（B001 README+a/facts.txt+b/util.js、B002 src+extras×24+tests、B003 src/fee.js、B004 src×4+verify.js、B005 config.json）。
- scenario 判据机器可执行：`benchmarks/scenarios/B001..B005.yaml` 的 `pass:` 全部为可执行断言类型——`file_content`（golden 串 / B005 `json_path`+`golden_expr` 独立重算）、`no_mutation`（SHA-256 快照比对）、`tool_family_seen/no_tool_family`（会话记录）、`run_check`（隐藏测试 exit code：B003 `node test/fee.test.js`、B004 `node verify.js`）、`file_absent`、`git_diff_scope`、`metric_le`。

**5 个场景全量运行**（验收要求 B001 + 抽查 2，我全部 5 个独立跑，out 均为 %TEMP% 临时目录，未污染仓库）：

```
=== benchmark B001 PASS (74ms) ===   file_content / no_mutation / tool_family_seen / no_tool_family ×2
=== benchmark B002 PASS (173ms) ===  file_content / tool_family_seen / metric_le
=== benchmark B003 PASS (216ms) ===  run_check / tool_family_seen ×2
=== benchmark B004 PASS (197ms) ===  run_check / file_absent / git_diff_scope / tool_family_seen ×2
=== benchmark B005 PASS (182ms) ===  file_content (json_path+golden_expr) / tool_family_seen
EXIT=0（全部）
```

报告结构核对（B001 报告实例）：
- `run_*/run_*.jsonl` 存在，行类型含 `meta`(1) / `metric`(M02,M03,M04,M05,M06,M07,M09,M10,M12,M13,M14) / `event`(tool/call) / `assert`(a1–a5) ✔；
- `summary.json` 存在，含 `scenarioId/runId/success/metrics/asserts/sessionLog` ✔；
- 每个 run 内含 `workspace/` 副本 + `.harness/sessions/*/session.jsonl` ✔。
- 仓库内 `benchmarks/reports/B00X/run_1788616307*/` 为实现方自己的历史运行产物（时间戳早于本核验），本核验全部产出在 %TEMP%，仓库未被污染。

### 验收 5 — 交付说明 docs/V01-IMPLEMENTATION-NOTES.md　**结论：PASS**

**核对结果：** 文件存在（114 行），包含：
- §1 模块地图（单仓多包布局、依赖方向铁律、Provider seam 说明）✔；
- §2 如何运行（install/build/test、CLI 单发、真实模型、bench、demo 六组命令）✔；
- §3 测试命令与覆盖（`npm test` → 11 文件/59 用例，包级覆盖表）✔；
- §6 已知限制与后续（sandbox OS 级后端未实现、approval 固定 never、hooks 桥未实装、compaction 摘要默认启发式、live 车道未验证、git 未 init 等）✔。

本报告对其 §4 的 6 条自述已独立实测（见上文各条），自述与实测一致。

### 验收 6 — 独立审查（Evaluator 式复审）　**结论：PASS（附发现，无阻断级问题）**

**6.1 依赖方向（import 图谱全仓扫描，源码层）：**

| 包 | 依赖 | 判定 |
|---|---|---|
| core | 仅 `@vessel/shared` + 包内（events/session/state） | ✔ core 不 import memory/skills/runtime/sandbox/agents（源码无任何机制包 import；`AgentLoop.test.ts` 引用 @vessel/llm|tools|runtime 属测试侧组合，非实现依赖） |
| policy | 仅 `@vessel/shared` + 包内 `risk/globmatch.ts` | ✔ 不反向依赖 @vessel/tools，glob 匹配器包内自备 |
| tools | `@vessel/shared` + `@vessel/runtime`（sandbox seam） | ✔ 符合 ARCHITECTURE §4.5 |
| runtime / llm / behavior / agents | 仅 `@vessel/shared` | ✔ |
| context / telemetry | `@vessel/shared` + `@vessel/core`（公开接口 Session/EventBus） | ✔ |
| apps/cli（组合根） | 依赖全部机制包的公开接口 | ✔ 唯一组装点，机制包之间无互相 import 实现细节，无环 |

**6.2 软/硬分离是否真落地（非只写 prompt/behavior IR）：**

- `configs/policy.default.yaml` 的 `shell.deny: [destructive-delete, disk-format, partition-write]` 经 `policy/risk/Compiler.ts` 编译为运行时 deny 规则（正则集，含 `rm -rf`/`del /s`/`Remove-Item -Recurse` 等），`PolicyEngine.decide()` 决策序 ①denied_tools→②deny→④ask→⑤allow→⑥profile，`approval: never` 服务内强制（fail-closed）✔；
- 接线为硬执法链：`apps/cli/src/compose.ts` 把 PolicyEngine 挂 `before_tool` waterfall 权威监听器 + `Executor` pre-execute `decide` 复核（工具层不信任调用者）+ `tools/filesystem/guards.ts` 工具层守卫（canonicalize 防 ../ 与 symlink 逃逸、protected 路径写拒绝、deny-read、NUL、10MiB 上限）✔；
- `behavior/compiler` 双通道强制：channel=runtime_policy 条目须在编译产物中找到对应策略域执法规则，缺执法即 warnings（compose 会打印 `[behavior] ...` 警告）✔；
- 实测证实：验收 3 demo 中 `rm -rf ./node_modules` 在引擎层被拒并落 audit/denial——不是 prompt 劝阻（promptGuidance 同时存在，但硬执法独立生效）✔。

**6.3 Generator/Evaluator 分离（是否存在「实现方自宣布完成」路径）：**

- benchmark runner（`benchmarks/runners/src/runner.ts` + `asserts.ts`）的 pass 判定全部机器化：SHA-256 磁盘快照比对（no_mutation/git_diff_scope）、隐藏测试真实执行 exit code（run_check）、事件日志工具族断言（tool_family_seen）、`golden_expr` 独立重算（B005 由 runner 从文件自身 seed 重算，不信任 mock 输出）；CLI `run --bench` 仅当所有 assert 为 pass 才返回 0 ✔；
- Evaluator 契约（`agents/evaluator`）：verdict met/not_met/impossible/error，Deterministic + 独立 LLM（requestKind=goal-eval）双实现；「Generator 不自证完成」在注释与契约层面落实；无任何「实现方口头宣布通过即通过」的路径 ✔。

**6.4 核心文件质量抽查（core/agent-loop、policy/engine、tools/filesystem/guards 及配套）：**

- `AgentLoop.ts`：薄核（仅 Model Call→Tool Call→Result→State Update→Continue/Stop + max_steps 硬顶 + denial breaker）；模型错误分类重试退避 ≤5；纯文本即停；A03/A12/A14/A04/A06 事件点齐备 ✔；
- `policy/engine/Engine.ts`：决策序与 guard 单调实现正确；`narrow()`（EventBus）单调性推导无误 ✔；
- `guards.ts`：canonicalize 先词法后 canonical（realpath）防 symlink 逃逸，NUL/size/protected/deny-read 全覆盖 ✔；
- `Session.ts`：append-only JSONL + 单写者租约（EEXIST 拒绝并发写）+ resume 合成 interrupted 关闭器 + surface 投影 + replaceRegion 重编号（压缩事务）✔；
- `EventBus.ts`：emit/waterfall/serial/parallel/bail + 监听器错误隔离（观察型不打断主链）✔；
- `Executor.ts`：pre-execute 策略复核 + 结果冻结 ✔；`Process.ts`：受控派生 + 超时 kill + 输出上限 ✔；`Sandbox.ts`：confine seam + enforcement=partial 透明上报（v0.1 定位一致）✔。

---

## 三、代码复审发现（问题分级：阻断 / 建议 / 观察）

**阻断（0 项）：** 无。6 条验收全部通过，未发现阻碍 V0.1 交付的问题。

**建议（2 项）：**

1. **【建议】同一意图 deny≥3 的 DenialLimitError 路径破坏 turn/end 配对不变式**
   - 位置：`packages/core/src/agent-loop/AgentLoop.ts`（`dispatchToolCall` 第 303–305 行 throw，`runTurn` 无捕获）。
   - 实测复现（临时探针，位于 %TEMP%，未改仓库）：mock 持续调用被拒 Shell 命令 →
     ```
     outcome: THREW: DenialLimitError: same intent denied 3 times: Shell
     denial count: 3
     record types: turn/start,...,tool/result  （无 turn/end）
     has turn/end: false
     ```
   - 影响：该路径下 `runTurn` 抛错，会话日志以未闭合 turn 结束（违反 D5 §8「turn/start→turn/end 配对」）；CLI 外层 catch 会报 `[cah] run failed` 并返回 1，下次 `Session.open` 会以 interrupted 关闭器自愈（可恢复，无数据丢失），但遥测/审计在当次运行看不到 turn/end。
   - 修复建议：在 `runTurn` 捕获 `DenialLimitError`，落 `turn/end kind=denied|interrupted` 后再向上抛出（或转为 kind=denied 正常返回），并补一条 ≥3 次拒绝的测试。

2. **【建议】行为编译器双通道强制为「域级」而非「规则级」核对**
   - 位置：`packages/behavior/src/compiler/Compiler.ts` `hasDomainEnforcement()`——`policy_ref=filesystem.protected` 只要策略里存在**任意** filesystem deny 规则即判通过（不核对具体 glob/规则 id）。
   - 影响：极端情况下「声称 protected 但实际未配置该路径规则」不会被编译告警捕获。当前内置策略集固定、风险低；建议按 rule id/glob 精确匹配（保留域级兜底），并对 `Compiler.ts` 中未使用的 `enforced` 局部变量（第 197–199 行）做清理或接线。

**观察（3 项，不影响结论）：**

3. 【观察】仓库内自测代码（`AgentLoop.test.ts`/`cli.test.ts` 的 `afterEach`、`Session.close()` 删 `.lease`）使用 `fs.rmSync` 清理**自建** mkdtemp 临时目录与锁文件——属测试/锁文件标准实践，但与全局「删除进回收站」铁律字面冲突，建议在代码注释或测试规范中显式豁免自建临时目录。
4. 【观察】B005 的 offline mock 车道部分自洽：mock 写入 seed=2026 且 derived 由 2026 计算，断言再从文件自身 seed 重算——判定机器化成立，但真实验证价值在 live 车道（需真实模型，交付说明已如实声明未跑）。
5. 【观察】仓库未初始化 git（`git status` → not a git repository），与交付说明 §6 声明一致；本核验未对仓库产生任何写操作（报告文件除外）。

---

## 四、VERDICT: **PASS**

6 条验收标准逐条结论：**验收 1 PASS / 验收 2 PASS / 验收 3 PASS / 验收 4 PASS / 验收 5 PASS / 验收 6 PASS**。全部满足才算 PASS 的要求达成，代码复审仅发现 2 项建议级与 3 项观察级问题（无阻断），均不影响 V0.1 交付判定。

（完）

---

## 五、建议项修复记录（总指挥轮，2026-09-05）

复审 PASS 后，2 项建议级问题已由总指挥在实现窗口之外处理并验证：

**建议 1 — DenialLimitError 路径 turn/end 配对**
- 复核现状：`packages/core/src/agent-loop/AgentLoop.ts` 的 `runTurn` 已有 catch（第 200-209 行）将 `DenialLimitError` 折叠为 `kind='error'` 并正常走 `turn/end` 落盘——代码路径已满足配对不变式（复审报告描述的是更早版本状态）。
- 补齐缺失的测试：`AgentLoop.test.ts` 新增用例「denial breaker: same intent denied >=3 closes the turn with kind=error and a paired turn/end」——注册 always-deny 的 `before_tool` 监听器 + mock 连续发同一 Shell 命令，断言 `kind='error'`、`turn/start`/`turn/end` 各 1 条配对、`audit/denial ≥ 3`、`turn/end.kind='error'`。

**建议 2 — 行为编译器规则级核对**
- 修改：`packages/behavior/src/compiler/Compiler.ts` 的 `hasDomainEnforcement` 由「域级」（任意 filesystem deny 即满足 `filesystem.protected` 声称）改为**规则级精确匹配**：`filesystem.protected` ↔ `fs-protected:*` 规则、`filesystem.deny_read` ↔ `fs-deny-read:*`、`shell.deny` ↔ `shell-deny:*`、`shell.<category>` ↔ `shell-deny:<category>` 精确 id、`tools.deny` ↔ deniedTools/`tools-rule:*`、`git.force_push` ↔ `git:force-push`；保留 id 前缀兜底。
- 新增测试：`packages/behavior/src/compiler/Compiler.test.ts`（3 用例）——① lone fs-deny-read 不再满足 `filesystem.protected` 声称；② `shell.deny` 宽松匹配 + `shell.<category>` 精确匹配；③ compileBehavior 对无对应规则的 runtime_policy 条目告警、有规则时正常渲染。

**验证结果（复跑，总指挥亲手执行）**
- `npx vitest run`：**12 files / 63 tests 全绿**（修复前 59 → +3 behavior +1 agent-loop），exit 0。
- `npx tsc -b tsconfig.json`：exit 0。

（完，含修复记录）
