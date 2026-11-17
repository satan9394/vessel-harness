# Card 371 — coordinator acceptance (2026-10-31)

Independent re-verification of the executor's work. Baseline `e7a22b57`, Node `v26.13.0`, npm `12.2.1`.
The executor's own report is `report.md`; this file records only what the coordinator re-ran or re-read.

## Verdict

Accepted locally. Seven source fixes match the decided plan without weakening semantics; the working tree is
exactly the audited artifact (`f710c6aa…` unchanged after re-checks). CodeQL rescan is the only open item and it
needs the push (see "Open").

## Structural checks (re-read, not trusted from the report)

- `packages/runtime/src/process/Process.ts`: `runCommand` spawn options contain **no** `shell` key; the only
  literal `shell: true` lives in the new `runShellCommand`. Exactly two `spawn(command,` sites.
  `runCommand` rejects `opts.shell` with a `TypeError` naming `runShellCommand`.
- `supervise` carries the former 74–148 body verbatim; `audit-scope.mjs` reports
  `supervisionTailByteEquivalent: true`.
- `packages/tools/src/git/Worktree.ts`: **zero diff** (`git status --porcelain` empty for that path).
- `packages/runtime/src/sandbox/Sandbox.ts`: shell mode now rejects non-empty argv **before** isolation is
  allocated, then dispatches to `runShellCommand(command, base)`; the argv branch is unchanged.
  `packages/tools/src/shell/shellTool.ts` already called `run(command, [], { shell: true })`, so its behavior is
  preserved. No other caller combines a shell with a non-empty argv (`run-release-gates.ts` uses its own
  `execFileAsync`, not `runCommand`).
- `benchmarks/runners/src/asserts.ts` `run_check` moved to `runShellCommand` (whole command line, as before).
- Four ReDoS sites match the decided remedies: backwards index scan (`#18`), OSC body excludes ESC (`#19`),
  200-code-unit window retaining all four JS line terminators (`#20`), `{1,9}` version components (`#21`).

## Re-run by the coordinator

| Command | Result |
|---|---|
| `npx vitest run packages/runtime/src/process packages/runtime/src/sandbox packages/tools/src/git/worktree.test.ts packages/tools/src/tools.test.ts apps/cli/src/providers/providerFactory.failover.test.ts apps/cli/src/ui/statusLine.test.ts packages/memory/src/reflection/autonomousReflection.test.ts packages/shared/src/toolPins.test.ts` | 11 files, **155 passed, 1 skipped**, exit 0 |
| `npx tsc -b tsconfig.json` | exit 0 |
| `npm run typecheck:tests` | exit 0 |
| `git diff --check` | exit 0 |
| `node evidence/sessions/2026-10-31-codeql-seven/audit-scope.mjs` | `changed 14`, `protectedUnchanged 217`, `supervisionPreserved true`, `sourceArtifactSha256 f710c6aa…` |
| `pwsh -NoProfile -File scripts/gate-batched.ps1` | **17/17 exit 0** (`acceptance-gate.log`) |

Full gate details: root batches 12/12 `exit=0`, 335 file executions, **3,746 passed + 8 skipped**; web root
61 files / 543 passed; `tsc-build` / `tsc-tests` / `tsc-web` exit 0; offline conformance 25/25, cost $0.

The coordinator's focused selection is a superset of the executor's two batches, so the counts differ from
79 / 139 by design; all added boundary tests are included in the 155.

## 3,746 vs 3,726 — resolved

The baseline of 3,726 (HANDOFF, `07c43d3f`) is the same invocation-total style: it already counted the
`root-index` step, whose substring filter re-runs `packages/memory/src/sqlite/sessionIndex.test.ts` (10 tests)
that the `runtime+memory` batch also ran. The difference is exactly the **20 tests added by this card**
(3,726 + 20 = 3,746), and skipped stays at 8. So the delta is new coverage, not a counting artifact; the
executor's phrasing ("invocation totals repeat sessionIndex") explains why the number is not a distinct-test
count, but the increase itself comes from the new tests.

## Sanitization before commit

Six evidence files carried the local account path from the executor's logs (`batch1-results.json`,
`batch2-results.json`, `before-repair-batch2-results.json`, `gate-results.json`, `gate-attempt1.log`,
`gate-batched.log`; plus the coordinator's `acceptance-gate.log`). They were rewritten to `C:\work` in place —
byte content otherwise unchanged. The source/test manifest is unaffected (it covers the 13 source/test files and
the card only). `evidence/sessions/2026-10-31-session-handoff.md` also had its rollout path changed to
`%USERPROFILE%\…`; that line had already reached `origin/main` in `e7a22b57`, which cannot be undone without a
force push (blocked locally by policy, see the card result).

## Open

CodeQL rescan: needs the branch push + PR. If a finding appears at `runShellCommand`, it is the single
intentional shell boundary — dismiss with the comment draft in `report.md` §"Conditional dismiss comment draft".
