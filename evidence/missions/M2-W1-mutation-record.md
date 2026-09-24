# M2 · W1 突变实测原始记录（R1/R2/R4 守卫的判别性证明）

> 落盘原因：W1 执行器把证据**只回传在会话消息里**（原始输出未落盘）。按本 Mission 自己的纪律
> （「清单/证据必须落盘，否则下一轮只剩转述」），由**指挥侧**在评审前把执行器回传的原始内容
> 逐字归档到本文件。**本文件是转写，不是独立复跑**：可信度 = "W1 执行器自报 + 指挥侧事后核对
> 其可核对项（文件哈希、用例清单、仓库内定向 vitest 复跑）"；指挥侧**没有**重新建副本重跑这 4 处突变。

## 0. 环境

- 副本：`C:\Users\USER\AppData\Local\Temp\cah-w1-mut-71a545cf`
- 建法：`robocopy /E /XJ /XD node_modules dist .vitest .turbo coverage .git`（`ROBOCOPY_EXIT=1` = 拷贝成功，robocopy 约定）
- `node_modules` **逐条 Junction**（root + `apps/web`，共 75 条）；`.vite` 保持**真实本地目录**（防写穿真树）
- 跑完已**回收站**清理；仓库侧校验见 §4

## 1. 被删内容（4 处，逐字）

| 代号 | 文件:行 | 删掉的短语 | 该短语出现数 仓库 ⇒ 副本 |
|---|---|---|---|
| K1 | `docs/BENCHMARK-SPEC.md:576`（M03 行） | 「重叠」 | 2 ⇒ 0（行长 547 ⇒ 543） |
| K2 | `docs/BENCHMARK-SPEC.md:575`（M02 行） | 「预算耗尽」 | 1 ⇒ 0（646 ⇒ 642） |
| K3 | `docs/product-evolution/PRODUCT-STATE.md:823` | 「成功收尾」 | 1 ⇒ 0（1132 ⇒ 1128） |
| K4 | `docs/ARCHITECTURE.md:372`（§4.11 行） | 「预算耗尽」 | 1 ⇒ 0（1645 ⇒ 1641） |

上下文（仓库 ⇒ 副本，行内）：

- K1：``…**在"成功收尾且未被另一个 `runTurn` "【重叠】""的回合上**…`` ⇒ ``…未被另一个 `runTurn` ""的回合上**…``（两处「重叠」均删）
- K2：`…② **错误类别可重试但重试【预算耗尽】**（\`attempt > maxR…` ⇒ `…但重试**（\`attempt > maxR…`
- K3：`…只在**"【成功收尾】的回合"**上可信…` ⇒ `…只在**"的回合"**上可信…`
- K4：`…② **重试【预算耗尽】**（\`AgentLoop.ts:6…` ⇒ `…② **重试**（\`AgentLoop.ts:6…`

## 2. 原始输出（副本内 `npx --no-install vitest run packages/telemetry`，EXITCODE=1）

```
 ❯ packages/telemetry/src/turnEndConditionGuard.test.ts (10 tests | 4 failed) 42ms
   × … > R1-4 docs/ARCHITECTURE.md:372 §4.11 telemetry 行：同时含「成功收尾」与「预算耗尽」 11ms
     → expected [ '预算耗尽' ] to deeply equal []
   × … > R1-5 docs/BENCHMARK-SPEC.md:575 M02 行：同时含「成功收尾」与「预算耗尽」 3ms
     → expected [ '预算耗尽' ] to deeply equal []
   × … > R1-6 docs/BENCHMARK-SPEC.md:576 M03 行：另含 M03 特有的第三条反例「重叠」 3ms
     → expected [ '重叠' ] to deeply equal []
   × … > R1-8 docs/product-evolution/PRODUCT-STATE.md:823 欠账行：同时含「成功收尾」与「预算耗尽」 4ms
     → expected [ '成功收尾' ] to deeply equal []
 ✓ packages/telemetry/src/turnEndBoundary.test.ts (2 tests) 71ms
 ✓ packages/telemetry/src/telemetry.test.ts (20 tests) 702ms
 ✓ packages/telemetry/src/auditRecordWiring.test.ts (7 tests) 25ms
 Test Files  1 failed | 3 passed (4)
      Tests  4 failed | 35 passed (39)
EXITCODE=1
```

