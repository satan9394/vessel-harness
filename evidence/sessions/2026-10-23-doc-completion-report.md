# Vessel specification completion — 2026-10-23

| ID | 现状 | 本次动作 | 证据 | 结论 |
|---|---|---|---|---|
| ARCH-01 | 已实现 | 抽查既有状态投影 | `apps/local-server/src/routes/activityRoutes.test.ts:24`: `projects the eight-state contract: %s with separate session/run identity`; final root gate | 保留12项修复基线 |
| ARCH-02 | 已实现 | 核对规范与Topic部分失败实测 | `server.test.ts`: recycling failure/retry; `final-runtime-proof.json`, `final-topic-partial-persists-after-reload.png` | UI-01/E2E-05明确要求组删除；入口已有，补确认范围文案和浏览器证明 |
| ARCH-03 | 已实现 | 持久reconcile、四点进程崩溃恢复 | `effect-recovery.test.ts`: `recovers a real policy/executor process exit at %s through SessionController and explicit reconcile`; journal/server tests | at-most-once dispatch+人工回执闭环；不宣称exactly-once |
| ARCH-04 | 部分实现 | 版本探针、版本/flags门禁、薄生命周期facade | `InteractiveAdapter.test.ts`; `docs/HARNESS-ADAPTER-CONTRACT.md` compatibility matrix | 五种CLI合成契约通过；已安装版本/live未知；resume/steer等不支持 |
| ARCH-05 | 已实现 | 目录证据过期/stale、服务端凭据身份绑定 | `providerRoutes.test.ts`: `binds test-before-save evidence on the server and never launders expired or client-forged probe timestamps`; `provider-stale-proof.json` | 元数据仍是声明；过期阳性不授予能力 |
| ARCH-06 | 已实现 | 抽查既有重连/持久历史边界 | server replay/checkpoint test; final root gate; fix-wave report ARCH-06 | 不扩称进程内审批跨进程恢复 |
| ARCH-07 | 部分实现 | 仅非沙箱权限回归 | `subagent.test.ts`, `permit.test.ts`, `TaskTreeScheduler.test.ts`; 98项联合门禁 | Windows卡256排除；POSIX fallback未修；未关闭沙箱 |
| ARCH-08 | 已实现 | 摘要hash/provenance与双compaction黄金链 | `recovery-golden.test.ts`: `conserves hashed sources, policy, pending approvals/effects, file refs and usage across two compactions, model switch and reopen` | hash损坏/authority竞态均失败关闭；不改原始权威日志 |
| ARCH-09 | 部分实现 | 针对性汇总与可运行检查 | `2026-10-23-completion-checks.ps1`; gates JSON | 448 root+483 Web；未签统一10–20场景计划/完整root全量 |
| UI-01 | 已实现 | 组删除三项部分失败/刷新/回收验证 | `final-runtime-proof.json`; `final-topic-*.png`; Sidebar test | a/c移除，b失败保留；仅系统临时夹具 |
| UI-02 | 已实现 | 抽查权威分组 | `card222.test.tsx`: `keeps failed, interrupted and cancelled activity in separate groups (%s)`; final Web gate | 保留基线 |
| UI-03 | 已实现 | 抽查并实测新建真实任务 | `TaskComposer.test.tsx:91`: workspace draft isolation; `final-runtime-proof.json` | Read→Write→Read输出核对成功 |
| UI-04 | 已实现 | 三实体详情、审批防重/权威收敛/只读说明 | `ActivityQueue.interaction.test.tsx`; `final-ui04-current-entity-details.png`, `final-ui04-current-approvals-converged.png` | team拒绝/widget批准经实际端点；subagent为明示注入fixture，无外部CLI |
| UI-05 | 已实现 | 抽查Inspector三组/键盘 | `DualSurfaceLayout.test.tsx`; `final-inspector-keyboard.json` | 800/390 Escape返回入口 |
| UI-06 | 已实现 | 配置/添加分离、隐藏焦点修复、失败即刷新 | `ProviderSettingsModal.test.tsx`; `final-modal-focus.json`; `final-provider-*.png` | 草稿保留；实际发现成功及注入503后陈旧状态可见 |
| UI-07 | 已实现 | 抽查staged/active边界 | fix-wave UI-07: `reads the bound policy and source hashes without activating candidates or rereading changed files` | 不重做既有审计 |
| UI-08 | 已实现 | 抽查旧配置/占位清理 | `uiModules.test.ts`: `recovers from corrupt/partial persisted JSON and filters out dead placeholders` | 保留基线 |
| UI-09 | 已实现 | 抽查已有真实密集工具/Stop，补Diff实际接受 | fix-wave UI-09 24工具证据; `final-diff-accepted-1440-light-en.png`, `final-runtime-proof.json` | 无扩大为同一会话完整E2E录屏 |
| UI-10 | 部分实现 | 120格真实截图/几何/对比度、24次Observer计时 | `matrix-accepted.json`, `performance-accepted.json`; final keyboard JSON | 130.9–280.5ms；真实150/200%缩放仍未验证；非完整WCAG认证 |
| DOD-GATES | 部分实现 | 最终定向汇总 | `2026-10-23-doc-completion-gates.json`: 七门exit0 | 用户禁止test:all；不签完整root全量 |
| DOD-REVIEW | 部分实现 | 独立source/UX复核与修复复验 | `2026-10-23-doc-completion-source-review.md`, `2026-10-23-doc-completion-ux-review.md` | source scoped PASS；UX七项修复scoped accepted，见下方签收记录；完整DoD仍受范围限制 |
| DOD-E2E | 部分实现 | 历史证据抽查+本轮运行时/浏览器证据 | 下方逐场景表 | 未将截图矩阵冒充14条全覆盖 |
| DOD-SAFETY | 部分实现 | 保护目录/临时夹具/凭据扫描 | gates JSON及最终边界文件 | 本轮权限守卫通过；平台沙箱全覆盖未签 |
| DOD-HANDOFF | 已实现 | 本报告+检查脚本+回滚/残余指针 | 下方交接段；source/UX报告 | 依用户要求不更新tasks/HANDOFF；报告承接交接 |

