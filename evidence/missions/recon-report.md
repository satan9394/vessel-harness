# Composable_Agent_Harness — 第一轮 Mission 基线勘察报告（只读侦察）

- 侦察对象：`E:\Code_file\Projects\Composable_Agent_Harness`（git 仓库，分支 `main`，**无 origin remote**）
- 侦察时间：2026_09_04 工作区会话；**本报告是本次侦察唯一的写入产物**
- 只读纪律遵守情况：全程只跑 `git status/log/diff/rev-parse/ls-files/rev-list`、`Get-ChildItem`、`Get-Content`、`Select-String`、`Test-Path`；**未** `add/commit/checkout/restore/stash/clean`、**未**删除任何文件、**未**安装依赖、**未**跑 build/test/install、**未**改写项目内任何文件。报告的目录创建发生在工作区侧（`E:\DeepSeek_Harness\workspace\...`），不在项目内。

---

## 0. 结论先行

1. **那 8 处未提交改动 = 一个完整的「`turn/end` Telemetry 接线」切片 + 2 个上一会话留下的未跟踪恢复文档。** 其中 6 个已修改文件不是半成品、也不是纯文档更新，而是**代码 + 文档 + 守卫三面同步的一批改动**：实现了 `Telemetry.finalizeRecord` 的 `case 'turn/end':`（+ `liveTurnIds` 身份去重），并把 ARCHITECTURE / BENCHMARK-SPEC / PRODUCT-STATE / unwiredRecords 守卫的相应措辞一并改准。
2. **该切片已经过一次独立对抗验收，判决 FAIL，因此未提交。** 失败原因**不是实现方向**（方向已被人类裁决保留），而是**我们自己新写入的三处断言过强、已被反例证伪**（详见 §2.3 / §6）。⇒ `turn/end` 切片的状态是 **「已实现、验收 FAIL、待收窄依据后重评」**，不是「待实现」，也不是「待验收」。
3. **基线可安全推进，但有一个前提动作**：仓库**无 remote**、那 6 个文件**未提交且无备份** ⇒ 任何编辑前必须先做仓库外补丁备份（`git diff > <工作区>/turn-end-slice.patch`，不 `git add`），否则一次误操作即不可恢复。
4. **最需要修正的既有认知**：GPT 的「完成 `turn/end` 切片的验收与提交」在**方向上正确、在状态判断上落后半步** —— 验收**已经做过且 FAIL 了**，第一轮 Mission 的实质是**「按 FAIL 结论收窄三处断言 + 修两处连带矛盾 + 给两条反例补判别性用例 + 突变实测 + 重评 + 提交」**，而不是「去验收一个未验收的切片」。

---

## 1. 问题一：那 8 处未提交改动到底是什么

### 1.1 清单（`git status --short` 原始输出，逐字）

```
$ git status --short
 M docs/ARCHITECTURE.md
 M docs/BENCHMARK-SPEC.md
 M docs/product-evolution/PRODUCT-STATE.md
 M packages/shared/src/unwiredRecords.test.ts
 M packages/telemetry/src/Telemetry.ts
 M packages/telemetry/src/telemetry.test.ts
?? DSH_RECOVERY_CHECKPOINT.md
?? DSH_RECOVERY_REPORT.md
```

6 个已修改（工作区）+ 2 个未跟踪 = 8。暂存区**为空**（`git diff --cached --stat` 无输出）。HEAD = `ba173d4788fe02deceb78f077c10be1053ad559f`（= `ba173d4`），`git remote -v` **无输出**（确认无 origin）。

### 1.2 逐条：规模（`git diff --numstat` 原始输出）

```
1	1	docs/ARCHITECTURE.md
2	2	docs/BENCHMARK-SPEC.md
1	1	docs/product-evolution/PRODUCT-STATE.md
5	1	packages/shared/src/unwiredRecords.test.ts
90	12	packages/telemetry/src/Telemetry.ts
151	6	packages/telemetry/src/telemetry.test.ts
6 files changed, 250 insertions(+), 23 deletions(-)
```

| # | 文件 | 增/删 | 性质 | 内容摘要（关键 diff） |
|---|---|---|---|---|
| 1 | `docs/ARCHITECTURE.md` | +1/−1 | 文档更新（§4.11 表格） | 把 `turn/end` 从「未消费」段移入「已消费」段，注明**仅取回合身份 → M02 与 `stats.toolCalls` → M03**，按 `turnId` 去重；未消费段改成「`turn/end.stats` 的其余加法字段」并逐条给理由（`steps` 中断时比 `after_model` 多 / `tokensUsed` 双计且拆不出 M06/M07 / `costEstimate` 无 provider 上报 / `toolCallsWithoutEnd` 无指标定义） |
| 2 | `docs/BENCHMARK-SPEC.md` | +2/−2 | 文档更新（§4.1 指标表 M02/M03 行） | M02 采集方式加「+ B09 `turn/end` 记录」；M03 加「+ B09 `turn/end.stats.toolCalls`」并写入**「该轮有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数 == `stats.toolCalls`」**（← **这句是被证伪的断言之一，见 §2.3**） |
| 3 | `docs/product-evolution/PRODUCT-STATE.md` | +1/−1 | 文档更新（Round 175 交接的欠账行） | 把「`request/header` 与 `turn/end.stats` 加法字段仍无回放消费方」改准为「**其余**加法字段」，并写明 `finalizeRecord` 现已有 `case 'turn/end':` 但只取身份 + `stats.toolCalls` |
| 4 | `packages/shared/src/unwiredRecords.test.ts` | +5/−1 | 守卫注释更正 | 同族注释里「`turn/end` 整条未接线」改为「现已在 telemetry 侧接线（`case 'turn/end':` 取身份 → M02、`stats.toolCalls` → M03，按 `turnId` 去重；见 `telemetry.test.ts` ⑤⑯⑰）」，仍未接线的只剩其余 stats 字段与 `request/header` |
| 5 | `packages/telemetry/src/Telemetry.ts` | +90/−12 | **实现 + 类注释** | ① `finalizeRecord` 新增 `case 'turn/end':`（`:400` 一带）：`if (this.liveTurnIds.has(r.turnId)) break; counters.turns += 1; counters.toolCalls += r.stats.toolCalls;`；② 新增 `private liveTurnIds = new Set<string>()`，`bus.on('before_turn', (p) => …)` 里记录 `p.turnId`；③ 类注释重写「B09 `turn/end` 记录的接线」整段（取值取舍 + 去重 + 两条边界 + 刻意不取的四个字段）；④ `metrics()` 加注释说明 source 仍是 `before_turn`/`after_tool`（实时面生产者名） |
| 6 | `packages/telemetry/src/telemetry.test.ts` | +151/−6 | **测试** | 新增 ⑯（纯回放重建 M02/M03，含「`stats.steps` 必须仍为 0」的负对照）与 ⑰（防重复计数 / 两侧同数）；并修正守用例 ⑤ 的词法缺陷（原先扫**整个**单元格，现按「未消费」切段后各自只扫反引号 token） |
| 7 | `DSH_RECOVERY_CHECKPOINT.md`（未跟踪） | 4563 B | 上一会话的恢复点 | 「原始目标 / 已完成 / 当前状态 / 已知未完成 / 风险 / 推荐下一步 / 恢复方式」。**注意其 §3 写「工作树干净」——那是它写下的时刻（2026-09-12 12:39），其后工作树才被改脏** |
| 8 | `DSH_RECOVERY_REPORT.md`（未跟踪） | 19473 B | 上一会话的最终报告 | **本仓库当前信息密度最高的一份文件**：§3 未提交清单、§5 建议保留、§7 下一步、**§9 接线记录 + §9.1 独立验收 FAIL 全文**（三处被证伪断言的原始反例、行号、5 项未处理发现）。时间戳 13:36，晚于 checkpoint |

