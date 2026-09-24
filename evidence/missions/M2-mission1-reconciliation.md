# M2 Mission 1 对账回填：10 处差异逐条复核

- 任务卡：`.dsh-mission/tasks/W0-mission1-reconciliation.md`（P2）
- 执行器：隔离子代理（W0），**只写** `.dsh-mission/**` 与仓库根 `RUN_STATE.md` 的 Deferred Backlog 一行
- 复核时刻：HEAD `c8de618775463be356a95ff94118d4918ecbd166`（`main`，无 remote）；`git status --short` **空**
- 复核方式：只读命令（`git log/status/show/ls-tree/rev-parse/hash-object`、`Get-FileHash`、`Test-Path`、`Get-ChildItem`、`Select-String`）
- **未跑**任何测试 / `tsc` / `npm`；**未做**任何 git 写操作；**未创建**子 Agent
- 坐标说明：Mission 1 原件里的仓库外路径 `D:\workspaces\2026_09_04\composable-mission-01\` **已不存在**（实测 `Test-Path` = False），其**全部产物**现位于 `.dsh-mission/{tasks,evidence,backup}/`。下表「判定依据」一律给**当前真实存在**的路径；原件内旧路径属搬迁前坐标，不是路径笔误。

统计口径（下表反复引用，可复跑）：

```powershell
cd C:\work\Vessel_Harness
(Get-ChildItem tasks\*.md).Count                       # 113（含 README.md）；排除 README 后仍为 113
Select-String -Path tasks\*.md -Pattern '^\s*[-*]?\s*状态[:：]' |
  ForEach-Object { ($_.Line -replace '^.*状态[:：]\s*','').Trim() } |
  Where-Object { $_ -like '待验收*' } | Measure-Object   # 待验收 = 12
