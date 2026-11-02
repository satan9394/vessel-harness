# 任务卡 376: authMiddleware 通知用例的 1s 轮询窗口（首次观测）

- Status: 已完成（2026-11-02；等下一次 CI 确认）
- PDW task: none
- 现象：`main` `30972220`（纯文档 + 脚本提交）的 `build (windows-latest, 22)` 红，唯一失败是
  `apps/local-server/src/daemon/authMiddleware.test.ts` → `notifies for a staged approval gate and completed offline
  team without an SSE subscriber`：`AssertionError: expected "vi.fn()" to be called with arguments:
  ['Vessel team completed', …]`。同 run 另外 333 个文件通过（3,737 passed / 8 skipped）。
- 本地复跑：`npx vitest run apps/local-server/src/daemon/authMiddleware.test.ts` → 8 passed / 5.95s，连跑两次都绿。

## 1. 定性

不是断言错误，是**轮询窗口太短**：该用例用 `vi.waitFor(...)` 的**默认 1000ms** 等一条「团队完成」通知，而这条通知要
经过 HTTP 请求 + 团队阶段执行 + 通知派发三跳；在 2 核 Windows runner 上同时跑 334 个测试文件时，1s 不够。
仓库既有口径（`AGENTS.md`「测试超时不是断言」）正是要求这类真实 IO 用例显式给足超时。

## 2. 决定

只把**这一条**的 `vi.waitFor` 显式放到 15s，断言内容与顺序零改动。不动其它 13 处 `vi.waitFor`（其中 daemon /
subagent 那几处同样走真实 IO，但目前没有观测到超时；按「不预防性改」处理，列入观察）。

## 3. Acceptance

- A1 断言、用例结构、被测代码零改动；`git diff` 只有 `{ timeout: 15_000 }` 一个参数。
- A2 本地 `npx vitest run apps/local-server/src/daemon/authMiddleware.test.ts` 全绿（8 passed）。
- A3 `npm run typecheck:tests` exit 0。
- A4 推 `main` 后 Windows 两腿绿；若这条再红（哪怕 15s 也等不到），说明不是窗口问题而是通知链路的竞态 → 另开卡查
  事件顺序，不要继续抬超时。

## 4. Blast Radius

`apps/local-server/src/daemon/authMiddleware.test.ts`（仅一行）。禁止改被测代码、`vitest.config.*`、CI 配置。

## 5. Result

- 改动：`vi.waitFor(..., { timeout: 15_000 })`，其余零改动。
- 本地：该文件 8 passed（改前 5.95s / 改后同量级），`typecheck:tests` exit 0（随推送前的检查）。
- 观察项：`vi.waitFor` 还有 13 处默认 1s（`apps/local-server/src/subagent-seam.test.ts`、`sessionModelHub.test.ts`、
  `daemon/daemonLifecycle.test.ts`、`apps/cli/src/daemon/daemonCommands.test.ts`、`packages/application/src/ExecutionLoop.test.ts`
  等）；目前未观测到超时，不预防性改，出现第二次再按同一口径处理。
