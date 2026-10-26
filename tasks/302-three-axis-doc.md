# T302 — 三轴分离写成文档约束（HARNESS² P2-1）

- Status: 已完成（2026-10-25；Codex 手动执行；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：把「method / substrate / benchmark 三个轴互不引用」从口头约定变成文档里的显式约束。**零代码改动**。

## 0. 先读这些（只读）

1. `docs/BENCHMARK-SPEC.md` §1（Benchmark v0.1 的五条原则）与 §2/§3 的结构 — 新节要插在它们之后、且**不能**改动被 `spec-manifest-parity.test.ts` 解析的章节（§0 / §1.1 / §3.0 / §4.1 / §7.x / §8.3 / 附录 A）。
2. `docs/ARCHITECTURE.md` 的模块边界一节 — 确认三轴在现有架构叙述里怎么描述。
3. `packages/behavior/src/ir/BehaviorIR.ts` — method 轴的实例（行为语义）。
4. `benchmarks/runners/src/contracts/types.ts` — substrate 轴的实例（adapter 契约）。
5. `benchmarks/scenarios/B001.yaml` — benchmark 轴的实例（场景判据）。

## 1. 新增一节「三轴分离」

放在 `docs/BENCHMARK-SPEC.md` 的合适位置（建议 §2 之后、§3 之前，或文档末尾新增编号节），**20–30 行**，必须包含：

- 三个轴的定义：
  - **method**：行为语义（`packages/behavior` 的 IR 与 compiler）。
  - **substrate**：执行体（`benchmarks/runners/src/contracts` + `adapters`，各 harness 的接入方式）。
  - **benchmark**：判据（`benchmarks/scenarios/*.yaml` 的 `pass:`）。
- 三条互不引用规则：method 不认识 benchmark 场景 id；substrate 不读 `scenarios/*.yaml` 的判据；benchmark 不 import method/substrate 的实现（只通过 runner 注入）。
- 一句「`BenchSpec` 是值不是代码路径」：场景的差异必须写在 yaml 数据里，不得靠分支代码表达。
- 一句边界：本约束目前由 code review 与既有 parity 测试守护，**没有**自动化的跨轴 import 检查（不要声称有）。

## 2. 不许做

- 不改任何代码、不改测试、不改既有章节的措辞。
- 不新增超过 30 行、不加表格以外的第二张表。
- 不 commit / push / 删文件。

## 3. 允许修改

```
docs/BENCHMARK-SPEC.md
```

## 4. 验收（真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/spec-manifest-parity.test.ts
node node_modules/vitest/vitest.mjs run packages/telemetry/src/turnEndConditionGuard.test.ts
```

两条都必须 exit 0（parity 测试会解析表 A/表 B 与若干章节，插错位置会红）。

## 5. 回报

```
位置：<插在第几节之后 + 前后标题>
行数：<n ≤ 30>
三条规则：<逐条摘录>
守卫：<两条命令退出码>
```

## Result

已完成。`docs/BENCHMARK-SPEC.md` 新增三轴分离一节（method / substrate / benchmark 的定义 + 三条互不引用规则 + 「BenchSpec 是值不是代码路径」+ 明确当前只靠 review 与 parity 测试守护、没有跨轴 import 检查）。零代码改动。

`spec-manifest-parity` 与 `turnEndConditionGuard` 两条守卫 exit 0；卡 305 之后又改过同一文档，守卫重跑仍绿。