### 1.3 三段性质判定（逐条）

- **不是「半成品」**：`Telemetry.ts` 的实现是完整可编译的闭环（分支 + 去重集合 + 注释 + 测试 + 文档 + 守卫同步），没有 `TODO`/`FIXME`；我在改动段内 grep 未发现未完成标记或「未实现」分支——**唯一带「未实现」字样的是刻意声明**（`before_stop` 的 `void stop`，属既有设计，不在本切片）。
- **不是「纯文档更新」**：`docs/` 那 3 个文件只有 4 行改动，但它们与 90 行代码 + 151 行测试是**同一批**（文档⇄代码守卫把这四者绑在一起）。
- **是「已完成待验收」——但验收已经跑过并 FAIL**：这是本题最关键的修正。`DSH_RECOVERY_REPORT.md` §9.1 记载：全新上下文对抗 Reviewer 判决 **FAIL**，命中的是验收标准预先声明的第 ② 条（`stats.toolCalls` 那条等式的源码层依据），父会话同期复跑 `tsc -b` exit 0 / 定向 138 passed / 全量 exit 0（根 168 文件 2177 passed + 6 skipped、`apps/web` 11 文件 120 passed）。**因硬停止条件 B（Reviewer FAIL）未提交**。
- **互相矛盾：有，且是明确的两处**（我逐行复核，非引用）：
  1. `packages/shared/src/unwiredRecords.test.ts:171-172` 仍写「三条都不属于 `docs/ARCHITECTURE.md` §4.11 那种『记录已落盘、回放侧无消费方』的措辞（那是 `request/header`/`turn/end.stats` 的情况）」——与**同一文件 `:38-43`** 的新更正自相矛盾（本切片只改了后者）。
  2. `docs/BENCHMARK-SPEC.md:576`（M03 行）带着被证伪的等式「该轮有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数 == `stats.toolCalls`」，而该等式正是整个切片「敢把 `stats.toolCalls` 当回放源」的**唯一依据**。

> 命令：`Get-Content packages\shared\src\unwiredRecords.test.ts | Select-Object -Skip 155 -First 24`（输出见上引 171-172 行原文）；`Get-Content docs\BENCHMARK-SPEC.md | Select-Object -Skip 569 -First 12`（输出第 576 行原文）。

---

## 2. 问题二：`turn/end` Telemetry 切片现在到底差什么

### 2.1 实现：已完成

`packages/telemetry/src/Telemetry.ts` 工作区版本 `finalizeRecord` 的 `case 'turn/end'`（diff 原文）：

```ts
      case 'turn/end':
        // B09 记录的回放面（见类注释「B09 `turn/end` 记录的接线」）。
        if (this.liveTurnIds.has(r.turnId)) break;
        this.counters.turns += 1;
        this.counters.toolCalls += r.stats.toolCalls;
        break;
```

以及 `attach` 侧的身份登记：

```ts
      bus.on('before_turn', (p) => {
        const { turnId } = (p ?? {}) as { turnId?: unknown };
        if (typeof turnId === 'string' && turnId !== '') this.liveTurnIds.add(turnId);
        this.counters.turns += 1;
      }),
```

**改前状态**（`git log -S "case 'turn/end'" -- packages/telemetry` ⇒ 无输出；`git log -S "liveTurnIds"` ⇒ 无输出）：该分支**在 HEAD 中不存在** ⇒ 纯回放（未 `attach` 总线）时 M02/M03 恒 0，而这两个指标在 25 个有 manifest 的场景里**全部**被声明为 `measured`。这就是切片的动机。

### 2.2 验收：做过，**FAIL**（证据在 `DSH_RECOVERY_REPORT.md` §9.1）

`DSH_RECOVERY_REPORT.md:76-97` 是判决全文。摘要（判决标准 6 条，命中第 ② 条）：

> **结论**：**FAIL**，命中的正是验收标准预先声明的第 ② 条。切片在**正常单回合**路径上的行为是对的（`case 'turn/end':` 取值正确、`:410` 的身份去重成立、⑯⑰ 在成功回合上绿，F/范围项亦判通过：只有 6 个文件 ……），被证伪的是**我们自己新写入的三处断言**。

### 2.3 差什么：三处被证伪的断言 + 两处连带矛盾 + 5 项未处理发现

**三处被证伪的断言（我做了独立源码复核，见 §6.2 的行号证据）**

1. **「有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数 == `stats.toolCalls`」不成立。**
   反例：同一 `AgentLoop` 上两个 `runTurn` 重叠、工具 signal-blind。`raceToolRun` 捕获的是**当时**的 signal，而 catch 守卫读的是**当前**的 `this.interruptCtl.aborted`，且异常被折成 `kind='interrupted'` 后**继续走到落 `turn/end`** ⇒「不发 `after_tool` 就 rethrow、那一轮没有 `turn/end`」的论证链断裂。又因 `LoopState` **每个 loop 一个**且 `beginTurn` 归零，旧回合落盘时读到的是**新回合**的计数器。实测：`turn/end` 存在、该轮 `after_tool`=1、`stats.toolCalls`=0。
