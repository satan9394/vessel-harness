# Final independent review — V2.1 Epic 191

Date: 2026-10-07. Verdict: **CHANGES REQUIRED; Epic acceptance FAILED.**

Scope: attachment mission brief, cards 188–191, current tracked diff and untracked implementation, production callers, prior `review188189.md`, and existing evidence. Read-only source review; this reviewer made no source changes, ran no builds/install/tests, and invoked no external agents. Findings below are static control-flow findings with concrete reproduction scenarios, not claimed executed reproductions. This report is the only authored artifact.

## Blocking acceptance failure

**P1 — Task 190's absolute fingerprint latency requirement remains FAILED.** `packages/tools/src/filesystem/workspaceFingerprint.ts:76` launches Git for the file list, reads and hashes every listed tracked/untracked file synchronously, then launches Git again for the diff. This repeats on the initial baseline and after every executed tool through `packages/tools/src/execution/noProgressGuard.ts:23,29`. The task and attachment require <25ms; no accepted replacement criterion was found. `phase190-benchmark-source-only.log` records a 50-file fixture cold 82.5801ms / warm median 125.5336ms and actual source repository cold 1459.6392ms / warm median 1389.0959ms. `phase190-benchmark-final.log` also fails both cases. Do not waive cold time, count only part of compute, or declare PASS because functional tests pass. The synchronous full reads additionally block the event loop while the guard computes. Required: meet the original bound with a verified design, or obtain a human change to the acceptance requirement; until then acceptance stays failed.

## Substantive integration findings

### P1 — A late tool from an interrupted turn can trip the next turn's breaker

Locations: `packages/tools/src/execution/noProgressGuard.ts:35–50`; production adapters `packages/application/src/compose.ts:310–315`, `packages/agents/src/subagent/IsolatedRuntime.ts:105–110`; existing interrupt race `packages/core/src/agent-loop/AgentLoop.ts:982–999`.

`run()` resets the shared breaker/observation queue when its signal changes, but captures no turn generation. After awaiting `execute()`, both its success and catch branches enqueue observation against the current instance fields. They never check whether the original signal was aborted or replaced. The core deliberately races signal-blind tool promises and can finish an interrupted turn while that tool promise continues running. The stop callback closes over the same loop instance and calls `loop.interrupt()` on whichever turn is active then.

Reproduction: turn A starts a deferred signal-blind tool; interrupt A and start turn B. B runs two successful read-only tools, leaving its stagnant count at two. Resolve A's deferred tool without physical changes. A's old `run()` now observes against B's baseline and increments B's stagnant count to three; its stop callback persists an audit with A's tool name into the shared session and interrupts B. The same contamination exists for late rejected promises and observation work already queued while a generation changes.

Required semantics: scope baseline, queue, observations, failure callbacks, and breaker state to the originating turn/generation. An aborted or superseded generation must neither execute work after delayed initialization nor mutate/stop the current turn. Preserve the existing ability to stop waiting for a signal-blind tool; do not solve this by delaying user interruption until that tool finishes.

Regression suggestion: defer A's execution, abort A, run B twice with a distinct signal, release A, and assert no B audit/stop and no counter increment from A. Cover success, rejection, delayed fingerprint/baseline acquisition, and a stale queued observation. A later third B read should stop exactly once with B's own tool identity and counters.

### P2 — Automatic interruption of a tool batch permanently disables later compaction

Locations: `packages/context/src/compaction/CompactionBoundaryGuard.ts:8–15`; guard consumers `packages/application/src/compose.ts:558`, `packages/agents/src/subagent/IsolatedRuntime.ts:151`, `packages/context/src/compaction/overflowRecovery.ts:20`; existing batch dispatch `packages/core/src/agent-loop/AgentLoop.ts:422–466`.

The boundary helper scans the entire replay, adding every tool advertised in each `assistant/attempt`, and removes ids only on `tool/result`. It has no completed-turn boundary semantics. Core writes the whole assistant batch before dispatch. A breaker-induced interrupt races the third tool, closes that current tool, and exits the batch; later advertised tools never get a result. Those ids remain in the helper's pending set for the lifetime of the session, so even `turnIndex=0` in a later user turn refuses both pressure and overflow compaction. The new automatic breaker makes this reproducible without a manual interrupt. Existing documents disclose interruption/pairing gaps; no closed record establishes that the new guard reconciles abandoned advertised calls.

