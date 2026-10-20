# 249 — Adversarial audit of Tasks 236–248

Status: IN PROGRESS

## Goal
Independently verify lifecycle, deletion, credential, streaming and compaction controls against pre-236 commit 3a1bf2f, HEAD and the working tree.

## Not Doing
No product changes, core edits, external agent calls, real credential probes, user-data deletion, commits or publishing.

## Acceptance
Cover all five requested audit dimensions with source line references; execute the five requested gates and preserve exact exit codes and summaries; clearly distinguish failures, historical changes and environmental limits.

## Blast Radius
This card, its tasks/README.md index entry, and evidence/sessions/2026-10-20-codex-adversarial-review-249* only.

## Expected Evidence
evidence/sessions/2026-10-20-codex-adversarial-review-249.md and gate logs.

## Plan and Verification
1. Establish baseline and inspect changed code plus shared control implementations.
2. Challenge each control against callers and existing tests/closed records.
3. Execute required gates and write a verdict with precise limitations.

## Result
Pending audit.