2. **「记录条数 = 回合数，与 `before_turn` 事件数逐字相等」+「实时 == 纯回放」不成立。**
   反例更简单、**无并发**：单回合、provider 抛不可重试错误 ⇒ 该回合发过 `before_turn` 却**根本没有 `turn/end` 记录** ⇒ 实测 `live.turns=1 / replay.turns=0`。
3. **`costEstimate` 那段的措辞过强**：类注释里「全仓只有类型声明与 `AgentLoop` 的累加，没有铸造点」被 `AgentLoop.log-evidence.test.ts:48/51`（测试 provider 上报 `costEstimate` 并断言落进 `turn/end.stats`）证伪；「本仓也没有对应指标定义」被 `packages/shared/src/metrics.ts:7`（`MetricId` 含 M11）与 `BENCHMARK-SPEC` §4.1 M11 行证伪。实质结论（**没有任何 shipped provider 上报它**）仍成立，错的只是绝对化措辞。

**两处连带矛盾**：见 §1.3 的 1、2（`unwiredRecords.test.ts:171-172`、`BENCHMARK-SPEC.md:576`）。

**5 项未处理发现（报告 §9.1 原列）**
1. 被证伪的第 1、2 条等式同时写在**三处**（`Telemetry.ts` 类注释、`BENCHMARK-SPEC.md:576`、为 `stats.toolCalls` 作保的论证段），而它是整个切片取 `stats.toolCalls` 的**唯一依据** ⇒ 依据需重新论证或收窄（例如只对未被并发打断的合计算、或改取别的身份/来源）—— **属人类裁决**。
2. `stats.toolCalls` 在「回合重叠 + 旧回合被 abort」这条受支持路径上会读到新回合计数器（`SessionController.ts:159-167` 明文承认该语义）⇒ M03 回放侧取值在那些路径上不可信；M02 的「两侧同数」同样只对成功单回合成立。
3. `costEstimate` 括注需改成「没有任何 shipped provider 上报它」。
4. `unwiredRecords.test.ts:167-169` 与 `BENCHMARK-SPEC.md:576` 的连带矛盾。
5. ⑯⑰ 的「删哪行会红」**从未做突变实测**，且**成功单回合以外没有任何用例**覆盖 ⇒ 按纪律 24，判别性主张目前属未实测。

### 2.4 「是待验收还是待实现」的准确表述

| 面向 | 状态 |
|---|---|
| 实现（`case 'turn/end'` + `liveTurnIds` 去重） | **已完成**，正常单回合路径行为正确 |
| 文档/守卫同步 | **已完成**，但有 2 处连带矛盾未清 |
| 验收 | **已做过，FAIL**（不是「待验收」） |
| 提交 | **未提交**（硬停止条件 B），且切片**没有对应的 `tasks/` 卡**（见 §4.4） |
| 剩余工作 | 收窄 3 处断言 + 清 2 处矛盾 + 补 2 条反例的判别性用例 + 突变实测 + 重评 + 提交 |

---

## 3. 问题三：项目构建、测试与包结构

### 3.1 包管理器 / 测试运行器 / 构建

`package.json` 原始输出（节选）：

```json
{
  "name": "composable-agent-harness", "version": "0.10.0", "type": "module",
  "workspaces": ["apps/*", "packages/*", "benchmarks/runners"],
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -b tsconfig.json",
    "build:release": "tsc -p tsconfig.release.json",
    "typecheck": "tsc -b tsconfig.json --pretty false",
    "test": "vitest run",
    "test:web": "vitest run --root apps/web",
    "test:all": "vitest run && vitest run --root apps/web",
    "test:watch": "vitest",
    "vessel": "tsx apps/cli/src/cli.ts",
    "start": "tsx apps/cli/src/cli.ts",
    "cli": "tsx apps/cli/src/cli.ts",
    "bench": "tsx apps/cli/src/cli.ts run --bench"
  },
  "devDependencies": { "@types/js-yaml", "@types/node", "js-yaml", "tsx", "typescript", "vitest" },
  "dependencies": { "@clack/prompts": "^1.7.0" }
}
```

- **包管理器 = npm workspaces**。锁文件：`package-lock.json` 存在（96 KB）；`pnpm-lock.yaml` / `bun.lockb` / `yarn.lock` **均不存在**（`Test-Path` 全 False）。CI 用 `npm ci || npm install`。
- **测试运行器 = Vitest 2.x**，**两个 root**：根 `npx vitest run` + `npx vitest run --root apps/web`（`apps/web` 有独立 `vitest.config.ts` + `@vitejs/plugin-react`，根 `include` **不含**它）。这是仓库的硬性纪律（AGENTS.md 约束 7、纪律 26）：**只跑根不算全量**。
- **构建 = `tsc -b tsconfig.json`**（TypeScript 5.5，project references，`composite: true`），`dist/` 为产物且 **`.gitignore` 已忽略**（`git ls-files dist` ⇒ 0 项），根 `dist/` 目录**当前存在**（历史构建残留）。
- `vitest.config.ts` 把 `@vessel/*` 全部 alias 到 `packages/*/src/index.ts` ⇒ **测试直接跑源码，不需要先 build**。`setupFiles: ['./vitest.setup.ts']` 把 `VESSEL_SESSION_ROOT` 指向 `mkdtempSync(tmpdir())`，`afterAll` 用 `rmSync` 清理（这是 AGENTS.md 明文允许的删除例外）。
- **测试文件数（我实测）**：根 root 覆盖 **168** 个 `*.test.ts`（含 `index.test.ts` + `packages/**` + `apps/cli` + `apps/local-server` + `benchmarks/runners`）；`apps/web` **11** 个（`src/**/*.test.{ts,tsx}`）。合计 179。与报告 §9「根 168 文件 / 2177 passed、`apps/web` 11 文件 / 120 passed」**自洽**（这是一次可靠的交叉验证）。

### 3.2 tsconfig 层次（`tsconfig.json` references + `tsconfig.base.json`）

