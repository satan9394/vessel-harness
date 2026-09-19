# 145 — 真实模型 lane 接场景 policy（B1：残留清算首个真缺口）

- 编号：145
- 状态：已合入（2026-09-19）
- 优先级：P1（真实缺口：场景未按声明策略跑）
- 创建日期：2026-09-19
- 关联：`docs/RELEASE-GATES.md`（原"仍未收口"）、`docs/SAFETY-BENCHMARK.md:89-92`、`tasks/082`（real-model lane）、`tasks/076`（契约）、`tasks/141`（同批诚实化）
- 执行器：指挥侧

## 1. 背景（已核实的真缺口）

`runVesselFixture`（`benchmarks/runners/src/contracts/vessel.ts`）只用
`opts.policySystemPath ?? configs/policy.default.yaml`，**从不读场景 manifest 的 `policy:`**。
真实模型 lane（`lane/real-model-lane.ts` → `vesselAdapter.run` → 本函数）因此把**每个**场景都按
默认 `workspace-write` 跑：B005/S006 声明的 `danger-full-access` 被忽略，Shell 在 `approval: never`
下 fail-closed 被拒 —— 场景实际**没按它自己声明的策略**跑。离线 `runner.ts:872-883` 早已正确消费
`manifest.policy`，两条车道口径不一致（`RELEASE-GATES.md` / `SAFETY-BENCHMARK.md` 自认"待另开卡"）。

## 2. 改动

- `contracts/vessel.ts`：`VesselRunOptions` 增 `scenarioPolicy?: { profile?; approval? }`；存在时把
  `profile`/`approval` 覆写到临时 `scenario-policy.yaml`（与 `runner.ts` 同款 unwrap +
  `yaml.dump({ policy: root })`），作为本次 run 的 `policySystemPath`；run 结束在 `finally` 里删该临时目录。
  **不传 ⇒ 与改动前逐字一致**（离线 conformance / 跨 harness 路径不传）。
- `lane/real-model-lane.ts`：`makeFixture` 经 `loadManifest(repoRoot, id).policy`（每场景缓存；manifest
  缺失/非法则降级为 `undefined`，**不抛**）把 `scenarioPolicy` 传入 `fixture.options`。
- `contracts/contracts.test.ts`：新增判别用例（默认 policy 下 Shell 被拒 `policyViolations ≥ 1`；
  `scenarioPolicy:{profile:'danger-full-access'}` 下为 `0`）。
- `docs/RELEASE-GATES.md` / `docs/SAFETY-BENCHMARK.md`：把"仍不读场景 policy（待另开卡）"改为
  "**已接线（task 145）**"，并如实写明**仍按设计**：本 lane 只采 §15 L3 指标、**不评估 assert 级 pass**，
  故行状态 `passed` 仍 = `metrics.success`，不等于 `S008.yaml` 的判据通过。

## 3. 验收与实测

- **判别性证据（突变实测）**：把 `if (opts.scenarioPolicy)` 临时改成 `if (false && opts.scenarioPolicy)`
  ⇒ 新用例**红**（`policyViolations` 由 `0` 变 **2**）；还原后绿。
- **回归**：`npm run bench:conformance -- --all` 离线 **25 run / 25 passed / 0 error，exit 0**
  （自适配器被 conformance 复用，逐场景 wall/OK 正常）。
- **定向**：`contracts.test.ts` + `real-model-lane.test.ts` + `conformance/driver.test.ts` = **40 passed**。
- **门禁（全在最后一次编辑之后，各带显式退出码）**：`tsc -b` exit 0、`typecheck:tests` exit 0、
  `test:all` exit 0（根 **178 文件 / 2237 passed + 6 skipped** —— 较基线 +1 即本卡新用例；web **11 / 120**）、
  web `vite build` exit 0、CLI 冒烟 exit 0。

## 4. 边界

- 不改 `runner.ts`（离线车道）行为；不改 076 契约形状（`types.ts`/`validate.ts` 未动）。
- 不改真实模型 lane 的行状态口径（`passed` 仍 = `metrics.success`）；assert 级判定仍是 offline lane 职责。
