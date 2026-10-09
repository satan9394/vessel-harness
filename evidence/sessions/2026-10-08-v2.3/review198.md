# Card 198 independent adversarial review — 2026-10-08

Conclusion: two reproducible acceptance gaps in the reviewed version. Parent accepted both findings and dispatched repairs; this report is the pre-repair evidence, not final acceptance.

## Scope

Read HANDOFF, cards 198/199, repository instructions, personal-dev-workflow audit rules, pruning/types/tests, ContextBuilder, guarded SymbolGraph access, application composition/tests, and Card 196 strict failure parser/tests. No production edits, external agents/services, Git mutations, or performance runs. Parent owns Card 197 performance status and final regression gates.

## R198-1 [P2] Exported arrow-function signatures disappear

Location: `packages/context/src/pruning/adaptivePruning.ts`, `sourceSkeleton` variable-declaration visitor.

The input `export const greet = (name: string): string => name; export const value = 123;` produces `export const greet;` and `export const value;`. The exported callable's parameter and explicit return type disappear with its initializer. Adding a long implementation makes this incomplete skeleton eligible for replacing an old Read result. Card 198 Tier 2 requires preservation of exported symbol signatures; current tests cover named functions and already annotated variables.

Read-only probe, executed successfully:

```powershell
node --import tsx --input-type=module -e 'import { sourceSkeleton } from "./packages/context/src/pruning/adaptivePruning.ts"; console.log(sourceSkeleton("f.ts", "export const greet = (name: string): string => name; export const value = 123;"));'
```

Expected repair: preserve the callable contract when stripping its implementation, or retain original content when a faithful signature cannot be represented; cover exported arrow/function-expression signatures.

## R198-2 [P2] Active modified-file Shell diffs are summarized

Location: `packages/context/src/pruning/adaptivePruning.ts`, call classification and pruning eligibility.

Only `call.arguments.path` associates tool output with a file. A normal Shell call with `command: 'git diff -- f0.ts'` has no path. Even with `modifiedFiles() => ['f0.ts']`, the older completed result satisfies `!call.file` and becomes an archived hash/count summary. The exact active-file diff disappears from the request, contrary to Tier 1 full content and precise Diff preservation.

Executed read-only probe: a 10,027-character diff for f0.ts followed by three assistant groups produced `DIFF_RETAINED false` and `[Archived tool output; sha256=aa39b5d239e029fe6199f0b1a0b4b89d2b41cd34a2ad53e69cf1c5c15760ad28; tool=Shell; 10027 characters, 2002 lines captured. Full output remains in session history.]`.

Runnable reproduction:

```powershell
node --import tsx --input-type=module -e 'import { AdaptiveContextPruner } from "./packages/context/src/pruning/adaptivePruning.ts"; const original="diff --git a/f0.ts b/f0.ts\n"+"-old\n+new\n".repeat(1000); const messages=[{role:"user",content:"fix f0"},{role:"assistant",content:"",toolCalls:[{id:"diff",name:"Shell",arguments:{command:"git diff -- f0.ts"}}]},{role:"tool",name:"Shell",toolCallId:"diff",content:original}]; for(let i=0;i<3;i++) messages.push({role:"assistant",content:"recent"}); const pruner=new AdaptiveContextPruner({workspaceRoot:process.cwd(),graph:{findSymbols:async()=>[],getGraph:async()=>({nodes:[],edges:[]})},refreshGraph:async()=>{},modifiedFiles:async()=>["f0.ts"]}); const out=await pruner.prune(messages,{tokenThreshold:100,targetTokenBudget:0,preserveRecentTurns:3}); console.log("DIFF_RETAINED",out.messages[2].content===original,"RESULT",out.messages[2].content);'
```

Expected repair: retain full active/modified/dependency diffs obtained through Shell, with coverage of their actual wire representation and metadata/order.

## Verification and limits

`npx vitest run packages/context/tests/pruning/adaptivePruning.test.ts packages/application/src/adaptivePruningIntegration.test.ts packages/policy/tests/redGreenGate.test.ts --maxWorkers 1`: 3 files, 17 tests passed, 11.61 seconds.

The 20-file fixture asserts actual serialized token-estimate savings >=40%, protected Git/AST reads, task/static/scoped bytes, recent three assistant groups, input immutability, metadata/order, pending calls, errors, and preserved builder history. Composition shares guarded graph refresh and denied-read checks. Those tests did not cover the findings above.

Card 196's strict parser rejects ambiguous/mixed node:test reports and synthetic assertion text; its mixed-real-failure test passed. Unsupported runners intentionally fail closed. No further Card 196 finding in this bounded review.

No full regression, platform matrix, security audit, or performance acceptance performed. No test rerun after the parent's repair dispatch; parent owns post-repair verification.

Changes: only this evidence file.
Verification: 17 existing scoped tests passed; two defects reproduced by inline probes.
Next steps: parent verifies dispatched repairs before Card 198/199 acceptance.
