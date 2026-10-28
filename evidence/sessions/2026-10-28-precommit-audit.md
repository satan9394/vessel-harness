# Pre-commit audit snapshot

Snapshot UTC: 2026-10-28T12:23:33.847Z. V1, V2 and V3 were complete at capture; V4 has not started. This is the final pre-V4 snapshot. Wave-start baseline: system TEMP 'vessel-wave5-baseline-2tEZKq/status.txt' and 'files.json'. Status entries below are the current snapshot, including nested untracked files; paths may have mixed changes from historical work and recent waves. Status alone cannot prove provenance. No staging or commits performed.

## Inventory

Command: 'git status --porcelain=v1 -uall'; exit 0; 235 paths. Categories: documentation/cards 91; configuration 2; tests 20; code/other 25; evidence 97. '.pdw' is excluded from the requested configuration category; no .pdw paths appeared in status.

## Suggested commit groups

Every path in the timestamped status snapshot appears exactly once; path tags are evidence-bounded and do not imply every hunk has that provenance. Shared files remain in one cumulative group; V4 will subsequently update the handoff and board. Review each complete diff before staging.

### PDW and repository governance

Commit the workflow, repository policy, routing scripts and their governance cards.

- ` M` `.dsh-mission/publish/README.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `.gitignore` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `AGENTS.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/DESIGN-DECISIONS.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/PDW-LOCAL.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `scripts/check-append-only.mjs` — present at wave 5 start; earlier wave or historical uncertain
- `??` `scripts/pdw-batch.ps1` — present at wave 5 start; earlier wave or historical uncertain
- `??` `scripts/pdw-route.ps1` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/347-codex-project-subagents.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/348-pdw-model-fit-routing.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/349-failure-attribution-rules.md` — present at wave 5 start; earlier wave or historical uncertain

### Handoff and wave instructions

Commit the session handoff and wave instructions together as coordination records.

- ` M` `HANDOFF.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/prompts/codex-handoff-2026-10-27-backlog-2.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/prompts/codex-handoff-2026-10-27-deletion-retention.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/prompts/codex-handoff-2026-10-27-final.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/prompts/codex-handoff-2026-10-27-wave2.md` — wave instruction
- `??` `tasks/prompts/codex-handoff-2026-10-27-wave3.md` — wave instruction
- `??` `tasks/prompts/codex-handoff-2026-10-27-wave4.md` — wave instruction
- `??` `tasks/prompts/codex-handoff-2026-10-28-wave5.md` — present at wave 5 start; earlier wave or historical uncertain

### Session lifecycle, deletion and restore

Commit the cumulative session lease, recycling, trash and restore implementation, tests, and associated cards together because these files overlap.

- ` M` `apps/cli/src/cli.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/cli/src/cli.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/cli/src/i18n.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/cli/src/i18n.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/cli/src/migrate.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/agents/src/external/ExternalAgentRuntime.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/application/src/index.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/engine/src/LoopEngine.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/engine/src/workspace.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/engine/src/workspace.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/runtime/src/sandbox/backend/isolated-directory.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/shared/src/index.ts` — present at wave 5 start; earlier wave or historical uncertain
- `??` `apps/local-server/src/daemon/daemonRecycle.posix.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/local-server/src/daemon/daemonLifecycle.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/local-server/src/daemon/daemonLifecycle.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/local-server/src/server.test.ts` — before wave 2 through wave 5
- ` M` `apps/local-server/src/server.ts` — before wave 2 through wave 5
- ` M` `packages/application/src/session/SessionRegistry.test.ts` — before wave 2 through wave 5
- ` M` `packages/application/src/session/SessionRegistry.ts` — before wave 2 through wave 5
- `??` `apps/cli/src/commands/trashCommand.test.ts` — before wave 2 through wave 5
- `??` `apps/cli/src/commands/trashCommand.ts` — before wave 2 through wave 5
- `??` `docs/DELETION-AND-RETENTION.md` — before wave 2 through wave 5
- `??` `packages/application/src/deletion/trash.escape.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- `??` `packages/application/src/deletion/trash.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- `??` `packages/application/src/deletion/trash.ts` — present at wave 5 start; earlier wave or historical uncertain
- `??` `packages/shared/src/deletion/recycle.test.ts` — present at wave 5 start; earlier wave or historical uncertain
- `??` `packages/shared/src/deletion/recycle.ts` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/343-unify-recycle-primitive.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/344-f6-runtime-delete-ownership.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/345-app-trash-and-retention.md` — before wave 2 through wave 5
- `??` `tasks/346-deletion-retention-closeout.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/357-trash-http-readonly.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/358-daemon-trash-tick.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/core/src/session/Session.test.ts` — wave 2 plus possible earlier
- ` M` `packages/core/src/session/Session.ts` — wave 2 plus possible earlier
- ` M` `packages/core/src/session/SessionLease.test.ts` — wave 2 plus possible earlier
- `??` `tasks/353-session-append-lease-bypass.md` — wave 2 plus possible earlier

