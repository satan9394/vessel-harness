# Wave 5 V4 final-gate execution evidence

2026-10-28. Executor: `gpt-6.1-sol` / medium, Fast off, no Ultra, per Wave 5 §1. This is execution evidence. The separate read-only review and coordinator's complete rerun are recorded below; the executor left its original verdict pending.

## Full 17-step gate

Exact command: `pwsh -NoProfile -File scripts/gate-batched.ps1`; process exit **0**. No `-Only`, filter, or `-SkipConformance` was supplied. Raw per-step logs: `%TEMP%/vessel-gate-48e8122b/`. All counts below were read from those logs and checked against the runner output. Counts apply to this execution, after the final V1/V3 source and test edits.

| # | Step | exit | Files | Passed | Skipped | Seconds | Raw log |
|---:|---|---:|---:|---:|---:|---:|---|
| 1 | shared+core | 0 | 31 | 279 | 1 | 15 | `01-shared_core.log` |
| 2 | llm | 0 | 20 | 336 | 0 | 10 | `02-llm.log` |
| 3 | behavior+context | 0 | 18 | 164 | 0 | 11 | `03-behavior_context.log` |
| 4 | tools+policy | 0 | 31 | 324 | 3 | 30 | `04-tools_policy.log` |
| 5 | runtime+memory | 0 | 24 | 205 | 1 | 33 | `05-runtime_memory.log` |
| 6 | skills+agents | 0 | 23 | 194 | 0 | 27 | `06-skills_agents.log` |
| 7 | telemetry+engine | 0 | 22 | 223 | 0 | 37 | `07-telemetry_engine.log` |
| 8 | application | 0 | 36 | 325 | 3 | 49 | `08-application.log` |
| 9 | cli | 0 | 65 | 782 | 0 | 135 | `09-cli.log` |
| 10 | local-server | 0 | 27 | 317 | 0 | 105 | `10-local_server.log` |
| 11 | benchmarks | 0 | 35 | 541 | 0 | 104 | `11-benchmarks.log` |
| 12 | root-index | 0 | 2 | 14 | 0 | 1 | `12-root_index.log` |
| 13 | web-root | 0 | 59 | 528 | 0 | 44 | `web-root.log` |
| 14 | tsc-build | 0 | — | — | — | 0 | `tsc-build.log` |
| 15 | tsc-tests | 0 | — | — | — | 2 | `tsc-tests.log` |
| 16 | tsc-web | 0 | — | — | — | 1 | `tsc-web.log` |
| 17 | conformance (offline) | 0 | — | 25 runs | 0 failed | 6 | `conformance.log` |

Root aggregate (steps 1–12): **334 files / 3,704 passed + 8 skipped**. Web: **59 files / 528 passed**. Combined: **393 files / 4,232 passed + 8 skipped**. Offline conformance is separate: **25/25, 0 failed, success 100%, cost $0**.

The three type-check commands executed by the script were `node node_modules/typescript/bin/tsc -b tsconfig.json`, `node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit`, and `node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit`; all exit 0 without diagnostics. Conformance was `npm run bench:conformance`, without `--live`. A production Web build, real packaging/install validation, and live cross-harness runs are not part of these 17 steps and were not executed by V4.

## Auxiliary checks and attribution

The full gate's 17 zero exits do not mean every auxiliary check succeeded. Raw auxiliary output and scope inventories: `%TEMP%/vessel-wave5-v4-328zt8/`.

