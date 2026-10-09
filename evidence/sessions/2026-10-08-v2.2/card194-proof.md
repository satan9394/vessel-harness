# Card 194 local proof — 2026-10-08

Implemented static manifest/source auditing in policy, shared schema re-export, discovery of `.harness/mods`, CLI `mod list/inspect/verify/audit`, and `doctor --mods`.

Manifests follow runtime precedence (`vessel.mod.json`, `claude.mod`, package `claude.mod`). Invalid higher-precedence content fails closed. Discovery reads source bytes and never executes unsigned source. Listings report advisory inferred hooks and disabled/sandbox-required status. No loaded-instance or source-safety claims are made.

Doctor's Mod-only path skips credentials, databases, daemon and network. A fixed trusted inert source probe verifies the restricted Worker mechanism without executing discovered Mod code. Unknown unsigned origin is a warning, known violations fail the command.

The trusted Worker diagnostic reaches runtime through the existing application dependency: application reexports `WorkerSandbox`, and CLI imports it from application. No undeclared CLI-to-runtime dependency or manifest/lockfile change is introduced.

After the final source edit:

- `card194-focused.log`: 4 files, 26 passed, exit 0 (new audit, mod CLI, doctor Mods tests plus existing doctor regression tests).
- `card194-tsc.log`: `npx tsc -b tsconfig.json`, exit 0.
- `card194-typecheck-tests.log`: `npm run typecheck:tests`, exit 0.

Static scanning is advisory and can have false positives or miss obfuscation; the Worker permission boundary and host RPC authorization enforce runtime security. No core edits, dependency additions, state deletion, commits, pushes, publishing or external Agent launches in this card. Epic 195 owns remaining integration and full-repository gates.