references 顺序（= 依赖顺序，跨包改动必须按此序被 `tsc -b` 增量检查）：
`shared → core → llm → behavior → context → tools → policy → runtime → memory → skills → agents → telemetry → engine → application → apps/cli → apps/local-server → benchmarks/runners`

`tsconfig.base.json` 关键项：`target ES2022`、`module/moduleResolution NodeNext`、`strict: true`、`noUncheckedIndexedAccess: true`、`noFallthroughCasesInSwitch: true`、`composite/declaration/declarationMap/sourceMap` 全开、`types: ["node"]`。另有 `tsconfig.release.json`（`build:release`）。

### 3.3 `packages/` 下的包（14 个，`package.json` 的 name 实测）

`@vessel/agents`、`@vessel/application`、`@vessel/behavior`、`@vessel/context`、`@vessel/core`、`@vessel/engine`、`@vessel/llm`、`@vessel/memory`、`@vessel/policy`、`@vessel/runtime`、`@vessel/shared`、`@vessel/skills`、`@vessel/telemetry`、`@vessel/tools`。
另有工作区成员：`apps/cli`、`apps/web`、`apps/local-server`（`@vessel/local-server` alias 存在）、`benchmarks/runners`（`@vessel/bench-runners`）。
**注意**：`AGENTS.md:24` 的「packages/：shared/core/llm/behavior/context/tools/policy/runtime/memory/skills/agents/telemetry」**漏列了 `application` 与 `engine`** ⇒ 该行已过期（属"文档落后于代码"的同族病）。

### 3.4 建议命令与预期判据（**本轮按指令未跑**）

| 目的 | 建议命令 | 预期判据（可客观验证） | 会产生产物？ |
|---|---|---|---|
| 类型构建 | `npx tsc -b tsconfig.json` | 无输出、exit 0；会写 `*.tsbuildinfo`（已 gitignore） | ⚠️ 写 tsbuildinfo + `dist/`（gitignored） |
| 定向测试（切片） | `npx vitest run packages/telemetry packages/shared` | 全绿；⑯⑰ 与 ⑤ 通过 | ⚠️ 写 `node_modules/.vite` 缓存 + tmp 状态根 |
| 全量（**最后一次编辑之后**） | `npm run test:all` | 根 168 文件 / ≥2177 passed + 6 skipped / 0 failed；`apps/web` 11 文件 / 120 passed；**两个 root 都 exit 0** | ⚠️ 同上 |
| 判别性突变（纪律 24） | 临时删 `case 'turn/end':` 分支 → 跑 ⑯⑰ → 必须红；恢复 | 删除后 ⑯⑰ 红；恢复后绿。**这是"删哪行会红"的实测证据** | ⚠️ 需改文件（须先备份） |
| 现状基线（推荐先做，最便宜） | `git status --short`、`git diff --stat` | 8 项与本文一致（防止并发改写） | 否 |

**不要跑**：`npm install`（改 lockfile/node_modules）、`npm run bench`（真实模型 lane，消耗外部配额）、`run-release-gates.ts`（改写**被跟踪**的 `benchmarks/reports/release-report.{md,json}`，且调真实模型接口）。

---

## 4. 问题四：状态与待办的权威来源

### 4.1 权威性分级（我的判定，附依据）

| 级别 | 来源 | 规模/时间 | 判定 |
|---|---|---|---|
| **A 权威（最新、最相关）** | `DSH_RECOVERY_REPORT.md`（未跟踪，仓库根） | 19 KB，2026-09-12 13:36 | **当前切片与下一步的唯一一手记录**：§3 未提交清单、§5 建议保留、§7 下一步、§9/§9.1 接线与 FAIL 全文。**未跟踪 ⇒ 有被 `git clean` 类操作误清的风险** |
| **A 权威（长期）** | `docs/product-evolution/PRODUCT-STATE.md` | 186 KB / **825 行** | 项目自述的「纪律 + 队列 + 交接」权威。最新两节：**Round 175「本段最终交接」**（终局实测 2166 passed、四条需拍板决策、剩余欠账清单）+ Round 177 新账（即工作区那一行未提交改动）。Round 162/169/172/175 各自带"留给下一位的清单" |
| **A 权威（缺口地图）** | `docs/product-evolution/PRODUCT-GAP-MAP.md` | 120 KB | 按 Round 分节的缺陷台账（含定级）。**§Round 84-87 的 `:430` 就是"异常路径不落 `turn/end`（`AgentLoop.ts:369 throw err`），定级：中"的原始出处** —— 即本次被证伪那条断言的反例，本仓**自己早就记录过**，上一会话却把它当成了成立的前提 |
| **A 权威（规则）** | `AGENTS.md` | 6.9 KB / 67 行 | 项目级开发约定：技术栈、包管理与「全量 = `npm run test:all`」、9 条硬性约束、禁做清单。首行与用户所给一致 |
| **B 权威（规格）** | `docs/ARCHITECTURE.md`（57 KB）、`docs/BENCHMARK-SPEC.md`（91 KB）、`docs/EVENT-SPEC.md`（81 KB）、`docs/POLICY-SPEC.md`（49 KB）、`docs/DESIGN-DECISIONS.md`（68 KB） | — | 规格权威，但**已被证明含大量与实现不符的段落**（Round 169 记的 11 条、Round 172 记的 8 条）；它们**不是**现状权威，只是「应该长成什么样」的权威 |
| **C 半过期** | `tasks/`（113 文件）、`tasks/README.md`、`docs/product-evolution/ROUND-15-DIRECTION.md`、`docs/V1.1-ROADMAP.md`、`docs/MISSION-V0.x.md` | — | 见 §4.2–§4.4 |
| **D 过期/历史快照** | `docs/REVIEW-REPORT-V0{1..5}.md`、`docs/V0x-PROGRESS.md`、`docs/V0x-IMPLEMENTATION-NOTES.md`、`docs/CHANGELOG.md`（最新条目 0.10.0）、`benchmarks/reports/release-report.{md,json}` | — | 当时坐标；`release-report` 明确被记为「仍是旧判据快照、未重跑刷新」 |

### 4.2 `tasks/` 的分布（113 个文件）

