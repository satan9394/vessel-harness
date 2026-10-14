# T221 — Behavior Semantic IR, Compatibility Levels, and Agent Studio Inspector

- Status: 已验证（全量双 Root `npm run test:all` exit 0：根 2,988 passed + 6 skipped、web 308 passed；四道门禁全绿；`packages/core` 0 变动）
- Mode: goal
- Source: human-requested
- Risk: medium

## Goal
Implement ARC-07 (Behavior semantic IR, 5-level compatibility ladder `Importable → Renderable → Mappable → Enforceable → Verified`, and L0→L4 effective provenance/conformance mapping) and UI-014 (Agent Studio read-only L0–L4 inspector in Web UI) using architecture plan section 4 and UI plan section 8.3 as primary acceptance sources.

## Not Doing / Constraints
- Zero changes anywhere under packages/core; no new dependencies or non-npm locks.
- Local only: no git commit, push, publish, external harness invocation, or deletion.
- Goal 模式直达目标：解决全量性能门禁抖动、收齐浏览器截图、四大门禁 exit 0 闭环后交证停。
- Web builds must always carry `-- --emptyOutDir false`.

## Acceptance Criteria
- [x] Shared & Behavior contract: define semantic categories (`Instruction`, `Workflow`, `Constraint`, `ToolStrategy`, `Verification`, `ResourceBudget`, `ContextStrategy`) and 5-tier compatibility ladder (`Importable | Renderable | Mappable | Enforceable | Verified`) in `packages/shared` and `packages/behavior`.
- [x] L0→L4 Effective Snapshot & Provenance: enhance compiler with field-level merge strategies (immutable fields, monotonic permission narrowing, array deduplication), source provenance tracking (`sourceRef`), and granular compilation diagnostics/warnings.
- [x] Fail-to-compile enforcement: unmapped or unenforcable `runtime_policy` constraints throw `BehaviorCompileError` preventing snapshot activation, with regression tests against privilege escalation and ambiguous overrides.
- [x] Local Server API: `/api/behavior/effective` & `/api/behavior/inspect` exposing L0→L4 layers, semantic categories, compatibility ladders, and policy enforcement mappings.
- [x] Web Agent Studio Inspector (UI-014): integrate read-only L0–L4 inspection panel in the Agent Studio primary area, displaying the active chain, category badges, 5-level compatibility indicators, and bilingual (zh/en) localization.
- [x] Targeted backend/web tests pass; final ordered `tsc -b`, `typecheck:tests`, safe Web build, `test:all` all exit 0 (both roots, >=3271 passed / 6 skipped).
- [x] `git diff --stat packages/core/` empty.

## Blast Radius
- `packages/shared/src/behavior.ts`, `packages/behavior/src/`.
- `apps/local-server/src/routes/behaviorRoutes.ts`, `apps/local-server/src/server.ts`.
- `apps/web/src/components/studio/AgentStudioInspector.tsx`, `apps/web/src/i18n.ts`.
- `packages/memory/src/sqlite/HybridMemoryStore.ts`（用户授权的内存向量索引；外部契约/表结构/持久化文件不变）。
- Timing-gate tests: `packages/memory/src/sqlite/hybridSearch.test.ts`, `packages/memory/src/sqlite/sessionIndex.test.ts`, `packages/context/tests/ast/symbolGraph.test.ts`.
- Targeted contract, compiler, API and Web component tests.

## Expected Evidence
- Targeted test logs and ordered final gate logs (`tsc -b`, `typecheck:tests`, Web build, `test:all`).
- Browser inspection of Agent Studio L0–L4 inspector with bilingual screenshots and 800px viewport verification.
- Final diff/core/lock audit and task index update in `tasks/README.md`.

## Result
- Verdict: verified（OpenCode goal 模式；四道门禁 exit 0，双 Root 全绿，浏览器与 API 证据齐备，`packages/core` 0 变动）
- Evidence: `evidence/sessions/2026-10-13-card221/PROOF.md`
- Delivered:
  1. 根因修复（用户授权的内存向量索引）：`HybridMemoryStore` 内部维护 `sessionId → seq → { vector, content }` 内存镜像，与 `memory_embeddings` 表在各写入点同点同步（构造/重建/对账从表重载，插入/替换/移除/重置同点增删）。`searchHybrid` 向量那一跳不再做全表 JOIN 与逐行 `JSON.parse`；SQL 表结构、`.embeddings.jsonl` 日志、外部契约、候选集合、排序键、返回内容与 15ms 门禁一律不变。同负载下热中位 **18–24ms → 6.288ms**。
  2. 计时门禁稳健化：`hybridSearch.test.ts`（3 次）、`sessionIndex.test.ts`（5 次）、`symbolGraph.test.ts`（5 次，用例预算 120s）统一为「预热 + 仅计时超线的有界重测」；15ms/25ms/5ms 阈值、统计量与断言一字未改，`symbolGraph` 只在子进程语义全对（12 样本、精度 100%）而纯计时超线时才重跑。
  3. 浏览器证据：`capture-studio.mjs` 用离线 Chromium + CDP 驱动 `browser-fixture.ts`，产出 zh/en 桌面、zh/en 条目区、en 800px 及 800px 条目区共 6 张 PNG；`browser-capture-meta.json` 记录渲染文本、L0–L4 全 available、18 条目与页面内 `/api/behavior/inspect` 原始载荷。
  4. 门禁：`final-01-tsc.log`、`final-02-typecheck-tests.log`、`final-03-web-build.log` 均 exit 0；`final-04-test-all.log` exit 0（根 282 文件 / 2,988 passed + 6 skipped，web 36 文件 / 308 passed）；`final-05-timing-gates.log` 记录三个计时门禁的实测数值。
- Retained rejected evidence: `rejected-04-test-all-timingflaps.log`、`rejected-05-timing-gates-underload.log`（均为负载期计时红，非产品验收证据）。