### Provider parity

Commit provider parity isolation and its task records.

- ` M` `apps/local-server/src/routes/profileParity.test.ts` — wave 2
- `??` `tasks/350-profile-parity-isolation.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/350c-profile-parity-exit2.md` — wave 2

### Web npm build

Commit the web build command adjustment with its task card.

- ` M` `apps/web/package.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/341-web-build-command-npm12.md` — present at wave 5 start; earlier wave or historical uncertain

### Web stop, diff and status UX

Commit the cumulative conversation scrolling, read-only changes display, status UI and related tests together.

- ` M` `apps/web/src/components/ConversationView.interaction.test.tsx` — wave 3 plus possible earlier
- ` M` `apps/web/src/components/ConversationView.tsx` — wave 3 plus possible earlier
- ` M` `apps/web/src/components/StatusBar.tsx` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/web/src/components/layout/DualSurfaceLayout.test.tsx` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `apps/web/src/i18n.ts` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `packages/application/src/compose.test.ts` — wave 3 plus possible earlier
- ` M` `packages/application/src/compose.ts` — wave 3 plus possible earlier
- `??` `apps/web/src/components/StatusBar.test.tsx` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/342-status-bar-cold-load-flash.md` — present at wave 5 start; earlier wave or historical uncertain

### Historical design documentation

Commit the historical design and planning documents after reviewing their contents; exact provenance is uncertain.

- ` M` `docs/DESIGN.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/MAGPIE-ABSORPTION.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/VESSEL_Architecture_Review_and_Execution_2026-10-20.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/VESSEL_UI_UX_Review_and_Execution_2026-10-20.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/design-prototypes/FEATURE-COVERAGE.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/design-prototypes/IMPLEMENTATION-PLAN.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `docs/design-prototypes/NEW-CONVERSATION-PROMPT.md` — present at wave 5 start; earlier wave or historical uncertain

### Board and task reconciliation

Commit the cumulative board index and task-card reconciliation as one group because the index spans cards.

- ` M` `tasks/071-windows-sandbox-backend.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/119-safety-scenario-falsifiable-criteria.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/149-live-baseline-blocked.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/170-adaptive-compaction-and-overflow-recovery.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/171-mcp-process-tree-job-object-and-lazy-proxy.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/172-agent-teams-dag-orchestration-and-route-snapshots.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/173-session-streaming-and-multiframe-zstd-eval.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/174-epic-industrial-resilience-and-teams-mesh.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/175-visual-team-dag-canvas-and-staged-approval.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/176-headless-daemon-and-tray-resilience.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/177-tool-self-healing-and-bounded-output.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/178-sqlite-wal-session-index-and-fts5-search.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/179-epic-universal-team-workspace-and-daemon-mesh.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/180-os-native-sandboxing-and-restricted-tokens.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/181-evolving-knowledge-graph-and-hybrid-memory.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/183-epic-hardened-runtime-and-cognitive-memory.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/196-evaluator-red-green-reproduction-gate.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/217-event-projection-contracts-and-compaction-conservation.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/248-taste-workbench-elevation.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/249-adversarial-audit.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/250-session-completion-and-credential-binding.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/251-compaction-keepid-and-ime-hardening.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/252-effect-journal-torn-tail-and-lease-rollback.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/253-browser-verification.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/254-browser-audit-remediation.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/258-false-completion-signal.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/259-delete-stage-consistency.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/260-browser-runtime-acceptance.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/261-browser-fix-delete-recycle.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/262-browser-fix-multiline.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/263-browser-fix-terminal-history.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/264-browser-fix-activity-cancellation.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/265-browser-fix-initial-focus.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/266-browser-fix-mock-preset.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/267-browser-fix-english-residuals.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/268-ui03-workspace-drafts.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/269-ui07-effective-policy.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/270-ui09-tool-details-stop.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/271-arch06-session-stream-recovery.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/272-arch01-run-outcome-evidence.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/273-compaction-provenance-performance.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/274-arch09-reliability-fixture-loop.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/275-ui-final-acceptance.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/278-effect-outcome-classification.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/279-cli-effects-reconcile.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/281-arch07-posix-fallback-decision.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/332-codex-lanes-plan.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/334-execution-order.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/README.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/_missions/mission-02/M1-residual-wording.md` — present at wave 5 start; earlier wave or historical uncertain
- ` M` `tasks/_missions/mission-02/W4-repair-comment-367.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/340-board-backlog-closeout.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/354-board-reconcile-170-183.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `tasks/355-stale-cards-reconcile.md` — present at wave 5 start; earlier wave or historical uncertain

