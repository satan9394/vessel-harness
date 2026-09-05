# V0.2 执行进度（V02-PROGRESS.md）

> 接力文档：headless 会话按里程碑推进，每完成一个里程碑更新本文件（代码+测试落盘）。
> 权威依据：docs/MISSION-V0.2.md（任务书）、DESIGN-DECISIONS.md / ARCHITECTURE.md / EVENT-SPEC.md。
> 最后更新：2026-09-05（V0.2 全里程碑完成）。
> 非沙箱复核（总指挥，2026-09-05）：在正常环境复跑 `npx vitest run` 结果 **18 文件 / 104 用例全绿（exit 0）**，`npx tsc -b` exit 0——本节所述"4 项沙箱 EPERM 失败"与"StdioTransport/真实 git 未验证"均为 headless 会话自身沙箱环境限制（无法 spawn piped stdio 子进程），在非沙箱环境不存在；MCP stdio spawn（add 40+2=42）与真实 git worktree round-trip 已由独立审查补跑通过。独立审查 VERDICT: PASS（docs/REVIEW-REPORT-V02.md）。

---

## 0. 环境事实（本会话实测，接力者必读）

- **沙箱限制（关键）**：本 headless 会话文件沙箱为 workspace-write，但 OS 层禁止子进程以 piped stdio 派生（Node `child_process.spawn`/`exec` 默认 stdio → `EPERM`；`stdio: 'inherit'/'ignore'` 可以）。后果：
  - `npx vitest run` **无法在本沙箱启动**：vitest 启动时 esbuild 需要 spawn 服务进程（piped stdio）→ EPERM；escalation 到 danger-full-access 需要审批通道，本会话无应答者 → fail closed。**非代码问题**，换非沙箱环境（或审批可用）即可 `npx vitest run`。
  - 所有真实子进程执行类测试（Shell 工具执行、benchmark `run_check`/B005 Shell）在沙箱内同样 EPERM 失败——**4 项**因此失败（见 §1），非回归。
- **沙箱内验证通道**：`scripts/dev-test/`（vitest 兼容 shim + @cah 别名 loader + 发现型 runner，纯 in-process 无 spawn）：
  ```powershell
  node --experimental-transform-types --import ./scripts/dev-test/test-alias.mjs ./scripts/dev-test/run.mjs
  ```
  它跑同一批 `*.test.ts`（与 vitest.config.ts include 一致），输出 node:test spec 摘要。shim 实现了本仓库测试用到的 vitest API 子集。**规范验证仍是 `npx vitest run`**；沙箱内以本通道为准。
- `npx tsc -b tsconfig.json` 在沙箱内**可用且通过**（exit 0）。

## 1. 测试基线

- **V0.1 基线（会话启动时）**：63 tests，pass 59，fail 4 —— 4 项全部为沙箱 EPERM（真实子进程执行）：
  1. `packages/tools/src/tools.test.ts` — "Shell runs a real command (node -e)"（Shell 工具 spawn EPERM）
  2–4. `benchmarks/runners/src/runner.test.ts` — B003/B004（`run_check` assert spawn EPERM）、B005（Shell 工具执行 EPERM）
- **V0.2 完成（当前）**：`npx tsc -b` exit 0；dev-runner 全量 **104 tests，pass 100，fail 4**（同上 4 项环境失败，无代码回归）。非沙箱环境预期 104 全绿。

## 2. 里程碑进度

