# EVALUATION-REPORT-05 — Round 4 独立静态复核（G-07：apps/web 纳入类型门禁）

> 立场：对抗性（先假设实现有错）。**静态审查，未复跑任何命令**（只读文件）。
> 需求源：`docs/product-evolution/IMPLEMENTATION-BRIEF-04.md`（验收标准 1–5）。
> 被验改动：`apps/web/package.json`、`benchmarks/runners/src/release-gates/gates.ts`、`.../release-gates.test.ts`。

## 1. 门禁是否真的加严 —— 通过

- Gate1 执行体确实跑两条命令：根 `ctx.exec('npx',['tsc','-b','tsconfig.json'],…)` @ `gates.ts:497`；web `ctx.exec('npx',['tsc','-p','apps/web/tsconfig.json'],…)` @ `gates.ts:503`（cwd 均为 `ctx.repoRoot`）。
- verdict 走纯函数：`return judgeBuildPair(outcome, webOutcome)` @ `gates.ts:529`（不再直调 `judgeBuild`）。
- criterion 文案与行为一致：`gates.ts:44`「`tsc -b tsconfig.json` 与 `apps/web` 类型检查（`tsc -p apps/web/tsconfig.json`）均完成且退出码 0」。无「文案说两件、代码只做一件」。
- 附加正确点：`apps/web/tsconfig.json:21` 的 `include:["src","vite.config.ts"]` 相对 tsconfig 解析，故从 repoRoot 用 `-p` 确实覆盖 `apps/web/src/**`；`:13` `noEmit:true` → 等价类型检查。
- 根侧 exec 抛异常不会静默：`runner.ts:146-148` 把抛出的 executor 记为 `fail`。

## 2. `judgeBuildPair` 判定正确性 —— 通过（无漏判/误判）

`gates.ts:106-133`：三情形逐条核对。
- cli≠0 → fail，summary「根 tsc -b exit N」`gates.ts:108-116`（优先级正确：根失败不被 web 结果掩盖）。
- cli=0 & web≠0 → fail，summary「web 类型检查失败（apps/web tsc -p exit N）」`gates.ts:117-125`，指向 web，与实际失败侧一致。
- 双 0 → pass `gates.ts:126-132`。
- detail 固定 `[tsc exit=<cli>, web tsc exit=<web>]` `gates.ts:107`，顺序与指挥 E2E 记录 `["tsc exit=0","web tsc exit=2"]` 一致。未发现把 web≠0 判 pass 的分支。
- 次要（非阻断）：fail 路径未携带 `compactLines(outcome)` 的 tsc 诊断文本（`gates.ts:76-84` 仍供 `judgeBuild` 使用），仅给退出码；验收标准 2 只要求两条退出码，属可读性弱化而非错误。

## 3. 不得静默通过 —— 通过

`gates.ts:500-528`：web 侧 exec 抛异常（`catch` @ :504-506，或返回 null）时——
- 根已非 0 → `fail`，summary「…apps/web typecheck 探测失败未执行」+ detail 两行 @ `:509-516`。
- 根 exit 0 → `pending` + `pending:true` + `note`「…web 侧探测失败时显式 pending，不静默通过」@ `:519-527`。
两条分支均带清晰 summary/detail，无 pass 泄漏。
真实性核验：两条生产 RunCommand 都把非 0 退出码**解析为 `{code}`**（`run-release-gates.ts:99-106`、`gates.ts:429`+`421-424`），只有 spawn 级失败（ENOENT）才 reject → 真实 web 类型错误走 `:529` 判 fail，不会被误降级为 pending。

## 4. 回归 —— 通过（变更面以外无异常）

- 八门禁 id/数量/顺序：`GATE_DEFINITIONS` 仍 8 条且 position 1..8 @ `gates.ts:43-52`；既有断言 `release-gates.test.ts:185-190` 锁定 id 列表与长度，`GATE_ORDER` @ `:63`。executor 仍 8 个 `gates.ts:492-658` 并按 position 排序 `:659`。
- `judgeBuild` 仍导出 @ `gates.ts:87`，函数体未变（`:88-96`），既有用例 `release-gates.test.ts:46-52` 的断言（summary/detail）与其一致。
- 其它门禁执行体（unit `:533-538`、deterministic-bench `:541-546`、real-model-bench `:549-586`、safety `:589-594`、resume `:597-625`、ux-smoke `:628-640`、packaging `:643-656`）逻辑读来完整、与既有测试期望一致（`test.ts:217-224` 仍 pass/pass/pending/pending）。
- 无任何测试断言旧 criterion 文案（`test.ts:191` 只查非空），文案更新无连带回归。
- `apps/web/tsconfig.json` 语义与 brief 描述一致（noEmit/include），**未见改动痕迹**；但无 VCS 命令可用，不能与基线逐行比对（故此项为「静态一致」而非「diff 证明」）。

## 5. 测试真实性 —— 通过（有轻微强度不足）

`release-gates.test.ts:339-357` 三条用例：:342 断言 `status==='pass'`；:348 断言 `'fail'`；:355 断言 `'fail'`；:343/:349-350 断言 detail/summary 含 `web tsc exit=0`、`web`、`2`。非恒真——均以 status 为主断言。
可选字段防护已就位：三处均用 `(v.evidence.detail ?? [])`（:343、:349、:350），对应 `types.ts:39` `detail?: string[]`，即 `TS18048` 回归路径已被正确规避。
轻微不足（非阻断）：第 3 例（:353-356）只断言 status，未断言 detail；第 2 例 `/2/` 正则较宽（不过 summary 已含 exit 2，实际仍指向 web）。

## 6. 越界 —— 部分无法判定（静态可读范围内通过）

- `apps/web/package.json:10` 仅新增 `"typecheck": "tsc -p tsconfig.json"`（位于 dev/build 之间），依赖段 `:14-25` 无新增；`gates.ts` import 段 `:16-38` 未引入新依赖（`judgeBuildPair` 只用文件内既有类型）。
- 但"本轮只动 3 个文件"需 `git diff --stat` 才能证明；本会话禁止跑命令，无法验证，故记「无法判定」而非通过。
- 顺带发现的历史漂移（不属本轮 3 文件，不构成 REJECT 依据）：`docs/RELEASE-GATES.md:64` 仍把 Gate1 记为仅 `tsc -b tsconfig.json`；`benchmarks/reports/release-report.md:9` / `.json:11` 仍是旧 criterion 文案（生成物未重跑刷新）。

## 结论：**ACCEPT**

六项无一项构成功能/回归缺陷；判别性 E2E 结论（web 类型错误 → Gate1 fail，detail `["tsc exit=0","web tsc exit=2"]`）与代码路径 `gates.ts:503/529/117-125` 完全自洽，G-07 已闭环。
非阻断改进建议（可选，不要求本轮做）：① fail 路径补回 tsc 诊断行；② 第 3 例补 detail 断言；③ 更新 `docs/RELEASE-GATES.md:64` 与重跑刷新 `benchmarks/reports/release-report.*`。