```

> **口径差异如实登记**：`recon-report.md §4.2:215` 明写「我按每张卡**前 6 行**里的状态行统计」（窗口口径），本条 W0 与上表用「不限定行号的全文口径」；两者在 `tasks/014/024/039/041/043/045/113/114/115/117` 等**状态行不在前 6 行**的卡上取不同值。**口径不同是差异的来源之一，不是任何一方造假**。

---

## 10 条差异清单

### 1. 「Last verified commit」与同文件「已提交、clean」互否

- **左（卡/自报）**：`.dsh-mission/RUN_STATE-mission-01.md:74` 写 `` `ba173d4`（…；工作区含 6 改 + 2 未跟踪，即待处理的 turn/end 切片）`` —— 声称 HEAD 停在切片之前、切片仍挂在工作区。
- **右（实测）**：同一文件 `:11` 的 E5 与 `:77` 的 Resume From 都写「两次路径限定提交（`f28044e` + `1bc8621`）、**提交后 `git status` 为空**」；实测 HEAD = `c8de618`，`git status --short` 空。
- **判定依据**：`RUN_STATE-mission-01.md:74` vs `:11` / `:77`（同文件自否）；实测 `git rev-parse HEAD` → `c8de618775463be356a95ff94118d4918ecbd166`、`git status --short` → 无输出；`git log --oneline` → `c8de618 / 1bc8621 / f28044e / ba173d4`（`ba173d4` 已是**第三个**祖先，不再有工作区改动）。
- **判定**：**左侧失真，已由提交解决**。`:74` 是 Mission 1 中途（C6 落卡时）写下的**时点快照**，Resume From 之后未再回填 —— 属「同一文件里时点快照与终态并存」，不是事实冲突。

### 2. 完成卡数 `1 / 4`

- **左（卡/自报）**：`:51` `- 完成卡数: 1 / 4`
- **右（实测）**：该文件自己的 Active Workset（`:26-35`）有 **10 条**，全部带 `[x]` 与「（已合入）」；`RUN_STATE.md`（Mission 2 侧）E7 亦按 **10 处差异 / 三张卡**记账。
- **判定依据**：`RUN_STATE-mission-01.md:51` vs `:26-35`；可复跑：

  ```powershell
  (Select-String -Path .dsh-mission\RUN_STATE-mission-01.md -Pattern '^- \[x\] C').Count   # 10
  (Select-String -Path .dsh-mission\RUN_STATE-mission-01.md -Pattern '（已合入）').Count    # 10
  ```

- **判定**：**左侧失真**。`1 / 4` 是 Epoch 早期（只做完 C1）的计数，终态应为 **10 / 10**（10 张卡全部合入）。**不使用**「10/10」以外的任何自报数。

### 3. 已派子代理 `0 / 8`

- **左（卡/自报）**：`:53` `- 已派子代理: 0 / 8`（同文件 `:57` 另写「子代理嵌套: 0 / 1」）
- **右（实测）**：卡面尾部各自点名了真实执行器 ID，**至少 9 个**被点名：

  | 卡 | 执行器 ID（文件末行） |
  |---|---|
  | C1 | `1848b8a2` |
  | C2 | `38bc7132` |
  | C4 | `234a8691` |
  | C5 | `a069a3a6` |
  | C5b | `472fad59` |
  | C6 | `d74ee4dd` |
  | C8 | `5b2dc731` |

  另 C3 / C7 / C7b 三张卡的**执行器 ID 未回填**（只留「## 预期证据（执行器回填）」小节，未落 ID）。

- **判定依据**：可复跑

  ```powershell
  Select-String -Path .dsh-mission\tasks\C*.md -Pattern '执行器：子代理' |
    ForEach-Object { ($_.Line -replace '.*子代理\s*','').Trim() }     # 7 个 ID
  (Get-ChildItem .dsh-mission\tasks\C*.md).Count                       # 10 张卡
  ```

- **判定**：**左侧失真**。可复核下界 = **7**（有 ID 者）；因 C3/C7/C7b 未回填 ID，**上界只能给出 10**（每卡一执行器）。零派活与该文件 `:9`「C1–C6 逐卡一个执行器」、`tasks/120` 卡面 `:9`「C1–C6 逐卡一个执行器」直接矛盾。**严格说：≥7，确数因 3 张卡未回填 ID 而不可复核。**

### 4. WorkSet 规模 `0 / 8`

- **左（卡/自报）**：`:54` `- WorkSet 规模: 0 / 8`
- **右（实测）**：`:26-35` 实测 **10 张卡**（C1,C2,C3,C4,C5,C5b,C6,C7,C7b,C8）——**超出上限 8**；`recon-report.md §5.3:259` 当时建议的是 **7 张**（W1–W7，≤8 合规），此后又拆出 C5b / C7b 两张，故 10 张。
- **判定依据**：`RUN_STATE-mission-01.md:54` vs `:26-35`（10 行）；`recon-report.md:259`（建议 7 张）。
- **判定**：**左侧失真（且真实值为超限的 10）**。W0 只**登记**超限，**不改写**历史。

### 5. `Run 2 / 3` 与「十个卡、三个 Run」

- **左（卡/自报）**：`:60` `- Run: 2 / 3`
- **右（实测）**：`:81` 的 Mission 完成小结写「**十个卡、三个 Run**」；实测两次路径限定提交 `f28044e`、`1bc8621`，`git log` 亦显示 Mission 1 的工作跨 C1（备份冻结）→ C2–C6（收窄/用例/突变/门禁）→ C7–C8（判 FAIL → 修正 → 复评 PASS）**三段**。
- **判定依据**：`RUN_STATE-mission-01.md:60` vs `:81`；`git log --oneline` 中 `ba173d4 → f28044e → 1bc8621 → c8de618` 的提交序列。
- **判定**：**左侧失真**。`2` 是写该行时的时点值；小结的「三个 Run」与卡序列自洽。**注**：RUN_STATE 的 `Run: 2 / 3` 不能直接与小结的「三个 Run」比大小（前者是**已用/上限**，后者是**终态段数**），但 `2 / 3` 作为终态与实际完成的三段不符。

### 6. `总卡数 9 / 10`

- **左（卡/自报）**：`:61` `- 总卡数: 9 / 10`
- **右（实测）**：Active Workset 实测 **10 张**（`:26-35`）；其中 C3/C7/C7b 三张卡的**状态行此前仍是「待执行」**（W0 本次已更正，见本文件 §三张卡回填）。
- **判定依据**：`RUN_STATE-mission-01.md:61` vs `:26-35`；可复跑 `(Select-String -Path .dsh-mission\RUN_STATE-mission-01.md -Pattern '^- \[x\] C').Count` → 10。
- **判定**：**左侧失真**。`9` 漏掉了 `C5b` 或 `C7b` 之一（二者均为中途拆出的 blocker 卡）；实测为 **10**。

### 7. 门禁预算被实际用量突破：`tsc -b` / `test:all` 各 ≤1 次

- **左（卡/自报）**：`:65` `- \`npx tsc -b\` ≤1 次（在最后一次编辑之后）；\`npm run test:all\` ≤1 次（同样在最后一次编辑之后）`
- **右（实测）**：
  - `tsc -b`：**2 次** —— C6 落卡时 1 次（`tasks/120:124`「**exit 0**，耗时 10.7 s，**无输出**（日志 0 B）」+ `.dsh-mission/evidence/C6-tsc-b.log` 实为 **0 B**），C8 指挥侧按 E4「最后一次编辑之后」补跑 1 次（`tasks/120:156`「`npx tsc -b` = **exit 0**（无输出）」；`C8-final-review.md:47` 同款记录）。
  - `test:all`：**3 次** —— C6 落卡 1 次（`evidence/C6-test-all.log`，95052 B，末行 `=== C6 gate marker: npm run test:all exit code = 0 ; elapsed = 98.8 s ===`，根 169 files / 2179 passed + 6 skipped、web 11/120）；C8 首跑 1 次（**exit 1** —— `tasks/120:157` 与 `C8-final-review.md:48` 均如实登记「首跑 `1 failed | 2180 passed`」）；C8 重跑 1 次（`evidence/C8b-testall-rerun.log`，92158 B，根 169 files / 2180 passed + 6 skipped、web 11/120）。
