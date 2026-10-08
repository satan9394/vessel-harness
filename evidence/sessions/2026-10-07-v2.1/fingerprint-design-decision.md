# Fingerprint performance decision — approved 2026-10-08

Current decision: the human explicitly approved fixture50 warm <=50ms and exact-semantics repository <=2000 files cold <=1500ms / warm p95 <=1000ms, requested DoD updates and Epic acceptance closure. The former unanswered decision and blocked audit below are historical. `accepted-fingerprint-benchmark.log` passes the new criterion; final gates and delivery are recorded in `final-delivery-proof.md`.

Final assembled-worktree benchmark `accepted-final-fingerprint-benchmark.log` also passes: fixture warm max42.5767ms;1739 files cold905.8525ms / warm p95673.4129ms. All five accepted mechanical gates exit0,2811 passed/6 skipped; Epic functional acceptance closed, with the historical deletion deviation retained separately.

The renewed budget authorization covers continued repairs; it does not change the strict whole-call <25ms acceptance criterion. No threshold or fingerprint semantics have been changed.

## Reviewable implementation

Every call freshly inventories Git files, confines parent directories with native realpath, reads contents in bounded batches of 32, hashes in deterministic order, and collects exact binary Git patch bytes. Tracked same-mtime rewrites, staged/untracked/deleted files, nested workspaces, tracked ignore exceptions and outside-parent junctions have regression coverage. The repaired implementation excludes outside paths from both content reads and Git diff. There is no cross-call result cache.

The final read-preparation helper cleanup happened after the six targeted tests; the renewed full regression is the final-source verification. SQLite numeric parity independently cleared in `sqlite-page-independent-review.md`.

## Measured performance

Evidence: `fingerprint-perf-baseline-components.log`, `fingerprint-perf-candidate-benchmark.log` and `fingerprint-perf-candidate-correctness.log`.

| Workload / component | Measurement |
|---|---|
| 50-file fixture, whole call | cold 48.79ms; warm median 32.52ms; maximum 49.78ms |
| Repository, about 1709 files, whole call | cold 773.05ms; warm median 638.24ms; maximum 804.86ms |
| Git startup (`git --version`) | 77–104ms |
| Exact binary Git diff | 203–226ms |

Strict <25ms is failed. Improvement is approximately 50% relative to the previous repository warm median, not acceptance evidence for 25ms.

## Bounded alternative review

The original brief mentions modified/created content and mtime; current implementation additionally hashes clean tracked contents and includes staged changes with exact Git patch length. Removing that stronger behavior still leaves fresh Git inventory and the measured startup floor.

- Watchers or tool-write tracking cannot guarantee fresh external changes or loss-free notifications.
- Persistent `git cat-file` supports object reads, not persistent status/diff RPC.
- No existing workspace dependency provides in-process Git. Reimplementing ignore rules, index variants, worktrees, attributes and identical binary/text patch generation is a substantial subsystem and is not validated by the present tests.
- Native journal integration plus a persistent Git service could improve warm calls, but requires bootstrap scanning and rescan on lost journal data. No design has established the cold-call <25ms contract.

This review rules out the retained subprocess route on this machine; it does not prove every conceivable native implementation impossible.

## Proposed decision, not applied

The human was asked to choose between retaining fresh exact semantics with a bounded machine-specific criterion (up to 2000 files: cold <=1500ms, warm p95 <=1000ms), or retaining whole-call <25ms and expanding into native implementation research. The proposed bounds require fresh acceptance measurement if approved. They are not silently substituted for the existing gate.

Until an explicit answer arrives, source remains stopped and Epic 191 remains unaccepted. All five renewed mechanical gates finished exit 0: 2811 passed / 6 skipped across both roots. No live worker or test process remains. No commit, push or publication is authorized by this proposal. The proposed file-count bound refers to the measured repository workload/content volume, not arbitrary files of unbounded size.

## Continuation revalidation

The next automatic goal continuation re-read the authoritative brief, current state and terminal logs. Latest changed TypeScript source timestamps are 21:38:01, before the renewed gate run; core source diff remains empty, and workers.active is zero. No human answer has changed the performance contract. The previous goal turn made progress by completing all five gates; this continuation confirms the same contract impasse for the second consecutive goal turn. It is not a live-process wait and does not justify rerunning unchanged tests or accepting slower timing. Goal remains active pending the blocked-audit threshold or a human decision.

The third consecutive goal turn revalidated the same unanswered contract decision, zero active workers, passing terminal logs and missing session 67375 handle (the known completed process). No new human instruction changed the <25ms criterion or authorized the proposed alternative. There is no established compliant implementation path within the current constraints; this is a specification impasse, not a budget or live-process wait. The goal tool returned **blocked** after the required three-turn audit. No source, threshold or acceptance change was made. A human choice reopens work; the original full objective remains intact and unachieved.
