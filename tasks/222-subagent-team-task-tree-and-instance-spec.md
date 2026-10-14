# T222 — Epic: Full Architecture & UI/UX Plan Completion

- Status: 已验证（2026-10-14，OpenCode goal 模式交付；证据 evidence/sessions/2026-10-14-card222/PROOF.md）
- Mode: goal
- Source: human-requested
- Risk: medium

## Goal
Comprehensive implementation and final closure of all remaining P2/P3 items from the Architecture Improvement Plan (ARC-10, ARC-11) and Web UI/UX Improvement Plan (UI-013, UI-015, UI-016, UI-017) to achieve 100% plan completion before returning to main.

## Not Doing / Constraints
- Zero changes anywhere under `packages/core`; no new dependencies or non-npm locks.
- Local only: no git commit, push, publish, external harness invocation, or deletion.
- All subagents must reuse the existing core AgentLoop with scoped presets and policies; strictly no second execution loop.
- Web builds must always carry `-- --emptyOutDir false`.

## Acceptance Criteria

### 1. ARC-10 & UI-016: Subagent/Team Task Tree Scheduling & Visual Hierarchy
- [x] Contract & Spec (`packages/shared`): define `AgentInstanceSpec` (`instanceId`, `parentInstanceId`, `modelProfileRef`, `behaviorSnapshotRef`, `policyScopeRef`, `contextScopeRef`, `toolScopeRef`, `budget: ExecutionBudget`) and `TaskLease` / `TaskTreeNode` schemas.
- [x] Task Tree Scheduler (`packages/application`): DAG dependency orchestration, lease timeouts, deterministic parent-to-child cancellation propagation, child result aggregation, and monotonic permission narrowing (ParentScope ∩ PresetScope ∩ GlobalPolicy).
- [x] UI-016 Team Task Tree (`apps/web` & `apps/local-server`): expose `/api/tasks/tree` and render interactive Task Tree in Workbench/Activity with node statuses (`pending | running | waiting_approval | completed | failed | cancelled`), execution metrics, and parent/child navigation.

### 2. ARC-11: Fault Injection & Golden Conformance Test Suite
- [x] Fault Injection Gates: test crash/interruption recovery at critical boundaries (pre-dispatch intent, post-dispatch effect, post-tool result, approval transition), asserting no duplicate execution of non-idempotent tools via `EffectJournal`.
- [x] Golden Conformance Suite: end-to-end golden fixtures asserting L0→L4 behavior stability, policy narrowing enforcement, and 100% conservation across compaction.

### 3. UI-013, UI-015 & UI-017: Activity Queue, Agent Studio Composer & Trace Diagnostic
- [x] UI-013 Activity Centralized Approval Queue: aggregate active and `WAITING_APPROVAL` runs across projects in Activity view, allowing immediate inspection and approval.
- [x] UI-015 Agent Studio Composer: upgrade Studio from read-only inspector to interactive Composer, supporting preset rule composition, priority sorting, conflict detection, and live Conformance verification reports.
- [x] UI-017 Trace & Diagnostic: structured event/step inspection panel with sanitized argument display and layout persistence.

### 4. Gates & Delivery Integrity
- [x] All targeted backend and frontend tests pass.
- [x] Final ordered gates (`npx tsc -b`, `npm run typecheck:tests`, `npm run -w @vessel/web build -- --emptyOutDir false`, `npm run test:all`) all exit 0 (dual roots, >=3296 passed / 6 skipped).
- [x] `git diff --stat packages/core/` strictly empty (0 lines).
- [x] Offline Chromium + CDP real screenshots captured for Task Tree, Activity Queue, and Studio Composer (zh/en, desktop & 800px) and archived in `evidence/sessions/2026-10-14-card222/`.

## Blast Radius
- `packages/shared`, `packages/application`, `packages/behavior`.
- `apps/local-server/src/routes/` (`taskRoutes.ts`, `activityRoutes.ts`, `behaviorRoutes.ts`).
- `apps/web/src/components/` (`tasks/TeamTaskTree.tsx`, `activity/ActivityQueue.tsx`, `studio/AgentStudioComposer.tsx`, `trace/TracePanel.tsx`).
- Targeted tests and bilingual dictionaries.

## Expected Evidence
- Targeted test logs and ordered final gate logs (`final-01..04`).
- Chromium CDP real screenshots and capture metadata json.
- Final diff/core/lock audit and task index update in `tasks/README.md`.

## Result
- Verdict: 已验证（2026-10-14，纯本地未提交；四门顺序 exit 0；双 Root 3,356 passed / 6 skipped；`packages/core` 行修改 0）
- Evidence: `evidence/sessions/2026-10-14-card222/` → `PROOF.md`、`REVIEW.md`（对抗评审）、`final-gates.json`、`final-01..04-*.log`、`card222-{activity,studio}-{en,zh}-{desktop,mobile800}.png`（8 张）、`browser-capture-meta.json`、`browser-fixture.ts`、`capture.mjs`、`run-gates.ps1`。
- Residual risk: 见 `PROOF.md`「Residual risk / not claimed」——scheduler 尚未装配到真实 `AgentLoop` 支持的 executor；`PermissionScope` 目前是调度层契约，尚未成为 `PolicyEngine`/`Executor` 的额外执法点；故障注入以同文件第二个 `EffectJournal` 模拟重启边界（未杀真实进程）；Golden Conformance 只断言 L0–L4 可用性与确定性、不宣称 L4 运行时已验证；Compaction 断言守恒谓词而非采样摘要；Web 组件测试以静态渲染 + 注入 fixture 覆盖，DOM 交互经 API 客户端契约与纯函数间接受检。
- Resume: 已闭环，交证即停；不自动续新路线。
