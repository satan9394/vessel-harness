# Task 182 — cross-instance mesh delivery

Date: 2026-10-03. Scope: task 182 only; no commit, push, external Agent or public-network test.

## Composition and protocol

- `NativeMeshEventBus` lives in `packages/agents/src/team/mesh/`; `packages/core` is unchanged. Node UUIDs and 24-byte hex launch tokens are explicitly provisioned on both sides with `trustPeer`, followed by `registerPeer`.
- Native HTTP/HTTPS requests carry the receiver's Bearer token and a sender HMAC covering method, route, nonce and body. The nonce has a short validity window and replay protection. The handshake response proves the receiver's token and UUID. No credentials in URLs.
- `createVesselServer({ mesh, authToken, host })` mounts `/api/mesh/handshake`, `/api/mesh/tasks`, `/api/mesh/events` and `/api/mesh/stream` behind existing daemon authentication. Mesh token/UUID must match the daemon identity. Non-loopback bind requires an explicit host and launch token. An advertised endpoint must identify the reachable machine rather than the wildcard bind address.
- `createTeamMeshExecution(options, roster)` composes the existing TeamRuntime with receiver-owned workspace, providers, policy and tools. Remote context is serialized data, never a path opened on the receiver. Dependency outputs and authoritative results flow through the adapter; artifacts use the existing confined Git diff reader.
- `registerDag(id, tasks, snapshotRef, context)` registers the controller's immutable input. `dispatchSubDag(peerId, { dagId, subGraphNodes, contextSnapshotRef })` accepts dependency-closed subgraphs. Per-task ownership prevents cross-peer duplicate delegation; an ambiguous transport failure retains ownership for retry on the same peer. Receiver dispatch retries are idempotent and overlapping/conflicting requests are rejected.
- `subscribePeerEvents` automatically reconnects with the last accepted Seq. `reconcilePeer` explicitly pulls missing events; duplicate events do not notify twice. Journals and streams are scoped to the requesting peer. `dagSnapshot` aggregates delegated branches; `settleParent` applies remote terminal results to parent tasks already claimed and started by their owner.

## Intentional boundaries

- `ponytail:` trust, execution composition and delegation are explicit APIs; no automatic discovery, external Agent launcher, CLI enrollment UI or extra dependency.
- Event/run journals and sequence cursors live for the mesh process lifetime. Network reconnection is supported; process-restart durability is not implemented by this card.
- Independent branches must include their dependencies. Moving a task to another peer after ambiguous delivery is deliberately denied, since the previous peer may still be executing it.
- The local server serves HTTP. HTTPS endpoints can be reached with Node's standard TLS validation; deploying a TLS terminator is an operator responsibility for networks requiring encryption.

## Verification

All gates ran sequentially after the final implementation/test edit. Results:

| Command | Result | Full log |
|---|---|---|
| `npx vitest run packages/agents/src/team/mesh/peerHandshake.test.ts packages/agents/src/team/mesh/subDagDispatch.test.ts` | 2 files / 10 passed; exit 0 | [01-targeted.log](01-targeted.log) |
| `npx tsc -b tsconfig.json` | exit 0; no diagnostics | [02-build.log](02-build.log) |
| `npm run typecheck:tests` | exit 0 | [03-test-types.log](03-test-types.log) |
| `npm run test:all` | root 221 files / 2535 passed + 6 skipped; Web 16 files / 154 passed; exit 0 | [04-regression.log](04-regression.log) |

Full regression includes the daemon mount integration test; mesh plus mount coverage totals 11 passing tests. Root duration 568.22 seconds; Web duration 5.37 seconds. Existing runtime warnings are present in the raw log. No code/test edits followed the gates; only acceptance records were finalized.

## Independent review resolution

The independent evaluator reproduced the rejected-dispatch ownership bug using localhost and identified the production result truncation at the UI-preview boundary. Both are repaired and covered by regressions. Re-review reported no remaining demonstrated blocker and independently ran the required mesh tests (10/10).

Root review additionally required stale-heartbeat fixes, dependency-output handoff, cross-peer task ownership, UTF-8 chunk preservation, active-turn cancellation, authoritative parent settlement, drain-aware SSE backpressure and bounded replay pages. Tests cover these behaviors. There is no automatic parent scheduling caller: the controller explicitly subscribes/reconciles and invokes `settleParent` after claiming/starting its delegated parent tasks.

## Changed source and tests

- `packages/agents/src/team/mesh/types.ts`: requested public contracts plus execution/event envelopes.
- `packages/agents/src/team/mesh/NativeMeshEventBus.ts`: handshake, heartbeat, HTTP dispatch, SSE, replay, ownership and DAG views.
- `packages/agents/src/team/mesh/peerHandshake.test.ts`: offline credential/identity/nonce/UTF-8/heartbeat checks.
- `packages/agents/src/team/mesh/subDagDispatch.test.ts`: offline execution, handoff, Diff, reconnect, paging, ownership, parent settlement and cancellation checks.
- `packages/agents/src/team/mesh/__tests__/helpers.ts`: ephemeral localhost HTTP servers with the existing auth middleware.
- `packages/agents/src/team/TeamRuntime.ts`: optional owner cancellation and authoritative task result accessor; UI previews unchanged.
- `packages/agents/src/index.ts`: mesh exports.
- `apps/local-server/src/meshExecution.ts`: receiver-owned TeamRuntime adapter and confined artifact Diff collection.
- `apps/local-server/src/meshApi.test.ts`: daemon HTTP mount and auth/identity/bind integration.
- `apps/local-server/src/server.ts`: optional mesh mount, authenticated host configuration, heartbeat/close lifecycle.
- `apps/local-server/src/index.ts`: adapter export.
- `tasks/182-cross-instance-swarm-mesh-and-event-bus.md`: execution and acceptance evidence.
- This delivery record and gate logs; `tasks/README.md` reflects final acceptance status.

No dependency/lockfile, core or shared change was necessary. All test-created filesystem data is beneath `os.tmpdir()`. Four accidentally emitted TypeScript helper outputs were moved to a unique ignored `.agent-state/task182-generated-*` directory; no repository file was permanently deleted.