### Pricing upgrade comparison

Commit price comparison tooling and its related task records.

- ` M` `tasks/323-pricing-value-guard.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `scripts/pricing-upgrade-diff.mjs` — waves 2–4
- `??` `scripts/pricing-upgrade-diff.test.mjs` — waves 2–4
- `??` `tasks/356-pricing-value-guard-docs.md` — waves 2–4

### Browser and execution evidence

Commit the browser captures and execution evidence as one evidence bundle after checking artifact suitability.

- `??` `evidence/sessions/2026-10-26-iab-acceptance/01-conversation-918-default-en.png` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-26-iab-acceptance/02-workbench-360-light-en.png` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-26-iab-acceptance/03-workbench-768-light-en.png` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-26-iab-acceptance/04-workbench-1024-light-en.png` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-26-iab-acceptance/report.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-1920-pair-left.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-1920-pair-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-1920-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-en-dark-1440.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-en-light-1440.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-four-after-reload.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-running.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-terminal-states.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-zh-dark-768.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-zh-light-1024.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-zh-light-1920.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/activity-zh-light-360.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/artifacts.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-1920-pair-left.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-1920-pair-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-1920-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-en-dark-1440.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-en-light-1440.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-zh-dark-768.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-zh-light-1024.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-zh-light-1920.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/conversation-zh-light-360.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-composer-focus.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-confirm-focus.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-delete-focus.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-focus-audit.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-focus-indicator-ancestors.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-inspector-focus.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-length-after.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-length-after.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-length-before.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-length-before.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-permission-blur.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-permission-focus.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-stop-failure.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-stop-failure.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-stop-final.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-stop-inflight.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/coordinator-stop-inflight.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/delete-locked.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/interrupted.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/keyboard-delete-focus.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/keyboard-end-to-end.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/keyboard-focus.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/long-scroll.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/metrics.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/policy-zh.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/report.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/scripted-reloaded.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/scripted-tool.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-1920-pair-left.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-1920-pair-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-1920-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-en-dark-1440.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-en-light-1440.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-en-light.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-zh-dark-768.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-zh-light-1024.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-zh-light-1920.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/settings-zh-light-360.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/stop-outage.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/tool-error.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-1920-pair-left.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-1920-pair-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-1920-right.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-en-dark-1920.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-en-light-360.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-zh-dark-360.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run2/workbench-zh-light-1920.jpg` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-pdw-halt.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-session-handoff.md` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-28-precommit-audit.md` — not in wave-start status; provenance uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R01.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R02.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R03.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R04.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R05.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R06.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R07.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R08.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R09.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R10.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R11.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R12.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R13.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/R14.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/manifest.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/process.log` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/task274-reliability-2026-10-27T02-29-18-430Z-b8dd800c/vitest.json` — present at wave 5 start; earlier wave or historical uncertain
- `??` `evidence/sessions/2026-10-27-iab-acceptance-run3/report.md` — waves 3–4
- `??` `evidence/sessions/2026-10-27-w2-e2e/PROOF.md` — waves 3–4
- `??` `evidence/sessions/2026-10-28-iab-run4/PROOF.md` — wave 5

### Windows packaging gate

Commit Windows npm probing and the stricter packaging verdict with its test and card.

- ` M` `benchmarks/runners/src/release-gates/gates.ts` — waves 4–5
- ` M` `benchmarks/runners/src/release-gates/release-gates.test.ts` — waves 4–5
- `??` `tasks/351-packaging-gate-run.md` — waves 4–5

The planned `evidence/sessions/2026-10-28-final-gate.md` is anticipated V4 evidence and was not present in this snapshot or counted; include it in the evidence group if created.

## Hygiene checks

- Repository traversal: Node 'fs.readdirSync' recursively from repository root, matching basename regex '/\.tmp(?:\.|$)/i', including ignored files and directories; excludes every '.git', 'node_modules' and '.pdw' directory, does not follow symlinks. Exit 0; 1 matching paths. `.tmp`
- Documentation scan: 'git ls-files --cached --others --exclude-standard -z' exit 0; Node scanned tracked/unignored '.md'/'.txt' under docs/, tasks/, evidence/, plus root AGENTS.md and HANDOFF.md, for Windows user/system Temp or Unix /tmp and /var/tmp absolute paths. Exit 0; 62 matching lines. These are current-tree matches, not proof introduced by this wave.
- evidence/sessions/2026-10-26-iab-acceptance/report.md:3
- evidence/sessions/2026-10-27-iab-acceptance-run2/report.md:29
- evidence/sessions/2026-10-27-iab-acceptance-run2/report.md:55
- evidence/sessions/2026-10-27-iab-acceptance-run3/report.md:11
- evidence/sessions/2026-10-27-w2-e2e/PROOF.md:8
- tasks/342-status-bar-cold-load-flash.md:44
- tasks/342-status-bar-cold-load-flash.md:45
- tasks/342-status-bar-cold-load-flash.md:46
- tasks/342-status-bar-cold-load-flash.md:47
- tasks/344-f6-runtime-delete-ownership.md:52
- tasks/345-app-trash-and-retention.md:146
- tasks/345-app-trash-and-retention.md:153
- tasks/346-deletion-retention-closeout.md:49
- tasks/346-deletion-retention-closeout.md:58
- tasks/350c-profile-parity-exit2.md:46
- tasks/351-packaging-gate-run.md:51
- tasks/351-packaging-gate-run.md:110
- tasks/353-session-append-lease-bypass.md:55
- tasks/354-board-reconcile-170-183.md:50
- tasks/355-stale-cards-reconcile.md:78
- tasks/356-pricing-value-guard-docs.md:62
- tasks/357-trash-http-readonly.md:56
- tasks/357-trash-http-readonly.md:57
- tasks/358-daemon-trash-tick.md:59
- tasks/358-daemon-trash-tick.md:60
- docs/product-evolution/EVALUATION-REPORT-03-RECHECK.md:65
- docs/product-evolution/EVALUATION-REPORT-20.md:25
- docs/product-evolution/EVALUATION-REPORT-21.md:9
- docs/product-evolution/EVALUATION-REPORT-24.md:10
- docs/product-evolution/PRODUCT-GAP-MAP.md:69
- docs/product-evolution/PRODUCT-STATE.md:609
- docs/product-evolution/PRODUCT-STATE.md:620
- evidence/missions/C5-mutation-record.md:5
- evidence/missions/C5-mutation-record.md:6
- evidence/missions/C5b-mutation-record.md:11
- evidence/missions/C5b-mutation-record.md:12
- evidence/missions/C5b-mutation-record.md:29
- evidence/missions/C5b-mutation-record.md:213
- evidence/missions/M2-W1-mutation-record.md:10
- evidence/missions/M2-W3b-repair-record.md:22
- evidence/pdw-migration-1.3.1/validation/isolated-dir.txt:1
- evidence/pdw-migration-1.3.1/validation/pdw-selftest-isolated-run1.txt:11
- evidence/pdw-migration-1.3.1/validation/pdw-selftest-isolated-run1.txt:12
- evidence/pdw-migration-1.3.1/validation/pdw-selftest-isolated-run1.txt:13
- evidence/sessions/2026-10-15-ui-landing/bsk-functional/FINDINGS.md:88
- evidence/sessions/2026-10-23-browser-acceptance-report.md:4
- evidence/sessions/2026-10-23-browser-acceptance-report.md:116
- evidence/sessions/2026-10-23-browser-acceptance-report.md:149
- evidence/sessions/2026-10-23-browser-acceptance-report.md:157
- evidence/sessions/2026-10-23-browser-acceptance-report.md:165
- evidence/sessions/2026-10-23-browser-acceptance-report.md:171
- evidence/sessions/2026-10-23-card277-recheck.md:3
- evidence/sessions/2026-10-23-fix-wave-report.md:74
- evidence/sessions/2026-10-23-fix-wave-report.md:108
- evidence/sessions/2026-10-23-provision-sandbox-result.md:25
- evidence/sessions/2026-10-23-ui-final-report.md:5
- evidence/sessions/2026-10-23-ui-final-report.md:107
- tasks/123-ci-tsc-build-repair.md:85
- tasks/123-ci-tsc-build-repair.md:86
- tasks/275-ui-final-acceptance.md:63
- tasks/283-pdw-role-routing-single-source.md:50
- tasks/284-pdw-handover-and-index-slimming.md:45
- Added-file keyword scan: Node read 138 status-added/untracked files (binary files skipped), regex '/apiKey|sk-|Bearer|secret/i', exit 0; 24 matching lines; 0 unread files. Only path, line, and keyword type are recorded; no matching values are printed. Keyword presence alone is not evidence of an actual credential. The 24 hits include 14 from the prior version of this audit report itself (its search terms, path listings and findings) and 10 elsewhere. The 10 other matches were classified as eight task-word substrings, one repository path and the prompt’s literal search pattern; no actual credential was identified in these matches. This covers the four specified keywords in text files; binary files were skipped.
- evidence/sessions/2026-10-28-precommit-audit.md:127 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:352 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:370 [apiKey, sk-, Bearer, secret]
- evidence/sessions/2026-10-28-precommit-audit.md:371 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:372 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:373 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:374 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:375 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:376 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:377 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:378 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:379 [sk-]
- evidence/sessions/2026-10-28-precommit-audit.md:380 [apiKey, sk-, Bearer, secret]
- evidence/sessions/2026-10-28-precommit-audit.md:385 [sk-]
- tasks/340-board-backlog-closeout.md:40 [sk-]
- tasks/340-board-backlog-closeout.md:44 [sk-]
- tasks/341-web-build-command-npm12.md:105 [sk-]
- tasks/341-web-build-command-npm12.md:111 [sk-]
- tasks/341-web-build-command-npm12.md:134 [sk-]
- tasks/341-web-build-command-npm12.md:138 [sk-]
- tasks/341-web-build-command-npm12.md:144 [sk-]
- tasks/341-web-build-command-npm12.md:145 [sk-]
- tasks/354-board-reconcile-170-183.md:80 [sk-]
- tasks/prompts/codex-handoff-2026-10-28-wave5.md:165 [apiKey, sk-, Bearer, secret]


Not done: V4 has not started; binary files and credential patterns outside the four requested keywords were not scanned. No command was refused. No deletion, stage, commit, push, branch, source fix, or agent CLI invocation.

Wave-start TEMP comparison: `node -` (read-only text-line multiset comparison) exit 0. Card 275: 1 baseline / 1 current / 0 introduced; card 345: 2 / 2 / 0; card 351: 2 / 2 / 0. HANDOFF and tasks/README: 0 / 0 / 0. Of 38 files with matching lines in this scan, hash comparison to `files.json` found 35 unchanged and 3 changed; for other changed files the hash-only baseline cannot identify whether individual matching lines are new. Total current matching lines: 62, so the no-absolute-TEMP criterion is not clean.

`.tmp` is a repository-root directory, creation time 2026-10-07 14:11:57 UTC and last write 2026-10-24 02:37:22 UTC. The ignored directory does not appear in the wave-start status/hash inventory, so these metadata suggest it predates wave 5 but do not prove its presence at the baseline snapshot. It was not deleted.

Commands: `node %TEMP%/vessel-v5-audit.cjs` exit 0; `node %TEMP%/vessel-v5-groups.cjs` exit 0; `node -` baseline comparison exit 0; `Get-Item -Force .tmp | Format-List FullName,Attributes,CreationTimeUtc,LastWriteTimeUtc,Length` exit 0. The scratch scripts reside in system TEMP. During initial preparation, `node %TEMP%/vessel-v5-audit.cjs` exited 1 three times with respectively `SyntaxError: Unexpected identifier`, `SyntaxError: missing ) after argument list`, and another `SyntaxError: missing ) after argument list`; a Python scratch-edit command exited 1 with `UnicodeDecodeError: gbk codec can't decode byte`. Corrections were limited to the scratch script. No command was refused.
