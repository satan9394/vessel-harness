# Lifecycle independent revalidation — Epic 191

2026-10-07. Verdict: **CHANGES REQUIRED**. Static review only; no source edits, tests, builds, installs, external agent invocation, or deletion. This report is the only authored artifact. Reviewed AGENTS/HANDOFF, the preceding final-independent-review, current guard/builder/compaction/composition code, core production record semantics, and new regression tests. Existing logs report targeted **6 files / 59 passed**, exit 0, and test typecheck exit 0; these were inspected, not independently rerun.

## Confirmed remaining bugs

### P1 — Abandonment by global call id corrupts valid completed wire exchanges

Locations: `packages/context/src/compaction/CompactionBoundaryGuard.ts:7–20`; `packages/context/src/builder/Builder.ts:165–172`.

`abandonedToolCalls` returns a session-wide `Set<string>` keyed solely by provider tool-call id. Builder then removes matching calls from **every** assistant attempt while retaining every tool/result. Core preserves provider ids unchanged (`AgentLoop.ts:420–431`); neither the contract nor core establishes session-wide uniqueness. A provider may reuse an id across separate assistant responses or turns.

Concrete record sequence: turn A advertises id `x`, ends interrupted without a result; turn B advertises id `x`, receives its successful tool/result, and ends. The set still contains `x`. Builder strips B's completed call but retains B's tool/result, producing an orphan `role:tool` message and a strict-provider protocol error. Reversing these turns also corrupts the earlier valid exchange, because filtering is retrospective. This is not merely a counter error: the repair changes otherwise valid completed protocol history.

Required: identify an abandoned **call occurrence** by its originating assistant attempt/turn, rather than treating provider ids as globally unique. Preserve completed assistant/result adjacency, even with reuse. Cover reuse before and after an abandoned occurrence and across separate attempts in one turn using strict wire-pair assertions. Current production four-call tests use distinct mock-generated ids and do not cover this case.

### P2 — An unrelated turn/end incorrectly abandons unfinished work

Locations: `CompactionBoundaryGuard.ts:14–17,32`; `packages/context/src/compaction/Compaction.ts:138`; producer `packages/core/src/agent-loop/AgentLoop.ts:223–291`.

All three scans clear all pending calls on any turn/end without matching its turnId. The core's BeforeTurn denial path emits a turn/end for the **denied new turn**, without emitting its turn/start. Therefore a previous unfinished turn is not durably closed merely because a later input was denied.

Concrete production-shaped sequence: `turn/start(A)`, `assistant/attempt(x)` with no result or end(A), then the new turn B's BeforeTurn denial records and `turn/end(B,error)` (no start(B)). `canCompactHistory(0, records)` incorrectly becomes true; `abandonedToolCalls` strips A's outstanding call; `balancedCut` also treats end(B) as closing A's batch. The same error occurs for an unfinished earlier turn followed by a normally completed later turn. A provider error can leave A without a closer in the still-open session (`AgentLoop.ts:470` rethrows errors), so this does not require malformed evidence. Reopening Session does synthesize matching interrupted closers, but that separate resume path does not justify clearing an unmatched open turn in the live session.

Required: track pending call occurrences under their admitted turn and abandon only on that turn's matching durable end. Keep unfinished earlier turns blocking compaction until actually reconciled, including a negative test with an unrelated denied turn end. Match this accounting in boundary checks, wire projection, and balanced-region selection. No core changes are needed or permitted by this repair scope.

## Repairs statically revalidated

- `NoProgressGuard` captures generation across baseline initialization, execution success/rejection, queued observations, asynchronous fingerprint completion/failure, and stop callback currentness. Superseded/aborted work cannot record against the new breaker or begin delayed execution. The supplied callback fence is checked after awaited audit persistence in both compose and IsolatedRuntime, immediately before interrupt; stale callbacks do not interrupt the next turn. New tests cover these phases, including queued work and delayed durable stop callbacks. No remaining concrete lifecycle contamination was confirmed in these paths.
- DENIED tool results bypass observation, preserving the core denial breaker rather than consuming executed-tool stagnation/error observations. The corresponding tests cover successful and error observations after denials.
- A durably ended ordinary interrupted batch with unique call ids now allows next-intent pressure/overflow compaction, and the production strict-pair test covers four advertised calls with three results plus close/reopen. Active microturns and unfinished calls remain blocked in the simple single-turn tests. The two confirmed findings above limit that repair's correctness under real record/id semantics.

## Acceptance limits

The strict **<25ms fingerprint requirement remains FAILED** under the existing benchmark evidence; no threshold change was authorized. The previously recorded default Vite-build deletion deviation remains open history. Neither is waived by lifecycle test success. This review does not declare Epic PASS or certify final all-root gates still running elsewhere.

Conclusion: stale-generation and DENIED repairs are statically sound in the reviewed paths; turn/call occurrence accounting still requires repair. Changes: this evidence report only. Verification: static source/caller/test/log review. Next steps: repair the two scoped compaction findings, add their protocol regressions, rerun relevant checks after the final source edit, and retain failed latency acceptance and deletion deviation.

## Final frozen-source revalidation — 2026-10-07

The two compaction findings above are **resolved in the inspected final repair**; their original descriptions remain as historical review evidence. This follow-up again ran no tests, builds, installs, or source edits. Existing `occurrence-repair-targeted.log` records **7 files / 72 passed**, exit 0; `occurrence-repair-typecheck.log` records exit 0. These are observed executor evidence, not independent executions.

`accountToolCalls` now associates outstanding occurrences with the assistant record inside its admitted turn scope. Its abandonment result is `Map<SessionRecord, Set<string>>`, and Builder uses the exact source record to omit only that attempt's abandoned calls. Reusing a provider id before or after a separate abandoned attempt no longer removes the completed attempt's call. The production strict-pair regression forces `tc_mock_4` to be reused after the abandoned four-call batch and close/reopen, then makes another real composition model request with the completed result; the inspected test checks that wire protocol pairing remains valid. ContextBuilder's resumed-session regression independently covers that projection.

Turn/end looks up the matching open turnId; an unmatched denied-input ending after an explicit start cannot clear the earlier scope. Completing a newer turn also leaves the predecessor's outstanding occurrences pending. A matching durable interrupted closer remains able to reconcile that predecessor. Negative tests cover both unrelated denied endings and newer completed turns, including identical ids in the two scopes.

Compaction consumes the same accounting's `balancedAfter` positions. The accounting additionally excludes cuts that would remove a turn/start while retaining later tool records from that turn: a candidate within a scope becomes eligible only when the scope has ended and the candidate lies after its last tool record. This preserves the scope needed by the retained replay on a subsequent compaction/projection. Leading legacy or already-truncated records retain their explicit compatibility path; this does not clear an explicitly started unmatched scope.

No additional concrete production bug was confirmed in this frozen-source scope. The previous generation/baseline/queue/fingerprint/callback fences and DENIED bypass verdict remains unchanged. **Lifecycle review has no remaining blocking finding**, subject to final mechanical gates after the last source edit. This is not Epic acceptance: the mandatory <25ms fingerprint gate remains FAILED and the recorded Vite deletion deviation remains open history.

Conclusion: reviewed lifecycle repairs resolved. Changes: appended this follow-up only. Verification: static source/caller/regression inspection plus the existing 72-pass/typecheck logs. Next steps: complete final mechanical gates; retain failed latency acceptance and deletion deviation without declaring Epic PASS.
