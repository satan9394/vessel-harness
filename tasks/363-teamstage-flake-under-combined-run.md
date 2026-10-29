# 任务卡 363: `teamStageApi` 在合并 vitest 调用下的偶发失败

- Status: 已验收（2026-10-29）：**判定为产品缺陷**（不是测试隔离）——NTFS file id 超过 `Number.MAX_SAFE_INTEGER` 时两侧舍入相同，path-swap 守卫失效（修复前 10/10 读到私有文件）；改为 bigint 比较 + 真实碰撞回归
- PDW task: none
- 来源：2026-10-28 协调者把 `apps/local-server` 与 `apps/cli` 放进同一次 vitest 调用时，`teamStageApi.test.ts > checks the opened descriptor identity before reading to reject a path swap` 失败过一次（`expected [Function] to throw`）。

## 1. 已知事实

- 该文件单跑：**2/2 全绿**；
- 同一组命令重跑一遍：**93 文件 / 1,101 全绿 exit 0**；
- 门禁脚本本来就分段跑（local-server 单跑 318 全绿），所以不影响门禁。

## 2. Goal

判定它是「测试隔离问题」还是「产品偶发」：

- 若是隔离问题（例如 `fs.openSync` 的 spy 未在用例间恢复、或并发 worker 共享状态），修测试并给出稳定复现条件；
- 若是产品问题（`artifact()` 在校验失败时并不总是抛），修产品并补断言。

## 3. Acceptance

- A1 给出**可重复**的复现命令（循环 N 次合并调用，记录 N 次里失败几次），或证明 N≥10 次重复下不再出现。
- A2 结论写明属于测试还是产品；对应修复必须带断言，不许只是重跑变绿。
- A3 `node node_modules/vitest/vitest.mjs run apps/local-server` 与 `apps/cli` 各自 exit 0，两次合并调用也 exit 0。

## 4. Blast Radius

`apps/local-server/src/teamStageApi.test.ts`（若判为产品问题则含 `apps/local-server/src/teamRoutes.ts`）。

## 5. 备注

若 20 分钟内无法复现，就记录「未复现 + 已尝试次数」，把本卡关成「已知偶发、不追」，不要耗整轮。

## 6. Result

待执行。

## 2026-10-29 remaining run — bounded product repair; sign-off reserved

Found a reproducible product identity defect, not a spy-isolation repair: two measured NTFS file IDs 9288674232026648 / 9288674232026649 compare equal as Number. Actual production artifact probe returned the fixture private text after descriptor swap in 10/10 attempts; preserved HEAD source reproduces 10/10 too. Using bigint stat/fstat rejects 10/10. Added a typed deterministic regression. Original historical combined flake attribution remains an inference.

A1: partial literal coverage — direct product reproduction 10/10; two frozen combined runs 0/2 failures, not N≥10 combined runs. First combined call overlapped source edits and failed the new regression (1101 passed / 1 failed); excluded from acceptance as mixed-revision. A2: 通过 / PASS for the directly reproduced product defect and regression. A3: 通过 / PASS — local-server 28 files / 319 passed; CLI 65 / 783; two combined runs 93 / 1102 each (exit 0, 261.352s / 236.038s). Focused file 12/12; final build, test types and web types exit 0. T4 ran approximately 13.5 minutes, within the 20-minute cap.

Evidence: `evidence/sessions/2026-10-29-remaining/t4-inode-probe.json`, `t4-preserved-before-repeat.json`, `t4-product-after-repeat.json`, check JSONs, `scope-audit.json`; executable reproduction script remains at the TEMP path recorded in the evidence. No card status changed; no full gate.

## 7. Result（协调者验收，2026-10-29 —— 是产品问题，已修）

**不是测试隔离，是真实缺陷。** 根因：`TeamStageRoutes.artifact()` 用 `fs.statSync/fstatSync` 返回的 `ino` 比较「打开的文件」与「路径当前指向的文件」，而 Windows 的 NTFS file id 会超过 `Number.MAX_SAFE_INTEGER`；两个不同的 id 舍入到同一个 double 后相等，path-swap 守卫就失效。执行方用实测的一对碰撞 id（`9288674232026648` / `+1`）验证：**修复前 10/10 次都读到了被换进来的私有文件内容**，修复后 10/10 全部拒绝。

修法：`fstatSync/statSync` 改取 `{ bigint: true }`，`ino/dev` 按 bigint 比较，`size > 65536n`，分配缓冲时再转 `Number()`。回归用例构造了真实碰撞对并断言仍抛 `artifact changed during open`。

我认可：测试用的是真实碰撞值、走真实 `TeamStageRoutes`；门禁里 `local-server` **28 文件 / 319 passed**（比上轮 +1），`apps/cli` 783、合并调用 1,102 两次全绿（执行方数字，我以门禁为准）。

**这条属于安全相关修复**（路径交换可越权读文件），值得单独一条提交，别混进外观改动里。
