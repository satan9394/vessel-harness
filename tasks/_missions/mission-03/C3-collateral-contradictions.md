# C3 清两处连带矛盾（unwiredRecords 自相矛盾 + ARCHITECTURE 配对不变式）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：P1
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1
- 来源：**blocker**（侦察 §1.3 连带矛盾 #1 + C2 报告 §2 建议裁决项）

## 目标（两件事，都是"让文档/守卫与事实一致"，**不改行为**）
1. **`packages/shared/src/unwiredRecords.test.ts:171-172`**：该处仍把 `turn/end.stats` 当作"无消费方"的例子，**与同一文件 `:38-43` 的更正自相矛盾**（该切片正是给 `turn/end` 接线）。改为与 `:38-43` 一致的表述（`turn/end` 已消费；真正未接线的按 `:38-43` 的口径列），**不得改变该守卫的判据强度**（它绑 `docs/ARCHITECTURE.md §4.11` 与代码两侧，改完必须仍是"接线绊线"而非橡皮图章）。
2. **`docs/ARCHITECTURE.md:176`** 的通用不变式「`turn/start→turn/end` 全部配对且编号连续；任一缺失 = 日志腐败」**同样被同一条异常路径证伪**（provider 抛不可重试错误 ⇒ 该回合没有 `turn/end`，而 `before_turn` 已发）。按与 C2 相同的处理方式**就地收窄**：写明"该配对只在成功收尾的回合上成立" + 登记反例与机制（`AgentLoop.ts:462-463` → `:528` 不可达；`PRODUCT-GAP-MAP.md:430` 早有记录）。
   - **硬约束**：这是**纯文档收窄**，**不得**改 invariant 自检代码、不得改 `docs/EVENT-SPEC.md` 的字段语义、不得改任何运行时行为。

## 限制条件 / 禁止事项
- 只允许改：`packages/shared/src/unwiredRecords.test.ts`、`docs/ARCHITECTURE.md`（**只允许改与上述两处直接相关的行**）
- **不得**改运行时源码（`packages/*/src/*.ts` 中非测试文件）；不得改 `Telemetry.ts`（C2 已定稿）
- 不得跑 `tsc -b` / `test:all`；**最多 1 次**定向 `npx vitest run packages/shared`（因为改了该包的守卫测试）
- 不得 install / 改 lockfile；不得 `git add/commit/stash/restore/checkout/clean`；不得删除文件
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配）

## 验收标准（客观门禁）
- [ ] `unwiredRecords.test.ts` 的 `:171-172` 不再把 `turn/end.stats` 当"无消费方"，且与 `:38-43` 口径一致
- [ ] 该守卫**判据未削弱**：贴出改动前后该处断言/清单的对照，说明"绊线"仍在起作用
- [ ] `docs/ARCHITECTURE.md:176` 已加条件 + 反例 + 机制引用；**未**改 invariant 自检代码、**未**改 `EVENT-SPEC.md`
- [ ] 定向 `npx vitest run packages/shared` → 全绿 exit 0（贴输出）
- [ ] `git status --short` 仍为 8 项同集合（HEAD 未动、暂存区空）
- [ ] `git diff --numstat` 中运行时源码文件（非测试）**零改动**

## 依赖
- 依赖任务卡：C2

## 预期证据（执行器回填）
- [ ] 两处改前/改后对照
- [ ] 守卫判据未削弱的说明 + 对照
- [ ] 定向 vitest 输出与退出码
- [ ] `git status --short` 与 `git diff --numstat`
- [ ] 偏差 / 未完成项

## 验收结论指针（W0 回填，2026-09-13；**只追加，不改正文**）
- **结论：已合入**。本卡两处改动（`unwiredRecords.test.ts` 与同文件 `:38-43` 对齐、`ARCHITECTURE.md:176` 就地收窄）**已随切片提交进仓库**：
  - 切片本体 = `f28044e`（9 文件 +937/−26），其中 `packages/shared/src/unwiredRecords.test.ts` = `+10/−2`、`docs/ARCHITECTURE.md` = `+2/−2`（`git show --stat f28044e`）。
  - 守卫判据**未削弱**：改动为**纯注释**，删/改行数与原 `5/1` 断言集逐字未变（`tasks/120-turn-end-telemetry-slice.md:75` 的 C3 段；`C7b-fix-proof.md` 与 `C8-review-verdict.md` 的复查亦确认双向守卫仍成立）。
  - 定向 `npx vitest run packages/shared` 全绿（`tasks/120-turn-end-telemetry-slice.md:75`）。
- 证据文件（逐个 `Test-Path` = True）：
  - `tasks/120-turn-end-telemetry-slice.md`（仓库内；`:41` = 本卡验收标准第三条销账、`:75` = C3 段）
  - `.dsh-mission/evidence/C7-review-verdict.md`（`:240-241` = C7 独立复核 `packages/telemetry` 3 files / 27 passed）
  - `.dsh-mission/evidence/C7b-fix-proof.md`、`.dsh-mission/evidence/C8-review-verdict.md`
  - 冻结坐标：`.dsh-mission/backup/turn-end-slice-final2.patch`（58945 B / `84CFD07E…CADECA`）