| Exact command / check | Native exit | Result |
|---|---:|---|
| `git diff --check` (initial) | 2 | Card 260 line 66: new blank line at EOF; card 275 line 125: trailing whitespace. The first PowerShell tool envelope reported 1; explicit `$LASTEXITCODE` propagation and Node `spawnSync` both confirmed native Git exit 2. |
| `git diff --check` (after coordinator's V2 suffix hygiene) | 2 | Only card 260 line 66 remains. No V4 whitespace issue is reported. |
| `node scripts/check-append-only.mjs tasks/351-packaging-gate-run.md tasks/275-ui-final-acceptance.md tasks/345-app-trash-and-retention.md` | 1 | Card 275 reports `+95 -2` against HEAD, deleting the older status and `待执行。` lines. Untracked cards 351/345 are ignored by this helper, so its result alone cannot verify their additions. Same result on the final rerun. |
| Node comparison of all three current card prefixes with wave-start original bytes | 0 | All match: card 351 original 17,071 bytes; card 275 original 23,087 bytes; card 345 original 30,317 bytes. |
| `git diff --no-index -- <TEMP>/275-HEAD.md <TEMP>/275-wave-start.md` | 1 | Differences found, as expected: both card 275 deleted lines were already absent in the wave-start original. Raw diff: `275-head-vs-wave-start.diff`. This is baseline attribution, not a passing append-only-helper result. |

Card 260's current SHA-256 equals its `files.json` wave-start hash, proving its reported EOF issue predates this wave. Card 275's whitespace was **introduced in the Wave 5 V2 appended suffix**, beyond the preserved 23,087-byte baseline; it was not pre-existing. The coordinator removed exactly that one whitespace byte under V2 report hygiene, without changing the original prefix or rerunning the browser. V4 did not repair cards or source. Initial failures remain recorded in `diff-check.{stdout,stderr}.log` and `append-only.{stdout,stderr}.log`; current output is in `final-diff-check.{stdout,stderr}.log` and `final-append-only.{stdout,stderr}.log`.

## Scope and baseline preservation

V4 repository writes are limited to this new report, `tasks/README.md` (current-unclosed text and the 351/345/275 rows), and `HANDOFF.md` (full-gate/recent-delivery/pending rows). Node UTF-8 read/write was used. No product, test, package, script, skill, `.pdw`, or task-card changes were made by V4; no new task card was created.

The V4-start inventory captured 235 dirty paths in `%TEMP%/vessel-wave5-v4-328zt8/v4-start.json` and `status-start.txt`. Rechecking these hashes identifies only the two allowed existing documents plus the coordinator's one-byte card 275 hygiene change; the report is the one newly added path. No source/test file differs from V4 start. Masking only the permitted README text/rows and three HANDOFF rows gives exact equality with the wave-start original documents for all other body bytes.

The earlier wave-start snapshot is `%TEMP%/vessel-wave5-baseline-2tEZKq/` (`files.json`, `status.txt`, original documents and cards). Before V4 writes, direct hashing of every baseline path found differences in 12 existing paths: V1's gate source/test and card 351; V3's server source/test, SessionRegistry source/test, deletion documentation and card 345; V2's card 275; plus `HANDOFF.md` and `evidence/sessions/2026-10-27-session-handoff.md`. Those two latter document differences were already present at V4 start; V4 does not attribute them to its own execution. New Wave 5 evidence files were also already present in the dirty inventory. Dirty status relative to HEAD is therefore not treated as proof of V4 changes.

## Other Wave 5 outcomes and limits

- **V1:** independent read-only terra/medium review recorded PASS for its requested criteria in [card 351](../../tasks/351-packaging-gate-run.md). The real default packaging gate returned `status=pass`, npm exit 0, stdout 1,130 bytes, stderr 0; raw logs `%TEMP%/vessel-w5-v1-IUjlww/`. This proves the npm probe and path-existence criterion, and does **not** prove artifact completeness, installation, or publication. The fixed-argument Windows shell path emits parent-process DEP0190, as recorded in the card; the review cautions against untrusted generic npm arguments.
- **V2:** W1/W2 viewport acceptance remains **UNVERIFIED**. [V2 proof](2026-10-28-iab-run4/PROOF.md) and [card 275](../../tasks/275-ui-final-acceptance.md) record two visible-IAB refusals with one reset. The limitation is the subagent thread's visible-IAB support; it is not evidence of global IAB unavailability. No fixture/services were started, no screenshots or DOM substitutes were produced, and listener counts were not measured. V4 did not retry the browser.
- **V3:** independent read-only sol/high review recorded PASS in [card 345](../../tasks/345-app-trash-and-retention.md), including a separate real dist serve plus independent CLI restore proof. An already-running serve sees restored newly registered sessions, without duplicating them or rewriting journal/snapshot/log/lease state. Synchronization is additions-only; other-process updates/deletions are not synchronized. Different registry roots or failed CLI registration remain outside the successful import path.
- **V5:** the [pre-V4 audit](2026-10-28-precommit-audit.md) freezes **235 paths / 11 suggested groups**. It found one repository-root `.tmp` directory and **62 absolute TEMP-reference lines**; matching lines in the three Wave 5 card additions were not new. A four-keyword text scan identified no actual credentials in its matches, with binary files and other patterns outside scope. The audit is **not clean** and no cleanup or staging was performed. It remains a pre-V4 snapshot; this report and the V4 document edits follow it.

V4 did not run other Agent CLIs, browser calls, live benchmarks, release/install/publish operations, Git add/commit/push/branch operations, deletion, or source repairs. No V4 command was refused. The exact refused V2 calls, with no process exit code, were twice `let tab = await cua.createBrowserTab("iab", "about:blank", { visible: true });`, each returning `IAB visibility is not supported in a subagent thread`, separated by `mcp__cua_repl.js_reset` (`{}` → `js kernel reset`). Earlier-wave refusals remain in their original cards; they are not new V4 executions.

## Independent review and final acceptance

The executor left this section **PENDING** and supplied no PASS/FAIL acceptance verdict. The coordinator subsequently appended the separate evaluator's conclusion and its own complete rerun below.

### Independent evaluator result

Added by the coordinator after the separate read-only evaluator returned. Model: gpt-6.1-sol / high, Fast off, no Ultra. The evaluator did not edit files or reuse the implementation session.

> Conclusion: V4 PASS for evidence, scope, and reporting acceptance.

This is the evaluator's quoted conclusion. It does not certify all Wave 5 functionality or UI acceptance. The evaluator independently parsed all 17 raw logs, recounted root 334 files / 3,704 passed + 8 skipped and web 59 / 528, checked the three empty tsc logs and conformance 25/25 at $0. Original native exit 0 was supplied from completion tool chunk f14660, session 88733; there was no separately saved outer transcript.

The evaluator independently reran both auxiliary commands via Node spawnSync: git diff --check native exit 2 (only baseline card 260 EOF whitespace); the exact three-card append-only command exit 1 (+95 / -2 for card 275 against HEAD). Both deletions already existed in the original card. All three original byte prefixes match. Read/hash/masking checks exit 0; only the permitted README section/rows and HANDOFF three rows differ from their saved originals, and no source/test differs from V4 start.

The evaluator found a missing literal $0 in the HANDOFF gate row. The coordinator repaired only that allowed row, and the evaluator freshly confirmed it. The earlier one-byte V2 appended-suffix whitespace repair is recorded above as introduced this wave. The evaluator independently recounted V5's 235 unique paths / 11 groups, preserved the hygiene findings, and left V2 UNVERIFIED. No evaluator command was refused.

Reviewed input hashes (before this append): HANDOFF 9c1e590ee7fa9a9ef39aa4ad641e313e775ba6e43d6d173b87ee25a2adc2315d; README 2c50d26f7684cc9c2c2572dceb11a8406df801f3f51bd418a1dccc77564596ca; this report a4b3f85fa2c93aaf47a185c3fee141fa82909e8c130872ae9010aa2f8443a637.

The evaluator explicitly retained the scope limitation: 15 allowed changed paths plus unexplained pre-V4 drift in evidence/sessions/2026-10-27-session-handoff.md. The snapshot was not atomic; neither the reviewer nor coordinator assigns authorship or certifies whole-wave exclusivity from that snapshot. No assigned writer or coordinator edited that old handoff record.

### Coordinator's separate complete rerun

The coordinator separately executed pwsh -NoProfile -File scripts/gate-batched.ps1, without filters or SkipConformance, after source/test freeze. Native process exit 0; completed 2026-10-28T13:20:46.9880972Z. Original outer transcript and native-exit metadata are %TEMP%/vessel-wave5-coordinator-4753e3a1.log and .json; independent parse and auxiliary native results are %TEMP%/vessel-wave5-coordinator-verification.json. Its raw 17 logs are %TEMP%/vessel-gate-02c925a1/. This is a separate execution, not a replacement for the evaluator's verdict.

| Step | exit | Files / passed + skipped |
|---|---:|---|
| shared+core | 0 | 31 / 279 + 1 |
| llm | 0 | 20 / 336 + 0 |
| behavior+context | 0 | 18 / 164 + 0 |
| tools+policy | 0 | 31 / 324 + 3 |
| runtime+memory | 0 | 24 / 205 + 1 |
| skills+agents | 0 | 23 / 194 + 0 |
| telemetry+engine | 0 | 22 / 223 + 0 |
| application | 0 | 36 / 325 + 3 |
| cli | 0 | 65 / 782 + 0 |
| local-server | 0 | 27 / 317 + 0 |
| benchmarks | 0 | 35 / 541 + 0 |
| root-index | 0 | 2 / 14 + 0 |
| web-root | 0 | 59 / 528 |
| tsc-build | 0 | no diagnostics |
| tsc-tests | 0 | no diagnostics |
| tsc-web | 0 | no diagnostics |
| offline conformance | 0 | 25/25, 0 failed, $0 |

Coordinator totals: root 334 files / 3,704 passed + 8 skipped; web 59 files / 528 passed. A Node parse checked native exit 0, exactly 17 step records, all zero exits, and raw-log aggregates; exit 0. The same exact auxiliary commands were independently rerun: native git diff --check exit 2, only card 260 line 66; append-only exit 1, card 275 +95 / -2. No new source/test changes or refusals occurred.

Coordinator scope audit: Node SHA-256 scan of 4,936 tracked/unignored paths and original-card byte comparisons exit 0, no missing files; V3 accepted source hashes unchanged. Its metadata is %TEMP%/vessel-wave5-coordinator-scope.json. It observed the same 15 allowed paths plus the already-recorded old-handoff drift. After the reviewer and separate run, only the already-permitted documentation status text was updated to link these completed records.

### Per-item delivery index

- V1 changed benchmarks/runners/src/release-gates/gates.ts, release-gates.test.ts and appended tasks/351-packaging-gate-run.md. Exact self-checks and raw logs are in card 351: release-gates 1 / 67, runners 35 / 541, build tsc 0, test tsc 0; real default gate pass, npm exit 0 / stdout 1130 / stderr 0, criterion unchanged. No V1 command was refused. Package installation/completeness remains outside scope.
- V2 changed evidence/sessions/2026-10-28-iab-run4/PROOF.md and appended tasks/275-ui-final-acceptance.md; the coordinator removed one new suffix whitespace byte only. The proof contains both exact IAB calls/refusals and reset result. W1/W2 remain UNVERIFIED; no fixture, DOM replacement or old screenshot was used.
- V3 changed apps/local-server/src/server.ts, server.test.ts, packages/application/src/session/SessionRegistry.ts, SessionRegistry.test.ts, docs/DELETION-AND-RETENTION.md, and appended tasks/345-app-trash-and-retention.md. Exact four commands/exit/counts, real proof and independent reviewer commands are in 345e: application 36 / 325 passed + 3 skipped; local-server 27 / 317; both tsc 0. Writer and independent reviewer each demonstrated a continuously-running serve seeing the restored session on the first GET. No V3 command was refused; ancillary read-query errors are preserved in the card. Other-process updates/deletions are deliberately not synchronized.
- V4 changed only HANDOFF.md, tasks/README.md and this report; exact 17-step and auxiliary commands/exit/counts appear above. No V4 command was refused. Production web build, install/publish and live external-harness runs were not performed.
- V5 changed only evidence/sessions/2026-10-28-precommit-audit.md. git status --porcelain=v1 -uall exit 0 / 235 paths, 11 groups / 235 unique coverage; audit/group scripts and baseline comparisons exit 0. Findings: one .tmp directory, 62 absolute TEMP-reference lines; text keyword matches classified with no actual credentials identified, binary files excluded. Exact scratch preparation failures and limits are in the audit. No staging, commit or cleanup occurred; no V5 command was refused.


### Final read-only confirmation after coordinator records

The same separate gpt-6.1-sol / high evaluator freshly read the completed coordinator transcript/metadata and final documentation, without edits, tests, browser calls or Git mutation. Its read-only checks exited 0: exact full-gate native exit 0 with 17 zero-exit steps; root 334 / 3,704 passed + 8 skipped; web 59 / 528 passed; three empty tsc logs; conformance 25/25 at $0; permitted document masks and source/test hashes unchanged. V2 UNVERIFIED, auxiliary native exits 2/1, hygiene findings and unexplained pre-V4 document drift remain preserved.

Reviewed final-document input hashes: HANDOFF 2c89746548f8fbeacaad2fdee7e51f1847234ff762852b7a2b693286ccfb86a3; README a7d4b4dcb68358ae8850eff67dd7b8bd477bc4df375954583b47a393da3304d2; this report before this confirmation append 69fd02f45affa7a16df2cd4f82b37edbbefecd3c34be0f32a47e4b9f8765c6fe.

Independent evaluator verbatim final conclusion:

> Confirmed: V4 PASS still applies to the final documentation. No new findings.

### Third independent execution — accepting session (2026-10-28)

Added by the host coordinator session that accepted Wave 5, **after** the report above was complete. It is a separate execution: different process, different log root, same working tree. No source, test or product file was edited before or during it; only this append followed.

- Exact command: `pwsh -NoProfile -File scripts/gate-batched.ps1`, no `-Only`, no `-SkipConformance`. Native process exit **0**; raw per-step logs `%TEMP%/vessel-gate-d161a08e/`.
- Steps: 17, all exit 0.

| Step | exit | Files / passed + skipped | Seconds |
|---|---:|---|---:|
| shared+core | 0 | 31 / 279 + 1 | 14 |
| llm | 0 | 20 / 336 | 10 |
| behavior+context | 0 | 18 / 164 | 10 |
| tools+policy | 0 | 31 / 324 + 3 | 33 |
| runtime+memory | 0 | 24 / 205 + 1 | 37 |
| skills+agents | 0 | 23 / 194 | 32 |
| telemetry+engine | 0 | 22 / 223 | 34 |
| application | 0 | 36 / 325 + 3 | 58 |
| cli | 0 | 65 / 782 | 143 |
| local-server | 0 | 27 / 317 | 101 |
| benchmarks | 0 | 35 / 541 | 94 |
| root-index | 0 | 2 / 14 | 1 |
| web-root | 0 | 59 / 528 | 21 |
| tsc-build | 0 | no diagnostics | 0 |
| tsc-tests | 0 | no diagnostics | 2 |
| tsc-web | 0 | no diagnostics | 1 |
| conformance (offline) | 0 | 25/25, 0 failed, $0 | 5 |

Root aggregate: **334 files / 3,704 passed + 8 skipped**; web **59 files / 528 passed**; combined **393 files / 4,232 passed + 8 skipped**; conformance **25/25 at $0**. These equal the executor's and the earlier coordinator's counts digit for digit, on the same frozen tree.

Targeted reruns before the gate (logs `%TEMP%/opencode/wave5/`): release-gates **1 file / 67 passed** (5.6 s); `packages/application` **36 / 325 passed + 3 skipped** (56.6 s); `apps/local-server` **27 / 317 passed** (103.7 s); `apps/cli` **65 / 782 passed** (127.0 s); `tsc -b tsconfig.json` and `tsc -p tsconfig.test.json --noEmit` exit 0.

Independent V1 check: the default packaging gate was executed again through the documented wrapper (no change to command, arguments or criterion; raw verdict `%TEMP%/opencode/wave5/v1-gate/verdict.json`): `status=pass`, `dist=true`, `entry=true`, `probeFailed=false`, `npm pack exit=0`, `stdoutBytes=1130`, `stderrBytes=0`; the parent process reproduced DEP0190. Matches card 351 exactly.

Independent V3 check: the accepting session re-ran a copy of the implementation proof in its own isolated fixture (`%TEMP%/opencode/wave5/v3-proof/`, isolated `HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA`/`VESSEL_*` roots, TTL 0, ephemeral port 60286). `vessel serve` PID 23000 stayed the same process from start to finish (`origPid === finalPid === 23000`, `exitCode === null`); an independent `trash restore` CLI process (PID 16352) exited 0; the **first** subsequent `GET /api/sessions` returned the restored session exactly once with `recordCount=14` while the other live session remained; a repeated GET still returned one; journal and `sessions.json` SHA-256 unchanged across the GETs, no `.lease` created, and the port was re-bindable after SIGTERM.

Auxiliary checks re-run by the same session: `git diff --check` native exit **2** with only `tasks/260-browser-runtime-acceptance.md:66: new blank line at EOF.`; `node scripts/check-append-only.mjs` on cards 351/275/345 exit **1** with `FAIL tasks/275-ui-final-acceptance.md +95 -2` naming the two lines that were already absent at wave start. Both reproduce the recorded baseline findings; no new whitespace or deletion was introduced.

V2 remains **UNVERIFIED** and is not signed off by this record: no visible IAB was available in a subagent thread, and no substitute evidence was accepted.

**Later update (same day, run 5).** A separate main-thread run in the Codex app did obtain a visible IAB at 917×567 and closed the W1/W2 viewport gates; see `evidence/sessions/2026-10-28-iab-run5/report.md` and cards 260/275. That run also appended to card 260, which turned its historical EOF blank line into an interior blank line, so `git diff --check` now exits **0**. The exit-2 observation above is preserved as the state at the time of this execution; the append-only helper still exits 1 for card 275 for the same pre-existing deletions.