- **构成**：编号卡 `001`–`119`（其中 `046→049`、`085→089`、`089→097` 有跳号）+ `README.md` + `implement-brief-01.md` + 6 张 `V1.1-A..F` 卡。
- **状态取值**（AGENTS.md/tasks README 规定：待执行 / 执行中 / 待验收 / 已合入 / 打回）。我按每张卡前 6 行里的「状态」行统计：

| 状态 | 数量 |
|---|---|
| 已合入 | 57 + 7（带日期后缀变体）= **64** |
| 待执行 | **17** |
| 待验收 | **8** |
| 执行中 | **1** |
| 无状态行（`118`、`119`、`implement-brief-01.md`，另 2 张标题行被当成状态行） | 5 |
| 其它已合入变体（带 commit/审批说明） | 约 18 |

- **17 张「待执行」**：`015 016 017 020 021 022 023 025 032 034 035 036 037 038 040 042 044`。
  **⚠️ 这 17 张里有相当一部分其实早已完成**：`tasks/README.md` 的表把 014–018 全部标为「已合入」（015/016/017 甚至带 commit `3544f0f`/`1314e41`/`d759f3a`），而我实测 `git log --oneline -1 3544f0f` ⇒ `3544f0f feat(cli): provider SSOT store + model fetcher (tasks 014/015 core)` **确实存在**。⇒ **卡内状态行与 README 表、git 历史三者互相矛盾，卡内状态不可信**。
- **8 张「待验收」**：`014 024 039 041 043 045 113 114 115 117`（去重后 10 条含变体）。抽查 `113`（原子写 EPERM 有界重试）与 `117`（交互引导）头部：均写「状态：待验收 / 执行器：隔离子代理（一张卡一个执行器，干完回填本文档）」⇒ **这些是真实的待验收队列**（其工作成果在提交里，等指挥侧验收），与 17 张「待执行」的性质不同。
- **无 README 索引维护**：`tasks/README.md` 只有 **60 行**，表格**止于 `018`**（`Get-Content tasks\README.md | Select-Object -Skip 60` ⇒ **无输出**）。⇒ 「当前迭代」一节仍写「V0.1–V0.5 全部完成」，与仓库实际（Round 58→177、HEAD 已在 V0.10 之后）**严重脱节**。

### 4.3 `docs/` 下的评估/验收结果文件

- `docs/product-evolution/EVALUATION-REPORT-01..24.md`（24 份，含 `-01-E2`、`-03-RECHECK`）+ `EVALUATION-BRIEF-01/02/07`：**独立对抗评估的结果落盘**，是本项目「Generator/Evaluator 分离」纪律的产物。**最新编号 24**。
- `docs/product-evolution/IMPLEMENTATION-BRIEF-01..16.md`（16 份，缺 14）+ `FIX-BRIEF-01.md` + `IMPLEMENT-BRIEF-01-STATE.md`：派卡简报。
- `docs/REVIEW-REPORT-V0{1..5}.md`：版本里程碑的独立核验（历史）。
- **注意**：**没有** `EVALUATION-REPORT-25` 或任何对应「`turn/end` 切片 FAIL」的落盘评估文件 —— 该判决**只存在于未跟踪的 `DSH_RECOVERY_REPORT.md` §9.1**。⇒ 若该未跟踪文件丢失，验收结论即丢失（这正是本项目反复吃过的「清单只活在会话里」同族风险）。

### 4.4 一个必须指出的事实：当前切片**没有任务卡**

`Select-String -Path tasks\*.md -Pattern "turn/end" -List` ⇒ 只命中 `050-interrupt-controller.md` 与 `V1.1-D-l1-scenarios.md`，**没有**本切片的卡。本切片的来源是 `DSH_RECOVERY_REPORT.md` §7.3 的「二选一：接线或改文档」→ 选了 `turn/end.stats`。
⇒ 这**违反了项目自身的工作流纪律**（AGENTS.md「一张卡一个文件」；personal-dev-workflow「执行者只认任务卡」）。第一轮 Mission 应把「补卡」列为动作之一，否则下一轮还会重复「切片无卡、依据只活在报告里」的老病。

---

## 5. 问题五：第一轮 Mission 提案

### 5.1 Mission（一句话）

> **把工作区里那个「实现正确、验收 FAIL」的 `turn/end` Telemetry 切片推到可提交：收窄并按反例更正三处被证伪的断言（含 `costEstimate` 措辞）、清掉两处连带矛盾、为「异常路径」与「回合重叠」两条反例各补一条判别性用例并做突变实测，经全新上下文对抗评审通过后，一次性提交该切片并同步落一张 `tasks/` 卡。**

### 5.2 DoD（5 条，全部可客观验证）

1. **先备份后动刀**：在编辑任何项目文件之前，把当前 8 处改动导出为**仓库外**补丁（`git diff > <工作区>\composable-mission-01\turn-end-slice.patch`，未跟踪文件另存副本），并在交接中附补丁的 `git apply --check` 结果。判据：补丁文件存在且 `git apply --check --reverse` 在当前树上通过。
2. **三处断言 + 一处措辞已收窄到可证伪范围**：全仓 grep 不再出现无条件形式的「该轮有 `turn/end` 记录 ⇒ 该轮 `after_tool` 条数 == `stats.toolCalls`」「记录条数 = 回合数 = `before_turn` 事件数」「（无条件）实时 == 纯回放」；`costEstimate` 措辞改为「没有任何 shipped provider 上报它」。判据：给出 grep 命令与「0 命中/仅剩带条件的表述」的原始输出。
3. **两条反例各有判别性用例，且做过突变实测**：① 单回合 + provider 抛不可重试错误 ⇒ 断言 `live.turns=1 && replay.turns=0`；② 两个 `runTurn` 重叠 + 工具 signal-blind ⇒ 断言记录侧取值不等于旧回合真实工具数。判据：**临时删掉实现对应行 ⇒ 指定用例红；恢复 ⇒ 绿**，两段原始输出都要给出（这是纪律 24「删哪行会红」，上次缺的正是它）。
4. **不回归**：`npx tsc -b tsconfig.json` exit 0 无输出；`npm run test:all` exit 0（根 ≥168 文件 / ≥2177 passed + 6 skipped、`apps/web` 11 文件 / 120 passed），且**两项都在最后一次编辑之后**执行（AGENTS.md 约束 7）。若出现偶发红，原样保留**完整**输出再判定（不要先过滤）。
5. **提交与落卡**：提交只含该切片文件（6 个已修改 + 新增用例/卡），不使用 `git add -A`（纪律 27）；`DSH_RECOVERY_*.md` 的处置由人裁决（提交/移出仓库/保留未跟踪）并如实记录；新增 `tasks/120-turn-end-telemetry-slice.md` 一张卡（目标/验收标准/涉及文件/依赖/优先级 + FAIL 结论与处置）；提交后 `git status --short` 只剩明确裁决过的项。

