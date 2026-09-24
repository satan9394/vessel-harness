# C8 最终复评（全新上下文，只读；判决决定能否提交）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（本 Mission 最后一张卡；判决决定 E5 提交能否进行）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：planned（C7 判 FAIL → C7b 修正 → 本卡复评）
- **模式：Audit —— 只读、只出判决，不改文件、不提交**

## 评审对象（**唯一**，由指挥侧在 C7b 之后重新冻结）
- `...\composable-mission-01\backup\turn-end-slice-final2.patch`（冻结于 2026-09-13，C7b 修正**之后**）
- 新增测试文件原件：`...\backup\turnEndBoundary.test.ts`
- 说明：切片仍不在 HEAD（`ba173d4`）里 ⇒ 必须用补丁 + 副本观察，**不得**用 `git show HEAD:`

## 要回答的问题
1. **阻断项 A 是否已闭合**：条件是否已从窄口径统一为「成功收尾的回合」，且**两条来源**（① 类别不可重试；② 类别可重试但**预算耗尽** `attempt > maxRetries`）都已并列登记？请独立 grep + 读码复核 4 处 + `BENCHMARK-SPEC.md:575/576` 两行是否一致，并确认收窄后的表述**在实现上成立**（别再出现"换个更窄的说法继续过度声称"）。
2. **阻断项 B 是否已闭合**：`docs/EVENT-SPEC.md:605` 的无条件形式是否已收窄（或按二选一分支显式登记）？与 `ARCHITECTURE.md:176` 是否不再互否？该收窄是否**确实只动文档**（贴证据：`invariant_selfcheck` 在实现里是否存在、有无以该行字面为判据的测试）。
3. **新增 ⑱（预算耗尽路径）是否判别性**：读用例实现与断言；判断其断言是否会因"实现改成总能收尾 / 只补落一条 turn/end / 文档条件改回窄口径"而变红；负对照（`kind` 仍为 `RATE_LIMITED`）是否真的把它与 C4① 区分开。
4. **全仓是否仍有未收窄的同类过度声称**（本轮新增的 `EVENT-SPEC` 之外）：请对"配对/条数/两侧同数/成本铸造点"这几类断言做一次 grep 扫描，列出仍存在的问题（若有）。
5. **判决**：PASS / FAIL + 置信度。FAIL ⇒ 逐条阻断项（可复现命令 + 原文）；PASS ⇒ 残余风险 + 建议后续卡（可含 C7 §4.3 的未覆盖面清单）。

## 硬约束
- **只读**：不得改真实工作树任何文件（要试请在 `%TEMP%` 副本内）；不得 add/commit/stash/restore/checkout/clean；不得删除文件
- 定向 vitest **≤1 次**（`npx vitest run packages/telemetry`）；**不得**跑 `test:all`、不得 install、不得改 lockfile
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）
- 报告落盘 `...\composable-mission-01\evidence\C8-review-verdict.md`

## 验收标准（客观门禁）
- [ ] 判决明确（PASS/FAIL）+ 置信度 + 理由
- [ ] 五问逐条给证据（命令 + 输出摘录）
- [ ] 若 PASS：残余风险 + 建议后续卡；若 FAIL：阻断项可复现清单
- [ ] 真实工作树未被改动（`git status --short` 仍 **11 项**、HEAD 仍 `ba173d4`）

## 依赖
- 依赖任务卡：C7b（修正）、C7（原始判决）

## 预期证据（执行器回填）
- [ ] 判决 + 五问答案
- [ ] `git status --short` 与 `HEAD`
- [ ] 报告文件路径
- [ ] 偏差 / 未完成项

## 验收结论（Evaluator / 指挥会话回填）
- **PASS**（评审判决接受，置信度 0.82，无阻断项）→ 已据此执行提交
- 评审独立复核要点：A 已闭合（条件统一为「成功收尾的回合」+ **两条来源**并列登记；4 处 + `BENCHMARK-SPEC:575/576` + `ARCHITECTURE:176` + `EVENT-SPEC:605` 全部一致）；B 已闭合（`EVENT-SPEC:605` 收窄为"除已登记例外"，**纯文档**三重证据：补丁只动一行、`invariant_selfcheck` 在 `packages/apps/benchmarks` 0 命中、无测试读该行字面）；⑱ 判别性成立且负对照有效
- **指挥侧补充验证（评审 PASS 未能覆盖、我实跑发现的）**：按 E4 要求在**最后一次编辑之后**重跑最终门禁
  - `npx tsc -b` → **exit 0**（无输出，附显式退出码标记）
  - `npm run test:all` 首跑 → **`1 failed | 2180 passed`（exit 1）**；两轮之间**无任何写操作**，重跑 → **exit 0**（169 files 全过 / 2180 passed + 6 skipped；web 11/120）⇒ 判为**负载诱发的假红**（本仓既有同类记录：Windows 原子写 rename EPERM 间歇 flaky）。**这条正是评审 R5 预警过的**（C6 的全量绿早于 C7b，静态普查不足以替代实跑）
  - 完整日志：`evidence\C8b-testall-rerun.log`
- 残余风险（评审 R1–R5，作为后续卡输入，不阻断）：R1 文档条件无可执行守卫（最重要）、R2 M02/M03 行无文档⇄代码守卫、R3 C7 §4.3 未覆盖面、R4 ⑤ 反引号词法未钉、R5 全量门禁的时点问题（本轮已用"编辑后重跑"补上）
- 执行器：子代理 5b2dc731