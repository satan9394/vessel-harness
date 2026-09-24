# C7 全新上下文只读评审（评审对象 = 冻结补丁）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（本次切片的原始 FAIL 就来自"评审"，这次必须由**同款独立评审**给出结论才能提交）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：planned
- **模式：Audit —— 只读、只出判决，不改任何文件、不提交**

## 评审对象（**唯一**，由 C6 冻结）
- `E:\DeepSeek_Harness\workspace\2026_09_04\composable-mission-01\backup\turn-end-slice-final.patch`（46803 B，SHA256 `6C01A6E4…26CCA`）
- 新增测试文件原件：`...\backup\turnEndBoundary.test.ts`（16334 B，SHA256 `56F413C9…BBF86`）
- 说明：**切片不在 HEAD 里**（HEAD 仍是 `ba173d4`），所以评审对象必须是这份补丁 + 新文件，**不得**用 `git show HEAD:`；评审时请自行把补丁应用到 `%TEMP%` 的副本上观察（不得改真实工作树）

## 要回答的问题（每条给出证据）
1. **收窄是否到位**：C2 声称把三处被证伪的断言改成了"条件 + 反例 + 机制"。请独立 grep 全仓确认**不再存在无条件形式**（例如"有记录 ⇒ 条数 == toolCalls""记录数 = 回合数 = `before_turn` 数""无条件 实时 == 纯回放""全仓没有铸造点/没有指标定义"），并核验收窄后的表述**在实现上确实成立**（不是换了个方式过度声称）。
2. **用例是否判别性**：C4 的两条用例是否真的会因实现/声明变化而变红？C5/C5b 的突变记录（`evidence\C5*.md`、`C5b*.md`）结论是否可信？有无"重言式断言"残留（C5b 已诚实上报 `C4① :210/:211` 因 fail-fast 未单独实测 —— 请判断**这是否影响该用例的判别力**，并给出你的结论与理由）。
3. **连带一致性**：C3 改的 `unwiredRecords.test.ts`（注释）与 `ARCHITECTURE.md:176`（收窄）是否引入新的自相矛盾？文档↔代码双向守卫是否仍成立（`unwiredRecords.test.ts` 的绊线语义、`spec-manifest-parity.test.ts`）？
4. **回归面**：`tsc -b` 与 `test:all`（两 root）在 C6 全绿（日志在 `evidence\C6-*.log`）。请**至少重跑一次聚焦验证**（`npx vitest run packages/telemetry`，在真实树或副本内均可，1 次）确认与日志一致；并指出该切片**未被覆盖**的面（哪些行为没有测试见证）。
5. **能否提交**：给出**判决**（PASS / FAIL）。若 FAIL：逐条列出**阻断项**（含可复现命令与原文）；若 PASS：列出**残余风险**与建议的后续卡（可含 `telemetry.test.ts:81` 过时指针、M03 口径裁决、`:210/:211` 补测等）。

## 硬约束
- **只读**：不得修改真实工作树任何文件（需要观察请在 `%TEMP%` 副本内做）；不得 commit / add / stash / checkout / clean；不得删除文件
- 定向 vitest **≤1 次**；不得跑 `test:all`、不得 install、不得改 lockfile
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）
- 报告落盘：`...\composable-mission-01\evidence\C7-review-verdict.md`；交证里给判决与证据指针

## 验收标准（客观门禁）
- [ ] 判决明确（PASS/FAIL）+ 置信度与理由
- [ ] 五问逐条给证据（命令 + 输出摘录）
- [ ] 若 PASS：残余风险清单 + 建议后续卡
- [ ] 若 FAIL：阻断项逐条（含复现命令与原文）
- [ ] 真实工作树未被改动（`git status --short` 仍 10 项、HEAD 仍 `ba173d4`）

## 依赖
- 依赖任务卡：C6（冻结产物）

## 预期证据（执行器回填）
- [ ] 判决 + 五问答案
- [ ] `git status --short` 与 `HEAD`
- [ ] 报告文件路径
- [ ] 偏差 / 未完成项

## 验收结论指针（W0 回填，2026-09-13；**只追加，不改正文**）
- **结论：已合入**。本卡产物 = 一份**独立对抗评审判决**，且该判决**真实生效**：判决 **FAIL（置信度 0.80）**，两个阻断项被后续卡 C7b 逐条修正，修正后经 C8 复评 **PASS（0.82，无阻断项）** 才允许提交。
- 判决全文：`.dsh-mission/evidence/C7-review-verdict.md`
  - `:12` = **FAIL（置信度 0.80）**；`:14` = 一句话理由（收窄所用条件本身选错）；`:16-18` = 判定枢纽（「不可重试错误」读作类别还是结果，如实披露供人类裁决）
  - `:81` = 阻断项 A；`:202` = 阻断项 B（`EVENT-SPEC.md:605` 与收窄后的 `ARCHITECTURE.md:176` 互否）
  - `:158` = 对 C5 突变记录的可复现性复核；`:240-241` = 本卡自行跑的聚焦验证 `Test Files 3 passed / Tests 27 passed`
- **本卡是「判 FAIL 而不改文件」的只读评审**：C7 之后的修正落在 `C7b`，复评落在 `C8`，两者证据分别见 `.dsh-mission/tasks/C7b-fix-per-review.md`、`.dsh-mission/tasks/C8-final-review.md` 的验收结论指针。
- 证据文件（逐个 `Test-Path` = True）：
  - `.dsh-mission/evidence/C7-review-verdict.md`（344 行，判决全文）
  - `.dsh-mission/evidence/C7b-fix-proof.md`（C7b 按 A/B 修正的证据）
  - `.dsh-mission/backup/turn-end-slice-final2.patch`（C7b 后**重新冻结**的评审坐标，58945 B / `84CFD07E…CADECA`）
  - `tasks/120-turn-end-telemetry-slice.md`（仓库内；`:154` = 评审链 C6→C7 FAIL→C7b→C8 PASS）