## Final individual DoD classification

每项与两份规范原顺序一一对应。已实现仅指该行验收内容，不能替代整份规范签收。

| ID | 现状 | 本次动作 | 证据 | 结论 |
|---|---|---|---|---|
| A-DOD-01 | 已实现 | 状态来源抽查 | ARCH-01 RunObservation测试 | 八态有来源 |
| A-DOD-02 | 已实现 | 部分回收实测 | ARCH-02/`final-runtime-proof.json` | 索引与目录一致 |
| A-DOD-03 | 已实现 | 四点崩溃/reconcile | ARCH-03进程退出测试 | 未知旧key不重放 |
| A-DOD-04 | 部分实现 | 区分benchmark/interactive与版本证据 | ARCH-04矩阵/测试 | 未安装版本认证，不支持全部交互能力 |
| A-DOD-05 | 已实现 | 目录与证据一致性 | presets data/provider tests | 单一来源/一致性测试保留 |
| A-DOD-06 | 部分实现 | 非沙箱权限测试 | ARCH-07 | 平台fallback/Windows边界未签 |
| A-DOD-07 | 已实现 | replay/checkpoint抽查 | ARCH-06 server tests | 延续已验证边界 |
| A-DOD-08 | 部分实现 | build/types/定向root+完整Web | gates JSON | test:all按指示不跑 |
| A-DOD-09 | 部分实现 | 独立复核留痕 | 两份review报告 | scoped结论，不签架构全部完成 |
| U-DOD-01 | 已实现 | 唯一导航抽查 | Sidebar tests/矩阵 | 四区可达 |
| U-DOD-02 | 已实现 | 真实任务/ready标记 | TaskComposer tests/runtime proof | 模型加载前不标ready |
| U-DOD-03 | 已实现 | Topic部分失败/刷新 | final-topic PNG/runtime proof | 不假隐藏失败项 |
| U-DOD-04 | 已实现 | 八态/取消分组抽查 | ARCH-01/UI-02 tests | 不静止即成功 |
| U-DOD-05 | 已实现 | 实体详情/决策端点 | UI-04 tests/PNG | 无幽灵会话 |
| U-DOD-06 | 已实现 | 三组八项/键盘抽查 | DualSurfaceLayout tests/keyboard JSON | 保留专业能力 |
| U-DOD-07 | 已实现 | Provider动线/安全/发现 | UI-06+ARCH-05测试与PNG | 已配置与添加分离 |
| U-DOD-08 | 已实现 | staged/active抽查 | UI-07既有测试 | 未把验证当激活 |
| U-DOD-09 | 已实现 | 占位配置抽查 | uiModules tests | 保留基线 |
| U-DOD-10 | 已实现 | 关键宽度双主题/双语言 | matrix-accepted.json全部120格 | 几何/采样对比度通过；缩放另列UI-10残余 |
| U-DOD-11 | 部分实现 | 逐场景证据对照 | 下方E2E表 | OS IME/同会话完整录屏等未闭合 |
| U-DOD-12 | 部分实现 | 独立签收/可回滚 | source/UX报告与回滚段 | 仅范围内签收，不扩大完整DoD |

## Entry gap matrix (recorded before implementation; historical baseline)