| 里程碑 | 状态 | 交付 | 测试 |
|---|---|---|---|
| V0.2-M1 Subagent 核心 | ✅ | `packages/agents/src/subagent/{IsolatedRuntime,SubagentManager,createSubagentTool}`；共享事件词汇 `before_delegate/subagent_start/subagent_stop/after_delegate`（A22–A25）+ B10 `session/created` + `user/message.source='plan'` | 7 例全过 |
| V0.2-M2 Planner | ✅ | `packages/agents/src/planner/Planner.ts`：Plan 结构校验/`formatPlan`/`injectPlan`(source=plan)/`executePlan`(步骤验收驱动 Evaluator)/`generatePlan`(LLM JSON fail-loud) | 8 例全过 |
| V0.2-M3 Evaluator Agent | ✅ | `packages/agents/src/evaluator/EvaluatorAgent.ts`：隔离会话(source=evaluator) + 只读工具面(Read/Glob/Grep) + met/not_met/impossible/error + 证据；Generator 不可自证 | 6 例全过 |
| V0.2-M4 MCP 接入 | ✅ | `packages/tools/src/mcp/`：`McpClient`（McpTransport 抽象：StdioTransport + InProcessTransport）、`registerMcpTools`（`mcp__<server>__<tool>` 动态注册）、fixture stdio server（`echo-server.ts` + `echoServerCore.ts`）；ToolRegistry 增 `register/unregister`；policy 对 MCP 工具同名生效 | 6 例全过 |
| V0.2-M5 Parallel Exploration | ✅ | `packages/tools/src/registry/parallel.ts`：`ParallelScheduler` 读写分流（file_read/search 并发滚动池 clamp [1,3]，写/独占串行屏障，结果按输入序稳定） | 5 例全过 |
| V0.2-M6 Git Worktree（可选） | ✅ | `packages/tools/src/git/Worktree.ts`：`createWorktree/removeWorktree/listWorktrees/sanitizeBranch`，GitRunner 可注入（沙箱内无法真实 spawn git，测试用 fake runner；真实执行走 `defaultGitRunner`） | 5 例全过 |
| V0.2-M7 收尾 | ✅ | compose 接线（subagent/mcp 选项）+ runner 驱动（planner/evaluator）+ 新 assert（event_seen/record_seen）+ **B016–B019 场景与 offline 脚本**（subagent 委派/planner 规划/evaluator 拒绝/MCP 调用，全过）+ 本进度 + V02-IMPLEMENTATION-NOTES.md | 104 总 / 100 pass / 4 环境 fail |

## 3. V0.2 验收标准映射（第六节）

1. ✅ 可运行代码 + 测试：104 tests（≥ V0.1 63），`npx tsc -b` exit 0（沙箱内验证通道见 §0）。
2. ✅ Subagent 端到端：B016 经 compose 派生 1 个子代理完成独立任务并回传（final_text 含 CHILD-ANSWER-77 + tool/call Subagent）。
3. ✅ Planner + Evaluator Agent 闭环：B017（规划→注入上下文→步骤验收驱动 Evaluator→"计划执行通过"）+ B018（Generator 产出 → 独立 Evaluator Agent 判定 not_met + 证据，回投父上下文）。
4. ✅ MCP：B019 注册 `mcp__demo__add` 并执行；单元测试覆盖 deny 规则/denied_tools/pre-execute 对 MCP 工具生效。
5. ✅ B001–B005 无回归（沙箱内 B003–B005 因 spawn EPERM 环境失败，非代码问题）；新增 B016–B019 四场景可跑且全过。
6. ✅ docs/V02-IMPLEMENTATION-NOTES.md（新增模块地图/运行方式/测试/已知限制）。
7. ⏳ 独立审查：本 headless 会话无独立审查 Agent；以第六节逐条证据映射供接收方核验（依赖方向、Gen/Eval 分离、无 V0.1 回归均已在实现中落实）。

## 4. 已知限制（详见 V02-IMPLEMENTATION-NOTES.md §6）

- 沙箱内无法跑 `npx vitest run` 与真实子进程测试（esbuild/spawn EPERM）——非沙箱环境即恢复。
- MCP `StdioTransport`（真实 spawn 服务器）与 Worktree `defaultGitRunner`（真实 git）在沙箱内未做运行时验证（tsc 通过 + 逻辑经 in-process transport / fake runner 验证）；需非沙箱环境补跑。
- Planner 步骤执行用确定性验收评估（离线车道）；LLM 评审由 Evaluator Agent 承担。
