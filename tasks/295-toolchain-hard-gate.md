# T295 — 工具链 pin 从「可见」升级为「跑前硬门禁」

- Status: 已完成（2026-10-25；PDW 实现完成但报 blocked，协调者复核 + 全量门禁收口，**未经 PDW 独立 review**；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 前置：卡 291 已完成（`configs/tool-pins.json` + doctor 的 `toolchain` 项）。本卡把同一份检查接进 benchmark 的准备阶段，并顺手修掉 291 留下的架构问题。

## 0. 背景：为什么先搬家

卡 291 把版本检查放在了 `apps/cli/src/commands/toolPins.ts`（当时是为了修 `doctor` 走 dist 时 `ERR_MODULE_NOT_FOUND` 的跨包 import）。现在 benchmark 侧也要用它，**不能**再让 `benchmarks/runners` 反向 import `apps/cli`。`packages/shared` 是 cli 与 benchmarks 都已依赖、且没有 dependencies 的公共层，所以先把它搬过去。

## 1. 先读这些（只读）

1. `apps/cli/src/commands/toolPins.ts` — 要搬走的实现（`parseToolVersion` / `satisfiesRange` / `ToolPinCheck` / `checkToolPins`）。
2. `apps/cli/src/commands/toolPins.test.ts` — 要跟着搬的测试。
3. `packages/shared/src/index.ts` 与 `packages/shared/package.json` — 导出面与"无 dependencies"的事实（只能用 `node:` 内置）。
4. `apps/cli/src/commands/doctorCommand.ts` — `toolPins` 依赖注入点与 `check('Toolchain pins', ...)`。
5. `benchmarks/runners/src/runner.ts` — `runScenario()` 准备阶段（`fixtureDir` 解析之后、`copyFixtureTree` 之前）与 `RunScenarioOptions`（看 `nativeSandbox` 这类"仅测试注入"的可选字段怎么写的）。
6. `benchmarks/runners/src/fixtureCopy.ts` — `FixtureSetupError` 与 `FixtureLeakError` 的继承形状（gate 靠 `instanceof` 分流）。
7. `benchmarks/runners/src/release-gates/gates.ts` `runOfflineScenarios()` 的 catch — 确认 `FixtureSetupError` → `pending-environment`、`FixtureLeakError` → `fail`。
8. `configs/tool-pins.json` — 现有两个工具与区间。

## 2. 搬家（A 部分）

- 新建 `packages/shared/src/toolPins.ts`：内容 = `apps/cli/src/commands/toolPins.ts`（函数与类型逐字搬，注释里"为什么不在 benchmark 侧"那段改成"为什么放在 shared"）。
- `packages/shared/src/index.ts` 导出 `parseToolVersion` / `satisfiesRange` / `ToolPinCheck` / `checkToolPins`。
- `apps/cli/src/commands/doctorCommand.ts` 改为从 `@vessel/shared` 导入（仍可保留本地类型别名）。
- `apps/cli/src/commands/toolPins.ts` **保留为薄壳**：内容改成 `export * from '@vessel/shared';`（**不要删除这个文件**，也不要用 `rm` / `unlink`——本项目删除必须走回收站，本卡直接避免删除操作）。它上面的注释改成"实现已迁到 @vessel/shared，这里只为兼容旧 import"。
- `apps/cli/src/commands/toolPins.test.ts` **保持原样不动**（它 `import './toolPins.js'`，薄壳 re-export 后仍能跑通同一实现）；另在 `packages/shared/src/toolPins.test.ts` 放一份正式测试（import `./toolPins.js`）。
- 验证 dist：`node apps/cli/dist/cli.js doctor --json` 必须仍 exit 0 且含 `"category":"toolchain"`（这条不能少，291 就是在这里翻过车）。

## 3. 硬门禁（B 部分）

> 设计已按 test-plan 的反馈修正过：**默认不检查**（opt-in），否则清单外约 30 处 `runScenario` 调用会随本机 CLI 版本漂移，CI 也可能红。

- 在 `benchmarks/runners/src/fixtureCopy.ts` 新增：
  ```ts
  /** Toolchain version drift: a declared pin no longer matches the installed CLI. */
  export class ToolchainPinError extends FixtureSetupError { ... }
  ```
  消息必须含：工具名、实际版本、声明区间、以及"升级/降级 CLI 或更新 configs/tool-pins.json"两条出路。
