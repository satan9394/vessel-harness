# EVALUATION-REPORT-19 — Round 15 独立验收（对抗立场，静态审查）

> ⚠️ **状态提示（Round 132 追加，不改正文）**：本报告是**当时**的独立评估快照——正文一律保留原样，**不追改**（改它等于篡改历史）。其中涉及的以下结论**已在本段被后续卡改变**，请看 PRODUCT-STATE.md 的当前队列：un --json 此前**不产 JSON 文档**（Round 130 起已产，且仍在补 durationMs/拦截审计）；policy status 此前**恒退 0**（Round 123 起编译失败退 1）；ench-report --json 此前**把人类摘要写进 stdout**（Round 123 起改走 stderr）。
> Evaluator：全新上下文、只读、未被告知既往结论之外的信息。
> **方法声明：静态审查（源码/文档/测试逐行阅读）；未复跑任何命令**（不运行 tsc / vitest / CLI E2E）。
> 指挥侧运行证据（132 文件 1431 passed + 3 skipped、`policyStatus.test.ts` 10/10、七项判别性 E2E）**未被本报告独立复现**，仅作为"待复现的声称"处理。
> 结论倾向：**ACCEPT（有条件）**——本轮实质目标（project 层接线 / 可见 / 不静默 / 诚实标注）在代码与文档层面成立，遗留 5 项未闭合（无一项使 AC1–AC4 失效）。

## 一、逐条必查

**1. AC1 是否真"参与执法"——通过（调用链证据）。**
`cmdRun`（`cli.ts:596`）→ `composeHarness`（`compose.ts:173-180`）→ `loadPolicyArtifacts({projectPath})`（`PolicyLoader.ts:25-27`：`parsePolicyYaml` **push 进同一个 `decls`**）→ `mergeScopes`（`:136-172`，数组拼接、标量后者覆盖）→ `compilePolicy`（`Compiler.ts:128` `deniedTools`、`:131-229` `rules`、`:250-256` `fsConfig`）→ `PolicyEngine`（`compose.ts:181`）、`before_tool` 权威裁决（`:293-307`）、`ToolRegistry(finalTools,{deniedTools})`（`:248`）、`fsPolicy` 硬约束（`:186-191`）、`Executor.decide`（`:206-208`）。
即 project 声明进入的是**裁决路径**，不是"读进来算条数"。**但**：`packages/policy` 全部测试（`policy.test.ts`、`globmatch.test.ts`）**零处**触及 `loadPolicyArtifacts`/`projectPath`（grep 无命中）；`policyStatus.test.ts` 只断言"不再报 no policy declaration / 声明 1 条 / 回合跑完"，**无一条断言 project 规则真的 deny 了某工具**。故 AC1 的"参与执法"由**静态链**支撑，不由测试支撑（指挥侧 E2E 同属"读到文件"级判据）。

**2. `builtinConfigRoot()`——部分通过（形态 ④ 有静默指错风险）。**
① 源码 `apps/cli/src`：第 4 次上溯命中仓库根 ✓；② `apps/cli/dist/cli.js`（`package.json:8` bin 即此路径，产物实际存在）：同样第 4 次命中仓库根，与源码一致 ✓；③ `npm link`：Node ESM 默认 realpath 解析（`--preserve-symlinks` 未开）→ 仍是仓库根 **（静态推断，未实测）**；④ 只拷 `dist/` 无 `configs/`：6 级耗尽 → `repoRoot()`（`cli.ts:191`）= **按 cwd 上溯找 `configs/policy.default.yaml`**，找不到返回 cwd。
风险（真实但非"完全静默"）：消费者项目自身（或任一祖先）若存在 `configs/policy.default.yaml`，它会被当成**"内置 system 策略"**静默采用——"不可降级的内置基线"变成别人的文件；若都没有，则 system 层显示"缺失"+（有 project 时）AC4 告警，两层都无时 `no policy declaration found` fail-loud，behavior IR 走 `<cwd>/configs/behavior.default.yaml` 报错退出。**回落本身无任何标记**，`policy status` 也看不出"内置未找到"。最小修法：回落时 `console.warn` 一次，并在 `--json` 增 `builtinRootFound: false`（纯增字段）。

