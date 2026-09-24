# W3 最终门禁 + 独立对抗评审 + 路径限定提交 + 落卡

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（Mission 2 的收口卡：没有它就等于没做）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 2
- 来源：**planned**
- 依赖：W1、W2 全部合入之后才可开工

## 目标

把 W1/W2 的产物推到**可提交并已提交**，且评审对象是**冻结坐标**（本 Mission 的改动在提交前不在 HEAD 里，**不得**用 `git show HEAD:` 取证）。

**执行顺序（2026-09-13 指挥侧修订，原顺序会让"最后一次编辑"落在门禁之后）**：
1. **先落卡**：在仓库内写 `tasks/121-doc-condition-guards.md`（编号 121，风格对齐 `tasks/120-turn-end-telemetry-slice.md`：目标/验收/链路/未闭合项/涉及文件/门禁实测原样回填）。**卡先落盘，门禁才是真正的"最后一次编辑之后"。**
2. **冻结**：`git diff --output="E:\Code_file\Projects\Composable_Agent_Harness\.dsh-mission\backup\mission2-slice-final.patch"`（**用 `--output` 落盘，避免 PowerShell 管道 CRLF 转写**），并把**未跟踪的两个新测试文件**分别拷进 `.dsh-mission/backup/` + 记录 SHA256/字节数 + `git apply --check --reverse` **exit 0**（未跟踪文件不在 patch 里，必须单独冻结）。
3. **门禁**（各 ≤1 次，**都必须在上述所有编辑之后**）：
   - `npx tsc -b tsconfig.json` ⇒ 必须**带显式退出码**（"无输出"不算证据，C6 的教训）
   - `npm run test:all` ⇒ 两个 root 都 exit 0；完整输出**原样**落 `.dsh-mission/evidence/M2-test-all.log`（不过滤）
   - 出现任何新/可复现失败 ⇒ **保留完整原始输出并停**，不得进入 Fix→Re-test 循环
4. **报告并停下（不要提交）**：本次执行的边界**到"冻结 + 门禁 + 落卡"为止**。`git add` / `git commit` **由指挥侧在独立评审 PASS 之后执行**（本卡原写"由执行器提交"，2026-09-13 修订为：**执行器不提交**，以免"做事的人给自己判分"）。

## 验收标准（客观门禁）

- [ ] 冻结补丁存在，字节数 + SHA256 记录在案，`git apply --check --reverse` **exit 0**
- [ ] `tsc -b` 显式 exit 0；`test:all` 两个 root exit 0，原始输出留档（字节数 + 汇总行逐字贴）
- [ ] 独立 Reviewer 判决 **PASS**（含置信度与残余风险）
- [ ] 提交只含授权文件（贴 `git show --stat`），且**不含**任何生成物/被跟踪报告（`benchmarks/reports/**` 不得被改动）
- [ ] 提交后 `git status --short` 为空；HEAD 前进且不改写历史（禁 force push）
- [ ] `tasks/121-*.md` 已落盘并含门禁实测原样回填

## 限制条件 / 禁止事项

- 不改任何**运行时源码**（本 Mission 的产物只有测试 + 卡）；若发现必须改运行时源码才能收口 ⇒ **停下报 BLOCKED**
- 不动 `request/header`、`turn/end.stats` 其余字段、`costEstimate`/M11、`before_stop`、`denials`、`measured` 收紧、`release-report`
- 不 install / 不改 lockfile；禁 `git add -A`、force push、`git stash/restore/checkout/clean`；不删文件（删除走回收站）
- 不跑 `run-release-gates.ts`（会改写**被跟踪**产物 `benchmarks/reports/release-report.{md,json}` + 消耗真实 API 配额）
- 真实 provider 调用 **0** 次
- 命令文本不得含永久删除类 API 字面名

## 涉及文件（含爆炸半径）

- 提交面：`packages/telemetry/src/telemetry.test.ts`、`packages/telemetry/src/turnEndConditionGuard.test.ts`（若 W1 新增）、`packages/telemetry/src/turnEndWitness.test.ts`（若 W2 新增）、`tasks/121-doc-condition-guards.md`
- Mission 侧产物：`.dsh-mission/backup/mission2-slice-final.patch`、`.dsh-mission/evidence/M2-test-all.log`、`.dsh-mission/evidence/M2-review-verdict.md`
- 只读：`package.json`（`test:all` 两 root 定义）、`tsconfig.json`

## 依赖

- 依赖任务卡：W1、W2（**顺序**：W0/W1 → W2 → W3）
- 阻塞：无

## 预期证据（执行器回填）

- [ ] 冻结补丁的字节数 + SHA256 + reverse-check 原始输出
- [ ] `tsc -b` 与 `test:all` 的**原样**输出（含显式退出码）
- [ ] Reviewer 判决全文（`.dsh-mission/evidence/M2-review-verdict.md`）
- [ ] `git show --stat` 与提交后的 `git status --short`
- [ ] 偏差 / 未完成项（含任何假红、任何未覆盖面）

