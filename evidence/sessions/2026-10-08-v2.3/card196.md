# Card 196 — evaluator Red→Green gate

The evaluator owns `RedGreenGate` and command configuration. Composition opts in with
`taskType: 'bugfix'` and injects that evaluator instance through `redGreenGate`.
If no instance is injected, bugfix completion fails closed. Generator tools have no
verification endpoint. Other task types retain existing behavior.

The PolicyEngine interceptor denies `claim_task_complete` until authenticated
Red→Green plus regression subprocess evidence exists. The provider boundary guards
ordinary completion too, because core's existing `before_stop` verdict is ignored.
For streaming, chunks are buffered until terminal admission, so rejected success text
does not reach observers. A rejection propagates as a model-call error and records
`audit/denial`. Core has no changes.

Evidence records include actual subprocess exit codes, stdout/stderr, timestamps,
target failure features and SHA-256 signatures. Authority lives in ECMAScript private
evaluator state; importing, altering or rehashing JSON cannot authorize completion.
Both evaluator tests and the command configuration stay identical across phases.
Tests and repaired source bytes are checked after both runs and at completion.
Red also snapshots the baseline sources and rejects mutations during reproduction.
Green requires a repair in the declared source scope; composition binds admission to
the evaluator's working directory. Parent freshness tests cover unchanged repairs,
baseline mutation and cross-workspace admission. The executor's initial 41-test
suite and parent rerun passed; final freshness logs supersede the earlier test
expectation failure. Final Epic gates remain required after all source edits.

## Trusted configuration boundary

- `shell:false` and string argv prevent shell interpolation. This is an execution
  channel, not an OS sandbox. Commands must be evaluator-selected trusted test runners;
  arbitrary programs can print fake assertion text. After independent review, Red
  accepts only a complete single uncaught Node assertion on stderr, empty stdout,
  and every evaluator-configured target feature. Mixed node:test failures and
  ambiguous suite output fail closed. Vitest/TAP/general runner reports require a
  future trusted report adapter; whole-output substring matches grant no authority.
- `reproductionFiles` must include the reproduction test, fixture, runner and helper
  dependencies whose bytes must remain immutable. `sourceFiles` must enumerate the
  repaired source dependency scope. Freshness is checked only within this explicit
  scope; there is no claim that unlisted filesystem bytes or external services were
  verified. Existing evaluator isolation remains the caller's responsibility.
- `fullSuiteCommand` is mandatory and must select the actual project full suite.
  The gate records execution; a general process runner cannot infer whether a caller
  selected a comprehensive suite. Unit fixtures intentionally use tiny complete suites.
- On Windows, npm/npx `.cmd` wrappers cannot run under `shell:false`. Use structured
  `{ executable: process.execPath, args: [absoluteNpmCliJs, 'run', 'test:all'] }`
  (or the Vitest JS entrypoint) instead of enabling a shell. Simple command strings
  support unquoted argv only; structured argv handles spaces and quoted arguments.
- Execution/output are bounded (30s default, 4MiB output). Timeout kills the direct
  subprocess and waits up to a further 1s for close; inherited descendant pipes cannot
  hang verification. This does not claim OS process-tree confinement. Timeout, signal,
  missing executable, output overflow and unrelated failure all deny authority.

## Reproduce scoped verification

```powershell
npx vitest run packages/policy/tests/redGreenGate.test.ts packages/application/src/redGreenCompletion.test.ts packages/policy/src/policy.test.ts packages/application/src/modIntegration.test.ts
npx tsc -b tsconfig.json
npm run typecheck:tests
```

Raw logs and exit codes are in `card196-scoped-tests.log`, `card196-build.log` and
`card196-test-types.log`. Full dual-root tests and Web build belong to the final
Epic 199 gate after all direction-C changes.

Independent review repair: `card196-review-repair.log` records **15 passed**, exit 0,
including the genuine mixed target assertion/unrelated SyntaxError subprocess and
unsupported-output negative controls. `review196197.md` retains the original finding.
