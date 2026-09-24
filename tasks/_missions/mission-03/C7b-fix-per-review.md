# C7b 按独立评审阻断项修正（条件本身选错 + 跨文档矛盾 + 补预算耗尽路径用例）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（C7 判决 FAIL 的决定性阻断项；不修则不得提交）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：**blocker**（C7 独立评审报告 `evidence\C7-review-verdict.md`）

## 背景（C7 的决定性发现）
C2 收窄所用的条件「单一、无重叠、**无不可重试错误**」**装不下实现里真实的第三条反例路径**：
- `AgentLoop.ts:636` 的 `const retryable = attempt <= maxRetries && MODEL_RETRYABLE.has(cls);` 为假时（**两个来源**：① 错误类别不可重试；② **类别可重试但重试预算耗尽** `attempt > maxRetries`）→ `:649-651` 抛错 → `:451-464` 的 `else { throw err; }`（`:462-463`）⇒ `:528` 的 `turn/end` **永不落盘**，而 `:208-212` 的 `before_turn` 已发、`:282` 的 `turn/start` 已写。
- **该路径在本仓既有测试里已被真实触发**（不在切片改动范围内）：`packages/core/src/agent-loop/AgentLoop.llm-retry-record.test.ts:280/281/288/295`、`AgentLoop.stream.test.ts:385/388/390/392`（`rate limit 429` = `RATE_LIMITED`（可重试）+ `maxRetries:1` → rejects）。
- **内部不一致即决定性证据**：`docs/BENCHMARK-SPEC.md:575`（M02）写「**在成功收尾的回合上**」（正确），而 `:576`（M03）与另 4 处写「单一、无重叠、无不可重试错误」（漏一条路）。

## 目标（三件事）
1. **统一条件为"成功收尾的回合"**（即 M02 行自己那句），并把**两条反例并列登记**（都走 `:462-463`）：
   - ① 错误类别不可重试（`MODEL_RETRYABLE` 之外）
   - ② **重试预算耗尽**（`attempt > maxRetries`，类别可重试）
   需同批改这 4 处（C7 已定位）：`packages/telemetry/src/Telemetry.ts:183-186`（类注释，其它地方都指向它）、`packages/telemetry/src/telemetry.test.ts:76-77`、`docs/ARCHITECTURE.md:372`、`docs/product-evolution/PRODUCT-STATE.md:823`；并核 `docs/BENCHMARK-SPEC.md:575/576` 两行措辞一致。
2. **消除跨文档矛盾**（C7 阻断项 B）：`docs/EVENT-SPEC.md:605` 仍是无条件形式「…全部配对且编号连续；任一缺失 = 日志腐败」，与收窄后的 `ARCHITECTURE.md:176` **互否**。
   - 处理方式：**纯文档收窄**（与 `ARCHITECTURE.md:176` 同款：加"除已登记例外" + 指向例外清单），**不得**改 invariant 自检代码、不得改字段语义、不得改任何运行行为
   - 若你判断该处收窄已超"纯文档"范畴（会改变契约语义）→ **停下报告**，改为在 `tasks/120` 与卡面**显式登记该矛盾**并给出最小可行方案
3. **补一条覆盖"预算耗尽路径"的判别性用例**（C7 指出的 #1 未覆盖项）：用**可重试类别**（如 `RATE_LIMITED`）+ 小 `maxRetries` 触发 `attempt > maxRetries` ⇒ 断言：`before_turn` 已发、`turn/end` 记录数为 0、`live.turns` 与 `replay.turns` 不等（与 C4① 同款结构性断言，但走另一条机制）
   - 该用例必须**判别性**：写明"若实现改成总能收尾 / 若条件被改回窄口径，哪条断言会先红"

## 限制条件 / 禁止事项
- **不得改运行时源码**（`packages/*/src/**` 非测试文件），尤其 `Telemetry.ts` 的实现代码（只允许改它的**类注释**）；**不得改既有测试的断言**（可新增用例/新增文件）
- 不得跑 `test:all`（留给最终复评卡）；本卡定向 vitest **≤2 次**（真实树 `npx vitest run packages/telemetry` 与必要的 core 定向各 1 次）
- 不得 install / 改 lockfile / 任何 git 状态变更；不得删除文件
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）
- **C6 的证据形式教训**：任何"无输出=成功"的命令（如 `tsc -b`）若要留证，日志里必须带**显式退出码标记**，0 字节日志本身不足以证明成功

