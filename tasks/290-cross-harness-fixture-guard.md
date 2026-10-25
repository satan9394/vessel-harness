# T290 — 跨 harness 车道复用同一个 fixture 复制守卫（卡 288 遗留 R2）

- Status: 已完成（2026-10-25；PDW 任务 `accepted_local`；未提交、未推送）
- PDW task: 20261025115350-c92efe
- Mode: standard（抽公共 helper + 5 个 adapter 接线 + fixture 规格扩字段）
- Source: 卡 288 复核遗留 R2；用户 2026-10-25 同意接着做
- Risk: medium（改 5 个 adapter 与 conformance/real-model lane 的复制路径）

## Goal

让「判据文件不得进入被测工作区」在**所有**车道成立，而不是只在 `runScenario` 成立：把内置红线、`leak_globs` 匹配、复制后复查收成一份共享实现，`runner.ts`、5 个 adapter、`contracts/vessel.ts` 全部复用它；conformance 与 real-model lane 构建 fixture 时把该场景 manifest 的 `leak_globs` 透传进去。

## Not Doing

- 不改 `leak_globs` 的语义、内置红线名单、错误类型继承关系。
- 不改 adapter 的其它逻辑（环境探测、脚本回放、失败包装）。
- 不动 `prepareFixtureSetup` 的语义（vessel adapter 仍要调用它）。
- 不新增真实 `--live` 调用。
- 不 commit / 不 push / 不删除任何文件。

## 设计（协调者已定）

1. 新建 `benchmarks/runners/src/fixtureCopy.ts`，把 `BUILTIN_LEAK_GLOBS`、`matchLeakGlob`、`assertNoLeakPaths`、`FixtureLeakError` 搬进去（逻辑逐字不变），并新增 `copyFixtureTree(src, dest, leakGlobs?)`＝带过滤的复制 + 复制后复查。`runner.ts` 用 `export { ... } from './fixtureCopy.js'` 保持既有导出面（`gates.ts` 与测试都从 `../runner.js` / `./runner.js` 取），其内部 `copyDir` 改为调用共享实现（或直接删除本地副本）。
2. `contracts/types.ts` 的 `HarnessFixture` 新增 `leakGlobs?: string[]`。
3. `adapters/{codex,claude,dsh,opencode,pi}.ts` 与 `contracts/vessel.ts`：删除各自私有的 `copyDir`，改调 `copyFixtureTree(fixture.workspaceRoot, workspace, fixture.leakGlobs)`；codex 原有的 try/catch 包装保留。
4. `conformance/run-conformance.ts:67` 与 `lane/real-model-lane.ts:365` 构建 fixture 时用 `loadManifest(repoRoot, id).leak_globs` 填充 `leakGlobs`。
5. 文档：`docs/BENCHMARK-SPEC.md` §2.4 删掉「此守卫仅覆盖 runScenario；外部 adapter 与 conformance 的独立复制路径不在此范围」，改成所有车道共用同一实现；若有其它段落重复该限制也一并改准。

## Acceptance

- AC1：`fixtureCopy.ts` 是唯一实现；`runner.ts` 与 5 个 adapter、`contracts/vessel.ts` 不再各有一份 `copyDir` 逻辑（`grep -c "function copyDir"` 在这些文件里为 0）。
- AC2：`HarnessFixture.leakGlobs` 存在；conformance 与 real-model lane 都从 manifest 透传（不是写死）。
- AC3：adapter 车道行为可用测试证明：给定 `leakGlobs: ['RUBRICS.json']` 的 fixture，任一 adapter（用不发动真实 CLI 的路径，如 `failOnMissing` 或注入 provider）复制出的工作区里没有该文件；不给 `leakGlobs` 时命中内置红线要抛 `FixtureLeakError`。
- AC4：既有行为不回归：`runner.test.ts`、`fixture-leak-guard.test.ts`、`release-gates.test.ts`、`spec-manifest-parity.test.ts`、adapter 既有测试全部通过；`versions expect` 之类既有断言不动。
- AC5：`docs/BENCHMARK-SPEC.md` 不再声称 adapter 车道不覆盖；`tsc -b`、`typecheck:tests`、定向 vitest 全部 exit 0。

## Blast Radius

`benchmarks/runners/src/fixtureCopy.ts`（新增）、`runner.ts`、`contracts/types.ts`、`contracts/vessel.ts`、`adapters/{codex,claude,dsh,opencode,pi}.ts`、`conformance/run-conformance.ts`、`lane/real-model-lane.ts`、`docs/BENCHMARK-SPEC.md`、必要时对应 `*.test.ts`。回滚：`git checkout -- <上述文件>` 并回收新增文件。

## Expected Evidence

定向 vitest、`tsc -b`、`typecheck:tests`、离线 `bench:conformance --all` 25/25；PDW check 日志与 review 结论；协调者另跑全量 `npm run test:all`。

## Result

已完成。守卫收成一份实现：`benchmarks/runners/src/fixtureCopy.ts` 导出 `copyFixtureTree` / `BUILTIN_LEAK_GLOBS` / `matchLeakGlob` / `assertNoLeakPaths` / `FixtureLeakError` / `FixtureSetupError`；`runner.ts` 改为导入并 re-export（`gates.ts` 与既有测试仍从 `runner.js` 取到这些符号），`hidden` 注入与 fixture 复制都走同一实现。5 个 adapter 与 `contracts/vessel.ts` 删掉私有 `copyDir`，改调 `copyFixtureTree(..., leakGlobs 过滤)` 并在复制/准备后 `assertNoLeakPaths`；codex 原有的 `failed to stage fixture copy` 包装保留。`HarnessFixture` 新增 `leakGlobs?: string[]`，`conformance/run-conformance.ts` 与 `lane/real-model-lane.ts` 都从 `loadManifest(...).leak_globs` 透传（后者把原来的 `policyCache` 扩成 `manifestCache`，解析失败仍降级为 base policy + 无声明）。

PDW 任务 `20261025115350-c92efe`：`accepted_local`，4 次调用、0 修复，artifact `ecc58153b837fb69dacaf4d2401d6c6f57b2463249236f5ede9a4c49e25410a8`。五条 check 全 exit 0（11 个测试文件 / 225 用例、`tsc -b`、`typecheck:tests`、`no-private-copydir`、`docs-shared-guard`）。

门禁（协调者执行）：`tsc -b` exit 0、`typecheck:tests` exit 0、`npm run test:all` 根 **306 文件 / 3228 passed + 6 skipped**；web root 未跑完——在用户切到手动 Codex 模式前主动终止，本卡未触及 `apps/web`（该 root 上一次为 58 文件 / 494 passed）。并发校验：改动文件里 `U+FFFD` 计数为 0，中文注释未被破坏。

复核遗留（均不影响验收）：
- 泄漏抛错时 adapter 自建的临时工作区不清理（`mkdtemp` 之后的 assert 失败会留下 tmp 目录）；这是失败路径的既有模式，不是本卡引入。
- `conformance/run-conformance.ts` 读 manifest 是 fail-fast（manifest 缺失即整条 exit 1），`real-model-lane.ts` 对同一读取降级为 undefined——两车道不一致，当前 25 个 manifest 都合法所以未触发。
- 契约 `baseline_dirty` 仍为空，但任务开始时工作区带着卡 288/289 的存量改动；越界判定只能靠 scan 快照区分。

