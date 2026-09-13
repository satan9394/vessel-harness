# 122 — 残留清理与 `DEP0137` 归因：把上一轮提交物上的陈旧声明与引用改成与事实一致

- 编号：122
- 状态：待验收（等独立对抗评审；PASS 后由指挥侧提交，**本卡不提交动作**）
- 优先级：P1（不阻断功能，但属本仓头号病史「声明与实现不一致」的收尾）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 3
- 关联：`tasks/121-doc-condition-guards.md`（上一轮切片）；三轮评审判决 `.dsh-mission/evidence/M2-review-verdict{,-2,-3}.md`；`docs/product-evolution/PRODUCT-GAP-MAP.md:430`
- 执行器：隔离子代理（M1 残留清理、M2 归因各一个）

## 1. 目标

上一轮（`5f3ec0b`）把 `turn/end` 的条件变成可执行守卫之后，第 3 轮评审**顺手登记了 4 条"弱于事实或陈旧指针"级小瑕疵**，并留下一件始终未归因的事（Node `DEP0137`）。本卡把它们一次收口：**全部是"把文字/引用改成与事实一致"，不新增任何断言、不改运行时行为**。

## 2. 切片内容

**M1（残留清理，4 个文件，只改注释/文档，零断言改动）**

| # | 位置 | 改前 | 改后 |
|---|---|---|---|
| ① | `packages/telemetry/src/telemetry.test.ts:340-342` | 「…上面两条 `toContain` 先红 = 清单漏检），**同时**裸 token 报警器**在这里点名**…」 | 「…**既有**项被去掉反引号时，上面两条 `toContain` 会先红（清单漏检本身；**fail-fast ⇒ 本行轮不到执行**）。裸 token 报警器**留作新增裸词项的绊线**…」（与同文件 `:372-373` 已有口径一致） |
| ② | `packages/telemetry/src/turnEndConditionGuard.test.ts:28` | 「`Telemetry.ts`、**三份** docs、本包测试文件自身」 | 「…**四份** docs…」（实现实读 ARCHITECTURE / BENCHMARK-SPEC / EVENT-SPEC / PRODUCT-STATE，见 `:40-43`）——**原为少报** |
| ③ | `tasks/121-doc-condition-guards.md`（10 行） | `:28` `962 行`；`:146` `59  4`；`:79` 「E7」；`:145` 旧哈希；`:50/:52/:214/:220/:288` 只列 `final`/`final2` | 就地改准或**标注坐标层级**（"当时坐标 962 / 重做轮起 973"、`59 4`→`72 6`、`E7`→**`R1-7`**、`final2` **已被 `final3` 取代**、旧哈希旁注明"最终见 §8.2"）。**未删任何历史层。** 卡面偏差：`:52` 的 `turn-end-slice-final2.patch` 是 **Mission 1** 的补丁（`backup/` 下无 `-final3` 版本），按字面改指会引入新错 ⇒ 就地做"同名不同物"辨析 + 指向 §8.2 |
| ④ | `docs/product-evolution/PRODUCT-GAP-MAP.md:430` | 「（`EVENT-SPEC.md:600` 不变式）」 | 「（`EVENT-SPEC.md` 的「不变式（贯穿全图）」那一段，当前 `:605`；B06/B07 的配对不变式另见 `:470`。**行号会漂移，以符号名为准**）」——纪律 25 |

**M2（`DEP0137` 归因；结论：**core 运行时缺陷，非测试问题**）**

- **归因**：泄漏的 FileHandle 由 **`packages/core/src/session/Session.ts` 的 `loadExisting()`** 造出 —— `:141` 的 `this.append({type:'turn/end', …})` **没有 `await`**（合成收尾记录是 fire-and-forget），而 `close()`（`:250-253`）只看 `this.fd` ⇒ **"重开含未收尾回合的日志 → 立刻 `close()`"** 时 `fd` 还是 `null`（空转），随后 pending 的 `fs.promises.open` 才把 fd 赋到这个已关闭的 Session 上 ⇒ 句柄永不关闭 ⇒ GC 打出 `DEP0137`。
- **触发面**：`packages/telemetry/src/turnEndWitness.test.ts` 的用例①「崩溃合成收尾」（单文件运行即复现；三份全量日志里告警行与其 `✓` 行 3/3 紧邻）。
- **不依赖 GC 的判定器**：`.dsh-mission/evidence/M2-dep0137-minrep.mts`（两次运行逐字相同）—— A 组复刻用例①序列 ⇒ `fdAfterClose=null` 但 300ms 后 `settled=<open FileHandle> => **LEAKED**`；B 组只多一个时间片再 `close()` ⇒ `no leak`。**只差一个时间片，泄漏与否翻转** ⇒ 测试侧**没有**"资源管理"修法（该用例**已经**调了 `close()`，是 `close()` 空转）。
- **处置**：按 Mission 3 卡面硬边界，**归因到 `packages/core/**` 运行时源码 ⇒ 只登记不改**（超授权）。**本卡零运行时改动。**
- **最小修法（留给有授权的卡）**：`Session.ts:141` 改 `await this.append({ … })`（`loadExisting` 本就是 `async`）；验收判据用上面那个判定器（A 组应变 `no leak`）。**注意**：这属**运行时语义变更**（合成收尾记录的落盘时机），须独立成卡 + 独立评审。

## 3. 验收标准（客观门禁）

