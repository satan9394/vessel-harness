# T291 — 跑前工具链门禁（HARNESS² P0-4，最小可用版）

- Status: 已完成（2026-10-25；Codex 手动执行 + 协调者修复运行时缺陷；未提交、未推送）

> 这是一份**自包含执行书**：读完本文件即可动手，不需要再问任何人。
> 项目根：`E:\Code_file\Projects\Vessel_Harness`（以下路径都相对它）。
> 来源：`docs/HARNESS2-ABSORPTION-ASSESSMENT.md` §3 P0-4；取舍见本文件「为什么只做最小版」。

## 0. 一句话目标

把「外部 CLI 能退出 0 就算可用」升级成「版本落在声明的区间」，并把结果暴露给 `vessel doctor`；**不**改 benchmark 执行路径，**不**让 CI 因缺 CLI 变红。

## 1. 先读这些（按顺序，只读不改）

1. `benchmarks/runners/src/adapters/codex.ts` — 看 `probeCodexEnv()`（约 136 行）现在只判 `--version` 退出码。
2. `benchmarks/runners/src/adapters/{claude,dsh,opencode,pi}.ts` — 各自的 `probe*Env()`，确认探测命令与输出格式。
3. `apps/cli/src/commands/doctorCommand.ts`（全文 113 行）— `DoctorCheckItem.category` 是字面量联合（`'runtime' | 'sandbox' | ...`），`check(name, category, remedy, run)` 是唯一的登记入口。
4. `apps/cli/src/commands/doctorCommand.test.ts` — 现有断言风格（用注入依赖，不真跑外部命令）。
5. `configs/` — 现有 4 个文件（`behavior.default.yaml` / `model-catalog.json` / `policy.default.yaml` / `pricing.json`），新文件放这里。
6. `docs/BENCHMARK-SPEC.md` §2.4 — 了解现有门禁叙述，稍后补一段。

## 2. 本机已核实的版本（写 pin 时用，别猜）

- Codex CLI：`codex-cli 0.164.0`
- OpenCode：`opencode 2.1.4`
- Claude / dsh / pi：**未核实**，因此 **不要在 pin 文件里给它们写区间**（未声明 = 不检查）。

## 3. 实现要求

### 3.1 新增 `configs/tool-pins.json`

```json
{
  "version": 1,
  "tools": {
    "codex": { "range": ">=0.164.0 <0.165.0", "probe": "codex --version" },
    "opencode": { "range": ">=2.1.4 <3.0.0", "probe": "opencode --version" }
  }
}
```

只有这两个工具；文件里必须带 `version` 字段，方便将来演进。缺文件或 `version` 不是 1 时，检查项应给 `warn`（不是 crash）。

### 3.2 新增 `benchmarks/runners/src/toolchain.ts`

纯函数 + 一个 probe，**不要新增任何 npm 依赖**：

- `export function parseToolVersion(raw: string): string | null`
  从 `codex-cli 0.164.0` / `opencode 2.1.4` / `v2.1.4` 里提取第一个 `\d+\.\d+\.\d+`；取不到返回 `null`。
- `export function satisfiesRange(version: string, range: string): boolean`
  只支持空格分隔的 `>=` / `>` / `<=` / `<` / `=` 子句（例如 `>=0.164.0 <0.165.0`）。**不支持** `^`、`~`、`||`、预发布号；遇到不认识的字面量直接 `false`（fail loud 而不是静默通过）。
- `export interface ToolPinCheck { tool: string; declared: string; found: string | null; status: 'pass' | 'warn'; message: string }`
- `export function checkToolPins(repoRoot: string, probe?: (tool: string) => string | null): ToolPinCheck[]`
  逐工具解析 `configs/tool-pins.json`；`probe` 默认实现＝spawn `<tool> --version`（用与 `defaultRunCommand` 同款的 `child_process.spawnSync`，`encoding: 'utf8'`，Windows 下 `shell: true`）：
  - pin 文件缺失 / 解析失败 → 单条 `{ tool: 'tool-pins.json', status: 'warn' }`，不抛错。
  - CLI 不存在（spawn 失败或取不到版本）→ `status: 'warn'`，message 写「not installed on this machine; skipped」，**不得**是 fail。
  - 版本取到但不满足区间 → `status: 'warn'`，message 写 `found <x>, declared <range>` 并给 remedy 语义（升级/降级该 CLI，或改 pin）。
  - 满足 → `status: 'pass'`。
  关键：**任何分支都不返回 fail**，也不抛错——这台机器没有 Codex 时 CI 仍要绿。

### 3.3 接进 doctor

- `DoctorCheckItem['category']` 联合类型加 `'toolchain'`。
- 新增一项检查：`'Toolchain pins'`，category `'toolchain'`，remedy 写「Upgrade/downgrade the CLI to match configs/tool-pins.json, or update the pin if the bump is intended.」
- 该项 status 取 `checkToolPins()` 的聚合：全 pass → `pass`，有任何 warn → `warn`（**不要 fail**，否则 `vessel doctor` 退出码会从 0 变 1，破坏既有语义）。
- message 用一行一工具，形如 `codex: 0.164.0 (>=0.164.0 <0.165.0) ok` / `opencode: not installed; skipped`。
- 通过 `DoctorDependencies` 加一个可选注入口（如 `toolPins?: () => ToolPinCheck[]`），保证单测不真 spawn。
- **位置**：放在 `npm lockfile` 之后、`SQLite WAL` 之前。

### 3.4 文档

`docs/BENCHMARK-SPEC.md` §2.4 末尾补一段（3–5 行）：

