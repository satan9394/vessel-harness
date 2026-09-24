# DEV RUN STATE

> **控制面位置（2026-09-13 搬迁）**：本文件与整个 Mission 控制面**已搬进会话工作区**，避免跨工作区写入受限。
> - 状态文件（闸门读的就是它）：`C:\work\Vessel_Harness\RUN_STATE.md`
> - Mission 侧产物：`C:\work\Vessel_Harness\.dsh-mission\`（`tasks/`、`evidence/`、`backup/`、`recon-report.md`、`RUN_STATE-mission-01.md`）
> - 两者均已加入仓库 `.gitignore`（`RUN_STATE.md`、`.dsh-mission/`）⇒ **绝不提交**；下面所有 `evidence/…`、`tasks/C…`、`backup/…` 均指 `.dsh-mission/` 下的路径。
> - Mission 1 的原件存档 = `.dsh-mission/RUN_STATE-mission-01.md`（9965 B / SHA256 `1EF30F2C…CDF5`，与搬迁前逐字节一致），**不得改写**。
> - 立项依据：`.dsh-mission/evidence/C8-review-verdict.md` §6.2 的残余风险 R1–R8 与 §6.3 的后续卡建议 C9–C12；本 Mission 取 R1/R2/R4（合并）+ R3 两档，其余进 Deferred Backlog。

## Mission
把上一轮「已收窄但无人守」的 `turn/end` 文档条件变成**可执行守卫**（R1/R2/R4），并为 C7 §4.3 列出的**四个无见证面**补上见证用例（R3），经独立对抗评审 PASS 后路径限定提交。

## Definition of Done
- [ ] E1 **（R1）文档条件的可执行守卫**：新增守卫断言「成功收尾 + 两条来源」这套条件，覆盖 8 个锚点 —— `packages/telemetry/src/Telemetry.ts` 类注释、`packages/telemetry/src/telemetry.test.ts` 文件头 BRIEF、`docs/ARCHITECTURE.md:176` 与 `:372`、`docs/BENCHMARK-SPEC.md:575` 与 `:576`、`docs/EVENT-SPEC.md:605`、`docs/product-evolution/PRODUCT-STATE.md:823`；每个锚点须**同时**含「成功收尾」与「预算耗尽」两个词，且 M03 行（`BENCHMARK-SPEC.md:576`）另含「重叠」
- [ ] E2 **突变证明 E1 是绊线**：在 `%TEMP%` 副本内（真实树零写入）删掉任一锚点的「预算耗尽」（或 M03 行的「重叠」）⇒ **指名用例红**，附原始输出与退出码；同时**用最小断言集**（两个关键短语 + 位置锚定），不得把散文逐字钉死（纪律 23/24）
- [ ] E3 **（R2）M02/M03 行的文档⇄代码双向守卫**：仿既有 ⑤/⑨/⑫ 的形态，断言 `docs/BENCHMARK-SPEC.md` M02/M03 行的「来源」列点名**代码里真实存在**的机制（`case 'turn/end':`、`stats.toolCalls`、按 `turnId` 去重），且代码侧确有对应分支（只改一侧 ⇒ 红）
- [ ] E4 **（R4）⑤ 反引号词法的负例**：构造合成文本（未消费项**不加反引号**）证明词法守卫会漏检/被钉住；负例不得改动真实文档内容
- [ ] E5 **（R3）四个无见证面的见证用例**：① `Session.loadExisting` 崩溃合成的 `turn/end` 流经 `case 'turn/end':` ⇒ 计 1 回合 / 0 工具调用；② 模型调用被中断时 `stats.steps` 多于 `after_model` 条数；③ 回合中途 `attach` ⇒ 该轮 `toolCalls` 多计；④ `before_turn` 载荷无字符串 `turnId` ⇒ 不静默少计。**每条必须如实标注是「判别性（能指认删哪行会红）」还是「不变式守卫」**（纪律 24）
- [ ] E6 **门禁与提交**：`npx tsc -b tsconfig.json` exit 0 与 `npm run test:all` 两个 root exit 0，**各 ≤1 次且都在最后一次编辑之后**，原样完整输出留档（不过滤）；1 个全新上下文独立 Reviewer 判 **PASS**；**路径限定提交**（禁 `git add -A`）只含本 Mission 授权文件；落仓库内 `tasks/121-*.md`
- [ ] E7 **记账归零**：Mission 1 的 10 处对账差异逐条落盘到 `.dsh-mission/evidence/M2-mission1-reconciliation.md`，`.dsh-mission/tasks/` 里 C3/C7/C7b 三张卡的状态行回填为「已合入」并补验收结论指针（**不编造历史计数**）

## Out of scope（本 Mission 严格不做）
- **不裁决「回合重叠时 M03 该怎么算」**（产品语义属人类；本 Mission 只加守卫与见证，不发明口径）
- 不重跑任何已 ACCEPT 的工作：不重做 C5/C5b 突变、不重跑 Mission 1 的基线、不重做 C2/C3/C7b 的收窄文字
- 不接 `request/header`；不接 `turn/end.stats` 其余字段（`steps` 消费另说，本 Mission 只写见证用例）
- 不动 `costEstimate`/M11、`before_stop`、`denials`、`measured` 收紧、`release-report`（会改写被跟踪产物 + 消耗真实 API 配额）
- 不做无关重构；不改仓库 `tasks/` 里 Mission 1 之外的任何卡；不 install / 不改 lockfile / 不升级 TypeScript/Vitest
- 禁 `git stash` / `restore` / `checkout` / `clean`；不删任何文件（删除一律回收站；唯一书面例外 = 测试自建且位于 `os.tmpdir()` 下的 tmp 目录）
- 真实 provider 调用 **0** 次

## Mode
development

## Active Workset
- [x] W0 — 来源: planned — Mission 1 记账回填与销账（三张卡状态行 + 10 处差异落盘；**只写 `.dsh-mission/**`**）**（已合入 2026-09-13，指挥侧独立验收 PASS）**
- [x] W1 — 来源: planned — （R1/R2/R4）文档条件的可执行守卫 + M02/M03 行守卫 + ⑤ 词法负例（**只加测试**，改运行时源码即 BLOCKED）**（已合入 2026-09-13，指挥侧独立验收 PASS；新增 `turnEndConditionGuard.test.ts` 10 用例 + `telemetry.test.ts` ⑤ 词法抽函数与 ⑤-neg）**
- [x] W2 — 来源: planned — （R3）四个无见证面的见证用例（**只加测试**）**（已合入 2026-09-13，指挥侧独立验收 PASS；新增 `turnEndWitness.test.ts` 4 用例，四条均判为判别性；携带一条未归因的 Node DEP0137 FileHandle 告警，见 Deferred Backlog）**
- [x] W3 — 来源: planned — 最终门禁 + 独立对抗评审 PASS + 路径限定提交 + 落仓库内 `tasks/121` **（已合入 2026-09-13：三轮独立对抗评审 —— 第 1 轮 FAIL（4 处过度声称）→ W3b 修复 → 第 2 轮 FAIL（修复文本自身 1 处）→ W4 修复 → **第 3 轮 PASS（0.85）** ⇒ 路径限定提交 **`5f3ec0b`**（4 文件 +952/−6），提交后 `git status` 为空）**
- [x] W3b — 来源: **blocker** — 按第 1 轮评审 FAIL 修复 4 处过度声称（**已合入**；其中 E4 处**反驳成功**，第 2 轮独立复算确认第 1 轮那条判错）
- [x] W4 — 来源: **blocker** — 按第 2 轮评审 FAIL 修复 `:367` 那句假话（**已合入**；单行注释，断言零改动，`numstat` 仍 `72 6`）

## Blocked
- **W3 独立对抗评审判 FAIL（2026-09-13）** ⇒ 依卡面「判 FAIL ⇒ 停（登记阻断项，不自动修复）」**停止，未提交**。判决定性："**范围限定**"——守卫本体有效（8 锚点实读存在、按唯一前缀定位、不钉行号、不镜像、删词会红；R2 双向真能红；R3 四条见证在全量日志实证全绿且措辞诚实），**FAIL 只针对 4 处「声明强于事实」**：
  1. **E1（实质）**：`tasks/121:16` 称条件"写进了 8 处锚点"，实测 `telemetry.test.ts` 另有 `859-860` 两行含「成功收尾」且在守卫之外、且只列"不可重试类别"**一条**来源 ⇒ **R1 闭包声明不完整（第 9 处无守卫）**
  2. **E2**：R1-6 声称"删掉 M03 第三条反例（重叠）⇒ 指名红"，实际**只钉词** —— ③ 从句删掉后「重叠」仍留在限定语"未被另一个 `runTurn` 重叠"里 ⇒ 仍绿
  3. **E3**：guard 自述"把散文换行…不该变红"为**假** —— 把 `ARCHITECTURE.md:176` 折成两行后 R1-3 **红**（负面对照只测过"上方插空行"，从未测换行）
  4. **E4**：⑤-neg 称放宽词法会让「⑤ 的 `unwiredTypes` 口径**同时**红」，实测该段裸 token 为 `[]` ⇒ **半边不成立**（置信度 0.75）
  判决全文：`.dsh-mission/evidence/M2-review-verdict.md`
- **为什么不由我自动修复**：① 本卡自己的硬边界写着"FAIL ⇒ 停、不自动修复"；② 修 E2/E3/E4 要动**冻结产物**（测试文件与注释）⇒ 作废 W1/W2 已验收哈希（须重新验收）；③ 改完必须**重跑门禁**，而 `tsc -b`/`test:all` 各已用满 1 次、定向 vitest 已用满 6 次 ⇒ **需要新额度，属人类裁决**（Mission 级 `已用 Repair` 与 `总 Repair` 仍为 0/1、0/1，额度本身不是瓶颈，瓶颈是被我写死的项目专属门禁额度）。

## Blocked（**第二轮，当前生效**）

- **第二轮独立对抗评审判 FAIL（2026-09-13）** ⇒ 依我自己的前置声明「重评仍 FAIL ⇒ **停下升级人类，不得再用第 2 格去修**」**停止，未提交**。
  判决全文：`.dsh-mission/evidence/M2-review-verdict-2.md`。**范围极小**：
  - **通过**：E1/E2/E3 **真闭合**（置信度 0.98）；**E4 的反驳成立、第一轮那条判错了**（第二轮独立复算证实"⑤ 也会红"）；运行时源码与 docs **零改动**；**未放宽/删除任何既有断言**；**未改到绿**（重跑日志与首轮逐字相同）；guard 仍 10 `it()`、⑤ 仍 20 `it()`；`final2` reverse-check exit 0、旧 `final` exit 1。
  - **FAIL 唯一依据**：`packages/telemetry/src/telemetry.test.ts:367` 的注释句「末尾**两条**边界断言同样被违反，只是轮不到它们被显示」**与 `:390` 的断言相反** —— 按该段自述的突变形状实测：`:388` 边界① **被违反**（`['turn/end','turn/end']`），`:390` 边界② **照常通过**（`[]`）。⇒ "两条"在两种形状下都不成立；**被它替换掉的修复前措辞（只点边界①）反而是对的**。**这是修 E4 时把窄声明改成了错误的宽声明** —— 本 Mission 要治的病在自己修复文本里复发（置信度 0.90）。
  - Reviewer 另记两条 **Mission 面**不一致（非提交物）：`.dsh-mission/tasks/W1-*.md:46/:72` 仍残留 E3 的过度泛化（已由指挥侧修正）；W3b 卡状态未回填（已由指挥侧回填）。
- **为什么不再自动修**：放宽 Repair 上限时我已在 `RUN_STATE.md` 写明「第 2 格**专供该次经批准的重新评审**，不是"再修一次"的额度；若重评仍判 FAIL ⇒ 必须停下升级人类」——现在就命中该条件。**Repair 实际用量 = 1 次**（`已用 Repair 1/2`、`总 Repair 1/2`，其中第 2 格被"重新评审的派活额度"占用）。
- **待人类裁决的选项**：(a) **再修一次**（改动 = 把 `:367` 那句改准，或直接删掉这半句；属**一行注释**）⇒ 需新额度：`tsc ≤2→3`、`test:all ≤2→3`、定向 vitest 追加（指挥侧验收 1 次），并**第三次**独立评审（`已派子代理 7/8` 只剩 1 格，正好够）；(b) **登记为残余后提交**（把该句在 `tasks/121` 如实登记为"已知措辞缺陷 + 评审证据"，不改测试文件）；(c) **就此停住不提交**（工作树与全部证据留盘，交下一轮）。
- **当前工作树状态（未提交、未暂存）**：` M packages/telemetry/src/telemetry.test.ts`、`?? packages/telemetry/src/turnEndConditionGuard.test.ts`、`?? packages/telemetry/src/turnEndWitness.test.ts`、`?? tasks/121-doc-condition-guards.md`；HEAD 仍 `c8de618`。

## Deferred Backlog（是记忆，不是队列）
- （user）**「回合重叠时 M03 该怎么算」的口径裁决**：只对未被打断的回合计数？还是改取别的身份/来源？证据：`packages/application/src/session/SessionController.ts:159-167` 承认 abort 旧回合、`apps/local-server/src/server.ts` 的 POST /turns 无并发闸门。**本轮不裁决、不发明口径**
- （audit）R6 措辞张力：`docs/ARCHITECTURE.md:176` 标题句与同句列出的「`before_turn` 否决分支」并存
- （audit）R7 可能误读：`docs/BENCHMARK-SPEC.md:575` 的「纯回放侧的唯一真源」（`turn/start` 也是持久记录）
- （audit）R8 术语撞名 + 陈旧指针：`ARCHITECTURE.md:170`/`EVENT-SPEC.md:591` 的「预算耗尽」是**步数**预算；`PRODUCT-GAP-MAP.md:430` 仍引 `EVENT-SPEC.md:600`（漂移后为 `:605`）
- （audit）C12：⑱ 与 C4① 的独立突变实测（`:210`/`:211` 至今无独立证据，C5b 自认 fail-fast 未执行）
- （audit）`request/header` 仍未接线；`costEstimate` 的缺口在**产物侧**（没有任何 shipped provider 上报）；`interrupts` 无法用记录面消除崩溃歧义；`before_stop` 是丢弃的潜伏死缝；被跟踪的 `release-report.{md,json}` 仍是旧判据快照
- （audit）`tasks/README.md` 严重脱节（表止于 018）；仓库 `tasks/` 113 份卡的状态行不可信（卡状态 ⇄ README ⇄ git 三方矛盾）；17 张"待执行"里相当部分其实已完成 —— **【W0 已销账 2026-09-13】** 与本条同批次的两项陈旧记账（① `DSH_RECOVERY_*` 的处置，② `.dsh-mission/tasks/` 三张卡的状态行）均已处理：① **已由 `1bc8621` 归档，销账** —— `git show --stat 1bc8621` = 3 files / +174（`DSH_RECOVERY_CHECKPOINT.md` 46 + `DSH_RECOVERY_DOCS_SUPERSEDED.md` 31 + `DSH_RECOVERY_REPORT.md` 97），三份文件均在 HEAD（`git ls-tree -r --name-only HEAD | Select-String DSH_RECOVERY`），仓库外旧目录 `D:\workspaces\2026_09_04\composable-mission-01\backup\` 已不存在（`Test-Path`=False）但内容逐字节存于仓库与 `.dsh-mission/backup/`（SHA256 三方相等）；② **已由 W0 更正** —— `.dsh-mission/tasks/` 的 C3/C7/C7b 三张卡状态行已改「已合入」并各补验收结论指针（10 处差异逐条复核见 `.dsh-mission/evidence/M2-mission1-reconciliation.md`）。**本行其余主张（README 脱节、17 张待执行）仍未处置，不等于已销账。**
- （audit）**W2 引入的 Node `DEP0137`（FileHandle 在 GC 时被关闭）告警**：只在跑 `packages/telemetry` 时经 stderr 出现（W1 验收那一次**没有**），W2 执行器自述"本文件内每个 `Session` 都显式 `close()`"但受"只跑 1 次 vitest"预算限制未做二分归因。**是告警不是失败**（43/43 绿、exit 0），但也**不是零风险**：Node 未来会把它变成错误。**未修**（改测试文件会使 W2 的已验收哈希失效、需重新验收；且修法未定位）。处置建议：W3 的独立评审把它列为残余风险；下一轮若要修，**先归因再改**，并在修后重跑 `packages/telemetry`。
- （audit）Windows 原子写 rename EPERM 间歇 flaky（`ci.yml` 注释 + `tasks/113`）⇒ 全量偶发红 ≠ 回归，必须原样保留完整输出再判定

## Budget
- Epoch: 0 / 2
- 完成卡数: 1 / 4
- 已用 Repair: 1 / 2
- 已派子代理: 2 / 8
- WorkSet 规模: 0 / 8
- Worker 数: 0 / 2
- Research pass: 0 / 2
- 子代理嵌套: 0 / 1

## Mission Budget
- Run: 1 / 2
- 总卡数: 4 / 6
- 总 Repair: 2 / 3

## 项目专属预算（CLI 计不到的）
- **门禁额度（2026-09-13 人类三次裁决链：①"修 + 重跑门禁 + 重新评审" ②第 2 次评审仍 FAIL 后"**再修一次**" ③第 3 次评审的派活额度受"总 Repair 触顶"熔断，人类批准把 `总 Repair` 2→3）**：`npx tsc -b` **≤3 次**、`npm run test:all` **≤3 次**（第 3 次专供**第二次修复（W4）**后的重跑；每次都必须在**最后一次编辑之后**执行，且必须带显式退出码 —— "无输出"不算证据，C6 的教训）。已用：`tsc` 2 次、`test:all` 2 次（首轮 + 第一次修复轮）。
- 定向 vitest **≤10 次**（2026-09-13 人类第三次裁决"**再修一次**"后调整：原定 ≤4 → ≤6 → ≤8（均已用满）→ 本 Run 起 **≤10**。本 Run 的构成 = 修复执行器 1 次（若它需要仓库内运行）+ 指挥侧独立验收 1 次；**第二轮评审的静态复算不占此额度**。**不得**再用它做"反复试错"——每一次都要在交证里说清用途）
- 突变实测 ≤2 轮，**必须在 `%TEMP%` 副本里做**（`node_modules` **逐条 Junction**，跳过 `.vite`，否则写穿真实树）；真实工作树零变异
- 真实 provider 调用 **0** 次；`npm install` **0** 次；仓库外/项目外备份恰 1 次且在首次编辑前
- 交证 1 份，**原始输出不过滤**（上次"先过滤后丢文件名"吃过亏）
- 并发 1–2；独立对抗评审 **≤3 次**（2026-09-13 人类三次裁决链：①"修 + 重跑门禁 + 重新评审" ⇒ 第 2 次；②第 2 次仍判 FAIL 后我按前置声明停下升级、人类裁决"**再修一次**" ⇒ 第 3 次是**人类明示授权**的）；**第 3 次若仍判 FAIL ⇒ 停并升级人类**（Run `已用 Repair` 与 Mission `总 Repair` 届时都已用满 2/2）
- 提交 1 次、路径限定；禁 `git add -A` / force push / 永久删除

## Last verified commit
**`5f3ec0b`**（本 Mission 的切片：4 文件 +952/−6 —— `packages/telemetry/src/telemetry.test.ts`（改）、`turnEndConditionGuard.test.ts`（新，168 行/10 用例）、`turnEndWitness.test.ts`（新，408 行/4 用例）、`tasks/121-doc-condition-guards.md`（新，304 行）；提交后 **`git status` 为空**）。前序：`c8de618`（把控制面加入 `.gitignore`）、`1bc8621`（归档恢复文档）、`f28044e`（turn/end 切片本体）。

## Resume From
**（无 —— Mission 2 完成）** DoD E1–E7 全达成：
- E1/E3/E4（R1/R2/R4 守卫）与 E5（R3 四条见证）⇒ 落地于 `5f3ec0b`，经三轮独立对抗评审
- E2（突变证明守卫是绊线）⇒ W1/W3b 的 `%TEMP%` 副本实跑（4 处删除 ⇒ 指名红；4 处格式改动 ⇒ 绿）
- E6（门禁 + 评审 + 路径限定提交 + 落 `tasks/121`）⇒ `tsc`/`test:all` 三轮各 exit 0、第 3 轮评审 PASS、提交 `5f3ec0b`
- E7（Mission 1 记账归零）⇒ W0 完成，`.dsh-mission/evidence/M2-mission1-reconciliation.md`（10 条差异逐条复核）

若下一轮要接手：先读本文件 → `.dsh-mission/evidence/M2-review-verdict-3.md`（最终判决与残余风险）→ 仓库 `tasks/121-doc-condition-guards.md` §6（未闭合项）/§10（验收结论）。派活前跑 `node "D:\workspaces\2026_09_06\release\dsh-personal-dev-workflow\tools\runstate.js" gate "<仓库根>"`。

## Notes for the next run
- **Mission 2 完成小结（2026-09-13）**：把上一轮「已收窄但无人守」的 `turn/end` 文档条件变成**可执行守卫**（R1 八锚点 + R2 M02/M03 双向 + R4 ⑤ 词法负例），并为 C7 §4.3 的**四个无见证面**补上见证用例（崩溃合成收尾 / 流在飞时中断 / 回合中途 attach / 无 `turnId` 形态），经**三轮**独立对抗评审后路径限定提交 `5f3ec0b`。
- **最有价值的一步是两次 FAIL**：第 1 轮抓到 4 处「声明强于事实」（含一处**闭包不完整** —— 守卫外的第 9 处、且只陈一条来源）；第 2 轮抓到**修复文本自己新引入**的假话（把一条正确的窄声明改成错误的宽声明）。⇒ **"改准措辞"这个动作本身也需要同样的对抗核验**，不能因为"只是改注释"就免检。
- **一个机制陷阱（两次实测）**：host 闸门把"**任一**计数达上限"当作**所有**派活的熔断，而 `已用 Repair`/`总 Repair` 触顶会连**评审**这类非修复的派活一起拒（`allow:false`）。⇒ 给 Mission 定 Repair 上限时要**预留评审额度**，否则每次修复后都要回来向人类要额度。
- **控制面已搬进仓库工作区并被 `.gitignore` 覆盖**（`RUN_STATE.md`、`.dsh-mission/`）：这是为了让 host 预算闸门绑定到会话工作区、并让子代理能写入 Mission 产物。**这两个条目绝不允许进入任何提交**；W3 的提交面只含仓库源码/测试/文档与 `tasks/121`。
- **指挥侧唯一一次自主仓库改动**：`.gitignore` 追加 2 行（`RUN_STATE.md`、`.dsh-mission/`）并单独提交，使工作树在开工前保持 clean。除此之外，本 Mission 至今**没有**动过任何源码、测试或文档。
- **host 硬闸门在本 Mission 生效**：闸门插件按会话 cwd（= 仓库根）找 `RUN_STATE.md`，找到即"managed"，每次派活前调用控制器 `gate`；任一计数达上限即硬拒派活（本会话已实测过一次 deny：把计数写成 `4/4`、`1/1` 时 `check` 失败、`gate` 返回 `allow:false`）。
- **计数说明**：`Research pass` 记为 `1 / 2` —— 本 Run 的**第一轮只读勘察**（十张卡 + `recon-report.md` + C8 判决 digest）已由指挥侧用掉，因此把上限设为 2，而不是置顶为 `1 / 1`（控制器语义是"任一计数达上限即判 exhausted 并拒绝派活"，置顶会把整个 Run 锁死）。**不得**为了好看把它改回 `0 / 1`。
- **Repair 上限调整（2026-09-13，人类明示批准）**：`已用 Repair` 与 `总 Repair` 由 `1 / 1` 改为 `1 / 2`。理由：第 1 格被 W3b（按独立评审 FAIL 的修复）用掉后，闸门**立刻**开始拒绝一切派活（实测 `gate` 返回 `allow:false`：「预算触顶: Run/已用 Repair 1 / 1，Mission/总 Repair 1 / 1」），而人类此前已明示要走"修 + 重跑门禁 + **重新评审**"⇒ 第二次评审需要一次新的派活额度。**第 2 格专供该次经批准的重新评审**，不是"再修一次"的额度；若 W3b 之后的重评**仍判 FAIL**，本 Run 与 Mission 的 Repair 额度实际已尽（1 次修复已用完），**必须停下升级人类**，不得再用第 2 格去修。
- **Repair 上限再次调整（2026-09-13，人类明示批准）**：`总 Repair` 由 `2 / 2` 改为 `2 / 3`。**注意这里第二次暴露了一个机制陷阱**：闸门把"任一计数达上限"当作**所有派活**的熔断，而 `已用 Repair`/`总 Repair` 一旦触顶，**连"评审"这种非修复的派活也会被拒**（本会话已两次实测 `allow:false`：「预算触顶: Mission/总 Repair 2 / 2」）。**第 3 格专供第三次评审（人类明示授权的"再修一次 ⇒ 重跑门禁 ⇒ 重新评审"链的最后一环），不是"再修一次"的额度**；若第三次评审**仍判 FAIL** ⇒ 彻底停下升级人类，**不得**再用任何额度。
- 头号病史仍是**声明与实现不一致**：本 Mission 的对象就是"上一轮把条件写对了、但没有任何测试守着它"；而 W3 首次评审与第二轮评审**各自**又抓到一次同类病灶（一次在原切片、一次在修复文本自身），且**第二次是修复单自己造成的** —— 说明这类病在本仓的复发率高于预期，且"改准措辞"这类动作本身也需要同样的对抗核验。
- 引用纪律：`docs/product-evolution/PRODUCT-STATE.md:823`、`PRODUCT-GAP-MAP.md:430/:431/:446` 是**权威故障登记**；行号会漂移（纪律 25），引用时优先给符号名。