Reproduction: return a single assistant response advertising four read-only calls. The default breaker interrupts on call three, leaving call four advertised but undispatched. Start a new user turn with pressure above threshold (or a first-call context-overflow response). `canCompactHistory(0, replay)` stays false, and history cannot compact. A direct helper fixture `[assistant/attempt(id=a,b), tool/result(a), turn/end(interrupted), turn/start(new)]` exhibits the same permanent refusal.

Required semantics: distinguish abandoned calls from active owed calls at intent boundaries. Reconcile the ended turn's remaining advertised calls in an outer layer, or make pending accounting turn-aware using durable ended-turn semantics and ensure the resulting wire history is valid. Do not simply ignore all pending calls: unfinished active turns and true pending current-turn calls must still block compaction. Keep `packages/core` unchanged as required by the mission. Do not merely delete old records or permit compaction inside microturns.

Regression suggestion: exercise a four-call production batch through the breaker, then a new turn; prove pressure/overflow recovery can compact safely, no tool-call/result protocol orphan reaches a strict mock provider, and compaction remains denied during the active batch. Include resume of an interrupted batch and an unfinished turn lacking `turn/end` as the negative control.

## Prior repairs reviewed

- **Missing tariff uncertainty:** `unknownCacheInputTokens` restores base-input billing for measured reads/writes whose applicable tariff is absent; missing writes with a known read tariff use the existing input×1.25 derived write rule. `cacheTariffEstimated` marks uncertainty. Projection, per-call SSE costing, UsageStore record/reload/recompute, and priced cache metadata use those helpers. Explicit zero remains known zero. New table-driven tests cover absent read/write, derived write, and explicit zero. Prior finding 1 is repaired in the inspected code; tests were inspected, not rerun here.
- **Resumed-session per-turn cost:** server emits `costForUsage(usage)` per call separately from cumulative `summary`; ConversationView uses `usageCallCost(delta)` instead of deriving a delta from a reset cumulative baseline. Prior finding 2 is repaired. Session totals still come from the server summary.
- **Actual provider/model identity:** llm observer overwrites cache metadata with `provider.id` and `request.model` on chat and retained streaming metadata; OpencodeGo's concrete chat boundary also normalizes parsed metadata. The identity regression test covers both observer branches. Prior identity issue is repaired for the production annotation path.
- **Canonical/prefix production wiring:** canonical implementation now lives in llm; context dependencies/references and lock entries are present. Request serialization covers OpenAI, Anthropic and OpencodeGo, retaining array/tool ordering. Scoped provenance remains user-level; stable schema text and tool definitions are canonicalized. Reflection is frozen per intent, volatile context stays at the tail, and both main/isolated pressure and overflow paths invoke the boundary guard. No additional substantive serializer/prefix finding was confirmed.
- **Breaker wiring:** main and isolated tool execution use the guard, persist `audit/stagnation_break` before interruption, and engine converts the diagnostic to an admitted stopped result without retry/continuation. The pure state machine's implementation is in tools with an engine re-export (documented internal dependency constraint); the concrete lifecycle issues above still require repairs.

## Evidence and delivery limits

Observed existing final logs: npm ci exit 0; composite build exit 0; test typecheck exit 0; Web build exit 0. `final-test-all.log` was still at its RUN header when read, and no final identity-guard log was present at that instant. This reviewer therefore does not certify completed final regression/identity gates. Source changes after this review require renewed relevant verification.

Task 189 discloses three default Vite builds that automatically cleared/rebuilt `apps/web/dist`, violating the mission's deletion discipline. Later `--emptyOutDir false` builds do not erase that deviation; red lines were not perfectly preserved. No source review finding or green test may turn that history into full compliance.

Conclusion: the earlier pricing/UI/identity repairs are statically verified, but two production lifecycle failures and the mandatory <25ms failure prevent Epic 191 acceptance. Changes: only this review artifact. Verification: static source/caller review plus existing logs, no independently executed tests. Next steps: repair the two lifecycle defects with the indicated regressions, rerun final gates after the last edit, and retain the latency failure until the original requirement is met or explicitly changed by the human.
