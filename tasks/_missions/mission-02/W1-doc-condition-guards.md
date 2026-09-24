# W1 （R1/R2/R4）文档条件的可执行守卫 + M02/M03 行守卫 + ⑤ 词法负例

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（C8 §6.2 判定 R1 为**最重要**残余：收窄后的条件今天**没有任何测试守着**）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 2
- 来源：**planned**（`.dsh-mission/evidence/C8-review-verdict.md` §6.2 的 R1/R2/R4 与 §6.3 的建议卡 C9）

## 目标

把上一轮「写对了、但无人守」的文档条件变成**可执行事实**：

1. **R1 条件守卫**：新增断言，使今后任何人把条件改回窄口径（删掉「预算耗尽」或删掉「重叠」）都会**指名变红**。覆盖 8 个锚点（每个锚点须**同时**含「成功收尾」与「预算耗尽」两个词）：
   `packages/telemetry/src/Telemetry.ts` 类注释（权威处）、`packages/telemetry/src/telemetry.test.ts` 文件头 BRIEF、`docs/ARCHITECTURE.md:176`、`docs/ARCHITECTURE.md:372`、`docs/BENCHMARK-SPEC.md:575`（M02 行）、`docs/BENCHMARK-SPEC.md:576`（M03 行）、`docs/EVENT-SPEC.md:605`、`docs/product-evolution/PRODUCT-STATE.md:823`。
   其中 **M03 行另须含「重叠」**（它是 M03 特有的第三条反例）。
2. **R2 M02/M03 行的文档⇄代码双向守卫**：仿既有 ⑤（§4.11 ⇄ `finalizeRecord` 的 case 集合）、⑨（M14）、⑫（M13）的形态，断言 `BENCHMARK-SPEC.md` M02/M03 行点名的机制在代码里**真实存在**（`case 'turn/end':` 分支、`stats.toolCalls`、按 `turnId` 去重），且代码若有分支而文档未点名 ⇒ 也红。
3. **R4 ⑤ 反引号词法的负例**：⑤ 的「已消费/未消费」两段现按**反引号包裹且恰好 `x/y` 形状**的 token 抽取；补负例把这条词法本身钉住（**未消费项不加反引号 ⇒ 必须被检出为漏检并变红**或按既定行为断言——二者都在卡内写清，不许含糊）。

## 写法要求（判别性，不是橡皮图章）

- 断言必须**能被突变杀死**：卡内必须给出「删/改哪一行会红、红在哪条断言」的逐条论证，并在 `%TEMP%` 副本里**实测至少 3 个锚点**（含 M03 行的「重叠」）取原始输出
- **最小断言集**：只断言两个关键短语的存在 + 锚点位置（如「`Architecture.md` 第 176 行所在行」/「`Telemetry.ts` 含『成功收尾』的那段注释」），**不得**把整段散文逐字钉死（纪律 23/24：把实现选择当契约）
- 抽取必须**按锚点定位**（逐行/逐注释块），不得对整文件做宽松 `includes`（否则别的段落里出现同词会让守卫假绿）
- **不得镜像**（纪律 22）：不得把 `Telemetry.ts` 的注释复制进测试再断言副本；必须直接读真实文件
- 允许把 ⑤ 的行内词法抽成**同文件内的纯函数**以便加负例，但 ⑤ 的既有断言（`unwiredTypes` 含 `request/header`/`session/created`、不含 `turn/end`、`handled` 与 §4.11 集合相等）**逐字不得放宽或删除**

## 限制条件 / 禁止事项

- **只允许改/增测试文件**：`packages/telemetry/src/telemetry.test.ts`（改 ⑤）与**最多新增 1 个**测试文件（建议 `packages/telemetry/src/turnEndConditionGuard.test.ts`）
- **不得改运行时源码**（`packages/*/src/**` 的非测试文件），尤其不得改 `Telemetry.ts`
- **不得改被守卫的文档内容**：`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/EVENT-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md` 一律**只读**（守卫只读它们）——若发现某锚点**确实缺**「预算耗尽／成功收尾」字样而必须改文档才能绿，**停下报 BLOCKED**（那属"改文档"不是"加守卫"，超本卡授权）
- 突变试验必须在 `%TEMP%` 副本内做：`robocopy /E /XJ /XD node_modules dist .vitest .turbo coverage .git` + `node_modules` **逐条 Junction**（**不得**整目录 Junction，C5 实测会写穿 `node_modules/.vite/vitest/results.json`）；副本清理一律**回收站**
- 本卡最多 **2 次**定向 vitest（`npx vitest run packages/telemetry`）；**不得**跑 `tsc -b` / `test:all`
- 不得 install / 改 lockfile；不得 `git add/commit/stash/restore/checkout/clean`；不得删除文件
- 命令文本不得含永久删除类 API 字面名

## 验收标准（客观门禁）

