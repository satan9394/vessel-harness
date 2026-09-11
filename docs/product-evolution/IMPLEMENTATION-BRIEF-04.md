# IMPLEMENTATION-BRIEF-04 — 把 web 拉进类型门禁（G-07，P1）

> Round 4 切片（Orchestrator 产出）。来源：`PRODUCT-GAP-MAP.md` G-07 / `docs/product-audit/ARCHITECTURE-REPORT.md` 系统级问题 #2。
> 一句话：**"验证机器自身有个洞"** —— `apps/web` 的 TS 类型错误可静默通过全部 8 道发布门禁。

## 目标

让 `apps/web` 的类型错误**在发布门禁上必然失败**，而不是只在 `vite build` 时偶然冒出来（Gate7 只探 dist 存在）。

## 用户场景

维护者改了 `apps/web/src/**` 引入类型错误（例如把 `number` 赋成 `string`），跑发布门禁 → 现状：8 道门禁全 PASS（Gate1 只扫根 `tsc -b` 的 project references，web 不在图内；Gate7 只要 `apps/web/dist` 存在就 pass）→ 期望：**Gate1（Build）FAIL**，并指明是 web typecheck 失败。

## 当前问题（证据）

- `benchmarks/runners/src/release-gates/gates.ts:44` Gate1 criterion = 「类型构建 `tsc -b tsconfig.json` 完成且退出码 0」；`:461` 实际执行 `npx tsc -b tsconfig.json`（cwd=repoRoot）→ 只覆盖根 `tsconfig.json` 的 references（packages + cli + local-server + runners）。
- `gates.ts:50 / :359-368` Gate7（ux-smoke）只判 `apps/web/dist` 是否存在（`:564-568`），**不做类型检查**。
- `apps/web/package.json:7-12` 只有 `dev/build/preview/test`，**无 `typecheck` 脚本**。
- `apps/web/tsconfig.json:13` 已设 `"noEmit": true`（`include: ["src","vite.config.ts"]`），故 `tsc -p apps/web/tsconfig.json` 即等价类型检查，无需改编译配置。

## 理想行为

1. `apps/web/package.json` 增脚本：`"typecheck": "tsc -p tsconfig.json"`。
2. **Gate1（Build）同时跑两件事**，两者都 exit 0 才 pass：
   - `npx tsc -b tsconfig.json`（现状，保留）
   - `npx tsc -p apps/web/tsconfig.json`（新增，cwd=repoRoot）
   判定逻辑抽成**纯函数**便于单测（如 `judgeBuildPair(cliOutcome, webOutcome)`），verdict 的 `detail` 同时给出两个退出码；Gate1 的 criterion 文案更新为「根 `tsc -b` 与 `apps/web` 类型检查（`tsc -p apps/web/tsconfig.json`）均 exit 0」。
3. 八个门禁**数量与 id 不变**（不新增第 9 道门）；`packaging` / `ux-smoke` 等其它门禁行为不动。
4. 若 web typecheck 因**环境**（tsc 不可用等）无法执行：沿用仓库既有的"显式 pending"约定（与 Gate7 的 probeFailed 一致），**不得**静默判 pass。

## 涉及模块

`apps/web/package.json`（脚本）、`benchmarks/runners/src/release-gates/gates.ts`（Gate1 执行 + 判定 + criterion 文案）、`benchmarks/runners/src/release-gates/release-gates.test.ts`（新增纯函数单测）。

## 不能破坏什么

- 八门禁既有语义与 id：`build / l1-scenarios / real-model-lane / det-bench / safety / resume / ux-smoke / packaging`（按 gates.ts 实际枚举）。
- 其它门禁的判定与其测试全绿；`tsc -b` 仍 0；全量 `vitest`（现 **117 文件 / 1255 passed + 1 skipped**）仍绿。
- 不引入新依赖；不改 `apps/web/tsconfig.json` 的编译语义（它已是 noEmit）。

## 验收标准

1. `apps/web/package.json` 含 `typecheck` 脚本；手动 `npx tsc -p apps/web/tsconfig.json` 在**无改动**时 exit 0。
2. `gates.ts` 的 Gate1 在无改动时 **PASS**，且 `evidence.detail` 含两条退出码（cli + web）。
3. **判别性（关键，由指挥 E2E 做）**：故意在 `apps/web/src/**` 引入一个类型错误 → 跑门禁（或直接 `npx tsc -p apps/web/tsconfig.json`）**必须失败**；恢复后必须回到 PASS。
4. 单测：新增纯函数（判定组合）至少 3 例——双 0 → pass；cli 0 + web 非 0 → fail 且 detail 指向 web；cli 非 0 → fail。
5. 全量 `npx vitest run` + `npx tsc -b` 绿。

## 错误场景

- tsc 不在 PATH / 执行抛异常 → 显式 pending（不得 pass）。
- web 目录缺失 → pending（同 Gate7 的探测约定）。

## 测试要求

- 写入型微任务（单文件/单点，执行器不跑命令）；指挥复跑 `tsc -b` + 全量 vitest + **判别性 E2E**（注入类型错误 → 门禁必须红 → 恢复 → 绿）。
- 之后交独立静态 Evaluator 复核（Round 4 验收）。
