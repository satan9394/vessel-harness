# 任务卡 353: `Session.append` 重开不重取租约（单写者被绕过）

- Status: 已验收（2026-10-27 验收：Codex 实现 + 独立复核 PASS，协调者复跑 core/session 3 文件 / 27 passed、core 20 / 133、两处 tsc exit 0，全量门禁 17 步全绿）
- PDW task: none
- 实现方式：PDW `implement` + `review`（DeepSeek，写者 high、复核 max），契约 `.pdw/contracts/353-session-append-lease-bypass.json`
- 来源：`docs/product-evolution/PRODUCT-STATE.md` Round 11「残留（下一批）」第 ① 条；交接单 T7

## 1. Goal

`packages/core/src/session/Session.ts` 构造时 `acquireLease` 拿 `.lease`，`close()` 删掉它并把 `fd` 置空；但 `append()` 在 `fd` 为空时只重新 `open(logPath, 'a')`，**没有再取租约**。于是 `close()` 之后再 `append()` 会在无租约的情况下继续写日志——单写者 fail-closed 被绕过。修掉它，同时保留「陈旧租约可回收、close 后可重开」的既有语义。

## 2. 要做的事

1. 先写会失败的测试复现：同一个 `Session` 对象 `close()` 后 `append()`，在修复前该用例必须是红的（能写成功），修完后语义见 §4。
2. 修：`append()` 重开句柄前重新 `acquireLease`（复用静态方法），或把对象标记为不可再用并抛明确错误。二者皆可，但必须满足 §4。
3. 负向测试：`.lease` 里写一个确定存活的 pid（例如测试进程自己），`close()` 后 `append()` 必须失败且不写入任何记录。
4. 不改 append-only 语义、不改 `.lease` 文件格式（两行：pid、ISO 时间戳）、不动 `replaceRegion` 的压缩语义。

## 3. Not Doing

- 不改 `Session` 的公开构造签名，不加新依赖，不动 `packages/core` 之外的文件。
- 不引入后台心跳、不把租约改成 OS 文件锁（`flock` 类）。
- 不修改 `close()` 的 best-effort 释放语义。

## 4. Acceptance

1. 修复前有一条红测试证明当前行为（close 后 append 会写成功）。
2. 修复后：`close()` 后 `append()` 重新取租约并成功（既有 reopen-after-close 行为不回归）。
3. 修复后：租约被其它存活进程持有时，`close()` 后 `append()` 抛错且日志文件不新增任何字节（fail-closed）。
4. 陈旧租约回收、正常 append、resume 合成 `interrupted` closer 三条既有行为不回归。
5. 只改 `packages/core/src/session/Session.ts` 与两份测试；`tsc -b`、`tsc -p tsconfig.test.json --noEmit` 干净。

## 5. Blast Radius

`packages/core/src/session/Session.ts`（core 的租约语义），以及 `Session.test.ts`、`SessionLease.test.ts`。core 是薄核，改动必须最小且不改变对外契约。

## 6. Expected Evidence

红测试的失败输出、修复后的测试计数、负向用例的报错文本、两处 tsc 的 exit、`git diff --stat -- packages/core`。

## 7. Result

- T7 完成（2026-10-27，Codex 应用辅助模式）；仅填写本 Result，不改卡面状态或索引。实现与独立只读复核均为 `gpt-6.1-sol` / `high`（交接单：core 安全语义与 fail-closed）；未请求 Fast/Ultra。
- 修改 `Session.ts`、`Session.test.ts`、`SessionLease.test.ts`：独立记录租约持有状态，close 后 append 在修改内存/日志前重取租约；保留 reopen、resume、append-only、租约格式与 replaceRegion。新增 3 条租约回归，并补 post-compaction append 断言；原有两行 Decision 24 注释保留。
- 要求的修复前 RED：`node node_modules/vitest/vitest.mjs run packages/core/src/session` exit 1，3 failed / 24 passed；原实现遇存活租约仍 resolve，重开后 `.lease` 缺失，陈旧租约未回收。修复后负向用例抛 `Session is already open by process <pid>: <sessionDir>`，JSONL 字节、replay 与租约均未改变。

| 最后源码编辑后的自验命令 | exit | 结果 |
|---|---:|---|
| `node node_modules/vitest/vitest.mjs run packages/core/src/session` | 0 | 3 文件 / 27 passed；协调者独立复跑同计数 |
| `node node_modules/vitest/vitest.mjs run packages/core` | 0 | 20 文件 / 133 passed |
| `node node_modules/typescript/bin/tsc -b tsconfig.json` | 0 | 无诊断 |
| `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit` | 0 | 无诊断 |

- 独立复核 PASS：核对当前 diff、原始红/绿日志与 SHA-256，确认租约获取先于 append 状态变化；初始懒打开、resume、compaction 不受影响，无待修发现。
- `git diff --stat -- packages/core`：仅上述 3 文件，68 insertions（含已有 2 行注释，本轮 66 行）。证据：`C:/work/AppData/Local/Temp/vessel-wave-a-KgYB0Y/T7-result.json` 与同目录 `T7-expected-red.log`、`T7-01-session.log` 至 `T7-04-tests-typecheck.log`。
- 已核对产物 SHA-256：`Session.ts` = `2da1945165c11a77396d427a5f4dabfe6a16a357624c2fe25498b5b07346b56f`；`Session.test.ts` = `236c71459362964c4aa408439ed4c13603b0d23c0bd588abac72d1d290b7aa92`；`SessionLease.test.ts` = `2d3e87b8fd714c1b5aca365091dd430d88b65dc9a536f13142d02f7c07bab17e`。
- 未做：全量门禁、commit/push、分支、外部 Agent CLI、`.pdw/` 或技能修改。被拒命令：无；探索读取不存在的 `SessionLease.ts` 得到 ENOENT，不属于自验门禁，后续读取真实 `.test.ts`。

#### 协调者验收（2026-10-27，独立复跑，不采信实现者自述）

- 代码复核（`packages/core/src/session/Session.ts`）：新增 `leaseHeld` 标志，构造时视为已持有；`append()` 开头 `if (!this.leaseHeld) { Session.acquireLease(this.dir); this.leaseHeld = true; }`；`close()` 末尾置 `false`。`replaceRegion()` 只关句柄、不释放租约，所以压缩后 append 不会重复取租约——这一条与既有压缩语义一致，没有引入「压缩后再也写不进去」的回归。
- 保留的边界（写在这里免得下一个人以为是漏洞）：`close()` 里删 `.lease` 失败时仍会把 `leaseHeld` 置 false，此时文件还在、pid 是当前进程 → 下一次 `append()` 重取租约会抛 `already open by process <pid>`。这属于「删不掉锁文件」的既有一等失败路径，不是新增行为；要彻底处理得改成 close 成功后才置 false 并区分错误类型，超出本卡范围。
- 我自己的复跑（日志未留仓库）：`vitest run packages/core/src/session` exit 0、3 文件 / **27 passed**；`vitest run packages/core` exit 0、20 文件 / **133 passed**；`tsc -b`、`tsc -p tsconfig.test.json --noEmit` 均 exit 0。
- 全量门禁 `scripts/gate-batched.ps1`：**17 步全绿**，其中 `shared+core` 31 文件 / 279 passed + 1 skipped（比上轮 +3，正是本卡新增的租约用例）；离线 conformance 25/25、$0。
- 未接过：`docs/product-evolution/PRODUCT-STATE.md` Round 11 那一条应改状态，本卡没动该文件——留到卡 346 收口时统一处理。