- `benchmarks/runners/src/runner.ts` 的 `runScenario()`：
  - `RunScenarioOptions` 增加可选 `toolPinsProbe?: (tool: string) => string | null`。**只有显式传入该字段时才执行检查**（生产默认不跑任何 spawn，既有 30 处调用行为不变）。
  - 检查位置：`fixtureDir` 解析之后、`copyFixtureTree` 之前，调用 `checkToolPins(opts.repoRoot, opts.toolPinsProbe)`。
  - **只有 `status === 'warn' && found !== null`（装了但版本不符）抛 `ToolchainPinError`**。
  - `found === null`（本机没装该 CLI）与 `tool-pins.json` 缺失/非法 → **放行**，并把一条说明写进报告的**可选**字段。
  - 可选字段名 `toolchainNotes?: string[]`，加到 `benchmarks/runners/src/types.ts` 的 `ScenarioReport` 上，规则与同文件既有的 `measuredAudit` / `turnKind` 完全一致：**只在非空时出现**（`...(notes.length ? { toolchainNotes: notes } : {})`），空时键缺席。同时 `console.warn` 一条同样内容。
  - **不要**往 `summary.json` 的既有键里塞任何东西，也不要新增总是出现的键——`runner.test.ts` 里有对 summary 键集的全等断言，只在非空时出现才不破坏它们。
- `runScenario` 抛 `ToolchainPinError` 时不要写 `.run-complete.json`，也不要进 `driveScenario`。

## 4. 文档

`docs/BENCHMARK-SPEC.md` §2.4 补 4–6 行：

- 跑前读取 `configs/tool-pins.json`；**装了但版本不符 ⇒ `ToolchainPinError` ⇒ release gate 判 `pending-environment`**（沿用既有 setup 错误通道）。
- **本机没装该 CLI ⇒ 放行 + note**，CI 不受影响。
- pin 文件缺失/非法 ⇒ 放行 + note（不阻断）。

## 5. 测试

`packages/shared/src/toolPins.test.ts`：搬来的五组用例全保留。

`benchmarks/runners/src/runner.test.ts` 补三条（用 `toolPinsProbe` 注入，不要真 spawn）：

1. probe 返回与 pin 不符的版本 → `runScenario` rejects `ToolchainPinError`，且 `instanceof FixtureSetupError` 为真（gate 才能判 pending），并且该 run 目录下没有 `.run-complete.json`。
2. probe 返回 `null`（未安装）→ run 正常完成，`report.toolchainNotes` 存在且含该工具的 skip 说明。
3. probe 返回匹配版本 → run 正常完成，`report.toolchainNotes` **不存在**（键缺席，不是空数组）。

另加一条负对照（重要）：**不传 `toolPinsProbe`** 时 `runScenario` 不执行任何 pin 检查——用一个 probe 会抛错的假实现证明它没被调用也可以，或断言既有用例（未传该字段）保持通过。

`benchmarks/runners/src/release-gates/release-gates.test.ts` 补一条：注入 runner 抛 `ToolchainPinError` → gate `status === 'pending'`（不是 fail、不是 pass）。

## 6. 不许做

- 不 commit / push；不加依赖（`packages/shared/package.json` 的 dependencies 保持空）。
- 不改 gate 判定逻辑（`ToolchainPinError` 走既有 `FixtureSetupError` 通道即可）。
- 不改 doctor 的展示语义、不改 `allPassed` 的定义。
- 不动 `packages/core`；不跑 `--live`。
- 不要把 pin 检查加进 adapters（它们已经在 `runScenario` 之后才跑；本卡只覆盖 runner 车道）。

## 7. 允许修改

```
packages/shared/src/toolPins.ts              (新增)
packages/shared/src/toolPins.test.ts         (新增)
packages/shared/src/index.ts
apps/cli/src/commands/doctorCommand.ts
apps/cli/src/commands/toolPins.ts            (改成 re-export 薄壳，不删除)
benchmarks/runners/src/fixtureCopy.ts
benchmarks/runners/src/runner.ts
benchmarks/runners/src/types.ts
benchmarks/runners/src/runner.test.ts
benchmarks/runners/src/release-gates/release-gates.test.ts
docs/BENCHMARK-SPEC.md
```