### 5.3 WorkSet（7 张卡，≤8）

| # | 卡 | 目标 | 来源 |
|---|---|---|---|
| W1 | 切片备份 + 现状冻结 | 导出仓库外补丁；记录 `git status/diff --stat` 与 HEAD，作为后续一切比对的基线 | planned |
| W2 | 三处断言收窄 + `costEstimate` 措辞更正 | 按 §2.3 的三条 + 措辞一条，把「强于事实」的表述改准（`Telemetry.ts` 类注释、`BENCHMARK-SPEC.md:576`、作保论证段） | blocker |
| W3 | 清两处连带矛盾 | `unwiredRecords.test.ts:171-172` 与同文件 `:38-43` 对齐；`BENCHMARK-SPEC.md:576` 与 ⑤ 守卫的词法切段口径对齐 | blocker |
| W4 | 两条反例的判别性用例 | 异常路径（无 `turn/end`）与回合重叠（读新回合计数器）各一条，钉住**真实**边界 | blocker |
| W5 | 突变实测（纪律 24） | 对 ⑯⑰ 与 W4 新增用例逐条产出「删哪行会红」的**实测**输出 | planned |
| W6 | M03 回放取值口径裁决 | 「回合重叠 + 旧回合被 abort」时 M03 是否只对未被打断回合计（或改取别的身份/来源）——**需人拍板，不得自行改口径** | human-requested |
| W7 | 落卡 + 全新上下文对抗评审 + 提交 | 写 `tasks/120-…`；派**全新上下文、只读、只见 diff + DoD** 的 Reviewer 重评（沿用「冻结 HEAD + `git show HEAD:` 取证」抗并发法）；PASS 后按要求提交 | planned |

### 5.4 预算建议

**Run 级 8 项（每条 run 的硬上限）**
1. `npx tsc -b tsconfig.json` ≤1 次；
2. 定向 vitest（`packages/telemetry packages/shared`）≤1 次；
3. 全量 `npm run test:all` ≤1 次，且**只在最后一次编辑之后**；
4. 突变实测 ≤2 轮（改→跑→还原，逐轮留原始输出）；
5. 真实 provider 调用 **0 次**（禁止消耗外部配额；不做 real-model lane / release gates）；
6. `npm install` **0 次**（lockfile 不得变动）；
7. 仓库外补丁备份 **恰好 1 次**，且在首次编辑之前；
8. 交证 1 份，含 diff + 原始输出（**不过滤**）；写入仓库的文件只限本卡授权范围。

**Mission 级 3 项**
1. **≤6 个隔离执行器**，并发 **1–2**（AGENTS.md 禁大批量并行；本环境实测大批量会中途失败）；
2. **≤1 次**独立对抗评审；**FAIL ⇒ 停，禁止 Fix→Re-test 循环**（沿用硬停止条件 B），交人裁决；
3. **≤1 次 git 提交**，仅限切片内文件，**禁止 `git add -A`**、禁止 `--force`、禁止任何永久删除（仓库内文件一律回收站）。

### 5.5 Out of scope（明确不做）

- **不重跑已完成的工作**：不重跑 `tsc`/`test:all` 之外的既有验证（V0.1–V0.5 验收、Round 58→175 的封闭主线），不重做 Round 169/172 的 spec 对账，不重跑 24 份 EVALUATION-REPORT。
- **不动四条产品语义决策**：`--model ''` 挡 `VESSEL_MODEL` 回落、真实 provider 无 model 时发字面量 `"mock-model"`、`denials`/M12 双计（`Math.max` 绕行）、`measured` 是否从 warn 收紧为 fail-loud（收紧会打红 25 个场景里的 23 个）。
- **不扩展本切片范围**：不接 `request/header`；不接 `turn/end.stats` 的其余字段（`steps`/`tokensUsed`/`costEstimate`/`toolCallsWithoutEnd`）；不动 `compaction/summary`(B15)、`session/end-seed`(B11)、`audit/safety`(B21)、`before_stop` 死缝、`AuditDenialRecord.stage` 的两个无生产者值、`resumeSuccess`。
- **不刷新 `benchmarks/reports/release-report.{md,json}`**（被跟踪产物 + 真实 API 配额）；不做「手改产物让它看起来一致」（纪律 27 明令）。
- **不做无关重构**（AGENTS.md 约束 9）；不改 `tasks/` 里 17 张「待执行」卡的状态（那是另一件事的裁决，本轮只**报告**矛盾）。
- **不安装依赖、不改 lockfile、不升级 TypeScript/Vitest。**
- **不触碰 8 处未提交改动的既有内容之外的部分**：不做 `git stash/restore/checkout/clean`（会把切片弄丢）；不删除 `DSH_RECOVERY_*.md`（未跟踪 ≠ 可删，它们是当前唯一的一手记录）。
- **不做 Web/UI/provider 扩展**（ROUND-15-DIRECTION 已明确拒绝项）。

---

## 6. 问题六：风险与坑（「踩过就疼」的东西）

### 6.1 头号病史：**「声明与实现不一致」**（本项目 20+ 轮都在治它）

- **HEAD 提交本身就是这一类**：`ba173d4` 的信息逐字写着「three declared values that were not measurements」——`resumeSuccess` 恒 `false`、M14 四个 detail 字段恒 0、denial 两个 stage 有类型无生产者。
- **`DSH_RECOVERY_REPORT.md:41` 的自我评价最值得继承**：这个切片就是**同一个病的新实例** —— 我们**实现了**取值，但我们为它写的**依据**（三条等式）比自己能做到的强。⇒ 这也是本次 FAIL 的根因，**与产物无关，与措辞有关**。
- **PRODUCT-STATE Round 175 的自评**（我逐字读过）：「这一段我**两次把『收口』说早了** …… ⇒ **可靠的停法只有一种：对某类不变量做一次全仓清查并列出全部实例**。没做到那一步的类别，就不该宣布收口。」⇒ **任何"我查完了"的主张都必须先给出"该类不变量的全仓实例枚举"，否则不许收口。**

