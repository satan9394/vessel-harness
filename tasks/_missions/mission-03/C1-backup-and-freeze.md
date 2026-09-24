# C1 仓库外补丁备份 + 现状冻结（保命，必须在首次编辑前）

- 状态：已合入（待执行 / 执行中 / 阻塞 / 已合入）
- 优先级：**P0**（项目无 remote、6 个文件未提交、FAIL 判决只活在未跟踪文件里 ⇒ 丢失不可恢复）
- 创建日期：2026-09-13
- Mission：composable 项目 Mission 1（把 FAILED 的 turn/end 切片推到可提交）
- 来源：**blocker**

## 目标
在**任何编辑动作之前**，把当前工作区状态完整备份到**项目外**，并把现状冻结成可复核的证据。

## 要交付
1. **仓库外补丁备份**（写到 `E:\DeepSeek_Harness\workspace\2026_09_04\composable-mission-01\backup\`）：
   - 已跟踪文件改动：`git diff > turn-end-slice.patch`（**全量**，不限定路径），并记录补丁的 SHA256 与字节数
   - 未跟踪文件原样副本：`DSH_RECOVERY_CHECKPOINT.md`、`DSH_RECOVERY_REPORT.md`（**逐字节拷贝**，记录 SHA256）
   - 备份目录清单一并落盘（文件名 + 大小 + SHA256）
2. **补丁保真性校验**：`git apply --check --reverse <补丁路径>` → **exit 0**（证明该补丁忠实地表示了当前工作区 diff；不要用正向 `--check`，那必然失败）
3. **现状冻结证据**：
   - `git rev-parse HEAD` 的 40 位提交号
   - `git status --short` **全部**条目（应 8 项：6 改 + 2 未跟踪），逐条列出
   - `git diff --stat` 全量输出
   - 两个未跟踪文档的 `git hash-object` 值（供后续证明未被改）
   - 关键文件的现状哈希（至少 `packages/telemetry/src/Telemetry.ts`、`packages/telemetry/tests/telemetry.test.ts`、`packages/shared/src/unwiredRecords.test.ts`）
4. **风险登记**：一句话写明"该切片当前状态 = 实现完成 + 对抗验收 FAIL + 待收窄依据后重评"，并指向 `DSH_RECOVERY_REPORT.md §9.1` 作为一手证据

## 限制条件 / 禁止事项
- **只读项目**：不得编辑项目内任何文件、不得 `git add/commit/stash/restore/checkout/clean`、不得删除文件、不得 install
- 备份只能写**项目外**（本 Mission 工作区）
- 命令文本不得含永久删除类 API 字面名（本机 pre-execute 门禁为子串匹配，会被拦）
- 不得因为"看起来没问题"而跳过本卡——它是后续所有编辑的保单

## 验收标准（客观门禁）
- [ ] `backup\turn-end-slice.patch` 存在，SHA256 与字节数已记录
- [ ] 两个未跟踪文档的项目外副本存在且 SHA256 与项目内**逐字一致**
- [ ] `git apply --check --reverse <补丁>` **exit 0**（贴输出）
- [ ] `git status --short` 8 项逐条列出；`git rev-parse HEAD` 40 位
- [ ] 三个关键文件的现状哈希已记录
- [ ] 项目内 `git status --short` 与本卡开工时**逐字相同**（证明本卡零改动）

## 依赖
- 无

## 预期证据（执行器回填）
- [ ] 备份清单（文件 + 大小 + SHA256）
- [ ] `git apply --check --reverse` 输出与退出码
- [ ] `git status --short`、`HEAD`、`git diff --stat` 原文
- [ ] 风险登记一句话
- [ ] 偏差 / 未完成项

## 验收结论（Evaluator / 指挥会话回填）
- **PASS** → 自动合入（保命卡达标；项目零改动）
- 指挥侧独立复验：备份目录 7 个文件哈希与报告逐字相符（补丁 37728 B / `aa7abc38…`；两份未跟踪文档副本 `ff192ddb…` / `6232b263…`）
- **我亲自跑保真性校验**：`git apply --check --reverse <补丁>` → **exit 0**（补丁忠实表示当前工作区 diff）
- 项目未被改动：HEAD = `ba173d4788fe02deceb78f077c10be1053ad559f`；`git status --short` 仍 **8 项**（6 改 + 2 未跟踪）；暂存区 0 行
- 副本逐字节一致：两份未跟踪文档 项目内 vs 备份 SHA256 相等
- 客观佐证零写入：`Telemetry.ts` / `telemetry.test.ts` 的 mtime 均为 2026-09-12，**早于本会话**
- 卡面笔误已认（执行器纠正）：`packages/telemetry/src/telemetry.test.ts`（**无** `tests/` 目录）——后续卡统一用此路径
- 遗留（已列为头号未知）：6 个未提交文件当前是否全绿属 **UNKNOWN**，需在最后一次编辑后由 E4 的全量门禁确认
- 执行器：子代理 1848b8a2
