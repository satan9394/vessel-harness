# Task 255 delivery evidence

Disposition: fixes implemented; targeted gates pass. Full acceptance remains pending the checks below. No commit/push or packages/core edits.

## Changes

- HTTP reads finishReason from the persisted turn/end matching the returned turnId; Core TurnResult does not expose it. Only error + length maps to 200. Body preserves finalText/kind/steps/turnId and adds finishReason. Other errors remain 500.
- Web shows a localized, muted status and retains the empty composer and partial response. HTTP fallback covers absent SSE; delayed SSE replaces that fallback. Notice resets on new turn/session.
- Windows token open requests 0x2B including TOKEN_ADJUST_DEFAULT. Integrity is queried before relabeling; already Low/Untrusted tokens are never raised. Failed relabel is tolerated only when an independent query proves Low or below. Otherwise deny before child launch. No ACL changes or unrestricted fallback.

## Verification

- tsc -b: exit 0 ([log](tsc.log)).
- typecheck:tests: exit 0 ([log](typecheck-tests.log)).
- server + turn-status + sandbox: 4 files, 65 passed ([log](targeted.log)); includes real Core/persisted-event HTTP regressions for empty and long output, and Windows C# compilation.
- test:web: 51 files, 424 passed ([log](test-web.log)).
- web build --emptyOutDir false: passed ([log](web-build.log)); chunk-size advisory.
- Independent review: no blockers ([review](review.md)).
- git diff --check: exit 0; git diff HEAD --stat -- packages/core: empty.
- Full test:all: exit 1 ([log](test-all.log)); root 289 files passed / 2 failed, 3,080 tests passed / 2 failed / 6 skipped. Duration 557.46s. Its web leg did not execute after root failure; the separate test:web above passed.
- Root failures are outside changed files: virtualProxy.test.ts descendant cleanup gets access denied from taskkill; process-tree.test.ts pre-attach grandchild enumeration expects a PID missing from the tree. These were not repaired or hidden by this patch; no claim that a baseline run independently established them as pre-existing.

## Execution limits

- Actual OpenCode CLI startup failed before task execution: EPERM opening its user-profile opencode.log. Implementation/review used PDW auxiliary host roles, not a successful OpenCode relay. No permission bypass or .pdw/config.json change.
- PreToolUse rejected the dynamic native token probe because it could not statically verify runtime type construction. Compiler-only test passed. Successful restricted child execution and observed native token integrity remain unverified.
- Browser tool reported iab unavailable and no browsers/apps in inventory. Real-browser notice verification remains unverified. The offline browser-fixture.mjs uses port 31855 (checked free), isolated system-temp state and no real-provider calls; service was stopped.
- Existing test cleanup only deletes self-created system-temp directories. No core, package, lockfile or model configuration changes.

## Next checks

Run OpenCode CLI, native token smoke and browser truncation interaction in a session with the required access/surfaces. Investigate full-suite failures separately if reproduced outside the sandbox.

The pre-existing investigation helper was not used as CLI evidence. It embeds a credential; handle that separately without reproducing it in logs.
