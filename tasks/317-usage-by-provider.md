# T317 — CLI：按供应商看 token 与成本

> 自包含执行书。项目根 `E:\Code_file\Projects\Vessel_Harness`（Windows）。
> 目标：`vessel usage` 增加一个按 **provider**（供应商）聚合的视图，数据只来自既有 `UsageStore`。

## 0. 先读这些（只读）

1. `apps/cli/src/usage/UsageStore.ts`（1264 行）— 记录键是 `provider::model`，先找它的读取/聚合 API（`list` / `summary` / `entries` 之类）与数据结构。
2. `apps/cli/src/cli.ts` 的 `usage` 命令分支（`--cache` / `--recent` / `--by-day` 已存在，新开关照抄解析与输出风格）。
3. `apps/cli/src/usage/usage-store.test.ts` — 造临时 store 的写法。
4. `apps/cli/src/usage/costMultiplier.test.ts` — 供应商倍率已在既有成本里结算，确认新视图**不要**再乘一次。

## 1. 做法（写死）

1. `vessel usage --by-provider`：按 provider 聚合，表格列：
   `provider | models | calls | input | output | cacheRead | costUsd`
   - `models` = 该 provider 下出现过的不同 model 数；
   - `calls` = 记录条数（若既有记录有 request 计数则以它为准，并在 `--json` 里注明口径）；
   - 数字格式化沿用 `usage` 现有风格（千分位、成本 4 位小数）。
   - 末尾一行合计。
2. `--json` 输出：`{ byProvider: [{ provider, models, calls, inputTokens, outputTokens, cacheReadTokens, costUsd, perModel: [{ model, ... }] }], totals: {...} }`。
3. 无记录 → 文本 `no usage recorded yet`、`--json` 里空数组、**exit 0**。
4. 未知 provider（`provider` 字段为空字符串或缺失）归到一个显式的 `unknown` 组，不丢弃。

## 2. 不许做

- 不新增第二套计价：只读已有记录里算好的 `costUsd`（含倍率），不再乘 `costMultiplier`。
- 不写任何文件、不改 usage 记录结构、不新增 provider 字段。
- 不改 `--cache` / `--recent` / `--by-day` 的既有输出。
- 不 commit / push；不加依赖；不动 `packages/core`。

## 3. 允许修改

```
apps/cli/src/usage/UsageStore.ts        (仅在需要暴露聚合时加只读方法)
apps/cli/src/usage/usage-store.test.ts  (加聚合用例)
apps/cli/src/cli.ts                     (usage 分支加 --by-provider)
apps/cli/src/cli.test.ts                (加命令用例)
```

## 4. 验收（逐条真跑，贴退出码）

```powershell
node node_modules/vitest/vitest.mjs run apps/cli/src/usage/usage-store.test.ts apps/cli/src/cli.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node apps/cli/dist/cli.js usage --by-provider
node apps/cli/dist/cli.js usage --by-provider --json
```

最后两条在仓库根跑：真实 `~/.vessel` 里可能没有记录，允许输出 `no usage recorded yet`，但**退出码必须是 0**、JSON 必须是合法对象。

## 5. 回报

```
数据源：<用 UsageStore 的哪个 API>
聚合口径：<calls 的定义 + 空 provider 归组>
输出：<表格样例 + JSON 片段>
测试：<新增用例>
检查：<五条命令退出码>
未做：<如实写>
```
