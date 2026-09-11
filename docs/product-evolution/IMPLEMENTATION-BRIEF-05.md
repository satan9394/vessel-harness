# IMPLEMENTATION-BRIEF-05 — 用量数据不再静默丢失（G-04，P1）

> Round 5 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-04 / `docs/product-audit/RELIABILITY-REPORT.md` R2。
> 一句话：**`usage.json` 损坏会被静默清零，且下次写入覆盖唯一数据源 → 用量/成本历史永久丢失，用户无感知。**

## 目标

1. 损坏的 `usage.json` **不被静默丢弃**：隔离保留（改名）并在 stderr 给出**人话警告**（含文件路径与隔离目标），随后以空表继续（命令仍可用）。
2. 写盘前**备份轮转**（与 `providers.json` 同款，task 095 既有实现）：`<root>/backups/usage.<ts>.json`，默认保留 5 份，可用环境变量调（0 = 关闭）；首次写无旧文件则跳过。
3. 全程**无永久删除**：轮转淘汰用"原地覆盖最旧"（沿用 095 语义）。

## 用户场景

用户机器上 `~/.vessel/usage.json` 被半写/杀软锁坏/手工改坏 → 下次 `vessel run` 记录用量 → 现状：**静默写回空表**，全部历史与成本消失且无提示、无备份可回滚。期望：看到一句警告（哪个文件坏了、已隔离成什么名字），历史文件仍在磁盘上；且此前每次写盘都有备份可查。

## 当前问题（证据）

- `apps/cli/src/usage/UsageStore.ts:432-439`：读文件失败 → `return { file: empty, legacy: false }`（无 warn）。
- 同文件 `:516`（`load()` 的 JSON.parse 兜底 catch）→ 同样静默回退空表。
- 同文件 `:521-529` `save()`：`tmp + renameWithRetry` 原子写，**没有** `backupBeforeWrite`（对比 `apps/cli/src/providers/ProviderStore.ts:482-529`：`writeAtomic` 前调 `backupBeforeWrite`，备份目录 `<root>/backups/`，命名 `<kind>.<ts>.json`，保留 N 份默认 5、`ENOENT` 跳过、淘汰靠覆盖最旧）。
- 参考：`ProviderStore` 对损坏是 **fail loud**（`:556` 抛 `providers file corrupted (invalid JSON): <path>`）；`CredentialStore` 用**隔离改名**模式（R2 建议复用）。用量属遥测类数据，**不应因它坏掉而阻断 `vessel run`** → 采用"隔离 + 警告 + 空表继续"。

## 理想行为

1. `load()` 遇到**损坏**（JSON.parse 抛错，或结构非法）时：
   - 把损坏文件**改名隔离**为 `usage.corrupted-<ISO时间戳>.json`（同目录；重名则加 `-1`/`-2` 后缀）；
   - 向 `process.stderr` 打一句警告：含原文路径、隔离后路径、以及"历史已保留，可用该文件手工恢复"的意思；
   - 返回空表（命令继续可用）。
   - **文件不存在**（ENOENT）**不算损坏**：保持现状（空表、无警告）。
2. `save()` 前调用备份（等价于 ProviderStore 的 `backupBeforeWrite`）：
   - 备份路径 `<usageRoot>/backups/usage.<ts>.json`（ts 字典序 = 时间序）；
   - 保留份数默认 **5**，环境变量可覆盖（命名请与 095 的既有约定对齐——先读 `ProviderStore` 里 095 用的环境变量名，**复用同一个**，不要新造）；`0` = 关闭；
   - 首次写（目标不存在）→ 直接跳过，不报错、不建空备份；
   - 淘汰策略：超出份数时**覆盖最旧**（不删除文件）。
3. 不改变既有 `usage.json` 结构（`version: 2` 等）与 `recompute`/`record` 的语义。

## 涉及模块

`apps/cli/src/usage/UsageStore.ts`（主）、必要时抽取/复用 `ProviderStore` 的备份逻辑（**不要**为此改动 ProviderStore 的公开行为；若抽取共享函数，放 `packages/shared` 并保证 ProviderStore 行为不变——此项为可选项，优先在 UsageStore 内实现等价逻辑以降低风险）、新增测试文件。

## 不能破坏什么

- 现有 usage 相关行为与测试：`vessel usage` 输出、`recompute`、cache 计价、`--strict` 语义。
- 全量 `npx tsc -b tsconfig.json` 与 `npx vitest run`（现 **117 文件 / 1258 passed + 1 skipped**）全绿。
- 测试隔离（AGENTS.md 约束 8）：一律注入 `VESSEL_USAGE_ROOT` 到 `mkdtemp` 临时目录，**不碰真实 `~/.vessel`**；临时目录清理照抄既有测试写法。
- **无永久删除**：隔离是 rename，淘汰是覆盖；不得出现 `unlink`/`rm`。
- `save()` 仍是原子写（tmp + `renameWithRetry`），不因加备份而退化。

## 验收标准

1. **损坏隔离**：临时 root 写入非法 JSON（如 `{oops`）→ 触发一次 `record()`/`load()` → (a) 原 `usage.json` **不再存在**但同目录出现 `usage.corrupted-*.json` 且内容与损坏原文一致；(b) stderr 出现**含该路径**的警告；(c) 之后 `usage.json` 可被正常写入（新表）。
2. **不误伤 ENOENT**：空 root（无文件）→ 不产生任何 `*.corrupted-*`、无警告、`vessel usage` 正常显示 0。
3. **写前备份**：连续写 3 次 → `backups/` 下出现 `usage.<ts>.json`（≥2 份）；旧的备份内容 = 写前那一刻的文件字节。
4. **保留份数**：设 `N=2`（或对应环境变量）→ 备份数不超过 2；`0` → 不产生备份。
5. 测试：新增用例覆盖 1/2/3/4（放在新的小文件里，如 `apps/cli/src/usage/UsageStore.recovery.test.ts`），并断言"无永久删除"（如备份目录文件数单调/被覆盖而非清空）。
6. `tsc -b` 0；全量 vitest 绿。

## 错误场景

- `backups/` 目录不可创建（权限）→ 记警告并继续（**不得**因备份失败阻断写入）。
- 损坏文件无法改名（EPERM，杀软锁）→ 退化为"打警告 + 空表继续"，**不得**抛错中断；不得覆盖损坏文件。
- 并发写（两次 rename）→ 沿用 `renameWithRetry` 既有语义。

## 测试要求

- 写入型微任务（单文件/单点，执行器不跑命令）；指挥复跑 `tsc -b` + 全量 vitest + **判别性 E2E**（临时 root 注入损坏 → 观察隔离文件与警告 → 再写好一次 → 观察备份出现），全程 `VESSEL_USAGE_ROOT` 隔离。
- 之后交独立静态 Evaluator 复核（Round 5 验收）。
