# W0 Mission 1 记账回填与销账（只写 `.dsh-mission/**`）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P2**（不阻断 DoD，但它是 Mission 2 能正确记账的前提）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 2
- 来源：**planned**（指挥侧只读勘察发现 10 处对账差异）

## 坐标（搬迁后的新位置，务必按这个来）

- 项目仓库 = 会话工作区 = `C:\work\Vessel_Harness`
- 状态文件 = `<仓库>\RUN_STATE.md`（**闸门读的就是它**；被 `.gitignore` 忽略，**绝不提交**）
- Mission 侧产物目录 = `<仓库>\.dsh-mission\`（`tasks/`、`evidence/`、`backup/`、`recon-report.md`、`RUN_STATE-mission-01.md`；同样被忽略）
- 本卡里所有 `tasks/C…`、`evidence/…`、`recon-report.md`、`RUN_STATE-mission-01.md` **都是指 `.dsh-mission/` 下的路径**；`tasks/120-turn-end-telemetry-slice.md` 例外——它在**仓库自己的 `tasks/`** 里（已提交）。

## 目标

把 Mission 1 留下的**状态失真**清掉，使下一轮任何人都不会再被过期数字误导：

1. 在 `.dsh-mission/tasks/C3-collateral-contradictions.md`、`C7-fresh-review.md`、`C7b-fix-per-review.md` 三张卡的**状态行**上就地更正为「已合入」，并各补一行**验收结论指针**（指向其真实证据：仓库 `tasks/120-turn-end-telemetry-slice.md:41/154/160-184`、`.dsh-mission/evidence/C7-review-verdict.md`、`evidence/C7b-fix-proof.md`、`backup/turn-end-slice-final2.patch`）。**只允许改这三张卡的状态行与追加一段结论指针，不得改写任何历史正文。**
2. 把 10 处差异逐条落盘到 `.dsh-mission/evidence/M2-mission1-reconciliation.md`，每条给出「左（卡/自报）｜右（RUN_STATE 或实测）｜判定依据（文件:行或可复跑命令）」。
3. 在 `<仓库>\RUN_STATE.md` 的 `Deferred Backlog` 里把**已由 `1bc8621` 解决**的条目（`DSH_RECOVERY_*` 的处置）就地标注「已由 `1bc8621` 归档，销账」，**不得删除该行历史**。

**已知的 10 处差异（指挥侧实测，供你核对，不得照抄——必须自己复核后再落盘）**：
`RUN_STATE-mission-01.md:74` 的 `Last verified commit ba173d4（工作区含 6 改）` 与同文件 `:11/:77`「已提交、clean」互否（实测 HEAD `1bc8621`、`git status` 空）；`完成卡数 1/4` vs 实际 10/10；`已派子代理 0/8` vs 卡内点名的 7 个执行器；`WorkSet 规模 0/8` vs 实际 10 张（超上限）；`总卡数 9/10` vs 实际 10；`Run 2/3` vs 同文件小结「十个卡、三个 Run」；`tsc -b ≤1` / `test:all ≤1` 被实际用量突破（tsc 2 次、test:all 3 次）；定向 vitest `≤4` 被实际 ≥8 次突破；「仓库外备份恰好 1 次」vs 实际 3 次冻结；`tasks/` 统计（待验收 10、合计 97≠113）与 `recon-report.md §4.2`（待验收 8）不一致。

## 限制条件 / 禁止事项

- **只允许写 `.dsh-mission/**` 与仓库根 `RUN_STATE.md`**；**不得**改仓库里的任何源码、测试、文档、`tasks/` 其它卡、`package.json`、`.gitignore`
- **不得改写历史**：`.dsh-mission/RUN_STATE-mission-01.md`（Mission 1 原件存档）、`recon-report.md`、`evidence/C7*-verdict.md`、`evidence/C5*-mutation-record.md` 一律**只读**；三张卡的正文一律不动，只改状态行 + 追加结论指针
- 不得编造任何计数：写不出实测依据的差异，就写「无法复核，原因：…」
- 不跑任何测试、不跑 `tsc`、不跑 `npm`；不动 git 任何写操作（`git log/status/show/diff` 只读可用）
- 不创建子 Agent；命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）

## 验收标准（客观门禁）

- [ ] 三张卡的状态行均已是「已合入」，且各自新增的结论指针**指向真实存在的文件**（逐个 `Test-Path` 为真）
- [ ] `.dsh-mission/evidence/M2-mission1-reconciliation.md` 存在，含 **10 条**差异，每条有「左｜右｜判定依据」，且**至少 8 条**的判定依据是「文件:行」或可复跑命令
- [ ] `<仓库>\RUN_STATE.md` 的 Deferred Backlog 中 `DSH_RECOVERY_*` 条目已就地标注销账
- [ ] 仓库内 `git status --short` **为空**（控制面已被忽略，故不该出现任何条目；贴输出）
- [ ] 三张卡与 `.dsh-mission/recon-report.md` 的 SHA256 前后对照：**仅三张卡变化**，其余逐字节不变

## 涉及文件（含爆炸半径）

- 写：`.dsh-mission/tasks/C3-collateral-contradictions.md`、`.dsh-mission/tasks/C7-fresh-review.md`、`.dsh-mission/tasks/C7b-fix-per-review.md`、`.dsh-mission/evidence/M2-mission1-reconciliation.md`（新增）、`<仓库>\RUN_STATE.md`（仅 Deferred Backlog 一行）
- 只读：`.dsh-mission/RUN_STATE-mission-01.md`、`.dsh-mission/recon-report.md`、仓库 `tasks/120-turn-end-telemetry-slice.md`、`.dsh-mission/evidence/C7-review-verdict.md`、`C8-review-verdict.md`、`C5b-mutation-record.md`
- 仓库：**只读** `git log/status/show`

## 依赖

- 依赖任务卡：无（可与 W1 并行，但 W1 会动仓库测试文件，二者写入面不重叠）
- 阻塞：无

## 预期证据（执行器回填）

- [x] 变更摘要（改了什么、为什么）—— 见下「一、变更摘要」
- [x] 三张卡的 diff（改前/改后对照）—— 见下「二、三张卡 diff 摘要」（含改前/改后 SHA256）
- [x] `.dsh-mission/evidence/M2-mission1-reconciliation.md` 的 10 条清单 —— 已落盘（10 条：左｜右｜判定依据；**9 条**为「文件:行」或可复跑命令，第 10 条之 1 明确标注「无法复核，原因：…」）
- [x] 仓库 `git status --short` 输出（应为空）+ HEAD —— 见下「三、状态与哈希」
- [x] 偏差 / 未完成项 —— 见下「四、偏差」

### 一、变更摘要

只动了三处，全部在授权写入面内（`.dsh-mission/**` + `RUN_STATE.md` 的 Deferred Backlog 一行）：

1. **三张卡状态行 + 追加验收结论指针**：`.dsh-mission/tasks/C3-collateral-contradictions.md`、`C7-fresh-review.md`、`C7b-fix-per-review.md` 的状态行由「待执行」改「已合入」，各在文件**末尾追加**一段「验收结论指针」（指向真实存在的证据文件）。**三张卡的历史正文一字未改**（行数实测 37→48、42→55、50→61，增量全部在文件尾）。
2. **新增** `.dsh-mission/evidence/M2-mission1-reconciliation.md`：10 处差异逐条落盘（左｜右｜判定依据）+ 统计口径说明 + 三张卡回填表 + 销账落地状态。
3. **`RUN_STATE.md` 的 Deferred Backlog 就地销账标注**：在承载「`DSH_RECOVERY_*` 处置 + `.dsh-mission/tasks/` 状态不可信」的那条 audit 记忆行上**就地追加** `【W0 已销账 2026-09-13】` 标注，**未删除任何历史文字**。

**为什么**：Mission 1 留下的自报数字（完成卡数、派活数、WorkSet、Run、门禁与备份用量）与实测不符，若不就地销账，Mission 2 的下一轮会继续按过期数字做判断（这正是本仓头号病史「声明与实现不一致」的回声）。本卡**只更正记账**，不重跑任何工作、不改任何源码/测试/文档。

### 二、三张卡 diff 摘要（改前 → 改后）

**统一改动（各 1 行）**：

```diff
-- 状态：待执行（待执行 / 执行中 / 阻塞 / 已合入）
+- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
```

**追加段（各 1 段，位置 = 文件末尾，「## 预期证据（执行器回填）」之后）**：

| 卡 | 追加小节 | 指针目标（全部 `Test-Path` = True） |
|---|---|---|
| C3 | `## 验收结论指针（W0 回填，2026-09-13）` | `tasks/120-turn-end-telemetry-slice.md:41/75`、`.dsh-mission/evidence/C7-review-verdict.md:240-241`、`evidence/C7b-fix-proof.md`、`evidence/C8-review-verdict.md`、`backup/turn-end-slice-final2.patch` |
| C7 | `## 验收结论指针（W0 回填，2026-09-13）` | `evidence/C7-review-verdict.md`（`:12` FAIL 0.80、`:14`、`:16-18`、`:81`、`:202`、`:158`、`:240-241`）、`evidence/C7b-fix-proof.md`、`backup/turn-end-slice-final2.patch`、`tasks/120-turn-end-telemetry-slice.md:154` |
| C7b | `## 验收结论指针（W0 回填，2026-09-13）` | `evidence/C7b-fix-proof.md`（`:109-112`、`:120`、`:129`、`:131`、`:177`）、`evidence/C8-review-verdict.md`、`backup/turn-end-slice-final2.patch`、`tasks/120-turn-end-telemetry-slice.md:154/160-184` |

**SHA256 前后对照（改前 → 改后）**：

| 文件 | 改前 SHA256 | 改后 SHA256 | 变化 |
|---|---|---|---|
| `.dsh-mission/tasks/C3-collateral-contradictions.md` | `497F7EC09C72FF106C2FA7A2BD89DCCD48061408FA2DF2F77615FD277350FA07` | `9C3784599847D231CAE1204EADC8321C4A181304496368CB8E94F54CEBB84AB1` | **变化（授权）** |
| `.dsh-mission/tasks/C7-fresh-review.md` | `2599471DD6A92150FDB2BF5591B3CF6D89CEA8E647AA99888BE888B8101BD0AD` | `23672D6B59BB49B3249F6FF62C567F3357BA9AB73570B51F4ACA80FB1EFD2E53` | **变化（授权）** |
| `.dsh-mission/tasks/C7b-fix-per-review.md` | `DEC62C86793389B68A825A6555249F1959B6BF2CD52C9A0FFCBC6AAD7643E41B` | `E4227DD7367BD6A3E75CD2F8C3E433DAD5D0FEA4F515BDCFB6835AEA64A4E7C3` | **变化（授权）** |
| `.dsh-mission/recon-report.md` | `F4871E0A400BF71DDA76CE75C00FA09C9FBEDB79E9056905C81BA07FF5B338F6` | `F4871E0A400BF71DDA76CE75C00FA09C9FBEDB79E9056905C81BA07FF5B338F6` | **逐字节不变 ✅** |
| `.dsh-mission/RUN_STATE-mission-01.md` | `1EF30F2CF1898D664435DC796A0018F5956BDDD0700EF079F5C5F9635602CDF5` | `1EF30F2CF1898D664435DC796A0018F5956BDDD0700EF079F5C5F9635602CDF5` | **逐字节不变 ✅** |

- 只读面（`evidence/C7*-verdict.md`、`evidence/C5*-mutation-record.md`）**本次全程未打开写入** ⇒ 未采集即未改变（`tasks/120`、`recon-report.md` 与两张判决报告的读取均为 `read` 工具只读操作）。
- 采集方式（改前 / 改后两次，同一命令，可复跑）：

  ```powershell
  foreach($f in @('.dsh-mission\tasks\C3-collateral-contradictions.md',
                  '.dsh-mission\tasks\C7-fresh-review.md',
                  '.dsh-mission\tasks\C7b-fix-per-review.md',
                  '.dsh-mission\recon-report.md',
                  '.dsh-mission\RUN_STATE-mission-01.md')){
    "{0}  {1}" -f (Get-FileHash $f -Algorithm SHA256).Hash, $f }
  ```

- **改前哈希已由执行器在编辑前采集并留档**（同一 `Get-FileHash` 命令，输出见本节表格「改前」列）；`RUN_STATE-mission-01.md` 的改前哈希与 `RUN_STATE.md:5` 自述的 `1EF30F2C…CDF5` **逐字一致** ⇒ 交叉验证通过。

### 三、状态与哈希（最终验证，命令原样）

```powershell
cd C:\work\Vessel_Harness
git status --short        # 期望：无输出（控制面被 .gitignore 覆盖）
git rev-parse HEAD        # 期望：c8de618775463be356a95ff94118d4918ecbd166
```

实测输出（**原样，未过滤**）：

```
$ git status --short
（无输出）
$ git rev-parse HEAD
c8de618775463be356a95ff94118d4918ecbd166
```

- `git status --short` → **空** ✅（验收标准第 4 条达成；控制面 `RUN_STATE.md` 与 `.dsh-mission/` 均被 `.gitignore` 覆盖，故本次全部写入都不出现在仓库状态里）
- HEAD → `c8de618775463be356a95ff94118d4918ecbd166`（`main`，无 remote）—— **与开工前一致**；本卡**未做任何 git 写操作**（只用 `log/status/show/ls-tree/rev-parse/hash-object` 只读命令）
- 本卡产出的新文件：`.dsh-mission/evidence/M2-mission1-reconciliation.md`（SHA256 `3A26CF81560808DDB71B5524A7407C9A88E9BC20D6B3A69D8BB239D91B9534DD`）

### 四、偏差 / 未完成项

见下方「验收结论」小节。

## 验收结论（Evaluator / 指挥会话回填）

- 结果：**执行器自评：完成（待指挥侧验收）**。10 处差异全部逐条复核落盘；三张卡状态行 + 结论指针已回填；`RUN_STATE.md` Deferred Backlog 已就地销账。
- 备注（**偏差与无法复核项，如实登记**）：
  1. **卡面写「只允许改 Deferred Backlog 里 `DSH_RECOVERY_*` 那一行」，但 `RUN_STATE.md` 的 Deferred Backlog 原文里根本没有以 `DSH_RECOVERY_*` 命名的行**（可复跑：`Select-String -Path RUN_STATE.md -Pattern "DSH_RECOVERY"` → 0 命中）。该事项在 Mission 1 侧记在 `RUN_STATE-mission-01.md:42`（「（user）… 按 finquant 先例建议归档提交 + SUPERSEDED 说明」）。⇒ 本卡把销账标注落在 Deferred Backlog 中**实际承载该事项**的那条 audit 记忆行（`tasks/` 状态不可信 + 恢复文档归档），**就地追加、未删历史**，并在标注里写明「已由 `1bc8621` 归档，销账」。**未**改动 `RUN_STATE.md` 的任何其它行（含 Active Workset 的 W0 勾选 —— 按卡面「只许改一行」的硬边界，留给指挥侧回填）。
  2. **卡面给的证据路径 `D:\workspaces\2026_09_04\composable-mission-01\backup\turn-end-slice-final2.patch` 已不存在**（实测 `Test-Path` = False）：整个仓库外目录在搬迁后已不在盘中。同内容产物现存于 `.dsh-mission/backup/turn-end-slice-final2.patch`（58945 B / `84CFD07E…CADECA`，与 `tasks/120:119-120` 的字节数/SHA256 一致）。⇒ 本卡所有指针**一律指向 `.dsh-mission/` 下的真实路径**，并已在 `M2-mission1-reconciliation.md` 里登记该坐标迁移。
  3. **第 10 条差异的「合计 97」无法复核**：`recon-report.md` 与 `RUN_STATE-mission-01.md` 都遍历不到 97 这个取数快照（明细 64+17+10+1+5 自洽但与 `tasks/` 实测 113 文件对不上，属**前 6 行窗口口径的分项和**）。已按要求写「**无法复核，原因：无落盘口径说明；分项与总数不同源**」，未编造数字。
  4. **第 3 条（已派子代理）只能给下界**：可复核 **7** 个执行器 ID（C1 `1848b8a2`、C2 `38bc7132`、C4 `234a8691`、C5 `a069a3a6`、C5b `472fad59`、C6 `d74ee4dd`、C8 `5b2dc731`），C3/C7/C7b 三张卡**未回填 ID**，故确数不可复核（上界 10 = 一卡一执行器）。
  5. **未跑任何测试 / `tsc` / `npm`，未做任何 git 写操作，未创建子 Agent** —— 完全遵守卡面禁止项；所有结论均来自只读命令与已落盘证据的交叉核对。

### 指挥侧独立验收（2026-09-13，**PASS**）

- 结果：**PASS**。执行器自评「完成」经独立复核成立，无一项需要重修（**未用 Repair**）。
- 我亲自复核的条目（不是转述执行器的话）：
  - 三张卡状态行实测 = `- 状态：已合入（…）`；行数 48 / 55 / 61，新增内容**全部在文件尾**（抽查末 6 行，均为「验收结论指针」段与真实路径）
  - `.dsh-mission/evidence/M2-mission1-reconciliation.md` 存在（17289 B / 186 行），`^### \d+\.` 命中**恰好 10 条**（编号 1–10 连续），第 10 条明确写「无法复核」而非编造
  - `<仓库>\RUN_STATE.md` 的 Deferred Backlog 承载行已就地追加 `【W0 已销账 2026-09-13】`，并逐条给出 `git show --stat 1bc8621`、`git ls-tree` 等可复跑依据；**未删除任何历史文字**
  - 只读面哈希与执行器报告**逐字一致**：`RUN_STATE-mission-01.md` = `1EF30F2C…CDF5`、`recon-report.md` = `F4871E0A…B338F6`
  - 仓库 `git status --short` = **空**；HEAD = `c8de618`（与开工前一致）
- 卡面缺陷（**记在我头上，不是执行器的**）：本卡原写「改 Deferred Backlog 里 `DSH_RECOVERY_*` 那一行」，而 Mission 2 的 `RUN_STATE.md` 里**并没有**这样一行（该事项在 Mission 1 的 `:42`）——执行器发现并就地改标注到**实际承载该事项**的那条记忆行，处置正确。**已在 Mission 2 的 RUN_STATE.md Notes 里登记该卡面缺陷**，后续卡不得再引用不存在的行。
- 计数器：`完成卡数` 0→1/4、`总卡数` 0→1/6（`runstate.js advance cards` 实测输出已留档）。
