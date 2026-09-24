# M2 · W3b 修复轮的副本突变记录（E2/E3/E4 的判别性证明）

> 与 `M2-W1-mutation-record.md` 同性质：**执行器自报的转写**（副本已回收、无人复跑）。
> 但本文件的 §2 原始输出与 §4 可核项已由**指挥侧**独立核对过（见 §5）。

## 1. 副本与建法

- 副本：`%TEMP%\cah-w3b-mut`
- `robocopy /E /XJ /XD node_modules dist .vitest .turbo coverage .git`（`ROBOCOPY_EXIT=1` = 成功；4280 文件 / 62.39 MB）
- `node_modules` **逐条 Junction 73 条**；`.vite` 与 `apps/web/node_modules/.vite` 保持**真实本地空目录**；`.package-lock.json` 用文件拷贝
- 副本共 75 项 = 真树 75 项；跑完走**回收站**清理（`exists after = False`）

## 2. 同一次运行内施加 3 处互不干扰的突变（一次 vitest 同时取证 E2/E3/E4）

- **MUT-E2** `docs/BENCHMARK-SPEC.md` M03 行：删 ③ 从句 + 「三条并列反例」→「两条」；该行「重叠」次数 **2 ⇒ 1**
- **MUT-E3** `docs/ARCHITECTURE.md:176`：把 `全部配对且编号连续；**该不变式只在…` **折到第二物理行**；锚点行含「成功收尾」= **False**
- **MUT-E4** `packages/telemetry/src/telemetry.test.ts`：`recordTokens` 正则去掉反引号要求（`` /`([a-z]+\/[a-z]+)`/g `` ⇒ `/([a-z]+\/[a-z]+)/g`）

原始输出（未过滤，节选完整失败块）：

```
 RUN  v2.1.9 C:/Users/Satanchen/AppData/Local/Temp/cah-w3b-mut

 ❯ packages/telemetry/src/turnEndConditionGuard.test.ts (10 tests | 2 failed) 55ms
   × … > R1-3 docs/ARCHITECTURE.md:176 不变式行：同时含「成功收尾」与「预算耗尽」 10ms
     → expected [ '成功收尾', '预算耗尽' ] to deeply equal []
   × … > R1-6 docs/BENCHMARK-SPEC.md:576 M03 行：另含 M03 特有的第三条反例「重叠」 2ms
     → expected 1 to be greater than or equal to 2
 ✓ packages/telemetry/src/turnEndBoundary.test.ts (2 tests) 70ms
 ✓ packages/telemetry/src/turnEndWitness.test.ts (4 tests) 135ms
 ❯ packages/telemetry/src/telemetry.test.ts (20 tests | 2 failed) 674ms
   × … > ⑤ 文档⇄代码：§4.11 点名的回放消费集合 == finalizeRecord 的 case 集合；M05 来源名副其实 13ms
     → expected Set{ 'tool/result', …(7) } to deeply equal Set{ 'turn/end', 'tool/result', …(4) }
   × … > ⑤-neg R4 词法负例：未消费项不加反引号 ⇒ 抽取看不见（漏检），裸 token 报警器必须点名 4ms
     → expected [ 'session/created', 'request/header' ] to deeply equal []
 ✓ packages/telemetry/src/auditRecordWiring.test.ts (7 tests) 14ms

 Test Files  2 failed | 3 passed (5)
      Tests  4 failed | 39 passed (43)
MUTATION_VITEST_EXITCODE=1
```

- **E2 得证**：删 ③ 从句 ⇒ R1-6 红（`expected 1 to be greater than or equal to 2`）。
- **E3 得证**：折行 ⇒ R1-3 红（这正是"自述曾经过度泛化"的事实基础）。
- **E4 得证（并据此反驳评审）**：放宽 `recordTokens` ⇒ **⑤ 也红**（`telemetry.test.ts:325`，多收 `inject/instruction`/`plan/memory`）**且 ⑤-neg 红**（`:381`）；评审判定的"只有边界①会红"**未被观测到**（fail-fast 使 325/381 之前的断言先失败）。

## 3. 写穿检查（真实树未被污染）

```
REAL results.json BEFORE: 08:01:22.535
REAL results.json AFTER : 08:01:22.535      ← 未变
COPY results.json      : 08:03:45.018
```

## 4. 仓库内（副本之外）那一次 vitest

```
npx --no-install vitest run packages/telemetry
 ✓ turnEndConditionGuard.test.ts (10) ✓ turnEndBoundary.test.ts (2)
 ✓ turnEndWitness.test.ts (4)        ✓ telemetry.test.ts (20)   ✓ auditRecordWiring.test.ts (7)
 Test Files 5 passed (5) / Tests 43 passed (43)      VITEST_EXITCODE=0
```

另：本轮 `DEP0137`（FileHandle GC 关闭）告警**再次复现**（与 `tasks/121` §6.1 一致，是告警不是失败，仍未归因，本轮不动）。

## 5. 指挥侧事后核对（**独立做的**）

- `git status --short` 仍 **4 项**（无第 5 项）；`numstat` = `72 6 packages/telemetry/src/telemetry.test.ts`
- `turnEndWitness.test.ts` = `72EF474B…7A8335`（**与 W2 验收记录逐字一致**）、`Telemetry.ts` = `4C480CF5…F5F0B0`、`docs/**` 各哈希与 W1 记录一致 ⇒ 修复**没有**碰运行时源码、文档、W2 产物
- `turnEndConditionGuard.test.ts` 变化 = `90ED12BF…` ⇒ `BCE130B6…`（预期：被修复）
- 门禁重跑：`tsc -b` exit 0；`npm run test:all` exit 0（根 171 files / 2195 passed + 6 skipped、web 11/120；日志 `.dsh-mission/evidence/M2-test-all-rerun.log` 104538 B）
- 旧冻结实失效：对 `mission2-slice-final.patch` 跑 `git apply --check --reverse` ⇒ **exit 1**

## 6. 已知边界

1. §1–§4 是**执行器自报的转写**；副本**已回收**，无法回溯复核。
2. §5 的哈希/状态/门禁是**指挥侧独立采集**的，可复跑。
3. **E4 的反驳依据**包含脚本复算（两种突变形状下的断言行为），这半句是**复算而非 vitest 观测** —— `tasks/121` §6.9 与 `telemetry.test.ts` 注释须如实写明「末尾两条边界断言被 fail-fast 挡在后面、**未被执行**（本用例不声称其是否会被违反）」。**W4 改准**：W3b 原文在这两处写成"同样被违反/轮不到被显示"，其中"被违反"半句是**过度声称**（第二轮评审以确定性复算证伪，W4 独立复算一致），已按上式改写，只保留"未被执行"的事实。