### 6.2 具体可复用的坑（我独立复核过的行号）

| 坑 | 证据（我读过原文） | 对本 Mission 的约束 |
|---|---|---|
| **异常路径不落 `turn/end`** | `AgentLoop.ts:451-465` 的 catch：`TurnInterruptedError`/`aborted` ⇒ `kind='interrupted'`；`DenialLimitError` ⇒ `kind='error'`；**`else { throw err; }`（:462-463）** ⇒ 直接抛出，`:528` 的 `turn/end` **永不写入**，而 `:208-212` 的 `before_turn` 已经发过 | 这是被证伪断言 2 的机制。**本仓 `PRODUCT-GAP-MAP.md:430` 早已记录**「异常路径不落 `turn/end`（`AgentLoop.ts:369 throw err`），定级：中」 |
| **`LoopState` 每个 loop 一个、`beginTurn` 归零** | `AgentLoop.ts:136` `private readonly state = new LoopState();`；`State.ts:20-26` `beginTurn` 把 `steps/toolCalls/contextEstimateTokens` 归零 | 被证伪断言 1 的机制：重叠回合时旧回合落盘读到**新回合**计数器 |
| **回合重叠是被支持路径，不是理论边界** | `SessionController.ts:159-167` 注释明文：「calling runTurn while an older turn is still running aborts that stale turn」；`AgentLoop.ts:185-194` `runTurn` 只有 `interruptCtl.begin()/end()`，**无重叠闸门** | M03 回放取值在那些路径上不可信（报告 §9.1 第 2 项）；**要改口径必须人裁决** |
| **"清单只活在会话里"已发生四次** | PRODUCT-STATE Round 151（环境变量 14 条）、Round 169（spec 11 条）、Round 172（16 条，并立规矩）、以及本次「FAIL 判决只在未跟踪的 `DSH_RECOVERY_REPORT.md` 里」 | **凡引用"上一卡给的 N 条清单"，那张清单必须已在磁盘上**；本 Mission 的验收报告应落盘到 `tasks/120-…` 或 `docs/product-evolution/` |
| **文档⇄代码双向守卫** | `packages/shared/src/unwiredRecords.test.ts`（把 `ARCHITECTURE.md` §4.11 的"已消费集合"与 `finalizeRecord` 的 `case` 分支双向绑定）、`spec-manifest-parity.test.ts`、`telemetry.test.ts` ⑤ | 改文档或改代码**必须同批**，否则测试红；反向也成立（守用例是"接线绊线"，故意设计成接线即红） |
| **生成物/派生文件** | `dist/`（gitignored，已存在）；`benchmarks/reports/**`**部分被跟踪**（`release-report.{md,json}`、`SOAK-068/**`、`V1.1-*-lane.json`）；`.harness/`、`benchmarks/reports/run_*/`、`*.tsbuildinfo` 已 gitignore | **验证命令会改写被跟踪产物**（纪律 27）：禁止 `git add -A`，禁止手改产物冒充一致 |
| **跨包依赖顺序** | `tsconfig.json` references 链（shared→…→application→apps→benchmarks）；`vitest.config.ts` 的 alias 让测试直跑源码；`benchmarks/runners` 依赖 `contracts/vessel.ts` 与 telemetry | telemetry 改动会牵动 `benchmarks/runners` 与 `docs` 守卫；改 telemetry 后必须跑**根**全量（含 benchmarks 的测试） |
| **Windows 原子写 rename EPERM 间歇 flaky** | `.github/workflows/ci.yml` 注释（明确写 "known Windows flake"）+ `AGENTS.md` + `tasks/113` | 全量偶发 1–2 项红**不等于回归**；必须**原样保留完整输出**再判定（上次报告吃过"先过滤后丢名字"的亏） |
| **测试/文档里的基线数字互相冲突** | `tasks/118` 写基线「140 文件 / 1670 passed」；`tasks/119` 写「141 文件 / 1675 passed」；PRODUCT-STATE Round 162 写 2140、Round 175 写 2166；报告写 2177；我实测根 **168** 文件、web **11** 文件 | **不要相信任何卡里的基线**，一律以实跑为准；DoD 里写清"≥2177"而非"等于某卡里的数" |
| **沙箱里 vitest 可能不可用** | `AGENTS.md:65`「不要在沙箱受限会话里期待 `npx vitest run` 可用（esbuild spawn EPERM）」 | 本会话是 `danger-full-access`（pwsh 为 FullLanguage），但执行器若被起在受限沙箱里，测试会假红 |
| **删除铁律** | 全局规则 + `AGENTS.md:16-19`：仓库内文件/`docs/`/`tasks/`/`configs/`/`~/.vessel`/用户数据**一律回收站**；唯一书面例外 = 测试自建且位于 `os.tmpdir()` 下的临时目录（约 82 处 `rmSync` 属既有约定，**不要去改**） | 派卡时必须写明；命令文本也不得含永久删除类 API 字面名（本机 pre-execute 门禁是子串匹配） |
| **无 remote + 6 个未提交文件 = 不可恢复** | `git remote -v` 无输出；工作树有 6 改 + 2 未跟踪 | **编辑前必须先做仓库外补丁备份**（W1），这是本 Mission 的第一条 DoD |

### 6.3 一条方法论级建议（沿用报告 §9.1 已证明有效的手段）

对抗评审必须在**冻结的坐标**上做：报告记载「先冻结 HEAD、明说『工作区正被并发改写所以此刻跑的不是 HEAD』、一律用 `git show HEAD:` 定案」，这是**目前唯一有效抵抗"并发写导致错误结论"的手段**。本 Mission 的 W7 评审应照此执行——但注意本切片的改动**在 HEAD 里不存在**（是工作区改动），所以评审对象应是**冻结的补丁/快照**（W1 的补丁文件）而不是 `git show HEAD:`。

---

## 7. 不确定项与未验证项（如实列出）