**3. AC4 闸门（`partialPolicyLayers`，`cli.ts:222-225`）——通过。**
① 两层都缺 → `[]` 不告警（正确：装载器随即 fail-loud，`PolicyLoader.ts:30-32`）；② 两层合法 → 无 0 条层 → 不告警 ✓；③ system 缺 + project 合法 → 告警 ✓（test 7 覆盖，且断言 exit 0 + 回合真跑完）；④ system 合法 + project 解析失败 → 告警且末尾改口径"解析失败的层不会被采用…"（`cli.ts:288-291`），随后 fail-loud ✓（与错误场景一致）；⑤"system 合法 + project 合法但 0 条"→ **该形态不可达**（见第 4 条），故不存在"该报不报"。唯一漏报面：**解析通过但编译期非法**的层（`Compiler.ts:90-97` 未知顶层键、`:179` 未知 `shell.deny` 类别）被算作 >0，闸门不告警；但该情形 `run` 必 fail-loud 且 `wrapPolicyLoadFailure` 的 `/policy compile error/` 分支（`cli.ts:330-337`）能精确给出层路径，故**不构成静默放过**。

**4. 三态是否穷尽且互斥——不通过（第三态不可达）。**
`inspectPolicyLayers` 的成功分支恒 `declarationCount: 1`（`PolicyLoader.ts:117`；同文件 `:56-60` 自述"只能是 0 或 1"），故 `exists && !error && count===0` **永不发生**：`emptyDeclaredPolicyLayers`（`cli.ts:238-240`）恒为 `[]`，`policyLayerFixHint` 第三分支（`:262`）为死代码，`--json` 恒输出 `emptyDeclared: []`。三态实际只有两态（缺失 / 存在但无效），注释 `cli.ts:227-231,470-473` 与测试文件 `:17-27` 的"三态穷尽"表述**言过其实**（属注释/契约表述问题，不影响行为）。
同时，必查 4 的追问"有没有既非缺失又无 error 且 count>0 却实际无效" → **有**：编译期非法的策略被 `policy status` 显示为"存在 · 声明 1 条"并计入 `effectiveOrder`，而 `run` 立刻 `policy compile error` —— "看着配了其实没配"在**可见面上仍残留一格**。最小修法：`inspectPolicyLayers` 在 `parsePolicyYaml` 成功后再 `try { compilePolicy(decl) } catch` 记 `error`（只读，不改执法语义，恰是 BRIEF-15 允许的"只读地暴露层次事实"）。

**5. `--json` 契约——通过。**
`cmdPolicyStatus` 的 JSON 分支（`cli.ts:487-496`）是唯一 stdout 出口，`main()`（`:2058-2066`）无前置打印 → 单段 JSON（test 5/9 断言首尾字符 + `JSON.parse`）。`missing` 保持**旧语义"声明 0 条"**（`:482`），`invalid`/`emptyDeclared` 为其**子集**的新增字段（additive，无破坏）；`layers[]` 新增可选 `error`/`hash`，`PolicyLayerFact` 全仓仅 `cli.ts` 与测试消费，无既有形状消费者。附注（低危、非本轮 AC）：`run --json` 路径上 `warnPartialPolicyLoad` 用 `console.warn` 写 stderr（`:292`），会与 `fail()` 的 stderr JSON 信封（`output.ts:24-33`）叠加，使 stderr 不再是"单段 JSON"。

**6. AC5 诚实性——部分不通过（标注到位，残留 3 处未覆盖声称）。**
已达标：`POLICY-SPEC.md:454-459`（"已实现只有 system + project；user 层无 loader；trust 门只存在于注释；session 层无实现"）+ `ARCHITECTURE.md:325`（表内标注"实际只实现 system + project"）。
但该 banner 自述只覆盖"本节（§6）与 §6.2/§6.3"，grep 出 banner 之外仍无条件的声称：`POLICY-SPEC.md:23`（"**v0.1 纳入**：…workspace trust 门"）、`:180`（项目示例注释"**装载前提：workspace trust 通过**"——此前提在代码中根本不存在，`PolicyLoader.ts:25-28` 无任何信任判断）、`:21`（"system/user/project/session 四级作用域"）。这正是"用户照 `:180` 的示例配置却找不到信任命令"的形态。另 `cli.ts:120` 的 `--json` 支持命令清单未列入新命令 `policy status`（低）。

**7. 回归面——通过（附不对称注记）。**
6 处 = 3 分支 × 2 路径（`cli.ts:594/597`、`1984/1987`、`2014/2017`），三处均保持 `flags.get('policy') ??` / `flags.get('behavior') ??` **显式覆盖优先**；TUI 两分支的 project 路径与各自 `workspaceRoot` 同源（`:1986` 用 `target.meta.workspaceRoot`，`:2016` 用同一 `path.resolve(...)` 表达式），`chat.ts:396` 原样透传。
`repoRoot()` 的其它调用点未动：bench（`:729,736-737`）、usage 价目（`:350-353`）、model catalog（`:766`）、pricing sync（`:1611,1686`）、reports（`:1826`）——仓库内运行时两函数同值，行为不变；`loadPricing`（`pricing.ts:58-72`）与 `loadModelCatalog`（`modelCatalog.ts:77-80`）缺文件均降级为空表，故仓库外 `run` 不会因这两条崩（与 E2E exit 0 自洽）。**不对称**：默认定价的 cwd 依赖仍在，与本轮"装在哪儿就在哪儿"的口号不一致（本轮范围外，记为后续）。

