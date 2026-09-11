# EVALUATION-REPORT-06 — Round 5 独立评估（G-04 / IMPLEMENTATION-BRIEF-05，commit c2639ca）

- 立场：全新上下文、对抗性 Evaluator；**静态审查，未复跑任何命令**（指挥侧 tsc / vitest / CLI 证据照单采信，未复现）。
- 已读：`UsageStore.ts`、`UsageStore.recovery.test.ts`、`ProviderStore.ts`、`cli.ts`；无 VCS 操作权限，"改动文件集"只能按内容推断。
- 判定：**ACCEPT**（验收标准 1–6 在要求路径上满足；2 项 P2 边界缺陷 + 5 项 P3，均不阻断本轮）。
- 注：本路径原存在一份同主题 Round 5 报告，本文件为本次独立复核重写版（其 P2/P3 已逐条独立确认）。

## 逐点判定

1. **损坏双分支隔离 — 通过**
   - 结构非法：`UsageStore.ts:453` → `quarantineCorrupted('missing entries')`；`JSON.parse` 失败：`:528` → `quarantineCorrupted('invalid JSON …')`。两者均 rename（`:546`）+ warn 含隔离后完整路径（`:547`）+ 返回空表（`:551`）。
   - ENOENT：`:446-450` catch 直接 `return { file: empty, legacy: false }`，不 rename、不 warn，符合"首次运行仍静默"。
   - 缺口：该 catch **未判 `err.code`**（见 P2-1）。
2. **`backupBeforeWrite()` — 通过**
   - `keep<=0` 早退（`:571`）；源文件 ENOENT 跳过（`:576`），其它读错 warn 后跳过（`:577`）。
   - 命名 `usage.<ISO，[:.]→->.json`（`:583-584`），基础名字典序=时间序（同毫秒 `-N` 例外见 P3-2）。
   - 超限：`existing.length >= keep` → 最旧 `renameSync` 到新时间戳名 + 写字节（`:588-597`），文件数不变、无删除；rename 失败 → `writeFileSync(oldest, bytes)` 原地覆盖（`:593`）。
   - 读/建目录/写全部失败路径只 `console.warn`（`:577`、`:601`），无 throw、不阻断；调用点在 `save()` 写 tmp 之前（`:607` → `:609`）。
3. **优先级契约 — 通过**：`resolveBackupKeep()`（`:555-562`）opts（`:557`）> `VESSEL_USAGE_BACKUP_KEEP`（`:558-561`）> 默认 5；opts 非法/负数 → 5，env 非法/空 → 5，`0` 由 `:571` 消费为"关闭"。文档明写"显式 opts 优先级最高"（`:228-235`）。偏离：BRIEF:32 要求"复用 095 的同一个环境变量名"，实际新造 `VESSEL_USAGE_BACKUP_KEEP`（与 `ProviderStore.ts:103` 的 `VESSEL_PROVIDER_BACKUP_KEEP` 并列），语义正确、命名分立（P3）。
4. **无永久删除 — 通过**：`UsageStore.ts` 无 `unlink/rm/rmdir/removeSync`；新测试文件内的 `rmSync` 仅出现在 `afterEach` 的 `mkdtemp` 清理（`recovery.test.ts:68`），与既有 `usage-store.test.ts:41` 同写法，非本改动引入。
5. **5 条测试真断言 — 通过（有覆盖缺口）**
   - 隔离文件内容**全等** `'{oops'`（`:89`）、`usage.json` 不存在（`:91`）、warn 被调（`:93`）、KEEP=2 → 0<份数≤2（`:134-135`）、KEEP=0 → backups 目录都不建（`:141-142`）、默认 5 且再写不增长（`:151-154`）。
   - 断言侧只用 `readdirSync` 列举（`:31`、`:39`），无"删掉再验证"式假检查；未发现永真断言。
   - 缺口（P3-4）：未验"备份内容 = 写前那一刻的字节"（`:118-125` 只验可解析 JSON）、未验验收 1(c)（隔离后可正常写入新表）、错误场景（rename 失败 / 目录不可建）无用例；warn 断言只含子串 `usage.json`，未断言隔离目标路径。
6. **越界/回归 — 通过（"仅动 2 文件"无法判定）**
   - `save()` 结构未变：mkdir + 备份 + tmp + `renameWithRetry`（`:605-615`），原子写未退化；`record()`（`:626-754`）仍以 `this.save()` 收尾；`recompute()`（`:775-959`）仍 dryRun/零变更不落盘（`:956-957`）；`UsageFile` 结构 `version: 2` 未变（`:200-207`）。
   - 既有用例 `usage-store.test.ts:90-96`（损坏文件 → 空表不抛错）在新语义下仍成立，无可见回归。
   - 无 VCS 权限，无法证明提交只含这 2 个文件；grep 显示新增符号（`VESSEL_USAGE_BACKUP_KEEP`、`quarantineCorrupted`）仅出现在这 2 个文件。

## 发现

- **P2-1 读失败分支过宽**（`:448-450`）：EACCES/EPERM/EBUSY 与 ENOENT 一样静默空表，随后 `save()` 会用空表覆盖"存在但读不到"的文件——G-04 同类静默丢失路径残留。最小修复：仅 ENOENT 静默，其它 code 至少 warn（或直接隔离）。
- **P2-2 隔离改名失败的告警与行为不符**（`:549` 称"本次不写入该文件"，但无任何抑制写入的状态位）：若改名失败而 tmp→rename 成功，损坏原文被覆盖，与 BRIEF:61"不得覆盖损坏文件"冲突。最小修复：置 `suppressWrite` 标志，`save()` 检测到即跳过写。
- **P3-1 隔离命名偏离字面**：BRIEF:26 / 验收 1(a) 写 `usage.corrupted-<ISO>.json` 且重名加 `-1/-2`；实现为 `usage.json.corrupted-<epochMs>`（`:544`）且无重名后缀 → 同毫秒二次损坏在 Windows 覆盖语义下会吞掉前一份隔离文件。
- **P3-2 同毫秒备份后缀排序**：`usage.<stamp>-1.json` 的 `-`(0x2D) < 基础名的 `.`(0x2E)，被 `:589` 当"最旧"，故"字典序=时间序"在同毫秒内不成立（`ProviderStore` 同款既有问题）。
- **P3-3 非法 env 静默回退 5**（`:560-561`）不 warn；`ProviderStore.parseBackupKeep`（`:145-151`）对非法值抛错，口径不一致（遥测类数据静默更合理，可接受）。
- **P3-5 标题硬编码属实**：`cli.ts:924` 固定 `=== 使用统计（~/.vessel/usage.json）===`（`:892/:894` 同类），`VESSEL_USAGE_ROOT` 指向他处时展示与实际不符。

## 结论

**ACCEPT**：验收标准 1–6 在要求路径上满足（命令类证据未复跑）。P2-1 / P2-2 建议作后续小卡（修复方向已给）；若指挥侧认定 BRIEF:61"不得覆盖损坏文件"属硬性验收项，则 P2-2 应升级为 REJECT。

> 静态审查，未复跑命令。
