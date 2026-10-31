# CodeQL rescan of card 371 (2026-10-31) — 4 of 7 cleared, 3 remain

Result of the rescan the card deferred ("push a branch, confirm the seven go to zero"). It did **not** go to zero.
This file records what the rescan actually says, how it was verified, and why the three survivors are what they are.

## What the PR rescan reported

Branch `codeql-371-remediation`, PR #47, head `f61f82d8`. All CI jobs green
(`build` × 4, `identity-guard`, `CodeQL`). Open alerts **at that ref**:

| # | rule | location |
|---|---|---|
| 22 (new number, same class as #14) | `js/shell-command-injection-from-environment` | `packages/runtime/src/process/Process.ts:59` |
| 15 | `js/shell-command-constructed-from-input` | `packages/tools/src/git/Worktree.ts:62` |
| 16 | `js/shell-command-constructed-from-input` | `packages/tools/src/git/Worktree.ts:62` |

Cleared: **#18, #19, #20, #21** (all four ReDoS). The default branch still lists the original 7 because it has not
been re-analysed at the new code.

## How this was verified locally (not guessed)

Installed the exact toolchain GitHub used — CodeQL CLI **2.27.3** with `codeql/javascript-queries` **2.4.8**
(`javascript-all` 2.10.4), the same versions named in the PR analysis SARIF. Database created from
`git archive HEAD` (tracked files only, no `node_modules`), then the two relevant queries were run directly.

- `Security/CWE-078/UnsafeShellCommandConstruction.ql` → 12 result rows, including the two Worktree path
  concatenations and the same rows in test files.
- `Security/CWE-078/ShellCommandInjectionFromEnvironment.ql` → 38 result rows, all highlighting
  `spawn(command, args, {…})` inside `runCommand`.

Diagnostic queries against the same database (pack copy patched only to expose a `private` predicate):

| probe | result |
|---|---|
| `sys.isShellInterpreted(commandArgument)` for both spawns in `Process.ts` | **false for both** |
| `executesArrayAsShell(sys)` | true **only** for `runShellCommand`'s spawn (literal `shell: true`) |
| `isIndirectCommandArgument(source, sys)` for the `runCommand` spawn | **true**, with sources from `native-boundaries.mts`, `workspace.test.ts`, `Process.test.ts`, `Process.sandbox.test.ts`, … |

## Why #15/#16 survive — the card's premise was wrong

`UnsafeShellCommandConstructionCustomizations::isExecutedAsShellCommand` has four cases. For a Node `spawn`
call, `isShellInterpreted` is only ever true for `exec`/`execSync` — so a spawn becomes a shell execution
through `isIndirectCommandArgument`, i.e. the *executable itself* is `cmd.exe`/`cmd` with `/c` (or `sh` with `-c`).

The sandbox deliberately runs `cmd.exe /c "…"` as **argv** (that is how the Windows escape probes work:
`evidence/task256/native-boundaries.mts`, `platformSandbox.test.ts`, `windowsRestricted.test.ts`). Those calls go
`PlatformSandboxRunner.execute → runCommand(executable, argv)`. Because that spawn node is shared, CodeQL models
the whole shared spawn as an indirect shell execution — and then every argv element from **every** caller
(including `Worktree`'s `path.resolve(...)` targets and temp paths in tests) counts as "executed as a shell
command". The two `path concatenation` sinks in `Worktree.ts` follow from that merge, not from anything
`Worktree.ts` does.

Consequences:

- Removing the `shell` key from `runCommand` (the card's decision) **cannot** clear #15/#16. The query never
  looks at that key on this path. Verified empirically: the alert set is identical before and after the split.
- `#22` (the renamed `#14`) is a different rule. Its sink is
  `ShellCommandSink() { any(SystemCommandExecution sys).isShellInterpreted(this) }`, and its sources are
  `process.cwd()`, `__dirname` and `path.resolve(...)` outputs. Any agent shell tool that runs a command with a
  workspace-derived cwd matches it; the local run reproduces 38 such rows.

## What would actually clear them

1. **#15/#16**: give the "deliberately arbitrary argv" boundary its own spawn function (e.g. a
   `runDirectedCommand` used only by `PlatformSandboxRunner`/`WindowsRestrictedRunner`), so `runCommand`'s node
   has no `cmd.exe /c` caller. Then `isIndirectCommandArgument` has no base case for that node and the Worktree
   sinks disappear. The alerts would move onto the sandbox spawn (where running arbitrary argv is the documented
   purpose) — likely one alert instead of two, and dismissable as design.
2. **#22**: no structural fix that keeps a usable shell tool. Either dismiss as by design, or stop resolving the
   cwd from the environment (not viable).

Both are decisions, not implementation details, which is why this stopped here instead of being decided
unilaterally. Nothing was dismissed and nothing was merged while this file was written.