| ID | 现状 | 本次动作 | 证据 | 结论 |
|---|---|---|---|---|
| ARCH-01 | 已实现 | 抽查，不重做 | `RunObservation` / `projects the eight-state contract: %s with separate session/run identity`; fix-wave report §ARCH-01 | 保留已验证基线 |
| ARCH-02 | 已实现 | 抽查；核对组删除 | `server.test.ts` / `reports recycling failure and retains the session for a successful retry`; `Sidebar.tsx:252` 已按 Topic 传全部 session IDs | Topic 批量删除已存在；规范 UI-01/E2E-05 明确要求 |
| ARCH-03 | 部分实现 | 第4步：生产执行恢复/reconcile | `EffectJournal.ts:50` pending；`fault-injection-gate.test.ts` | 待实施/验证 |
| ARCH-04 | 部分实现 | 第5步：版本探针/矩阵 | `shared/src/runtimeAdapter.ts`; conformance report §ARCH-04 | 待实施/验证；不得擅跑外部 CLI |
| ARCH-05 | 部分实现 | 第6步：过期与 stale | `providers/presets.data.test.ts`; `providerRoutes.test.ts`; conformance report §ARCH-05 | 待实施/验证 |
| ARCH-06 | 已实现 | 抽查，不重做 | `replays a disconnected session cursor and checkpoints messages, usage and resolved approvals without cross-session frames`; fix-wave report §ARCH-06 | 进程内窗口及持久历史边界见基线，不扩称审批跨进程恢复 |
| ARCH-07 | 部分实现 | 仅非 Windows 沙箱启动部分 | `platformSandbox.test.ts` / `audits unavailable helper fallback, and awaits the audit sink`; `TaskTreeScheduler.test.ts` | POSIX helper fallback 待修；Windows 卡256明确排除 |
| ARCH-08 | 部分实现 | 第7步：摘要 hash/黄金链路 | `conservation-golden.test.ts`; `Compaction.ts`; conformance report §ARCH-08 | 待实施/验证 |
| ARCH-09 | 部分实现 | 汇总针对性门禁与 fixture 覆盖 | conformance report §ARCH-09；本次不运行 test:all | 完整双 root 门禁按用户边界不签全量 |
| UI-01 | 已实现 | 抽查现有 Topic 动线 | `Sidebar.tsx:252`; fix-wave report 第一波1；既有逐项失败与重试测试 | 保留基线，补组删除浏览器证据 |
| UI-02 | 已实现 | 抽查 | `keeps failed, interrupted and cancelled activity in separate groups (%s)`; fix-wave report 第一波4/ARCH-01 | 保留基线 |
| UI-03 | 已实现 | 抽查 | `isolates workspace drafts, restores them after navigation and separates API clients`; fix-wave report §UI-03 | 保留基线 |
| UI-04 | 部分实现 | 第1步：三类真实详情/审批收敛 | `activity/ActivityQueue.tsx:80` 仅 title/project；`card222.test.tsx` / `guards session navigation strictly to session kinds and folds completed items (UI-04)` | 待实施/验证 |
| UI-05 | 已实现 | 抽查 | `maps all 8 tabs to their respective 3 responsibility groups`; `DualSurfaceLayout.test.tsx` | 保留基线 |
| UI-06 | 部分实现 | 第2步：已配置/添加分离 | `ProviderSettingsModal.tsx:215` 起列表与表单同时渲染 | 待实施/验证 |
| UI-07 | 已实现 | 抽查 | `reads the bound policy and source hashes without activating candidates or rereading changed files`; fix-wave report §UI-07 | 保留基线 |
| UI-08 | 已实现 | 抽查 | `recovers from corrupt/partial persisted JSON and filters out dead placeholders`; `uiModules.test.ts` | 保留基线 |
| UI-09 | 已实现 | 抽查 | `reports Stop failures, blocks duplicate Stop requests and retains the active draft for retry`; fix-wave report §UI-09 | 保留基线 |
| UI-10 | 部分实现 | 第3步：补指定矩阵/PerformanceObserver | fix-wave report 独立无法验证项；规范 §3 UI-10 | 待测；150%/200%须真实浏览器缩放 |
| DOD-GATES | 部分实现 | 最后源码编辑后针对性汇总 | fix-wave report 最终六项门禁；用户禁止 test:all | 不签完整全量门禁 |
| DOD-REVIEW | 部分实现 | 第8步：独立源码/UX复核 | 规范架构 §9、UI §11 | 待复核签收，不自签 |
| DOD-E2E | 部分实现 | 合并历史证据及本轮真实验证 | UI §6 E2E-01..14；fix-wave report 真实模型及恢复证据 | 逐场景记录，不扩大历史截图结论 |
| DOD-SAFETY | 部分实现 | 保护目录/临时夹具/沙箱边界复核 | 用户硬约束；规范架构 §9 | Windows沙箱未闭合，不签平台全覆盖 |
| DOD-HANDOFF | 部分实现 | 本报告交接与回滚指针 | 用户禁止更改 tasks/、HANDOFF.md | 以本报告接续，旧文档不冒充已更新 |

