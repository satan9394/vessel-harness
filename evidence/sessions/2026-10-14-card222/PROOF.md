# Card 222 — proof of delivery

Status: **verified** on 2026-10-14 (local only; no commit / push / publish).

Primary sources: `tasks/222-subagent-team-task-tree-and-instance-spec.md`,
`docs/plans/Vessel_Harness_Architecture_Improvement_Plan.md` §10 (ARC-10) and §11
(ARC-11), `docs/plans/Vessel_Web_UI_UX_Improvement_Plan.md` §8.3 (Agent Studio),
§9 (Run states / approvals / Activity) and §14 (UI-013 / UI-015 / UI-016 / UI-017).

## Module 1 — ARC-10 / UI-016: scoped subagents and the team task tree

Contracts (`packages/shared/src/team.ts`): `AgentInstanceSpec` (instanceId,
parentInstanceId, modelProfileRef, behaviorSnapshotRef, policyScopeRef,
contextScopeRef, toolScopeRef, budget), `TaskLease`, `TaskTreeNode`,
`TaskTreeSnapshot`, `PermissionScope`, plus `narrowPermissionScope` /
`scopeIsSubset` / `assertAgentInstanceSpec`.

Scheduler (`packages/application/src/team/TaskTreeScheduler.ts` + `TaskTreeRegistry`):
DAG readiness, cycle detection, leases with TTL, deterministic parent→child
cancellation cascade, blocked-dependent cancellation, approval gates
(`waiting_approval` → approve re-queues / deny cascades), child result aggregation,
and per-node scope narrowing against the **effective parent** scope. The scheduler
never runs a turn — work is delegated to an injected `executor`, so there is no
second execution loop.

Read side: `GET /api/tasks/tree` (`apps/local-server/src/routes/taskTrees.ts`) over
the shared `TaskTreeRegistry`; Web `components/tasks/TeamTaskTree.tsx` renders
topology, status badges (`pending | running | waiting_approval | completed |
failed | cancelled`), duration, attempt, dependencies, lease holder + release
reason, cancellation origin, child aggregate, and parent/child navigation. It is
mounted in the Workbench inspector (`tasks` tab via `DualSurfaceLayout`) and in the
Activity area.

## Module 2 — ARC-11: fault injection and golden conformance

- Fault injection (`packages/runtime/src/executor/fault-injection-gate.test.ts`):
  four boundaries (pre-dispatch intent, post-dispatch effect, post-tool result,
  approval transition) against a durable on-disk effect counter; a blind retry is
  refused (`OUTCOME_UNKNOWN` / `already observed`) **before** the counter can
  advance, so non-idempotent effects are never executed twice. Read-only work stays
  recoverable.
- Golden behavior conformance
  (`packages/behavior/src/compiler/golden-conformance.test.ts`): deterministic
  snapshot, complete `L0..L4` chain (`L4: unavailable`), 100% conformance coverage,
  honest ladder (`Mappable` / `Enforceable` / `Renderable` / `Verified` only with a
  policy revision + matching assertion hashes), fail-to-compile for an unenforced
  `runtime_policy` entry.
- Compaction fidelity
  (`packages/context/src/compaction/conservation-golden.test.ts`): 100% conservation
  of goal, verbatim constraint, latest instruction, denial id and tool pair, plus
  all seven violation types.

## Module 3 — UI-013 / UI-015 / UI-017

- UI-013 `GET /api/activity/runs` (`routes/activityRoutes.ts`) aggregates sessions,
  team stages, subagents and goal tasks across projects with a real approval signal
  from `WidgetRoutes.pendingApprovals()`; Web `components/activity/ActivityQueue.tsx`
  groups by `needs_attention | running | failed | completed` and decides inline via
  the existing widget-respond endpoint. `WidgetRoutes.pendingApprovals()` was added
  as a read-only accessor (no behaviour change to publish/respond).
- UI-015 `GET /api/behavior/library` + `POST /api/behavior/compose`
  (`routes/behaviorCompose.ts`, `packages/application/src/behavior/composeDraft.ts`,
  shared `composer.ts`), Web `components/studio/AgentStudioComposer.tsx`: rule
  composition, priority reordering, conflict detection (`detectBehaviorConflicts`)
  and a live conformance report delegated to the same `compileBehavior` gate. A
  `rejected` verdict is not activatable from the UI.
- UI-017 `GET /api/sessions/:id/trace` (`routes/traceRoutes.ts`) plus Web
  `components/trace/TracePanel.tsx`: per-turn structured steps with whitelisted,
  sanitized detail (argument **keys** only; prompt text and tool output never leave
  the server) and layout persistence (`vessel.trace.layout`).

Every new surface is bilingual (zh/en keys added to `i18n.ts`, type-checked in both
dictionaries) and responsive — the 800px captures show the drawer nav and the
single-column composer with no horizontal overflow.

## Verification

Targeted suites (pre-gate):
- `packages/shared` team + composer: 24 passed.
- `packages/application` scheduler: 14 passed.
- `packages/runtime` fault injection: 7 passed.
- `packages/behavior` golden conformance: 6 passed.
- `packages/context` compaction golden: 8 passed.
- `apps/local-server` card222 routes: 5 passed.
- `apps/web` card222 components + helpers: 9 passed (whole web root: 319 passed).

Final ordered gates — see `final-gates.json` and `final-01..04-*.log`:

| gate | command |
|---|---|
| final-01-tsc | `npx tsc -b tsconfig.json` |
| final-02-typecheck-tests | `npm run typecheck:tests` |
| final-03-web-build | `npm run -w @vessel/web build -- --emptyOutDir false` |
| final-04-test-all | `npm run test:all` |

`git diff -- packages/core` → **0 lines**. No lock file / `package.json` change.

## Browser evidence (offline Chromium + CDP)

`capture.mjs` (Node built-in `WebSocket`, zero npm deps) drives headless Chromium
against the offline fixture `browser-fixture.ts`, which serves `apps/web/dist` and
a real local-server whose `TaskTreeRegistry` was populated by the real
`TaskTreeScheduler` and whose session carries a real pending permission decision.
Eight full-surface screenshots + `browser-capture-meta.json` (sha256 + per-shot DOM
facts):

- `card222-activity-{en,zh}-desktop.png`, `card222-activity-{en,zh}-mobile800.png`
- `card222-studio-{en,zh}-desktop.png`, `card222-studio-{en,zh}-mobile800.png`

DOM facts captured with the images (from `browser-capture-meta.json`):
`treeStatuses: [completed, waiting_approval, completed, pending, pending]`,
`queueStatuses: [needs_attention]`, `approvalButtons: [Session, Approve (Allow
once), Deny (Deny)]`, `libraryRules: 18`, `stagedRules: 3`, `verdict: Enforceable`,
`conflicts: 1`, `conformance: 3`.

## Residual risk / not claimed

- The scheduler is not yet wired to a live `AgentLoop`-backed `IsolatedRuntime` in
  production; the "no second loop" property is structural (injected executor).
- `PermissionScope` narrowing is a scheduling contract; it is not yet an
  additional runtime enforcement point in `PolicyEngine` / `Executor`.
- Fault injection simulates the crash boundary with a second journal over the same
  file; no OS process is killed.
- Golden conformance asserts L0–L4 *availability and determinism*, not live L4
  runtime verification.
- Compaction conservation asserts the predicate, not a sampled model summary.
- Web component tests use `renderToStaticMarkup` with injected fixtures; DOM click
  handlers are covered indirectly through the API-client contract and pure helpers.