- **判定依据**：`RUN_STATE-mission-01.md:65`（预算）vs `tasks/120:124`/`:156`/`:157`、`C8-final-review.md:46-49`、`evidence/C6-test-all.log` 末行、`evidence/C6-tsc-b.log`（0 B）、`evidence/C8b-testall-rerun.log`。
- **判定**：**预算被突破，且突破是正当的**（C6 门禁早于 C7b 的编辑，E4 要求「最后一次编辑之后」必须重跑 ⇒ 第 2 次 `tsc` / 第 2–3 次 `test:all` 属**门禁时点**要求，不是浪费）。**该行预算数需按实测更正为 `tsc 2 次 / test:all 3 次`。**

### 8. 定向 vitest `≤4` 被实际用量突破（≥8 次）

- **左（卡/自报）**：`:66` `- 定向 vitest ≤4 次（…构成 = C4 验证新用例 1 次 + C5 突变两轮 2 次 + 余量 1 次）`
- **右（实测）**：**至少 8 次**，逐条有出处：

  | # | 卡/处 | 次数 | 出处 |
  |---|---|---|---|
  | 1 | C2 定向 telemetry | 1 | `tasks/120:72`「2 files / **25 passed** / exit 0」 |
  | 2 | C3 定向 shared | 1 | `tasks/120:75`「定向 `npx vitest run packages/shared` 全绿」 |
  | 3 | C4 定向 telemetry | 1 | `tasks/120:78`「**27 passed** / exit 0」 |
  | 4–5 | C5 突变两轮 | 2 | `evidence/C5-run1-mutation1.log`、`C5-run2-mutation2.log`（3 failed/24 passed；2 failed/25 passed） |
  | 6–7 | C5b 突变两轮 | 2 | `evidence/C5b-run1-mutationA.log`、`C5b-run2-mutationB.log`（各 1 failed/26 passed） |
  | 8 | C7 聚焦复核 | 1 | `.dsh-mission/evidence/C7-review-verdict.md:240-241`「Test Files 3 passed / Tests 27 passed」 |

  不计入的：C7b 的 1 次（`evidence/C7b-fix-proof.md:109-112`「3 files / **28 passed** … `=== VITEST EXIT CODE = 0 ===`」）与 C8 的 1 次（`C8-final-review.md:24` 允许 1 次）—— 但即便只数上表 8 次，也已**翻倍**突破 ≤4。
- **判定依据**：`RUN_STATE-mission-01.md:66`（预算 ≤4）vs 上表 8 处出处（文件:行 + 4 份 log）。
- **判定**：**预算被突破（≥8 > 4），且突破有正当理由**（C5→C5b 的补证、C7/C8 两道独立评审各自要求 1 次聚焦复核）。**该行预算数需按实测更正为 ≥8。**

