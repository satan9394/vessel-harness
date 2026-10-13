# Card 217 P0 review — 2026-10-12

**Result: PASS for the reviewed P0 implementation scope.** No remaining actionable P0 blocker found in the final source read. Final ordered gates remain the main executor's responsibility; this review does not replace their recorded results.

Reviewed ARC-01 projection publication/conservation, ARC-03 Run lifecycle/budgets, and ARC-04/05 runtime permits/effect journal against VESSEL-ARCH-2026-01. This reviewer also implemented ARC-02 and its activation test; independent signoff here applies to the other workers' changes, while ARC-02 evidence comes from deterministic compiler and composition tests.

Previously identified blockers are resolved:

- Compaction preserves compacted user constraints and denial evidence, keeps physical event history, and refuses in-memory projection reads after uncertain publication until reopening from disk.
- Cancellation is checked after asynchronous commit gates, continuation persistence, and before a new core scope starts. The owning Run accepts cancellation while the core scope is inactive. Forced continuation retains counters and hard budgets; streamed/chat tool arguments contribute to output accounting.
- Unfinished Runs are terminalized without automatic tool replay. Commit persistence uncertainty poisons the active owner rather than appending another terminal.
- Supplied permits are validated before any Mod observer/rewrite/intercept callback. Dispatch revalidates rewritten arguments, checks cancellation, and consumes immutable, scoped, revision-bound authority after durable intent persistence.
- Uncertain effects block subsequent writes; main, isolated, and Mod RPC executor paths use the journal. Candidate Behavior compilation precedes session leases and Mod activation; primary execution subjects use the actual Run ID.

Boundaries: request hashes provide bounded provenance rather than a promise of plaintext exact-request replay. Permit authority is an in-process capability; serialized JSON is not authorization. Unknown write outcomes require explicit reconciliation, not automatic retries. Recovery closes incomplete Runs instead of transparently resuming them. These bounds must remain visible in the task handoff.

The human-authorized thin-core exception is limited to three existing test fixtures, each +1/-1. Core implementation changes remain zero; the final gate must report implementation and test statistics separately.

No heavy tests were run during this final source review. Earlier reviewer-run activation/compiler checks passed (2 files, 21 tests); final post-edit evidence belongs to the ordered gate logs alongside this file.

## Final repair addendum — independent lifecycle/fixture review

**PASS.** Independently reviewed the final `ExecutionLoop.ts` exception and denied-attempt counter repairs, together with `cli.test.ts`, `policyStatus.test.ts`, `safety-discrimination.test.ts`, and `safety.test.ts`. No additional blocking finding in this scope.

Typed provider failures retain their original object after one FAILED terminal is published; successful recovery clears stale provider failure identity. Denied tool attempts reserve and checkpoint the same hard tool budget before their `tool/call` record, so public counters include denied attempts and the cap cannot be bypassed by perpetual denial. The existing cancellation, publication-poisoning, and no-automatic-effect-replay safeguards remain intact.

The fixture changes retain their relevant assertions: Anthropic builtin-list fallback avoids a fake credential and live enumeration; partial policy loading uses a behavior without unavailable mandatory claims; the unsafe secrets counterexample first proves compilation rejection, then withdraws only the enforcement claim before proving the safety criteria fail; the S008 profile comparison uses the same inert native sandbox in both arms while retaining opposite denial expectations. That last comparison proves policy discrimination, not actual OS sandbox provisioning.

AST source, performance fixture, measured edit count, warmups, and thresholds remain unchanged. This addendum used source/diff inspection only; no tests or profiling ran while the final ordered gates were executing.
