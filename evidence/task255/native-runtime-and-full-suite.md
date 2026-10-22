# Task 255 — native runtime check and full-suite status

Date: 2026-10-21. Scope: close the "environment acceptance pending" gap recorded in `SUMMARY.md`.
Executor: host (OpenCode). No product behaviour change beyond `packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`.

## 1. What the earlier delivery claimed vs what actually runs

`SUMMARY.md` said the Windows restriction path was unverified. It was verified here against the real
launcher (`WindowsRestrictedRunner.execute`), not a mock, using
[`native-token-smoke.mts`](native-token-smoke.mts) against a self-created temp root with
out-of-band ACL provisioning (Low label + per-worktree restricted SID).

Result: **the delivered fix did not work, and two further defects sat behind it.**

### Layer 1 — the diagnosis in the card was wrong

Card text said `OpenProcessToken` lacked `TOKEN_ADJUST_DEFAULT (0x20)`. Measured with a standalone
C# probe:

| handle | rights requested | `SetTokenInformation(TokenIntegrityLevel)` |
|---|---|---|
| process token | `0xB` | `ERROR_ACCESS_DENIED (5)` |
| process token | `0x2B` (adds ADJUST_DEFAULT) | same failure on the restricted token |
| `CreateRestrictedToken` output | inherited from source | `ERROR_ACCESS_DENIED (5)`, integrity stays `8192` |
| `DuplicateTokenEx(restricted, 0x1F01FF, TokenPrimary)` | `TOKEN_ALL_ACCESS` | **succeeds**, integrity becomes `4096` (Low) |

`CreateRestrictedToken` never returns a handle carrying `TOKEN_ADJUST_DEFAULT`, whatever the source
handle requested. The relabel has to happen on a primary duplicate.

Fix: duplicate the restricted token with `0x1F01FF` before relabeling and launch the child from that
primary token (`windowsRestrictedSource.ts`, `DuplicateTokenEx(primary)` + `CreateProcessAsUser(primary,…)`).

### Layer 2 — AccessCheck could never succeed

`GetNamedSecurityInfo(root, SE_FILE_OBJECT, 4|16, …)` requested only `DACL|LABEL`, so the descriptor had
no owner/group. `AccessCheck` then returns `ERROR_INVALID_SECURITY_DESCR (1338)` for **every** write root:

```
GetNamedSecurityInfo=0 sd=…
AccessCheck(…)=False err=1338 (安全描述符结构无效) granted=0x0 status=False
```

Fix: request `OWNER|GROUP|DACL|LABEL (0x17)`. With that, `AccessCheck` returns `ok=True` and evaluates
the restricted token normally.

### Layer 3 — still blocked: the child cannot start under `CREATE_NO_WINDOW`

After both fixes the launcher gets through token creation, relabel, ACL preflight and `CreateProcessAsUser`,
but the child exits immediately:

```
echo:    exitCode = -1073741502 (0xC0000142 STATUS_DLL_INIT_FAILED)
whoami:  exitCode = -1073741502
```

Isolation matrix (same temp root, same `cmd.exe /c whoami /groups`, only token/flags varied):

| token | creation flags | exit |
|---|---|---|
| restricted + Low | `CREATE_NO_WINDOW (0x08000000)` | `0xC0000142` |
| restricted + Low | `CREATE_NEW_CONSOLE (0x10)` | `0xC0000142` |
| restricted + Low | `0` (inherit parent console) | `1` — process starts, writes `out.txt`, `whoami` itself is denied |
| plain + Low | `CREATE_NO_WINDOW` | `0` |
| plain + Medium | `CREATE_NO_WINDOW` | `0` |

So Low Integrity alone is fine, and a restricted token can start a process; what kills it is
creating a fresh console/hidden console under the restricted token. That is a launcher design question
(Console allocation, `DETACHED_PROCESS`, or a different isolation tier), not a missing access bit.
It is tracked as card 256 and is **not** fixed here.

## 2. Fixes actually landed in this card

`packages/tools/src/execution/sandbox/windowsRestrictedSource.ts`
- relabel the integrity of a `TOKEN_ALL_ACCESS` primary duplicate instead of the `CreateRestrictedToken` handle;
- request owner+group so `AccessCheck` has a valid descriptor;
- close the extra primary handle in the `finally` block.

Both are fail-closed or neutral: the sandbox still denies execution in this environment, it just fails
later and for a different (now correctly diagnosed) reason.

## 3. Gate status

- `npx vitest run packages/tools/src/execution/sandbox` — 2 files / 17 tests pass.
- `npx tsc -b`, `npm run typecheck:tests` — exit 0.
- `npm run test:web` — 51 files / 424 tests pass (see `test-web.log`).
- `npm run test:all` — **green on rerun**: root `291 files / 3082 passed + 6 skipped` (427 s), web `51 files / 424 passed` (19 s), exit 0
  ([log](test-all-rerun.log)). The two failures from the first attempt
  (`packages/runtime/src/proxy/virtualProxy.test.ts` descendant cleanup and
  `packages/runtime/src/sandbox/backend/process-tree.test.ts` pre-attach enumeration) are therefore
  confirmed as full-suite flakiness, not regressions: they pass in isolation (2 files / 23 tests, 9.8 s)
  and pass again in the full rerun, and neither file nor any `packages/runtime` source is touched by
  this card's diff.

## 4. Honest limitations

- The native probe is a host-run script, not part of `npm test`; it needs a writable root with
  provisioned ACL and it mutates only its own temp directory (recycled afterwards).
- No claim is made that the restricted sandbox executes commands successfully; it does not, see layer 3.
- Rotation of the provider credential found in local runner scripts is an operator action; the working
  tree no longer carries it.