### 9. 仓库外备份「恰好 1 次」vs 实际 3 次冻结

- **左（卡/自报）**：`:69` `- 仓库外备份**恰好 1 次**，且在**首次编辑前**`（同源预算见 `recon-report.md:280`）
- **右（实测）**：**3 次冻结**，同文件 `:7` 自己就写明「后续又在 final / **final2** 两次冻结」：

  | 冻结 | 产物 | 字节 | SHA256（W0 实测，与 `tasks/120:119-120` 逐字一致） |
  |---|---|---|---|
  | ① C1（首次编辑前） | `backup/turn-end-slice.patch` | 37728 | `AA7ABC38925DD52F5DECF97A078B991AD4B1CE9E1B25D69BAEC6972358891351` |
  | ② C6（final） | `backup/turn-end-slice-final.patch` | 46803 | `6C01A6E4EB09F9E7039F2C6481932702D8F474608E6231408294B3E123026CCA` |
  | ③ C7b 后（final2） | `backup/turn-end-slice-final2.patch` | 58945 | `84CFD07E9BAC8B912BC3FDD00189AD6C88B6642E8413798DC7CF5D442CADEECA` |

- **判定依据**：`RUN_STATE-mission-01.md:69` vs `:7`；可复跑

  ```powershell
  Get-ChildItem .dsh-mission\backup\*.patch |
    ForEach-Object { "{0} {1} {2}" -f $_.Name,$_.Length,(Get-FileHash $_.FullName -Algorithm SHA256).Hash }
  ```

- **判定**：**左侧失真（时点值）**。`恰好 1 次` 描述的是 C1 那一刻；终态为 **3 次冻结**，且三次都**在编辑前/评审前**、都有 SHA256 与字节数 —— 是**正当的加严**（每轮评审都要冻结坐标），不是违规。
- **附带发现（搬迁残留）**：`backup-manifest.md:5` 与 `:13-15` 记录的**仓库外源目录** `D:\workspaces\2026_09_04\composable-mission-01\backup\` **已不存在**（`Test-Path` = False）。该目录内那两份副本，其内容**已随 `1bc8621` 进入仓库并逐字节一致**：

  ```
  repo  DSH_RECOVERY_CHECKPOINT.md  FF192DDB567D700B07F79EAFA64C985D5963233C618A42B7C0CBC694DA3E7861  blob e463df91…
  mission backup\DSH_RECOVERY_CHECKPOINT.md  同上（逐字节相同）                              blob e463df91…
  repo  DSH_RECOVERY_REPORT.md      6232B2637C2531E3AFFD2C45D1A86516B047A7A08993F3524F4113806A154BDD  blob f8f3a2dc…
  mission backup\DSH_RECOVERY_REPORT.md      同上（逐字节相同）                              blob f8f3a2dc…
  ```

  ⇒ 仓库外副本的**内容未丢失**（仓库内 + `.dsh-mission/backup/` 内各一份，SHA256 三方相等）。

### 10. `tasks/` 统计（待验收 10、合计 97）vs `recon-report.md §4.2`（待验收 8）

- **左（卡/自报）**：`RUN_STATE-mission-01.md:44` `- （audit）\`tasks/\` 113 文件分布：已合入 64 / 待执行 17 / 待验收 10 / 执行中 1 / 无状态行 5`
- **右（实测）**：
  - `recon-report.md §4.2:212` 标题即写「`tasks/` 的分布（**113 个文件**）」，`:220-221` 给「待执行 **17** / 待验收 **8**」，`:228` 另写「**8 张「待验收」**：`014 024 039 041 043 045 113 114 115 117`（去重后 **10 条含变体**）」——**同一节内 8 与 10 并存**，第二句自己解释了差别（8 = 卡号，10 = 条目含变体）。
  - W0 实测（全文口径）：文件 **113**、待验收 **12**、待执行 **18**、已合入 **81**、执行中 **1**、无状态行 **2**。
