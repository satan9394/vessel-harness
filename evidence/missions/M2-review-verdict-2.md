# M2 · 第二轮独立对抗性评审判决（Reviewer #2，全新上下文，只读）

> 评审对象（新冻结坐标 `final2`）：`.dsh-mission/backup/mission2-slice-final2.patch`（`686DA6C5…CBC3` / 9826 B）
> + `.dsh-mission/backup/turnEndConditionGuard.test.ts`（`BCE130B6…7676` / 11047 B）
> + `.dsh-mission/backup/turnEndWitness.test.ts`（`72EF474B…7A8335` / 21671 B，未变）
> + `tasks/121-doc-condition-guards.md`（含新增 §8.1）
> Reviewer 亲跑核对：HEAD `c8de618`；`git status` 4 项；numstat `72 6`；`git apply --check --reverse final2` **exit 0**、
> 旧 `final` **exit 1**（"旧冻结失效"复现）；`Telemetry.ts 4C480CF5…`、`ARCHITECTURE 8231E458…`、`BENCHMARK-SPEC 24851EBB…`、
> `EVENT-SPEC 508690CF…`、`PRODUCT-STATE 709DD042…` 全部与 W1 记录**逐字一致**。

## 判决：**FAIL（范围限定：单条措辞级，位于将提交的 tracked 文件 `telemetry.test.ts:367`）**

置信度 **0.9**（纯静态、确定性复算）。**"E1/E2/E3 已闭合"与"E4 的反驳成立"置信度 0.98。**

### 通过项

- **E1 真闭合 ✓**：`telemetry.test.ts:869-870` 已改为"不发 `turn/end` 的异常路径有**两条并列来源**"；`tasks/121:16` 改为"守卫覆盖其中 **8 个锚点**（全仓枚举实为 9 处，第 9 处在守卫范围之外）"；§6.7 登记位置（`76` 在被守 BRIEF 14–92 内 / `869,870` 在外）+ 处置 + **未纳入守卫** + "仍是未闭合项"。Reviewer **独立枚举**：被守面 8 锚点、守卫外 1 处 ⇒ 9 处，与卡面一致。附注：`tasks/121:16` 的"全仓枚举"用语偏松（严格全仓还有 `tasks/120` 四行、guard 自身、`tasks/121`），但 §6.7 精确且未声称覆盖 ⇒ 非过度声称。
- **E2 真闭合且不过度 ✓**：M03 行「重叠」实测 ×2（@164 限定语 / @425 ③ 从句）；删 ③ ⇒ 1 < 2 指名红（与 W3b 原始输出 `expected 1 to be greater than or equal to 2` 一致）。未逐字钉散文。已知代价：限定语被同义改写会假红（与 §6.4 同族，未单列）。
- **E3 真闭合 ✓**：guard `23-27` 行已改为"折行会变红 = 已知脆弱点"；`M2-W1-mutation-record.md` §3 已同步收窄。
- **E4：修复执行器的反驳成立，第一轮评审那条判断是错的**。Reviewer 按真实文档文本**独立复算**：`recordTokens` 改成裸 `/([a-z]+\/[a-z]+)/g` 后"已消费"段多收 `inject/instruction`/`plan/memory` ⇒ `consumed(8) ≠ handled(6)` ⇒ `telemetry.test.ts:325` 先失配，与 W3b 原始输出逐数吻合。第一轮的前提"两段裸 token 均为 `[]`"**只对 lookaround 形状成立**，据此推"⑤ 不会红"无效。§6.9 与记录已如实分开"复算 / 实跑"两种形状。
- **无新问题（除 FAIL 那一条）**：运行时源码与 docs 零改动（哈希同上）；witness 未动；**未放宽/删除任何既有断言**（`final` vs `final2` 逐行比对 = 纯注释增删 + `869/870` 注释改写；guard 仍 10 个 `it()`；`telemetry.test.ts` 仍 20 个）；**未改到绿**（重跑日志 `M2-test-all-rerun.log`：guard 10 tests @450、telemetry 20 tests @10、witness 4 tests @284、171 files/2195 passed @887-888、11/120 @907-908）。

### FAIL 依据（最小可复现证据）

**`telemetry.test.ts:367` 的注释句与 `:390` 的断言相反**：

> 该句写"末尾**两条边界**断言同样被违反，只是轮不到它们被显示"。

复现（按该段 `:362` 自述把 `recordTokens` 的 `` /`([a-z]+\/[a-z]+)`/g `` 改成 `/([a-z]+\/[a-z]+)/g`）：
- 对 `:388` 字面量 `` "`turn/end.stats`、`turn/end{kind:'interrupted'}`" `` ⇒ `['turn/end','turn/end']` ⇒ 边界① **被违反**（属实）
- 对 `:390` 字面量 `` 'M02/M03、`:462-463`' `` ⇒ `[]` ⇒ 边界② **照常通过**
- 换 lookaround 形状 ⇒ 三条全过

⇒ **"两条…同样被违反"在两种形状下都不成立**；**被替换掉的修复前措辞（只点边界①）反而是对的**。这正是本 Mission 要治的病（「声明强于事实」）**在自己修复文本里复发**。

### 顺手发现的 Mission 面不一致（非提交物，非判决依据）

1. `.dsh-mission/tasks/W1-doc-condition-guards.md:46`（"把某句散文换行"列为"不该变红"）与 `:72`（无定语的"4 处纯格式改动 ⇒ 全绿"）**仍残留 E3 的过度泛化** —— W3b 只被要求修 `M2-W1-mutation-record.md` §3，这两处没同步。
2. `.dsh-mission/tasks/W3b-repair-per-review.md` 状态仍"待执行"、验收框全空，而 `tasks/121 §8.1` 与修复记录都称 W3b 已完成（指挥侧尚未回填）。

### 三条残余的判定

- **DEP0137**：登记**诚实**；全量重跑日志仍 **1 次**（`rerun:283`，紧邻 `:284` `✓ turnEndWitness.test.ts`，与首轮 264/265 同形），**未归因**，是告警不是失败。
- **M03 重叠口径**：**诚实**（`Telemetry.ts:225-226`、`tasks/121 §6.2`、`PRODUCT-STATE.md:823` 三处一致 = 只标不可信、未发明口径）。
- **`.dsh-mission` 被 ignore**：**诚实**（`git check-ignore -v` 命中 `.gitignore:15`；一手证据不进仓库历史）。

### Reviewer 未验证（原文）

未跑 vitest/`tsc`/`test:all`（额度用尽）；W3b 副本突变**未复跑**（只做静态复算，两者数字吻合）；旧 guard 字节副本已不存在 ⇒"guard 无断言行被删"只能由 `it()` 计数、断言位点清单与补丁注释级 diff **间接支持**；`tsc exit 0` 仍只有**转录**（0 B 日志）。
