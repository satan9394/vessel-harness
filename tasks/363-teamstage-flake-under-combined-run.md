# 任务卡 363: `teamStageApi` 在合并 vitest 调用下的偶发失败

- Status: 待执行（可选，优先级最低）
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