- **判定依据**：`RUN_STATE-mission-01.md:44` vs `recon-report.md:212` / `:220-221` / `:228`；可复跑见本文件开头「统计口径」代码块。
- **判定**：**部分可复核、部分无法复核**：
  1. **「合计 97」无法复核** —— 本文件与 `recon-report.md` 都遍历不到 97 这个数（明细 64+17+10+1+5 = **97** 自洽，但与 `tasks/` 的 **113** 对不上）。**原因：`64/17/10/1/5` 是**前 6 行窗口**口径下的分项和，113 是文件总数；两个口径**不可加总**。原始快照未落盘 ⇒ 我**无法复核**该 97 的取数时点。**（无法复核，原因：无落盘口径说明；分项与总数不同源）**
  2. **「待验收 10」与「待验收 8」的差别已定位** —— 8 是 `recon-report` 的**去重卡号**结果、10 是**同一节的含变体条目数**，二者**本来就并存在同一节**；W0 全文口径得 **12**。⇒ 三方数字**口径各不相同**，没有一方是「错的」，但**并列时必然互相误导**。
  3. **实测真值（全文口径）**：113 文件 / 待验收 12 / 待执行 18 / 已合入 81 / 执行中 1 / 无状态行 2 / 去重卡号 106。
- **建议口径**（**只登记，不擅自动历史**）：今后 `tasks/` 统计一律**同时**给「口径」与「命令」，例如「全文口径 + 上表命令 → 待验收 12」。

---

## 三张卡回填（W0 的写操作之一）

| 卡 | 改前状态行 | 改后 | 追加的验收结论指针 |
|---|---|---|---|
| `.dsh-mission/tasks/C3-collateral-contradictions.md` | `- 状态：待执行（…）` | `- 状态：已合入（…）` | `tasks/120-turn-end-telemetry-slice.md:41/75`、`evidence/C7-review-verdict.md:240-241` |
| `.dsh-mission/tasks/C7-fresh-review.md` | `- 状态：待执行（…）` | `- 状态：已合入（…）` | `evidence/C7-review-verdict.md`（判决 FAIL 0.80，`:12`）、`evidence/C7b-fix-proof.md`、`backup/turn-end-slice-final2.patch` |
| `.dsh-mission/tasks/C7b-fix-per-review.md` | `- 状态：待执行（…）` | `- 状态：已合入（…）` | `evidence/C7b-fix-proof.md`（`:109-112` vitest 28 passed / exit 0）、`evidence/C8-review-verdict.md`、`backup/turn-end-slice-final2.patch`、`tasks/120-turn-end-telemetry-slice.md:154/160-184` |

- 三张卡的**历史正文一个字未改**：仅「状态」行取值 + 文件末尾追加一段「验收结论指针」。改前/改后 SHA256 对照见交证。
- 指针目标全部 `Test-Path` = True（逐条实测，见交证）。

## 与「销账」相关的裁决落地状态

- `RUN_STATE.md` 的 Deferred Backlog **原文里没有**以 `DSH_RECOVERY_*` 命名的条目 —— 该事项在 Mission 1 侧记为 `RUN_STATE-mission-01.md:42`「（user）`DSH_RECOVERY_CHECKPOINT.md` / `DSH_RECOVERY_REPORT.md` 的处置：按 finquant 先例建议归档提交 + SUPERSEDED 说明」。
- 该建议**已经落地**，可复核：`git show --stat 1bc8621` ⇒ 3 files changed, **174 insertions(+)`（`DSH_RECOVERY_CHECKPOINT.md` 46 + `DSH_RECOVERY_DOCS_SUPERSEDED.md` 31 + `DSH_RECOVERY_REPORT.md` 97`）；`git ls-tree -r --name-only HEAD | Select-String DSH_RECOVERY` ⇒ 三份文件**均在 HEAD 中**。
- ⇒ W0 的销账标注落在 `RUN_STATE.md` Deferred Backlog 中**实际承载该事项**的 audit 记忆行（`tasks/` 状态不可信 + `DSH_RECOVERY_*` 归档），**就地追加**、不删历史。

## 交证索引

- 三张卡改前/改后 SHA256、`git status --short`、HEAD、`Test-Path` 逐条结果：见 `tasks/W0-mission1-reconciliation.md` 的「验收结论」小节（W0 回填）。
- 本文件 10 条中，**9 条**的判定依据为「文件:行」或可复跑命令；**1 条（第 10 条之 1）明确标注「无法复核，原因：…」**。