## 验收标准（客观门禁）
- [ ] 4 处 + `BENCHMARK-SPEC:575/576` 措辞统一为"成功收尾的回合"，并**并列登记两条反例**（含 `:636`/`:649-651`/`:462-463`/`:528` 行号与既有测试证据）
- [ ] `EVENT-SPEC.md:605` 的矛盾已消除（收窄）**或**已在 `tasks/120` 与卡面显式登记（二选一，说明理由）
- [ ] 新增"预算耗尽路径"判别性用例并通过（贴输出与退出码）；交证含"哪条断言会先红"的判别性论证
- [ ] grep 自证：`无不可重试错误` 这类窄口径不再作为**唯一**条件出现（应统一为"成功收尾"或与两条反例并列）
- [ ] `git status --short` 记录（相对 10 项的增量：新增用例文件或改动文件 + `EVENT-SPEC.md` 若改）
- [ ] 运行时源码零改动（`git diff --numstat` 中非测试源码仅 `Telemetry.ts` 的既有切片改动，不含本卡新增）

## 依赖
- 依赖任务卡：C7（评审判决）

## 预期证据（执行器回填）
- [ ] 逐处改前/改后对照
- [ ] 新增用例的代码片段 + 判别性论证
- [ ] 定向 vitest 输出与退出码
- [ ] `EVENT-SPEC.md` 处置方式与理由
- [ ] `git status --short` 与 `git diff --numstat`
- [ ] 偏差 / 未完成项

## 验收结论指针（W0 回填，2026-09-13；**只追加，不改正文**）
- **结论：已合入**。本卡三件事全部落地，并已随切片提交进仓库（`f28044e`，9 文件 +937/−26；`docs/EVENT-SPEC.md` = `+1/−1`）：
  1. 条件统一为「**成功收尾的回合**」+ 并列登记**两条来源** —— 落在 `packages/telemetry/src/Telemetry.ts` 类注释、`packages/telemetry/src/telemetry.test.ts` 文件头、`docs/ARCHITECTURE.md:372`、`docs/product-evolution/PRODUCT-STATE.md:823`，并同步 `docs/BENCHMARK-SPEC.md:575/576`。
  2. 新增判别性用例 ⑱（预算耗尽路径，`RATE_LIMITED` + `maxRetries:1`），带负对照把该路径与「类别不可重试」分开。
  3. `docs/EVENT-SPEC.md:605` 由无条件形式收窄为「除已登记例外」——**纯文档**（`invariant_selfcheck`/`selfCheck` 在全仓 `*.ts` **0 命中** ⇒ 未削弱任何守卫）。
- 证据文件（逐个 `Test-Path` = True）：
  - `.dsh-mission/evidence/C7b-fix-proof.md` —— `:109-112` = `Test Files 3 passed / Tests 28 passed`（基线 27 + 新增 ⑱）与 `=== VITEST EXIT CODE = 0 ===`；`:120` = `=== TSC(telemetry, --noEmit) EXIT CODE = 0 ===`；`:129`/`:131` = 「纯文档」的三重证据；`:177` = 如实登记的缺口（⑱ 未做突变实测）
  - `.dsh-mission/evidence/C8-review-verdict.md` —— C8 复评 **PASS**，阻断项 A/B 均判已闭合
  - `.dsh-mission/backup/turn-end-slice-final2.patch` —— C7b **之后**重新冻结的坐标（58945 B / `84CFD07E…CADECA`）
  - `tasks/120-turn-end-telemetry-slice.md`（仓库内）—— `:154` = 评审链与 C8 关键判定；`:160-184` = §11「C7b 修正」全文（含 `:175-184` 的 §11.1：本卡**推翻了 §5-③ 的一句声明**，如实登记 `EVENT-SPEC.md:605` 已就地收窄）