## Baseline and execution contract (written before implementation)

HEAD `46b7291188db6f95303683a8016d5434b252d142`; initial `git status --short` empty. Source reports: `2026-10-23-fix-wave-report.md` (12 completed fixes), `2026-10-22-doc-conformance-report.md` (19-item audit). Both 2026-10-20 specifications read. This is delta completion, not a repeated audit.

Order: UI-04 → targeted tests → UI-06 → targeted tests → UI-10 browser/performance → ARCH-03 → targeted tests → ARCH-04 → targeted tests → ARCH-05 → targeted tests → ARCH-08 → targeted tests → independent review/handoff → aggregate gates. Non-sandbox ARCH-07 and required Topic batch evidence are included without touching Windows sandbox startup. Scope excludes packages/core, tasks/, HANDOFF.md, commits/push, full test:all, real user sessions and external agent CLI execution. Runtime model fixed to commandgota-real / deepseek/deepseek-v4.1-flash, credentials loaded by scripts/use-env.ps1 without printing them. Fixtures only under system temp.

### Individual specification DoD checklist at entry

Architecture §9: A-DOD-01 state provenance **已实现** (ARCH-01 tests); A-DOD-02 per-item deletion **已实现** (ARCH-02/Sidebar); A-DOD-03 four crash boundaries **部分实现** (ARCH-03); A-DOD-04 versioned adapters **部分实现** (ARCH-04); A-DOD-05 catalog parity **已实现** (`presetsData.test.ts`); A-DOD-06 policy/sandbox **部分实现** (ARCH-07); A-DOD-07 replay **已实现** (ARCH-06); A-DOD-08 final full gates **部分实现** (test:all excluded); A-DOD-09 independent review **部分实现** (DOD-REVIEW).

UI §11: U-DOD-01 one navigation **已实现** (`Sidebar.test.tsx`); U-DOD-02 task start **已实现** (`TaskComposer`/fix-wave UI-03); U-DOD-03 partial deletion **已实现** (server/Sidebar existing tests; browser batch pending); U-DOD-04 true activity **已实现** (ARCH-01/UI-02); U-DOD-05 entity routing/approval **部分实现** (UI-04); U-DOD-06 inspector **已实现** (`DualSurfaceLayout.test.tsx`); U-DOD-07 provider split **部分实现** (UI-06); U-DOD-08 staged/active **已实现** (UI-07); U-DOD-09 placeholders **已实现** (`uiModules.test.ts`); U-DOD-10 widths/themes/languages **部分实现** (UI-10); U-DOD-11 E2E-01..14 **部分实现** (DOD-E2E); U-DOD-12 source/UX signatures **部分实现** (DOD-REVIEW).

## Execution evidence (sequential implementation gates)

### Incomplete at entry (historical snapshot) UI-04, UI-06, UI-10, ARCH-03/04/05/07/08/09 and cross-cutting DoD above. This section will be updated only from observed evidence. No claim of full completion.

### UI-04 implementation gate
- Added whitelist entity DTOs from existing team/subagent/goal sources. Team task titles/statuses, subagent provider/times/error and goal acceptance are available inline; no entity ID is treated as a session ID.
- Team decisions use existing approve/reject endpoints. Widget/team decisions synchronously block duplicate submissions and await authoritative Activity refresh before showing the receipt. Missing response transport disables buttons; rejection preserves the pending row.
- New tests: `projects actual team tasks, subagent execution and goal acceptance into distinct details`; `keeps team approval pending until the server refresh converges and blocks duplicate decisions`; `retains actionable approval on backend rejection and disables transportless decisions`.
- Targeted backend: 44 passed, exit 0 (`2026-10-23-completion-ui04-backend.log`). Web: 15 passed, exit 0 (`2026-10-23-completion-ui04-web.log`). Browser evidence follows UI-10. Additive optional DTO; rollback only this report's code diff, no data migration.

### UI-06 implementation gate
- Separate configured/add views; default configured, explicit preset opens add. Hidden views retain drafts and remain outside layout/accessibility tree. Shared error feedback remains visible in both views. Existing direct saved-key testing remains one click. Fixed the remaining hard-coded direct-test copy.
- New test: `opens configured providers, separates adding and preserves the draft when navigating back`.
- Provider hub/settings/catalog: 33 passed, exit 0 (`2026-10-23-completion-ui06-web.log`). Web and backend builds exit 0. No credential/protocol migration.

