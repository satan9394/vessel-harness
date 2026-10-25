# T292 — 三个收尾项：conformance 降级、gate 3 断言、adapter 失败路径清理

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 三件互不相关的小事，一起做，做完逐条自验。

## 0. 先读这些（只读）

1. `benchmarks/runners/src/conformance/run-conformance.ts` — 看 `fixtureFor()`（约 60–72 行）现在直接 `loadManifest`，manifest 缺失会让整条 conformance exit 1。
2. `benchmarks/runners/src/lane/real-model-lane.ts`（约 339–365 行）— 同一份 manifest 读取在 lane 里是 `try/catch` 降级为 undefined，**这是要统一的目标形状**。
3. `benchmarks/runners/src/release-gates/release-gates.test.ts` — 看 `safetyGateWith()`、`offlineGateCtx()`、以及新加的「判据泄漏直接 fail」用例（`it('判据泄漏直接 fail...')`，约 534–556 行），它是 gate 5（safety）的；本卡要补 gate 3（deterministic-bench）。
4. `benchmarks/runners/src/release-gates/gates.ts` — `runOfflineScenarios()` 是 gate 3 与 gate 5 共用的归约（约 960–1010 行），确认 `FixtureLeakError` 分支在 `return { status: 'fail' }`。
5. 六个复制点：`benchmarks/runners/src/adapters/{codex,claude,dsh,opencode,pi}.ts` 与 `benchmarks/runners/src/contracts/vessel.ts` — 看各自 `mkdtempSync(... workspace ...)` 之后紧接的 `copyFixtureTree(...)` / `prepareFixtureSetup(...)` / `assertNoLeakPaths(...)`，以及成功路径上 `rmSync` 的位置。

## 1. 任务 A：conformance 读取 manifest 改为降级

`conformance/run-conformance.ts` 的 `fixtureFor(id)`：

- 用 `try { manifest = loadManifest(REPO_ROOT, id) } catch { manifest = undefined }`，`leakGlobs: manifest?.leak_globs`。
- 语义：manifest 缺失/非法时，该 fixture 仍可跑（`leakGlobs` 为 undefined），**不**让整条 conformance 直接退出。内置红线 `RUBRICS.json` / `RUBRIC.json` 仍然生效（那是 `assertNoLeakPaths` 的 builtin 参数，与 manifest 无关）。
- 不要吞掉 manifest 里的其它字段（`policy` 等）——本文件目前只用 `leak_globs`，只用它即可。
- 在 `driver.test.ts` 里补一条：`fixtureFor` 的等价路径（或抽出可测函数）在 manifest 缺失时返回 undefined 的 leakGlobs 而不抛错。如果 `fixtureFor` 没有导出，就把「读 manifest 并降级」抽成一个导出的小函数（如 `export function manifestLeakGlobs(repoRoot, id): string[] | undefined`）再测，别为了测试把整个文件重构。

## 2. 任务 B：gate 3 也补一条泄漏断言

`release-gates/release-gates.test.ts`：

- 复制已有的 safety gate 泄漏用例，针对 `executors.find(e => e.gate.id === 'deterministic-bench')`（gate 3）写一条：注入 `offlineScenarioRunner` 抛 `new FixtureLeakError(['RUBRICS.json (builtin)'])`，断言 `status === 'fail'` 且 `evidence.summary` 含场景 id 与「判据泄漏」。
- 同时保留一条正向对照：同一 gate 下抛普通 `FixtureSetupError` 仍为 `pending`。
- 不要改 gate 定义文本、判据集合或其它 gate 的断言。

## 3. 任务 C：adapter 在复制/复检失败时清理自己刚建的临时工作区

现状（已核实）：六个复制点都是先 `mkdtempSync` 再 `copyFixtureTree` →（vessel 还有 `prepareFixtureSetup`）→ `assertNoLeakPaths`；如果中途抛错，函数直接退出，而清理只发生在成功路径之后，于是 `os.tmpdir()` 里留下一个没人管的目录。

要求：

- 在**六个文件**里把「建 workspace 之后的复制/准备/复检」这一段包进 `try { ... } catch (err) { fs.rmSync(workspace, { recursive: true, force: true }); throw err; }`。
- 只清理**本函数刚创建的**那个 `workspace`（`os.tmpdir()` 下的 `cah-<harness>-<id>-*`），不要碰 fixture 源目录、不要碰其它路径。
- 不要改变错误类型：`FixtureLeakError` 必须原样抛出去（不能包成普通 `Error`），否则 gate 的 fail 分流会失效。codex 现有的 `failed to stage fixture copy` 包装只应覆盖 `copyFixtureTree`，**不要**把 `FixtureLeakError` 包进去——建议把 `assertNoLeakPaths` 放在该 try 之外、单独一层 `try/catch` 只做清理再 rethrow。
- vessel 的 `prepareFixtureSetup` 失败（`FixtureSetupError`）也走同一清理。
- 不要在 `runTurn` / 子进程执行阶段加清理逻辑（那由既有 `finally` 负责）。

