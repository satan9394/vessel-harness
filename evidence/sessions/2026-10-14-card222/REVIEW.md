# Card 222 — adversarial review

Independent-questioning pass over the diff. Each item states what was checked,
what holds, and what remains **not** proven (no over-claiming).

## 1. "No second execution loop" (ARC-10 hard constraint)

`packages/application/src/team/TaskTreeScheduler.ts` was read end-to-end:
it contains **no** turn execution. Every unit of work goes through the injected
`executor(node, signal)` callback; the scheduler owns only dependency readiness,
leases, cancellation, aggregation and permission narrowing. The module does not
import `@vessel/core` at all.

- Holds: no second loop exists in the new code; the scheduler is transport- and
  mechanism-agnostic.
- **Not proven**: no production caller yet wires `executor` to a real
  `AgentLoop`-backed `IsolatedRuntime`. The invariant is enforced structurally
  (scheduler cannot loop) but is not demonstrated end-to-end with a live model.
  Recorded as residual risk, not as a delivered integration.

## 2. Permission narrowing is monotonic

`narrowPermissionScope` intersects allowlists/paths, unions denies, ANDs
`network` and takes the strictest approval rank. Tests assert the result is a
subset of **every** input (`scopeIsSubset`) and that a wildcard input cannot widen
the outcome.

- Holds: monotonicity at the contract level; child nodes narrow against the
  *effective parent scope* (second pass in the constructor), so grandparents
  cannot be bypassed.
- **Not proven**: this `PermissionScope` is not yet threaded into the
  `PolicyEngine.decide` / `Executor` path, so a runtime tool call is still gated
  by the session policy alone. The narrowing is a scheduling-layer contract, not
  an additional runtime enforcement point. Stated plainly in the PROOF.

## 3. Cancellation / timeout determinism

`cancel()` cascades depth-first from the origin node and stamps the same
`originInstanceId` on every descendant; blocked dependents are cancelled with
`blocked_by_<status>_dependency`. Lease timeout aborts the signal, marks the node
`failed` with `lease_timeout` and cancels its subtree. Tests cover parent cancel,
timeout, failed-dependency blocking, and approval denial.

- Holds: deterministic outcomes, stable reasons, no timers left dangling
  (`clearTimeout` in `finally`, `timer.unref()` is not needed because the timer is
  cleared).
- **Not proven**: no test kills an OS process mid-lease; the "restart" boundary is
  simulated by constructing a second `EffectJournal` over the same file
  (boundary tests in §4).

## 4. ARC-11 fault injection

`packages/runtime/src/executor/fault-injection-gate.test.ts` drives the real
`EffectJournal` across four boundaries (pre-dispatch intent, post-dispatch effect,
post-tool result, approval transition) against a **durable on-disk side-effect
counter**. The strongest assertion is behavioural: after a simulated crash, a
blind retry throws `OUTCOME_UNKNOWN` / `already observed` **before** the counter
can advance, so a non-idempotent effect is never executed twice.

- Holds: the anti-replay guarantee is demonstrated with an observable side effect,
  not just an exception type.
- **Not proven**: this is the *journal* boundary, not a full `ExecutionLoop`
  crash-recovery run (which already has its own tests from card 217). The two
  layers are complementary; this suite adds the "irreversible effect" proof.
- Note: `packages/runtime/src/executor/EffectJournal.test.ts` already covered part
  of this; the new file is a superset focused on the "never twice" property, and
  the older file is untouched.

## 5. Golden conformance does not fabricate L4

The golden suite asserts `L0..L3 available / L4 unavailable`, deterministic
`snapshotHash` across repeated compiles, the honest compatibility ladder
(`Mappable` / `Enforceable` / `Renderable` / `Verified` **only** with a policy
revision + assertions matching the snapshot hash), and fail-to-compile for a
`runtime_policy` entry with no enforcement rule.

- Holds: `Verified` is never granted without runtime evidence; `Renderable`
  degrades with a warning rather than silently dropping the entry.
- **Not proven**: no end-to-end "L4 in a live session" assertion is made here
  (that belongs to the card-221 inspector path), so this card does not claim L4
  runtime verification.

## 6. Compaction conservation

`conservation-golden.test.ts` builds a 53-message history and asserts 100%
conservation of goal / verbatim constraint / latest instruction / denial id /
tool pair, plus the seven violation types (`goal_lost`, `constraint_lost`,
`latest_instruction_lost`, `denial_lost`, `tool_pair_lost`, `orphaned_tool_call`,
`orphaned_tool_result`) each with its `violationType`.

- Holds: the assertion function is the same one `Compaction.compact` calls, so a
  lost fact is a hard error in production too.
- **Not proven**: the test exercises the assertion input, not a real
  provider-driven compaction run. The "100%" claim is about the conservation
  predicate, not about a sampled model summary.

## 7. UI claims vs. real data

- **Activity queue (UI-013)** is fed by `GET /api/activity/runs`, which derives
  the approval signal from `WidgetRoutes.pendingApprovals()` and completion from
  real session/team/goal state. Inline Approve/Deny calls the existing
  `POST /api/sessions/:id/widget/:widgetId/respond` endpoint — the UI never
  invents a decision path. Verified in the capture: the row renders
  `needs_attention` with the real description and both option buttons.
- **Task tree (UI-016)** renders `GET /api/tasks/tree`, i.e. snapshots written by
  the real `TaskTreeScheduler`. The screenshot shows real leases, attempts,
  dependencies and the `waiting_approval` / `pending` spread.
- **Composer (UI-015)** calls `POST /api/behavior/compose`, which delegates to the
  same `compileBehavior` gate as a live session. A compile failure is reported as
  `rejected` and is **not** activatable from the UI. The screenshot shows a real
  conflict (`priority_tie` / `conflicting_guidance`), verdict `Enforceable`, and
  the honest `L4:unavailable`.
- **Trace (UI-017)**: the backend whitelists fields; prompt text and tool argument
  values never leave the server. Tested by asserting a marker string present in the
  raw record never appears in the response.

## 8. Screenshot environment caveat

The first capture attempts showed the app in a "server not connected" state even
though the endpoints answered correctly from PowerShell. Root cause: the machine's
proxy/TUN setup captured the headless browser's loopback fetches. Adding
`--no-proxy-server --proxy-bypass-list=<-loopback>` to the Chromium launch fixed
it (`statusText: "Vessel local server ok (v0.10.0)"`). This is an environment fact,
not a product defect, and it is recorded in the capture metadata.

Also recorded honestly: the capture releases the shell's internal `main` overflow
at capture time so one PNG shows the whole surface. This is a presentation-only
DOM tweak; no application source is changed by it.

## 9. Scope discipline

- `packages/core` diff: **0 lines** (verified via `git diff -- packages/core`).
- No lock file changed; no new dependency added (`package.json` untouched).
- No `git commit` / `push` / `publish`; nothing deleted.