### UI-10 measured gate (partial, zoom remains unverified)
- Built current product, isolated fixture server port 3017 after availability check. All registries/state in system temp; provider secret held in memory, loaded with `. .\scripts\use-env.ps1`. Fresh real request used commandgota-real / deepseek/deepseek-v4.1-flash, Read→Write→Read verified completion-proof.txt; model's extra Shell was denied by existing policy, visibly retained. No sandbox changes.
- 120 exact-viewport PNG cells: 390×844, 800×900, 1180×900, 1440×900, 1920×1080, 2560×1440 × dark/light × zh/en × launcher/conversation/Activity/configured/add. `2026-10-23-doc-completion/matrix-exact.json` records geometry; all document/body scroll widths equal viewport. Original IAB capture returned host-panel-scaled pixels, detected by image dimensions; final matrix files recaptured with Page.captureScreenshot explicit clip. Earlier matrix.json is diagnostic only; matrix-exact.json was intermediate; matrix-accepted.json below is final acceptance source.
- Added one User Timing mark `vessel:task-ready`, emitted at first rAF after project/health/model are ready. PerformanceObserver buffered mark measurement: initial desktop 217.8ms; five repeated mobile warm reloads 170.8/187.1/159.3/153.0/165.2ms. Definition and paint/navigation entries in `performance-observer.json`; observed <500ms on these samples only, not a universal SLA or standardized browser TTI.
- Navigation drawer and Commands at 390: open→Tab/Shift+Tab→Escape, focus returns to opener; evidence `keyboard-zoom.json`, `command-palette-390-light-en.png`.
- 150%: three Control_L+plus, desktop innerWidth=1440, DPR≈1, visualViewport.scale=1 unchanged. 200%: five Control_L+equal at 390, same unchanged metrics; reset Control_L+0. No exposed real browser zoom API; Page.addScriptToEvaluateOnNewDocument also unsupported. Pinch scaling or viewport narrowing is not accepted as browser zoom. Keep both zoom checks unverified.
- TaskComposer targeted tests: 12 passed, exit 0 (`completion-ui10-focused.log`); Web build exit 0. Full WCAG/approval/Diff execution-state coverage requires further review; no full UI-10 closure claimed yet.

### ARCH-03 implementation gate
- Real production path remains application compose → PolicyEngine permit → Executor.beforeDispatch → EffectJournal intent fsync → authority.consume → execute → outcome fsync → projection. No core edits or parallel loop.
- Journal adds explicit operator reconciliation (`key`, `attempt`, canonical invocation hash, applied/not_applied, bounded evidence), persisted append+fsync. Reconciled keys remain prohibited from replay; new writes can proceed. Read retries retain only latest pending attempt. Semantic corruption/orphan/out-of-order records fail closed, torn-tail repair remains confined to syntax-torn final bytes.
- SessionController exposes pending receipt DTOs (no raw tool arguments) and idle-only reconcile. GET/POST `/api/sessions/:id/effects` uses existing origin/auth boundaries; invalid/stale receipts 409. The receipt is an operator attestation, not automatic proof that an external effect occurred. No exactly-once claim.
- New four-case test `recovers a real policy/executor process exit at %s through SessionController and explicit reconcile`: child Node (not an agent CLI) exits 73 before intent / after intent / after effect / after outcome before projection; disk counter never repeats the old key, same-session reopen sees pending, tampered receipt fails, operator resolves, later write and normal turn resume. Existing permit tests cover expiry, parameter/subject/scope changes and replay. New journal tests cover receipt conflicts/idempotence and reordered records. HTTP test `exposes unknown effects for operator reconciliation, rejects stale identity and persists the receipt on reopen` covers production endpoint and cross-origin 403.
- Gate: 5 files, 34 passed, 52 deliberately filtered/skipped, exit 0 (`2026-10-23-completion-arch03-accepted.log`). Build exit 0. Final aggregate will run these complete affected files without the name filter. Tests use only self-created system-temp roots.
- Compatibility: old intent/outcome format retained, additive reconciliation record. Rollback requires retaining journals with new records; use this version to inspect/resolve them before older binaries. Do not delete journals or retry an unknown write to roll back.

### ARCH-04 implementation gate
- Added `ExternalInteractiveAdapter` implementing the existing shared lifecycle contract over `ExternalAgentRuntime.execute`; no second loop. Unsupported resume/steer/events/approvals/artifacts have no executable methods. Scope mapping remains read-only and rejects arbitrary allowedTools/options. Cancel aborts the existing runtime signal and awaits its cleanup/result before returning.
- Explicit probe runs bounded shell-free `--version` and configured `--help`, records actual parsed externalVersion, adapterVersion, transformVersion, platform, time and evidenceSource. Start is gated by exact reviewed versions plus flags present in help; missing versions remain unknown, unreviewed versions explicitly unsupported/degraded. Merely finding a binary does not certify compatibility. Probe is not run at import/discovery.
- Five-runtime matrix (codex/opencode/dsh/claude-code/pi): start/cancel are **unknown on this machine**, pending separately authorized probes and exact-version evidence; events/steer/resume/approvals/artifacts unsupported by this CLI-result facade. Tests use synthetic `1.2.3` command output for each runtime, explicitly not installed-version evidence. No external agent CLI was launched.
- Tests: `records %s version/platform/source and degrades unknown versions or absent flags` (five runtimes); `awaits the existing runtime cleanup on cancel, rejects scope widening and never exposes unsupported resume`; existing benchmark contracts unchanged. 23 passed, exit 0 (`2026-10-23-completion-arch04-focused.log`). Actual external process cleanup remains covered by existing isolated runtime tests, included in final targeted gate; actual installed CLI compatibility remains unverified, not claimed fully compatible.

