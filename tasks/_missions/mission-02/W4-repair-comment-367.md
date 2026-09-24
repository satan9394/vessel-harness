# W4 第二次修复：`telemetry.test.ts:367` 的边界断言描述（第二轮评审 FAIL 的唯一依据）

- 状态：待执行（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（`总 Repair` 的**最后一格**：Mission `总 Repair 1/2 → 2/2`；若第三轮评审再判 FAIL ⇒ 停并升级人类）
- 创建日期：2026-09-13（**Run 1**，由 `new-run` 开启；人类裁决"再修一次"）
- Mission：composable 项目 Mission 2
- 来源：**blocker**（第二轮独立评审 FAIL；判决全文 `.dsh-mission/evidence/M2-review-verdict-2.md`）
- 依赖：W3b（它修好了 E1/E2/E3 并成功反驳 E4，但**它自己的修复文本引入本卡要修的这条**）

## 目标（**只做这一件事**）

第二轮评审的 FAIL 是**唯一一条措辞级缺陷**，位于**将提交的** tracked 文件：

> `packages/telemetry/src/telemetry.test.ts:367`（`⑤-neg` 注释块内）写：
> 「末尾**两条边界**断言同样被违反，只是轮不到它们被显示」。

评审以确定性复算证明该句为**假**：按该注释块自己描述的突变形状把 `recordTokens` 改成裸 `/([a-z]+\/[a-z]+)/g` 后 —
- `:388`（边界①）**被违反**：`recordTokens("`turn/end.stats`、`turn/end{kind:'interrupted'}`")` ⇒ `['turn/end','turn/end'] ≠ []`
- `:390`（边界②）**照常通过**：字面量 `'M02/M03、`:462-463`'` ⇒ `[]`（`M02/M03` 含大写，不匹配 `[a-z]/[a-z]`）
- 换成 lookaround 形状 ⇒ **三条全过**

⇒「两条…同样被违反」在两种形状下都不成立；**被你替换掉的那句（只点边界①）反而是对的**。

**要做的**：把那句改成**如实**表述 —— 例如「末尾两条边界断言被 fail-fast 挡在后面、**未被执行**（本用例不声称它们是否会被违反）」，或直接删掉这半句、只保留"边界①会被违反"这一条（后者与修复前的正确措辞一致）。**取舍随你，但必须与上述复算一致，且不得留任何"两条都会被违反"的暗示。**

**并同步**：检查 `tasks/121-doc-condition-guards.md` §6.9 与 `.dsh-mission/evidence/M2-W3b-repair-record.md` 里是否重复了同一句过度声称；重复的就一起改准。

## 硬边界

- **只允许改**：`packages/telemetry/src/telemetry.test.ts`（**仅**该注释块内的这一句 / 这半句）、`tasks/121-doc-condition-guards.md`、`.dsh-mission/evidence/M2-W3b-repair-record.md`
- **不得改任何断言**（`:388`/`:390`/`:391` 逐字不动；`it()` 数目不变、`expect` 位点不变）；**不得改**运行时源码、`docs/**`、`turnEndConditionGuard.test.ts`、`turnEndWitness.test.ts`、`RUN_STATE.md`
- **不得跑** `tsc -b` / `test:all`（那是指挥侧的重跑额度）；定向 vitest **≤1 次**（可选：改完跑一次确认仍 43 passed / exit 0）
- 无需再建 `%TEMP%` 副本（本卡没有需要突变证明的断言；第二轮评审已用静态复算给出确定性证据）
- 不做 git 写操作；不 install；不建子 Agent；命令文本不得含永久删除类 API 字面名

## 验收标准（客观门禁）

- [ ] `:367` 那句已与复算事实一致（**不再声称"两条都会被违反"**；要么只说边界①，要么明写"未被执行、不声称"）
- [ ] `:388`/`:390`/`:391` 三条断言的**代码逐字未变**（贴改前/改后对照）
- [ ] `it()` 数与断言位点数不变；既有断言未放宽/删除（贴 `git diff --numstat` 前后）
- [ ] `tasks/121` 与修复记录里若重复该说法，已一并改准
- [ ] `git status --short` 仍 **4 项**（无第 5 项）；运行时源码与 docs 哈希与 W1 记录一致
- [ ] 若跑了定向 vitest：贴原始输出与退出码

## 涉及文件

- 改：`packages/telemetry/src/telemetry.test.ts`（仅注释）、`tasks/121-doc-condition-guards.md`、`.dsh-mission/evidence/M2-W3b-repair-record.md`
- 只读：`.dsh-mission/evidence/M2-review-verdict-2.md`（判决）、`M2-review-verdict.md`、`M2-W1-mutation-record.md`
- **本卡不冻结、不跑门禁、不提交**（那些由指挥侧在第三轮重做）

## 预期证据（执行器回填）

- [ ] 改前 / 改后逐字对照（说明你选了"只说边界①"还是"明写未被执行"）
- [ ] 三条断言逐字未变的对照
- [ ] `git diff --numstat` 前后 + `git status --short`
- [ ] 定向 vitest（若跑）原始输出与退出码
- [ ] 偏差 / 未完成项；若你认为评审这条判断有误，**照实反驳并附证据**

## 验收结论（Evaluator / 指挥会话回填）

- 结果：
- 备注：
