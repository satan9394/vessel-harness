# Independent review: SQLite JSON page transport

Scope: static review of the `SessionIndexStore.ts` and `sessionIndex.test.ts` working diff, plus `sqlite-perf-json-page.log` and `sqlite-perf-final-targeted.log`. No source edits, test runs, builds, benchmark processes, external agents, dependencies, or commits.

## Finding: P2 — JSON transport changes SQLite numeric conversion semantics

Location: `packages/memory/src/sqlite/SessionIndexStore.ts`, `listSessions()` JSON aggregation and parsing (lines 194–202).

The previous `SELECT *` / `.all()` transfers numeric columns through node:sqlite. The new query transfers them inside JSON text, so JSON parsing now determines their values. Retaining the public mapper does not retain the native conversion contract:

- An SQLite INTEGER outside JavaScript's safe integer range previously causes node:sqlite to throw; JSON parsing silently rounds it instead. For example, a persisted `total_tokens = 9007199254740993` now returns `9007199254740992`. A projection containing `9007199254740992` also stops rejecting the unsafe integer even though that particular number is exactly representable.
- SQLite JSON serialization of REAL numbers can lose significant digits compared with the original native double. This is reachable through the public API: `tokens()` accepts every finite nonnegative number, including `12345678901234567000`, which exceeds SQLite's INTEGER range and remains REAL. A model/usage record with this `inputTokens` value can be inserted and summarized without the INTEGER range exception, but JSON transport can round its input/total counters again when listing. Native retrieval preserves the stored double.

Minimal repair: retain the fast JSON page for ordinary integer counters, but use the original native retrieval for pages containing REAL numeric columns or INTEGER values outside the safe range. An alternative is explicit lossless numeric transport with SQLite storage-type information and equivalent integer range checks; simply adding `Number.isSafeInteger` after JSON parsing misses the REAL precision issue and changes the behavior for supported REAL values.

Regression checks to add after the timing worker finishes: compare JSON/native listing for REAL token counters above int64 through `indexRecords()`, and verify rejection parity for a directly seeded unsafe SQLite INTEGER in the disposable test database.

## Other reviewed behavior

The nested SELECT retains topic filtering before pagination, the same limit/offset validation, and the existing `updated_at DESC, session_id DESC` ordering. Queue waiting remains unchanged. Metadata stays serialized text within the outer JSON object and is independently parsed for each call, preserving nested caller-mutation isolation. SQL NULL topic/metadata and empty aggregate pages retain the prior public defaults (`undefined` and `[]`). The added test covers ordering ties, filtered offsets, empty pages, metadata escaping/mutation isolation, updates, and removal.

No additional concrete bug identified in those areas.

## Supplied verification evidence

- `sqlite-perf-json-page.log`: 8/8 tests passed; 1000-row page median 2.202 ms.
- `sqlite-perf-final-targeted.log`: 19/20 tests passed; session page median 3.235 ms; the failure is hybrid recall median 16.361 ms against its 15 ms threshold. The supplied logs do not establish a causal relationship between that distinct hot path and this listing change.

Conclusion: ordinary-page performance evidence supports the change, but numeric conversion parity needs repair before accepting it as behavior-preserving. This review contributes static evidence only.

## Follow-up review: final numeric parity repair

Reviewed the revised working diff only; no tests, builds, benchmarks, or source changes performed.

The repair closes the finding. It checks all eight numeric summary columns within the already filtered and paginated subquery. SQLite REAL storage always selects the original native `.all()` path, and INTEGER values outside inclusive JavaScript safe bounds select that same path. The fallback therefore preserves the stored REAL double and node:sqlite's own unsafe-INTEGER exception, including its error code. Exceptional rows outside the selected page do not affect ordinary pages. Empty pages produce a NULL exceptional flag and the JSON aggregate's empty array.

The new tests exercise a publicly indexed REAL counter above int64, positive unsafe INTEGER values both exactly representable and rounded by JSON, a negative unsafe INTEGER, filtered/offset fallback pages, and an unaffected safe page. They compare against native database retrieval rather than duplicating a numeric conversion implementation.

No remaining concrete bug identified in the final numeric transport repair. Source work stopped: only this review evidence was appended; source files were never edited by this reviewer. Root-owned execution gates remain authoritative for runtime validation.
