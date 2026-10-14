# T220 — Provider capability contract and layered context cache

- Status: 已验证（2026-10-13，standard 交证即停）
- Mode: standard
- Source: human-requested
- Risk: medium

## Goal
Implement ARC-06/08/09 and backend-sourced capability/cache inspection using architecture plan sections 8–9 and UI plan sections 5.3/6.4 as primary acceptance sources.

## Not Doing / Constraints
- Zero changes anywhere under packages/core; no new dependencies or non-npm locks.
- Local only: no commit, push, publish, external harness invocation, or deletion.
- Stop after this card's evidence; preserve unknown capability status rather than invent support.
- The request calls the capability UI UI-011; the UI plan names registry UI-009. Sections 6.4 and 5.3 govern this card.

## Acceptance Criteria
- [x] Shared detected/declared/unknown capabilities; negotiation rejects unsupported or unknown mandatory requirements before dispatch.
- [x] Assembly, provider prefix, projection, token estimation caches have dependency hashes and scoped invalidation in real context assembly.
- [x] Compaction conserves goals, constraints, latest instructions, tool pairs and denial records; regression fixtures reject loss.
- [x] Provider/model UI and Context Inspector show backend capability/cache snapshots with bilingual labels.
- [x] Targeted tests pass; final ordered tsc -b, typecheck:tests, safe Web build, test:all all exit 0 (both roots, >=3232 passed / 6 skipped).
- [x] git diff --stat packages/core/ empty.

## Blast Radius
- shared/llm/context contracts and request/context assembly callers outside core.
- local-server provider/context APIs; Web provider/model/context components and dictionaries.
- Focused contract, cache, fidelity, API and UI tests.
- Gate blocker (added before repair): existing AST incremental-update performance path in packages/context/src/ast. Two complete full-root runs failed its unchanged mean <=15ms assertion; isolated checks pass. A surgical performance repair is permitted solely to close the required full gate; precision, fixture, and 15/25ms thresholds remain unchanged. Core and benchmark budgets remain protected.

## Expected Evidence
- Targeted test logs and ordered final gate logs.
- Independent review and browser inspection of changed surfaces.
- Final diff/core/lock audit and task index update.

## Result
- Verdict: verified; all required gates exit 0 after the final source/test edit; both roots 3271 passed / 6 skipped.
- Evidence: `evidence/sessions/2026-10-13-card220/PROOF.md`, `accepted-final-gates.json`, and `completion-audit.json` in that directory.
- Changes: three-state provider negotiation across Web/CLI/TUI; four versioned context cache layers; compaction conservation and bounded previews; capability and Context inspection. Required-gate AST repair uses fresh async reads with serialized atomic indexing.
- Boundaries: capability metadata remains declared; provider-prefix reuse is local; large tool payloads remain complete in the immutable log. Detailed limitations and retained failed experiments are in PROOF.md.
- Next: await human review; no commit/push/publish or next-card execution.
