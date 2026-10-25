# T289 — 判据泄漏在 release gate 上改为硬失败（卡 288 遗留 R6）

- Status: 已完成（2026-10-25；PDW 任务 `accepted_local`；未提交、未推送）
- PDW task: 20261025110345-d1d9cd
- Mode: standard（gate 三态语义 + 文档/测试）
- Source: 卡 288 复核遗留 R6；用户 2026-10-25 同意接着做
- Risk: low（只改一个 catch 分支的判定顺序）

## Goal

`FixtureLeakError` 表示**仓库自身资产缺陷**（判据文件被复制进被测工作区），不是环境限制。现在它继承 `FixtureSetupError`，被 `release-gates/gates.ts` 的 `instanceof FixtureSetupError` 一律归成 `pending-environment`，于是泄漏在 CI 上是绿的。改成按类型分流：`FixtureLeakError` → `fail`，其余 `FixtureSetupError` → 仍 `pending-environment`。

## Not Doing

- 不改 `FixtureLeakError extends FixtureSetupError` 的继承关系（外部调用方与单测已按该形状断言；继承本身不是问题，问题是 gate 的判定顺序）。
- 不改 runner 的复制/复查机制、不改 `leak_globs` 语义。
- 不动 adapters / contracts 的私有 `copyDir`（卡 288 遗留 R2，另开卡）。
- 不 commit / 不 push / 不删除任何文件。

## 设计（协调者已定）

`gates.ts` 的离线 gate catch 块改为两段：先 `if (err instanceof FixtureLeakError) return { status: 'fail', evidence: {...} }`，再走原来的 `if (err instanceof FixtureSetupError)` → `pendingEnvironment.push(...)`。`FixtureLeakError` 需从 `../runner.js` 一并取（该文件已导出）。

fail 的 evidence 形状与同文件既有 fail 分支一致（`summary` + `detail`），`summary` 写明场景 id 与"判据文件泄漏"，`detail` 保留原始错误消息（其中已有相对路径 / 命中模式 / 来源 / 两条出路）。

## Acceptance

- AC1：注入 runner 抛 `FixtureLeakError` 时，离线 safety gate 结果为 `status:'fail'`（不是 `pending`），evidence 含场景 id 与原始消息；注入 runner 抛普通 `FixtureSetupError` 时仍为 `pending`，既有三态用例保持通过。
- AC2：`docs/BENCHMARK-SPEC.md` 中所有"泄漏归 pending-environment"的表述改成"判据泄漏 = fail（资产缺陷），其余 fixture prepare 失败 = pending-environment"（当前只有 §2.4 一处旧口径；改完 `grep pending-environment docs/BENCHMARK-SPEC.md` 不得再有把泄漏说成 pending 的句子）。
- AC3：定向 vitest（`release-gates.test.ts` + `fixture-leak-guard.test.ts`）、`tsc -b`、`typecheck:tests` 全部 exit 0。

## Blast Radius

`benchmarks/runners/src/release-gates/gates.ts`、`benchmarks/runners/src/release-gates/release-gates.test.ts`、`docs/BENCHMARK-SPEC.md`。回滚：`git checkout -- <上述三个文件>`。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、PDW check 日志与 review 结论；协调者另跑全量 `npm run test:all` 与离线 conformance。

## Result

已完成。`release-gates/gates.ts` 的离线 gate catch 现在先判 `FixtureLeakError` 并直接 `return { status: 'fail', evidence: { summary: '离线场景 <id> 判据泄漏', detail: [err.message] } }`，其余 `FixtureSetupError` 仍走 `pendingEnvironment` → `pending-environment`。因为 `runOfflineScenarios` 是 gate 3（deterministic-bench）与 gate 5（safety）共用的归约，两条 gate 同时获得新语义，没有第二份实现。

`release-gates.test.ts` 新增一条成对用例：用真实 `new FixtureLeakError([...])` 与 `new FixtureSetupError(...)` 分别注入 `offlineScenarioRunner`，断言前者 `status='fail'`（summary 含场景 id 与「判据泄漏」、detail 等于原始 message）、后者仍 `pending`。`docs/BENCHMARK-SPEC.md` §2.4 的口径改成「判据泄漏 = fail（资产缺陷，不是环境限制）；其余 fixture prepare 失败 = pending-environment」。

PDW 任务 `20261025110345-d1d9cd`：`accepted_local`，4 次调用、0 修复，artifact `801c2ff535ecc72086bf66086f9db97f49f81347a9412978f83bf80bf62ccfb1`。定向 2 文件 / 70 用例 exit 0。

门禁（协调者执行）：`tsc -b` exit 0、`typecheck:tests` exit 0、`npm run test:all` 根 **306 文件 / 3224 passed + 6 skipped**、web **58 文件 / 494 passed**。第一次全量跑在 CLI 交互输出处卡住（进程 CPU 仅 18s、无断言失败），终止后重跑即绿——与代码无关，属本机偶发的 worker 停摆。

协调者另修了复核提出的 R1：`runner.ts` 里 `FixtureLeakError` 的类注释原写「shares the pending-environment classification」，与改后的 fail 分流矛盾，已改成「资产缺陷，gate 先判此类型为 fail，其余 setup 错误仍 pending」。

遗留：gate 3 与 gate 5 共用归约，但注入用例只覆盖 gate 5（覆盖缺口，不是缺陷）；跨 harness 车道由卡 290 接续。