- [ ] M1 四条残留逐条改准，且 **零断言改动**（`expect(`/`it(` 计数前后一致 + `git diff -U0` 过滤 `expect|it(` 为空）
- [ ] M1 未触碰被守卫的 5 个文件（`Telemetry.ts` + `ARCHITECTURE.md`/`BENCHMARK-SPEC.md`/`EVENT-SPEC.md`/`PRODUCT-STATE.md`）
- [ ] M2 给出**归因结论 + 原始 stderr + GC 无关判定器**，且**零仓库改动**
- [ ] `npx tsc -b` exit 0；`npm run test:all` 两个 root exit 0（各 ≤1 次，均在最后一次编辑之后，带显式退出码）
- [ ] 独立对抗评审 **PASS**
- [ ] 路径限定提交（禁 `git add -A`），提交后 `git status` 为空

## 4. 未闭合项（逐条登记）

1. **`Session.ts:141` 缺 `await` 导致的 fd 泄漏**（本卡发现，**未修**）：影响所有"重开含未收尾回合的日志后立刻关闭"的调用方（不止测试）；除泄漏外，fire-and-forget 的合成收尾记录也**不保证在进程退出前落盘**。**属运行时语义变更 ⇒ 需独立成卡 + 独立评审。**
2. **同一告警族的更早实例**（M2 附带发现）：`C5b-run1-mutationA.log`（02:17，早于本切片）已有同一条告警，机制是 `turnEndBoundary.test.ts` 用例失败后跳过 `close()`（`:213`）的**测试卫生**问题 ⇒ 按"既有文件只登记不改"进 Deferred Backlog。
3. **M03「回合重叠口径」仍属人类裁决**（`tasks/121` §6.2 等三处一致：只标"不可信"、不发明口径）。
4. **第 9 处条件式表述仍未纳入守卫**（`tasks/121` §6.7；DoD 写死 8 锚点，改 DoD 只能人类批）。
5. **`.dsh-mission/**` 一手证据不进仓库历史**（被 `.gitignore` 覆盖）：三轮判决、两份突变记录、归因判定器都在那里 ⇒ 有丢失风险，已由本卡与 `tasks/121` 转述关键结论。
6. 范围外（只登记）：`request/header` 未接线；`costEstimate`/M11 缺口在产物侧；`before_stop` 死缝；被跟踪的 `release-report.{md,json}` 仍是旧快照。

## 5. 涉及文件

- 改：`packages/telemetry/src/telemetry.test.ts`、`packages/telemetry/src/turnEndConditionGuard.test.ts`、`tasks/121-doc-condition-guards.md`、`docs/product-evolution/PRODUCT-GAP-MAP.md`
- 只读（未改）：`packages/telemetry/src/Telemetry.ts`、`docs/ARCHITECTURE.md`、`docs/BENCHMARK-SPEC.md`、`docs/EVENT-SPEC.md`、`docs/product-evolution/PRODUCT-STATE.md`、`packages/core/src/session/Session.ts`（**缺陷所在，本卡不动**）
- Mission 侧（**不提交**）：`.dsh-mission/evidence/M2-dep0137-attribution.md`、`M2-dep0137-minrep.mts` + 4 份 run 日志、`M2-review-verdict{,-2,-3}.md`

## 6. 门禁实测（原样回填，未过滤）

（指挥侧在 M1/M2 全部编辑之后执行；本节是门禁之后唯一的写操作，且只写本卡 —— 与 `tasks/120` §8、`tasks/121` §8 同做法。）

- `npx tsc -b tsconfig.json` ⇒ **TSC_EXIT=0**
- `npm run test:all` ⇒ **TESTALL_EXIT=0**：根 `171 files / 2195 passed | 6 skipped`、`apps/web` `11 files / 120 passed`（日志 `.dsh-mission/evidence/M3-test-all.log`）

## 7. 验收结论（指挥侧独立评审回填）

- 结果：**PASS**（独立对抗评审，高置信度）
- 备注：
  - **披露**：本节是在评审 PASS **之后**回填的；评审覆盖的是**冻结坐标**（`mission3-slice-final.patch` 17626 B / `68B38CEB…71F1` + `tasks/122` 的冻结副本），**本节的回填不在评审覆盖范围内**（`tasks/122` 是**未跟踪**文件、不进任何 patch；与 `tasks/120` §8/§10、`tasks/121` §10 同做法）。
  - **评审怎么查的**：全新上下文、只读、**8 次工具调用**完成六项（①零断言改动 ②受保护文件零改动 ③M1 四条 ④M2 归因链 ⑤有无新的"声明强于事实" ⑥该登记是否漏登记）。六项**全部通过**，未发现 FAIL 项。
  - **评审未能验证的 3 条（如实，均不构成 FAIL）**：① §6「本节是门禁之后唯一的写操作」属流程声明，只读无法核；② `npx tsc -b` 的 exit 0 **无日志可证**（`M3-tsc-b.log` 0 字节，与 C6 那次同一形态的已知弱点）；③ `turnEndBoundary.test.ts:213` 的精确行号未逐字确认。
  - **评审的独立复核点**：`tasks/122` §6 的两个门禁数字与 `M3-test-all.log` 的汇总行**逐字相符**；"三份全量日志各 1 次"的 DEP0137 计数实测吻合；M1 四条改准、`Session.ts:141` 归因链成立、"测试侧无可做修法"成立、历史层未被删。
  - **评审建议（与本卡 §4 一致）**：本卡落地后，为 `Session.ts:141` 的 `await` **单开一张 core 卡**（运行时语义变更，须独立评审）。
  - **评审过程的如实登记**：本 Mission 的**第一次评审**因读得过多而**耗尽回合额度、未产出判决**；经指挥侧用掉最后一格 `已派子代理` **重派一次范围收窄的评审**（≤20 次工具调用、8 次用毕）才得到本判决。这不是"FAIL 后再试一次"，而是补上一次**没跑完**的评审——但它确实多花了一格预算，如实记录。