4 条红**逐条对应**4 处删除，失败信息**直接点名缺的词**；其余 6 个 guard 用例（含负面对照组）与其余 3 个测试文件全绿。

## 3. 负面对照：只做**下列**格式类改动 ⇒ 对应用例**全绿**（同上一次运行）

> **范围更正（W3b，2026-09-13；评审 E3）**：本节原来的结论句写成"**换行**/插行/标点改动**不会**变红"，
> 是**过度泛化**（下表的 N1 只测过"在锚点行**上方插一行空白**"，**从未测换行**）。实测事实：
> 把锚点行里的关键短语**折到第二行**（前缀仍在第一行）⇒ 对应 R1-* **会红**（`anchorLine` 以
> **物理行**为单位匹配，该行两个关键短语皆无）。**下表四行本身仍然属实**，被更正的是由它们归纳出的全称句。

| 代号 | 只做的格式类改动 | 结果 |
|---|---|---|
| N1 | `docs/ARCHITECTURE.md` 在锚点行**上方插入一行空白**（锚点行 176 ⇒ 177 整体下移） | R1-3 **绿**（前缀定位、不钉行号） |
| N2 | `docs/EVENT-SPEC.md:605` 只加一个句号，行 728 ⇒ 729 | R1-7 **绿** |
| N3 | `Telemetry.ts` B09 注释块内只加一个冒号 | R1-1 **绿** |
| N4 | `telemetry.test.ts` BRIEF 段里插一行空注释 ` *` | R1-2 **绿** |

⇒ **上表这四类**（上方插空行 / 注释块内插行 / 改标点）**不会**变红；只有删/改两个关键短语（或 M03 的「重叠」，且该词出现次数 <2）才红。
**例外（已知脆弱点）**：**折行会红** —— 见 `turnEndConditionGuard.test.ts` 顶部自述（W3b 已改准）与 `tasks/121` §6.8。

## 4. 真实工作树零变异（7 个文件 SHA256 前后一致，`DIFF_COUNT=0`）

```
8501D7B0…F918F4  packages/telemetry/src/telemetry.test.ts
90ED12BF…817906  packages/telemetry/src/turnEndConditionGuard.test.ts
4C480CF5…F5F0B0  packages/telemetry/src/Telemetry.ts      ← 运行时源码未动
8231E458…2F0AE4  docs/ARCHITECTURE.md
24851EBB…F4B61   docs/BENCHMARK-SPEC.md
508690CF…67016   docs/EVENT-SPEC.md
709DD042…A6C71C  docs/product-evolution/PRODUCT-STATE.md
```

写穿检查：真实 `node_modules/.vite/vitest/results.json` 时间戳 `06:48:03`（= 仓库内那次 vitest），副本自己的为 `06:50:54` ⇒ 逐条 Junction + 真实 `.vite` 生效，**未写穿真树**。清理后副本已不存在。

## 5. 指挥侧事后核对（**这一步是独立做的**）

- 仓库内 `npx vitest run packages/telemetry` ⇒ **4 files / 39 passed / exit 0**（与执行器报告逐字一致）
- 8 锚点位置与关键短语**逐条实读存在**（`Telemetry.ts` 类注释、`telemetry.test.ts` BRIEF、`ARCHITECTURE.md:176/:372`、`BENCHMARK-SPEC.md:575/:576`、`EVENT-SPEC.md:605`、`PRODUCT-STATE.md:823`）
- guard 实现读过：按**唯一前缀**定位、不钉行号、不整文件 `includes`、不镜像（直接读真实文件）
- **未做**：重新建副本重跑 §1–§3 的突变（预算：定向 vitest 已用满 6 次）

## 6. 本文件的已知边界（评审请据此定权）

1. §1–§4 是**执行器自报的转写**，不是指挥侧复跑结果 ⇒ 若评审要把它当"实测证据"，应把它降级为"有原始输出的自报"。
2. §5 的两项（仓库内定向 vitest 复跑、锚点短语实读）是**指挥侧独立做的**，可复跑。
3. 副本目录已被回收站清理 ⇒ **无法回溯**复核 §1–§4。