### ARCH-05 implementation gate
- Persisted bounded catalog receipts (last verification, expiry, last attempt/error, observed model IDs). Configured Provider cards distinguish unknown/fresh/stale/expired and list disappeared saved model IDs. Failed discovery retains credentials, endpoints, saved model list and previous capability evidence. Successful discovery clears error but does not silently remove old configured models.
- Metadata capabilities remain **declared**, with `provider_metadata` origin and observation/expiry times; `/models` does not prove tool behavior. Client-supplied evidence remains normalized to declarations. Runtime capability negotiation refuses expired positive evidence instead of treating it as supported. UI labels expired evidence in both languages.
- Tests: `expires catalog evidence, retains verified configuration after failure and marks disappeared models stale`; `does not grant a required capability from expired metadata evidence`; `labels expired model metadata without presenting it as fresh support in %s`. Backend/catalog/LLM 57 passed exit 0; Web provider/capability/catalog 37 passed exit 0 (`completion-arch05-backend.log`, `completion-arch05-web.log`). Existing catalog parity remains intact. New fields optional; no credential migration.

### ARCH-08 implementation gate / ARCH-07 non-sandbox check
- Dedicated SHA-256 summary receipt binds summary text and schema-versioned provenance: immutable source hash/range/event refs, policy rule/source refs, pending effect/approval refs, important tool file paths. Replay validates source and summary hashes. Legacy commits without receipts remain readable. Summaries remain historical user-level context, never authorization.
- Actual compose wires loaded policy sources/rules and EffectJournal pending writes; server wires actual WidgetRoutes pending approvals. Authority changes while summarizing reject publication. Original session/usage/journal remain authoritative and append-only.
- New tests: `conserves hashed sources, policy, pending approvals/effects, file refs and usage across two compactions, model switch and reopen`; `fails compaction safely when pending authority changes during summarization`. 24 tool pairs, two compactions, Provider/model switch, source/summary corruption, persistent usage totals covered. Cache dependency tests retain model/provider invalidation checks. Synthetic metadata is test evidence, not a new real billing benchmark.
- First ARCH-08 gate: 73 passed exit 0. Non-sandbox subagent regression caught optional undefined fields in in-memory records; fixed canonical source hashes to use exact persisted JSON representation, kept failure log. Combined gate: 11 files / 98 passed exit 0 (`completion-arch08-arch07-accepted.log`).
- ARCH-07 scope is **non-sandbox only** per user. Existing child-tool filtering and shared policy, parent∩preset∩global scope, approval denial and permit revocation pass. No platform sandbox code or settings changed. POSIX helper fallback and Windows card256 remain explicit platform limits; they are not silently closed by these tests.
- Rollback: new hash/provenance fields are additive, old readers ignore them; retaining logs preserves original evidence. New readers reject mismatched hashed commits rather than silently consuming a changed summary.


## Final accepted browser evidence and review repairs

Final acceptance source is `2026-10-23-doc-completion/matrix-accepted.json`, not earlier matrix/exact/final diagnostic generations. All120 PNG dimensions match the stated viewport. All120 have document overflow0, checked child containment failures0 and sampled visible-text contrast failures0. This is a sampled rendered-text check, not complete WCAG certification. Independent UX review states which images were visually inspected; it does not pretend every interactive control in120 cells was exercised.

24 buffered PerformanceObserver records are in `performance-accepted.json`: state-ready rAF marks130.9–280.5ms. A rAF callback can precede paint. Using max(mark, observed first-contentful-paint), the measured visible/state-ready lower bound is **148.0–280.5ms**,24 samples (`performance-visible-summary.json`). This meets the requested <500ms observation on this local fixture only. It is not standardized TTI, input latency, a cold-network SLA or proof of every asynchronous control being ready. TaskComposer requires a loaded selected model; tests cover empty and populated catalogs. No private prompt content is recorded.

Review corrections: Provider focus trap excludes hidden ancestors and both tab directions were exercised (`final-modal-focus.json`). Inspector focus return at800/390 is in `final-inspector-keyboard.json`. Activity transportless approvals have bilingual read-only feedback. Narrow composer/goal containment, disclosure marker alignment, light-success and selected-item contrast and subagent-select browser background were repaired and recaptured. Topic confirmation scope was still clipped in `final-topic-recycle-scope-confirmation.png`; **superseded by `final-topic-confirmation-readable.png`**, captured after final CSS rebuild: wrapped233px text/control region within259px sidebar. Confirmation was cancelled after capture; no extra deletion.

