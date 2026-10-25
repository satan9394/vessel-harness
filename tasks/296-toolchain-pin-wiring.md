# T296 — 把工具链 pin 接到真实车道

- Status: 已完成（2026-10-25；PDW 实现完成但报 blocked，协调者复核 + 全量门禁收口，**未经 PDW 独立 review**；未提交、未推送）
- PDW task: none
- Mode: standard（接线 + 测试，不改判定语义）
- Source: 卡 295 遗留「`toolPinsProbe` 只有接线点没有调用方」
- Risk: low（未安装仍放行，CI 不受影响）

## Goal

让 295 的 opt-in 检查真正跑起来：offline release gate 与 `vessel run --bench` 这两条车道在调用 `runScenario` 时传 `toolPinsProbe`，用的是 shared 里同一份版本探测。**装了但版本不符 ⇒ `ToolchainPinError` ⇒ gate 判 `pending-environment`；没装或 pin 缺失 ⇒ 照常放行 + note。**

## Not Doing

- 不改 gate 的三态归约（`FixtureLeakError` → fail、`FixtureSetupError` → pending 的既有分流一个字不动）。
- 不改 doctor、不改 `leak_globs` 机制、不做 `.run-complete.json` 的复用判定。
- 不让 pin 检查在 CI 上产生任何红（未安装必须放行）。
- 不加依赖、不 commit/push、不动 `packages/core`。

## 设计

1. `packages/shared/src/toolPins.ts`：把现有私有 `probeVersion` 提升为导出的 `probeToolVersion(tool: string): string | null`（行为逐字不变），`checkToolPins` 的默认参数改用它。
2. `benchmarks/runners/src/release-gates/gates.ts`：`runOfflineScenarios` 的默认 `runOne` 从 `(o) => runScenario(o)` 改成 `(o) => runScenario({ ...o, toolPinsProbe: probeToolVersion })`。**注入的 `scenarioRunner` 优先**：传了就不注入 probe（否则测试无法控制）。
3. `apps/cli/src/cli.ts` 的 `--bench` 调用点（约 1393 行）：`runScenario({ ... , toolPinsProbe: probeToolVersion })`。
4. 两条车道都在 `docs/BENCHMARK-SPEC.md` §2.4 那一段补一句「这两条车道默认传 `probeToolVersion`；未安装仍放行」。

## Acceptance

- AC1：shared 导出 `probeToolVersion`，`checkToolPins` 默认用它，行为与 295 一致（既有 shared 用例全过）。
- AC2：offline gate 默认路径确实传了 `toolPinsProbe`；注入 `scenarioRunner` 时不注入（测试可注入自己的抛错 runner）。
- AC3：`vessel run --bench` 路径也传了。
- AC4：CI 安全——`probeToolVersion` 返回 `null`（未安装）时 gate 仍正常判定（不是 pending、不是 fail），并留下 note。
- AC5：版本不符时 gate 判 `pending`（由 `ToolchainPinError` 走 `FixtureSetupError` 通道），不是 fail。
- AC6：定向 vitest、`tsc -b`、`typecheck:tests`、`node apps/cli/dist/cli.js doctor --json` 全 exit 0。

## Blast Radius

`packages/shared/src/toolPins.ts`、`benchmarks/runners/src/release-gates/gates.ts`、`benchmarks/runners/src/release-gates/release-gates.test.ts`、`apps/cli/src/cli.ts`、`apps/cli/src/cli.test.ts`、`docs/BENCHMARK-SPEC.md`。回滚 `git checkout -- <上述文件>`。

## Expected Evidence

定向 vitest 输出、`tsc -b` / `typecheck:tests` 退出码、doctor dist 冒烟、PDW check 日志与 review 结论；协调者另跑全量与离线 conformance。

## Result

已完成（**未经 PDW 独立 review**）。

交付：`packages/shared/src/toolPins.ts` 把私有 `probeVersion` 提升为导出的 `probeToolVersion`（行为不变，`checkToolPins` 默认用它）；`release-gates/gates.ts` 的默认 `runOne` 改为 `runScenario({ ...o, toolPinsProbe: probeToolVersion })`，**注入 `scenarioRunner` 时保持原样不覆盖**；`apps/cli/src/cli.ts` 的 `--bench` 调用点传同一 probe；`docs/BENCHMARK-SPEC.md` §2.4 补一句这两条车道默认探针、未安装仍放行。

测试（4 文件 / 206 passed）：gate 默认探针在「未安装 → pass + `[toolchain] … skipped`」与「99.0.0 → pending 且 run 目录为空」两态下都被锁定；注入 runner 时不调用 probe；`ToolchainPinError` → `pending` 不是 `fail`；`cli --bench` 断言 `runScenario` 收到的 `toolPinsProbe` 就是 shared 的那份。

**流程说明**：PDW 任务 `20261025161834-276b6b` 的 implement 再次报 blocked——实现全部完成（179 个定向用例、build、test type-check 全过），卡在 `doctor --json` 的 `providers` 项，与 295 完全同一个原因（Codex 沙箱取不到 `secretRef` 凭据）。源码此时已改，`resume` 仍会被判 `Source drift`。因此本卡复核与前一张一样由协调者执行，**没有 PDW 独立 review 会话**，如实记录。已把这条教训写进项目 `AGENTS.md` 禁做清单，避免第三张卡再踩。

验收（最后编辑之后，协调者执行）：定向 **206 passed**；`tsc -b` exit 0；`typecheck:tests` exit 0；`node apps/cli/dist/cli.js doctor --json` exit 0（`toolchain` pass）；离线 conformance **25/25** exit 0；全量 `npm run test:all` 根 **309 文件 / 3307 passed + 6 skipped**、web **58 / 494**。

遗留：pin 检查现在默认在两个真实车道生效，但**没有**对应的"版本漂移时 CI 行为"实测（本机版本都在区间内，只由单测覆盖 pending 分支）。