## 验收结论（Evaluator / 指挥会话回填）

- 状态行：**保持「待执行」**（冻结 + 门禁 + 落卡三步已完成且全绿，但**独立评审 FAIL** ⇒ 本卡**未达成**，按卡面硬边界**停**）
- 已完成部分（指挥侧独立复核过，非转述）：
  - `tasks/121-doc-condition-guards.md` = **214 行 / 24339 B**（实测）
  - 冻结三件：patch `7632 B`、`turnEndConditionGuard.test.ts` `9654 B`、`turnEndWitness.test.ts` `21671 B`；**我亲自跑** `git apply --check --reverse` ⇒ **exit 0**
  - 门禁：`tsc -b` **exit 0**（10.39 s）；`npm run test:all` **exit 0**，日志 `.dsh-mission/evidence/M2-test-all.log` **101420 B**，两个 root 汇总行逐字 = 根 `171 files / 2195 passed | 6 skipped`、`apps/web` `11 files / 120 passed`（与基线 169/2180 差 +2 文件/+15 条，**精确等于本切片**：guard 10 + witness 4 + ⑤-neg 1）
  - `git status --short` = 4 项（W1/W2 三项原样 + `?? tasks/121`）；HEAD `c8de618`；暂存区空
- **独立对抗评审：FAIL（范围限定）** —— 判决全文 `.dsh-mission/evidence/M2-review-verdict.md`。守卫本体有效（8 锚点实读存在、按唯一前缀定位、不钉行号、不镜像、删词会红；R2 双向真能红；R3 四条见证全绿且措辞诚实），FAIL 只针对 **4 处「声明强于事实」**：
  1. **E1（实质）** `tasks/121:16` 的"8 处锚点"闭包声明不完整 —— `telemetry.test.ts:859-860` 是**第 9 处**且只列一条来源
  2. **E2** R1-6 实际**只钉词**（删 ③ 从句后「重叠」仍在限定语里 ⇒ 仍绿）
  3. **E3** guard 自述"换行不该变红"为假（折行 `ARCHITECTURE.md:176` ⇒ R1-3 红）
  4. **E4** ⑤-neg 的"同时红"半边不成立（置信度 0.75）
- **未提交**：按卡面「判 FAIL ⇒ 停（登记阻断项，不自动修复）」**未执行 `git add`/`git commit`**，HEAD 仍 `c8de618`；W1/W2 的已验收哈希未被触碰。
- **未用 Repair**：`已用 Repair` 仍 `0/1`、`总 Repair` 仍 `0/1` —— 我没有自动修复，因为修 E2/E3/E4 要动冻结产物（作废 W1/W2 验收）且必须重跑门禁，而门禁额度（`tsc`/`test:all` 各 ≤1、定向 vitest ≤6）已用满 ⇒ **属人类裁决**（见 `RUN_STATE.md` 的 Blocked）。

### 后续（同一卡在三轮之后收口，2026-09-13）

- **人类裁决链**：① "修 + 重跑门禁 + 重新评审"（额度：`tsc`/`test:all` ≤2、定向 vitest ≤8）→ W3b 修第 1 轮 4 处 → 第 2 轮评审 **FAIL（唯一一条：修复文本自身把窄声明改成宽声明）**；② "**再修一次**" → `new-run`（Run 1）+ W4 修那一句 → 门禁第 3 轮 → 第 3 轮评审 **PASS（0.85）**。
- **最终冻结坐标**：`.dsh-mission/backup/mission2-slice-final3.patch`（10013 B / `364B330E…A757`，`reverse` exit 0）；**`final`/`final2` 均已作废**。
- **最终门禁**（第三轮，均在 W4 编辑之后）：`tsc -b` **exit 0**；`npm run test:all` **exit 0**（根 171 files / 2195 passed + 6 skipped、web 11/120；日志 `.dsh-mission/evidence/M2-test-all-rerun2.log`）。
- **提交（由指挥侧执行）**：**`5f3ec0b`** —— 4 文件 +952/−6（`telemetry.test.ts`、`turnEndConditionGuard.test.ts`、`turnEndWitness.test.ts`、`tasks/121-doc-condition-guards.md`），**路径限定、未用 `git add -A`**；提交后 `git status --short` **为空**。
- **卡面状态**：由「待执行」改为 **已合入**（本卡的目标——门禁 + 独立评审 PASS + 路径限定提交 + 落 `tasks/121`——在第三轮之后全部达成）。
- 三轮判决全文：`.dsh-mission/evidence/M2-review-verdict.md` / `M2-review-verdict-2.md` / `M2-review-verdict-3.md`。**三份都保留**（FAIL 的两份不删，它们是"本切片为什么长这样"的唯一一手记录）。