UI-04 browser source fixtures are explicitly labeled. Team plan was rejected through actual TeamStageRoutes; widget approval was accepted through actual WidgetRoutes, no fake file-write effect. Subagent failure is injected summary data, not a child process. `final-ui04-current-entity-details.png` and `final-ui04-current-approvals-converged.png` show current entity fields/decision state. Older `final-runtime-proof.json` describes an earlier fixture-server generation; `seed-entities.json` is a later generation and its team ID differs. Do not join those IDs as one stage. `final-disk-recheck.json` reconfirms real output `DOC_COMPLETION_OK`, accepted diff `after\n`, and the correct `/api/activity/runs` endpoint after fixture restart. Earlier failed rechecks were corrected rather than used as success evidence.

Provider real successful discovery and injected second-discovery503 are distinguished (`provider-stale-proof.json`, `final-provider-real-verification.png`, `final-provider-injected-stale.png`). Saved configuration/models remain. Independent negative tests exposed then closed expiry laundering after restart and alternate-key attribution; final server regression `binds test-before-save evidence on the server and never launders expired or client-forged probe timestamps` covers both. No external CLI compatibility is inferred from real model discovery.

### E2E evidence classification (not a second audit)

| Scenario | Status | Evidence and practical limit |
|---|---|---|
| E2E-01 no Provider | 部分实现 | TaskComposer empty-model regression; existing guidance retained. No new empty-profile browser sequence claimed. |
| E2E-02 task launch once | 已实现 | Existing fix-wave UI-03 proof + this round real Read→Write→Read, `final-runtime-proof.json`. |
| E2E-03 switch while streaming | 已实现 | Existing fix-wave ARCH-06 switch proof, preserved drafts/unique history; not rerun. |
| E2E-04 single deletion500 | 已实现 | Existing fix-wave first-wave1/source server retry regression; not rerun as new browser proof. |
| E2E-05 Topic partial deletion | 已实现 | a/c recycled and absent index/directory, b retained after injected index failure; final-topic partial/reload PNGs. Confirmation final readable PNG. |
| E2E-06 failure/network recovery | 已实现 | Existing fix-wave UI-09/ARCH-06 real interruption/recovery proofs; this round actual Shell policy denial and injected Provider503. Different mechanisms explicitly distinguished. |
| E2E-07 entity details | 已实现 | Three expanded source-backed fixtures plus actual team/widget decisions, final UI04 PNGs and interaction tests. No external subagent execution. |
| E2E-08 Provider test/save/model | 已实现 | Real discovery, test/save identity/expiry regression, configured/add PNGs and keyboard proof. |
| E2E-09 compile rejection | 已实现 | Existing fix-wave UI-07 verified evidence retained; no new candidate activation. |
| E2E-10 old cache preference | 已实现 | Existing Inspector migration tests/fix-wave baseline. |
| E2E-11 compact keyboard | 已实现 | Navigation/palette390; Inspector800/390; Provider modal focus JSON. Matrix supplies both themes/languages. This is scoped to documented paths. |
| E2E-12 one real dense approval+Diff flow | 部分实现 | Prior actual24-tool flow plus this round actual Diff acceptance and fixture approval are separate sessions/generations. No unified >20-tool+approval+Diff recording claimed. |
| E2E-13 native Chinese IME | 部分实现 | Existing composition/Enter/Shift+Enter tests pass; native OS IME cannot be exercised by this IAB surface. |
| E2E-14 refresh active run | 已实现 | Existing fix-wave ARCH-06 real active-refresh proof; final replay tests pass. |

### Final gates, boundaries and handoff

Runnable check: `& .\evidence\sessions\2026-10-23-completion-checks.ps1`. It runs selected affected root files and the full Web suite, never test:all or installed agent CLIs. Raw logs/command arguments/exit codes: `2026-10-23-doc-completion-gates.json` and its timestamped `gates/` folder. Initial aggregate20261023-074319: root46files/448passed, Web56files/483passed, build/test-types/web-types/root-targeted/web-tests/web-build/diff-check all exit0. Final aggregate was rerun after the last confirmation CSS/comment change; its summary supersedes the initial generation.

HEAD remains `46b7291188db6f95303683a8016d5434b252d142`. No commit/push, test:all, installed external-agent CLI, dependency install/change, packages/core, tasks or sandbox configuration edits were performed by this task. `final-boundaries.json` records current protected-product diff. Separate Harness² planning edits to HANDOFF.md and its two planning documents appeared after the first aggregate snapshot; preserved untouched. The rerunnable gate compares protected contents before/after the gate and explicitly records that concurrent baseline rather than falsely reporting repository-clean. This report is the authorized handoff; HANDOFF.md/tasks are not updated by this task.