## 4. 测试

- `benchmarks/runners/src/adapters/codex.test.ts` 补一条：fixture 里放 `RUBRICS.json`、不声明 `leakGlobs` → `runCodexFixture` rejects `FixtureLeakError`，且 `os.tmpdir()` 下不再残留 `cah-codex-<id>-` 开头的目录（用 `fs.readdirSync(os.tmpdir())` 过滤前缀断言长度 0；测试前后各取一次，只比较新增）。
- 同样的「无残留」断言至少再覆盖一个 adapter（`vessel` 或 `claude`），其余三个只要代码同款即可（在回报里写明哪些有测试、哪些只有代码）。
- `conformance/driver.test.ts` 补任务 A 的降级用例。
- `release-gates.test.ts` 补任务 B 的两条断言。

## 5. 不许做

- 不 commit / push / 删除仓库内文件。
- 不新增依赖、不改 `package.json` / 锁文件。
- 不改 `runner.ts`、`gates.ts` 的逻辑（本卡只动测试与 adapter 的清理路径）。
- 不动 `packages/core`。
- 不跑 `--live`，不驱动本机其它 agent。

## 6. 允许修改

```
benchmarks/runners/src/conformance/run-conformance.ts
benchmarks/runners/src/conformance/driver.test.ts
benchmarks/runners/src/release-gates/release-gates.test.ts
benchmarks/runners/src/adapters/codex.ts
benchmarks/runners/src/adapters/claude.ts
benchmarks/runners/src/adapters/dsh.ts
benchmarks/runners/src/adapters/opencode.ts
benchmarks/runners/src/adapters/pi.ts
benchmarks/runners/src/contracts/vessel.ts
benchmarks/runners/src/adapters/codex.test.ts
benchmarks/runners/src/adapters/claude.test.ts        (仅在补残留断言时需要)
benchmarks/runners/src/contracts/contracts.test.ts    (仅在补 vessel 残留断言时需要)
```

## 7. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/adapters/codex.test.ts benchmarks/runners/src/adapters/claude.test.ts benchmarks/runners/src/adapters/dsh.test.ts benchmarks/runners/src/adapters/opencode.test.ts benchmarks/runners/src/adapters/pi.test.ts benchmarks/runners/src/contracts/contracts.test.ts benchmarks/runners/src/conformance/driver.test.ts benchmarks/runners/src/release-gates/release-gates.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node node_modules/tsx/dist/cli.mjs benchmarks/runners/src/conformance/run-conformance.ts --all
```

最后一条应输出 `cells: 25 run / 0 skipped / 0 error` 且 exit 0。

## 8. 回报

```
A：<改了什么 + 新用例名>
B：<gate 3 两条断言结果>
C：<六个文件是否都改了 + 哪几个有残留测试>
检查：<四条命令退出码 + conformance 汇总行>
风险/未做：<如实写>
```

## Result

已完成。三项各自落地：

- **A（conformance 降级）**：新增导出的 `manifestLeakGlobs(repoRoot, id)`，manifest 缺失/非法时返回 `undefined`，不再让整条 conformance exit 1；`fixtureFor` 用它填 `leakGlobs`。顺带补了 ESM entry 判定（`process.argv[1] === fileURLToPath(import.meta.url)` 才 `main()`），否则新增的静态 import 测试会触发整条 conformance。
- **B（gate 3）**：`release-gates.test.ts` 新增 deterministic-bench 的泄漏 → `fail`、普通 `FixtureSetupError` → `pending` 两条对照。
- **C（失败路径清理）**：六个复制点（5 个 adapter + `contracts/vessel.ts`）都在 `copyFixtureTree` / `prepareFixtureSetup` / `assertNoLeakPaths` 失败时 `fs.rmSync` 掉刚建的 workspace 再 rethrow；`FixtureLeakError` 保持原类型，不被包成普通 `Error`。

验收：定向 8 文件 / 134 passed；`tsc -b`、`typecheck:tests` exit 0；离线 `bench:conformance --all` **25 run / 0 skipped / 0 error**；全量根 307 文件 / 3268 passed + 6 skipped、web 58 / 494。

残留测试覆盖 codex 与 claude 两个 adapter；dsh / opencode / pi 采用同款清理结构但没有「无残留目录」断言。