1. **未运行任何构建或测试**（按指令）。⇒ 那 6 个未提交文件**当前是否真的全绿**属 UNKNOWN。报告称 `tsc -b` exit 0、`npm run test:all` exit 0（根 2177 passed + 6 skipped、web 120 passed），但我**未复核**；且报告自述**曾有一次 exit 1、根 2127 passed、一个文件整片未过（约 50 项）而失败文件名被过滤丢失**，机制未证实（当时有另一项目的 vitest/node --test 在并发跑）。⇒ **这是本 Mission 必须先跑一次全量才能确认的头号未知**。
2. **三处被证伪断言的反例，我只做了源码层复核、未实跑复现**。我独立确认了机制（`AgentLoop.ts:462-463` 的 rethrow 使 `:528` 不可达；`AgentLoop.ts:136` + `State.ts:20-26` 的单例归零状态；`PRODUCT-GAP-MAP.md:430` 的既有记录），但**没有**写过测试、没有跑过 vitest ⇒ 「实测 `live.turns=1 / replay.turns=0`」「实测 `after_tool`=1 而 `stats.toolCalls`=0」这两个数字**我未复现**，它们是引用报告 §9.1 的结论。
3. **我没有读 `telemetry.test.ts` 的新增 ⑯⑰ 全文**（只看 diff 的 stat 与报告描述）。⇒ 这两条用例的断言强度是否真的覆盖了「成功单回合以外」，**需 W4/W5 阶段实读+实测确认**。
4. **`tasks/` 的 113 个文件没有逐张对账**。我实测到「卡内状态行 ⇄ README 表 ⇄ git 历史」三方矛盾（抽查 015/016/017/018/113/117），但**17 张「待执行」里究竟有几张其实已完成**未逐张核实 ⇒ 任何「从这个队列取活」的提案都可能重复已完成工作。
5. **未确认「中途 `attach`」这条边界是否真的可达**。我确认了 `AgentLoop` 无重叠闸门、`SessionController` 注释承认 abort 旧回合，但**没有**逐处核验「全仓唯一组合根 `composeHarness`」这一主张（只读了报告的说法）；`apps/local-server/src/server.ts:245` 的 `inFlight` 注释看着像闸门，但它属于 **team-runs** 状态，`POST /turns`（`:380` `ctl.runTurn(...)`）附近**我没读全**，故「HTTP 面无并发闸门」这一点**属未完全验证**。
6. **未读**：`参考.md`、`任务书.md`、`docs/MISSION-V0.x.md`、`docs/DESIGN-DECISIONS.md` 全文、`CHANGELOG.md` 全文、`ci.yml` 后半段、`release-gates/gates.ts` 判据、`benchmarks/scenarios/**`、`apps/web/**`。凡涉及这些的判断都以「未验证」对待。
7. **`benchmarks/reports/` 里被跟踪产物的完整清单**我只取了前 20 项（`git ls-files benchmarks/reports | Select-Object -First 20`）⇒ 「哪些报告是旧判据快照」只有报告与文档的说法，未逐一比对。
8. **`DSH_RECOVERY_*.md` 的处置无裁决**（提交进仓库 / 移到 `docs/` / 保持未跟踪）。若保持未跟踪，本次验收结论仍只活在未跟踪文件里，与「清单必须落盘」的纪律冲突 ⇒ **建议列入 W6 的人类裁决项**（我倾向：把 §9.1 的 FAIL 结论摘要落进 `tasks/120-…` 与 `docs/product-evolution/PRODUCT-STATE.md`，两个 `DSH_RECOVERY_*` 文件本身移出仓库或明确保留未跟踪）。
9. **本报告未复核上一会话的三次「同一轮里发现、未处理的其它（范围外）事项」**（`request/header` 未接线、M11 产物侧缺口、`interrupts` 无法用记录面消除崩溃歧义、`before_stop` 死缝、`release-report` 旧快照）——这些是**引用**，未独立取证。

---

## 附：本次侦察命令清单（全部只读）

```
cd E:\Code_file\Projects\Composable_Agent_Harness
git status --short ; git log --oneline -8 ; git rev-parse HEAD ; git remote -v
git diff --stat ; git diff --cached --stat ; git diff --numstat
git diff -- docs/ ; git diff -- packages/shared/src/unwiredRecords.test.ts
git diff -- packages/telemetry/src/Telemetry.ts
git log --oneline -S "liveTurnIds" -- .            # 无输出
git log --oneline -S "case 'turn/end'" -- packages/telemetry   # 无输出
git log --oneline -12 -- packages/telemetry ; git log --oneline -1 3544f0f
git rev-list --count HEAD                          # 626
git ls-files benchmarks/reports | Select-Object -First 20 ; git ls-files dist   # 0
Get-ChildItem -Force ; Get-ChildItem packages -Directory ; Get-ChildItem tasks
Get-Content package.json / vitest.config.ts / tsconfig.json / tsconfig.base.json
Get-Content apps\web\vitest.config.ts / vitest.setup.ts / .gitignore / CHANGELOG.md
Get-Content AGENTS.md ; Get-Content tasks\README.md ; Get-Content DSH_RECOVERY_CHECKPOINT.md
(读) DSH_RECOVERY_REPORT.md 全文
(读) packages/core/src/agent-loop/AgentLoop.ts:120-232, 370-539
(读) packages/core/src/state/State.ts:10-39
(读) packages/application/src/session/SessionController.ts:150-175
(读) apps/local-server/src/server.ts:238-261
(读) docs/product-evolution/PRODUCT-STATE.md 末 70 行（文件共 825 行）
(读) docs/product-evolution/PRODUCT-GAP-MAP.md:420-440
(读) docs/product-evolution/ROUND-15-DIRECTION.md:1-45
Get-Content docs\BENCHMARK-SPEC.md | Select-Object -Skip 569 -First 12
Get-Content packages\shared\src\unwiredRecords.test.ts | Select-Object -Skip 155 -First 24
Select-String -Path tasks\*.md -Pattern "turn/end" -List
Select-String -Path tasks\*.md -Pattern "telemetry|Telemetry|M02|M03|B09" -List
（任务卡状态统计、测试文件计数、packages 名称枚举等）
```

**未执行**（按指令）：`npm install`、`npm run build`、`npx tsc -b`、`npx vitest run`（任意定向或全量）、`npm run bench`、`run-release-gates`、以及一切 `git add/commit/checkout/restore/stash/clean` 与任何删除。
