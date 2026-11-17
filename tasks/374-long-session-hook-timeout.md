# 任务卡 374: longSessionResilience 的 30s hook 超时（Windows runner 抖动第二次）

- Status: 已完成待观察（2026-11-02；本地与类型检查绿，CI 两腿待这次推送确认）
- PDW task: none
- 触发条件：`AGENTS.md` §3.2 A3 写着「Windows runner worker 启动抖动，**若再出现第二次**就立卡」。实测第二次：
  - 2026-10-31 PR #48 `build (windows-latest, 26)`：`benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`
    → `Error: Hook timed out in 30000ms.`（同 run 里 333 个文件通过，仅此一个套件挂）。
  - 2026-11-02 `main` `6dc564c9`（纯文档提交）`build (windows-latest, 22)`：**同一套件、同一报错**。
  - 两次本地复跑都正常：`npx vitest run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`
    → 5 passed / 6.6s。

## 1. 定性

不是产品缺陷，也不是断言失败：`beforeAll` 里跑的是完整 100 轮离线韧性场景（50 万+ 注入 token、压力压缩、重启、
MCP 卡死清理），本地 6.6s，但 Windows runner 上要同时跑 334 个测试文件、且默认 30s hook 超时是给普通用例定的。
仓库既有口径（`AGENTS.md`「构建与依赖纪律」）明确说：「测试超时不是断言：真实 IO / 大队列用例要显式给足超时
（如 1500 任务的队列用例 120s、真实 job holder 用例 120s）」。

## 2. 决定

给该套件的 `beforeAll` / `afterAll` 显式放宽到 120s，**不改任何断言、不跳过任何用例、不拆场景**（场景的 100 轮
与所有阈值照旧）。不动 vitest 全局 `testTimeout`，避免把「真挂住」也一起放过。

## 3. Acceptance

- A1 `beforeAll` 与 `afterAll` 都带显式 120s 超时；断言、预期值、场景参数零改动。
- A2 本地 `npx vitest run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts` 全绿（5 passed）。
- A3 `npm run typecheck:tests` exit 0。
- A4 推 `main` 后 Windows 两腿（22/26）连续绿；若再次出现同一 hook 超时，说明 120s 也不够，届时按响应变慢
  （maxWorkers / 拆分场景）另开卡，而不是继续抬超时。

## 4. Blast Radius

`benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`（仅两行超时参数）。禁止改该目录的
场景实现、`vitest.config.*`、CI 配置。

## 5. Result

**已改（2026-11-02）**：`beforeAll(..., 120_000)`、`afterAll(..., 120_000)`；断言、期望值、100 轮场景参数、
`cleanupUnresponsiveMcp` 全部零改动（`git diff` 仅两行超时参数）。

- A1 满足（只有两行超时参数变化）。
- A2 本地 `npx vitest run benchmarks/runners/src/conformance/resilience/longSessionResilience.test.ts`：**5 passed**，
  本机耗时 6.6–12.9s（差异来自同时跑其它任务）。
- A3 `npm run typecheck:tests` exit 0。
- A4 本次推送的 `main` run 观察中；「连续绿」需要后续若干次 run 才能成立，本卡只记一次，**不宣称已根除**。
  复发判据与替代方案（maxWorkers / 拆场景）已写进 `HANDOFF.md` §3.2 的 A3 行。
