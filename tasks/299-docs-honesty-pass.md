# T299 — 文档诚实化清扫（第二轮）

- Status: 已完成（2026-10-25；Codex 手动执行，6 处修正；未提交、未推送）

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 背景：卡 288–298 改了 benchmark 的复制语义、gate 三态、报告口径与工具链检查。文档里仍有旧描述。本卡**只修事实错误**，不做风格改写。

## 0. 硬性边界（先读再动手）

- 允许改：`docs/BENCHMARK-SPEC.md`、`docs/TASK-QUEUE-ITERATION-STORE.md`、`docs/ARCHITECTURE.md`、`README.md`。
- **不许改**：`tasks/`（历史记录）、`HANDOFF.md`（协调者维护的快照）、`CHANGELOG.md`、任何代码文件。
- 每处改动必须能指向代码证据（`路径:行号`）；**指不出证据的句子不要动**。
- 最多 **20 处**；每处只改最小语句（通常一句或一个表格行），不重写整节、不新增超过 8 行的段落。
- 不许改测试数字、不许把「未验证」改成「已验证」、不许删掉限制性说明。

## 1. 要找的四类漂移

1. **说「没实现」但代码已实现** —— 例：fixture 复制是否过滤判据文件、gate 对判据泄漏是三态里的哪一态。
2. **说「已实现」但代码没有** —— 例：声称支持 resume 复用（`.run-complete.json` 目前只写不读）。
3. **字段/命令名与实现不符** —— 例：`leak_globs`（顶层，不是 `leakGlobs`）、`RunScore` 的 `graded/ungraded` 口径、`toolPinsProbe` 是否默认生效。
4. **计数与口径过时** —— 例：成功率分母是 `passed + failed` 还是 `runs`；`ungraded` 是否进分母。

## 2. 先出清单，再改

第一步：用只读方式把这些段落列出来（`grep` + 读代码核对），在回报里给出表格：

| 文件:行 | 原文摘要 | 问题 | 代码证据 | 拟改 |
|---|---|---|---|---|

第二步：只在清单内的位置做就地修改。清单外发现的问题**不要顺手改**，写进回报的「未改，建议另开」段。

## 3. 已知的核对点（至少覆盖这些，不要只做这几个）

- `docs/BENCHMARK-SPEC.md` 中描述 `copyDir` / `copyFixtureTree`、`FixtureLeakError` 分类、`successRate` 公式、`leak_globs` 键名的段落。
- `docs/TASK-QUEUE-ITERATION-STORE.md` 的 `IterationEntry` 字段表是否含 `harnessFingerprint`。
- `docs/ARCHITECTURE.md` 中 package 数量与职责（若有包清单漂移）。
- `README.md` 的状态段里是否有过时的测试数量或已改名的命令。

## 4. 测试（文档改动不跑业务测试，但要跑这两条防漂移守卫）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/spec-manifest-parity.test.ts
node node_modules/vitest/vitest.mjs run apps/cli/src/telemetry/telemetryDocs.test.ts
```

第二条若文件名不同（找 `docs/` 锚点守卫的实际测试文件，`grep -l "docs/" --include=*.test.ts`），换成实际那个；两个都要 exit 0。

## 5. 不许做

- 不 commit / push / 删文件；不加依赖。
- 不改代码、不改测试期望值。
- 不跑 `--live`，不动 `packages/core`。

## 6. 回报

```
清单：<表格，逐条 文件:行 → 问题 → 证据 → 改法>
改动数：<n ≤ 20>
守卫：<两个测试文件的退出码>
未改但发现：<清单外的问题，逐条>
```

## Result

已完成，6 处事实修正，全部有代码证据：

| 文件:行 | 问题 | 证据 |
|---|---|---|
| `docs/BENCHMARK-SPEC.md:93` | 声称用 git 重置隔离 | `runner.ts` 的复制 + 独立 run 目录 |
| `docs/BENCHMARK-SPEC.md:180` | marker 条件漏掉异常回合 | `runner.ts` 的 `success && turnEndedAbnormally !== true` |
| `docs/BENCHMARK-SPEC.md:182` | 说读取侧尚未实现 | `runCache.ts` 与 `cli.ts` 的 `bench:runs` |
| `docs/BENCHMARK-SPEC.md:818` | 产物树缺 marker | `runner.ts` 写 `.run-complete.json` |
| `docs/ARCHITECTURE.md:415` | tools 仍标 `mcp(stub)` | `packages/tools/src/index.ts` 已非 stub |
| `README.md:45` | Web 写作后续里程碑 | `vessel serve` / `vessel web` 已提供 |

两个文档守卫 `spec-manifest-parity` 与 `turnEndConditionGuard` 分别 26/26、10/10 exit 0。清单外未改动；README 的历史测试数字与 CI 状态按执行书要求未动。