Fixture path/port/model: `2026-10-23-completion-browser-meta.json`; only this system-temp workspace was used. Port3017 was checked free before restart. Credentials loaded using scripts/use-env.ps1, memory credential backend, never printed. `final-secret-scan.json` records literal current-secret checks over generated completion evidence and fixture; not a generalized credential detector. Final literal-secret scan:232files,1current secret value,0plaintext matches,0unreadable after stopping the fixture. Product-level source hashes and independent review snapshots are in the source-review report; assets/evidence hashes are recorded separately. No real user sessions were opened or mutated.

Rollback: inspect the uncommitted diff against the stated baseline and revert only completion-owned hunks, preserving unrelated edits. Optional DTO/catalog/hash fields require no data migration. Do not discard journals containing reconciliation records or replay unknown keys through old binaries; resolve using the current reader. Legacy compaction records remain readable; retaining original logs preserves authoritative state. Fixture data can remain for reproduction; do not permanently delete it. Do not reset the whole worktree. The fixture server served the final built Web bundle and was stopped after acceptance to release SQLite locks for the final secret scan. To reproduce, rerun the fixture with the recorded temp root after loading credentials, without reseeding recycled groups or running a new model task.


Final aggregate **20261023-122432** (after last product edit):

| Gate | Result | Exit |
|---|---|---|
| npm run build | passed | 0 |
| npm run typecheck:tests | passed | 0 |
| Web typecheck | passed | 0 |
| targeted root | 46files /448passed, no name-filter skips | 0 |
| complete Web suite | 56files /483passed | 0 |
| Web production build | passed | 0 |
| git diff --check | passed | 0 |

Protected-file content unchanged during final gate; HEAD unchanged. These results cover the selected root scope and complete Web scope, **not test:all**. SHA-256 snapshots: `final-source-hashes.json`, `final-evidence-hashes.json`. Final report-only edits after these gates do not change product behavior.

### Independent signatures

- Source: `2026-10-23-doc-completion-source-review.md`, re-review2 scoped PASS, provider evidence anti-laundering/credential-binding negative cases independently reproduced. Final bounded re-review PASS appended, independently44 Activity+43 Web tests passed; its scope excludes full-suite/platform/live compatibility certification.
- UX: `2026-10-23-doc-completion-ux-review.md`, final scoped rereview accepts all seven repairs, including the readable confirmation follow-up. Inspected files/120 dimension checks and supplied keyboard proof limits are explicit. It does not sign fullUI-10 or allE2E/native-platform acceptance.
- This is a bounded implementation/review handoff. No claim that either complete specification has passed every DoD.

## Still incomplete or unverified at handoff

| Item | State | Reason / exact next boundary |
|---|---|---|
| ARCH-04 installed-version/live compatibility | 部分实现 | Version probe and evidence gate implemented/tested synthetically for five adapters; installed CLIs not invoked. Requires separate per-call user authorization under project rules. Resume/steer/canonical streaming/approval/artifact receipts unsupported by current thin facade; no pretend methods. |
| ARCH-07 platform sandbox | 部分实现 | Only non-sandbox child tool/scope/policy/permit checks in scope. POSIX helper degraded fallback not repaired. Windows startup remains excluded card256; sandbox not disabled. |
| ARCH-09 full reliability program | 部分实现 | Targeted crash/compaction/provider/replay/browser gates delivered, but not a separately unified10–20-fixture program or complete root test suite. User explicitly prohibited test:all. |
| UI-10 true150%/200% zoom | 部分实现 | Tried desktop3×Control_L+plus and narrow5×Control_L+equal; width/DPR/visualViewport scale unchanged, resetControl_L+0. No true zoom API exposed. No viewport or bitmap substitution. |
| UI-10 exhaustive accessibility | 部分实现 |120 matrix cells + sampled visible text/keyboard repairs pass; no screen-reader/fullWCAG/all-control certification. |
| E2E-01/12/13 and U-DOD-11 | 部分实现 | No new empty-provider browser sequence; dense real task, approval and Diff evidence are separate bounded flows, not a unified recording. NativeOS IME not exercisable in this IAB. Deterministic regressions do not replace these specific browser proofs. |
| DOD-GATES/A-DOD-08 | 部分实现 | Fullroot+Web test:all explicitly excluded. Final selected-root/full-Web/build/types all passed, no full-suite claim. |
| DOD-REVIEW/A-DOD-09/U-DOD-12 | 部分实现 | Independent scoped signatures delivered; complete-spec acceptance remains limited by rows above. |

No other new implementation TODO is inferred from missing screenshots alone. Existing12fixes were sampled and retained. The final matrix deliberately leaves these rows partial; **this is not 全量完成**.