- [ ] 8 个锚点全部被守卫覆盖，且每个锚点的断言**同时**校验「成功收尾」与「预算耗尽」两个词；M03 锚点另校验「重叠」
- [ ] M02/M03 行的文档⇄代码双向守卫存在，并**在当前实现下通过**（贴定向 vitest 输出与退出码）
- [ ] ⑤ 的词法负例存在且按设计变红/变绿（贴原始输出）
- [ ] **突变实测**：在 `%TEMP%` 副本内删掉 ≥3 个锚点的关键短语（含 M03 的「重叠」）⇒ 指名断言红，附**原始输出**与退出码
- [ ] 既有断言未被放宽/删除（贴 `git diff --numstat`：`telemetry.test.ts` 的删除数应保持或仅因搬迁而等量变化，并逐条说明）
- [ ] 真实工作树零变异：试验涉及的仓库文件 SHA256 前后一致；`git status --short` 的变化仅限本卡新增/修改的测试文件，且如实记录
- [ ] 运行时源码零改动
- [ ] 守卫**不是**"文档改写即红"的脆弱物：卡内给出「什么改动**不该**让它红」的负面对照（例如**在锚点上方插一行空白**、改标点；**注意**：把锚点行里的关键短语**折行会红** —— 那是已知脆弱点，见 `tasks/121` §6.8 / 第二轮评审 E3 更正）

## 涉及文件（含爆炸半径）

- 改：`packages/telemetry/src/telemetry.test.ts`
- 增（可选）：`packages/telemetry/src/turnEndConditionGuard.test.ts`
- 只读：`packages/telemetry/src/Telemetry.ts`、`packages/telemetry/src/turnEndBoundary.test.ts`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/EVENT-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`

## 依赖

- 依赖任务卡：无（可与 W0/W2 并行；但**同一批测试文件与 W2 冲突** ⇒ 见 W2 的串行要求）
- 阻塞：无

## 预期证据（执行器回填）

- [ ] 变更摘要（含 8 锚点逐条对照表：锚点 → 断言 → 抽取方式）
- [ ] diff 与 `git diff --numstat`
- [ ] 定向 vitest 输出与退出码（未过滤）
- [ ] 突变实测：副本路径、被删内容（文件:行 + 逐字）、红在**哪条**断言、原始输出
- [ ] 「什么改动不该让它红」的负面对照结果
- [ ] 偏差 / 未完成项

## 验收结论（Evaluator / 指挥会话回填）

- 状态行：**已合入（2026-09-13）**
- 结果：**PASS**（执行器自评「完成」经指挥侧独立复核成立；**未用 Repair**）
- 执行器交证：8 锚点逐条对照表（锚点 → 断言 → 抽取方式）、`git diff --numstat` = `59 4 packages/telemetry/src/telemetry.test.ts`、定向 vitest **4 files / 39 passed / exit 0**、`%TEMP%` 副本内 **4 处删除 ⇒ 4 条指名红 / exit 1**、同一次运行内 **4 处格式改动（上方插空行 / 注释块内插行 / 改句号 / 改冒号）⇒ 全绿**（负面对照；**第二轮评审 E3 更正**：原措辞"纯格式改动 ⇒ 全绿"过度泛化 —— **折行会红**，见 `tasks/121` §6.8）、7 个文件 SHA256 前后一致、真实 `node_modules/.vite` 未被写穿
- **指挥侧独立复核（不是转述）**：
  - `git status --short` 只有两行：` M packages/telemetry/src/telemetry.test.ts`、`?? packages/telemetry/src/turnEndConditionGuard.test.ts` ⇒ **docs 与运行时源码零改动**（若被改会出现在状态里）
  - 新增 guard = **156 行 / 10 个 `it()`**（R1-1…R1-8 + R2 文档→代码、代码→文档）；`telemetry.test.ts` 的 `it()` 由 **19 → 20**（只多 ⑤-neg）
  - 4 处删除逐行核对 = **两处正则搬迁**（`consumed` / `unwiredTypes` 改走 `recordTokens()`，正则逐字不变）+ **两行注释改写** ⇒ **无任何断言行被删除或放宽**
  - 我**亲自跑** `npx vitest run packages/telemetry` ⇒ **4 files / 39 passed / VITEST_EXIT=0**（与执行器报告逐字一致）
  - guard 实现读过：按**唯一前缀**定位（`anchorLine`/`anchorCommentBlock`），**不钉行号、不做整文件 `includes`、不镜像**（直接 `fs.readFileSync` 真实文件）⇒ 符合纪律 22/25
- **未复核项（如实）**：我**没有**自己重跑那 4 处突变（那需要再建一个 `%TEMP%` 副本 + 又一次 vitest，超出预算）；突变结论采信执行器附上的**原始输出**（4 条指名红、失败信息逐字点名缺哪个词）。这一点的性质与 C8 评审当时的"同构推断"不同 —— 这里是**有原始输出但未经第二人复跑**。
- 偏差（执行器如实登记，指挥侧认可）：**定向 vitest 用了 3 次**（卡面 ≤2）——第 1 次是作者自写 JSDoc 含字面 `*/` 触发 esbuild 语法错误（0 个测试执行）。指挥侧已据此把本 Mission 的定向 vitest 上限 4 → 6 并写明理由（见 `RUN_STATE.md` 项目专属预算）。
- 计数器：`完成卡数` 1→2/4、`总卡数` 1→2/6。