## 8. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run packages/shared/src/toolPins.test.ts benchmarks/runners/src/runner.test.ts benchmarks/runners/src/release-gates/release-gates.test.ts benchmarks/runners/src/fixture-leak-guard.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node apps/cli/dist/cli.js doctor --json
node node_modules/tsx/dist/cli.mjs benchmarks/runners/src/conformance/run-conformance.ts --all
```

最后两条都要 exit 0：`doctor --json` 里 `category":"toolchain"` 存在；conformance 是 `25 run / 0 skipped / 0 error`。

## 9. 回报

```
搬家：<shared 新文件 + 旧文件是否已回收 + doctor import 改成什么>
门禁：<三条分支的实际判定 + 错误类继承链>
文档：<§2.4 补了什么>
测试：<新增用例名与结果>
检查：<五条命令退出码 + doctor 的 toolchain 行 + conformance 汇总>
风险/未做：<如实写>
```

## Result

已完成（**未经 PDW 独立 review**，见下方流程说明）。

交付：`packages/shared/src/toolPins.ts`（`parseToolVersion` / `satisfiesRange` / `ToolPinCheck` / `checkToolPins`，逻辑与 cli 版逐字一致）并从 `packages/shared/src/index.ts` 导出；`apps/cli/src/commands/toolPins.ts` 变成 32 字节薄壳 `export * from '@vessel/shared';`（**没有删除文件**，避开了回收站操作）；`doctorCommand.ts` 改从 `@vessel/shared` 导入。`fixtureCopy.ts` 新增 `ToolchainPinError extends FixtureSetupError`（消息含工具名、实际版本、声明区间、两条出路）。`runner.ts` 的 `runScenario` 新增可选 `toolPinsProbe`：**只有显式传入才检查**，位置在 `fixtureDir` 解析后、`copyFixtureTree` 前；版本不符抛 `ToolchainPinError`，未安装或 pin 缺失/非法只 push note；`ScenarioReport` 新增可选 `toolchainNotes`，**只在非空时出现**（`summary.json` 既有键一个没动）。`docs/BENCHMARK-SPEC.md` §2.4 补 opt-in 与 pending 口径。

契约在实现前被 test-plan 拦过一次，三条都成立并已改：`summary.json` 加键会撞 `runner.test.ts` 的全等键集断言（CI 恰好是「没装 CLI」的情形）；`ScenarioReport` 没有 notes 字段且 `types.ts` 不在 scope；默认 probe 会让清单外约 30 处调用随本机版本漂移。现在的 opt-in 设计就是这三条的产物。

**流程说明（不冒充 `accepted_local`）**：PDW 任务 `20261025154640-aa35f4` 的 implement 阶段报 blocked——实现本身完成、151 个定向用例与三条类型/薄壳检查全过，卡在 AC6 的 `doctor --json` 上，当时 `providers` 项因并行测试短暂写入 `~/.vessel/providers.json` 而判「凭据不可用」。之后 `resume` 被 `Source drift` 拒绝：PDW 在 implement 报 blocked 时不更新 artifact 指纹，而源码已被实现者改动，这是它的既定设计。因此本卡的最终复核由协调者执行（读 diff 逐条对照 AC + 全量门禁），**没有 PDW 的独立 review 会话**，记录在此以免日后误读。

验收（最后编辑之后，协调者执行）：定向 5 文件 / **151 passed**；`tsc -b` exit 0；`typecheck:tests` exit 0；`node apps/cli/dist/cli.js doctor --json` exit 0，`toolchain` 项 pass（codex 0.164.0、opencode 2.1.4 均在区间内）；离线 conformance **25/25** exit 0；全量 `npm run test:all` 根 **309 文件 / 3303 passed + 6 skipped**、web **58 / 494**。

遗留：
- `doctor --json` 在 **Codex 沙箱内**跑时 `providers` 项会 fail：`secretRef` 指向的凭据（`~/.vessel` + 凭据后端）在 workspace-write 沙箱里取不到，于是被判「凭据不可用」。协调者在宿主环境复跑同一条命令是 exit 0、`providers` pass。→ 这类环境敏感的验收命令应由运行器的 checks（宿主进程）执行，不要写进 implement 的自验清单；本次 blocked 就是这个原因。**更正**：我先把它归因为「CLI 测试写了真实 `~/.vessel/providers.json`」，实测该文件 mtime 仍是 2026-10-21、跑完全量未变，该推断不成立，已撤回，不据此立卡。
- `runScenario` 的 pin 检查当前没有生产调用方（gate / `vessel bench` 尚未传 `toolPinsProbe`），本卡只提供接线点；要变成默认生效需再评估 CI 影响。