> 跑真实 harness 车道前可用 `vessel doctor` 的 `Toolchain pins` 项核对本机外部 CLI 版本是否落在 `configs/tool-pins.json` 的声明区间；版本漂移只报 `warn`，不阻断。本检查**不进入** `runScenario` 的准备路径，因此 CI 机器没有这些 CLI 时不会变红。

### 3.5 测试

新增 `benchmarks/runners/src/toolchain.test.ts`：

- `parseToolVersion`：`codex-cli 0.164.0`、`opencode 2.1.4`、`v2.1.4`、`garbage`（→ null）。
- `satisfiesRange`：区间内/边界（`>=0.164.0` 自身）、超上界、多个子句、非法字面量（`^1.2.3` → false）。
- `checkToolPins`：pin 文件缺失 → 单条 warn 不抛；CLI 缺失 → warn；版本不符 → warn 且 message 含 found 与 declared；符合 → pass。全部用注入的 `probe`，不真 spawn。

`apps/cli/src/commands/doctorCommand.test.ts` 补一条：注入 `toolPins` 返回一条 warn → doctor 该项 status 为 `warn` 且 `allPassed` 仍为 true（warn 不算 fail）。

## 4. 不许做的事

- 不 commit、不 push、不删除任何文件。
- 不加依赖（`package.json` / 锁文件不动）。
- 不改 `benchmarks/runners/src/runner.ts`、`adapters/*.ts` 的执行路径（`probe*Env` 可以调用新模块，但不得改变「未安装 → pending-environment」的既有语义）。
- 不跑 `npm run bench:conformance -- --live`，不驱动本机其它 agent。
- 不把 doctor 的这项做成 fail。
- 不动 `packages/core`。

## 5. 允许修改的文件（只这些）

```
configs/tool-pins.json                              (新增)
benchmarks/runners/src/toolchain.ts                 (新增)
benchmarks/runners/src/toolchain.test.ts            (新增)
apps/cli/src/commands/doctorCommand.ts
apps/cli/src/commands/doctorCommand.test.ts
docs/BENCHMARK-SPEC.md
```

## 6. 验收（每条都要真跑，把退出码贴进回报）

```powershell
node node_modules/vitest/vitest.mjs run benchmarks/runners/src/toolchain.test.ts apps/cli/src/commands/doctorCommand.test.ts
node node_modules/typescript/bin/tsc -b tsconfig.json
node node_modules/typescript/bin/tsc -p tsconfig.test.json --noEmit
node node_modules/tsx/dist/cli.mjs apps/cli/src/cli.ts doctor --json
```

最后一条要求：输出里出现 `"category":"toolchain"` 的检查项，且整体退出码为 0（本机装了 codex/opencode 且版本相符 → pass；不符也只会 warn）。

## 7. 回报格式

```
改动：<逐文件一句话>
检查：<四条命令的退出码与关键输出行>
未做/风险：<如实写>
```

## 8. 为什么只做最小版（不要自行扩大）

评估报告的原方案是「在 runner prepare 阶段硬门禁，失败整批 pending-environment」。那会让每次 benchmark 运行都多一次外部进程探测，且 CI 上必须保证 pending 不被判红——这需要改 gate 归约，风险远大于收益。本卡先把**可见性**做出来（doctor + pin 文件 + 纯函数 + 单测），执行路径的硬门禁等有了 CI 上的 pending 证据再单独立卡。

如果实现中发现 `doctorCommand.ts` 的 category 联合类型有别的消费者（例如 web 或报告渲染）需要同步，**先停手回报**，不要顺手改 UI。

## Result

已完成并修正。

Codex 交付：`configs/tool-pins.json`（`version: 1`，codex `>=0.164.0 <0.165.0`、opencode `>=2.1.4 <3.0.0`）、`benchmarks/runners/src/toolchain.ts`（`parseToolVersion` / `satisfiesRange` / `checkToolPins`，任何分支只 `warn` 不 `fail`）、doctor 新增 `Toolchain pins`（category `toolchain`，位于 lockfile 与 SQLite WAL 之间）、`docs/BENCHMARK-SPEC.md` §2.4 补一段。22 个用例通过。

**协调者修复（Codex 未发现）**：`doctorCommand.ts` 原以 `../../../../benchmarks/runners/src/toolchain.js` 跨包相对路径导入。`tsc -b` 与 `tsx` 跑源码都通过，但真实 CLI 走 dist 时 `node apps/cli/dist/cli.js doctor --json` 实报 `ERR_MODULE_NOT_FOUND`（dist 目录里没有 `benchmarks/runners/src/*.js`）。已把该模块整体搬到 `apps/cli/src/commands/toolPins.ts` 并在文件头写明为何不能放 benchmark 侧，`benchmarks/runners/src/toolchain.ts` 与其测试送回收站，doctor 改 import 本地模块。

**协调者回退**：Codex 把 `DoctorReport.allPassed` 从「每项都 `pass`」改成「没有 `fail`」，未在要求内且会让字段名与语义脱节；已恢复原语义，新增用例改为断言「warn 不是 fail」而非 `allPassed === true`。

验收（最后编辑之后）：`tsc -b` exit 0；`toolPins.test.ts` + `doctorCommand.test.ts` 22 passed；`node apps/cli/dist/cli.js doctor --json` exit 0，7 项检查中 `toolchain` = pass（codex 0.164.0、opencode 2.1.4 均在区间内），`daemon` = warn；全量 `npm run test:all` 根 307 文件 / 3268 passed + 6 skipped、web 58 文件 / 494 passed。

未验证：Claude / dsh / pi 的真实版本没有核实，因此没有写进 pin，这三项当前不检查。教训已记入卡：**验收命令必须包含 `node apps/cli/dist/cli.js <cmd>` 这条 dist 冒烟**，`tsx` 跑 src 不能替代。