**8. 测试真实性——通过（有一处 AC1 负对照缺失）。**
10 例逐条读毕，**未见永真断言**：test 3 以"改写内容→哈希变→写回→哈希回到原值"双向锁定（`:205-226`），test 7 断言 `warn` 含"部分装载"+"system"且 exit 0 + stdout 有最终回复，test 8 为其负对照。`it.skipIf(!HAS_BUILTIN_SYSTEM_POLICY)`（`:353`）是**显式 skip**（vitest 会报 skipped，非静默），守卫值按"测试文件位置上溯 3 级"计算（`:88-96`），与 `builtinConfigRoot()` 同源，不会恒 false。
缺口：**AC1 缺自动化负对照**。test 7/8 的唯一变量是 **system 层**；没有任何用例对"`run` 时有无 `<ws>/.harness/policy.yaml`"做对照（BRIEF-15 第 61 行要求 AC1/AC4 均须负对照）。该负对照目前仅存在于指挥侧手工 E2E。

## 二、AC 判定

| AC | 判定 | 依据 |
|---|---|---|
| AC1 判别性（project 参与） | **通过（有覆盖缺口）** | 调用链见第 1 条；缺口=无自动化 deny 级断言、无 project 有无的负对照 |
| AC2 层次可见 + 哈希真实 | **通过** | `PolicyLoader.ts:109` sha256 前 12 位；test 2/3 交叉验证 + 双向判别 |
| AC3 `--json` 单段 JSON | **通过** | `cli.ts:487-496` + `main():2058-2066`；test 5/9 |
| AC4 部分装载不静默 | **通过** | `cli.ts:222-225,273-293`；test 7 + 负对照 test 8 |
| AC5 诚实标注 | **部分不通过（轻）** | 要求的 2 处标注已加；但 `POLICY-SPEC:21/23/180` 仍是"宣称支持但代码无" |

## 三、总判定

**ACCEPT（有条件）**。本轮把"用户工作区里策略不被读取 / 不可见 / 部分装载静默通过"这条 P0 链在**代码路径层面**真正打通（project 声明确实进入裁决），诚实标注也已落地；不构成 REJECT 的理由是：无任何一条 AC 被证伪，且未闭合项均不导致"静默无效"或"静默放过"。

**未闭合清单（供 Round 16 取用，按价值排序）：**
1. `inspectPolicyLayers` 只看 `parsePolicyYaml`，编译期非法的层被显示为"生效"（`policy status` 与实际 `run` 结论冲突）→ 增 `compilePolicy` 试探并记 `error`（只读，最小）。
2. `emptyDeclared`/第三态为死代码、注释宣称"三态穷尽"→ 要么删第三态并改注释，要么让它可达（需 loader 支持"合法但空策略"）；同时修正 `policyStatus.test.ts:17-27` 的表述。
3. AC1 负对照缺失 → 补一条"同一 ws 先放后删 `.harness/policy.yaml`，断言 run 的 exit/文案翻转"的真实 `main()` 用例；并补一条 project `tools.deny` 真被拒的裁决级断言（`packages/policy` 侧）。
4. `POLICY-SPEC:21/23/180` 三处无条件声称 → 各加一句"（未实现，见 §6.1 实现状态）"；`cli.ts:120` `--json` 命令清单补 `policy status`。
5. `builtinConfigRoot()` 回落 `repoRoot()` 无标记 → 回落时 warn 一次 + `--json` 增 `builtinRootFound` 字段；并明确"npm 打包安装（无 configs/ 随包）"属未支持形态（与 ROUND-15 §4 的 P2 发布缺口一致）。
6. （安全，记录不改）trust 门未实现而 project 层已上线：任意克隆的仓库可把 `guidance` 文本注入 system prompt、并追加硬 deny；文档已诚实标注，但 `policy status`/告警未提示"project 层未经信任门"。建议在告警尾句加一句可见提示或于 Round 16 实现门。

（本报告仅静态审查，未复跑命令；指挥侧运行证据未被独立复现。）
